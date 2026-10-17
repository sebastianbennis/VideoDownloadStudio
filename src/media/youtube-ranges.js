import { concatBytes, isUrlAllowed, makeByteBudget } from './fetch.js';

const CHUNK_SIZE = 10 * 1024 * 1024;

export async function readYouTubeInputs(plan, signal, onProgress) {
  const budget = makeByteBudget(plan.maxBytes);
  let completedBytes = 0;
  const totalBytes = totalPlannedBytes(plan);
  const reportProgress = (bytesWritten) => {
    onProgress?.(completedBytes + bytesWritten, totalBytes);
  };
  if (plan.action === 'audio') {
    const audio = await readYouTubeStream({
      url: plan.audioUrl || plan.url,
      expectedLength: plan.audioContentLength || plan.contentLength,
      mimeType: plan.audioMimeType || plan.mimeType,
      name: inputName('audio', plan.audioMimeType || plan.mimeType),
      signal,
      budget,
      allowedOrigins: plan.allowedOrigins,
      pageOrigin: plan.pageOrigin,
      onProgress: reportProgress
    });
    return [audio];
  }
  const previewLimit = plan.action === 'preview' ? Math.min(CHUNK_SIZE, plan.contentLength || CHUNK_SIZE) : undefined;
  const video = await readYouTubeStream({
    url: plan.url,
    expectedLength: plan.contentLength,
    mimeType: plan.mimeType,
    name: inputName('video', plan.mimeType),
    maxLength: previewLimit,
    signal,
    budget,
    allowedOrigins: plan.allowedOrigins,
    pageOrigin: plan.pageOrigin,
    onProgress: reportProgress
  });
  completedBytes += video.data.byteLength;
  if (!plan.audioUrl) return [video];
  const audioPreviewLimit = plan.action === 'preview' ? Math.min(2 * 1024 * 1024, plan.audioContentLength || 2 * 1024 * 1024) : undefined;
  const audio = await readYouTubeStream({
    url: plan.audioUrl,
    expectedLength: plan.audioContentLength,
    mimeType: plan.audioMimeType,
    name: inputName('audio', plan.audioMimeType),
    maxLength: audioPreviewLimit,
    signal,
    budget,
    allowedOrigins: plan.allowedOrigins,
    pageOrigin: plan.pageOrigin,
    onProgress: reportProgress
  });
  completedBytes += audio.data.byteLength;
  return [video, audio];
}

async function readYouTubeStream({ url, expectedLength, mimeType, name, maxLength, signal, budget, allowedOrigins, pageOrigin, onProgress }) {
  if (!url) throw userError('youtube', 'The selected YouTube stream is missing a media URL. Scan again.');
  let expected = positive(expectedLength) || inferContentLength(url);
  const cappedLength = positive(maxLength);
  if (!expected) {
    expected = await fetchYouTubeLength(url, { signal, allowedOrigins, pageOrigin, budget });
  }
  const targetLength = cappedLength ? Math.min(cappedLength, expected || cappedLength) : expected;
  const allowShortFinalRange = Boolean(cappedLength && !expected);
  if (!targetLength) {
    return readWholeYouTubeStream({ url, mimeType, name, signal, budget, allowedOrigins, pageOrigin, onProgress });
  }
  if (targetLength > budget.remaining) throw userError('storage', 'Media exceeds this job byte limit.');
  const chunks = [];
  let offset = 0;
  let bytesRead = 0;
  while (offset < targetLength) {
    signal?.throwIfAborted?.();
    const end = Math.min(offset + CHUNK_SIZE - 1, targetLength - 1);
    const isFinalRange = end === targetLength - 1;
    const chunk = await fetchYouTubeRange(url, offset, end, { signal, allowedOrigins, pageOrigin, allowShort: allowShortFinalRange && isFinalRange });
    const expectedBytes = end - offset + 1;
    if (chunk.byteLength !== expectedBytes && !(allowShortFinalRange && isFinalRange && chunk.byteLength < expectedBytes)) {
      throw userError('range', `YouTube returned ${chunk.byteLength} bytes for a ${expectedBytes} byte range.`);
    }
    budget.remaining -= chunk.byteLength;
    if (budget.remaining < 0) throw userError('storage', 'Media exceeds this job byte limit.');
    chunks.push(chunk);
    bytesRead += chunk.byteLength;
    offset = end + 1;
    onProgress?.(bytesRead, totalProgressLength(targetLength, mimeType));
    if (allowShortFinalRange && isFinalRange && chunk.byteLength < expectedBytes) break;
  }
  return { name, data: concatBytes(chunks, bytesRead), mimeType };
}

async function fetchYouTubeLength(url, { signal, allowedOrigins, pageOrigin }) {
  const parsed = validateYouTubeUrl(url, allowedOrigins, pageOrigin);
  const response = await fetch(parsed.href, {
    method: 'HEAD',
    signal,
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: '*/*' }
  });
  if (!response.ok) {
    await response.body?.cancel?.();
    if (response.status === 405 || response.status === 501) return undefined;
    throw userError('http', `YouTube media request failed with HTTP ${response.status}.`, response.status);
  }
  await rejectTextResponse(response);
  const length = positive(response.headers.get('content-length'));
  return length;
}

