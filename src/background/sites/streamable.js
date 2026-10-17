import { isUrlAllowed } from '../../media/fetch.js';

const HOST = /(^|\.)streamable\.com$/i;
const ID = /^[a-z0-9_]{1,32}$/i;
const TTL = 2 * 60 * 60 * 1000;
const videos = new Map();

export default { networkItems, resolve };

export function networkItems({ url }) {
  try {
    const parsed = new URL(url);
    // Both qualities and signed copies belong to the adapter's single API-backed card.
    return HOST.test(parsed.hostname) && /^\/video\//.test(parsed.pathname) ? null : undefined;
  } catch { return undefined; }
}

export async function resolve(request, { allowedOrigins = [] } = {}) {
  if (typeof request?.id !== 'string' || !ID.test(request.id)) throw new Error('Malformed Streamable video request.');
  const url = `https://ajax.streamable.com/videos/${request.id}`;
  if (!isUrlAllowed(url, allowedOrigins)) throw new Error('Allow access to Streamable to list its videos.');
  const cached = videos.get(request.id);
  if (cached && Date.now() - cached.at < TTL) return cached.result;
  // Cache the pending request too, keeping one signed URL across concurrent scans and frames.
  const result = fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) })
    .then(async response => {
      if (!response.ok) throw new Error(`Streamable video request failed with HTTP ${response.status}.`);
      return parseVideo(await response.json());
    }).catch(error => { videos.delete(request.id); throw error; });
  videos.set(request.id, { at: Date.now(), result });
  if (videos.size > 250) videos.delete(videos.keys().next().value);
  return result;
}

export function parseVideo(video) {
  if (video?.status !== 2 || !video.files || typeof video.files !== 'object') return [];
  const variants = [];
  const seen = new Set();
  for (const [id, file] of Object.entries(video.files)) {
    const url = streamableUrl(file?.url);
    const extension = url && new URL(url).pathname.match(/\.(mp4|webm)$/i)?.[1]?.toLowerCase();
    if (!extension || seen.has(url) || (file.status !== undefined && file.status !== 2)) continue;
    seen.add(url);
    variants.push({
      id, url, kind: 'direct', mimeType: `video/${extension}`, container: extension,
      width: positive(file.width), height: positive(file.height), bitrate: positive(file.bitrate),
      fps: positive(file.framerate), contentLength: positive(file.size),
      duration: positive(file.duration) || positive(video.duration),
      hasVideo: true,
      hasAudio: file.audio_channels === 0 ? false : positive(file.audio_channels) ? true : undefined
    });
  }
  variants.sort((a, b) => ((b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)) ||
    (b.bitrate || 0) - (a.bitrate || 0) || Number(b.container === 'mp4') - Number(a.container === 'mp4'));
  if (!variants.length) return [];
  const { id: _, ...best } = variants[0];
  return [{
    ...best, title: line(video.reddit_title) || line(video.title), author: line(video.owner?.user_name) || undefined,
    thumbnail: streamableUrl(video.thumbnail_url) || undefined, variants
  }];
}

function streamableUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return '';
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    return url.protocol === 'https:' && HOST.test(url.hostname) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function line(value) {
  return typeof value === 'string' ? value.split('\n').map(part => part.trim()).find(Boolean) || '' : '';
}
