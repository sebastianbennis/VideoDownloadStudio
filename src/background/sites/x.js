// Background rules for X (Twitter). See ./index.js for the contract.
// Tweets are resolved through the syndication endpoint behind X's embedded tweets: it needs no
// login and lists the muxed MP4 renditions (up to 4K) that the web player's HLS stream splits
// into fMP4 segments with separate audio.
import { isUrlAllowed } from '../../media/fetch.js';

const TWEET_ID = /^\d{1,25}$/;
const MEDIA_ID = /^\/(?:amplify_video|ext_tw_video)\/(\d+)\//;
// Spaces: /Transcoding/v1/hls/<broadcast>/non_transcode/<region>/<bucket>/ holds the Space's own
// playlist (a master for video Spaces, audio-space/playlist_<n>.m3u8 for audio ones) and audio
// chunks; /transcode/ holds the master's renditions. Mirrored in content/sites/x.js.
const SPACE_PATH = /^\/Transcoding\/v1\/hls\/[\w-]+\/(non_transcode|transcode)\/[\w-]+\/[\w-]+\/(?:[\w.-]+\/)*[\w.-]+\.(m3u8|aac|ts)$/;
const MAX_IDS = 20;
const CONCURRENCY = 3;
// Candidates live two hours (catalog.js), so remember what was listed for as long.
const TTL = 2 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const tweets = new Map(); // tweet id -> { at, media }
const resolvedMedia = new Map(); // media id -> at
const observedMasters = new Map(); // media id -> { at, url } of a master playlist the page played
const listedSpaces = new Map(); // Space playlist url -> at

export default { networkItems, resolve };

export function networkItems(details) {
  let url;
  try { url = new URL(details.url); } catch { return undefined; }
  // The content script lists a playing Space from the page's resource timeline, which also sees
  // cached playlists; this sighting backs it up and keeps renditions and chunks off the list.
  if (url.hostname.endsWith('.video.pscp.tv')) {
    const space = spaceMedia(url.href);
    if (!space) return undefined;
    // A live Space's player reloads its playlist every few seconds; the first sighting lists it.
    if (space.role !== 'playlist' || fresh(listedSpaces.get(url.href))) return null;
    remember(listedSpaces, url.href, Date.now());
    return [{ url: url.href, kind: 'hls', mimeType: 'application/x-mpegURL', protection: 'clear' }];
  }
  if (url.hostname !== 'video.twimg.com') return undefined;
  const path = url.pathname;
  // fMP4 segments, init segments (/vid/avc1/<startMs>/<endMs>/...) and per-rendition playlists
  // are pieces of one HLS stream, never videos of their own.
  if (/\.m4s$/i.test(path) || /\/(?:vid|aud)\/[^/]+\/\d+\/\d+\//.test(path) || /\/pl\/[^/]+\/.+\.m3u8$/i.test(path)) return null;
  const mediaId = path.match(MEDIA_ID)?.[1];
  if (!mediaId) return undefined;
  // The adapter already listed this video with its MP4 renditions.
  if (fresh(resolvedMedia.get(mediaId))) return null;
  // Keep the master as a fallback (protected or age-gated tweets), and let a later resolve reuse
  // its exact URL (the player adds a tag parameter) so both land on one card.
  if (/\/pl\/[^/]+\.m3u8$/i.test(path)) remember(observedMasters, mediaId, { at: Date.now(), url: url.href });
  return undefined;
}

export async function resolve(request, { allowedOrigins = [] } = {}) {
  const ids = request?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || !ids.every(id => typeof id === 'string' && TWEET_ID.test(id))) {
    throw new Error('Malformed X tweet request.');
  }
  if (!isUrlAllowed(syndicationUrl(ids[0]), allowedOrigins)) throw new Error('Allow access to twimg.com to list X videos.');
  const queue = [...new Set(ids)];
  const media = [];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) media.push(...await tweetMedia(queue.shift()).catch(() => []));
  }));
  return mediaItems(media);
}

// What a Periscope media URL is to a Space: its own playlist, a rendition of it, or a chunk.
export function spaceMedia(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.endsWith('.video.pscp.tv')) return null;
  const match = url.pathname.match(SPACE_PATH);
  if (!match) return null;
  if (match[2] !== 'm3u8') return { role: 'segment' };
  return { role: match[1] === 'non_transcode' ? 'playlist' : 'child' };
}

export function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

export function syndicationUrl(id) {
  return `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${syndicationToken(id)}`;
}

