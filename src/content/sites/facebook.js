// facebook adapter, content-script world. See discover.js for the adapter contract.
// Facebook keeps video data in Relay JSON (<script type="application/json" data-sjs>).
// videoDeliveryLegacyFields holds progressive MP4s with audio (browser_native_hd_url,
// browser_native_sd_url) and a DASH manifest whose BaseURLs are whole files. Videos that
// arrive later through GraphQL are read from their /watch/?v=<id> page, which only carries
// that data when requested with Accept: text/html. Stories use their own bucket/story identity
// and delivery data from that story's page, not the bucket owner's /watch/ page.
(() => {
  const SITE = 'facebook';
  const ID = /^\d{5,25}$/;
  const CDN = /^https:\/\/[^/?#]+\.fbcdn\.net\//;
  const DATA = /hd_src|sd_src|videoDeliveryLegacyFields|browser_native_(?:hd|sd)_url|playable_url/;
  // Blocks that only hold a video's caption or author still name it as a Video node.
  const LABELS = /"__typename":"Video"/;
  const VIDEO_LINKS = 'a[href*="/videos/"],a[href*="/reel/"],a[href*="v="]';
  // Feed pages fetch at most this many permalinks per window; the page the user opened
  // always gets its fetch.
  const WINDOW_FETCHES = 20;
  const WINDOW_MS = 5 * 60 * 1000;
  const CONCURRENCY = 2;

  const internals = { buildItem, collectVideos, collectStoryVideos, storyIdentity, linkVideoId, metaDescription, parseMpd, progressiveSize, scriptBlobs, videoTitle };
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {})[SITE] = internals;

  // The file is re-injected on every scan; caches survive in the content-script world.
  const state = globalThis.__VDS_FACEBOOK_STATE__ ||= { scripts: new WeakSet(), videos: new Map(), labels: new Map(), requested: new Set(), recent: [], queue: [], active: 0, emit: undefined };
  state.storyScripts ||= new WeakMap();
  state.stories ||= new Map();
  state.storyRequests ||= new Map();

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {})[SITE] = {
    // facebook.page.js tags <video> elements with the video id from the player's React props.
    pageWorld: true,
    genericScan: false,
    matches: (location) => /(^|\.)facebook\.com$/i.test(location.hostname),
    collect
  };

  function collect({ document, location, title, emit }) {
    state.emit = emit;
    state.location = location;
    // A story page can retain feed data and prefetch neighboring stories. Only the exact
    // story in the current address belongs in this scan; an owner id is not a video id.
    if (/^\/stories(?:\/|$)/.test(location.pathname)) {
      const story = storyIdentity(location.href);
      return story ? collectStory(document, location, story) : [];
    }
    for (const script of document.querySelectorAll('script')) {
      if (state.scripts.has(script)) continue;
      state.scripts.add(script);
      for (const text of scriptData(script.textContent)) collectVideos(text, state.videos, { inDocument: true });
    }
    const target = linkVideoId(location.href);
    const ids = new Set(target ? [target] : []);
    // Script data and meta tags describe the page as first loaded; after in-app navigation
    // only data keyed by the new video id still applies.
    const fresh = loadedHere(location);
    if (target) {
      const video = state.videos.get(target);
      if (fresh && video && !video.pageTitle) {
        const embeddedTitle = location.pathname === '/plugins/video.php'
          ? [...document.querySelectorAll('a[href*="/watch/"]')].find(link => linkVideoId(link.href) === target)?.textContent : '';
        video.pageTitle = cleanTitle(embeddedTitle) || metaDescription(document) || pageTitle(title);
      }
    } else {
      if (fresh) for (const video of state.videos.values()) if (video.inDocument) ids.add(video.id);
      for (const id of domVideoIds(document)) ids.add(id);
    }
    const canFetch = /^(www|web)\.facebook\.com$/i.test(location.hostname);
    const items = [];
    for (const id of ids) {
      const video = state.videos.get(id);
      if (canFetch && (!hasMedia(video) || (id === target && !video.hd && !video.dash.video.size))) request(id, id === target);
      if (hasMedia(video)) items.push(buildItem(video));
    }
    // Some players (ads, older embeds) stream a progressive file directly.
    for (const node of document.querySelectorAll('video')) {
      const url = node.currentSrc || node.src;
      if (CDN.test(url)) items.push({ url, title: pageTitle(title) || 'Facebook video', kind: 'direct', mimeType: 'video/mp4' });
    }
    const listed = new Set(items.flatMap(item => item.variants || []).map(variant => new URL(variant.url).pathname));
    return items.filter(item => item.variants || !listed.has(new URL(item.url).pathname));
  }

  function request(id, urgent) {
    if (state.requested.has(id)) return;
    const now = Date.now();
    state.recent = state.recent.filter(time => now - time < WINDOW_MS);
    if (!urgent && state.recent.length >= WINDOW_FETCHES) return;
    state.recent.push(now);
    state.requested.add(id);
    if (urgent) state.queue.unshift(id);
    else state.queue.push(id);
    pump();
  }

  function pump() {
    while (state.active < CONCURRENCY && state.queue.length) {
      const job = state.queue.shift();
      state.active += 1;
      (typeof job === 'string' ? fetchVideo(job) : fetchStory(job)).catch(() => {}).finally(() => { state.active -= 1; pump(); });
    }
  }

  function storyIdentity(href) {
    try {
      const url = new URL(href);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !/(^|\.)facebook\.com$/i.test(url.hostname)) return null;
      const parts = /^\/stories\/(\d{5,25})\/([^/]+)\/?$/.exec(url.pathname);
      if (!parts) return null;
      const id = decodeURIComponent(parts[2]);
      if (!/^[A-Za-z0-9_-]{5,200}={0,2}$/.test(id)) return null;
      return { bucket: parts[1], id, key: `${parts[1]}/${id}`, path: `/stories/${parts[1]}/${encodeURIComponent(id)}/?view_single=1` };
    } catch { return null; }
  }

  function collectStory(document, location, story) {
    for (const script of document.querySelectorAll('script')) {
      if (state.storyScripts.get(script) === story.key) continue;
      state.storyScripts.set(script, story.key);
      rememberStory(story, collectStoryVideos(script.textContent, story));
    }
    const known = state.stories.get(story.key);
    const items = storyItems(story);
    if ((!known || (known.ids.length && !items.length)) && /^(www|web)\.facebook\.com$/i.test(location.hostname)) requestStory(story);
    return items;
  }

  // The live Story response carries data.bucket.unified_stories_with_notes.edges[].node.
  // Walk only JSON containers to find the bucket, then select the exact story before looking
  // at attachments. Photo stories and neighboring video stories never become this card.
  function collectStoryVideos(text, story, videos = state.videos, labels = state.labels) {
    const result = { matched: false, ids: [] };
    if (!story || typeof text !== 'string' || text.length > 8 * 1024 * 1024 || !text.includes('unified_stories_with_notes')) return result;
    let root;
    try { root = JSON.parse(text); } catch { return result; }
    let budget = 200000;
    const walk = (value, depth) => {
      if (!value || typeof value !== 'object' || depth > 80 || --budget < 0) return;
      const edges = value.unified_stories_with_notes?.edges;
      if (String(value.id || '') === story.bucket && Array.isArray(edges)) {
        const author = cleanTitle(value.story_bucket_owner?.name);
        for (const edge of edges.slice(0, 200)) {
          const node = edge?.node;
          if (node?.id !== story.id) continue;
          result.matched = true;
          for (const attachment of (Array.isArray(node.attachments) ? node.attachments : []).slice(0, 20)) {
            const media = attachment?.media;
            const id = String(media?.id || '');
            if (media?.__typename !== 'Video' || !ID.test(id)) continue;
            if (!result.ids.includes(id)) result.ids.push(id);
            mergeVideo(videos, media, false, cleanTitle(node.message?.text));
            rememberLabel(labels, id, cleanTitle(node.message?.text), author);
          }
        }
        return;
      }
      for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, depth + 1);
    };
    walk(root, 0);
    return result;
  }

  function rememberStory(story, found) {
    if (!found.matched) return;
    const previous = state.stories.get(story.key);
    state.stories.set(story.key, { ids: [...new Set([...(previous?.ids || []), ...found.ids])] });
    if (state.stories.size > 200) state.stories.delete(state.stories.keys().next().value);
  }

  function storyItems(story) {
    return (state.stories.get(story.key)?.ids || []).map(id => state.videos.get(id)).filter(hasMedia).map(buildItem);
  }

  function requestStory(story) {
    if (state.storyRequests.has(story.key)) return;
    const now = Date.now();
    state.recent = state.recent.filter(time => now - time < WINDOW_MS);
    if (state.recent.length >= WINDOW_FETCHES) return;
    state.recent.push(now);
    state.storyRequests.set(story.key, now);
    if (state.storyRequests.size > 200) state.storyRequests.delete(state.storyRequests.keys().next().value);
    state.queue.unshift(story);
    pump();
  }

  async function fetchStory(story) {
    // A user may move through several stories while another request is in flight.
    if (storyIdentity(state.location?.href)?.key !== story.key) return;
    const response = await fetch(story.path, {
      credentials: 'include', headers: { accept: 'text/html' }, redirect: 'error',
      signal: globalThis.AbortSignal?.timeout?.(10000)
    });
    if (!response.ok) return;
    const html = await response.text();
    if (html.length > 8 * 1024 * 1024 || storyIdentity(state.location?.href)?.key !== story.key) return;
    for (const [, text] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) rememberStory(story, collectStoryVideos(text, story));
    const items = storyItems(story);
    if (items.length) state.emit?.(items);
  }

  async function fetchVideo(id) {
    const response = await fetch(`/watch/?v=${id}`, { credentials: 'include', headers: { accept: 'text/html' } });
    if (!response.ok) return;
    const html = await response.text();
    for (const text of scriptBlobs(html)) collectVideos(text, state.videos);
    const video = state.videos.get(id);
    if (!hasMedia(video)) return;
    video.pageTitle ||= metaDescription(html);
    if (/^\/stories(?:\/|$)/.test(state.location?.pathname || '')) return;
    state.emit?.([buildItem(video)]);
  }

  function domVideoIds(document) {
    const ids = new Set();
    for (const node of document.querySelectorAll('[data-vds-fbid],[data-video-id]')) {
      const id = node.getAttribute('data-vds-fbid') || node.getAttribute('data-video-id');
      if (ID.test(id || '')) ids.add(id);
    }
    for (const video of document.querySelectorAll('video:not([data-vds-fbid])')) {
      // The nearest post container's permalink names the video it plays.
      let node = video.parentElement;
      for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
        const id = [...node.querySelectorAll(VIDEO_LINKS)].map(link => linkVideoId(link.href)).find(Boolean);
        if (id) { ids.add(id); break; }
      }
    }
    return ids;
  }

  // /watch/?v=ID, /video.php?v=ID, /<page>/videos/[<slug>/]ID, /reel/ID
  function linkVideoId(href, nested = false) {
    let url;
    try { url = new URL(href, 'https://www.facebook.com/'); } catch { return ''; }
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return '';
    if (url.pathname === '/plugins/video.php') return nested ? '' : linkVideoId(url.searchParams.get('href'), true);
    const param = /^\/(?:watch(?:\/live)?\/?|video\.php|video\/video\.php|video\/embed)$/.test(url.pathname) ? url.searchParams.get('v') || url.searchParams.get('video_id') : '';
    const id = param || /\/(?:videos|reel)(?:\/[^/]+)*?\/(\d+)\/?$/.exec(url.pathname)?.[1] || '';
    return ID.test(id) ? id : '';
  }

  function scriptBlobs(html) {
    return [...String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].flatMap(match => scriptData(match[1]));
  }

  // Embedded players use a ServerJS call containing ordinary JSON. Extract its object
  // while respecting quoted braces; the JavaScript wrapper is never executed.
  function scriptData(text) {
    if (!DATA.test(text || '') && !LABELS.test(text || '')) return [];
    const result = [text];
    for (const match of String(text).matchAll(/\bs\.handle\(\s*(?=\{)/g)) {
      const start = match.index + match[0].length;
      let depth = 0, quoted = false, escaped = false;
      for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === '{') depth += 1;
        else if (char === '}' && --depth === 0) { result.push(text.slice(start, index + 1)); break; }
      }
    }
    return result;
  }

  // Walks Relay JSON and merges every video node into `videos`, keyed by video id. The same
  // video appears several times (story, attachment, reel) with different parts of its data.
  function collectVideos(text, videos = new Map(), { inDocument = false, labels = state.labels } = {}) {
    if (!DATA.test(text || '') && !LABELS.test(text || '')) return videos;
    let root;
    try { root = JSON.parse(text); } catch { return videos; }
    let budget = 200000;
    // A story's message is the best title for the video attached to it, and its actor the author.
    const walk = (value, depth, message, author) => {
      if (!value || typeof value !== 'object' || depth > 80 || --budget < 0) return;
      if (Array.isArray(value)) { for (const child of value) walk(child, depth + 1, message, author); return; }
      mergeVideo(videos, value, inDocument, message);
      const next = cleanTitle(value.message?.text) || message;
      const by = cleanTitle(value.actors?.[0]?.name) || cleanTitle(value.owner?.name) || author;
      if (value.__typename === 'Video') rememberLabel(labels, value.id, next, by);
      for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, depth + 1, next, by);
    };
    walk(root, 0, '', '');
    return videos;
  }

  // Logged-in pages send a video's caption and author in other Relay results than its media
  // (creation_story, owner), so they are kept per video id until the card is built.
  function rememberLabel(labels, id, caption, author) {
    const key = String(id ?? '');
    if (!ID.test(key) || (!caption && !author)) return;
    if (labels.size > 2000 && !labels.has(key)) labels.clear();
    const label = labels.get(key) || {};
    label.caption ||= caption;
    label.author ||= author;
    labels.set(key, label);
  }

  function mergeVideo(videos, node, inDocument, message) {
    const legacy = node.videoDeliveryLegacyFields && typeof node.videoDeliveryLegacyFields === 'object' ? node.videoDeliveryLegacyFields : node;
    const delivery = node.videoDeliveryResponseFragment?.videoDeliveryResponseResult;
    const hd = cdnUrl(legacy.browser_native_hd_url) || cdnUrl(legacy.playable_url_quality_hd) || cdnUrl(legacy.hd_src);
    const sd = cdnUrl(legacy.browser_native_sd_url) || cdnUrl(legacy.playable_url) || cdnUrl(legacy.sd_src);
    const manifests = [legacy.dash_manifest_xml_string, legacy.dash_manifest, legacy.manifest_xml,
      ...(Array.isArray(delivery?.dash_manifests) ? delivery.dash_manifests.map(entry => entry?.manifest_xml) : [])].filter(value => typeof value === 'string');
    const progressive = Array.isArray(delivery?.progressive_urls) ? delivery.progressive_urls : [];
    if (!hd && !sd && !manifests.length && !progressive.length) return;
    const id = [node.id, node.videoId, node.video_id, legacy.id].map(value => String(value ?? '')).find(value => ID.test(value));
    if (!id) return;
    const video = videos.get(id) || { id, inDocument, dash: { video: new Map(), audio: new Map() } };
    videos.set(id, video);
    if (inDocument) video.inDocument = true;
    // Signed URLs differ per occurrence; the first one keeps the card's identity stable.
    video.hd ||= hd;
    video.sd ||= sd;
    for (const entry of progressive) {
      const url = cdnUrl(entry?.progressive_url);
      if (url && /hd/i.test(entry?.metadata?.quality || '')) video.hd ||= url;
      else if (url) video.sd ||= url;
    }
    for (const xml of manifests) {
      const mpd = parseMpd(xml);
      for (const rep of mpd.video) if (!video.dash.video.has(rep.id)) video.dash.video.set(rep.id, rep);
      for (const rep of mpd.audio) if (!video.dash.audio.has(rep.id)) video.dash.audio.set(rep.id, rep);
      video.duration ||= mpd.duration;
    }
    // Reels whose music was removed ship progressive files without an audio track.
    if (node.audio_availability === 'AVAILABLE_BUT_MUTED') video.hasAudio = false;
    video.width ||= positive(node.width) || positive(node.original_width);
    video.height ||= positive(node.height) || positive(node.original_height);
    video.duration ||= positive(node.length_in_second) || positive(node.playable_duration_in_ms) / 1000 || undefined;
    video.thumbnail ||= [node.preferred_thumbnail?.image?.uri, node.thumbnailImage?.uri, node.image?.uri].find(value => CDN.test(value || ''));
    video.title ||= [node.title?.text, node.name, node.video_title?.text, node.savable_description?.text].map(cleanTitle).find(Boolean) || message;
  }

  // Only what names the video; the service falls back to the author or the site (shared/titles.js).
  function videoTitle(video, labels = state.labels) {
    const label = labels.get(video.id) || {};
    return video.title || label.caption || video.pageTitle || '';
  }

  function buildItem(video) {
    const variants = [];
    for (const [id, url, fallback] of [['hd', video.hd], ['sd', video.sd, 360]]) {
      if (!url || variants.some(variant => variant.url === url)) continue;
      variants.push({ id, url, kind: 'direct', mimeType: 'video/mp4', container: 'mp4', ...progressiveSize(url, video.width, video.height, fallback), duration: video.duration, hasAudio: video.hasAudio, hasVideo: true });
    }
    // DASH representations are video-only or audio-only files that the pipeline muxes. Progressive
    // H.264 files play everywhere, so DASH (often VP9 or AV1) is only offered above their size.
    const best = Math.max(0, ...variants.map(shortSide));
    const reps = new Map();
    for (const rep of video.dash.video.values()) {
      const size = shortSide(rep);
      const current = reps.get(size);
      if ((size > best || !best) && (!current || (rep.bandwidth || 0) > (current.bandwidth || 0))) reps.set(size, rep);
    }
    const audio = [...video.dash.audio.values()].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
    for (const rep of reps.values()) {
      variants.push({
        id: `dash-${rep.id}`, url: rep.url, audioUrl: audio?.url, kind: 'direct', mimeType: 'video/mp4', container: 'mp4',
        width: rep.width, height: rep.height, bitrate: (rep.bandwidth || 0) + (audio?.bandwidth || 0) || undefined,
        codecs: [rep.codecs, audio?.codecs].filter(Boolean).join(', '), duration: video.duration, hasAudio: Boolean(audio), hasVideo: true
      });
    }
    variants.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
    video.primary ||= variants.find(variant => variant.id === 'hd' || variant.id === 'sd') || variants[0];
    return {
      url: video.primary.url,
      audioUrl: video.primary.audioUrl,
      kind: 'direct',
      mimeType: 'video/mp4',
      title: videoTitle(video),
      author: state.labels.get(video.id)?.author || undefined,
      thumbnail: video.thumbnail,
      width: video.width,
      height: video.height,
      duration: video.duration,
      variants
    };
  }

  // Facebook's DASH manifests are static, single-period and use one BaseURL per representation.
  function parseMpd(xml) {
    const result = { video: [], audio: [], duration: undefined };
    if (typeof xml !== 'string') return result;
    if (!xml.includes('<') && xml.includes('%3C')) { try { xml = decodeURIComponent(xml.replace(/\+/g, ' ')); } catch { return result; } }
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

  // Facebook's efg C3 field is the encoded width. A landscape embed was probed as
  // 1280x720 (C3.1280) and 400x224 (C3.400); it is not always the short side.
  function progressiveSize(url, width, height, fallback) {
    let encodedWidth, short;
    try {
      const tag = JSON.parse(atob(new URL(url).searchParams.get('efg') || '')).vencode_tag || '';
      encodedWidth = Number(/\.C\d+\.(\d{3,4})\./.exec(tag)?.[1]) || undefined;
      short = Number(/_(\d{3,4})p\b/.exec(tag)?.[1]) || undefined;
    } catch {}
    if (encodedWidth && width && height) return { width: encodedWidth, height: Math.floor(encodedWidth * height / width / 2) * 2 };
    short ||= fallback;
    if (!short) return { width: encodedWidth || width, height };
    if (!width || !height) return { height: short };
    const long = Math.round((short * Math.max(width, height)) / Math.min(width, height) / 2) * 2;
    return width <= height ? { width: short, height: long } : { width: long, height: short };
  }

  function metaDescription(source) {
    if (typeof source === 'string') {
      const tag = /<meta\b[^>]*\bproperty="og:description"[^>]*>/.exec(source)?.[0] || /<meta\b[^>]*\bname="description"[^>]*>/.exec(source)?.[0] || '';
      return cleanTitle(decodeXml(/\bcontent="([^"]*)"/.exec(tag)?.[1] || ''));
    }
    return cleanTitle(source?.querySelector?.('meta[property="og:description"],meta[name="description"]')?.getAttribute('content') || '');
  }

  function pageTitle(title) {
    const clean = String(title || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*\|\s*Facebook\s*$/i, '').trim();
    return /^facebook$/i.test(clean) ? '' : clean;
  }

  function cleanTitle(value) {
    // Captions carry invisible separators (U+2063) at line ends.
    return typeof value === 'string' ? value.replace(/[\u200b-\u200f\u2060-\u2064\ufeff]/g, '').split('\n').map(line => line.trim()).find(Boolean)?.slice(0, 160) || '' : '';
  }

  function loadedHere(location) {
    try {
      const first = performance.getEntriesByType('navigation')[0]?.name;
      return !first || new URL(first).pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '');
    } catch { return true; }
  }

  function shortSide({ width, height }) {
    return Math.min(width || height || 0, height || width || 0);
  }

  function hasMedia(video) {
    return Boolean(video && (video.hd || video.sd || video.dash.video.size));
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
