// Background rules for Dailymotion. See ./index.js for the contract.
// Videos are resolved through the player metadata endpoint (yt-dlp uses it too): no login, the
// title, the channel and a tokenized HLS master on cdndirector.dailymotion.com whose renditions
// live on *.dmcdn.net. Pages cannot read either one (no CORS for them).
import { isUrlAllowed } from '../../media/fetch.js';

const XID = /^x[0-9a-z]{2,15}$/;
const DRM = /SAMPLE-AES|skd:\/\/|KEYFORMAT=/i;
const MAX_IDS = 10;
const CONCURRENCY = 3;
// Remembering a video keeps its tokenized URL, and so its card, the same across rescans. Its
// playlist tokens still answered after an hour (VOD and live, October 2026).
const TTL = 60 * 60 * 1000;
const MAX_ENTRIES = 300;
const videos = new Map(); // xid -> { at, item }

export default { networkItems, resolve };

// The player's own requests are the tokenized master the adapter lists itself, rendition
// playlists (fMP4 ones are served as video/mp4), fragments, hover previews, subtitle playlists
// and ad (VAST) manifests named .m3u8. None is a video of its own.
export function networkItems(details, { mediaLike } = {}) {
  return mediaLike ? null : undefined;
}

export async function resolve(request, { allowedOrigins = [] } = {}) {
  const ids = request?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || !ids.every(id => typeof id === 'string' && XID.test(id))) {
    throw new Error('Malformed Dailymotion video request.');
  }
  if (!isUrlAllowed(metadataUrl(ids[0]), allowedOrigins) || !isUrlAllowed('https://vod.cf.dmcdn.net/', allowedOrigins)) {
    throw new Error('Allow access to dailymotion.com and dmcdn.net to list Dailymotion videos.');
  }
  const queue = [...new Set(ids)];
  const items = [];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const item = await videoItem(queue.shift(), allowedOrigins).catch(() => null);
      if (item) items.push(item);
    }
  }));
  return items;
}

export function metadataUrl(xid) {
  return `https://www.dailymotion.com/player/metadata/video/${xid}?app=com.dailymotion.neon`;
}

