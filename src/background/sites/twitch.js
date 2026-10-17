// Background rules for Twitch. See ./index.js for the contract.
// Clips and VODs are resolved through the GraphQL API behind Twitch's web player, with the public
// client id that player sends and no login. Clips are progressive MP4s signed with a playback
// token; VODs and highlights are HLS masters from usher whose variant playlists and segments
// download without a token, cookie or header.
import { isUrlAllowed } from '../../media/fetch.js';
import { parseAttributes } from '../../media/hls.js';
import { manifestProtected } from '../manifest-variants.js';

const GQL_URL = 'https://gql.twitch.tv/gql';
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const TOKEN_PARAMS = 'params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }';
const CLIP_FIELDS = `title durationSeconds thumbnailURL(width: 1920, height: 1080) broadcaster { displayName }
  playbackAccessToken(${TOKEN_PARAMS}) { signature value }
  assets { id aspectRatio videoQualities { quality frameRate width height videoCodec sourceURL } }
  videoQualities { quality frameRate sourceURL }`;
const VIDEO_FIELDS = 'title lengthSeconds previewThumbnailURL(width: 1280, height: 720) owner { displayName }';
const SLUG = /^[A-Za-z0-9_-]{1,100}$/;
const CHANNEL = /^[a-z0-9_]{3,25}$/;
const STREAM_ID = /^\d{1,30}$/;
const VIDEO_ID = /^\d{1,15}$/;
const MAX_IDS = 20;
const MAX_ROOT_FIELDS = 15;
const CONCURRENCY = 3;
// Candidates live two hours (catalog.js), so remember what was listed for as long.
const TTL = 2 * 60 * 60 * 1000;
// Missing, refused and subscriber-only items are asked for again after a while.
const MISSING_TTL = 5 * 60 * 1000;
const MAX_ENTRIES = 500;
const CODECS = { AVC: 'avc1', H264: 'avc1', HEVC: 'hvc1', H265: 'hvc1', AV1: 'av01' };
const MEDIA_HOSTS = ['cloudfront.net', 'twitch.tv', 'ttvnw.net', 'twitchcdn.net', 'live-video.net'];
const resolved = new Map(); // 'clip:<slug>' | 'video:<id>' -> { until, items }

export default { networkItems, resolve };

// The adapter lists the clips and VODs the page shows, so what the player fetches only repeats
// them: usher masters, variant playlists, segments and the clip rendition it picked (signed with
// its own token, so a second card). Live channels have one adapter-owned card with a renewable
// channel and broadcast identity; network playlists would duplicate that card.
export function networkItems(details) {
  let url;
  try { url = new URL(details.url); } catch { return undefined; }
  const host = url.hostname;
  const onHost = (domain) => host === domain || host.endsWith(`.${domain}`);
  if (onHost('ttvnw.net') || onHost('live-video.net')) return null;
  if (onHost('media-amazon.com') || onHost('amazon-adsystem.com')) return null;
  if (/\.(?:m3u8|ts|mp4)$/i.test(url.pathname) && ['cloudfront.net', 'twitch.tv', 'twitchcdn.net', 'jtvnw.net'].some(onHost)) return null;
  return undefined;
}

export async function resolve(request, { allowedOrigins = [] } = {}) {
  const clips = request?.clips ?? [];
  const videos = request?.videos ?? [];
  const channels = request?.channels ?? [];
  if (!Array.isArray(clips) || !Array.isArray(videos) || !Array.isArray(channels) || !clips.length && !videos.length && !channels.length || clips.length + videos.length + channels.length > MAX_IDS
    || !clips.every(slug => typeof slug === 'string' && SLUG.test(slug)) || !videos.every(id => typeof id === 'string' && VIDEO_ID.test(id)) || !channels.every(channel => typeof channel === 'string' && CHANNEL.test(channel))) {
    throw new Error('Malformed Twitch request.');
  }
  if (!isUrlAllowed(GQL_URL, allowedOrigins) || (videos.length || channels.length) && !isUrlAllowed('https://usher.ttvnw.net/', allowedOrigins)) {
    throw new Error('Allow access to twitch.tv and ttvnw.net to list Twitch videos.');
  }
  const keys = [...new Set([...clips.map(slug => `clip:${slug}`), ...videos.map(id => `video:${id}`)])];
  const missing = keys.filter(key => !(resolved.get(key)?.until > Date.now()));
  let failure;
  for (const chunk of queryChunks(missing)) await lookup(chunk).catch(error => { failure ||= error; });
  const items = keys.flatMap(key => resolved.get(key)?.items || []);
  for (const channel of new Set(channels)) {
    try { const live = await fetchLiveChannel(channel, { allowedOrigins }); if (live) items.push(live); } catch (error) { failure ||= error; }
  }
  if (failure && !items.length) throw failure;
  return items;
}

