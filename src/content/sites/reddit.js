// Reddit adapter, content-script world. See discover.js for the adapter contract.
// New Reddit keeps each video's sources on its <shreddit-player>: the signed HLS master in src
// and, for most posts, muxed MP4s in packaged-media-json. Old Reddit keeps signed DASH and HLS
// URLs on the player div, or as escaped HTML in a collapsed expando's data-cachedhtml.
(() => {
  const PLAYERS = 'shreddit-player, shreddit-player-2';
  const MEDIA_HOST = /^(?:v|packaged-media|preview|external-preview)\.redd\.it$/;
  // discover.js keeps the first 40 items of a batch, so long feeds are sent in several.
  const BATCH = 40;
  const packaged = new Map();

  if (globalThis.__VDS_SITE_TEST__) {
    (globalThis.__VDS_SITE_INTERNALS__ ||= {}).reddit = { playerItem, packagedVariants, cachedPlayer, oldRedditItem, videoKey, mediaUrl };
  }

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).reddit = {
    matches: location => /(^|\.)reddit\.com$/i.test(location.hostname),
    collect,
    // Generic scanning only finds these videos again as the playing rendition and 96p seek previews.
    genericScan: false
  };

  function collect({ document, title, emit }) {
    const items = new Map();
    const add = (item) => {
      const key = item && videoKey(item.url);
      if (key && !items.has(key)) items.set(key, item);
      return Boolean(item);
    };
    const handled = new Set();
    const players = [...document.querySelectorAll(PLAYERS)];
    for (const player of players) {
      const attrs = Object.fromEntries([...player.attributes].map(attr => [attr.name, attr.value]));
      // Ads are skipped on purpose; they are not the posts people save.
      if (player.closest('shreddit-ad-post')) attrs['post-promoted'] ??= '';
      const post = player.closest('shreddit-post') || (attrs['post-id'] && document.getElementById(attrs['post-id']));
      if (add(playerItem(attrs, { postTitle: post?.getAttribute('post-title'), title, variants: packagedFor(attrs) })) || 'post-promoted' in attrs) handled.add(player);
    }
    for (const thing of document.querySelectorAll('.thing[data-fullname^="t3_"]')) {
      if (thing.getAttribute('data-promoted') === 'true') continue;
      const player = thing.querySelector('[data-hls-url], [data-mpd-url]');
      const sources = player
        ? { hlsUrl: player.getAttribute('data-hls-url'), mpdUrl: player.getAttribute('data-mpd-url') }
        : cachedPlayer(thing.querySelector('.expando[data-cachedhtml]')?.getAttribute('data-cachedhtml'));
      add(oldRedditItem({ ...sources, dataUrl: thing.getAttribute('data-url'), title: thing.querySelector('a.title')?.textContent, thumbnail: thing.querySelector('a.thumbnail img')?.src }));
    }
    // A player whose markup changed still plays an HTTP source, and old Reddit shows GIF and
    // imgur expandos as plain videos.
    const loose = [...document.querySelectorAll('video')];
    for (const player of players) if (!handled.has(player)) loose.push(...(player.shadowRoot?.querySelectorAll('video') || []));
    for (const video of loose) {
      if (video.closest('[data-hls-url], [data-mpd-url]')) continue;
      const thing = video.closest('.thing');
      for (const src of [video.currentSrc || video.src, ...[...video.querySelectorAll('source[src]')].map(source => source.src)]) {
        const url = mediaUrl(src, true);
        if (url && !/_96\.mp4$/.test(new URL(url).pathname)) add({ url, title: thing?.querySelector('a.title')?.textContent || title, thumbnail: video.poster || undefined });
      }
    }
    const found = [...items.values()];
    for (let start = BATCH; start < found.length; start += BATCH) emit(found.slice(start, start + BATCH));
    return found.slice(0, BATCH);
  }

  function packagedFor(attrs) {
    const json = attrs['packaged-media-json'];
    if (!json) return [];
    if (!packaged.has(json)) packaged.set(json, packagedVariants(json));
    return packaged.get(json);
  }

  function playerItem(attrs, context = {}) {
    if (!attrs || 'post-promoted' in attrs) return null;
    const url = mediaUrl(attrs.src);
    if (!url) return null;
    const variants = context.variants || packagedVariants(attrs['packaged-media-json']);
    const best = variants[0] || {};
    const postTitle = clean(attrs['post-title'] || context.postTitle);
    const kind = kindOf(url);
    return {
      url,
      kind,
      // GIF posts play an MP4 rendition whose path still ends in .gif.
      mimeType: kind === 'direct' ? 'video/mp4' : undefined,
      title: postTitle && 'comment-id' in attrs ? `${postTitle} (comment)` : postTitle || context.title,
      thumbnail: mediaUrl(attrs.poster) || undefined,
      width: best.width,
      height: best.height,
      duration: best.duration,
      // Without packaged MP4s the service reads the HLS master for the quality list.
      variants: variants.length ? variants : undefined
    };
  }

  // Packaged MP4s carry video and audio in one file, so they download without a merge.
  function packagedVariants(json) {
    let data;
    try { data = JSON.parse(json || 'null'); } catch { return []; }
    const mp4s = data?.playbackMp4s;
    const duration = Number(mp4s?.duration) || undefined;
    const variants = [];
    for (const permutation of Array.isArray(mp4s?.permutations) ? mp4s.permutations : []) {
      const source = permutation?.source;
      const url = mediaUrl(source?.url);
      if (!url) continue;
      const width = Number(source.dimensions?.width) || undefined;
      const height = Number(source.dimensions?.height) || undefined;
      const codec = typeof source.videoCodec === 'string' ? source.videoCodec.toLowerCase() : '';
      // e= is the signature's Unix expiry (hour-aligned, a few hours ahead); the CDN refuses it after.
      const expires = Number(new URL(url).searchParams.get('e'));
      variants.push({
        id: [height ? `${height}p` : `mp4-${variants.length}`, codec].filter(Boolean).join('-'),
        url,
        kind: 'direct',
        mimeType: 'video/mp4',
        container: 'mp4',
        width,
        height,
        bitrate: Number(source.bitrateBps) || undefined,
        codecs: codec === 'h264' ? 'avc1' : undefined,
        duration,
        expiresAt: expires > 0 ? expires * 1000 : undefined
      });
    }
    return variants.sort((a, b) => (b.height || 0) - (a.height || 0));
  }

  // Collapsed expandos keep the player as escaped HTML whose attribute values still hold &amp;.
  function cachedPlayer(html) {
    const read = name => (new RegExp(`\\s${name}="([^"]+)"`).exec(html || '')?.[1] || '').replace(/&amp;/g, '&');
    return { hlsUrl: read('data-hls-url'), mpdUrl: read('data-mpd-url') };
  }

  function oldRedditItem({ hlsUrl, mpdUrl, dataUrl, title, thumbnail } = {}) {
    const id = /^https:\/\/v\.redd\.it\/(\w+)\/?$/.exec(dataUrl || '')?.[1];
    // Old Reddit's own player prefers the DASH manifest. The unsigned one stops at 720p, so it
    // is only used when the post's player markup is missing.
    const url = mediaUrl(mpdUrl) || mediaUrl(hlsUrl) || (id ? `https://v.redd.it/${id}/DASHPlaylist.mpd` : '');
    return url ? { url, kind: kindOf(url), title: clean(title) || undefined, thumbnail: mediaUrl(thumbnail, true) || undefined } : null;
  }

  // One video can appear as its HLS master, a packaged MP4 and CMAF files; all share the v.redd.it id.
  function videoKey(value) {
    try {
      const url = new URL(value);
      if (url.hostname === 'v.redd.it') return /^\/(?:link\/\w+\/asset\/)?(\w+)\//.exec(url.pathname)?.[1] || url.href;
      if (url.hostname === 'packaged-media.redd.it') return /^\/(\w+)\//.exec(url.pathname)?.[1] || url.href;
      return url.href;
    } catch { return ''; }
  }

  function mediaUrl(value, anyHost = false) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && (anyHost || MEDIA_HOST.test(url.hostname)) ? url.href : '';
    } catch { return ''; }
  }

  function kindOf(url) {
    const path = new URL(url).pathname;
    return /\.m3u8$/i.test(path) ? 'hls' : /\.mpd$/i.test(path) ? 'dash' : 'direct';
  }

  function clean(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }
})();
