// Tumblr adapter, content-script world. See discover.js for the adapter contract.
// Tumblr's own players are plain <video>/<audio> elements whose <source> is the MP4 (or MP3) on
// its media hosts, so the page already shows the URLs. The page's ___INITIAL_STATE___ holds the
// NPF posts that name them (post text, blog); posts loaded later are named from their markup.
// Videos embedded from other sites (YouTube and the like) are iframes and never listed.
(() => {
  const MEDIA_HOST = /^(?:va|\d+)\.media\.tumblr\.com$/i;
  const MAX_NODES = 50000;
  // The file is injected again on every scan; parsed state is kept per script element.
  const indexes = (globalThis.__VDS_TUMBLR_STATE__ ||= new WeakMap());

  const internals = { mediaIndex, itemsFromDocument, renditionSize, seconds };
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {}).tumblr = internals;

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).tumblr = {
    // The state script lists media URLs of every post it holds, which the generic script scan
    // would title after the page, and it still describes the first page after in-app navigation.
    genericScan: false,
    matches: location => /(^|\.)tumblr\.com$/i.test(location.hostname),
    collect({ document, location }) {
      return itemsFromDocument(document, location, stateIndex(document));
    }
  };

  function stateIndex(doc) {
    const script = doc.getElementById('___INITIAL_STATE___');
    if (!script) return new Map();
    if (!indexes.has(script)) {
      let state = null;
      try { state = JSON.parse(script.textContent); } catch { /* A broken state only loses titles. */ }
      indexes.set(script, mediaIndex(state));
    }
    return indexes.get(script);
  }

  // Media URL -> what names it, for every post in the state (timelines, permalinks, embeds).
  function mediaIndex(state) {
    const index = new Map();
    const stack = [state];
    for (let visited = 0; stack.length && visited < MAX_NODES; visited++) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (node.objectType === 'post' && (Array.isArray(node.content) || Array.isArray(node.trail))) indexPost(node, index);
      else for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push(value);
    }
    return index;
  }

  // A reblog keeps the original post's blocks in its trail; each block is named by the entry
  // that holds it, so a reblogged video keeps its own text and blog.
  function indexPost(post, index) {
    const entries = [{ blog: post.blogName || post.blog?.name, content: post.content }];
    for (const entry of Array.isArray(post.trail) ? post.trail : []) entries.push({ blog: entry?.blog?.name || entry?.brokenBlog?.name, content: entry?.content });
    for (const entry of entries) {
      const blocks = Array.isArray(entry.content) ? entry.content : [];
      const players = blocks.filter(block => ['video', 'audio'].includes(block?.type) && (mediaUrl(mediaOf(block)?.url) || mediaUrl(block.url)));
      const text = blocks.filter(block => block?.type === 'text').map(block => line(block.text)).find(Boolean) || line(post.summary);
      players.forEach((block, number) => {
        const media = mediaOf(block) || {};
        // Audio blocks name their own track; players sharing the post's text are numbered.
        const track = block.type === 'audio' ? [line(block.artist), line(block.title)].filter(Boolean).join(' - ') : '';
        const meta = {
          title: track || (players.length > 1 && text ? `${text} (${number + 1})` : text),
          author: typeof entry.blog === 'string' ? entry.blog : '',
          thumbnail: httpUrl((Array.isArray(block.poster) ? block.poster[0] : block.poster)?.url),
          duration: seconds(block.duration),
          width: positive(media.width),
          height: positive(media.height)
        };
        for (const url of [mediaUrl(media.url), mediaUrl(block.url)]) if (url && !index.has(url)) index.set(url, meta);
      });
    }
  }

  function itemsFromDocument(doc, location, index) {
    const items = [];
    const seen = new Set();
    for (const player of doc.querySelectorAll('video,audio')) {
      const url = [player, ...player.querySelectorAll('source')].map(node => mediaUrl(node.getAttribute('src'))).find(Boolean);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const audio = player.tagName === 'AUDIO';
      const meta = index.get(url) || markupMeta(player, location);
      const size = audio ? {} : renditionSize(url, meta.width || positive(player.getAttribute('width')), meta.height || positive(player.getAttribute('height')));
      items.push({
        url,
        kind: 'direct',
        mimeType: audio ? 'audio/mpeg' : 'video/mp4',
        title: meta.title || '',
        author: meta.author || undefined,
        thumbnail: meta.thumbnail || httpUrl(player.getAttribute('poster')) || undefined,
        duration: meta.duration,
        width: size.width,
        height: size.height
      });
    }
    return items;
  }

  // Posts the state does not hold: the first paragraph of the post and its blog, from the post
  // header (dashboard, embeds) or the blog's own subdomain (blog themes).
  function markupMeta(player, location) {
    const post = player.closest('article');
    const paragraph = post && [...post.querySelectorAll('p')].find(node => !node.closest('header,footer') && line(node.textContent));
    const header = post?.querySelector('header[aria-label^="Posted by "]')?.getAttribute('aria-label').slice(10);
    const host = location.hostname.match(/^([\w-]+)\.tumblr\.com$/i)?.[1];
    const blog = line(post?.querySelector('a[rel="author"]')?.textContent) || line(header) || (host && !/^(?:www|embed)$/i.test(host) ? host : '');
    return { title: (player.tagName === 'AUDIO' && line(player.getAttribute('title'))) || line(paragraph?.textContent), author: blog };
  }

  // NPF gives the upload's size; renditions named _720.mp4 or /s720/ are scaled to that short side.
  function renditionSize(url, width, height) {
    const target = Number(new URL(url).pathname.match(/_(\d{3,4})\.mp4$|\/s(\d{3,4})\//)?.slice(1).find(Boolean));
    const short = Math.min(width || 0, height || 0);
    if (!target || !(short > target)) return { width: width || undefined, height: height || undefined };
    const scale = target / short;
    return { width: Math.round(width * scale / 2) * 2, height: Math.round(height * scale / 2) * 2 };
  }

  // Posts converted from the legacy video type give milliseconds, NPF uploads give seconds;
  // uploads are capped well below 1000 seconds.
  function seconds(value) {
    const number = positive(value);
    return number >= 1000 ? number / 1000 : number || undefined;
  }

  function mediaOf(block) {
    return Array.isArray(block?.media) ? block.media[0] : block?.media;
  }

  function mediaUrl(value) {
    const url = httpUrl(value);
    return url && MEDIA_HOST.test(new URL(url).hostname) ? url : '';
  }

  function httpUrl(value) {
    if (typeof value !== 'string' || value.length > 4096) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }

  function line(value) {
    return typeof value === 'string' ? value.split('\n').map(part => part.replace(/\s+/g, ' ').trim()).find(Boolean) || '' : '';
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }
})();
