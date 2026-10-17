// Pinterest adapter, content-script world. See discover.js for the adapter contract.
// Players stream HLS through MediaSource and grid pins arrive through the web app's API, so this
// finds which pins show a video and looks each one up through PinResource, the same-origin
// endpoint the web app calls. It wants a handler header; from the service worker that header
// costs a CORS preflight, which Pinterest answers with 400. A pin's progressive MP4 leads and
// its HLS master's renditions are the other qualities.
(() => {
  const HOST = /(^|\.)pinterest\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i;
  const PIN_PATH = /\/pin\/(?:[\w-]*--)?(\d{1,25})(?:[/?#]|$)/;
  const SIGNATURE = /\/videos\/thumbnails\/originals\/(?:[0-9a-f]{2}\/){3}([0-9a-f]{32})/i;
  // A pin's own player sits in CloseupMainPin; grids badge video pins with PinTypeIdentifier.
  const PLAYERS = 'video,[data-test-id="PinTypeIdentifier"]';
  // Best first. V_EXP7 repeats V_720P on a path that can answer 403, so it only stands in for it.
  const MP4_KEYS = ['V_720P', 'V_EXP7', 'V_EXP6', 'V_EXP5', 'V_EXP4', 'V_EXP3'];
  const HLS_KEYS = ['V_HLSV4', 'V_HLSV3_MOBILE', 'V_HLSV3_WEB'];
  const CONCURRENCY = 3;
  const MAX_PER_SCAN = 32;
  const MAX_PLAYLIST = 256 * 1024;
  // The file is injected again on every scan, so lookups live on globalThis.
  const state = (globalThis.__VDS_PINTEREST__ ||= { pins: new Map(), signatures: new WeakMap(), active: 0, waiting: [] });

  const internals = { pinId, pageId, pinIdsWithVideo, signatureIndex, resourceUrl, parsePin, pinItem, masterVariants, embedVideo };
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {}).pinterest = internals;

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).pinterest = {
    // Generic matches here are HLS URLs of every pin in the page data (related pins included),
    // all titled after the open pin.
    genericScan: false,
    matches: location => HOST.test(location.hostname),
    collect({ document, location, emit }) {
      if (state.pins.size > 500) state.pins.clear();
      // The embed widget's iframe has no PinResource; its own markup names the pin and its files.
      const keys = location.pathname === '/ext/embed.html'
        ? [...document.querySelectorAll('video')].map(video => embedVideo(video)).filter(Boolean).map(video => [`embed:${video.mp4 || video.master}`, async () => [await withPlaylist(video)]])
        : pinIdsWithVideo(document, location).map(id => [id, () => lookUp(location.origin, id)]);
      let started = 0;
      const lookups = keys.map(([key, task]) => {
        if (!state.pins.has(key)) {
          if (started++ >= MAX_PER_SCAN) return [];
          // Each pin is reported as soon as it is known; the full list follows for rescans.
          state.pins.set(key, queued(task).catch(() => []).then((items) => { if (items.length) emit(items); return items; }));
        }
        return state.pins.get(key);
      });
      return Promise.all(lookups).then(lists => lists.flat());
    }
  };

  function pinId(href, base = 'https://www.pinterest.com/') {
    try {
      const url = new URL(href, base);
      return HOST.test(url.hostname) ? url.pathname.match(PIN_PATH)?.[1] || '' : '';
    } catch { return ''; }
  }

  // The pin the page is about: /pin/<id>/ or the embed widget's iframe (assets.pinterest.com/ext/embed.html?id=<id>).
  function pageId(location) {
    const id = pinId(location.href);
    if (id) return id;
    if (location.pathname !== '/ext/embed.html') return '';
    const param = new URL(location.href).searchParams.get('id') || '';
    return /^\d{1,25}$/.test(param) ? param : '';
  }

  function pinIdsWithVideo(doc, location) {
    const ids = new Set();
    const page = pageId(location);
    let signatures;
    for (const node of doc.querySelectorAll(PLAYERS)) {
      const item = node.closest('[data-grid-item]');
      let id = '';
      if (page && (!item || node.closest('[data-test-id="CloseupMainPin"]'))) id = page;
      else if (item) {
        const link = item.querySelector('a[href*="/pin/"]');
        id = link ? pinId(link.getAttribute('href'), location.href) : '';
      }
      // Logged-out grids gate their pins behind a login prompt without links; server-rendered
      // pages still carry those pins in their Redux state, recognisable by the poster's signature.
      if (!id && node.tagName === 'VIDEO') {
        const signature = String(node.getAttribute('poster') || '').match(SIGNATURE)?.[1]?.toLowerCase();
        if (signature) id = (signatures ||= signatureIndex(doc)).get(signature) || '';
      }
      if (id) ids.add(id);
    }
    return [...ids];
  }

  function signatureIndex(doc) {
    const script = doc.getElementById('__PWS_INITIAL_PROPS__');
    if (!script) return new Map();
    if (!state.signatures.has(script)) state.signatures.set(script, signaturesFromProps(script.textContent));
    return state.signatures.get(script);
  }

  function signaturesFromProps(text) {
    const index = new Map();
    let pins;
    try { pins = JSON.parse(text)?.initialReduxState?.pins; } catch { return index; }
    for (const pin of Object.values(pins && typeof pins === 'object' ? pins : {})) {
      const id = String(pin?.id || '');
      const list = pin?.videos?.video_list;
      if (!/^\d{1,25}$/.test(id) || !list || typeof list !== 'object') continue;
      for (const rendition of Object.values(list)) {
        const signature = String(rendition?.thumbnail || '').match(SIGNATURE)?.[1]?.toLowerCase();
        if (signature) index.set(signature, id);
      }
    }
    return index;
  }

  function resourceUrl(origin, id) {
    const data = JSON.stringify({ options: { field_set_key: 'unauth_react_main_pin', id } });
    return `${origin}/resource/PinResource/get/?data=${encodeURIComponent(data)}`;
  }

  async function lookUp(origin, id) {
    const response = await fetch(resourceUrl(origin, id), { credentials: 'same-origin', headers: { 'X-Pinterest-PWS-Handler': 'www/pin/[id].js' } });
    if (!response.ok) return [];
    const videos = parsePin((await response.json())?.resource_response?.data);
    return Promise.all(videos.map(withPlaylist));
  }

  async function withPlaylist(video) {
    let text = '';
    // The CDN allows Pinterest's own origins without credentials.
    if (video.master) text = await fetch(video.master, { credentials: 'omit' }).then(response => (response.ok ? response.text() : ''), () => '');
    return pinItem(video, text.length <= MAX_PLAYLIST ? text : '');
  }

  function queued(task) {
    return new Promise((resolve, reject) => {
      const run = () => {
        state.active++;
        task().then(resolve, reject).finally(() => { state.active--; state.waiting.shift()?.(); });
      };
      if (state.active < CONCURRENCY) run();
      else state.waiting.push(run);
    });
  }

  // Videos of a pin: its own video list, or one per video page of an idea (story) pin. Pins that
  // embed another site's player (YouTube, Vimeo) have no video list and give nothing.
  function parsePin(pin) {
    if (!pin || typeof pin !== 'object') return [];
    const pages = Array.isArray(pin.story_pin_data?.pages) ? pin.story_pin_data.pages : [];
    const lists = [pin.videos?.video_list, ...pages.flatMap(page => (Array.isArray(page?.blocks) ? page.blocks : []).map(block => block?.video?.video_list))];
    const seen = new Set();
    const videos = lists.map(parseVideoList).filter(video => video && !seen.has(video.mp4 || video.master) && seen.add(video.mp4 || video.master));
    const title = pinTitle(pin);
    const author = text(pin.closeup_attribution?.full_name) || text(pin.native_creator?.full_name) || text(pin.pinner?.full_name);
    const thumbnail = pinimgImage(pin.images?.['736x']?.url) || pinimgImage(pin.images?.orig?.url);
    // Several videos in one pin are told apart by number; untitled ones by Chrome's (1), (2).
    return videos.map((video, index) => ({
      ...video, title: videos.length > 1 && title ? `${title} (${index + 1})` : title, author, thumbnail: video.thumbnail || thumbnail
    }));
  }

  function parseVideoList(list) {
    if (!list || typeof list !== 'object') return null;
    const mp4 = MP4_KEYS.map(key => pinimgVideo(list[key]?.url, '.mp4')).find(Boolean);
    const master = HLS_KEYS.map(key => pinimgVideo(list[key]?.url, '.m3u8')).find(Boolean);
    if (!mp4 && !master) return null;
    const sample = Object.values(list).find(entry => Number(entry?.duration) > 0);
    const thumbnail = Object.values(list).map(entry => pinimgImage(entry?.thumbnail)).find(Boolean);
    return { mp4, master, duration: Number(sample?.duration) / 1000 || undefined, thumbnail };
  }

  // The embed widget plays <video><source mp4><source m3u8>, with the pin's description and its
  // creator in its footer.
  function embedVideo(video) {
    const sources = [...video.querySelectorAll('source')].map(source => source.getAttribute('src'));
    const mp4 = sources.map(src => pinimgVideo(src, '.mp4')).find(Boolean);
    const master = sources.map(src => pinimgVideo(src, '.m3u8')).find(Boolean);
    if (!mp4 && !master) return null;
    const root = video.closest('[data-pin-id]');
    return {
      mp4, master,
      title: line(root?.querySelector('[class$="_title"]')?.textContent).slice(0, 200),
      author: text(root?.querySelector('[class$="_bottomline"]')?.textContent),
      thumbnail: pinimgImage(video.getAttribute('poster'))
    };
  }

  // The video list's width and height describe the upload, not each file (a "720p" MP4 can be
  // 1080x1920 or 720x1280), so the MP4 carries no size and the HLS renditions their exact one.
  function pinItem(video, masterText = '') {
    const renditions = new Map();
    for (const variant of video.master && masterText ? masterVariants(video.master, masterText) : []) {
      const key = `${variant.width}x${variant.height}`;
      if (!renditions.has(key) || (renditions.get(key).bitrate || 0) < (variant.bitrate || 0)) renditions.set(key, { ...variant, duration: video.duration });
    }
    const short = variant => Math.min(variant.width || 0, variant.height || 0);
    const hls = [...renditions.values()].sort((a, b) => short(b) - short(a) || (b.bitrate || 0) - (a.bitrate || 0));
    hls.forEach((variant, index) => { variant.id = `hls-${index}`; });
    const variants = [
      video.mp4 && { id: 'mp4', url: video.mp4, kind: 'direct', mimeType: 'video/mp4', container: 'mp4', duration: video.duration, hasAudio: true, hasVideo: true },
      ...hls
    ].filter(Boolean);
    return {
      url: video.mp4 || video.master,
      kind: video.mp4 ? 'direct' : 'hls',
      mimeType: video.mp4 ? 'video/mp4' : 'application/x-mpegURL',
      title: video.title || '',
      author: video.author || undefined,
      thumbnail: video.thumbnail,
      duration: video.duration,
      width: video.mp4 ? undefined : hls[0]?.width,
      height: video.mp4 ? undefined : hls[0]?.height,
      variants: variants.length > 1 || (!video.mp4 && variants.length) ? variants : undefined
    };
  }

  // Renditions of an HLS master, read as manifest-variants.js reads them for other sites
  // (content scripts cannot import it).
  function masterVariants(masterUrl, playlist) {
    if (!playlist.trimStart().startsWith('#EXTM3U')) return [];
    const lines = playlist.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean);
    const audio = new Map();
    for (const entry of lines) if (entry.startsWith('#EXT-X-MEDIA:') && attribute(entry, 'TYPE') === 'AUDIO') audio.set(attribute(entry, 'GROUP-ID'), attribute(entry, 'URI'));
    const variants = [];
    lines.forEach((entry, index) => {
      const next = lines[index + 1];
      if (!entry.startsWith('#EXT-X-STREAM-INF:') || !next || next.startsWith('#')) return;
      const [width, height] = (attribute(entry, 'RESOLUTION') || '').split('x').map(Number);
      const audioUri = audio.get(attribute(entry, 'AUDIO'));
      try {
        variants.push({
          kind: 'hls', url: new URL(next, masterUrl).href, audioUrl: audioUri ? new URL(audioUri, masterUrl).href : undefined,
          mimeType: 'application/vnd.apple.mpegurl', container: 'mp4', width: width || undefined, height: height || undefined,
          codecs: attribute(entry, 'CODECS'), fps: Number(attribute(entry, 'FRAME-RATE')) || undefined,
          bitrate: Number(attribute(entry, 'AVERAGE-BANDWIDTH') || attribute(entry, 'BANDWIDTH')) || undefined
        });
      } catch { /* A malformed entry only loses that rendition. */ }
    });
    return variants;
  }

  function attribute(entry, name) {
    const match = entry.match(new RegExp(`[:,]${name}=(?:"([^"]*)"|([^,]*))`));
    return match ? match[1] ?? match[2] : undefined;
  }

  // The pin's title, else its description; pins without either fall back to their author.
  function pinTitle(pin) {
    for (const value of [pin.title, pin.grid_title, pin.story_pin_data?.metadata?.pin_title, pin.description]) {
      const first = line(value);
      if (first) return first.slice(0, 200);
    }
    return '';
  }

  function line(value) {
    return typeof value === 'string' ? value.split('\n').map(text).find(Boolean) || '' : '';
  }

  function text(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  function pinimgVideo(value, extension) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && /^v\d*\.pinimg\.com$/.test(url.hostname) && url.pathname.startsWith('/videos/') && url.pathname.endsWith(extension) ? url.href : '';
    } catch { return ''; }
  }

  function pinimgImage(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'i.pinimg.com' ? url.href : undefined;
    } catch { return undefined; }
  }
})();