// A renewal is called only by the job broker after checking its original frame and grants.
// Identity and quality come from the stored trusted candidate, never a worker-supplied URL.
export async function refreshTwitchPlaylist(identity, quality, context = {}) {
  if (identity?.site !== 'twitch' || !CHANNEL.test(identity.channel || '') || !STREAM_ID.test(identity.streamId || '') || typeof quality !== 'string' || !/^[\w.-]{1,40}$/.test(quality)) throw new Error('Malformed Twitch recording identity.');
  const item = await fetchLiveChannel(identity.channel, context);
  if (!item || item.liveIdentity.streamId !== identity.streamId) throw Object.assign(new Error('The original Twitch broadcast ended. Saved the available recording.'), { code: 'twitch-renew' });
  const variant = item.variants.find(entry => entry.id === quality);
  if (!variant) throw Object.assign(new Error('The selected Twitch quality is no longer available. Saved the available recording.'), { code: 'twitch-renew' });
  if (!isUrlAllowed(variant.url, context.allowedOrigins || [])) throw Object.assign(new Error('The renewed Twitch media origin is not permitted.'), { code: 'permission' });
  return { url: variant.url };
}

export function liveUsherUrl(channel, token) {
  if (!CHANNEL.test(channel) || !validToken(token)) throw new Error('Malformed Twitch playback token.');
  const url = new URL(`https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8`);
  url.search = new URLSearchParams({ allow_source: 'true', allow_audio_only: 'false', playlist_include_framerate: 'true', platform: 'web', player: 'twitchweb', supported_codecs: 'h264', sig: token.signature, token: token.value });
  return url.href;
}

async function fetchLiveChannel(channel, { allowedOrigins = [], signal } = {}) {
  if (!CHANNEL.test(channel) || !isUrlAllowed(GQL_URL, allowedOrigins) || !isUrlAllowed('https://usher.ttvnw.net/', allowedOrigins)) throw Object.assign(new Error('Allow access to twitch.tv and ttvnw.net to record Twitch.'), { code: 'permission' });
  const response = await fetch(GQL_URL, {
    method: 'POST', credentials: 'omit', redirect: 'error', signal: signal || AbortSignal.timeout(10000),
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ query: `query VDSLive($channel: String!) { user(login: $channel) { displayName stream { id title previewImageURL(width: 1280, height: 720) } } streamPlaybackAccessToken(channelName: $channel, ${TOKEN_PARAMS}) { signature value } }`, variables: { channel } })
  });
  if (!response.ok) throw Object.assign(new Error(`Twitch GraphQL failed with HTTP ${response.status}.`), { code: 'twitch-renew' });
  const { data, errors } = await response.json() || {};
  if (!data || errors?.length) throw Object.assign(new Error('Twitch could not resolve this live broadcast.'), { code: 'twitch-renew' });
  const stream = data.user?.stream;
  const token = data.streamPlaybackAccessToken;
  if (!stream || !STREAM_ID.test(String(stream.id)) || !validToken(token)) return null;
  const manifest = await fetch(liveUsherUrl(channel, token), { credentials: 'omit', redirect: 'error', signal: signal || AbortSignal.timeout(10000) });
  if ([403, 404, 410].includes(manifest.status)) return null;
  if (!manifest.ok) throw Object.assign(new Error(`Twitch usher failed with HTTP ${manifest.status}.`), { code: 'twitch-renew' });
  const master = await manifest.text();
  if (!master.trimStart().startsWith('#EXTM3U') || manifestProtected('hls', master)) return null;
  const variants = masterVariants(master).map(variant => ({ ...variant, container: 'ts' }));
  if (!variants.length) return null;
  const best = variants[0];
  return {
    url: best.url, kind: 'hls', mimeType: 'application/x-mpegURL', title: cleanTitle(stream.title) || data.user.displayName,
    author: cleanTitle(data.user.displayName), thumbnail: thumbnailUrl(stream.previewImageURL), width: best.width, height: best.height, variants, protection: 'clear', live: true,
    liveIdentity: { site: 'twitch', channel, streamId: String(stream.id) }, mediaKey: `twitch-live:${channel}:${stream.id}`
  };
}

