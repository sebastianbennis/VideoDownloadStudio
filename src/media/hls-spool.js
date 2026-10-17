import { readBytes } from './fetch.js';
import { decryptSegment, parseMediaPlaylist, selectPlaylist } from './hls.js';
import { extractAdts, isPackedAudio } from './packed-audio.js';
import { createMediaSpool } from './spool.js';

export const HLS_SEGMENT_LIMIT = 32 * 1024 * 1024;
const MANIFEST_LIMIT = 2 * 1024 * 1024;
const MAP_LIMIT = 4 * 1024 * 1024;
const DISK_LIMIT = 4 * 1024 * 1024 * 1024;
// A live playlist that adds no segment for this long has ended without saying so (or stalled).
const LIVE_STALL_MIN_MS = 60000;
const RETRY_PAUSES_MS = [1000, 4000, 10000];

// Returns null only before creating a spool when a VOD needs the bounded audio merge lane.
// No completed-file arrayBuffer(), Blob assembly or FFmpeg invocation belongs in this path.
export async function spoolHls(plan, signal, onProgress, options = {}) {
  const readOptions = { signal, allowedOrigins: plan.allowedOrigins, pageOrigin: plan.pageOrigin, stopRequested: options.stopRequested, retryPauses: options.retryPauses };
  const readManifest = url => readBounded(url, { ...readOptions, maxBytes: MANIFEST_LIMIT }).then(bytes => {
    const text = new TextDecoder().decode(bytes);
    if (!text.trimStart().startsWith('#EXTM3U')) throw userError('manifest', 'The HLS playlist is not valid.');
    return text;
  });
  const renewPlaylist = async () => {
    try { return await options.onRenewPlaylist(); } catch (error) {
      if (signal.aborted || error?.name === 'AbortError' || ['cancelled', 'canceled', 'abort', 'stopped'].includes(error?.code)) throw error;
      throw userError('twitch-renew', error?.message || 'The live stream could not be renewed. Saved the available recording.');
    }
  };
  let mediaUrl = plan.url;
  let text;
  try { text = await readManifest(mediaUrl); } catch (error) {
    if (!canRenew(error, options)) throw error;
    const replacement = await renewPlaylist();
    if (replacement.audioUrl) throw userError('manifest', 'Live HLS with separate audio is not supported.');
    mediaUrl = replacement.url;
    text = await readManifest(mediaUrl);
  }
  const selected = selectPlaylist(mediaUrl, text, plan.preferredHeight);
  mediaUrl = selected.url;
  let entries = parseMediaPlaylist(mediaUrl, selected.text ?? await readManifest(mediaUrl));
  if (plan.audioUrl || selected.audioUrl) {
    if (entries.live) throw userError('manifest', 'Live HLS with separate audio is not supported.');
    return null;
  }
  if (!entries.segments.length) throw userError('manifest', 'The HLS playlist had no downloadable segments.');
  const spool = await (options.createSpool || createMediaSpool)(plan.jobId);
  const keyCache = new Map();
  const decodeTimes = new Map();
  let format;
  let initBytes;
  let initId;
  let written = 0;
  let segmentCount = 0;
  let lastSequence;
  let mediaSeconds = 0;
  let partialReason;
  let maxSegmentBytes = 0;
  let renewedSinceSegment = false;
  let lastSegmentAt = Date.now();
  const maxBytes = Math.min(Number.isFinite(plan.maxBytes) ? plan.maxBytes : DISK_LIMIT, DISK_LIMIT);
  try {
    while (true) {
      let renew = false;
      for (const segment of entries.segments) {
        signal.throwIfAborted();
        if (options.stopRequested?.()) break;
        if (lastSequence !== undefined && segment.sequence <= lastSequence) continue;
        if ((lastSequence !== undefined && segment.sequence !== lastSequence + 1) || segment.gap) throw userError('gap', 'The live stream skipped a segment. Saved the available recording.');
        try {
          if (segment.map) {
            if (format === 'aac') throw userError('manifest', 'The HLS stream changed container during recording.');
            if (format === 'ts' || segment.discontinuity) throw userError('manifest', 'Changing HLS initialization or fMP4 discontinuities requires bounded conversion.');
            const id = `${segment.map.url}:${segment.map.range?.start ?? ''}:${segment.map.range?.end ?? ''}`;
            if (id !== initId) {
              if (segment.map.key) throw userError('manifest', 'Encrypted HLS initialization maps are not supported.');
              const bytes = await readBounded(segment.map.url, { ...readOptions, maxBytes: MAP_LIMIT, range: segment.map.range });
              validateInit(bytes);
              if (initBytes && !equalBytes(initBytes, bytes)) throw userError('manifest', 'Changing HLS initialization requires bounded conversion.');
              initBytes = bytes;
              initId = id;
            }
            format = 'mp4';
          } else if (format === 'mp4') throw userError('manifest', 'The HLS stream changed container during recording.');
          let bytes = await readBounded(segment.url, { ...readOptions, maxBytes: HLS_SEGMENT_LIMIT, range: segment.range });
          maxSegmentBytes = Math.max(maxSegmentBytes, bytes.byteLength);
          if (segment.key) bytes = await decryptSegment(bytes, segment, keyCache, readOptions, readBounded);
          if (segment.map) validateFragment(bytes, decodeTimes);
          else if (isPackedAudio(bytes)) {
            if (format === 'ts') throw userError('manifest', 'The HLS stream changed container during recording.');
            bytes = extractAdts(bytes);
            format = 'aac';
          } else {
            if (format === 'aac') throw userError('manifest', 'The HLS stream changed container during recording.');
            validateTs(bytes);
            format = 'ts';
          }
          const initialSize = !segmentCount && initBytes ? initBytes.byteLength : 0;
          if (written + initialSize + bytes.byteLength > maxBytes) throw userError('storage', 'The recording reached the 4 GiB disk-output limit.');
          if (initialSize) { await spool.append(initBytes); written += initialSize; }
          await spool.append(bytes);
          written += bytes.byteLength;
          segmentCount += 1;
          mediaSeconds += segment.duration;
          lastSequence = segment.sequence;
          lastSegmentAt = Date.now();
          renewedSinceSegment = false;
          onProgress({ phase: 'downloading', bytesWritten: written, mediaSeconds, maxSegmentBytes });
        } catch (error) {
          if (entries.live && !renewedSinceSegment && canRenew(error, options)) { renew = true; break; }
          throw error;
        }
      }
      if (options.stopRequested?.() || !entries.live) break;
      if (Date.now() - lastSegmentAt > (options.liveStallMs ?? Math.max(LIVE_STALL_MIN_MS, entries.targetDuration * 6000))) {
        throw userError('stalled', 'The live stream stopped adding segments. Saved the available recording.');
      }
      if (renew) {
        const replacement = await renewPlaylist();
        if (replacement.audioUrl) throw userError('manifest', 'Live HLS with separate audio is not supported.');
        mediaUrl = replacement.url;
        renewedSinceSegment = true;
      } else await waitForRefresh(Math.max(500, entries.targetDuration * 500), signal, options.stopRequested);
      if (options.stopRequested?.()) break;
      try { text = await readManifest(mediaUrl); } catch (error) {
        if (renewedSinceSegment || !canRenew(error, options)) throw error;
        const replacement = await renewPlaylist();
        if (replacement.audioUrl) throw userError('manifest', 'Live HLS with separate audio is not supported.');
        mediaUrl = replacement.url;
        renewedSinceSegment = true;
        text = await readManifest(mediaUrl);
      }
      entries = parseMediaPlaylist(mediaUrl, text);
      if (entries.segments.length && lastSequence !== undefined && entries.segments.at(-1).sequence < lastSequence) throw userError('gap', 'The live stream restarted. Saved the previous recording.');
    }
  } catch (error) {
    // A live recording cannot be fetched again, so a bad segment keeps what came before it.
    if (signal.aborted || !segmentCount || !(isPartialFailure(error) || (entries.live && error.code === 'manifest'))) { await spool.abort(); throw error; }
    partialReason = options.stopRequested?.() ? undefined : error.message;
  }
  if (signal.aborted || !segmentCount) {
    await spool.abort();
    signal.throwIfAborted();
    throw userError('manifest', 'The HLS playlist had no downloadable segments.');
  }
  try {
    const output = await spool.finish();
    return { ...output, mimeType: { ts: 'video/mp2t', aac: 'audio/aac' }[format] || 'video/mp4', extension: format,
      partial: Boolean(partialReason || options.stopRequested?.()), partialReason, maxSegmentBytes };
  } catch (error) { await spool.abort(); throw error; }
}

