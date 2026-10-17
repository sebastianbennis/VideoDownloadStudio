// Twitch adapter, content-script world. See discover.js for the adapter contract.
// The player streams through MediaSource, so this only finds which clips (by slug) and VODs (by
// id) the page shows: the address on clip, video and embedded player pages, the links in channel
// and directory shelves elsewhere. The background resolves them through Twitch's GraphQL API.
// The current channel is also resolved for native disk-backed live recording.
(() => {
  const SLUG = /^[A-Za-z0-9_-]{1,100}$/;
  const CHANNEL = /^[a-z0-9_]{3,25}$/;
  const NOT_CHANNELS = new Set(['directory', 'downloads', 'videos', 'settings', 'subscriptions', 'inventory', 'wallet', 'search', 'login', 'signup', 'jobs', 'turbo', 'prime', 'products', 'friends', 'messages', 'following', 'drops', 'moderator', 'dashboard']);
  const VIDEO_ID = /^\d{1,15}$/;
  const NOT_CLIPS = new Set(['embed', 'create', 'api']);
  const LINKS = 'a[href*="/clip/"],a[href*="/videos/"],a[href*="/v/"],a[href*="/video/"],a[href*="clips.twitch.tv/"]';
  const BATCH = 8;
  const MAX_PER_SCAN = 24;
  // Every scan injects this file again and the service clears a tab's cards on in-app navigation
  // before it scans, so what was asked for is only remembered for this injection.
  const requested = new Set();
  let queue = Promise.resolve();

  const internals = { addressTarget, channelTarget, pageTargets };
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {}).twitch = internals;

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).twitch = {
    // The only http media the generic scanners find here are ads and decorations.
    genericScan: false,
    matches: location => /(^|\.)twitch\.tv$/i.test(location.hostname),
    collect({ document, location }) {
      const fresh = pageTargets(document, location.href).filter(key => !requested.has(key)).slice(0, MAX_PER_SCAN);
      for (const key of fresh) requested.add(key);
      for (let index = 0; index < fresh.length; index += BATCH) {
        const keys = fresh.slice(index, index + BATCH);
        const request = { clips: idsOf(keys, 'clip:'), videos: idsOf(keys, 'video:') };
        const channels = idsOf(keys, 'channel:');
        if (channels.length) request.channels = channels;
        // The service worker fetches and ingests these; Twitch's API needs its client id header.
        queue = queue.then(() => chrome.runtime.sendMessage({ target: 'service', type: 'site.resolve', siteId: 'twitch', request })).catch(() => {});
      }
      return [];
    }
  };

  // The clip or VOD a Twitch address shows, as 'clip:<slug>' or 'video:<id>', or ''.
  function addressTarget(href, base) {
    let url;
    try { url = new URL(href, base); } catch { return ''; }
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'clips.twitch.tv') {
      // /embed?clip=<slug>, /<slug> and /<channel>/<slug>
      const slug = parts[0] === 'embed' ? url.searchParams.get('clip') : parts.length <= 2 ? parts[parts.length - 1] : '';
      return slug && SLUG.test(slug) && !NOT_CLIPS.has(slug) ? `clip:${slug}` : '';
    }
    if (host === 'player.twitch.tv') {
      const id = String(url.searchParams.get('video') || '').replace(/^v/, '');
      return VIDEO_ID.test(id) ? `video:${id}` : '';
    }
    if (!/(^|\.)twitch\.tv$/.test(host)) return '';
    if (parts[0] === 'videos' && parts.length === 2 && VIDEO_ID.test(parts[1])) return `video:${parts[1]}`;
    if (parts.length === 3 && ['v', 'video'].includes(parts[1]) && VIDEO_ID.test(parts[2])) return `video:${parts[2]}`;
    const vodId = url.searchParams.get('vodID') || '';
    if (parts.length === 2 && parts[1] === 'schedule' && VIDEO_ID.test(vodId)) return `video:${vodId}`;
    // /<channel>/clip/<slug> and /clip/<slug>
    const clip = parts.indexOf('clip');
    if ((clip === 0 || clip === 1) && parts.length === clip + 2 && SLUG.test(parts[clip + 1])) return `clip:${parts[clip + 1]}`;
    return '';
  }

  // A clip, video or embed page shows one item; elsewhere the page's clip and VOD links are listed.
  function pageTargets(doc, pageUrl) {
    const own = addressTarget(pageUrl);
    if (own) return [own];
    const channel = channelTarget(pageUrl);
    const keys = new Set(channel ? [channel] : []);
    for (const link of doc.querySelectorAll(LINKS)) {
      const key = addressTarget(link.getAttribute('href') || '', pageUrl);
      if (key) keys.add(key);
    }
    return [...keys];
  }

  function channelTarget(href) {
    let url;
    try { url = new URL(href); } catch { return ''; }
    const parts = url.pathname.split('/').filter(Boolean);
    const channel = (url.hostname === 'player.twitch.tv' ? url.searchParams.get('channel') : ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(url.hostname) && parts.length === 1 ? parts[0] : '')?.toLowerCase();
    return channel && CHANNEL.test(channel) && !NOT_CHANNELS.has(channel) ? `channel:${channel}` : '';
  }

  function idsOf(keys, prefix) {
    return keys.filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length));
  }
})();