// Twitch's GraphQL allows 15 root fields per query; a clip takes one, a VOD two (video and token).
export function queryChunks(keys) {
  const chunks = [];
  let cost = MAX_ROOT_FIELDS;
  for (const key of keys) {
    const weight = key.startsWith('video:') ? 2 : 1;
    if (cost + weight > MAX_ROOT_FIELDS) { chunks.push([]); cost = 0; }
    chunks.at(-1).push(key);
    cost += weight;
  }
  return chunks;
}

async function lookup(keys) {
  const clips = keys.filter(key => key.startsWith('clip:')).map(key => key.slice(5));
  const videos = keys.filter(key => key.startsWith('video:')).map(key => key.slice(6));
  const { query, variables } = mediaQuery(clips, videos);
  const response = await fetch(GQL_URL, {
    method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ query, variables })
  });
  if (!response.ok) throw new Error(`Twitch GraphQL failed with HTTP ${response.status}.`);
  const { data, errors } = await response.json() || {};
  if (!data || typeof data !== 'object') throw new Error('Twitch GraphQL returned no data.');
  // A field Twitch failed to answer is null like a missing clip, but is asked for again next time.
  const failed = new Set(Array.isArray(errors) ? errors.map(error => error?.path?.[0] ?? '*') : []);
  const answered = alias => data[alias] !== null || !failed.has(alias) && !failed.has('*');
  const saved = await savedTokens();
  const signed = {};
  clips.forEach((slug, index) => {
    const clip = data[`c${index}`];
    if (!answered(`c${index}`)) return;
    // A token signed earlier is reused while it is valid, so the card keeps the same URLs when
    // the service worker restarts and resolves the clip again.
    const token = saved[slug]?.until > Date.now() + 60 * 1000 ? saved[slug] : clip?.playbackAccessToken;
    const items = parseClip(clip, token);
    if (items.length && token !== saved[slug]) signed[slug] = { signature: token.signature, value: token.value, until: tokenExpiry(token) - 60 * 60 * 1000 };
    remember(`clip:${slug}`, { until: items.length ? Math.min(Date.now() + TTL, tokenExpiry(token) - 60 * 1000) : Date.now() + MISSING_TTL, items });
  });
  if (Object.keys(signed).length) await saveTokens({ ...saved, ...signed });
  const queue = videos.map((id, index) => ({ id, video: data[`v${index}`], token: data[`t${index}`] })).filter((job, index) => answered(`v${index}`) && answered(`t${index}`));
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const job = queue.shift();
      // Failures that may pass (network, server errors) are not remembered.
      try {
        const items = await videoItems(job);
        remember(`video:${job.id}`, { until: Date.now() + (items.length ? TTL : MISSING_TTL), items });
      } catch {}
    }
  }));
}

