(() => {
  const SOURCE = 'VideoDownloadStudio';
  const MESSAGE_TYPE = 'page-media';
  const MAX_ITEMS = 30;
  const MAX_DEPTH = 7;
  const MAX_TEXT = 4096;
  let visits = 0;
  const MEDIA_EXT = /\.(mp4|m4v|webm|mov|mp3|m4a|aac|ogg|ogv|opus|wav|m3u8|mpd)(?:$|[?#])/i;

  const internals = {
    collectPageMedia,
    collectFromValue,
    inferKind,
    normalizeUrl
  };

  if (globalThis.__VDS_PAGE_BRIDGE_TEST__) {
    globalThis.__VDS_PAGE_BRIDGE_INTERNALS__ = internals;
    return;
  }

  const items = collectPageMedia(window, document);
  if (items.length) window.postMessage({ source: SOURCE, type: MESSAGE_TYPE, items }, location.origin);
  runPageSiteAdapters();
  watchProtectedPlayback();
  // discover.js asks again when the page changes; site data such as React props lives here.
  const LISTENING = Symbol.for('vds.page-bridge-listening');
  if (!window[LISTENING]) {
    window[LISTENING] = true;
    let ranAt = 0;
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.source !== SOURCE || event.data.type !== 'page-rescan') return;
      if (Date.now() - ranAt < 900) return;
      ranAt = Date.now();
      runPageSiteAdapters();
    });
  }

  // A player that attached MediaKeys plays DRM-encrypted media, which cannot be saved. Only the
  // fact is reported so the panel can say so; keys, licenses and media are never touched.
  function watchProtectedPlayback() {
    const report = () => window.postMessage({ source: SOURCE, type: 'page-protected' }, location.origin);
    const check = (node) => { try { if (node?.mediaKeys) report(); } catch {} };
    for (const node of document.querySelectorAll('video,audio')) check(node);
    const WATCHING = Symbol.for('vds.protected-watch');
    if (window[WATCHING]) return;
    window[WATCHING] = true;
    document.addEventListener('encrypted', report, true);
    for (const type of ['playing', 'loadedmetadata']) document.addEventListener(type, (event) => check(event.target), true);
  }

  // Page-world site adapters (src/content/sites/*.page.js) register
  // { matches(location), collect({ window, document, location, emit }) } here, keyed by site id.
  function runPageSiteAdapters() {
    for (const [adapterId, adapter] of Object.entries(window[Symbol.for('vds.page-site-adapters')] || {})) {
      try {
        if (typeof adapter?.collect !== 'function' || !adapter.matches?.(location)) continue;
        const emit = (found) => {
          if (Array.isArray(found) && found.length) window.postMessage({ source: SOURCE, type: 'page-site-media', adapterId, items: found.slice(0, MAX_ITEMS) }, location.origin);
        };
        Promise.resolve(adapter.collect({ window, document, location, emit })).then(emit, () => {});
      } catch {
        // Site data shapes change; generic discovery continues.
      }
    }
  }

  function collectPageMedia(win, doc) {
    const items = [];
    const seen = new Set();
    const title = doc?.title || win.location?.hostname || 'Media';
    collectHtml5(win, doc, items, seen, title);
    visits = 0;
    try { collectKnownGlobals(win, items, seen, title); } catch {}
    return items.slice(0, MAX_ITEMS);
  }

  function collectHtml5(win, doc, items, seen, title) {
    if (!doc?.querySelectorAll) return;
    for (const node of doc.querySelectorAll('video,audio,source')) {
      collectUrl(node.currentSrc || node.src, items, seen, { title, mimeType: node.type || '', adapterId: 'html5', baseUrl: win.location?.href });
    }
  }

  function collectKnownGlobals(win, items, seen, title) {
    collectFromValue(win.playerConfig, items, seen, { title, adapterId: 'vimeo', baseUrl: win.location?.href });
    collectFromValue(win.videojs?.players, items, seen, { title, adapterId: 'videojs', baseUrl: win.location?.href });
    collectFromValue(win.bc?.players, items, seen, { title, adapterId: 'brightcove', baseUrl: win.location?.href });
    collectFromValue(win.__brightcoveData, items, seen, { title, adapterId: 'brightcove', baseUrl: win.location?.href });
    collectFromValue(win.__INITIAL_STATE__, items, seen, { title, adapterId: 'page-state', baseUrl: win.location?.href });
    collectJwPlayers(win, items, seen, title);
  }

  function collectJwPlayers(win, items, seen, title) {
    if (typeof win.jwplayer !== 'function') return;
    for (let index = 0; index < 8; index += 1) {
      let player;
      try {
        player = win.jwplayer(index);
      } catch {
        continue;
      }
      if (!player) continue;
      try {
        collectFromValue(player.getPlaylist?.(), items, seen, { title, adapterId: 'jwplayer', baseUrl: win.location?.href });
      } catch {
        // Page player APIs can throw when no instance exists.
      }
    }
  }

  function collectFromValue(value, items, seen, context, depth = 0) {
    if (++visits > 2000 || items.length >= MAX_ITEMS || depth > MAX_DEPTH || value == null) return;
    if (typeof value === 'string') {
      collectUrl(value, items, seen, context);
      return;
    }
    if (typeof value === 'object') { if (seen.has(value)) return; seen.add(value); }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 80)) collectFromValue(item, items, seen, context, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value).slice(0, 120)) {
      if (/drm|widevine|playready|license|token|signature|cipher/i.test(key)) continue;
      const nextContext = {
        ...context,
        title: typeof value.title === 'string' ? value.title : typeof value.name === 'string' ? value.name : context.title,
        mimeType: typeof value.type === 'string' ? value.type : typeof value.mimeType === 'string' ? value.mimeType : context.mimeType
      };
      collectFromValue(child, items, seen, nextContext, depth + 1);
    }
  }

  function collectUrl(value, items, seen, context) {
    if (!isUrlLike(value)) return;
    const url = normalizeUrl(value, context.baseUrl);
    if (!url || seen.has(url)) return;
    if (!MEDIA_EXT.test(url) && !/mpegurl|dash\+xml|video|audio/i.test(context.mimeType || '')) return;
    seen.add(url);
    items.push({
      url,
      kind: inferKind(url, context.mimeType || ''),
      title: cleanText(context.title || 'Media', 240),
      mimeType: cleanText(context.mimeType || '', 120) || undefined,
      adapterId: context.adapterId || 'page-bridge',
      protection: 'unknown'
    });
  }

  function isUrlLike(value) {
    if (typeof value !== 'string') return false;
    return /^(https?:)?\/\//i.test(value) || value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || MEDIA_EXT.test(value);
  }

  function inferKind(url, mimeType = '') {
    const value = `${url} ${mimeType}`.toLowerCase();
    if (value.includes('.m3u8') || value.includes('mpegurl')) return 'hls';
    if (value.includes('.mpd') || value.includes('dash+xml')) return 'dash';
    return 'direct';
  }

  function normalizeUrl(value, baseUrl) {
    if (typeof value !== 'string' || !value || value.length > MAX_TEXT) return '';
    try {
      const url = new URL(value.replaceAll('\\/', '/'), baseUrl || location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function cleanText(value, max) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }
})();
