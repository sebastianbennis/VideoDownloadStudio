// 9GAG's state lists every rendition; the playing <video> usually names only the small MP4.
(() => {
  const HOST = /(^|\.)9gag\.com$/i;
  const MEDIA_HOST = /(^|\.)9cache\.com$/i;
  const ID = /^[a-z0-9]{1,32}$/i;
  const state = (globalThis.__VDS_NINEGAG__ ||= { scripts: new WeakMap(), posts: new Map() });

  const internals = { postId, postIndex, parseStateScript, parsePost, idsWithVideo };
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {}).ninegag = internals;
  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).ninegag = {
    genericScan: false,
    matches: location => HOST.test(location.hostname),
    async collect({ document, location, emit }) {
      const index = new Map();
      for (const script of document.querySelectorAll('script')) {
        if (!state.scripts.has(script)) state.scripts.set(script, postIndex(parseStateScript(script.textContent)));
        for (const [id, item] of state.scripts.get(script)) index.set(id, item);
      }
      const lookups = idsWithVideo(document, location.href).slice(0, 24).map(id => {
        const parsed = index.get(id);
        let cached = state.posts.get(id);
        // Server-rendered state can arrive after a failed API request.
        if (parsed && (!cached || cached.source !== 'state')) {
          cached = { at: Date.now(), source: 'state', promise: Promise.resolve([parsed]) };
          state.posts.set(id, cached);
        }
        if (!cached || (cached.source === 'failed' && Date.now() - cached.at > 30000)) {
          cached = { at: Date.now(), source: 'api' };
          cached.promise = lookUp(location.href, id).catch(() => []).then(items => {
            if (!items.length) cached.source = 'failed';
            if (items.length) emit(items);
            return items;
          });
          state.posts.set(id, cached);
        }
        return cached.promise;
      });
      while (state.posts.size > 250) state.posts.delete(state.posts.keys().next().value);
      return (await Promise.all(lookups)).flat();
    }
  };

  function postId(href, base = 'https://9gag.com/') {
    try {
      const url = new URL(href, base);
      return HOST.test(url.hostname) ? url.pathname.match(/^\/gag\/([a-z0-9]{1,32})(?:\/|$)/i)?.[1] || '' : '';
    } catch { return ''; }
  }

  function idsWithVideo(doc, pageUrl) {
    const page = postId(pageUrl);
    // A permalink owns its post. Related posts in the embedded state are not extra cards.
    if (page) return [page];
    const ids = new Set();
    for (const video of doc.querySelectorAll('video')) {
      // Comment videos have no post article and are not copies of the post's media.
      const article = video.closest('article');
      if (!article) continue;
      const articleId = article.getAttribute('id')?.match(/^jsid-post-([a-z0-9]{1,32})$/i)?.[1];
      if (articleId) { ids.add(articleId); continue; }
      for (const node of [video, ...video.querySelectorAll('source')]) {
        for (const attribute of ['src', 'poster']) {
          const url = mediaUrl(node.getAttribute(attribute));
          const id = url && new URL(url).pathname.match(/^\/photo\/([a-z0-9]{1,32})_/i)?.[1];
          if (id) ids.add(id);
        }
      }
      const link = article.querySelector('a[href*="/gag/"]');
      const id = link && postId(link.getAttribute('href'), pageUrl);
      if (id) ids.add(id);
    }
    return [...ids];
  }

  // The observed boot script is window._config = JSON.parse("..."). Parse two JSON strings,
  // never execute page code. Other scripts are ignored.
  function parseStateScript(text) {
    if (typeof text !== 'string' || text.length > 5 * 1024 * 1024) return null;
    const match = /\bwindow\._config\s*=\s*JSON\.parse\(\s*("(?:\\.|[^"\\])*")\s*\)/.exec(text);
    if (!match) return null;
    try { return JSON.parse(JSON.parse(match[1])); } catch { return null; }
  }

  function postIndex(data) {
    const index = new Map();
    const stack = [data];
    for (let count = 0; stack.length && count < 20000; count++) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'Animated' && ID.test(node.id || '')) {
        const item = parsePost(node);
        if (item) index.set(node.id, item);
      } else {
        for (const child of Object.values(node)) if (child && typeof child === 'object') stack.push(child);
      }
    }
    return index;
  }

  async function lookUp(pageUrl, id) {
    const origin = new URL(pageUrl).origin;
    const response = await fetch(`${origin}/v1/post?id=${id}`, {
      credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return [];
    const post = (await response.json())?.data?.post;
    if (post?.id !== id) return [];
    const item = parsePost(post);
    return item ? [item] : [];
  }

  function parsePost(post) {
    if (post?.type !== 'Animated' || !ID.test(post.id || '') || !post.images || typeof post.images !== 'object') return null;
    const variants = [];
    const seen = new Set();
    let thumbnail;
    for (const [key, file] of Object.entries(post.images)) {
      if (!file || typeof file !== 'object') continue;
      const base = mediaUrl(file.url, post.id);
      if (base && /\.(?:jpg|png|webp)$/i.test(new URL(base).pathname)) thumbnail ||= base;
      for (const [field, codec] of [['url', undefined], ['vp8Url', 'vp8'], ['vp9Url', 'vp9'], ['h265Url', 'hevc']]) {
        const url = mediaUrl(file[field], post.id);
        const extension = url && new URL(url).pathname.match(/\.(mp4|webm)$/i)?.[1]?.toLowerCase();
        if (!extension || seen.has(url)) continue;
        seen.add(url);
        variants.push({
          id: `${key}-${field}`, url, kind: 'direct', mimeType: `video/${extension}`, container: extension,
          width: positive(file.width), height: positive(file.height), duration: positive(file.duration),
          codecs: codec, hasVideo: true, hasAudio: file.hasAudio === 0 ? false : file.hasAudio === 1 ? true : undefined
        });
      }
    }
    // Real dimensions decide quality. The plain MP4 wins equal dimensions for compatibility.
    variants.sort((a, b) => ((b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)) ||
      Number(b.container === 'mp4' && !b.codecs) - Number(a.container === 'mp4' && !a.codecs));
    if (!variants.length) return null;
    const { id: _, ...best } = variants[0];
    return {
      ...best, title: decodeTitle(post.title), author: line(post.creator?.fullName) || line(post.creator?.username) || undefined,
      thumbnail, variants
    };
  }

  function mediaUrl(value, id) {
    if (typeof value !== 'string' || value.length > 4096) return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !MEDIA_HOST.test(url.hostname) || url.username || url.password) return '';
      if (id && !url.pathname.startsWith(`/photo/${id}_`)) return '';
      return url.href;
    } catch { return ''; }
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
  }

  function line(value) {
    return typeof value === 'string' ? value.split('\n').map(part => part.trim()).find(Boolean) || '' : '';
  }

  function decodeTitle(value) {
    const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    return line(value).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity) => {
      if (entity[0] !== '#') return entities[entity.toLowerCase()];
      const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
    });
  }
})();