// One request for every clip and VOD of a batch; ids travel as variables, never in the query text.
export function mediaQuery(clips, videos) {
  const declarations = [];
  const fields = [];
  const variables = {};
  clips.forEach((slug, index) => {
    declarations.push(`$c${index}: ID!`);
    variables[`c${index}`] = slug;
    fields.push(`c${index}: clip(slug: $c${index}) { ${CLIP_FIELDS} }`);
  });
  videos.forEach((id, index) => {
    declarations.push(`$v${index}: ID!`);
    variables[`v${index}`] = id;
    fields.push(`v${index}: video(id: $v${index}) { ${VIDEO_FIELDS} }`, `t${index}: videoPlaybackAccessToken(id: $v${index}, ${TOKEN_PARAMS}) { signature value }`);
  });
  return { query: `query VDSMedia(${declarations.join(', ')}) { ${fields.join(' ')} }`, variables };
}

// A clip's MP4 renditions, best first. The landscape asset is the clip as broadcast; the portrait
// asset is an optional vertical crop and is left out so qualities are not listed twice.
export function parseClip(clip, token) {
  if (!clip || typeof clip !== 'object' || !validToken(token)) return [];
  const assets = Array.isArray(clip.assets) ? clip.assets : [];
  const asset = assets.find(entry => /\/LANDSCAPE$/i.test(entry?.id || '')) || assets.find(entry => Number(entry?.aspectRatio) >= 1) || assets[0];
  const qualities = Array.isArray(asset?.videoQualities) && asset.videoQualities.length ? asset.videoQualities : Array.isArray(clip.videoQualities) ? clip.videoQualities : [];
  const duration = positive(clip.durationSeconds);
  const variants = [];
  const urls = new Set();
  for (const quality of qualities) {
    const url = signedClipUrl(quality?.sourceURL, token);
    if (!url || urls.has(url)) continue;
    urls.add(url);
    const height = positive(quality.height) || positive(quality.quality);
    const base = `mp4-${height || variants.length}`;
    const id = variants.some(variant => variant.id === base) ? `${base}-${variants.length}` : base;
    variants.push({
      id, url, kind: 'direct', mimeType: 'video/mp4', container: 'mp4', width: positive(quality.width), height, fps: positive(quality.frameRate),
      codecs: CODECS[String(quality.videoCodec || '').toUpperCase()], duration, hasAudio: true, hasVideo: true
    });
  }
  if (!variants.length) return [];
  variants.sort((a, b) => (b.height || 0) - (a.height || 0));
  const [best] = variants;
  return [{
    url: best.url, kind: 'direct', mimeType: 'video/mp4', title: cleanTitle(clip.title), author: cleanTitle(clip.broadcaster?.displayName) || undefined,
    thumbnail: thumbnailUrl(clip.thumbnailURL), duration, width: best.width, height: best.height, variants, protection: 'clear'
  }];
}

