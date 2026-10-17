// Bluesky adapter, content-script world. See discover.js for the adapter contract.
// The web app plays app.bsky.embed.video posts as HLS through hls.js (blob: URLs) and the page
// only shows which posts carry a video: a poster or background thumbnail on video.bsky.app. This
// finds those posts; the background reads each one from the public AppView API and reports the
// video with its post text.
(() => {
  const SITE = 'bluesky';
  const HOST = /(^|\.)bsky\.app$/i;
  const ACTOR = /^(?:did:(?:plc:[a-z2-7]{24}|web:[a-z0-9.-]{1,253})|(?=[a-z0-9.-]{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;
  const RKEY = /^[a-z0-9._~:-]{1,64}$/i;
  // Feed and thread rows; the anchor post of a thread may have no link to itself.
  const POSTS = '[data-testid^="feedItem-by-"],[data-testid^="postThreadItem-by-"]';
  const MARKERS = 'video[poster*="video.bsky.app/"],video[poster*="video.cdn.bsky.app/"],[style*="video.bsky.app/watch/"],[style*="video.cdn.bsky.app/hls/"]';
  const BATCH = 10;
  const MAX_PER_SCAN = 40;

  const internals = { postRef, postsWithVideo };
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {})[SITE] = internals;

  // Every scan injects this file again and so asks again (the background answers from its cache):
  // in-app navigation clears the tab's cards and then scans.
  const requested = new Set();
  let queue = Promise.resolve();

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {})[SITE] = {
    // Generic scanners only see the video.bsky.app playlist, whose segments redirect (downloads
    // reject redirects), and reply GIFs.
    genericScan: false,
    matches: (location) => HOST.test(location.hostname),
    collect({ document, location }) {
      const fresh = postsWithVideo(document, location.href).filter(post => !requested.has(`${post.actor}/${post.rkey}`)).slice(0, MAX_PER_SCAN);
      for (const post of fresh) requested.add(`${post.actor}/${post.rkey}`);
      for (let index = 0; index < fresh.length; index += BATCH) {
        const posts = fresh.slice(index, index + BATCH);
        // The service worker reads the API and ingests the videos with their post text.
        queue = queue.then(() => chrome.runtime.sendMessage({ target: 'service', type: 'site.resolve', siteId: SITE, request: { posts } })).catch(() => {});
      }
      return [];
    }
  };

  // bsky.app/profile/<handle or did>/post/<rkey>[/...] and embed.bsky.app/embed/<did>/app.bsky.feed.post/<rkey>.
  function postRef(href, base) {
    let url;
    try { url = new URL(href, base); } catch { return null; }
    if (!HOST.test(url.hostname)) return null;
    const match = /^\/profile\/([^/]+)\/post\/([^/]+)/.exec(url.pathname) || /^\/embed\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)/.exec(url.pathname);
    if (!match) return null;
    let actor;
    let rkey;
    try { [actor, rkey] = [decodeURIComponent(match[1]).toLowerCase(), decodeURIComponent(match[2])]; } catch { return null; }
    return ACTOR.test(actor) && RKEY.test(rkey) && rkey !== '.' && rkey !== '..' ? { actor, rkey } : null;
  }

  function postsWithVideo(doc, pageUrl) {
    const posts = new Map();
    const page = postRef(pageUrl);
    for (const marker of doc.querySelectorAll(MARKERS)) {
      const row = marker.closest(POSTS);
      // A quoted post sits inside its row after the row's own link, and the background lists
      // the videos of both.
      const own = row ? [...row.querySelectorAll('a[href*="/post/"]')].map(link => postRef(link.getAttribute('href'), pageUrl)).find(Boolean) : null;
      const post = own || page;
      if (post) posts.set(`${post.actor}/${post.rkey}`, post);
    }
    return [...posts.values()];
  }
})();