async function videoItem(xid, allowedOrigins) {
  const cached = videos.get(xid);
  if (cached && Date.now() - cached.at < TTL) return cached.item;
  const response = await fetch(metadataUrl(xid), { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Dailymotion metadata failed with HTTP ${response.status}.`);
  const video = parseMetadata(await response.json(), xid);
  // Not remembered: an offline live stream may go on air before the next scan.
  if (!video) return null;
  const master = await fetch(video.master, { credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(10000) });
  // Some masters redirect to a CDN edge; downloads refuse redirects, so the edge URL is listed.
  if (!master.ok || !cdnUrl(master.url) || !isUrlAllowed(master.url, allowedOrigins)) throw new Error(`Dailymotion playlist failed with HTTP ${master.status}.`);
  const item = masterItem(video, master.url, await master.text());
  // Encryption keys sit in the rendition playlists; look there when Dailymotion flags the delivery.
  if (item?.variants && video.protectedDelivery) {
    const rendition = await fetch(item.variants[0].url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (rendition.ok && DRM.test(await rendition.text())) return remember(xid, { ...item, variants: undefined, protection: 'unsupported-drm' });
  }
  return remember(xid, item);
}

// The video a metadata answer describes, or null for errors (geo-blocked, offline live, deleted),
// private and password-protected videos, which are out of scope.
export function parseMetadata(data, xid) {
  if (!data || typeof data !== 'object' || data.error || data.private === true || data.is_password_protected === true) return null;
  if (data.id !== undefined && data.id !== xid) return null;
  const hls = Object.values(data.qualities || {}).flat().find(entry => /mpegurl/i.test(entry?.type || ''));
  const master = masterUrl(hls?.url, xid);
  if (!master) return null;
  const thumbnails = data.thumbnails && typeof data.thumbnails === 'object' ? data.thumbnails : {};
  const size = Object.keys(thumbnails).filter(key => httpsUrl(thumbnails[key])).sort((a, b) => Number(b) - Number(a))[0];
  return {
    xid,
    master,
    title: typeof data.title === 'string' ? data.title.trim() : '',
    author: typeof data.owner?.screenname === 'string' ? data.owner.screenname.trim() : '',
    thumbnail: size ? thumbnails[size] : undefined,
    duration: Number(data.duration) > 0 ? Number(data.duration) : undefined,
    live: data.mode === 'live' || data.stream_type === 'live',
    protectedDelivery: data.protected_delivery === true
  };
}

// The card for a video from its master playlist; null when it cannot be saved.
export function masterItem(video, url, text) {
  if (typeof text !== 'string' || !text.trimStart().startsWith('#EXTM3U')) return null;
  const base = { title: video.title, author: video.author || undefined, thumbnail: video.thumbnail, duration: video.duration };
  if (DRM.test(text)) return { ...base, url, kind: 'hls', mimeType: 'application/x-mpegURL', protection: 'unsupported-drm' };
  const { variants, separateAudio } = masterVariants(url, text, video.duration);
  // A live stream is recorded until stopped, which the HLS reader supports only with muxed audio.
  if (!variants.length || (video.live && separateAudio)) return null;
  return {
    ...base, url, kind: 'hls', mimeType: 'application/x-mpegURL',
    width: variants[0].width, height: variants[0].height, variants, protection: 'clear'
  };
}

export function masterVariants(masterUrl, text, duration) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const audio = new Map();
  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const attrs = attributes(line);
    if (attrs.TYPE !== 'AUDIO' || !attrs['GROUP-ID'] || !attrs.URI) continue;
    if (!audio.has(attrs['GROUP-ID']) || attrs.DEFAULT === 'YES') audio.set(attrs['GROUP-ID'], attrs.URI);
  }
  const streams = lines.flatMap((line, index) => line.startsWith('#EXT-X-STREAM-INF:') && lines[index + 1] && !lines[index + 1].startsWith('#')
    ? [{ attrs: attributes(line), uri: lines[index + 1] }] : []);
  const resolutions = streams.map(stream => stream.attrs.RESOLUTION);
  const variants = [];
  const ids = new Set();
  for (const { attrs, uri } of streams) {
    const url = cdnUrl(uri, masterUrl);
    if (!url) continue;
    let [width, height] = String(attrs.RESOLUTION || '').split('x').map(Number);
    // Vertical videos give every rendition the same RESOLUTION (328x576 for files from 360x640 to
    // 576x1024); the player's own quality name is the only per-rendition size then.
    if (resolutions.indexOf(attrs.RESOLUTION) !== resolutions.lastIndexOf(attrs.RESOLUTION) && /^\d{3,4}$/.test(attrs.NAME || '')) [width, height] = [0, Number(attrs.NAME)];
    const audioUrl = attrs.AUDIO && audio.has(attrs.AUDIO) ? cdnUrl(audio.get(attrs.AUDIO), masterUrl) || undefined : undefined;
    let id = `hls-${height || variants.length}`;
    while (ids.has(id)) id += '+';
    ids.add(id);
    variants.push({
      id, url, audioUrl, kind: 'hls', mimeType: 'application/x-mpegURL', container: 'mp4',
      width: width || undefined, height: height || undefined,
      bitrate: Number(attrs['AVERAGE-BANDWIDTH'] || attrs.BANDWIDTH) || undefined,
      fps: Number(attrs['FRAME-RATE']) || Number(/@(\d+)$/.exec(attrs.NAME || '')?.[1]) || undefined,
      codecs: attrs.CODECS || undefined, duration, hasAudio: true, hasVideo: true
    });
  }
  variants.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
  return { variants, separateAudio: audio.size > 0 };
}

// Only the master the metadata names for this very video: https on dailymotion.com, VOD or live.
function masterUrl(value, xid) {
  const url = httpsUrl(value);
  if (!url) return '';
  const parsed = new URL(url);
  const own = parsed.pathname.match(/^\/cdn\/(?:manifest|live)\/video\/(x[0-9a-z]+)\.m3u8$/)?.[1] === xid;
  return own && /(^|\.)dailymotion\.com$/.test(parsed.hostname) ? url : '';
}

// Playlists live on Dailymotion's CDN; the #cell= fragment only steers the player.
function cdnUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || !/(^|\.)(dmcdn\.net|dailymotion\.com)$/.test(url.hostname)) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

function attributes(line) {
  const attrs = {};
  for (const [, key, quoted, plain] of line.slice(line.indexOf(':') + 1).matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)) attrs[key] = quoted ?? plain;
  return attrs;
}

function remember(xid, item) {
  videos.delete(xid);
  videos.set(xid, { at: Date.now(), item });
  if (videos.size > MAX_ENTRIES) videos.delete(videos.keys().next().value);
  return item;
}