// A stalled CDN connection can outlast a quick retry (an X Space download once timed out twice
// in a row on one 2-second segment), so network errors, timeouts and server errors get growing pauses.
async function readBounded(url, options) {
  const pauses = options.retryPauses || RETRY_PAUSES_MS;
  for (let attempt = 0; ; attempt += 1) {
    const stopped = new AbortController();
    const timer = options.stopRequested ? setInterval(() => { if (options.stopRequested()) stopped.abort(userError('stopped', 'Recording stopped.')); }, 100) : undefined;
    try { return await readBytes(url, { ...options, signal: AbortSignal.any([options.signal, stopped.signal, AbortSignal.timeout(30000)]) }); } catch (error) {
      if (options.signal.aborted || attempt >= pauses.length || !(error instanceof TypeError || error.name === 'TimeoutError' || error.code === 'http' && error.httpStatus >= 500)) throw error;
      await waitForRefresh(pauses[attempt], options.signal, options.stopRequested);
      if (options.stopRequested?.()) throw userError('stopped', 'Recording stopped.');
    } finally { clearInterval(timer); }
  }
}

function canRenew(error, options) { return typeof options.onRenewPlaylist === 'function' && error.code === 'http' && [401, 403, 404, 410].includes(error.httpStatus); }
function isPartialFailure(error) { return ['http', 'storage', 'gap', 'network', 'twitch-renew', 'stopped', 'stalled'].includes(error.code) || error instanceof TypeError || error.name === 'TimeoutError'; }
function userError(code, message) { return Object.assign(new Error(message), { code }); }
function equalBytes(a, b) { return a.length === b.length && a.every((byte, index) => byte === b[index]); }

