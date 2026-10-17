import { isUrlAllowed } from '../../media/fetch.js';

const ID = /^[a-f0-9]{32}$/;
const SIGNATURE_KEYS = ['Policy', 'Signature', 'Key-Pair-Id'];
const cache = new Map();
export default { networkItems, resolve };

export function networkItems(details, { mediaLike } = {}) { return mediaLike ? null : undefined; }
export function videoPage(id) { return `https://www.loom.com/share/${id}`; }
export function sourceEndpoint(id) { return `https://www.loom.com/api/campaigns/sessions/${id}/raw-url`; }
export function transcodedEndpoint(id) { return `https://www.loom.com/api/campaigns/sessions/${id}/transcoded-url`; }

export async function resolve(request, { allowedOrigins = [] } = {}) {
  const id = request?.id;
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Malformed Loom video request.');
  if (!isUrlAllowed(videoPage(id), allowedOrigins)) throw new Error('Allow access to loom.com to list Loom videos.');
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000 && cached.item.variants.every(v => isUrlAllowed(v.url, allowedOrigins))) return [cached.item];
  const options = { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) };
  const page = await fetch(videoPage(id), options);
  if (!page.ok) return [];
  const metadata = parsePage(await page.text(), id);
  if (!metadata) return [];
  const sourceOptions = {
    ...options, method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anonID: crypto.randomUUID(), deviceID: null, force_original: false, password: null })
  };
  const response = await fetch(sourceEndpoint(id), sourceOptions);
  if (!response.ok) return [];
  let source = response.status === 204 ? null : parseSource(await response.json(), id);
  // Older recordings can use DASH. The normal transcoded endpoint may offer a complete
  // progressive file instead; authorization errors are never retried through another path.
  if (!source) {
    const fallback = await fetch(transcodedEndpoint(id), { ...sourceOptions, signal: AbortSignal.timeout(15000) });
    if (!fallback.ok || fallback.status === 204) return [];
    source = parseSource(await fallback.json(), id);
  }
  if (!source || !isUrlAllowed(source.url, allowedOrigins)) return [];
  let item;
  if (source.kind === 'direct') {
    const variant = { id: 'original', ...source, width: metadata.width, height: metadata.height, duration: metadata.duration, hasAudio: true, hasVideo: true };
    item = { ...metadata, ...source, variants: [variant] };
  } else {
    // Loom publishes a muxed sibling for its split player manifest. Prefer it to avoid an
    // unnecessary audio merge, but only after a real successful response confirms it exists.
    const merged = source.url.replace(/-split\.m3u8(?=\?|$)/, '.m3u8');
    let master = await fetch(merged, { ...options, signal: AbortSignal.timeout(15000) });
    let masterUrl = merged;
    if (!master.ok && merged !== source.url) {
      masterUrl = source.url;
      master = await fetch(masterUrl, { ...options, signal: AbortSignal.timeout(15000) });
    }
    if (!master.ok) return [];
    item = masterItem(metadata, source, masterUrl, await master.text(), id);
  }
  if (!item) return [];
  cache.delete(id);
  cache.set(id, { at: Date.now(), item });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return [item];
}

// Parse JSON only, never execute first-party script text in the service worker.
export function parsePage(html, id) {
  if (typeof html !== 'string' || html.length > 4000000) return null;
  const serialized = /window\.__APOLLO_STATE__\s*=\s*(\{[^\n]+\})\s*;/.exec(html)?.[1];
  if (!serialized) return null;
  let state;
  try { state = JSON.parse(serialized); } catch { return null; }
  const video = state[`RegularUserVideo:${id}`];
  if (!video || video.id !== id || video.__typename !== 'RegularUserVideo' || video.is_protected || video.needs_password || video.viewerNeedsPermission || video.privacy === 'private') return null;
  const props = video.video_properties || {};
  const owner = state[video.owner?.__ref] || video.owner || {};
  return {
    title: typeof video.name === 'string' ? video.name.trim() : '',
    author: typeof owner.display_name === 'string' ? owner.display_name.trim() : undefined,
    thumbnail: mediaUrl(video.defaultThumbnails?.static || video.thumbnails?.default, id, true) || undefined,
    width: positive(props.width), height: positive(props.height), duration: positive(video.playable_duration) || positive(props.duration)
  };
}

