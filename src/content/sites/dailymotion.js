// Dailymotion adapter, content-script world. See discover.js for the adapter contract.
// The player (an iframe on geo.dailymotion.com, on Dailymotion's own pages too) streams HLS through
// MediaSource from tokenized playlists that pages cannot read (CORS), so this only finds which
// videos are shown; the background resolves each id through the player metadata endpoint.
(() => {
  const XID = '(x[0-9a-z]{2,15})';
  const VIDEO_PATH = new RegExp(`^/(?:embed/)?video/${XID}(?:_[^/]*)?/?$`);
  const SHORT_PATH = new RegExp(`^/${XID}/?$`);
  const VIDEO_PARAM = new RegExp(`^${XID}$`);
  const PLAYER_PATH = /^\/player(?:\/[0-9a-z]+)?\.html$/i;
  // The player fetches each video it loads by id; a page script can switch videos without
  // changing the frame's address.
  const PLAYER_FETCH = new RegExp(`^https://(?:[0-9a-z-]+\\.)*dailymotion\\.com/(?:videos|player/metadata/video)/${XID}(?:[/?#]|$)`);
  const BATCH = 8;
  const MAX_PER_SCAN = 16;
  const requested = new Set();
  let queue = Promise.resolve();

  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {}).dailymotion = { videoIdFromUrl, playedVideoIds, frameVideoIds };

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).dailymotion = {
    // Generic matches are pieces of the player's stream (rendition playlists, fragments) or ad
    // manifests; the background lists each video with its title and qualities instead.
    genericScan: false,
    matches: location => isDailymotionHost(location.hostname),
    collect({ location }) {
      const fresh = frameVideoIds(location, globalThis.performance).filter(id => !requested.has(id)).slice(0, MAX_PER_SCAN);
      for (const id of fresh) requested.add(id);
      for (let index = 0; index < fresh.length; index += BATCH) {
        const ids = fresh.slice(index, index + BATCH);
        // The service worker fetches and ingests these for this frame.
        queue = queue.then(() => chrome.runtime.sendMessage({ target: 'service', type: 'site.resolve', siteId: 'dailymotion', request: { ids } })).catch(() => {});
      }
      return [];
    }
  };

  function isDailymotionHost(hostname) {
    return /(^|\.)(dailymotion\.com|dai\.ly)$/i.test(hostname);
  }

  // Video pages, dai.ly links and embed players (player.html?video=, player/<id>.html?video=).
  function videoIdFromUrl(href) {
    try {
      const url = new URL(href);
      if (url.protocol !== 'https:' || !isDailymotionHost(url.hostname)) return '';
      if (/(^|\.)dai\.ly$/i.test(url.hostname)) return url.pathname.match(SHORT_PATH)?.[1] || '';
      if (PLAYER_PATH.test(url.pathname)) return VIDEO_PARAM.exec(url.searchParams.get('video') || '')?.[1] || '';
      return url.pathname.match(VIDEO_PATH)?.[1] || '';
    } catch { return ''; }
  }

  function playedVideoIds(performance) {
    let entries = [];
    try { entries = performance?.getEntriesByType?.('resource') || []; } catch { /* No timeline. */ }
    return [...new Set(entries.map(entry => PLAYER_FETCH.exec(entry?.name || '')?.[1]).filter(Boolean))];
  }

  // A player inside a Dailymotion page belongs to that page, which lists its video from its own
  // address; players embedded elsewhere also list what they loaded.
  function frameVideoIds(location, performance) {
    // The last ancestor is the top page's origin ("null" when its referrer policy hides it).
    const top = Array.from(location.ancestorOrigins || []).pop() || '';
    if (isDailymotionHost(/^https?:\/\/([^/:]+)/.exec(top)?.[1] || '')) return [];
    const ids = [videoIdFromUrl(location.href)].filter(Boolean);
    if (/^geo\.dailymotion\.com$/i.test(location.hostname)) ids.push(...playedVideoIds(performance));
    return [...new Set(ids)];
  }
})();
