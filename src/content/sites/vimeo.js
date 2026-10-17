// Vimeo adapter, content-script world. See discover.js for the adapter contract.
// The player (player.vimeo.com/video/<id>, also inside another site's iframe) carries its whole
// config in an inline `window.playerConfig = {...}` script. vimeo.com video pages load the same
// config through the API with a signature the page leaves in its head, so the adapter repeats
// those two requests. Both hold signed HLS masters and, for some videos, progressive MP4s.
(() => {
  const CONFIG_SCRIPT = /^\s*window\.playerConfig\s*=\s*/;
  const CLIP_PATH = /^\/(?:(?:channels\/[\w-]{1,64}|groups\/[\w-]{1,64}\/videos|showcase\/\d{1,12}\/video)\/)?(\d{1,12})(?:\/([0-9a-f]{10}))?\/?$/;
  const SIGNATURE = /^[0-9a-f]{64}_\d{10,13}$/;
  const LIVE = new Set(['pending', 'active', 'started']);
  const RETRY_MS = 30 * 1000;
  const parsed = new WeakMap();
  // A refetched config signs new media URLs, which would add a second card for the same video,
  // so fetched clips outlive the re-injection of this file on every scan.
  const state = (globalThis.__VDS_VIMEO_STATE__ ||= { clips: new Map(), viewer: null });

  if (globalThis.__VDS_SITE_TEST__) {
    (globalThis.__VDS_SITE_INTERNALS__ ||= {}).vimeo = { configFromScript, itemsFromConfig, clipFromPath, cdnUrl, playerConfigUrl, state };
  }

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).vimeo = {
    matches: location => /(^|\.)vimeo\.com$/i.test(location.hostname),
    // The generic scanners read the same config as several signed copies of each master (two
    // CDNs, AVC and all-codec), plus DASH and DRM manifests, so they would only add broken cards.
    genericScan: false,
    collect
  };

  function collect({ document, location }) {
    const script = [...document.scripts].find(node => CONFIG_SCRIPT.test(node.textContent.slice(0, 64)));
    if (script) {
      if (!parsed.has(script)) parsed.set(script, itemsFromConfig(configFromScript(script.textContent)));
      return parsed.get(script);
    }
    return /^(?:www\.)?vimeo\.com$/i.test(location.hostname) ? clipItems(document, location) : [];
  }

  function clipItems(document, location) {
    const clip = clipFromPath(location.pathname);
    if (!clip) return [];
    const signature = document.querySelector(`meta[name="video-signature-${clip.id}"]`)?.getAttribute('content') || '';
    // Next.js replaces the head after in-app navigation; the rescan that follows finds it.
    if (!SIGNATURE.test(signature)) return [];
    const key = clip.hash ? `${clip.id}:${clip.hash}` : clip.id;
    const cached = state.clips.get(key);
    if (cached && cached.until > Date.now()) return cached.items;
    if (state.clips.size > 50) state.clips.clear();
    const entry = { until: Date.now() + RETRY_MS, items: null };
    entry.items = fetchConfig(location.origin, clip, key, signature).then((config) => {
      entry.until = expiry(config);
      return itemsFromConfig(config);
    }, () => []);
    state.clips.set(key, entry);
    return entry.items;
  }

  // The same requests the page makes: an anonymous viewer token, the clip's config URL from the
  // API, then the config.
  async function fetchConfig(origin, clip, key, signature) {
    const jwt = await viewerToken(origin);
    const response = await fetch(`https://api.vimeo.com/videos/${key}?anon_signature=${signature}&fields=config_url`, {
      credentials: 'omit',
      headers: { authorization: `jwt ${jwt}`, accept: 'application/vnd.vimeo.*+json;version=3.4.10' }
    });
    if (!response.ok) throw new Error(`Vimeo API answered HTTP ${response.status}.`);
    const url = playerConfigUrl((await response.json())?.config_url, clip.id);
    if (!url) throw new Error('Vimeo API returned no player config.');
    const config = await fetch(url, { credentials: 'omit' });
    if (!config.ok) throw new Error(`Vimeo config answered HTTP ${config.status}.`);
    return config.json();
  }

  async function viewerToken(origin) {
    if (state.viewer && state.viewer.until > Date.now()) return state.viewer.jwt;
    const response = await fetch(`${origin}/_next/viewer`, { credentials: 'omit', headers: { accept: 'application/json' } });
    const jwt = response.ok ? (await response.json())?.jwt : '';
    if (typeof jwt !== 'string' || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(jwt)) throw new Error('No Vimeo viewer token.');
    let exp = 0;
    try { exp = Number(JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp) || 0; } catch { /* Opaque token. */ }
    state.viewer = { jwt, until: exp ? exp * 1000 - 120000 : Date.now() + 5 * 60 * 1000 };
    return jwt;
  }

  // Media URLs are signed for request.expires seconds from request.timestamp.
  function expiry(config) {
    const end = (Number(config?.request?.timestamp) + Number(config?.request?.expires)) * 1000;
    return Number.isFinite(end) && end > Date.now() ? end - 5 * 60 * 1000 : Date.now() + 30 * 60 * 1000;
  }

  function clipFromPath(pathname) {
    const [, id, hash] = CLIP_PATH.exec(String(pathname || '')) || [];
    return id ? { id, hash: hash || '' } : null;
  }

  function playerConfigUrl(value, id) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'player.vimeo.com' && url.pathname === `/video/${id}/config` ? url.href : '';
    } catch { return ''; }
  }

  function configFromScript(text) {
    try {
      return JSON.parse(String(text).replace(CONFIG_SCRIPT, '').trim().replace(/;$/, ''));
    } catch { return null; }
  }

  function itemsFromConfig(config) {
    const video = config?.video;
    const files = config?.request?.files;
    if (!video || typeof video !== 'object' || !files || typeof files !== 'object') return [];
    // Live and upcoming events play a playlist without an end; they are not listed as downloads.
    if (LIVE.has(video.live_event?.status)) return [];
    const base = {
      title: text(video.title, 300),
      author: text(video.owner?.name, 80) || undefined,
      thumbnail: imageUrl(video.thumbnail_url) || undefined,
      duration: positive(video.duration) || undefined,
      width: positive(video.width) || undefined,
      height: positive(video.height) || undefined
    };
    const hls = manifestUrl(files.hls);
    // Widevine, PlayReady and FairPlay (SAMPLE-AES) titles are listed so the panel shows them as protected.
    if (config.request.drm || [files.hls, files.dash].some(hasDrmPath)) {
      return hls ? [{ ...base, url: hls, kind: 'hls', mimeType: 'application/x-mpegURL', protection: 'unsupported-drm' }] : [];
    }
    const progressive = progressiveVariants(files.progressive, base.duration);
    const best = progressive[0];
    // A muxed MP4 is the simplest download when it reaches the top adaptive quality.
    if (best && (!hls || (best.height || 0) >= topHeight(files, base.height))) {
      return [{ ...base, url: best.url, kind: 'direct', mimeType: 'video/mp4', width: best.width, height: best.height, variants: progressive }];
    }
    // The service reads the master's renditions, with their separate audio, into the quality list.
    return hls ? [{ ...base, url: hls, kind: 'hls', mimeType: 'application/x-mpegURL' }] : [];
  }

  // The default CDN first. avc_url leaves out the HEVC and AV1 renditions that not every player decodes.
  function manifestUrl(group) {
    const cdns = group?.cdns;
    if (!cdns || typeof cdns !== 'object') return '';
    for (const name of [group.default_cdn, ...Object.keys(cdns)]) {
      const url = cdnUrl(cdns[name]?.avc_url) || cdnUrl(cdns[name]?.url);
      if (url) return url;
    }
    return '';
  }

  function hasDrmPath(group) {
    return Object.values(group?.cdns || {}).some(cdn => [cdn?.url, cdn?.avc_url].some(url => /\/playlist\/drm\//.test(cdnUrl(url))));
  }

  function progressiveVariants(list, duration) {
    const variants = [];
    for (const file of Array.isArray(list) ? list : []) {
      const url = cdnUrl(file?.url);
      if (!url || (file.mime && file.mime !== 'video/mp4')) continue;
      const height = positive(file.height);
      variants.push({
        id: `mp4-${text(file.quality, 20) || height || variants.length}`, url, kind: 'direct', mimeType: 'video/mp4', container: 'mp4',
        width: positive(file.width) || undefined, height: height || undefined, fps: positive(file.fps) || undefined, duration, hasAudio: true, hasVideo: true
      });
    }
    return variants.sort((a, b) => (b.height || 0) - (a.height || 0));
  }

  function topHeight(files, fallback) {
    const heights = [files.hls, files.dash].flatMap(group => (Array.isArray(group?.streams) ? group.streams : [])
      .map(stream => Number(/^(\d{3,4})p$/i.exec(String(stream?.quality || ''))?.[1]) || 0));
    return Math.max(0, ...heights) || fallback || 0;
  }

  function cdnUrl(value) {
    if (typeof value !== 'string' || value.length > 8192) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname.endsWith('.vimeocdn.com') ? url.href : '';
    } catch { return ''; }
  }

  function imageUrl(value) {
    const url = cdnUrl(value);
    return url && new URL(url).hostname === 'i.vimeocdn.com' ? url : '';
  }

  function text(value, max) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }
})();
