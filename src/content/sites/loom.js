// Loom exposes signed playback sources through its own public video endpoint.
(() => {
  // Keep in-flight work serialized, but each explicit scan has fresh discovery state.
  const state = globalThis.__VDS_LOOM_STATE__ = { queue: globalThis.__VDS_LOOM_STATE__?.queue || Promise.resolve() };
  const requested = new Map();
  let currentUrl;
  const ownHost = hostname => /(^|\.)loom\.com$/i.test(hostname);
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {}).loom = { videoId };
  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).loom = {
    genericScan: false,
    matches: location => ownHost(location.hostname),
    collect({ location }) {
      if (currentUrl !== location.href) { requested.clear(); currentUrl = location.href; }
      // A Loom page owns its iframe; external embeds own their own card.
      if (Array.from(location.ancestorOrigins || []).some(origin => {
        try { return ownHost(new URL(origin).hostname); } catch { return false; }
      })) return [];
      const id = videoId(location.href);
      if (!id) return [];
      const key = id;
      if (requested.get(key)?.until > Date.now()) return [];
      const entry = { until: Infinity };
      requested.set(key, entry);
      if (requested.size > 100) requested.delete(requested.keys().next().value);
      state.queue = state.queue.then(() => {
        if (globalThis.__VDS_LOOM_STATE__ !== state || requested.get(key) !== entry) return;
        return chrome.runtime.sendMessage({ target: 'service', type: 'site.resolve', siteId: 'loom', request: { id } });
      }).catch(() => null).then(result => {
        const until = (result?.data?.count ?? result?.count) > 0 ? Infinity : Date.now() + 30000;
        if (requested.get(key) === entry) entry.until = until;
      });
      return [];
    }
  };
  function videoId(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ownHost(url.hostname) ? /^\/(?:share|embed)\/([a-f0-9]{32})\/?$/.exec(url.pathname)?.[1] || '' : '';
    } catch { return ''; }
  }
})();
