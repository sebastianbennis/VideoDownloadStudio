(() => {
  const SOURCE = 'VideoDownloadStudio';
  const MESSAGE_TYPE = 'page-media';
  const SITE_MESSAGE_TYPE = 'page-site-media';
  const MAX_ITEMS_PER_BATCH = 40;
  const MAX_TITLE = 240;
  const MEDIA_EXT = /\.(mp4|m4v|webm|mov|mp3|m4a|aac|ogg|ogv|opus|wav|ts)(?:$|[?#])/i;
  const MANIFEST_EXT = /\.(m3u8|mpd)(?:$|[?#])/i;
  const KINDS = new Set(['direct', 'hls', 'dash']);
  const VARIANT_TEXT = ['id', 'kind', 'mimeType', 'container', 'audioMimeType', 'codecs', 'audioLanguage'];
  const VARIANT_NUMBERS = ['width', 'height', 'bitrate', 'fps', 'duration', 'contentLength', 'audioContentLength', 'expiresAt'];
  const ADAPTER_INTERVAL = 1000;
  const seen = new Set();
  let adapterTimer;
  let adapterRanAt = 0;
  let protectedAt = 0;

  const internals = {
    addUrl,
    collectDomMedia,
    collectJsonLd,
    collectScriptUrls,
    inferKind,
    normalizeBridgeItems,
    looksLikeMedia,
    normalizeAdapterItems,
    queryAllDeep,
    bestTitle
  };

  if (globalThis.__VDS_DISCOVERY_TEST__) {
    globalThis.__VDS_DISCOVERY_INTERNALS__ = internals;
    return;
  }

  if (globalThis.__VDS_DISCOVERY_STATE__) { globalThis.__VDS_DISCOVERY_STATE__.rescan(); return; }
  globalThis.__VDS_DISCOVERY_STATE__ = { rescan: () => { seen.clear(); collectAndSend(); } };
  let scheduled;
  const schedule = () => { if (!scheduled) scheduled = setTimeout(() => { scheduled = undefined; collectAndSend(); }, 200); };
  document.addEventListener('loadedmetadata', schedule, true);
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== SOURCE) return;
    if (event.data.type === MESSAGE_TYPE && !siteOwnsScan()) send(normalizeBridgeItems(event.data.items, location.href, document.title || location.hostname));
    else if (event.data.type === SITE_MESSAGE_TYPE) send(normalizeAdapterItems(event.data.items, cleanText(event.data.adapterId, 80) || 'page-site', location.href, document.title || location.hostname));
    else if (event.data.type === 'page-protected' && Date.now() - protectedAt > 5000) {
      protectedAt = Date.now();
      chrome.runtime.sendMessage({ target: 'service', type: 'media.protected' }).catch(() => {});
    }
  });

  collectAndSend();
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    // data-vds-* are written by page-world site adapters for their content-script halves.
    attributeFilter: ['src', 'href', 'poster', 'data-vds-fbid', 'data-vds-sources']
  });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });

  function collectAndSend() {
    const items = [];
    const adapters = matchingSiteAdapters();
    if (!siteOwnsScan(adapters)) {
      collectDomMedia(document, location.href, document.title || location.hostname, items);
      collectJsonLd(document, location.href, document.title || location.hostname, items);
      collectScriptUrls(document, location.href, document.title || location.hostname, items);
    }
    send(items);
    if (adapters.length) scheduleSiteAdapters();
  }

  // Site adapters (src/content/sites/*.js) register { matches(location), collect(context), pageWorld?, genericScan? }
  // in globalThis.__VDS_SITE_ADAPTERS__. collect returns items or a promise of items, and may call
  // context.emit(items) later. Items: { url, title, thumbnail, kind, mimeType, width, height,
  // duration, audioUrl, variants: [{ url, audioUrl, width, height, bitrate, ... }] }.
  function scheduleSiteAdapters() {
    if (adapterTimer) return;
    adapterTimer = setTimeout(runSiteAdapters, Math.max(0, adapterRanAt + ADAPTER_INTERVAL - Date.now()));
  }

  // An adapter can own its site completely when generic matches there are only fragments or
  // page decorations; that covers the page-world generic scan too.
  function siteOwnsScan(adapters = matchingSiteAdapters()) {
    return adapters.some(([, adapter]) => adapter.genericScan === false);
  }

  function matchingSiteAdapters() {
    return Object.entries(globalThis.__VDS_SITE_ADAPTERS__ || {}).filter(([, adapter]) => {
      try { return typeof adapter?.collect === 'function' && Boolean(adapter.matches?.(location)); } catch { return false; }
    });
  }

  function runSiteAdapters() {
    adapterTimer = undefined;
    adapterRanAt = Date.now();
    const title = document.title || location.hostname;
    for (const [id, adapter] of matchingSiteAdapters()) {
      try {
        const emit = (items) => send(normalizeAdapterItems(items, id, location.href, title));
        Promise.resolve(adapter.collect({ document, location, title, emit })).then(emit, () => {});
        // Page-world halves (sites/*.page.js) answer through page-bridge.js.
        if (adapter.pageWorld) window.postMessage({ source: SOURCE, type: 'page-rescan' }, location.origin);
      } catch {
        // One failing site adapter must not stop generic discovery.
      }
    }
  }

  function send(items) {
    const unique = [];
    for (const item of items) {
      // Adapters may re-send an item once more of its formats are known.
      const key = item?.url && [item.url, item.audioUrl || '', item.variants?.length || 0].join('|');
      if (!key || seen.has(key)) continue;
      if (seen.size >= 1000) break;
      seen.add(key);
      unique.push(item);
      if (unique.length >= MAX_ITEMS_PER_BATCH) break;
    }
    if (unique.length) chrome.runtime.sendMessage({ target: 'service', type: 'media.observed', items: unique }).catch(() => {});
  }

  function collectDomMedia(doc, baseUrl, fallbackTitle, items = []) {
    // A media element's own source is media even without a file extension (CDN paths such as
    // LinkedIn's), and players in web components keep their element inside a shadow root.
    for (const node of queryAllDeep(doc, 'video,audio')) {
      const title = bestTitle(node, fallbackTitle);
      const thumbnail = absoluteHttpUrl(node.poster, baseUrl);
      const height = Number.isFinite(node.videoHeight) && node.videoHeight > 0 ? node.videoHeight : undefined;
      addUrl(items, node.currentSrc || node.src, { baseUrl, title, mimeType: node.type || '', thumbnail, height, source: 'dom', media: true });
      for (const source of node.querySelectorAll('source[src]')) {
        addUrl(items, source.src, { baseUrl, title, mimeType: source.type || '', thumbnail, height, source: 'dom', media: true });
      }
    }
    for (const node of doc.querySelectorAll('a[href],source[src]')) {
      addUrl(items, node.href || node.src, {
        baseUrl,
        title: bestTitle(node, fallbackTitle),
        mimeType: node.type || '',
        source: 'dom'
      });
    }
    return items;
  }

  function collectJsonLd(doc, baseUrl, fallbackTitle, items = []) {
    for (const script of [...doc.querySelectorAll('script[type="application/ld+json"]')].slice(0,50)) {
      const text = (script.textContent || '').slice(0, 500000);
      if (!/VideoObject|AudioObject|contentUrl|embedUrl|thumbnailUrl/i.test(text)) continue;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      for (const node of flatten(Array.isArray(parsed) ? parsed : [parsed])) {
        if (!node || typeof node !== 'object') continue;
        const title = cleanText(node.name || node.headline || fallbackTitle, MAX_TITLE);
        const thumbnail = firstString(node.thumbnailUrl);
        addUrl(items, firstString(node.contentUrl) || firstString(node.embedUrl), {
          baseUrl,
          title,
          thumbnail: absoluteHttpUrl(thumbnail, baseUrl),
          source: 'dom'
        });
      }
    }
    return items;
  }

  function collectScriptUrls(doc, baseUrl, fallbackTitle, items = []) {
    for (const script of [...doc.scripts].slice(0,100)) {
      const text = (script.textContent || '').slice(0, 500000);
      if (!/https?:\\?\/\\?\//i.test(text)) continue;
      for (const match of text.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:m3u8|mpd|mp4|webm|m4a|mp3)(?:\?[^"'\\\s<>]*)?/gi)) {
        addUrl(items, match[0].replaceAll('\\/', '/'), { baseUrl, title: fallbackTitle, source: 'dom' });
      }
    }
    return items;
  }

  function normalizeBridgeItems(rawItems, baseUrl, fallbackTitle) {
    const items = [];
    for (const item of (Array.isArray(rawItems) ? rawItems : []).slice(0, MAX_ITEMS_PER_BATCH)) {
      if (!item || typeof item !== 'object') continue;
      addUrl(items, item.url, {
        baseUrl,
        title: cleanText(item.title || fallbackTitle, MAX_TITLE),
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : '',
        thumbnail: absoluteHttpUrl(item.thumbnail, baseUrl),
        adapterId: cleanText(item.adapterId || 'page-bridge', 80),
        source: 'adapter',
        height: Number.isFinite(item.height) && item.height > 0 ? Number(item.height) : undefined,
        protection: item.protection === 'unsupported-drm' ? 'unsupported-drm' : item.protection === 'hls-aes128' ? 'hls-aes128' : 'unknown'
      });
    }
    return items;
  }

  function addUrl(items, rawUrl, options = {}) {
    if (items.length >= 200) return false;
    const url = absoluteHttpUrl(rawUrl, options.baseUrl || location.href);
    if (!url) return false;
    const kind = inferKind(url, options.mimeType || '');
    if (kind === 'direct' && !options.media && !looksLikeMedia(url, options.mimeType || '')) return false;
    items.push({
      url,
      kind,
      title: cleanText(options.title || 'Media', MAX_TITLE),
      mimeType: cleanText(options.mimeType || '', 120) || undefined,
      thumbnail: options.thumbnail || undefined,
      height: options.height,
      protection: options.protection || (kind === 'hls' ? 'unknown' : 'clear'),
      adapterId: options.adapterId || undefined,
      source: options.source === 'adapter' || options.source === 'network' ? options.source : 'dom'
    });
    return true;
  }

  function inferKind(url, mimeType = '') {
    const value = `${url} ${mimeType}`.toLowerCase();
    if (value.includes('.m3u8') || value.includes('mpegurl')) return 'hls';
    if (value.includes('.mpd') || value.includes('dash+xml')) return 'dash';
    return 'direct';
  }

  function looksLikeMedia(url, mimeType = '') {
    return /video|audio|octet-stream/i.test(mimeType) || MEDIA_EXT.test(url) || MANIFEST_EXT.test(url);
  }

  function normalizeAdapterItems(rawItems, adapterId, baseUrl, fallbackTitle) {
    const items = [];
    for (const item of (Array.isArray(rawItems) ? rawItems : []).slice(0, MAX_ITEMS_PER_BATCH)) {
      const url = absoluteHttpUrl(item?.url, baseUrl);
      if (!url) continue;
      const variants = (Array.isArray(item.variants) ? item.variants : []).slice(0, 50).flatMap((variant) => {
        const variantUrl = absoluteHttpUrl(variant?.url, baseUrl);
        if (!variantUrl) return [];
        const clean = { url: variantUrl, audioUrl: absoluteHttpUrl(variant.audioUrl, baseUrl) || undefined };
        for (const key of VARIANT_TEXT) if (typeof variant[key] === 'string') clean[key] = cleanText(variant[key], 160);
        for (const key of VARIANT_NUMBERS) if (Number.isFinite(variant[key]) && variant[key] > 0) clean[key] = Number(variant[key]);
        if (typeof variant.hasAudio === 'boolean') clean.hasAudio = variant.hasAudio;
        if (typeof variant.hasVideo === 'boolean') clean.hasVideo = variant.hasVideo;
        if (clean.kind && !KINDS.has(clean.kind)) delete clean.kind;
        return [clean];
      });
      const mimeType = cleanText(typeof item.mimeType === 'string' ? item.mimeType : '', 120);
      items.push({
        url,
        kind: KINDS.has(item.kind) ? item.kind : inferKind(url, mimeType),
        title: cleanText(item.title || fallbackTitle || 'Media', MAX_TITLE),
        mimeType: mimeType || undefined,
        author: typeof item.author === 'string' ? cleanText(item.author, 80) || undefined : undefined,
        thumbnail: absoluteHttpUrl(item.thumbnail, baseUrl) || undefined,
        audioUrl: absoluteHttpUrl(item.audioUrl, baseUrl) || undefined,
        width: Number.isFinite(item.width) && item.width > 0 ? Number(item.width) : undefined,
        height: Number.isFinite(item.height) && item.height > 0 ? Number(item.height) : undefined,
        duration: Number.isFinite(item.duration) && item.duration > 0 ? Number(item.duration) : undefined,
        variants: variants.length ? variants : undefined,
        protection: item.protection === 'unsupported-drm' ? 'unsupported-drm' : 'clear',
        adapterId: cleanText(adapterId, 80),
        source: 'adapter'
      });
    }
    return items;
  }

  function queryAllDeep(root, selector, found = [], depth = 0) {
    if (!root?.querySelectorAll) return found;
    found.push(...root.querySelectorAll(selector));
    if (depth >= 4 || found.length >= 200) return found;
    for (const host of root.querySelectorAll('*')) {
      if (host.shadowRoot) queryAllDeep(host.shadowRoot, selector, found, depth + 1);
    }
    return found;
  }

  function absoluteHttpUrl(value, baseUrl) {
    if (typeof value !== 'string' || !value || value.length > 8192) return '';
    try {
      const url = new URL(value, baseUrl);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  // A video's own label, then its caption or nearest heading, then the page's title for its main
  // video; a link's own text names the file it points to. The service cleans the result.
  function bestTitle(node, fallback) {
    const own = node.getAttribute?.('title') || usefulLabel(node.getAttribute?.('aria-label')) || (node.tagName === 'A' ? node.textContent : '');
    if (own && own.trim()) return cleanText(own, MAX_TITLE);
    const container = node.closest?.('figure, article, [role="article"], section');
    const caption = container?.querySelector?.('figcaption, h1, h2, h3, [itemprop="name"]')?.textContent;
    if (caption && caption.trim()) return cleanText(caption, MAX_TITLE);
    const meta = node.ownerDocument?.querySelector?.('meta[property="og:title"], meta[name="twitter:title"]')?.getAttribute('content');
    return cleanText(meta || fallback || 'Media', MAX_TITLE);
  }

  function usefulLabel(value) {
    return /^(?:video|video player|media|media player|player|play|play video|embedded video)$/i.test(String(value || '').trim()) ? '' : value;
  }

  function cleanText(value, max) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function firstString(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.find((item) => typeof item === 'string') || '';
    return '';
  }

  function flatten(nodes, depth = 0) {
    if (depth > 12) return [];
    const result = [];
    for (const node of nodes.slice(0,100)) {
      if (!node || typeof node !== 'object') continue;
      result.push(node);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) result.push(...flatten(value, depth+1));
        else if (value && typeof value === 'object') result.push(...flatten([value], depth+1));
      }
    }
    return result;
  }
})();
