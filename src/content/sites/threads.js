// Threads adapter, content-script world. See discover.js for the adapter contract.
// Threads keeps posts in the same Relay JSON as Instagram (<script type="application/json"
// data-sjs>). A video node has video_versions (one progressive H.264 MP4, listed three times)
// and video_dash_manifest (whole-file VP9 video and AAC audio representations up to 1080p).
// Posts that arrive later through GraphQL, and the /embed/ iframe (a bare <video>), are read
// from their permalink page, which carries the data when requested as text/html.
(() => {
  const SITE = 'threads';
  const HOST = /(^|\.)threads\.(?:com|net)$/i;
  const CODE = /^[\w-]{5,80}$/;
  const POST_PATH = /^\/(@[\w.]{1,64})\/post\/([\w-]+)(?:\/(?:media|embed))?\/?$/;
  const CDN = /^https:\/\/[^/?#]+\.(?:cdninstagram\.com|fbcdn\.net)\//;
  const DATA = /video_versions|video_dash_manifest/;
  // Feed pages fetch at most this many permalinks per window; the page the user opened
  // always gets its fetch.
  const WINDOW_FETCHES = 20;
  const WINDOW_MS = 5 * 60 * 1000;
  const CONCURRENCY = 2;

  const internals = { buildItem, collectMedia, parseMpd, postPath, progressiveSize, scriptBlobs };
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {})[SITE] = internals;

  // The file is re-injected on every scan; caches survive in the content-script world.
  const state = globalThis.__VDS_THREADS_STATE__ ||= { scripts: new WeakSet(), media: new Map(), seen: new Set(), played: new Map(), requested: new Set(), done: new Set(), recent: [], queue: [], active: 0, emit: undefined };

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {})[SITE] = {
    genericScan: false,
    matches: (location) => HOST.test(location.hostname),
    collect
  };

  function collect({ document, location, emit }) {
    state.emit = emit;
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      if (state.scripts.has(script)) continue;
      state.scripts.add(script);
      collectMedia(script.textContent, state.media, { inDocument: true, seen: state.seen });
    }
    const target = postPath(location.href);
    const keys = new Set();
    // Script data describes the page as first loaded; after in-app navigation it is stale. A
    // post page's data also holds related posts by other accounts, listed only when they play.
    if (!target && loadedHere(location)) for (const media of state.media.values()) if (media.inDocument) keys.add(media.key);
    const posts = new Map(target ? [[target.code, { path: target.path, videos: [] }]] : []);
    const loose = [];
    for (const video of document.querySelectorAll('video')) {
      const url = video.currentSrc || video.src;
      // Embeds sign the same file differently from the post data; the card keeps the URL the
      // player fetched so the network sighting of it lands on the same card.
      if (CDN.test(url) && !state.played.has(new URL(url).pathname)) {
        if (state.played.size > 500) state.played.clear();
        state.played.set(new URL(url).pathname, url);
      }
      const post = videoPost(video) || target;
      if (!post) { loose.push(video); continue; }
      if (!posts.has(post.code)) posts.set(post.code, { path: post.path, videos: [] });
      posts.get(post.code).videos.push(video);
    }
    const canFetch = /^(?:www\.)?threads\.(?:com|net)$/i.test(location.hostname);
    for (const [code, post] of posts) {
      const found = postMedia(code);
      for (const media of found) keys.add(media.key);
      if (found.length) continue;
      // A post the data already describes has no video there; fetching its page again would not help.
      if (canFetch && !state.seen.has(code) && !state.done.has(code)) request(code, post.path, code === target?.code);
      else loose.push(...post.videos);
    }
    const items = [...keys].map(key => buildItem(state.media.get(key)));
    // Without post data (a failed fetch, a video outside any post) the player's own file is listed.
    const listed = new Set([...state.media.values()].flatMap(media => [...media.progressive.keys()]));
    for (const video of loose) {
      const url = video.currentSrc || video.src;
      if (CDN.test(url) && !listed.has(new URL(url).pathname)) items.push({ url, kind: 'direct', mimeType: 'video/mp4' });
    }
    return items;
  }

  // A post's videos: its own, its carousel children and the posts nested in its data (what it
  // quotes, its own thread and replies on its page).
  function postMedia(code) {
    return [...state.media.values()].filter(media => media.code === code || media.parent === code || media.owner === code);
  }

  function request(code, path, urgent) {
    if (state.requested.has(code)) return;
    const now = Date.now();
    state.recent = state.recent.filter(time => now - time < WINDOW_MS);
    if (!urgent && state.recent.length >= WINDOW_FETCHES) return;
    state.recent.push(now);
    state.requested.add(code);
    if (urgent) state.queue.unshift({ code, path });
    else state.queue.push({ code, path });
    pump();
  }

  function pump() {
    while (state.active < CONCURRENCY && state.queue.length) {
      const { code, path } = state.queue.shift();
      state.active += 1;
      fetchPost(code, path).catch(() => {}).finally(() => { state.done.add(code); state.active -= 1; pump(); });
    }
  }

  async function fetchPost(code, path) {
    const response = await fetch(path, { credentials: 'include', headers: { accept: 'text/html' } });
    if (!response.ok) return;
    for (const text of scriptBlobs(await response.text())) collectMedia(text, state.media, { seen: state.seen });
    const found = postMedia(code);
    if (found.length) state.emit?.(found.map(buildItem));
  }

  // The post around a feed video links to its permalink before any post it quotes.
  function videoPost(video) {
    let node = video.parentElement;
    for (let depth = 0; node && depth < 25; depth += 1, node = node.parentElement) {
      for (const link of node.querySelectorAll('a[href*="/post/"]')) {
        const post = postPath(link.getAttribute('href'));
        if (post) return post;
      }
    }
    return null;
  }

  // /@user/post/CODE, optionally followed by /media or /embed.
  function postPath(href) {
    let url;
    try { url = new URL(href, 'https://www.threads.com/'); } catch { return null; }
    if (!HOST.test(url.hostname)) return null;
    const [, user, code] = POST_PATH.exec(url.pathname) || [];
    return code && CODE.test(code) ? { code, path: `/${user}/post/${code}` } : null;
  }

  function scriptBlobs(html) {
    return [...String(html).matchAll(/<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(text => DATA.test(text));
  }

  // Walks Relay JSON and merges every media node that has video into `media`, keyed by code
  // (or pk). `parent` is the carousel a child belongs to, `owner` the nearest post around a
  // node (the post that quotes it or that it continues).
  function collectMedia(text, media = new Map(), { inDocument = false, seen } = {}) {
    if (!DATA.test(text || '')) return media;
    let root;
    try { root = JSON.parse(text); } catch { return media; }
    const numbers = new Map();
    let budget = 200000;
    const walk = (value, context, depth) => {
      if (!value || typeof value !== 'object' || depth > 80 || --budget < 0) return;
      if (Array.isArray(value)) { for (const child of value) walk(child, context, depth + 1); return; }
      mergeMedia(media, value, context, inDocument, numbers.get(value));
      const code = CODE.test(value.code || '') ? value.code : '';
      if (code && 'media_type' in value) seen?.add(code);
      let next = code ? { ...context, owner: code } : context;
      if (Array.isArray(value.carousel_media)) {
        next = { ...next, parent: code || context.parent, caption: caption(value) || context.caption, user: username(value) || context.user };
        // Several videos in one carousel are told apart by number.
        const videos = value.carousel_media.filter(hasVideo);
        if (videos.length > 1) videos.forEach((child, index) => numbers.set(child, index + 1));
      }
      for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, next, depth + 1);
    };
    walk(root, {}, 0);
    return media;
  }

  function hasVideo(node) {
    return Boolean(node?.video_versions?.length || node?.video_dash_manifest);
  }

  function mergeMedia(media, node, context, inDocument, number) {
    const versions = Array.isArray(node.video_versions) ? node.video_versions.filter(version => cdnUrl(version?.url)) : [];
    const mpd = typeof node.video_dash_manifest === 'string' ? parseMpd(node.video_dash_manifest) : undefined;
    if (!versions.length && !mpd?.video.length) return;
    const code = CODE.test(node.code || '') ? node.code : '';
    const pk = String(node.pk ?? String(node.id ?? '').split('_')[0]);
    const key = code || (/^\d+$/.test(pk) ? pk : '');
    if (!key) return;
    const item = media.get(key) || { key, progressive: new Map(), dash: { video: new Map(), audio: new Map() } };
    media.set(key, item);
    item.code ||= code;
    item.parent ||= context.parent;
    if (context.owner !== code) item.owner ||= context.owner;
    item.number ||= number;
    if (inDocument) item.inDocument = true;
    // Signed URLs differ per occurrence; keying by path keeps the first one and the card stable.
    for (const version of versions) {
      const path = new URL(version.url).pathname;
      if (!item.progressive.has(path)) item.progressive.set(path, { url: version.url, width: positive(version.width), height: positive(version.height), type: positive(version.type) });
    }
    for (const rep of mpd?.video || []) if (!item.dash.video.has(rep.id)) item.dash.video.set(rep.id, rep);
    for (const rep of mpd?.audio || []) if (!item.dash.audio.has(rep.id)) item.dash.audio.set(rep.id, rep);
    item.width ||= positive(node.original_width) || positive(versions[0]?.width);
    item.height ||= positive(node.original_height) || positive(versions[0]?.height);
    item.duration ||= positive(node.video_duration) || mpd?.duration;
    if (typeof node.has_audio === 'boolean') item.hasAudio ??= node.has_audio;
    item.thumbnail ||= [...(Array.isArray(node.image_versions2?.candidates) ? node.image_versions2.candidates.map(candidate => candidate?.url) : []), node.display_uri, node.thumbnail_src].find(cdnUrl);
    item.title ||= caption(node) || context.caption;
    item.user ||= username(node) || context.user;
  }

  function buildItem(media) {
    const variants = [];
    for (const [path, version] of media.progressive) {
      const size = version.width && version.height ? { width: version.width, height: version.height } : progressiveSize(version.url, media.width, media.height);
      let id = `p${version.type || variants.length}`;
      if (variants.some(variant => variant.id === id)) id = `p${variants.length}`;
      variants.push({ id, url: state.played.get(path) || version.url, kind: 'direct', mimeType: 'video/mp4', container: 'mp4', ...size, duration: media.duration, hasAudio: media.hasAudio !== false, hasVideo: true });
    }
    // DASH representations are video-only or audio-only files that the pipeline muxes, so they
    // are only offered above the size of the progressive file.
    const best = Math.max(0, ...variants.map(shortSide));
    const reps = new Map();
    for (const rep of media.dash.video.values()) {
      const size = shortSide(rep);
      const current = reps.get(size);
      if ((size > best || !best) && (!current || (rep.bandwidth || 0) > (current.bandwidth || 0))) reps.set(size, rep);
    }
    const audio = [...media.dash.audio.values()].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
    for (const rep of reps.values()) {
      variants.push({
        id: `dash-${rep.id}`, url: rep.url, audioUrl: audio?.url, kind: 'direct', mimeType: 'video/mp4', container: 'mp4',
        width: rep.width, height: rep.height, bitrate: (rep.bandwidth || 0) + (audio?.bandwidth || 0) || undefined,
        codecs: [rep.codecs, audio?.codecs].filter(Boolean).join(', '), duration: media.duration, hasAudio: Boolean(audio), hasVideo: true
      });
    }
    variants.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
    media.primary ||= variants.find(variant => !variant.id.startsWith('dash-')) || variants[0];
    return {
      url: media.primary.url,
      audioUrl: media.primary.audioUrl,
      kind: 'direct',
      mimeType: 'video/mp4',
      title: media.number && media.title ? `${shorten(media.title, 90)} (${media.number})` : media.title || '',
      author: media.user ? `@${media.user}` : undefined,
      thumbnail: media.thumbnail,
      width: media.width,
      height: media.height,
      duration: media.duration,
      variants
    };
  }

  // The manifests are static, single-period and use one BaseURL per representation.
  function parseMpd(xml) {
    const result = { video: [], audio: [], duration: undefined };
    if (typeof xml !== 'string') return result;
    result.duration = isoDuration(attr(/<MPD\b([^>]*)>/.exec(xml)?.[1], 'mediaPresentationDuration'));
    for (const [, setAttrs, body] of xml.matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/g)) {
      for (const [, repAttrs, repBody = ''] of body.matchAll(/<Representation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Representation>)/g)) {
        const url = cdnUrl(decodeXml(/<BaseURL>([^<]+)<\/BaseURL>/.exec(repBody)?.[1]?.trim()));
        if (!url) continue;
        const mimeType = attr(repAttrs, 'mimeType') || attr(setAttrs, 'mimeType');
        const codecs = attr(repAttrs, 'codecs') || attr(setAttrs, 'codecs');
        const type = mimeType.split('/')[0] || attr(setAttrs, 'contentType') || (/mp4a|opus|ac-3|ec-3/.test(codecs) ? 'audio' : 'video');
        const rep = { id: attr(repAttrs, 'id') || url, url, mimeType, codecs, bandwidth: positive(attr(repAttrs, 'bandwidth')), width: positive(attr(repAttrs, 'width')), height: positive(attr(repAttrs, 'height')) };
        if (type === 'audio') result.audio.push(rep);
        else if (type === 'video') result.video.push(rep);
      }
    }
    return result;
  }

  // video_versions carry no size. The efg query parameter is base64 JSON whose vencode_tag
  // names the file's width: "xpv_progressive.INSTAGRAM.FEED.C3.1280.dash_baseline_1_v1" is
  // 1280x720 for a 1920x1080 upload and "...C3.720..." is 720x1280 for a 1080x1920 one.
  function progressiveSize(url, width, height) {
    let encoded;
    try {
      const tag = JSON.parse(atob(new URL(url).searchParams.get('efg') || '')).vencode_tag || '';
      encoded = Number(/\.C\d+\.(\d{3,4})\./.exec(tag)?.[1]) || undefined;
    } catch {}
    if (!encoded || !width || !height) return { width, height };
    return { width: encoded, height: Math.round((encoded * height) / width / 2) * 2 };
  }

  function caption(node) {
    const text = typeof node.caption === 'string' ? node.caption : node.caption?.text;
    // Captions carry invisible separators (U+2063) at line ends.
    return typeof text === 'string' ? text.replace(/[​-‏⁠-⁤﻿]/g, '').split('\n').map(line => line.trim()).find(Boolean)?.slice(0, 160) || '' : '';
  }

  function username(node) {
    const name = node.user?.username || node.owner?.username;
    return typeof name === 'string' ? name : '';
  }

  // Cuts at a word so the shared title cleanup (100 characters) keeps a number appended after it.
  function shorten(text, max) {
    const characters = [...text];
    if (characters.length <= max) return text;
    const cut = characters.slice(0, max).join('');
    const space = cut.lastIndexOf(' ');
    return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
  }

  function shortSide({ width, height }) {
    return Math.min(width || height || 0, height || width || 0);
  }

  function loadedHere(location) {
    try {
      const first = performance.getEntriesByType('navigation')[0]?.name;
      return !first || new URL(first).pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '');
    } catch { return true; }
  }

  function cdnUrl(value) {
    return typeof value === 'string' && CDN.test(value) ? value : '';
  }

  function attr(attrs, name) {
    return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs || '')?.[1] || '';
  }

  function decodeXml(value) {
    return String(value || '').replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity, code) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[code.toLowerCase()]
      ?? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))));
  }

  function isoDuration(value) {
    const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value || '');
    const seconds = match ? (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0) : 0;
    return seconds > 0 ? seconds : undefined;
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
  }
})();
