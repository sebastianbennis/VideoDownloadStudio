// X (Twitter) adapter, content-script world. See discover.js for the adapter contract.
// The player streams HLS through MediaSource and the page keeps the MP4 renditions in API
// data, so this only finds which tweets show a video; the background resolves each tweet id
// through X's public syndication endpoint and reports the media itself.
// A playing Space is listed from the page's resource timeline, which also records playlists
// served from the HTTP cache, and named by the docked player.
(() => {
  const STATUS_PATH = /\/status(?:es)?\/(\d{1,25})(?:[/?#]|$)/;
  // Classic layout marks players with test ids; the current layout only has <video> and its poster.
  const PLAYERS = 'video,[data-testid="videoPlayer"],[data-testid="videoComponent"],img[src*="_video_thumb/"]';
  const BATCH = 8;
  const MAX_PER_SCAN = 32;
  // The Space's own playlist; renditions sit under /transcode/. Mirrors background/sites/x.js.
  const SPACE_PLAYLIST = /^https:\/\/(?:[\w-]+\.)+video\.pscp\.tv\/Transcoding\/v1\/hls\/[\w-]+\/non_transcode\/[\w-]+\/[\w-]+\/(?:[\w.-]+\/)*[\w.-]+\.m3u8(?:\?[^#]*)?$/;
  // Seconds to wait for the dock to show the Space's title before listing it untitled.
  const SPACE_TITLE_WAIT = 5;
  const MAX_SPACES = 10;
  // Serialize pending work across reinjection; successful IDs belong to one scan and route.
  const previous = globalThis.__VDS_X_STATE__;
  previous?.spaceObserver?.disconnect();
  if (previous?.spaceTimer) clearTimeout(previous.spaceTimer);
  // Spaces outlive reinjection: X navigates in-page while the dock plays (each navigation clears
  // the cards and rescans) and trims its resource timeline, so a played playlist may not reappear.
  const state = globalThis.__VDS_X_STATE__ = { queue: previous?.queue || Promise.resolve(), spaces: previous?.spaces || [], listed: new Set() };
  const requested = new Set();
  let currentUrl;
  let route = {};

  const internals = { statusId, ownStatusId, tweetIdsWithVideo, directVideos, noteSpaces, spaceTitle };
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {}).x = internals;

  try {
    state.spaceObserver = new PerformanceObserver(list => noteSpaces(list.getEntries()));
    state.spaceObserver.observe({ type: 'resource', buffered: true });
  } catch { /* No resource timeline here. */ }

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).x = {
    genericScan: false,
    matches: (location) => /(^|\.)(x|twitter)\.com$/i.test(location.hostname),
    collect({ document, location, title, emit }) {
      state.page = { document, emit };
      if (currentUrl !== location.href) { requested.clear(); currentUrl = location.href; route = {}; }
      const currentRoute = route;
      const fresh = tweetIdsWithVideo(document, location.href).filter(id => !requested.has(id)).slice(0, MAX_PER_SCAN);
      for (const id of fresh) requested.add(id);
      for (let index = 0; index < fresh.length; index += BATCH) {
        const ids = fresh.slice(index, index + BATCH);
        // The service worker fetches and ingests these; the page cannot read the endpoint (CORS).
        state.queue = state.queue.then(() => {
          if (globalThis.__VDS_X_STATE__ !== state || route !== currentRoute) return;
          return chrome.runtime.sendMessage({ target: 'service', type: 'site.resolve', siteId: 'x', request: { ids } });
        }).catch(() => {});
      }
      return [...directVideos(document, title), ...spaceItems(document, false)];
    }
  };

  function noteSpaces(entries) {
    let added = false;
    for (const entry of entries) {
      const url = entry?.name || '';
      if (!SPACE_PLAYLIST.test(url) || state.spaces.some(space => space.url === url)) continue;
      state.spaces.push({ url, title: '' });
      if (state.spaces.length > MAX_SPACES) state.spaces.shift();
      added = true;
    }
    if (added) listSpaces(0);
  }

  // The playlist usually loads just before the dock renders its title, so wait for it a little.
  function listSpaces(attempt) {
    clearTimeout(state.spaceTimer);
    state.spaceTimer = setTimeout(() => {
      const items = state.page?.emit ? spaceItems(state.page.document, attempt >= SPACE_TITLE_WAIT) : [];
      if (items.length) state.page.emit(items);
      if (attempt < SPACE_TITLE_WAIT && state.spaces.some(space => !state.listed.has(space.url))) listSpaces(attempt + 1);
    }, 1000);
  }

  // Each Space keeps the title the dock showed when it was first listed.
  function spaceItems(doc, untitled) {
    const current = spaceTitle(doc);
    const items = [];
    for (const space of state.spaces) {
      if (state.listed.has(space.url)) continue;
      if (!space.untitled) space.title ||= current;
      if (!space.title && !untitled && !space.untitled) continue;
      if (!space.title) space.untitled = true;
      state.listed.add(space.url);
      items.push({ url: space.url, kind: 'hls', mimeType: 'application/x-mpegURL', title: space.title || undefined });
    }
    return items;
  }

  // The docked player (expanded or not) shows the Space's title as its "tweet text".
  function spaceTitle(doc) {
    for (const dock of doc?.querySelectorAll?.('[data-testid*="SpaceDock"]') || []) {
      const text = String(dock.querySelector('[data-testid="tweetText"]')?.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 200);
    }
    return '';
  }

  function statusId(href, base) {
    try {
      const url = new URL(href, base);
      if (!/(^|\.)(x|twitter)\.com$/i.test(url.hostname)) return '';
      const embedded = url.hostname === 'platform.twitter.com' && url.pathname === '/embed/Tweet.html' ? url.searchParams.get('id') : '';
      return /^\d{1,25}$/.test(embedded || '') ? embedded : url.pathname.match(STATUS_PATH)?.[1] || '';
    } catch { return ''; }
  }

  // The tweet an article belongs to: its timestamp link (classic layout) or its first status
  // link outside a nested article, since quoted tweets are nested articles in the current layout.
  function ownStatusId(article, base) {
    const links = [...article.querySelectorAll('a[href*="/status/"]')].filter(link => link.closest('article') === article);
    const link = links.find(item => item.querySelector('time')) || links[0];
    return link ? statusId(link.getAttribute('href'), base) : '';
  }

  function tweetIdsWithVideo(doc, pageUrl) {
    const ids = new Set();
    const pageId = statusId(pageUrl);
    // The embedded player can defer creating its <video> until it is clicked.
    if (pageId && /^https:\/\/platform\.twitter\.com\/embed\/Tweet\.html[?#]/.test(pageUrl)) ids.add(pageId);
    for (const node of doc.querySelectorAll(PLAYERS)) {
      const article = node.closest('article');
      // Outside an article (media viewer) the video belongs to the status in the address.
      const id = article ? ownStatusId(article, pageUrl) : pageId;
      if (id) ids.add(id);
    }
    return [...ids];
  }

  // Animated GIFs play from a plain MP4 URL, so they are known before the background answers.
  function directVideos(doc, title) {
    const items = [];
    for (const video of doc.querySelectorAll('video')) {
      const url = video.currentSrc || video.src || '';
      if (!/^https:\/\/video\.twimg\.com\/tweet_video\/[^/?#]+\.mp4(?:[?#]|$)/.test(url)) continue;
      items.push({ url, kind: 'direct', mimeType: 'video/mp4', title, thumbnail: video.poster || undefined });
    }
    return items;
  }
})();
