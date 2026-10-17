import { readBytes } from '../media/fetch.js';
import { parseAttributes } from '../media/hls.js';
import { dashVariants } from '../media/dash.js';
import { normalizeVariants } from '../shared/media-variants.js';

export async function discoverManifestVariants(candidate, allowedOrigins) {
  if (!['hls', 'dash'].includes(candidate.kind) || candidate.variants?.length) return candidate;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const bytes = await readBytes(candidate.url, { allowedOrigins, pageOrigin: candidate.pageOrigin, signal: controller.signal, maxBytes: 1024 * 1024 });
    const text = new TextDecoder().decode(bytes);
    if (manifestProtected(candidate.kind, text)) return { ...candidate, protection: 'unsupported-drm' };
    const variants = candidate.kind === 'dash' ? dashVariants(candidate.url, text) : hlsVariants(candidate.url, text);
    return { ...candidate, variants: normalizeVariants(variants), route: candidate.kind === 'dash' ? 'DASH' : 'HLS' };
  } catch { return candidate; }
  finally { clearTimeout(timer); }
}

// DRM shows in the manifest itself: DASH ContentProtection, or HLS keys for SAMPLE-AES or a key
// system (FairPlay skd://, Widevine, PlayReady). Plain AES-128 HLS is not DRM and downloads.
export function manifestProtected(kind, text) {
  if (kind === 'dash') return /<(?:\w+:)?ContentProtection\b/.test(text);
  return /^#EXT-X-(?:SESSION-)?KEY:(?=.*METHOD=(?:SAMPLE-AES|ISO-23001-7)|.*URI="skd:|.*KEYFORMAT="(?:com\.apple\.streamingkeydelivery|com\.microsoft\.playready|urn:uuid:))/im.test(text);
}

export function hlsVariants(url, text) {
  if (!text.trimStart().startsWith('#EXTM3U')) return [];
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const groups = new Map();
  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const attrs = parseAttributes(line);
    if (attrs.TYPE !== 'AUDIO' || !attrs.URI || !attrs['GROUP-ID']) continue;
    if (!groups.has(attrs['GROUP-ID']) || attrs.DEFAULT === 'YES') groups.set(attrs['GROUP-ID'], attrs);
  }
  const variants = [];
  for (let index = 0; index < lines.length && variants.length < 200; index++) {
    if (!lines[index].startsWith('#EXT-X-STREAM-INF:') || !lines[index + 1] || lines[index + 1].startsWith('#')) continue;
    const attrs = parseAttributes(lines[index]);
    const [width, height] = (attrs.RESOLUTION || '').split('x').map(Number);
    const audio = groups.get(attrs.AUDIO);
    try {
      variants.push({ id: `hls-${variants.length}`, kind: 'hls', url: new URL(lines[index + 1], url).href,
        audioUrl: audio ? new URL(audio.URI, url).href : undefined,
        audioLanguage: audio?.LANGUAGE, container: 'mp4', mimeType: 'application/vnd.apple.mpegurl',
        width, height, hasVideo: Boolean(width || height) || !/^(?:mp4a[.\w-]*|aac|ac-3|ec-3|opus|vorbis)(?:\s*,\s*(?:mp4a[.\w-]*|aac|ac-3|ec-3|opus|vorbis))*$/i.test(attrs.CODECS || ''), codecs: attrs.CODECS, fps: Number(attrs['FRAME-RATE']), bitrate: Number(attrs['AVERAGE-BANDWIDTH'] || attrs.BANDWIDTH) });
    } catch { /* Ignore malformed individual playlist entries. */ }
  }
  return variants;
}
