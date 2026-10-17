import { isUrlAllowed } from '../../media/fetch.js';

const cache = new Map();
const TTL = 10 * 60 * 1000;
export default { networkItems, resolve };

// The adapter owns the complete clip/VOD. Player fragments and quality switches are not cards.
export function networkItems(details, { mediaLike } = {}) {
  return mediaLike ? null : undefined;
}

export function metadataUrl(request) {
  if (request?.type === 'vod' && typeof request.id === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/.test(request.id)) {
    return `https://kick.com/api/v1/video/${request.id}`;
  }
  if (request?.type === 'clip' && typeof request.id === 'string' && /^clip_[\w-]{10,100}$/.test(request.id)) {
    return `https://kick.com/api/v2/clips/${request.id}/play`;
  }
  throw new Error('Malformed Kick video request.');
}

export async function resolve(request, { allowedOrigins = [] } = {}) {
  const endpoint = metadataUrl(request);
  if (!isUrlAllowed(endpoint, allowedOrigins)) throw new Error('Allow access to kick.com to list its videos.');
  const cached = cache.get(endpoint);
  if (cached && Date.now() - cached.at < TTL && isUrlAllowed(cached.item.url, allowedOrigins)) return [cached.item];
  const response = await fetch(endpoint, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Kick video request failed with HTTP ${response.status}.`);
  const item = parseMetadata(await response.json(), request);
  if (!item || !isUrlAllowed(item.url, allowedOrigins)) return [];
  cache.delete(endpoint);
  cache.set(endpoint, { item, at: Date.now() });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return [item];
}

export function parseMetadata(data, request) {
  if (!data || typeof data !== 'object') return null;
  const video = request.type === 'clip' ? data.clip : data;
  if (!video || video.deleted_at || video.is_pruned || video.is_private || video.privacy && video.privacy !== 'public'
      || video.status && video.status !== 'public') return null;
  if (request.type === 'clip' ? video.id !== request.id : video.uuid !== request.id) return null;
  const url = mediaUrl(request.type === 'clip' ? video.clip_url : video.source);
  if (!url) return null;
  const stream = video.livestream || {};
  // Ongoing VODs and live channel recording need separate renewal/recording support.
  if (request.type === 'vod' && stream.is_live === true) return null;
  const channel = request.type === 'clip' ? video.channel : stream.channel;
  const thumbnail = request.type === 'clip' ? video.thumbnail_url : stream.thumbnail?.src || stream.thumbnail?.url || stream.thumbnail;
  const duration = Number(request.type === 'clip' ? video.duration : stream.duration / 1000);
  return {
    url, kind: new URL(url).pathname.endsWith('.m3u8') ? 'hls' : 'direct',
    mimeType: new URL(url).pathname.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
    title: typeof (video.title || stream.session_title) === 'string' ? (video.title || stream.session_title).trim() : '',
    author: channel?.user?.username || channel?.username || channel?.slug || undefined,
    thumbnail: thumbnailUrl(thumbnail), duration: Number.isFinite(duration) && duration > 0 ? duration : undefined
  };
}

export function mediaUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 8192) return '';
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (!(url.hostname === 'clips.kick.com' && /^\/clips\/[\w/-]+\.(?:m3u8|mp4)$/.test(url.pathname)
      || url.hostname === 'stream.kick.com' && /^\/[\w/-]+\/media\/hls\/master\.m3u8$/.test(url.pathname))) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function thumbnailUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && /^(?:clips|images|files)\.kick\.com$/.test(url.hostname) ? url.href : undefined;
  } catch { return undefined; }
}