function validateTs(bytes) {
  if (!bytes.length || bytes.length % 188) throw userError('manifest', 'The HLS segment is not a complete MPEG-TS stream.');
  for (let offset = 0; offset < bytes.length; offset += 188) if (bytes[offset] !== 0x47) throw userError('manifest', 'The HLS segment is not a valid MPEG-TS stream.');
}

function boxes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = [];
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw userError('manifest', 'The HLS MP4 segment is truncated.');
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let header = 8;
    if (size === 1) { if (offset + 16 > bytes.length) throw userError('manifest', 'The HLS MP4 box is truncated.'); size = Number(view.getBigUint64(offset + 8)); header = 16; }
    if (size === 0) size = bytes.length - offset;
    if (!Number.isSafeInteger(size) || size < header || offset + size > bytes.length) throw userError('manifest', 'The HLS MP4 segment is truncated.');
    result.push({ type, data: bytes.subarray(offset + header, offset + size) });
    offset += size;
  }
  return result;
}

function validateInit(bytes) {
  const entries = boxes(bytes);
  if (!entries.some(box => box.type === 'ftyp') || !entries.some(box => box.type === 'moov')) throw userError('manifest', 'The HLS initialization is not a complete MP4 file.');
  const text = new TextDecoder('latin1').decode(bytes);
  if (text.includes('encv') || text.includes('enca') || text.includes('pssh')) throw userError('unsupported-drm', 'Encrypted MP4 tracks are not supported.');
}

function validateFragment(bytes, decodeTimes) {
  const entries = boxes(bytes);
  if (entries.some(box => ['moov', 'ftyp'].includes(box.type)) || !entries.some(box => box.type === 'moof') || !entries.some(box => box.type === 'mdat' && box.data.length)) throw userError('manifest', 'The HLS segment is not a complete fragmented MP4 segment.');
  const updates = new Map(decodeTimes);
  for (const moof of entries.filter(box => box.type === 'moof')) {
    for (const traf of boxes(moof.data).filter(box => box.type === 'traf')) {
      const children = boxes(traf.data);
      const tfhd = children.find(box => box.type === 'tfhd')?.data;
      const tfdt = children.find(box => box.type === 'tfdt')?.data;
      if (!tfhd || tfhd.length < 8 || !tfdt || tfdt.length < (tfdt[0] === 1 ? 12 : 8)) throw userError('manifest', 'The HLS fragment lacks a safe decoding timeline.');
      const track = new DataView(tfhd.buffer, tfhd.byteOffset, tfhd.length).getUint32(4);
      const view = new DataView(tfdt.buffer, tfdt.byteOffset, tfdt.length);
      const time = tfdt[0] === 1 ? view.getBigUint64(4) : BigInt(view.getUint32(4));
      if (updates.has(track) && time <= updates.get(track)) throw userError('manifest', 'The HLS decoding timeline restarted and requires bounded conversion.');
      updates.set(track, time);
    }
  }
  if (!updates.size) throw userError('manifest', 'The HLS fragment has no decodable track timeline.');
  for (const [track, time] of updates) decodeTimes.set(track, time);
}

async function waitForRefresh(ms, signal, stopRequested) {
  const until = Date.now() + Math.min(ms, 30000);
  while (Date.now() < until && !stopRequested?.()) {
    signal.throwIfAborted();
    await new Promise(resolve => setTimeout(resolve, Math.min(100, until - Date.now())));
  }
  signal.throwIfAborted();
}
