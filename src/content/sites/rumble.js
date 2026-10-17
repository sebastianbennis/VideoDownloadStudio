// The Rumble player metadata lists complete renditions; generic scans also find previews.
(() => {
  // Keep in-flight work serialized, but each explicit scan has fresh discovery state.
  const state = globalThis.__VDS_RUMBLE_STATE__ = { queue: globalThis.__VDS_RUMBLE_STATE__?.queue || Promise.resolve() };
  const requested = new Map();
  let currentUrl;
  const ID = /^v[0-9a-z]{2,15}$/;
  const ownHost = hostname => /(^|\.)rumble\.com$/i.test(hostname);
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {}).rumble = { embedId, videoIds };
  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).rumble = {
    genericScan: false,
    matches: location => ownHost(location.hostname),
    collect({ document, location }) {
      if (currentUrl !== location.href) { requested.clear(); currentUrl = location.href; }
      const ids = videoIds(document, location).filter(id => !requested.has(id) || requested.get(id).until <= Date.now()).slice(0, 8);
      if (!ids.length) return [];
      const entries = ids.map(id => { const entry = { until: Infinity }; requested.set(id, entry); return entry; });
      while (requested.size > 100) requested.delete(requested.keys().next().value);
      state.queue = state.queue.then(() => {
        if (globalThis.__VDS_RUMBLE_STATE__ !== state || ids.some((id, index) => requested.get(id) !== entries[index])) return;
        return chrome.runtime.sendMessage({ target: 'service', type: 'site.resolve', siteId: 'rumble', request: { ids } });
      }).catch(() => null).then(result => {
        const until = (result?.data?.count ?? result?.count) > 0 ? Infinity : Date.now() + 30000;
        ids.forEach((id, index) => { if (requested.get(id) === entries[index]) entries[index].until = until; });
      });
      return [];
    }
  };

  function embedId(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !ownHost(url.hostname)) return '';
      const id = /^\/embed\/(?:[a-z0-9]+\.)?(v[a-z0-9]+)(?:\/|$)/i.exec(url.pathname)?.[1] || '';
      return ID.test(id) ? id : '';
    } catch { return ''; }
  }

  function videoIds(document, location) {
    // The containing Rumble page owns its player, so embedded copies do not make extra cards.
    if (Array.from(location.ancestorOrigins || []).some(origin => {
      try { return ownHost(new URL(origin).hostname); } catch { return false; }
    })) return [];
    const direct = embedId(location.href);
    if (direct) return [direct];
    const ids = new Set();
    for (const frame of document.querySelectorAll('iframe[src]')) {
      const id = embedId(frame.getAttribute('src'));
      if (id) ids.add(id);
    }
    for (const script of document.querySelectorAll('script:not([src])')) {
      const text = script.textContent || '';
      if (text.length > 2000000) continue;
      // The first-party page invokes Rumble("play", {video: "<embed id>"}).
      for (const match of text.matchAll(/\bRumble\(\s*["']play["']\s*,\s*\{[^}]{0,4096}?["']?video["']?\s*:\s*["'](v[0-9a-z]+)["']/g)) {
        if (ID.test(match[1])) ids.add(match[1]);
      }
      for (const match of text.matchAll(/["']embedUrl["']\s*:\s*["']([^"']+)["']/g)) {
        const id = embedId(match[1].replace(/\\\//g, '/'));
        if (id) ids.add(id);
      }
    }
    return [...ids].slice(0, 8);
  }
})();