async function readWholeYouTubeStream({ url, mimeType, name, signal, budget, allowedOrigins, pageOrigin, onProgress }) {
  const parsed = validateYouTubeUrl(url, allowedOrigins, pageOrigin);
  const response = await fetch(parsed.href, {
    signal,
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: '*/*' }
  });
  if (!response.ok) throw userError('http', `YouTube media request failed with HTTP ${response.status}.`, response.status);
  await rejectTextResponse(response);
  const expected = positive(response.headers.get('content-length'));
  if (expected && expected > budget.remaining) {
    await response.body?.cancel?.();
    throw userError('storage', 'Media exceeds this job byte limit.');
  }
  const data = await readBudgetedBody(response, budget, expected, onProgress);
  return { name, data, mimeType };
}

async function fetchYouTubeRange(url, start, end, { signal, allowedOrigins, pageOrigin, allowShort = false }) {
  const parsed = validateYouTubeUrl(url, allowedOrigins, pageOrigin);
  parsed.searchParams.set('range', `${start}-${end}`);
  const response = await fetch(parsed.href, {
    signal,
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: '*/*' }
  });
  if (!response.ok) throw userError('http', `YouTube media request failed with HTTP ${response.status}.`, response.status);
  await rejectTextResponse(response);
  const expectedBytes = end - start + 1;
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > expectedBytes) {
    await response.body?.cancel?.();
    throw userError('range', 'YouTube did not honor the requested byte range.');
  }
  const contentRange = response.headers.get('content-range') || '';
  if (response.status === 206 && contentRange && !contentRangeMatches(contentRange, start, end, allowShort)) {
    await response.body?.cancel?.();
    throw userError('range', 'YouTube returned an unexpected byte range.');
  }
  return readBoundedBody(response, expectedBytes, allowShort);
}

async function readBudgetedBody(response, budget, expectedBytes, onProgress) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    await response.body?.cancel?.();
    throw userError('range', 'YouTube response could not be streamed safely.');
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      budget.remaining -= value.byteLength;
      if (budget.remaining < 0) throw userError('storage', 'Media exceeds this job byte limit.');
      if (expectedBytes && total > expectedBytes) throw userError('range', 'YouTube returned more bytes than promised.');
      chunks.push(value);
      onProgress?.(total, expectedBytes);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (expectedBytes && total !== expectedBytes) throw userError('range', `YouTube returned ${total} bytes for a ${expectedBytes} byte response.`);
  return concatBytes(chunks, total);
}

async function readBoundedBody(response, expectedBytes, allowShort = false) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    await response.body?.cancel?.();
    throw userError('range', 'YouTube response could not be streamed safely.');
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedBytes) throw userError('range', 'YouTube returned more bytes than requested.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (total !== expectedBytes && !(allowShort && total < expectedBytes)) throw userError('range', `YouTube returned ${total} bytes for a ${expectedBytes} byte range.`);
  return concatBytes(chunks, total);
}


function inputName(prefix, mimeType = '') {
  if (/webm/i.test(mimeType)) return `${prefix}.webm`;
  if (/audio\//i.test(mimeType) && /mp4|m4a|mp4a/i.test(mimeType)) return `${prefix}.m4a`;
  if (/mp4/i.test(mimeType)) return `${prefix}.mp4`;
  return `${prefix}.bin`;
}

function totalProgressLength(length) {
  return length;
}

function totalPlannedBytes(plan) {
  const videoKnown = positive(plan.contentLength) || inferContentLength(plan.url);
  const audioKnown = positive(plan.audioContentLength) || inferContentLength(plan.audioUrl);
  if (plan.action === 'audio') return audioKnown || videoKnown;
  const videoLength = plan.action === 'preview' ? Math.min(CHUNK_SIZE, videoKnown || CHUNK_SIZE) : videoKnown || 0;
  const audioLength = !plan.audioUrl ? 0 : plan.action === 'preview' ? Math.min(2 * 1024 * 1024, audioKnown || 2 * 1024 * 1024) : audioKnown || 0;
  return videoLength + audioLength || undefined;
}

function inferContentLength(url) {
  if (!url) return undefined;
  try {
    const value = new URL(url).searchParams.get('clen');
    if (!value || !/^\d+$/.test(value)) return undefined;
    return positive(value);
  } catch {
    return undefined;
  }
}

function validateYouTubeUrl(url, allowedOrigins, pageOrigin) {
  const parsed = new URL(url);
  if (!isUrlAllowed(parsed, allowedOrigins, pageOrigin)) {
    throw userError('permission', `Origin is outside this job: ${parsed.origin}`);
  }
  return parsed;
}

function contentRangeMatches(contentRange, start, end, allowShort) {
  if (contentRange.startsWith(`bytes ${start}-${end}/`)) return true;
  if (!allowShort) return false;
  const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
  return Boolean(match && Number(match[1]) === start && Number(match[2]) <= end);
}

async function rejectTextResponse(response) {
  const type = response.headers.get('content-type') || '';
  if (/text\/|json|html/i.test(type)) {
    await response.body?.cancel?.();
    throw userError('type', `YouTube returned ${type || 'a non-media response'} for the selected stream.`);
  }
}

function positive(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= Number.MAX_SAFE_INTEGER ? number : undefined;
}

function userError(code, message, httpStatus) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}
