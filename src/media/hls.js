import { concatBytes, makeByteBudget, readBytes, resolveRelative } from './fetch.js';
import { extractAdts, isPackedAudio } from './packed-audio.js';

export async function readHls(plan, signal, onProgress, options = {}) {
  const budget = makeByteBudget(plan.maxBytes);
  const readOptions = { signal, allowedOrigins: plan.allowedOrigins, pageOrigin: plan.pageOrigin, budget };
  const playlistText = new TextDecoder().decode(await readBytes(plan.url, readOptions));
  if (!playlistText.includes('#EXTM3U')) throw userError('manifest', 'The HLS playlist is not valid.');
  const selected = selectPlaylist(plan.url, playlistText, plan.preferredHeight);
  const mediaUrl = selected.url;
  let mediaText = selected.text ?? new TextDecoder().decode(await readBytes(mediaUrl, readOptions));
  const selectedAudioUrl = plan.audioUrl || selected.audioUrl;
  if (selectedAudioUrl && parseMediaPlaylist(mediaUrl, mediaText).live) throw userError('manifest', 'Live HLS with separate audio is not supported.');
  const video = await readHlsMedia(mediaUrl, mediaText, plan, readOptions, signal, onProgress, options);
  if (!selectedAudioUrl) return video;
  const audioText = new TextDecoder().decode(await readBytes(selectedAudioUrl, readOptions));
  const audio = await readHlsMedia(selectedAudioUrl, audioText, plan, readOptions, signal, onProgress, options, video.byteLength);
  return [
    { name: looksLikeMp4(video) ? 'video.mp4' : 'video.ts', data: video, mimeType: looksLikeMp4(video) ? 'video/mp4' : 'video/mp2t', type: 'video' },
    { name: looksLikeMp4(audio) ? 'audio.mp4' : 'audio.ts', data: audio, mimeType: looksLikeMp4(audio) ? 'audio/mp4' : 'video/mp2t', type: 'audio' }
  ];
}

async function readHlsMedia(mediaUrl, mediaText, plan, readOptions, signal, onProgress, options, progressOffset = 0) {
  let currentEntries = parseMediaPlaylist(mediaUrl, mediaText);
  const chunks = [];
  let written = 0;
  const keyCache = new Map();
  const fetchedMaps = new Set();
  const seenSegments = new Set();
  while (true) {
    for (const segment of currentEntries.segments) {
      if (signal.aborted) throw userError('cancelled', 'Download cancelled.');
      if (options.stopRequested?.()) break;
      // MPEG-TS segments carry their own timestamps and remux across a discontinuity (Twitch highlights
      // re-encode their first and last segment); fMP4 may switch init segments, so it stays refused.
      if (segment.discontinuity && segment.map) throw userError('manifest', 'HLS discontinuities are not supported safely yet.');
      const key = `${segment.url}:${segment.range?.start ?? ''}:${segment.range?.end ?? ''}`;
      if (seenSegments.has(key)) continue;
      seenSegments.add(key);
      if (segment.map?.url) await appendMap(segment.map, fetchedMaps, chunks, readOptions, (bytes) => { written += bytes; });
      let bytes = await readBytes(segment.url, { ...readOptions, range: segment.range });
      if (segment.key) bytes = await decryptSegment(bytes, segment, keyCache, readOptions);
      // Packed audio joins into one ADTS stream only without its ID3 tags.
      if (!segment.map && isPackedAudio(bytes)) bytes = extractAdts(bytes);
      chunks.push(bytes);
      written += bytes.byteLength;
      onProgress({ phase: 'downloading', bytesWritten: progressOffset + written, mediaSeconds: seenSegments.size });
      if (plan.action === 'preview' && (written >= 24 * 1024 * 1024 || seenSegments.size >= 8)) break;
    }
    if (options.stopRequested?.() || plan.action === 'preview' || !currentEntries.live) break;
    await delay(Math.max(500, currentEntries.targetDuration * 500), signal);
    mediaText = new TextDecoder().decode(await readBytes(mediaUrl, readOptions));
    currentEntries = parseMediaPlaylist(mediaUrl, mediaText);
  }
  if (!chunks.length) throw userError('manifest', 'The HLS playlist had no downloadable segments.');
  return concatBytes(chunks, written);
}