async function tweetMedia(id) {
  const cached = tweets.get(id);
  if (fresh(cached)) return cached.media;
  const response = await fetch(syndicationUrl(id), { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
  // 404 means deleted or never existed; other failures may pass, so they are not remembered.
  if (response.status === 404) return remember(tweets, id, { at: Date.now(), media: [] }).media;
  if (!response.ok) throw new Error(`X syndication failed with HTTP ${response.status}.`);
  return remember(tweets, id, { at: Date.now(), media: parseTweet(await response.json()) }).media;
}

// Videos of a syndication tweet-result, its quoted tweet and its unified card, each titled by
// the tweet it belongs to.
export function parseTweet(tweet) {
  if (tweet?.__typename && tweet.__typename !== 'Tweet') return [];
  const media = [];
  for (const entry of [tweet, tweet?.quoted_tweet]) {
    if (!entry || typeof entry !== 'object') continue;
    const title = tweetTitle(entry);
    const author = String(entry.user?.name || '').trim();
    const found = [...(Array.isArray(entry.mediaDetails) ? entry.mediaDetails : []), ...cardMedia(entry.card)]
      .map(details => parseMedia(details, title, author)).filter(Boolean);
    // Several videos in one tweet are told apart by number; untitled ones by Chrome's (1), (2).
    found.forEach((item, index) => { if (found.length > 1 && title) item.title = `${title} (${index + 1})`; });
    media.push(...found);
  }
  return media;
}

function parseMedia(details, title, author) {
  if (!['video', 'animated_gif'].includes(details?.type) || !Array.isArray(details.video_info?.variants)) return null;
  const gif = details.type === 'animated_gif';
  const duration = Number(details.video_info.duration_millis) / 1000 || undefined;
  let master;
  const variants = [];
  for (const variant of details.video_info.variants) {
    const url = twimgVideoUrl(variant?.url);
    if (!url) continue;
    if (/mpegurl/i.test(variant.content_type)) { master ||= url; continue; }
    if (!/^video\/mp4$/i.test(variant.content_type)) continue;
    const size = new URL(url).pathname.match(/\/(\d+)x(\d+)\//);
    const width = size ? Number(size[1]) : Number(details.original_info?.width) || undefined;
    const height = size ? Number(size[2]) : Number(details.original_info?.height) || undefined;
    variants.push({
      id: `mp4-${width && height ? `${width}x${height}` : variants.length}`, url, kind: 'direct', mimeType: 'video/mp4', container: 'mp4',
      width, height, bitrate: Number(variant.bitrate) || undefined, duration, hasAudio: !gif, hasVideo: true
    });
  }
  if (!variants.length && !master) return null;
  variants.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
  const id = mediaId(master || variants[0].url);
  return { mediaId: id, master, variants, title, author, thumbnail: twimgImageUrl(details.media_url_https), duration };
}

// Builds card items at answer time so a master playlist the page played since is reused.
export function mediaItems(media) {
  const items = [];
  const seen = new Set();
  for (const entry of media) {
    const key = entry.mediaId || entry.master || entry.variants[0]?.url;
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.mediaId) remember(resolvedMedia, entry.mediaId, Date.now());
    const observed = entry.mediaId && observedMasters.get(entry.mediaId);
    const best = entry.variants[0];
    // Without MP4 renditions the master playlist is the video and its variants are discovered later.
    const url = fresh(observed) ? observed.url : best ? best.url : entry.master;
    items.push({
      url, kind: url === best?.url ? 'direct' : 'hls', mimeType: url === best?.url ? 'video/mp4' : 'application/x-mpegURL',
      title: entry.title, author: entry.author || undefined, thumbnail: entry.thumbnail, duration: entry.duration, width: best?.width, height: best?.height,
      variants: entry.variants.length ? entry.variants : undefined, protection: 'clear'
    });
  }
  return items;
}

function cardMedia(card) {
  if (card?.name !== 'unified_card') return [];
  try {
    return Object.values(JSON.parse(card.binding_values?.unified_card?.string_value || '{}').media_entities || {});
  } catch { return []; }
}

// "Name - text"; a tweet with no text has no title and falls back to its author (shared/titles.js).
function tweetTitle(tweet) {
  const text = String(tweet.text || '').replace(/(?:\s*https:\/\/t\.co\/\w+)+\s*$/, '').replace(/\s+/g, ' ').trim();
  return text ? [tweet.user?.name, text].filter(Boolean).join(' - ').slice(0, 200) : '';
}

function twimgVideoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'video.twimg.com' ? url.href : '';
  } catch { return ''; }
}

function twimgImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'pbs.twimg.com' ? url.href : undefined;
  } catch { return undefined; }
}

function mediaId(value) {
  try { return new URL(value).pathname.match(MEDIA_ID)?.[1]; } catch { return undefined; }
}

function fresh(entry) {
  const at = typeof entry === 'number' ? entry : entry?.at;
  return Boolean(at) && Date.now() - at < TTL;
}

function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
  return value;
}
