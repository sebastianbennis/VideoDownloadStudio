// A public track page contains the current public API client and its audio transcodings.
(() => {
  // Keep in-flight work serialized, but each explicit scan has fresh discovery state.
  const state = globalThis.__VDS_SOUNDCLOUD_STATE__ = { queue: globalThis.__VDS_SOUNDCLOUD_STATE__?.queue || Promise.resolve() };
  const requested = new Map();
  let currentUrl;
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {}).soundcloud = { trackPathFromUrl };
  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).soundcloud = {
    genericScan: false,
    matches: location => /^(?:(?:www|m)\.)?soundcloud\.com$/i.test(location.hostname),
    collect({ location }) {
      if (currentUrl !== location.href) { requested.clear(); currentUrl = location.href; }
      const path = trackPathFromUrl(location.href);
      if (!path) return [];
      const key = path;
      if (requested.get(key)?.until > Date.now()) return [];
      const entry = { until: Infinity };
      requested.set(key, entry);
      if (requested.size > 100) requested.delete(requested.keys().next().value);
      state.queue = state.queue.then(() => {
        if (globalThis.__VDS_SOUNDCLOUD_STATE__ !== state || requested.get(key) !== entry) return;
        return chrome.runtime.sendMessage({ target: 'service', type: 'site.resolve', siteId: 'soundcloud', request: { path } });
      }).catch(() => null).then(result => {
        const until = (result?.data?.count ?? result?.count) > 0 ? Infinity : Date.now() + 30000;
        if (requested.get(key) === entry) entry.until = until;
      });
      return [];
    }
  };

  function trackPathFromUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !/^(?:(?:www|m)\.)?soundcloud\.com$/i.test(url.hostname) || url.username || url.password || url.port) return '';
      const path = url.pathname.replace(/\/$/, '');
      if (!/^\/[a-zA-Z0-9_-]{1,100}\/[a-zA-Z0-9_-]{1,200}$/.test(path)) return '';
      return /^\/(?:discover|you|search|stations|stream|settings|upload|charts|terms-of-use|pages)\//.test(path) ? '' : path;
    } catch { return ''; }
  }
})();
