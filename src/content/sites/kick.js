// Kick VODs and clips resolve through the public player API, without copying login tokens.
(() => {
  // Keep in-flight work serialized, but each explicit scan has fresh discovery state.
  const state = globalThis.__VDS_KICK_STATE__ = { queue: globalThis.__VDS_KICK_STATE__?.queue || Promise.resolve() };
  const requested = new Map();
  let currentUrl;
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {}).kick = { mediaFromUrl };
  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).kick = {
    genericScan: false,
    matches: location => /^(?:www\.)?kick\.com$/i.test(location.hostname),
    collect({ location }) {
      if (currentUrl !== location.href) { requested.clear(); currentUrl = location.href; }
      const media = mediaFromUrl(location.href);
      if (!media) return [];
      const key = `${media.type}:${media.id}`;
      if (requested.get(key)?.until > Date.now()) return [];
      const entry = { until: Infinity };
      requested.set(key, entry);
      if (requested.size > 100) requested.delete(requested.keys().next().value);
      state.queue = state.queue.then(() => {
        if (globalThis.__VDS_KICK_STATE__ !== state || requested.get(key) !== entry) return;
        return chrome.runtime.sendMessage({ target: 'service', type: 'site.resolve', siteId: 'kick', request: media });
      }).catch(() => null).then(result => {
        const until = (result?.data?.count ?? result?.count) > 0 ? Infinity : Date.now() + 30000;
        if (requested.get(key) === entry) entry.until = until;
      });
      return [];
    }
  };

  function mediaFromUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !/^(?:www\.)?kick\.com$/i.test(url.hostname) || url.username || url.password || url.port) return null;
      const vod = /^\/[\w-]+\/videos\/([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})\/?$/i.exec(url.pathname)?.[1];
      if (vod) return { type: 'vod', id: vod.toLowerCase() };
      const clip = /^\/[\w-]+\/clips\/(clip_[\w-]{10,100})\/?$/.exec(url.pathname)?.[1]
        || (/^\/[\w-]+\/?$/.test(url.pathname) ? url.searchParams.get('clip') : '');
      return /^clip_[\w-]{10,100}$/.test(clip || '') ? { type: 'clip', id: clip } : null;
    } catch { return null; }
  }
})();
