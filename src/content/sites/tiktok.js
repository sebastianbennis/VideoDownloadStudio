// TikTok adapter, content-script world. See discover.js for the adapter contract.
// Video pages carry their item in __UNIVERSAL_DATA_FOR_REHYDRATION__. After in-app navigation
// that script still describes the first video, so the current one is read from its own page.
(() => {
  const PAGE = /^\/@([\w.-]{1,64})\/video\/(\d{6,25})\/?$/;
  const DATA = /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;
  const EMBED = /^\/(?:embed(?:\/v2)?|player\/v1)\/(\d{6,25})\/?$/;
  const PROFILE = /^\/(?:embed\/)?@([\w.-]{1,64})\/?$/;
  const WINDOW_MS = 5 * 60 * 1000;
  const WINDOW_FETCHES = 20;
  const state = globalThis.__VDS_TIKTOK_STATE__ ||= { parsedScripts: new WeakMap(), fetched: new Map(), recent: [], queue: [], active: 0, items: new Map() };
  const { parsedScripts, fetched } = state;

  if (globalThis.__VDS_SITE_TEST__) {
    (globalThis.__VDS_SITE_INTERNALS__ ||= {}).tiktok = { itemsFromData, itemFromStruct, pickUrl, embedItems, videoLink };
  }

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).tiktok = {
    matches: location => /(^|\.)tiktok\.com$/i.test(location.hostname),
    // The player streams through MediaSource; the only http media the generic scanners could
    // find are login-page decorations and Referer-locked copies that fail to download.
    genericScan: false,
    collect
  };

  function collect({ document, location }) {
    const [, user, id] = PAGE.exec(location.pathname) || [];
    const embedId = EMBED.exec(location.pathname)?.[1];
    const profile = PROFILE.exec(location.pathname)?.[1];
    if (!id && !embedId && !profile) return [];
    const read = name => {
      const script = document.getElementById(name);
      if (script && !parsedScripts.has(script)) parsedScripts.set(script, parseData(script.textContent));
      return parsedScripts.get(script);
    };
    const data = read('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (id) {
      const own = itemsFromData(data, id);
      return own ? stableItems(own, [id]) : fetchItems(location.origin, user, id, true);
    }
    const embedded = embedItems(read('__FRONTITY_CONNECT_STATE__'), location.pathname);
    if (embedded.length) return stableItems(embedded.map(entry => entry.item), embedded.map(entry => entry.id));
    // The current /player/v1 player loads its data asynchronously. Its public v2 embed
    // names the same video and provides a compact JSON response without an API token.
    if (embedId) return fetchItems(location.origin, '', embedId, true);
    const own = data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
    const structs = own?.user?.uniqueId === profile && Array.isArray(own.itemList) ? own.itemList : [];
    const entries = new Map(structs.slice(0, 40).flatMap(item => {
      const parsed = itemFromStruct(item);
      return parsed && /^\d{6,25}$/.test(String(item.id)) ? [[String(item.id), parsed]] : [];
    }));
    const requests = [];
    const seen = new Set(entries.keys());
    for (const link of document.querySelectorAll?.('a[href*="/video/"]') || []) {
      const target = videoLink(link.href, location.href);
      if (!target || target.user !== profile || seen.has(target.id)) continue;
      seen.add(target.id);
      requests.push(fetchItems(location.origin, target.user, target.id, false));
      if (requests.length >= WINDOW_FETCHES) break;
    }
    const items = stableItems([...entries.values()], [...entries.keys()]);
    const pageUrl = location.href;
    return requests.length ? Promise.all(requests).then(found => location.href === pageUrl ? [...items, ...found.flat()] : []) : items;
  }

  function videoLink(href, base) {
    try {
      const url = new URL(href, base);
      if (url.protocol !== 'https:' || !/(^|\.)tiktok\.com$/i.test(url.hostname)) return null;
      const [, user, id] = PAGE.exec(url.pathname) || [];
      return id ? { user, id } : null;
    } catch { return null; }
  }

  function fetchItems(origin, user, id, urgent) {
    if (fetched.has(id)) return fetched.get(id);
    const now = Date.now();
    state.recent = state.recent.filter(at => now - at < WINDOW_MS);
    if (!urgent && state.recent.length >= WINDOW_FETCHES) return Promise.resolve([]);
    state.recent.push(now);
    const task = new Promise(done => state.queue.push({ origin, user, id, done }));
    fetched.set(id, task);
    if (fetched.size > 100) fetched.delete(fetched.keys().next().value);
    pump();
    return task;
  }

  function pump() {
    while (state.active < 2 && state.queue.length) {
      const { origin, user, id, done } = state.queue.shift();
      state.active += 1;
      const path = user ? `/@${user}/video/${id}` : `/embed/v2/${id}`;
      fetch(`${origin}${path}`, { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
        .then(response => response.ok ? response.text() : '')
        .then(html => {
          const own = itemsFromData(parseData(DATA.exec(html)?.[1]), id);
          if (own) return stableItems(own, [id]);
          const text = /<script[^>]+id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
          const entries = embedItems(parseData(text), `/embed/v2/${id}`);
          return stableItems(entries.map(entry => entry.item), entries.map(entry => entry.id));
        }, () => []).then(done, () => done([])).finally(() => { state.active -= 1; pump(); });
    }
  }

  function stableItems(items, ids) {
    return items.map((item, index) => {
      const id = ids[index];
      if (!state.items.has(id)) state.items.set(id, item);
      if (state.items.size > 100) state.items.delete(state.items.keys().next().value);
      return state.items.get(id) || item;
    });
  }

  function embedItems(data, pathname) {
    const entry = data?.source?.data?.[pathname.replace(/\/$/, '')];
    if (!entry || entry.customErrorCode || entry.userInfo?.privateAccount) return [];
    const target = EMBED.exec(pathname)?.[1];
    const info = entry.videoData?.itemInfos;
    const list = target ? (String(info?.id) === target && !info.secret && !info.forFriend ? [{
      id: info.id, desc: info.text, author: entry.videoData.authorInfos,
      video: { ...info.video?.videoMeta, originCover: info.coversOrigin?.[0], cover: info.covers?.[0], PlayAddrStruct: { UrlList: info.video?.urls } }
    }] : []) : (Array.isArray(entry.videoList) ? entry.videoList.slice(0, 40).filter(item => !item.privateItem).map(item => ({
      id: item.id, desc: item.desc, author: { uniqueId: item.authorUniqueId },
      video: { width: item.width, height: item.height, originCover: item.originCoverUrl, cover: item.coverUrl, PlayAddrStruct: { UrlList: [item.playAddr] } }
    })) : []);
    return list.flatMap(item => {
      const parsed = itemFromStruct(item);
      return parsed && /^\d{6,25}$/.test(String(item.id)) ? [{ id: String(item.id), item: parsed }] : [];
    });
  }

  function parseData(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  // Returns null when the data describes another video, so the caller looks elsewhere.
  function itemsFromData(data, id) {
    const item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    if (!item || String(item.id) !== id) return null;
    const result = itemFromStruct(item);
    return result ? [result] : [];
  }

  function itemFromStruct(item) {
    const video = item?.video;
    if (!video || typeof video !== 'object') return null;
    const duration = positive(video.duration);
    const rates = Array.isArray(video.bitrateInfo) && video.bitrateInfo.length ? video.bitrateInfo
      : [{ GearName: 'play', PlayAddr: { ...video.PlayAddrStruct, Width: video.width, Height: video.height }, Bitrate: video.bitrate, CodecType: video.codecType }];
    const variants = rates.flatMap((rate, index) => {
      const play = rate?.PlayAddr || {};
      const url = pickUrl(play.UrlList);
      const codec = String(rate?.CodecType || '');
      // bytevc2 renditions do not decode in Chrome.
      if (!url || /bytevc2|h266/i.test(codec)) return [];
      return [{
        id: String(rate.GearName || play.UrlKey || index).slice(0, 80),
        url,
        kind: 'direct',
        mimeType: 'video/mp4',
        container: 'mp4',
        codecs: /265|bytevc1|hevc|hvc1/i.test(codec) ? 'hvc1' : /264|avc/i.test(codec) ? 'avc1' : undefined,
        width: positive(play.Width) || undefined,
        height: positive(play.Height) || undefined,
        bitrate: positive(rate.Bitrate) || undefined,
        contentLength: positive(play.DataSize) || undefined,
        duration: duration || undefined, hasAudio: true, hasVideo: true
      }];
    });
    if (!variants.length) return null;
    const short = variant => Math.min(variant.width || variant.height || 0, variant.height || 0);
    // Largest first, H.264 before H.265 of the same size because it plays everywhere.
    variants.sort((a, b) => short(b) - short(a) || (a.codecs === 'hvc1') - (b.codecs === 'hvc1') || (b.bitrate || 0) - (a.bitrate || 0));
    const caption = String(item.desc || '').split('\n').map(line => line.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
    const author = typeof item.author?.uniqueId === 'string' ? item.author.uniqueId : '';
    return {
      url: variants[0].url,
      kind: 'direct',
      mimeType: 'video/mp4',
      title: caption,
      author: author ? `@${author}` : undefined,
      thumbnail: httpUrl(video.originCover) || httpUrl(video.cover) || undefined,
      duration: duration || undefined,
      width: variants[0].width,
      height: variants[0].height,
      variants
    };
  }

  // Every rendition is listed on several hosts. The v16 edge refuses requests without a TikTok
  // Referer, which the extension cannot send, and www.tiktok.com/aweme URLs redirect (downloads
  // reject redirects). The other edges only check the browser's tt_chain_token cookie.
  function pickUrl(list) {
    for (const value of Array.isArray(list) ? list : []) {
      const url = httpUrl(value);
      if (!url) continue;
      const host = new URL(url).hostname;
      if (/(^|\.)tiktok\.com$/.test(host) && !host.startsWith('www.') && !host.startsWith('v16-')) return url;
      // Public embeds use this CDN edge; verified to answer without a Referer.
      if (host === 'v45.tiktokcdn-eu.com') return url;
    }
    return '';
  }

  function httpUrl(value) {
    if (typeof value !== 'string' || value.length > 8192) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }
})();
