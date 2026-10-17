import { spoolDirect } from './spool.js';
import { makeByteBudget, readBytes } from './fetch.js';
import { readHls } from './hls.js';
import { spoolHls } from './hls-spool.js';
import { isPackedAudio } from './packed-audio.js';
import { readDash } from './dash.js';
import { processMedia } from './engine.js';
import { readYouTubeInputs } from './youtube-ranges.js';

export async function runDownload(plan, signal, onProgress, options = {}) {
  onProgress({ phase: 'downloading', bytesWritten: 0 });
  if (plan.adapterId === 'youtube' && plan.kind === 'sabr') {
    const { readYouTubeSabrInputs } = await import('./youtube-sabr.bundle.js');
    const inputs = await readYouTubeSabrInputs(plan, signal, (bytesWritten, totalBytes) => onProgress({ phase: 'downloading', bytesWritten, totalBytes }), options);
    const bytes = await processMedia({
      inputs,
      action: mediaActionFor(plan),
      container: plan.outputContainer,
      signal,
      onProgress: (progress) => onProgress({ phase: 'processing', ...progress })
    });
    return {
      id: `lease-${plan.jobId}`,
      jobId: plan.jobId,
      filename: plan.filename,
      bytes: bytes.byteLength,
      partial: Boolean(options.stopRequested?.()),
      mimeType: mimeFor(plan),
      extension: extensionFor(plan),
      data: bytes
    };
  }
  if (plan.adapterId === 'youtube' && plan.kind === 'direct') {
    const inputs = await readYouTubeInputs(plan, signal, (bytesWritten, totalBytes) => onProgress({ phase: 'downloading', bytesWritten, totalBytes }));
    const bytes = await processMedia({
      inputs,
      action: mediaActionFor(plan),
      container: plan.outputContainer,
      signal,
      onProgress: (progress) => onProgress({ phase: 'processing', ...progress })
    });
    return {
      id: `lease-${plan.jobId}`,
      jobId: plan.jobId,
      filename: plan.filename,
      bytes: bytes.byteLength,
      partial: Boolean(options.stopRequested?.()),
      mimeType: mimeFor(plan),
      extension: extensionFor(plan),
      data: bytes
    };
  }
  if (plan.kind === 'direct' && !plan.audioUrl && ['download', 'download-as'].includes(plan.action)) {
    const output = await spoolDirect(plan, signal, onProgress);
    return { id: `lease-${plan.jobId}`, jobId: plan.jobId, filename: plan.filename, partial: false, ...output };
  }
  if (plan.kind === 'direct' && plan.audioUrl && plan.action === 'audio') {
    const budget = makeByteBudget(plan.maxBytes);
    let bytes = await readBytes(plan.audioUrl, {
      signal,
      allowedOrigins: plan.allowedOrigins,
      pageOrigin: plan.pageOrigin,
      budget,
      onChunk: (bytesWritten, totalBytes) => onProgress({ phase: 'downloading', bytesWritten, totalBytes })
    });
    bytes = await processMedia({
      inputs: [{ name: 'audio', data: bytes, mimeType: plan.audioMimeType }],
      action: mediaActionFor(plan),
      container: plan.outputContainer,
      signal,
      onProgress: (progress) => onProgress({ phase: 'processing', ...progress })
    });
    return {
      id: `lease-${plan.jobId}`,
      jobId: plan.jobId,
      filename: plan.filename,
      bytes: bytes.byteLength,
      partial: Boolean(options.stopRequested?.()),
      mimeType: mimeFor(plan),
      extension: extensionFor(plan),
      data: bytes
    };
  }
  if (plan.kind === 'hls') {
    if (plan.hlsNativeOutput && ['download', 'download-as'].includes(plan.action) && !plan.privateContext && globalThis.navigator?.storage?.getDirectory) {
      const output = await spoolHls(plan, signal, onProgress, options);
      if (output) return { id: `lease-${plan.jobId}`, jobId: plan.jobId, filename: plan.filename, ...output };
    }
    plan = { ...plan, maxBytes: Math.min(plan.maxBytes || 512 * 1024 * 1024, 512 * 1024 * 1024) };
  }
  let bytes;
  const directBudget = makeByteBudget(plan.maxBytes);
  if (plan.kind === 'direct') {
    const maxBytes = plan.maxBytes;
    const budget = directBudget;
    bytes = await readBytes(plan.url, {
      signal,
      allowedOrigins: plan.allowedOrigins,
      pageOrigin: plan.pageOrigin,
      maxBytes,
      budget,
      onChunk: (bytesWritten, totalBytes) => onProgress({ phase: 'downloading', bytesWritten, totalBytes })
    });
  } else if (plan.kind === 'hls') {
    bytes = await readHls(plan, signal, onProgress, options);
  } else if (plan.kind === 'dash') {
    bytes = await readDash(plan, signal, onProgress, options);
  } else {
    throw userError('manifest', `Unsupported media kind: ${plan.kind}`);
  }
  if (plan.kind === 'dash' || (plan.kind === 'hls' && Array.isArray(bytes))) {
    const inputs = Array.isArray(bytes) ? bytes : [{ name: 'input.mp4', data: bytes, mimeType: 'video/mp4' }];
    bytes = await processMedia({
      inputs,
      action: mediaActionFor(plan),
      container: plan.outputContainer,
      signal,
      onProgress: (progress) => onProgress({ phase: 'processing', ...progress })
    });
  } else if (plan.audioUrl) {
    if (plan.kind !== 'direct') throw userError('codec', 'Separate audio is only supported for direct media plans in this lane.');
    const audioBytes = await readBytes(plan.audioUrl, {
      signal,
      allowedOrigins: plan.allowedOrigins,
      pageOrigin: plan.pageOrigin,
      budget: directBudget,
      onChunk: (bytesWritten, totalBytes) => onProgress({ phase: 'downloading', bytesWritten, totalBytes })
    });
    bytes = await processMedia({
      inputs: [
        { name: 'video', data: bytes },
        { name: 'audio', data: audioBytes }
      ],
      action: mediaActionFor(plan),
      container: plan.outputContainer,
      signal,
      onProgress: (progress) => onProgress({ phase: 'processing', ...progress })
    });
  } else if (plan.action === 'audio' || plan.action === 'preview' || (plan.kind !== 'direct' && plan.action !== 'preview')) {
    bytes = await processMedia({
      inputs: [{ name: inputNameFor(plan, bytes), data: bytes, mimeType: mimeFor(plan) }],
      action: mediaActionFor(plan),
      container: plan.outputContainer,
      signal,
      onProgress: (progress) => onProgress({ phase: 'processing', ...progress })
    });
  }
  return {
    id: `lease-${plan.jobId}`,
    jobId: plan.jobId,
    filename: plan.filename,
    bytes: bytes.byteLength,
    partial: Boolean(options.stopRequested?.()),
    mimeType: mimeFor(plan),
    extension: extensionFor(plan),
    data: bytes
  };
}

