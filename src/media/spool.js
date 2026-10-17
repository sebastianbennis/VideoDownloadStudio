import { fetchResource } from './fetch.js';
import { classifyMedia } from './type.js';
const DIRECTORY = 'videodownloadstudio-jobs';
export async function spoolDirect(plan, signal, onProgress) {
  if (!navigator.storage?.getDirectory || plan.privateContext) {
    const response = await fetchResource(plan.url, { signal, allowedOrigins: plan.allowedOrigins, pageOrigin: plan.pageOrigin, maxBytes: Math.min(plan.maxBytes, 512*1024*1024) });
    const totalBytes = +response.headers.get('content-length') || undefined;
    const data = await readBytesFromResponse(response, { maxBytes: Math.min(plan.maxBytes, 512*1024*1024), totalBytes, onChunk: (bytesWritten, size) => onProgress({ phase:'downloading', bytesWritten,totalBytes:size }) });
    return { data, bytes: data.byteLength, ...classifyMedia({ contentType: response.headers.get('content-type') || '', url: plan.url, sample: data.subarray(0, 512) }) };
  }
  const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIRECTORY, { create: true });
  const name = spoolName(plan.jobId);
  const file = await directory.getFileHandle(name, { create: true });
  const sink = await file.createWritable();
  let reader;
  let bytes = 0;
  const sampleChunks = [];
  let sampleBytes = 0;
  let classification;
  try {
    const response = await fetchResource(plan.url, { signal, allowedOrigins: plan.allowedOrigins, pageOrigin: plan.pageOrigin, maxBytes: plan.maxBytes });
    const totalBytes = +response.headers.get('content-length') || undefined;
    reader = response.body.getReader();
    let last = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > plan.maxBytes) throw new Error('The file exceeds the 4 GiB direct-download limit.');
      if (sampleBytes < 512) {
        const slice = result.value.subarray(0, Math.min(result.value.byteLength, 512 - sampleBytes));
        sampleChunks.push(slice);
        sampleBytes += slice.byteLength;
      }
      await sink.write(result.value);
      if (Date.now() - last > 150) { onProgress({phase:'downloading',bytesWritten:bytes,totalBytes}); last=Date.now(); }
    }
    classification = classifyMedia({ contentType: response.headers.get('content-type') || '', url: plan.url, sample: concatSample(sampleChunks, sampleBytes) });
    await sink.close();
    onProgress({phase:'downloading',bytesWritten:bytes,totalBytes});
    return { data: await file.getFile(), bytes, spoolName: name, ...classification };
  } catch (error) {
    await sink.abort().catch(() => {});
    await directory.removeEntry(name).catch(() => {});
    throw error;
  } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
}
export async function releaseSpool(name) {
  if (!/^job-[a-z0-9-]+\.media$/.test(name || '')) return;
  try { const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIRECTORY); await directory.removeEntry(name); } catch {}
}
export function spoolName(jobId) { if (!/^job-[a-z0-9-]+$/.test(jobId)) throw new Error('Invalid media job ID.'); return `${jobId}.media`; }
export async function sweepSpools() {
  try { const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIRECTORY); for await (const [name] of directory.entries()) await releaseSpool(name); } catch {}
}

async function readBytesFromResponse(response, options) {
  const data = await readBytesFromStream(response.body, options);
  if (data) return data;
  return new Uint8Array(await response.arrayBuffer());
}

async function readBytesFromStream(body, options) {
  const reader = body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (options.maxBytes && total > options.maxBytes) throw new Error('Response exceeded the allowed byte limit.');
      chunks.push(value);
      options.onChunk?.(total, options.totalBytes);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

function concatSample(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// A native-media lease writes each validated segment once. The dedicated media worker uses
// synchronous OPFS handles so a failed append can retain the previously flushed segments.
export async function createMediaSpool(jobId) {
  const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIRECTORY, { create: true });
  const name = spoolName(jobId);
  const file = await directory.getFileHandle(name, { create: true });
  let sync;
  let writer;
  try {
    sync = typeof file.createSyncAccessHandle === 'function' ? await file.createSyncAccessHandle() : null;
    writer = sync || await file.createWritable();
    if (sync) sync.truncate(0);
  } catch (cause) {
    try { await writer?.close(); } catch {}
    await directory.removeEntry(name).catch(() => {});
    throw Object.assign(new Error('The disk recording could not be opened.', { cause }), { code: 'storage' });
  }
  let bytes = 0;
  let closed = false;
  return {
    async append(data) {
      if (closed) throw new Error('Media spool is closed.');
      const start = bytes;
      try {
        if (sync) {
          let offset = 0;
          while (offset < data.byteLength) {
            const count = sync.write(data.subarray(offset), { at: start + offset });
            if (!count) throw new Error('The disk could not accept another media segment.');
            offset += count;
          }
          sync.flush();
        } else await writer.write(data);
        bytes += data.byteLength;
      } catch (cause) {
        try { if (sync) { sync.truncate(start); sync.flush(); } else { await writer.truncate(start); await writer.seek(start); } } catch (rollbackError) {
          throw Object.assign(new Error('Storage failed and the previous recording could not be recovered safely.', { cause: rollbackError }), { code: 'storage-fatal' });
        }
        throw Object.assign(new Error('Storage is full or unavailable. The recording stopped.', { cause }), { code: 'storage' });
      }
    },
    async finish() {
      if (!closed) { if (sync) { sync.truncate(bytes); sync.flush(); } await writer.close(); closed = true; }
      const data = await file.getFile();
      if (data.size !== bytes) throw Object.assign(new Error('The saved media size does not match its completed segments.'), { code: 'storage-fatal' });
      return { data, bytes, spoolName: name };
    },
    async abort() {
      if (!closed) { try { if (sync) sync.close(); else await writer.abort(); } catch {} closed = true; }
      await directory.removeEntry(name).catch(() => {});
    }
  };
}
