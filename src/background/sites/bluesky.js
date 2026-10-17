// Background rules for Bluesky. See ./index.js for the contract.
// Posts are read from the public AppView (no login). Their video embeds name an HLS playlist on
// video.bsky.app, but that host answers every segment with a 302 to video.cdn.bsky.app, and
// downloads reject redirects. The same master playlist served from video.cdn.bsky.app/hls/ uses
// relative URLs that stay on the CDN, so cards point there.
import { isUrlAllowed } from '../../media/fetch.js';

const API = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread';
const ACTOR = /^(?:did:(?:plc:[a-z2-7]{24}|web:[a-z0-9.-]{1,253})|(?=[a-z0-9.-]{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/;
const DID = /^did:(?:plc:[a-z2-7]{24}|web:[a-z0-9.-]{1,253})$/;
const RKEY = /^[A-Za-z0-9._~:-]{1,64}$/;
const CID = /^b[a-z2-7]{20,120}$/;
// /watch/<did>/<cid>/... on video.bsky.app and /hls/<did>/<cid>/... on video.cdn.bsky.app.
const VIDEO_PATH = /^\/(?:watch|hls)\/([^/]+)\/([^/]+)\/(.+)$/;
const MAX_POSTS = 25;
const CONCURRENCY = 3;
// Candidates live two hours (catalog.js), so remember what was read for as long.
const TTL = 2 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const posts = new Map(); // "<actor>/<rkey>" -> { at, videos }

export default { networkItems, resolve };

export function networkItems(details) {
  let url;
  try { url = new URL(details.url); } catch { return undefined; }
  // Reply GIFs (Tenor, re-encoded to WebM) are external links, not the post's video.
  if (url.hostname === 't.gifs.bsky.app') return null;
  if (url.hostname !== 'video.bsky.app' && url.hostname !== 'video.cdn.bsky.app') return undefined;
  const [, did, cid, rest] = url.pathname.match(VIDEO_PATH) || [];
  const video = videoUrls(safeDecode(did), cid);
  // Variant playlists, segments and thumbnails are pieces of one stream.
  if (!video || rest !== 'playlist.m3u8') return null;
  // The playlist the player loaded becomes the CDN copy, the same URL the adapter lists, so the
  // two sightings share a card and the adapter's title wins.
  return [{ url: video.playlist, kind: 'hls', mimeType: 'application/x-mpegURL', thumbnail: video.thumbnail, protection: 'clear' }];
}

export async function resolve(request, { allowedOrigins = [] } = {}) {
  const list = request?.posts;
  if (!Array.isArray(list) || !list.length || list.length > MAX_POSTS || !list.every(validPost)) throw new Error('Malformed Bluesky post request.');
  if (!isUrlAllowed(API, allowedOrigins) || !isUrlAllowed('https://video.cdn.bsky.app/', allowedOrigins)) throw new Error('Allow access to bsky.app to list Bluesky videos.');
  const queue = [...new Map(list.map(post => [`${post.actor}/${post.rkey}`, post])).values()];
  const videos = [];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) videos.push(...await postVideos(queue.shift()).catch(() => []));
  }));
  return [...new Map(videos.map(item => [item.url, item])).values()];
}

function validPost(post) {
  return typeof post?.actor === 'string' && typeof post.rkey === 'string' && ACTOR.test(post.actor) && RKEY.test(post.rkey) && post.rkey !== '.' && post.rkey !== '..';
}

export function threadUrl({ actor, rkey }) {
  const params = new URLSearchParams({ uri: `at://${actor}/app.bsky.feed.post/${rkey}`, depth: '0', parentHeight: '0' });
  return `${API}?${params}`;
}

async function postVideos(post) {
  const key = `${post.actor}/${post.rkey}`;
  const cached = posts.get(key);
  if (fresh(cached)) return cached.videos;
  const response = await fetch(threadUrl(post), { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
  // 400 NotFound means deleted or never existed; other failures may pass, so they are not remembered.
  if (response.status === 400) return remember(posts, key, { at: Date.now(), videos: [] }).videos;
  if (!response.ok) throw new Error(`Bluesky API failed with HTTP ${response.status}.`);
  return remember(posts, key, { at: Date.now(), videos: parseThread(await response.json()) }).videos;
}

// Videos of a getPostThread answer: the post's own and the one in a post it quotes, each titled
// by the post it belongs to.
export function parseThread(data) {
  const post = data?.thread?.post;
  if (!post || typeof post !== 'object') return [];
  const items = [];
  const add = (embed, owner, text) => {
    const item = videoItem(embed, owner, text);
    if (item) items.push(item);
  };
  const quoted = (record) => {
    // app.bsky.embed.record#viewRecord; blocked, deleted and detached quotes have no embeds.
    if (record?.$type !== 'app.bsky.embed.record#viewRecord') return;
    for (const embed of Array.isArray(record.embeds) ? record.embeds : []) {
      add(embed, record.author, record.value?.text);
      add(embed?.media, record.author, record.value?.text);
    }
  };
  const embed = post.embed;
  add(embed, post.author, post.record?.text);
  if (embed?.$type === 'app.bsky.embed.recordWithMedia#view') {
    add(embed.media, post.author, post.record?.text);
    quoted(embed.record?.record);
  }
  if (embed?.$type === 'app.bsky.embed.record#view') quoted(embed.record);
  return items;
}

function videoItem(embed, author, text) {
  if (embed?.$type !== 'app.bsky.embed.video#view') return null;
  const did = String(author?.did || '');
  const cid = String(embed.cid || '');
  // The playlist the API names must be this author's blob; anything else is not built on.
  let named;
  try {
    const url = new URL(embed.playlist);
    const [, playlistDid, playlistCid] = url.pathname.match(VIDEO_PATH) || [];
    named = url.hostname === 'video.bsky.app' && safeDecode(playlistDid) === did && playlistCid === cid;
  } catch { named = false; }
  const video = named && videoUrls(did, cid);
  if (!video) return null;
  const name = String(author.displayName || '').trim();
  const handle = String(author.handle || '').trim();
  return {
    url: video.playlist,
    kind: 'hls',
    mimeType: 'application/x-mpegURL',
    title: firstLine(text) || firstLine(embed.alt),
    author: name || (handle && handle !== 'handle.invalid' ? `@${handle}` : undefined),
    thumbnail: video.thumbnail,
    protection: 'clear'
  };
}

export function videoUrls(did, cid) {
  if (!DID.test(did || '') || !CID.test(cid || '')) return null;
  const base = `https://video.cdn.bsky.app/hls/${did}/${cid}`;
  return { playlist: `${base}/playlist.m3u8`, thumbnail: `${base}/thumbnail.jpg` };
}

function firstLine(value) {
  return typeof value === 'string' ? value.split('\n').map(line => line.trim()).find(Boolean)?.slice(0, 200) || '' : '';
}

function safeDecode(value) {
  try { return decodeURIComponent(value || ''); } catch { return ''; }
}

function fresh(entry) {
  return Boolean(entry?.at) && Date.now() - entry.at < TTL;
}

function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
  return value;
}
