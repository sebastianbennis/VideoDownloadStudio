// Read only the formats already authorized in a fresh public video page response.
// A fresh request avoids associating stale __playinfo__ scripts with a new SPA location.
(() => {
  const HOST = /(^|\.)bilibili\.com$/i;
  const MEDIA_HOST = /^.+\.bilivideo\.(?:com|cn)$/i;
  const MAX_HTML = 5 * 1024 * 1024;
  const state = (globalThis.__VDS_BILIBILI__ ||= { pages: new Map() });
  const internals = { pageRef, jsonAssignment, pageData, parsePlayInfo, mediaUrl };
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {}).bilibili = internals;

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).bilibili = {
    genericScan: false,
    matches: location => HOST.test(location.hostname),
    async collect({ location }) {
      const ref = pageRef(location.href);
      if (!ref) return [];
      let cached = state.pages.get(ref.key);
      if (!cached || Date.now() >= cached.until) {
        cached = { until: Date.now() + 2 * 60 * 60 * 1000 };
        cached.promise = lookUp(ref).catch(() => []).then(items => {
          if (!items.length) cached.until = Date.now() + 30000;
          return items;
        });
        state.pages.set(ref.key, cached);
        if (state.pages.size > 50) state.pages.delete(state.pages.keys().next().value);
      }
      const items = await cached.promise;
      // A request that finishes after navigation belongs to the old video, not the new page.
      return pageRef(location.href)?.key === ref.key ? items : [];
    }
  };

  function pageRef(href) {
    try {
      const url = new URL(href);
      const bvid = url.pathname.match(/^\/video\/(BV[a-z0-9]{10})\/?$/i)?.[1];
      const part = url.searchParams.get('p') || '1';
      if (url.protocol !== 'https:' || !HOST.test(url.hostname) || url.username || url.password || url.port ||
        !bvid || url.searchParams.getAll('p').length > 1 || !/^[1-9]\d{0,3}$/.test(part)) return null;
      return { bvid, part: Number(part), key: `${url.origin}/${bvid}/${part}`, url: `${url.origin}/video/${bvid}/${part === '1' ? '' : `?p=${part}`}` };
    } catch { return null; }
  }

  async function lookUp(ref) {
    const response = await fetch(ref.url, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok || pageRef(response.url)?.key !== ref.key) return [];
    const size = Number(response.headers.get('content-length'));
    if (size > MAX_HTML) return [];
    const html = await response.text();
    if (html.length > MAX_HTML) return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return pageData(doc, ref);
  }

  function pageData(doc, ref) {
    // Canonical URLs omit anthology part numbers, so the response URL binds the part.
    const identities = [doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      doc.querySelector('meta[property="og:url"]')?.getAttribute('content')].filter(Boolean);
    if (!identities.length || identities.some(url => pageRef(url)?.bvid !== ref.bvid)) return [];
    let playInfo;
    for (const script of doc.querySelectorAll('script')) {
      playInfo = jsonAssignment(script.textContent, '__playinfo__');
      if (playInfo) break;
    }
    const title = line(doc.querySelector('h1')?.textContent) || line(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'));
    const thumbnail = imageUrl(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'));
    return parsePlayInfo(playInfo, { title, thumbnail });
  }

  // Extract one balanced JSON object from an assignment. Braces inside strings are inert.
  function jsonAssignment(text, name) {
    if (typeof text !== 'string' || text.length > MAX_HTML || name !== '__playinfo__') return null;
    const match = /\bwindow\.__playinfo__\s*=\s*(\{)/.exec(text);
    if (!match) return null;
    const start = match.index + match[0].length - 1;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') {
        if (--depth === 0) {
          try { return JSON.parse(text.slice(start, index + 1)); } catch { return null; }
        }
      }
    }
    return null;
  }

  function parsePlayInfo(info, meta = {}) {
    if (info?.code !== 0 || !info.data || restricted(info.data)) return [];
    const data = info.data;
    // A preview of a paid video is not a complete public download.
    if ([data.is_preview, data.isPreview, data.need_vip, data.need_pay, data.is_pay].some(enabled)) return [];
    const dash = data.dash;
    if (!dash || !Array.isArray(dash.video) || !Array.isArray(dash.audio)) return [];
    const audio = dash.audio.filter(track => track && /^mp4a\.40\./i.test(track.codecs || '') &&
      /^(?:audio\/mp4|audio\/m4a)$/i.test(track.mimeType || track.mime_type || '') && trackUrl(track))
      .sort((a, b) => (positive(b.bandwidth) || 0) - (positive(a.bandwidth) || 0))[0];
    // Do not silently save video-only when an unsupported or absent audio track cannot be merged.
    if (!audio) return [];
    const audioUrl = trackUrl(audio);
    const duration = positive(data.timelength) ? data.timelength / 1000 : positive(dash.duration);
    const bySize = new Map();
    for (const video of dash.video.slice(0, 100)) {
      const url = trackUrl(video);
      const codecs = String(video?.codecs || '');
      const width = positive(video?.width);
      const height = positive(video?.height);
      if (!url || !width || !height || !/^video\/mp4$/i.test(video.mimeType || video.mime_type || '') || !/^(?:avc[13]|av01|hev1|hvc1)\./i.test(codecs)) continue;
      const variant = {
        id: `${video.id}-${codecs}`, url, audioUrl, kind: 'direct', mimeType: 'video/mp4', audioMimeType: 'audio/mp4', container: 'mp4',
        width, height, bitrate: positive(video.bandwidth), fps: frameRate(video.frameRate || video.frame_rate),
        codecs: `${codecs},${audio.codecs}`, duration, contentLength: positive(video.size), audioContentLength: positive(audio.size),
        hasAudio: true, hasVideo: true
      };
      const key = `${width}x${height}`;
      const previous = bySize.get(key);
      // Each resolution keeps its compatible AVC rendition when the page also advertises AV1.
      if (!previous || codecRank(variant) < codecRank(previous) ||
        (codecRank(variant) === codecRank(previous) && (variant.bitrate || 0) > (previous.bitrate || 0))) bySize.set(key, variant);
    }
    const variants = [...bySize.values()].sort((a, b) => b.width * b.height - a.width * a.height || (b.bitrate || 0) - (a.bitrate || 0));
    if (!variants.length) return [];
    const { id: _, ...best } = variants[0];
    return [{ ...best, title: line(meta.title), thumbnail: meta.thumbnail || undefined, variants }];
  }

  function restricted(data) {
    const stack = [data];
    const keys = new Set(['drm', 'is_drm', 'isDrm', 'drm_info', 'drmInfo', 'drm_tech_type', 'ContentProtection', 'contentProtection', 'license_url', 'licenseUrl', 'pssh']);
    for (let count = 0; stack.length && count < 10000; count++) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      for (const [key, value] of Object.entries(node)) {
        if (keys.has(key) && (enabled(value) || (typeof value === 'string' && value !== '' && value !== '0') ||
          (value && typeof value === 'object' && Object.keys(value).length))) return true;
        if (value && typeof value === 'object') stack.push(value);
      }
    }
    return stack.length > 0;
  }

  function trackUrl(track) {
    const primary = mediaUrl(track?.baseUrl || track?.base_url);
    if (!primary) return '';
    const path = new URL(primary).pathname;
    const backups = [track.backupUrl, track.backup_url].flatMap(value => Array.isArray(value) ? value.slice(0, 8) : []);
    // The listed Akamai mirror serves full GETs where cosov can reject them with HTTP 567.
    // Keep its own signed URL intact and require the same media path, never invent a mirror.
    return [primary, ...backups.map(mediaUrl)].find(value => value &&
      new URL(value).hostname === 'upos-hz-mirrorakam.akamaized.net' && new URL(value).pathname === path) || primary;
  }

  // Keep this allowlist aligned with shared/bilibili.js, which enforces it again before download.
  function mediaUrl(value) {
    if (typeof value !== 'string' || value.length > 16000) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        (MEDIA_HOST.test(url.hostname) || url.hostname === 'upos-hz-mirrorakam.akamaized.net') && /\.(?:m4s|mp4)$/i.test(url.pathname) ? url.href : '';
    } catch { return ''; }
  }

  function imageUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && /(^|\.)hdslb\.com$/i.test(url.hostname) ? url.href : '';
    } catch { return ''; }
  }

  function enabled(value) { return value === true || (Number.isFinite(Number(value)) && Number(value) > 0); }
  function codecRank(variant) { return /^avc[13]\./i.test(variant.codecs) ? 0 : 1; }
  function positive(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : undefined; }
  function line(value) { return typeof value === 'string' ? value.split('\n').map(part => part.trim()).find(Boolean) || '' : ''; }
  function frameRate(value) {
    const parts = String(value || '').split('/');
    return parts.length === 2 ? positive(Number(parts[0]) / Number(parts[1])) : positive(value);
  }
})();
