// instagram adapter, content-script world. See discover.js for the adapter contract.
// Post data sits in Relay JSON (<script type="application/json" data-sjs>): logged out under
// xig_polaris_media.if_not_gated_logged_out, logged in under xdt_api__v1__media__* items.
// Each media node has video_versions (progressive MP4s with audio) and video_dash_manifest
// (whole-file video and audio representations). Posts that arrive later through GraphQL are
// read from their /p/<shortcode>/ page, which carries the data when requested as text/html.
(() => {
  const SITE = 'instagram';
  const CODE = /^[\w-]{5,80}$/;
  const CDN = /^https:\/\/[^/?#]+\.(?:cdninstagram\.com|fbcdn\.net)\//;
  const DATA = /video_versions|video_dash_manifest|video_url/;
  const POST_LINKS = 'a[href*="/p/"],a[href*="/reel/"],a[href*="/tv/"]';
  // Feed pages fetch at most this many permalinks per window; the page the user opened
  // always gets its fetch.
  const WINDOW_FETCHES = 20;
  const WINDOW_MS = 5 * 60 * 1000;
  const CONCURRENCY = 2;
  const STORY_RETRY_MS = 60 * 1000;

  const internals = { buildItem, collectMedia, parseMpd, progressiveSize, scriptBlobs, shortcode, storyTarget };
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {})[SITE] = internals;

  // The file is re-injected on every scan; caches survive in the content-script world.
  const state = globalThis.__VDS_INSTAGRAM_STATE__ ||= { scripts: new WeakSet(), media: new Map(), requested: new Set(), recent: [], queue: [], active: 0, emit: undefined };
  state.stories ||= new Map();

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {})[SITE] = {
    genericScan: false,
    matches: (location) => /(^|\.)instagram\.com$/i.test(location.hostname),
    collect
  };

  function collect({ document, location, title, emit }) {
    state.emit = emit;
    state.location = location;
    for (const script of document.querySelectorAll('script')) {
      if (state.scripts.has(script)) continue;
      state.scripts.add(script);
      for (const text of scriptData(script.textContent)) collectMedia(text, state.media, { inDocument: true });
    }
    if (isStoryRoute(location)) {
      const story = storyTarget(location.href);
      if (!story) return [];
      const media = state.stories.get(story.key)?.media || findStory(state.media, story);
      if (media) return [buildItem(media)];
      requestStory(story);
      return [];
    }
    const target = shortcode(location.href);
    const keys = new Set();
    const codes = new Set(target ? [target] : []);
    if (!target) {
      // Script data describes the page as first loaded; after in-app navigation it is stale.
      if (loadedHere(location)) for (const media of state.media.values()) if (media.inDocument) keys.add(media.key);
      for (const code of domCodes(document)) codes.add(code);
    }
    const canFetch = /^www\.instagram\.com$/i.test(location.hostname);
    for (const code of codes) {
      const found = postMedia(code);
      for (const media of found) keys.add(media.key);
      if (!found.length && canFetch) request(code, code === target);
    }
    const items = [...keys].map(key => buildItem(state.media.get(key)));
    // Some feed and embed players expose a progressive file directly.
    for (const node of document.querySelectorAll('video')) {
      const url = node.currentSrc || node.src;
      if (CDN.test(url)) items.push({ url, title: String(title || '').trim() || 'Instagram video', kind: 'direct', mimeType: 'video/mp4' });
    }
    const listed = new Set(items.flatMap(item => item.variants || []).map(variant => new URL(variant.url).pathname));
    return items.filter(item => item.variants || !listed.has(new URL(item.url).pathname));
  }

  // A carousel post's videos are its children; they keep the parent's shortcode.
  function postMedia(code) {
    return [...state.media.values()].filter(media => media.code === code || media.parent === code);
  }

  function request(code, urgent) {
    if (state.requested.has(code)) return;
    const now = Date.now();
    state.recent = state.recent.filter(time => now - time < WINDOW_MS);
    if (!urgent && state.recent.length >= WINDOW_FETCHES) return;
    state.recent.push(now);
    state.requested.add(code);
    if (urgent) state.queue.unshift(code);
    else state.queue.push(code);
    pump();
  }

  function pump() {
    while (state.active < CONCURRENCY && state.queue.length) {
      const task = state.queue.shift();
      state.active += 1;
      (typeof task === 'string' ? fetchPost(task) : fetchStory(task)).catch(() => {}).finally(() => {
        if (task.entry) task.entry.pending = false;
        state.active -= 1;
        pump();
      });
    }
  }

  async function fetchPost(code) {
    const response = await fetch(`/p/${code}/`, { credentials: 'include', headers: { accept: 'text/html' } });
    if (!response.ok) return;
    for (const text of scriptBlobs(await response.text())) collectMedia(text, state.media);
    const found = postMedia(code);
    if (found.length && !isStoryRoute(state.location)) state.emit?.(found.map(buildItem));
  }

  function requestStory(story) {
    const now = Date.now();
    const previous = state.stories.get(story.key);
    if (previous?.media || previous?.pending || (previous && now - previous.requestedAt < STORY_RETRY_MS)) return;
    state.recent = state.recent.filter(time => now - time < WINDOW_MS);
    if (state.recent.length >= WINDOW_FETCHES) return;
    state.recent.push(now);
    const entry = { requestedAt: now, pending: true };
    state.stories.set(story.key, entry);
    while (state.stories.size > 100) state.stories.delete(state.stories.keys().next().value);
    state.queue.unshift({ ...story, entry });
    pump();
  }

  async function fetchStory(story) {
    if (storyTarget(state.location?.href)?.key !== story.key) {
      state.stories.delete(story.key);
      return;
    }
    // The current Story's HTML includes Relay media after Instagram's r=1 redirect.
    // Request that exact page, retaining browser-managed same-origin session handling.
    const response = await fetch(`${story.path}?r=1`, {
      credentials: 'same-origin', headers: { accept: 'text/html' }, redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok || storyTarget(response.url)?.key !== story.key) return;
    const media = new Map();
    for (const text of scriptBlobs(await response.text())) collectMedia(text, media);
    const current = findStory(media, story);
    if (!current) return;
    current.user ||= story.user;
    // Neighbouring stories in the response are intentionally not cached or emitted.
    const entry = state.stories.get(story.key);
    if (entry) entry.media = current;
    if (storyTarget(state.location?.href)?.key === story.key) state.emit?.([buildItem(current)]);
  }

  function findStory(media, story) {
    return [...media.values()].find(item => item.id === story.id && (!item.user || item.user.toLowerCase() === story.user.toLowerCase()));
  }

  function isStoryRoute(location) {
    return /^\/stories(?:\/|$)/.test(location?.pathname || '');
  }

  function storyTarget(href) {
    let url;
    try { url = new URL(href); } catch { return undefined; }
    if (url.origin !== 'https://www.instagram.com' || url.username || url.password) return undefined;
    const match = /^\/stories\/([\w.]{1,30})\/(\d{5,25})\/?$/.exec(url.pathname);
    if (!match || match[1].toLowerCase() === 'highlights') return undefined;
    return { user: match[1], id: match[2], key: `${match[1].toLowerCase()}:${match[2]}`, path: `/stories/${match[1]}/${match[2]}/` };
  }

  function domCodes(document) {
    const codes = new Set();
    for (const video of document.querySelectorAll('video')) {
      // The post around a feed video links to its permalink.
      let node = video.parentElement;
      for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
        const code = [...node.querySelectorAll(POST_LINKS)].map(link => shortcode(link.href)).find(Boolean);
        if (code) { codes.add(code); break; }
      }
    }
    return codes;
  }

  // /p/CODE/, /reel/CODE/, /reels/CODE/, /tv/CODE/, optionally behind /<username>.
  function shortcode(href) {
    let url;
    try { url = new URL(href, 'https://www.instagram.com/'); } catch { return ''; }
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return '';
    const code = /^(?:\/[\w.]+)?\/(?:p|reels?|tv)\/([\w-]+)\/?(?:embed(?:\/captioned)?\/?)?$/.exec(url.pathname)?.[1] || '';
    return CODE.test(code) ? code : '';
  }

  function scriptBlobs(html) {
    return [...String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].flatMap(match => scriptData(match[1]));
  }

  // Public embeds carry GraphVideo data as a JSON string inside their ServerJS bootstrap.
  // Parse only that quoted field, never execute the surrounding script.
  function scriptData(text) {
    if (!DATA.test(text || '')) return [];
    const result = [text];
    for (const match of String(text).matchAll(/"contextJSON":("(?:[^"\\]|\\.)*")/g)) {
      try { result.push(JSON.parse(match[1])); } catch {}
    }
    return result;
  }

  // Walks Relay JSON and merges every media node that has video into `media`, keyed by
  // shortcode (or pk for carousel children without one).
  function collectMedia(text, media = new Map(), { inDocument = false } = {}) {
    if (!DATA.test(text || '')) return media;
    let root;
    try { root = JSON.parse(text); } catch { return media; }
    let budget = 200000;
    const walk = (value, context, depth) => {
      if (!value || typeof value !== 'object' || depth > 80 || --budget < 0) return;
      if (Array.isArray(value)) { for (const child of value) walk(child, context, depth + 1); return; }
      mergeMedia(media, value, context, inDocument);
      const code = value.code || value.shortcode || '';
      const next = Array.isArray(value.carousel_media) || Array.isArray(value.edge_sidecar_to_children?.edges)
        ? { parent: CODE.test(code) ? code : context.parent, caption: caption(value) || context.caption, user: username(value) || context.user }
        : Array.isArray(value.items) && username(value) ? { ...context, user: username(value) } : context;
      for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, next, depth + 1);
    };
    walk(root, {}, 0);
    return media;
  }

  function mergeMedia(media, node, context, inDocument) {
    const versions = Array.isArray(node.video_versions) ? node.video_versions.filter(version => cdnUrl(version?.url)) : [];
    if (node.is_video === true && cdnUrl(node.video_url)) versions.push({ url: node.video_url });
    const mpd = typeof node.video_dash_manifest === 'string' ? parseMpd(node.video_dash_manifest) : undefined;
    if (!versions.length && !mpd?.video.length) return;
    const code = CODE.test(node.code || node.shortcode || '') ? node.code || node.shortcode : '';
    const pk = String(node.pk ?? String(node.id ?? '').split('_')[0]);
    const key = code || (/^\d+$/.test(pk) ? pk : '');
    if (!key) return;
    const item = media.get(key) || { key, progressive: new Map(), dash: { video: new Map(), audio: new Map() } };
    media.set(key, item);
    item.code ||= code;
    item.id ||= /^\d+$/.test(pk) ? pk : undefined;
    item.parent ||= context.parent;
    if (inDocument) item.inDocument = true;
    // Signed URLs differ per occurrence; keying by path keeps the first one and the card stable.
    for (const version of versions) {
      const path = new URL(version.url).pathname;
      if (!item.progressive.has(path)) item.progressive.set(path, { url: version.url, width: positive(version.width), height: positive(version.height), type: positive(version.type) });
    }
    for (const rep of mpd?.video || []) if (!item.dash.video.has(rep.id)) item.dash.video.set(rep.id, rep);
    for (const rep of mpd?.audio || []) if (!item.dash.audio.has(rep.id)) item.dash.audio.set(rep.id, rep);
    item.width ||= positive(node.original_width) || positive(node.dimensions?.width) || positive(versions[0]?.width);
    item.height ||= positive(node.original_height) || positive(node.dimensions?.height) || positive(versions[0]?.height);
    item.duration ||= positive(node.video_duration) || mpd?.duration;
    if (typeof node.has_audio === 'boolean') item.hasAudio ??= node.has_audio;
    item.thumbnail ||= [...(Array.isArray(node.image_versions2?.candidates) ? node.image_versions2.candidates.map(candidate => candidate?.url) : []), node.display_uri, node.display_url, node.thumbnail_src].find(cdnUrl);
    item.title ||= caption(node) || context.caption;
    item.user ||= username(node) || context.user;
  }

  function buildItem(media) {
    const variants = [];
    for (const version of media.progressive.values()) {
      const size = version.width && version.height ? { width: version.width, height: version.height } : progressiveSize(version.url, media.width, media.height);
      let id = `p${version.type || variants.length}`;
      if (variants.some(variant => variant.id === id)) id = `p${variants.length}`;
      variants.push({ id, url: version.url, kind: 'direct', mimeType: 'video/mp4', container: 'mp4', ...size, duration: media.duration, hasAudio: media.hasAudio !== false, hasVideo: true });
    }
    // DASH representations are video-only or audio-only files that the pipeline muxes, so they
    // are only offered above the size of the progressive files.
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
      title: media.title || '',
      author: media.user ? `@${media.user}` : undefined,
      thumbnail: media.thumbnail,
      width: media.width,
      height: media.height,
      duration: media.duration,
      variants
    };
  }

  // Instagram's DASH manifests are static, single-period and use one BaseURL per representation.
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

  // The efg C3 field is the encoded width: a logged-in landscape video with
  // C3.1276 was measured as 1276x718, from an original 1916x1078 frame.
  function progressiveSize(url, width, height) {
    let encodedWidth, short;
    try {
      const tag = JSON.parse(atob(new URL(url).searchParams.get('efg') || '')).vencode_tag || '';
      encodedWidth = Number(/\.C\d+\.(\d{3,4})\./.exec(tag)?.[1]) || undefined;
      short = Number(/_(\d{3,4})p\b/.exec(tag)?.[1]) || undefined;
    } catch {}
    if (encodedWidth) return { width: encodedWidth, height: width && height ? Math.round(encodedWidth * height / width / 2) * 2 : undefined };
    if (!short || !width || !height) return { width, height };
    const long = Math.round((short * Math.max(width, height)) / Math.min(width, height) / 2) * 2;
    return width <= height ? { width: short, height: long } : { width: long, height: short };
  }

  function caption(node) {
    const text = typeof node.caption === 'string' ? node.caption : node.caption?.text || node.edge_media_to_caption?.edges?.[0]?.node?.text;
    // Captions carry invisible separators (U+2063) at line ends.
    return typeof text === 'string' ? text.replace(/[\u200b-\u200f\u2060-\u2064\ufeff]/g, '').split('\n').map(line => line.trim()).find(Boolean)?.slice(0, 160) || '' : '';
  }

  function username(node) {
    const name = node.user?.username || node.owner?.username;
    return typeof name === 'string' ? name : '';
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
