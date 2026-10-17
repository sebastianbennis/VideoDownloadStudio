import { isUrlAllowed } from '../../media/fetch.js';

const cache = new Map();
const TTL = 10 * 60 * 1000;
export default { networkItems, resolve };

export function networkItems(details, { mediaLike } = {}) {
  return mediaLike ? null : undefined;
}

export async function resolve(request, { allowedOrigins = [] } = {}) {
  const path = request?.path;
  if (typeof path !== 'string' || !/^\/[a-zA-Z0-9_-]{1,100}\/[a-zA-Z0-9_-]{1,200}$/.test(path)) throw new Error('Malformed SoundCloud track request.');
  const page = `https://soundcloud.com${path}`;
  if (!isUrlAllowed(page, allowedOrigins) || !isUrlAllowed('https://api-v2.soundcloud.com/', allowedOrigins)) {
    throw new Error('Allow access to SoundCloud to list its tracks.');
  }
  const cached = cache.get(path);
  if (cached && Date.now() - cached.at < TTL && cached.item.variants.every(v => isUrlAllowed(v.url, allowedOrigins))) return [cached.item];
  const response = await fetch(page, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`SoundCloud track request failed with HTTP ${response.status}.`);
  const { track, clientId } = parseHydration(await response.text(), page);
  if (!track || !clientId) return [];
  const variants = [];
  for (const transcoding of publicTranscodings(track).slice(0, 8)) {
    const endpoint = new URL(transcoding.url);
    endpoint.searchParams.set('client_id', clientId);
    const result = await fetch(endpoint.href, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!result.ok) continue;
    const variant = streamVariant(transcoding, (await result.json()).url, track.duration);
    if (variant && isUrlAllowed(variant.url, allowedOrigins) && !variants.some(v => v.url === variant.url)) variants.push(variant);
  }
  const item = trackItem(track, variants);
  if (!item) return [];
  cache.delete(path);
  cache.set(path, { item, at: Date.now() });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return [item];
}

// Read JSON data only. Never evaluate the page or read its account, cookies or Authorization.
export function parseHydration(html, pageUrl) {
  if (typeof html !== 'string' || html.length > 4 * 1024 * 1024) return {};
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const match = /(?:^|\s)window\.__sc_hydration\s*=\s*(\[[\s\S]*\])\s*;?\s*$/.exec(script);
    if (!match) continue;
    try {
      const data = JSON.parse(match[1]);
      if (!Array.isArray(data)) continue;
      const clientId = data.find(entry => entry?.hydratable === 'apiClient')?.data?.id;
      const track = data.find(entry => entry?.hydratable === 'sound')?.data;
      if (!/^[A-Za-z0-9]{32}$/.test(clientId || '') || track?.permalink_url !== pageUrl) return {};
      return { clientId, track };
    } catch { /* Malformed hydration is not an executable fallback. */ }
  }
  return {};
}

export function publicTranscodings(track) {
  if (track?.kind !== 'track' || !Number.isSafeInteger(track.id) || track.id <= 0 || track.sharing !== 'public'
    || track.streamable !== true || !['ALLOW', 'MONETIZE'].includes(track.policy)) return [];
  return (Array.isArray(track.media?.transcodings) ? track.media.transcodings : []).filter(t => {
    if (t?.snipped || t?.quality === 'hq' || Number(t?.duration) < Number(track.full_duration || track.duration) - 1000
      || !['hls', 'progressive'].includes(t?.format?.protocol)
      || !/^(?:aac|mp3|opus)_\d+k$/.test(t?.preset || '')) return false;
    try {
      const url = new URL(t.url);
      return url.origin === 'https://api-v2.soundcloud.com' && !url.username && !url.password && !url.search && !url.hash
        && new RegExp(`^/media/soundcloud:tracks:${track.id}/[a-f0-9-]{36}/stream/(?:hls|progressive)$`).test(url.pathname);
    } catch { return false; }
  });
}

export function streamVariant(transcoding, value, duration) {
  try {
    if (typeof value !== 'string' || value.length > 16384) return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !(url.hostname === 'playback.media-streaming.soundcloud.cloud' || /^(?:cf-hls-media|cf-media|cf-preview-media|cf-hls-opus-media)\.sndcdn\.com$/.test(url.hostname))) return null;
    if (/\/(?:preview|playlist)\/0\/30\//.test(url.pathname) || url.hostname === 'cf-preview-media.sndcdn.com') return null;
    const hls = transcoding.format.protocol === 'hls';
    if (hls && !url.pathname.endsWith('.m3u8') && !/^cf-hls/.test(url.hostname)) return null;
    const codec = transcoding.preset.split('_')[0];
    return {
      id: `${transcoding.format.protocol}-${transcoding.preset}`, url: url.href, kind: hls ? 'hls' : 'direct',
      mimeType: hls ? 'application/vnd.apple.mpegurl' : codec === 'mp3' ? 'audio/mpeg' : codec === 'opus' ? 'audio/ogg' : 'audio/mp4',
      container: codec === 'mp3' ? 'mp3' : codec === 'opus' ? 'ogg' : 'm4a',
      codecs: codec === 'aac' ? 'mp4a.40.2' : codec, bitrate: Number(/_(\d+)k$/.exec(transcoding.preset)?.[1]) * 1000 || undefined,
      duration: Number(duration) > 0 ? Number(duration) / 1000 : undefined, hasAudio: true, hasVideo: false
    };
  } catch { return null; }
}

export function trackItem(track, variants) {
  if (!publicTranscodings(track).length || !variants.length) return null;
  variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0) || Number(a.kind === 'hls') - Number(b.kind === 'hls'));
  const selected = variants[0];
  return {
    url: selected.url, kind: selected.kind, mimeType: selected.mimeType,
    title: typeof track.title === 'string' ? track.title.trim() : '', author: track.user?.username,
    thumbnail: thumbnailUrl(track.artwork_url), duration: selected.duration,
    hasAudio: true, hasVideo: false, variants
  };
}

function thumbnailUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && /^[ai][0-9]\.sndcdn\.com$/.test(url.hostname) ? url.href : undefined;
  } catch { return undefined; }
}