async function videoItems({ id, video, token }) {
  // Deleted, private and unknown VODs have neither metadata nor a token.
  if (!video || typeof video !== 'object' || !validToken(token)) return [];
  const response = await fetch(usherUrl(id, token), { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
  // Usher refuses subscriber-only (vod_manifest_restricted), geo-blocked and removed VODs.
  if ([403, 404, 410].includes(response.status)) return [];
  if (!response.ok) throw new Error(`Twitch usher failed with HTTP ${response.status}.`);
  return parseVideo(video, await response.text());
}

export function usherUrl(id, token) {
  const url = new URL(`https://usher.ttvnw.net/vod/${id}.m3u8`);
  url.search = new URLSearchParams({
    allow_source: 'true', allow_audio_only: 'true', playlist_include_framerate: 'true', platform: 'web', player: 'twitchweb',
    // H.264 only: it plays and remuxes everywhere, and Twitch always transcodes to it.
    supported_codecs: 'h264', p: String(1000000 + Math.floor(Math.random() * 9000000)), sig: token.signature, token: token.value
  });
  return url.href;
}

// A VOD or highlight as an HLS card whose qualities are usher's variant playlists. The card's url is
// the best variant, which stays the same across resolves (the master carries a fresh token each time).
export function parseVideo(video, masterText) {
  const text = String(masterText || '');
  if (!text.trimStart().startsWith('#EXTM3U')) return [];
  const variants = masterVariants(text, positive(video?.lengthSeconds));
  if (!variants.length) return [];
  const [best] = variants;
  return [{
    url: best.url, kind: 'hls', mimeType: 'application/x-mpegURL', title: cleanTitle(video.title), author: cleanTitle(video.owner?.displayName) || undefined,
    thumbnail: thumbnailUrl(video.previewThumbnailURL), duration: positive(video.lengthSeconds), width: best.width, height: best.height, variants,
    protection: manifestProtected('hls', text) ? 'unsupported-drm' : 'clear'
  }];
}

// Video renditions of an usher master, best first. The audio-only rendition is left out: it has no
// resolution, so the preferred-quality pick would treat it as an exact match.
export function masterVariants(text, duration) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const variants = [];
  for (let index = 0; index < lines.length && variants.length < 20; index += 1) {
    if (!lines[index].startsWith('#EXT-X-STREAM-INF:') || !lines[index + 1] || lines[index + 1].startsWith('#')) continue;
    const attrs = parseAttributes(lines[index]);
    const [width, height] = String(attrs.RESOLUTION || '').split('x').map(Number);
    const url = mediaUrl(lines[index + 1]);
    if (!url || !(height > 0) || attrs.VIDEO === 'audio_only' || variants.some(variant => variant.url === url)) continue;
    const group = String(attrs.VIDEO || '').replace(/[^\w.-]/g, '').slice(0, 40);
    variants.push({
      id: group && !variants.some(variant => variant.id === group) ? group : `hls-${variants.length}`, url, kind: 'hls', mimeType: 'application/x-mpegURL', container: 'mp4',
      width: positive(width), height, fps: Math.round(Number(attrs['FRAME-RATE']) * 100) / 100 || undefined, bitrate: positive(attrs.BANDWIDTH),
      codecs: String(attrs.CODECS || '').slice(0, 160) || undefined, duration, hasAudio: true, hasVideo: true
    });
  }
  return variants.sort((a, b) => b.height - a.height || (b.fps || 0) - (a.fps || 0) || (b.bitrate || 0) - (a.bitrate || 0));
}

function signedClipUrl(value, token) {
  const url = mediaUrl(value);
  if (!url) return '';
  const signed = new URL(url);
  signed.searchParams.set('sig', token.signature);
  signed.searchParams.set('token', token.value);
  return signed.href;
}

function mediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && MEDIA_HOSTS.some(domain => url.hostname.endsWith(`.${domain}`)) ? url.href : '';
  } catch { return ''; }
}

// VODs still processing show a placeholder image instead of a frame.
function thumbnailUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'static-cdn.jtvnw.net' && !/\/404_processing_/.test(url.pathname) ? url.href : undefined;
  } catch { return undefined; }
}

function validToken(token) {
  if (typeof token?.signature !== 'string' || !/^[0-9a-f]{20,128}$/i.test(token.signature) || typeof token.value !== 'string' || token.value.length > 4096) return false;
  try { return JSON.parse(token.value)?.authorization?.forbidden !== true; } catch { return false; }
}

function tokenExpiry(token) {
  try { return Number(JSON.parse(token.value).expires) * 1000 || 0; } catch { return 0; }
}

// Twitch lets a broadcast go untitled; the service then names it after its author.
function cleanTitle(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function remember(key, value) {
  resolved.delete(key);
  resolved.set(key, value);
  if (resolved.size > MAX_ENTRIES) resolved.delete(resolved.keys().next().value);
}

// Clip tokens outlive the service worker in session storage (cleared when the browser closes).
const TOKENS_KEY = globalThis.chrome?.extension?.inIncognitoContext ? 'vdsPrivateTwitchTokens' : 'vdsTwitchTokens';

async function savedTokens() {
  try { return (await globalThis.chrome.storage.session.get(TOKENS_KEY))[TOKENS_KEY] || {}; } catch { return {}; }
}

async function saveTokens(tokens) {
  const now = Date.now();
  const kept = Object.entries(tokens).filter(([, token]) => token?.until > now).slice(-300);
  try { await globalThis.chrome.storage.session.set({ [TOKENS_KEY]: Object.fromEntries(kept) }); } catch {}
}