export function parseSource(data, id) {
  const original = mediaUrl(data?.url, id);
  if (!original) return null;
  const path = new URL(original).pathname;
  const extension = /\.(mp4|webm|m3u8)$/.exec(path)?.[1];
  if (!extension) return null;
  let url = original;
  if (extension === 'm3u8') {
    // The URL's own signature may cover only the master. part_credentials authorize its
    // rendition and segment paths; the HLS reader inherits these only within this origin.
    const credentials = data.part_credentials;
    if (!credentials || !SIGNATURE_KEYS.every(key => typeof credentials[key] === 'string' && /^[A-Za-z0-9_~=-]{1,4096}$/.test(credentials[key]))) return null;
    const signed = new URL(url);
    for (const key of SIGNATURE_KEYS) signed.searchParams.set(key, credentials[key]);
    url = signed.href;
  }
  return { url, kind: extension === 'm3u8' ? 'hls' : 'direct', mimeType: extension === 'm3u8' ? 'application/x-mpegURL' : `video/${extension}`, container: extension === 'webm' ? 'webm' : 'mp4' };
}

export function masterItem(metadata, source, url, text, id) {
  if (typeof text !== 'string' || !text.trimStart().startsWith('#EXTM3U')) return null;
  if (/SAMPLE-AES|skd:\/\/|KEYFORMAT=/i.test(text)) return { ...metadata, url, kind: 'hls', mimeType: source.mimeType, protection: 'unsupported-drm', variants: [] };
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const audio = new Map();
  const variants = [];
  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const attrs = attributes(line);
    if (attrs.TYPE === 'AUDIO' && attrs['GROUP-ID'] && attrs.URI && (!audio.has(attrs['GROUP-ID']) || attrs.DEFAULT === 'YES')) audio.set(attrs['GROUP-ID'], signedChild(url, attrs.URI, id));
  }
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith('#EXT-X-STREAM-INF:') || !lines[index + 1] || lines[index + 1].startsWith('#')) continue;
    const attrs = attributes(lines[index]);
    const child = signedChild(url, lines[index + 1], id);
    const audioUrl = attrs.AUDIO ? audio.get(attrs.AUDIO) : undefined;
    if (!child || (attrs.AUDIO && !audioUrl)) continue;
    const [width, height] = String(attrs.RESOLUTION || '').split('x').map(positive);
    variants.push({ id: `hls-${height || variants.length}`, url: child, audioUrl, kind: 'hls', mimeType: source.mimeType, container: 'mp4',
      width, height, bitrate: positive(attrs.BANDWIDTH), codecs: attrs.CODECS, duration: metadata.duration, hasVideo: true, hasAudio: true });
  }
  if (!variants.length && lines.some(line => line.startsWith('#EXTINF:'))) variants.push({ id: 'original', ...source, url, width: metadata.width, height: metadata.height, duration: metadata.duration, hasVideo: true, hasAudio: true });
  if (!variants.length) return null;
  variants.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
  return { ...metadata, url, kind: 'hls', mimeType: source.mimeType, width: variants[0].width, height: variants[0].height, variants };
}

function signedChild(parent, value, id) {
  try {
    const base = new URL(parent);
    const child = new URL(value, parent);
    if (child.origin !== base.origin || !mediaUrl(child.href, id)) return '';
    if (SIGNATURE_KEYS.some(key => child.searchParams.has(key))) {
      if (!SIGNATURE_KEYS.every(key => child.searchParams.has(key))) return '';
    } else {
      for (const key of SIGNATURE_KEYS) if (base.searchParams.has(key)) child.searchParams.set(key, base.searchParams.get(key));
    }
    return child.href;
  } catch { return ''; }
}
function mediaUrl(value, id, thumbnail = false) {
  if (typeof value !== 'string' || value.length > 16384) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    const own = url.hostname === 'luna.loom.com' && new RegExp(`^/id/${id}/rev/[a-f0-9]{16,128}/resource/`).test(url.pathname);
    // Legacy CDN recordings put the video ID at the beginning of the raw file name.
    const legacy = url.hostname === 'cdn.loom.com' && new RegExp(`^/sessions/${thumbnail ? 'thumbnails' : '(?:raw|transcoded)'}/${id}(?:[./_-]|$)`).test(url.pathname);
    return own || legacy ? url.href : '';
  } catch { return ''; }
}
function positive(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : undefined; }
function attributes(line) {
  return Object.fromEntries([...line.slice(line.indexOf(':') + 1).matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)].map(([, key, quoted, plain]) => [key, quoted ?? plain]));
}
