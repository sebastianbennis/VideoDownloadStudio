import { isUrlAllowed } from '../../media/fetch.js';

const ID = /^v[0-9a-z]{2,15}$/;
const cache = new Map();
const TTL = 30 * 60 * 1000;
export default { networkItems, resolve };

export function networkItems(details, { mediaLike } = {}) {
  return mediaLike ? null : undefined;
}

export function metadataUrl(id) {
  return `https://rumble.com/embedJS/u3/?request=video&ver=2&v=${id}`;
}

export async function resolve(request, { allowedOrigins = [] } = {}) {
  const ids = request?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 8 || !ids.every(id => typeof id === 'string' && ID.test(id))) {
    throw new Error('Malformed Rumble video request.');
  }
  if (!isUrlAllowed(metadataUrl(ids[0]), allowedOrigins)) throw new Error('Allow access to rumble.com to list Rumble videos.');
  const items = [];
  for (const id of new Set(ids)) {
    const cached = cache.get(id);
    if (cached && Date.now() - cached.at < TTL && cached.item.variants.every(v => isUrlAllowed(v.url, allowedOrigins))) {
      items.push(cached.item);
      continue;
    }
    const response = await fetch(metadataUrl(id), { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) continue;
    const item = parseVideo(await response.json());
    if (!item) continue;
    // Only player-owned media hosts are accepted, and each must be granted by the user.
    item.variants = item.variants.filter(v => isUrlAllowed(v.url, allowedOrigins));
    if (!item.variants.length) continue;
    const best = item.variants[0];
    Object.assign(item, { url: best.url, kind: best.kind, mimeType: best.mimeType, width: best.width, height: best.height });
    if (!item.live) {
      cache.delete(id);
      cache.set(id, { at: Date.now(), item });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
    }
    items.push(item);
  }
  return items;
}

export function parseVideo(data) {
  if (!data || typeof data !== 'object' || data.error || data.live === 1) return null;
  const duration = positive(data.duration);
  const variants = [];
  const seen = new Set();
  // tar duplicates HLS, timeline is a silent scrubbing preview and audio has no video.
  for (const format of data.live === 2 ? ['hls'] : ['mp4', 'webm', 'hls']) {
    const entries = data.ua?.[format];
    if (!entries || typeof entries !== 'object') continue;
    for (const [quality, entry] of Object.entries(entries)) {
      const url = mediaUrl(entry?.url);
      if (!url || seen.has(url)) continue;
      const extension = new URL(url).pathname.match(/\.(mp4|webm|m3u8)$/i)?.[1]?.toLowerCase();
      if (extension !== (format === 'hls' ? 'm3u8' : format)) continue;
      seen.add(url);
      const meta = entry.meta || {};
      const height = positive(meta.h) || positive(quality);
      const hls = format === 'hls';
      variants.push({
        id: `${format}-${height || variants.length}`, url, kind: hls ? 'hls' : 'direct',
        mimeType: hls ? 'application/x-mpegURL' : `video/${format}`, container: format === 'webm' ? 'webm' : 'mp4',
        width: positive(meta.w), height, bitrate: positive(meta.bitrate) ? Number(meta.bitrate) * 1000 : undefined,
        contentLength: positive(meta.size), fps: positive(data.fps), duration,
        hasAudio: true, hasVideo: true
      });
    }
  }
  variants.sort((a, b) => (b.height || 0) - (a.height || 0) || (a.kind === 'direct' ? 0 : 1) - (b.kind === 'direct' ? 0 : 1) || (b.bitrate || 0) - (a.bitrate || 0));
  if (!variants.length) return null;
  const best = variants[0];
  return {
    url: best.url, title: decodeTitle(data.title), author: typeof data.author?.name === 'string' ? data.author.name.trim() : undefined,
    thumbnail: mediaUrl(data.i) || undefined, kind: best.kind, mimeType: best.mimeType,
    width: best.width, height: best.height, duration: data.live === 2 ? undefined : duration,
    live: data.live === 2, variants
  };
}

function mediaUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !/(^|\.)(rumble\.cloud|rumble\.com|rmbl\.ws|1a-1791\.com)$/.test(url.hostname)) return '';
    return url.href;
  } catch { return ''; }
}
function positive(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : undefined; }
function decodeTitle(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/&(?:amp|quot|apos|lt|gt);|&#(?:\d+|x[0-9a-f]+);/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const number = /^&#x/i.test(entity) ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  }).trim();
}
