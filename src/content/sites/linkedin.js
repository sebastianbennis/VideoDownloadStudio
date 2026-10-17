// LinkedIn adapter, content-script world. See discover.js for the adapter contract.
// Players list every progressive MP4 in a data-sources attribute, and logged-in pages also
// embed Voyager JSON (progressiveStreams, adaptiveStreams) in hidden <code> blocks.
(() => {
  // "mp4-720p-30fp-crf28" caps the short side at 720; a smaller upload keeps its own size.
  const CAP = /\/mp4-(\d{3,4})p-/;
  const ASSET = /\/playlist\/vid\/(?:v2\/|dynamic\/)?([\w-]{6,})\//;
  // The logged-in feed marks posts as list items and their text as an expandable text box.
  const POST = 'article,[data-activity-urn],[data-urn],[data-id^="urn:li:"],[role="listitem"]';
  const COMMENTARY = '[data-testid="expandable-text-box"],[data-test-id="main-feed-activity-card__commentary"],.attributed-text-segment-list__content,.update-components-text,.feed-shared-update-v2__description,.feed-shared-inline-show-more-text';
  const MARKER = /"(?:progressiveStreams|adaptiveStreams)"/;
  const parsedSources = new Map();
  const parsedLd = new Map();
  const parsedCode = new WeakMap();
  // The player switches quality while it plays; a video keeps the card URL it was first listed
  // with. Kept on the global so it survives this file being injected again on every scan.
  const cardUrls = globalThis.__VDS_LINKEDIN_CARD_URLS__ ||= new Map();

  if (globalThis.__VDS_SITE_TEST__) {
    (globalThis.__VDS_SITE_INTERNALS__ ||= {}).linkedin = { parseSources, renditions, videosFromJson, ldVideo, toItem, postTitle, assetId, collect };
  }

  (globalThis.__VDS_SITE_ADAPTERS__ ||= {}).linkedin = {
    // LinkedIn Learning streams are protected; only feed, post and company videos are handled.
    matches: location => /(^|\.)linkedin\.com$/i.test(location.hostname) && !/^\/learning(\/|$)/.test(location.pathname),
    // linkedin.page.js copies logged-in players' sources onto data-vds-* attributes.
    pageWorld: true,
    collect,
    // Every <video> playing from dms.licdn.com is read here; a generic scan would add a second
    // card each time the player switches to another quality.
    genericScan: false
  };

  function collect({ document }) {
    const videos = new Map();
    const add = entry => {
      if (!entry?.asset) return;
      const merged = videos.get(entry.asset) || {};
      // Voyager JSON goes first because it carries exact sizes; players then add what it lacks.
      for (const [key, value] of Object.entries(entry)) if (!merged[key] && value && !(Array.isArray(value) && !value.length)) merged[key] = value;
      videos.set(entry.asset, merged);
    };
    for (const node of document.querySelectorAll('code')) codeVideos(node).forEach(add);
    const ld = new Map();
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      const video = ldVideo(script.textContent);
      if (video) ld.set(video.asset, video);
    }
    for (const node of document.querySelectorAll('video')) add(playerVideo(node));
    return [...videos.values()].map(video => stableCard(video.asset, toItem(video, ld.get(video.asset)))).filter(Boolean);
  }

  function stableCard(asset, item) {
    if (!item) return null;
    const known = cardUrls.get(asset);
    if (known) return { ...item, ...known };
    if (cardUrls.size > 500) cardUrls.clear();
    cardUrls.set(asset, { url: item.url, kind: item.kind });
    return item;
  }

  function playerVideo(node) {
    const player = node.closest('[data-sources],[data-vds-sources]');
    const src = httpUrl(node.currentSrc || node.src);
    const listed = parseSources(player?.getAttribute('data-sources') || player?.getAttribute('data-vds-sources'));
    const isHls = source => /mpegurl/i.test(source.mimeType) || /\.m3u8(?:$|\?)/i.test(source.url);
    const sources = listed.filter(source => !isHls(source));
    if (!sources.length && assetId(src)) sources.push({ url: src });
    const asset = assetId(src) || assetId(listed[0]?.url) || urnId(player?.getAttribute('data-digitalmedia-asset-urn'));
    return asset && {
      asset,
      sources,
      hls: listed.find(isHls)?.url,
      ratio: Number(player?.getAttribute('data-aspect-ratio') || player?.getAttribute('data-vds-aspect-ratio')) || 0,
      sourceShort: Number(player?.getAttribute('data-vds-short-side')) || 0,
      title: postTitle(commentary(node)),
      thumbnail: httpUrl(player?.getAttribute('data-poster-url')) || httpUrl(player?.getAttribute('data-vds-poster')) || httpUrl(node.poster),
      duration: Number.isFinite(node.duration) && node.duration > 0 ? node.duration : 0,
      playing: assetId(src) ? { url: src, width: node.videoWidth || 0, height: node.videoHeight || 0 } : undefined
    };
  }

  function commentary(node) {
    let post = node.closest(POST);
    for (let depth = 0; post && depth < 4; depth++) {
      const box = post.querySelector(COMMENTARY);
      // innerText keeps the line breaks that <br> makes, so the title is the first line.
      const text = box?.innerText || box?.textContent;
      if (text?.trim()) return text;
      post = post.parentElement?.closest(POST);
    }
    return '';
  }

  function codeVideos(node) {
    if (parsedCode.has(node)) return parsedCode.get(node);
    // Some blocks keep their JSON inside an HTML comment, which textContent skips.
    const text = [...node.childNodes].map(child => child.nodeType === 3 || child.nodeType === 8 ? child.data : '').join('');
    let videos = [];
    if (MARKER.test(text)) {
      try { videos = videosFromJson(JSON.parse(text.trim())); } catch { videos = []; }
    }
    parsedCode.set(node, videos);
    return videos;
  }

  function parseSources(text) {
    if (typeof text !== 'string' || !text) return [];
    if (parsedSources.has(text)) return parsedSources.get(text).slice();
    let sources = [];
    try {
      const list = JSON.parse(text);
      sources = (Array.isArray(list) ? list : []).flatMap(source => {
        const url = httpUrl(source?.src);
        return url ? [{ url, mimeType: typeof source.type === 'string' ? source.type : 'video/mp4', bitrate: positive(source['data-bitrate']) }] : [];
      });
    } catch { sources = []; }
    if (parsedSources.size > 500) parsedSources.clear();
    parsedSources.set(text, sources);
    return sources.slice();
  }

  // Walks a Voyager response for VideoPlayMetadata objects and the post text that refers to them.
  function videosFromJson(root) {
    const found = [];
    const postsByUrn = new Map();
    const stack = [[root, '']];
    for (let budget = 100000; stack.length && budget > 0; budget--) {
      const [value, post] = stack.pop();
      if (typeof value === 'string') {
        if (post && value.startsWith('urn:li:digitalmediaAsset:')) postsByUrn.set(value, post);
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) { for (const child of value) stack.push([child, post]); continue; }
      const text = typeof value.commentary?.text?.text === 'string' ? value.commentary.text.text : typeof value.commentary?.text === 'string' ? value.commentary.text : '';
      const here = postTitle(text) || post;
      if (Array.isArray(value.progressiveStreams) || Array.isArray(value.adaptiveStreams)) {
        const video = playMetadata(value);
        if (video) found.push({ ...video, title: here });
      }
      for (const child of Object.values(value)) stack.push([child, here]);
    }
    return found.map(({ urn, ...video }) => ({ ...video, title: video.title || postsByUrn.get(urn) || '' }));
  }

  function playMetadata(value) {
    const sources = (value.progressiveStreams || []).flatMap(stream => {
      const url = httpUrl(stream?.streamingLocations?.find(location => httpUrl(location?.url))?.url);
      return url ? [{ url, width: positive(stream.width), height: positive(stream.height), bitrate: positive(stream.bitRate), size: positive(stream.size), mimeType: typeof stream.mediaType === 'string' ? stream.mediaType : 'video/mp4' }] : [];
    });
    const adaptive = (value.adaptiveStreams || []).find(stream => /hls|mpegurl/i.test(`${stream?.protocol} ${stream?.mediaType}`));
    const hls = httpUrl(adaptive?.masterPlaylists?.find(playlist => httpUrl(playlist?.url))?.url);
    const urn = typeof value.media === 'string' ? value.media : typeof value.entityUrn === 'string' ? value.entityUrn : '';
    const asset = assetId(sources[0]?.url) || assetId(hls) || urnId(urn);
    if (!asset || (!sources.length && !hls)) return null;
    const artifacts = Array.isArray(value.thumbnail?.artifacts) ? value.thumbnail.artifacts : [];
    const largest = artifacts.reduce((best, artifact) => (positive(artifact?.width) || 0) > (positive(best?.width) || 0) ? artifact : best, undefined);
    return {
      asset,
      urn,
      sources,
      hls,
      thumbnail: largest && typeof value.thumbnail.rootUrl === 'string' ? httpUrl(value.thumbnail.rootUrl + (largest.fileIdentifyingUrlPathSegment || '')) : '',
      duration: positive(value.duration) ? value.duration / 1000 : 0
    };
  }

  // Public post pages describe their video in JSON-LD, including the size and length of the upload.
  function ldVideo(text) {
    if (typeof text !== 'string' || !text.includes('VideoObject')) return null;
    if (parsedLd.has(text)) return parsedLd.get(text);
    let video = null;
    try {
      const node = JSON.parse(text);
      const asset = node?.['@type'] === 'VideoObject' && assetId(httpUrl(node.contentUrl));
      if (asset) {
        const [, h = 0, m = 0, s = 0] = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(node.duration || '') || [];
        video = { asset, width: positive(node.width), height: positive(node.height), duration: h * 3600 + m * 60 + Number(s) || 0, thumbnail: httpUrl(node.thumbnailUrl) };
      }
    } catch { video = null; }
    if (parsedLd.size > 50) parsedLd.clear();
    parsedLd.set(text, video);
    return video;
  }

  function toItem(video, ld = {}) {
    const sourceShort = ld.width && ld.height ? Math.min(ld.width, ld.height) : video.sourceShort || 0;
    const ratio = video.ratio || (ld.width && ld.height ? ld.width / ld.height : 0);
    const duration = video.duration || ld.duration || undefined;
    const variants = renditions(video.sources || [], { ratio, sourceShort, playing: video.playing, duration });
    const base = { title: video.title || undefined, thumbnail: video.thumbnail || ld.thumbnail || undefined, duration };
    if (!variants.length) return video.hls ? { ...base, url: video.hls, kind: 'hls' } : null;
    // The playing URL is what discover.js finds on the <video>, so both detections share one card.
    return { ...base, url: video.playing?.url || variants[0].url, kind: 'direct', mimeType: 'video/mp4', width: variants[0].width, height: variants[0].height, variants };
  }

  // One variant per distinct size, largest first. Sizes come from the stream data when present,
  // else from the rendition's short-side cap, the aspect ratio and the upload's short side.
  function renditions(sources, { ratio = 0, sourceShort = 0, playing, duration } = {}) {
    const playingShort = Math.min(playing?.width || 0, playing?.height || 0);
    if (playingShort) {
      ratio ||= playing.width / playing.height;
      const cap = Number(CAP.exec(playing.url)?.[1]) || 0;
      // A rendition smaller than its cap shows the whole upload is that small.
      if (!cap || playingShort < cap) sourceShort ||= playingShort;
    }
    const kept = new Map();
    sources.forEach((source, index) => {
      const cap = Number(CAP.exec(source.url)?.[1]) || 0;
      const size = source.url === playing?.url && playingShort ? { width: playing.width, height: playing.height }
        : source.width && source.height ? { width: source.width, height: source.height } : sizeFor(cap, sourceShort, ratio);
      const variant = {
        id: cap ? `mp4-${cap}p` : size.width && size.height ? `${size.width}x${size.height}` : `source-${index}`,
        url: source.url,
        kind: 'direct',
        mimeType: source.mimeType || 'video/mp4',
        container: /webm/i.test(source.mimeType || '') ? 'webm' : 'mp4',
        ...size,
        bitrate: source.bitrate || undefined,
        contentLength: source.size || undefined,
        duration
      };
      // Caps above the upload's size repeat the same file size; keep the best encode of each.
      const key = size.height ? `${cap ? 'cap' : 'source'}:${size.width}x${size.height}` : `#${index}`;
      const previous = kept.get(key);
      if (!previous || (variant.bitrate || 0) > (previous.bitrate || 0)) kept.set(key, variant);
    });
    const short = variant => Math.min(variant.width || variant.height || 0, variant.height || 0);
    return [...kept.values()].sort((a, b) => short(b) - short(a) || (b.bitrate || 0) - (a.bitrate || 0));
  }

  function sizeFor(cap, sourceShort, ratio) {
    const short = cap && sourceShort ? Math.min(cap, sourceShort) : cap || sourceShort;
    if (!short) return {};
    if (!(ratio > 0)) return { height: short };
    const long = Math.round(short * Math.max(ratio, 1 / ratio) / 2) * 2;
    return ratio >= 1 ? { width: long, height: short } : { width: short, height: long };
  }

  function postTitle(text) {
    const line = String(text || '').split('\n').map(part => part.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
    return line.length > 120 ? `${line.slice(0, 120).replace(/\s+\S*$/, '')}…` : line;
  }

  function assetId(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.endsWith('.licdn.com') ? ASSET.exec(parsed.pathname)?.[1] || '' : '';
    } catch { return ''; }
  }

  function urnId(urn) {
    return /^urn:li:digitalmediaAsset:([\w-]{6,})$/.exec(urn || '')?.[1] || '';
  }

  function httpUrl(value) {
    if (typeof value !== 'string' || value.length > 8192) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch { return ''; }
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }
})();