function mediaActionFor(plan) {
  if (plan.action === 'audio') return 'audio';
  if (plan.action === 'preview') return 'preview';
  return 'remux';
}

export function releaseOutput() { return false; }

function mimeFor(plan) {
  if (plan.action === 'audio') return 'audio/mpeg';
  if (plan.outputContainer === 'ts') return 'video/mp2t';
  if (plan.outputContainer === 'mkv') return 'video/x-matroska';
  if (plan.outputContainer === 'webm') return 'video/webm';
  if (plan.outputContainer === 'mp3') return 'audio/mpeg';
  return 'video/mp4';
}

function extensionFor(plan) {
  if (plan.action === 'audio' || plan.outputContainer === 'mp3') return 'mp3';
  if (plan.outputContainer === 'ts') return 'ts';
  if (plan.outputContainer === 'mkv') return 'mkv';
  if (plan.outputContainer === 'webm') return 'webm';
  return 'mp4';
}

function inputNameFor(plan, bytes) {
  if (plan.kind === 'hls') return looksLikeMp4(bytes) ? 'input.mp4' : isPackedAudio(bytes) ? 'input.aac' : 'input.ts';
  if (plan.kind === 'dash') return 'input.mp4';
  return plan.filename;
}

function looksLikeMp4(bytes) {
  return bytes?.[4] === 0x66 && bytes?.[5] === 0x74 && bytes?.[6] === 0x79 && bytes?.[7] === 0x70;
}

function userError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