export function selectPlaylist(masterUrl, text, preferredHeight = 1080) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const audioGroups = new Map();
  const variants = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = parseAttributes(line);
      if (attrs.TYPE === 'AUDIO' && attrs['GROUP-ID'] && attrs.URI) {
        audioGroups.set(attrs['GROUP-ID'], resolveHlsRelative(masterUrl, attrs.URI));
      }
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('#EXT-X-STREAM-INF')) continue;
    const attrs = parseAttributes(lines[index]);
    const next = lines[index + 1];
    if (!next || next.startsWith('#')) continue;
    // Quality is the short side, as in shared/media-variants.js: 720x1280 portrait is 720p.
    const [width, tall] = (attrs.RESOLUTION || '').split('x').map(Number);
    const height = width > 0 && tall > 0 ? Math.min(width, tall) : tall || 0;
    variants.push({
      url: resolveHlsRelative(masterUrl, next),
      audioUrl: attrs.AUDIO ? audioGroups.get(attrs.AUDIO) : undefined,
      height,
      bandwidth: Number(attrs.BANDWIDTH || 0),
      videoRank: height || /avc|hev|hvc|vp0?[89]|av01|theora/i.test(attrs.CODECS || '') ? 0 : /mp4a|opus|vorbis|aac|ac-3|ec-3/i.test(attrs.CODECS || '') || attrs.VIDEO === 'audio_only' ? 2 : 1
    });
  }
  if (!variants.length) return { url: masterUrl, text };
  variants.sort((a, b) => {
    if (a.videoRank !== b.videoRank) return a.videoRank - b.videoRank;
    const aOver = a.height && a.height > preferredHeight ? 1 : 0;
    const bOver = b.height && b.height > preferredHeight ? 1 : 0;
    if (aOver !== bOver) return aOver - bOver;
    const aScore = Math.abs((a.height || preferredHeight) - preferredHeight);
    const bScore = Math.abs((b.height || preferredHeight) - preferredHeight);
    return aScore - bScore || (b.bandwidth || 0) - (a.bandwidth || 0);
  });
  const { videoRank, ...selected } = variants[0];
  return selected;
}

// Loom signs a path-wide CloudFront policy on the master, but its relative HLS children
// omit the query. Carry only those three credentials within the same known CDN origin.
export function resolveHlsRelative(baseUrl, value) {
  const resolved = resolveRelative(baseUrl, value);
  const parent = new URL(baseUrl);
  const child = new URL(resolved);
  const keys = ['Policy', 'Signature', 'Key-Pair-Id'];
  if (parent.protocol === 'https:' && !parent.username && !parent.password && ['luna.loom.com', 'cdn.loom.com'].includes(parent.hostname)
    && child.origin === parent.origin && !child.username && !child.password && keys.every(key => parent.searchParams.has(key)) && keys.every(key => !child.searchParams.has(key))) {
    for (const key of keys) child.searchParams.set(key, parent.searchParams.get(key));
  }
  return child.href;
}

export function parseMediaPlaylist(playlistUrl, text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const segments = [];
  let currentRange;
  let currentMap;
  let currentKey;
  let mediaSequence = 0;
  let targetDuration = 2;
  let ended = false;
  let discontinuityNext = false;
  let duration = 0;
  let gap = false;
  const rangeOffsets = new Map();
  let segmentIndex = 0;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Number(line.split(':')[1]);
      if (!Number.isSafeInteger(mediaSequence) || mediaSequence < 0) throw userError('manifest', 'The HLS media sequence is invalid.');
    }
    else if (line.startsWith('#EXT-X-TARGETDURATION')) targetDuration = Number(line.split(':')[1] || 2) || 2;
    else if (line.startsWith('#EXT-X-ENDLIST')) ended = true;
    else if (line === '#EXT-X-DISCONTINUITY') discontinuityNext = true;
    else if (line.startsWith('#EXTINF:')) duration = Number.parseFloat(line.slice(8)) || 0;
    else if (line === '#EXT-X-GAP') gap = true;
    else if (line.startsWith('#EXT-X-BYTERANGE')) currentRange = parseByteRange(line.split(':')[1]);
    else if (line.startsWith('#EXT-X-MAP')) {
      const attrs = parseAttributes(line);
      if (!attrs.URI) throw userError('manifest', 'HLS map is missing a URI.');
      const url = resolveHlsRelative(playlistUrl, attrs.URI);
      currentMap = { url, key: currentKey, range: attrs.BYTERANGE ? resolveRange(url, parseByteRange(attrs.BYTERANGE), rangeOffsets) : undefined };
    } else if (line.startsWith('#EXT-X-KEY')) {
      const attrs = parseAttributes(line);
      currentKey = parseKey(attrs, playlistUrl);
    } else if (!line.startsWith('#')) {
      const url = resolveHlsRelative(playlistUrl, line);
      const range = resolveRange(url, currentRange, rangeOffsets);
      segments.push({
        url,
        range,
        map: currentMap,
        key: currentKey,
        discontinuity: discontinuityNext,
        sequence: mediaSequence + segmentIndex,
        duration,
        gap
      });
      segmentIndex += 1;
      currentRange = undefined;
      discontinuityNext = false;
      duration = 0;
      gap = false;
    }
  }
  return { mediaSequence, targetDuration, live: !ended, segments };
}

