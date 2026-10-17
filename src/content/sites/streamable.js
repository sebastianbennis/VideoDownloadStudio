// Streamable owns the card so the player switching MP4 renditions cannot add duplicates.
(() => {
  const HOST = /(^|\.)streamable\.com$/i;
  const requested = new Set();

  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {}).streamable = { videoId };
  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).streamable = {
    genericScan: false,
    matches: location => HOST.test(location.hostname),
    collect({ location }) {
      const id = videoId(location.href);
      if (id && !requested.has(id)) {
        requested.add(id);
        // The service ingests these items. Re-injection asks again, using its cached URL.
        chrome.runtime.sendMessage({ target: 'service', type: 'site.resolve', siteId: 'streamable', request: { id } })
          .then(reply => { if (reply?.error) requested.delete(id); }, () => requested.delete(id));
      }
      return [];
    }
  };

  function videoId(href) {
    try {
      const url = new URL(href);
      if (!HOST.test(url.hostname)) return '';
      return url.pathname.match(/^\/(?:[es]\/)?([a-z0-9_]{1,32})(?:\/|$)/i)?.[1] || '';
    } catch { return ''; }
  }
})();