export function parseAttributes(line) {
  const text = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line;
  const attrs = {};
  for (const part of text.match(/(?:[^,"]+|"[^"]*")+/g) || []) {
    const index = part.indexOf('=');
    if (index > 0) attrs[part.slice(0, index)] = stripQuotes(part.slice(index + 1));
  }
  return attrs;
}

function parseByteRange(value) {
  const [length, start] = String(value || '').split('@').map(Number);
  if (!Number.isFinite(length)) return undefined;
  return { length, start: Number.isFinite(start) ? start : undefined };
}

function stripQuotes(value) {
  return String(value || '').replace(/^"|"$/g, '');
}

function sequenceIv(sequence) {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, sequence);
  return iv;
}

function hexIv(value) {
  const hex = value.replace(/^0x/i, '').padStart(32, '0');
  const out = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
}

async function decryptAes128(bytes, key, iv) {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, bytes);
  return new Uint8Array(decrypted);
}

async function appendMap(map, fetchedMaps, chunks, readOptions, onBytes) {
  const id = `${map.url}:${map.range?.start ?? ''}:${map.range?.end ?? ''}`;
  if (fetchedMaps.has(id)) return;
  if (map.key) throw userError('manifest', 'Encrypted HLS initialization maps are not supported.');
  const bytes = await readBytes(map.url, { ...readOptions, range: map.range });
  chunks.push(bytes);
  fetchedMaps.add(id);
  onBytes(bytes.byteLength);
}

export async function decryptSegment(bytes, segment, keyCache, readOptions, read = readBytes) {
  if (segment.key.method !== 'AES-128') throw userError('unsupported-drm', `Unsupported HLS encryption method: ${segment.key.method}`);
  if (!segment.key.url) throw userError('manifest', 'HLS AES-128 key is missing a URI.');
  let key = keyCache.get(segment.key.url);
  if (!key) {
    const keyBytes = await read(segment.key.url, { ...readOptions, maxBytes: 16 });
    if (keyBytes.byteLength !== 16) throw userError('manifest', 'HLS AES-128 key must be exactly 16 bytes.');
    key = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['decrypt']);
    keyCache.set(segment.key.url, key);
    if (keyCache.size > 8) keyCache.delete(keyCache.keys().next().value);
  }
  return decryptAes128(bytes, key, segment.key.iv || sequenceIv(segment.sequence));
}

function parseKey(attrs, playlistUrl) {
  if (!attrs.METHOD || attrs.METHOD === 'NONE') return undefined;
  if (attrs.KEYFORMAT && attrs.KEYFORMAT !== 'identity') return { method: 'unsupported-key-format' };
  if (attrs.METHOD !== 'AES-128') return { method: attrs.METHOD };
  return {
    method: attrs.METHOD,
    url: attrs.URI ? resolveHlsRelative(playlistUrl, attrs.URI) : undefined,
    iv: attrs.IV ? hexIv(attrs.IV) : undefined
  };
}

function resolveRange(url, range, rangeOffsets) {
  if (!range) return undefined;
  const start = range.start ?? rangeOffsets.get(url) ?? 0;
  const end = start + range.length - 1;
  rangeOffsets.set(url, end + 1);
  return { start, end };
}

function looksLikeMp4(bytes) {
  return bytes?.[4] === 0x66 && bytes?.[5] === 0x74 && bytes?.[6] === 0x79 && bytes?.[7] === 0x70;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(userError('cancelled', 'Download cancelled.'));
    }, { once: true });
  });
}

function userError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
