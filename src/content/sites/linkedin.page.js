// LinkedIn adapter, page world. Logged-in feeds play through Video.js with an inline HLS manifest,
// so the <video> has a blob: source and the page has no data-sources attribute. The player's other
// sources (progressive MP4s and an HLS playlist URL) live only on its JavaScript object (el.player).
// Copy them onto the player element as data-vds-* attributes for the content-script half (linkedin.js).
(() => {
  const TYPES = /^(?:video\/mp4|application\/x-mpegurl|application\/vnd\.apple\.mpegurl)$/i;
  const adapters = window[Symbol.for('vds.page-site-adapters')] ||= {};
  adapters.linkedin = {
    matches: (location) => /(^|\.)linkedin\.com$/i.test(location.hostname),
    collect({ document }) {
      for (const element of document.querySelectorAll('.video-js')) tag(element);
      return [];
    }
  };
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {})['linkedin.page'] = { playerSources, playerShape, tag };

  function tag(element) {
    // Logged-out players already carry data-sources.
    const player = element.player;
    if (!player || element.hasAttribute('data-sources')) return;
    const sources = playerSources(player);
    if (!sources.length) return;
    set(element, 'data-vds-sources', JSON.stringify(sources));
    const { ratio, shortSide } = playerShape(player, element.querySelector('video'));
    if (ratio) set(element, 'data-vds-aspect-ratio', String(ratio));
    if (shortSide) set(element, 'data-vds-short-side', String(shortSide));
    let poster = '';
    try { poster = httpUrl(player.poster?.()); } catch { /* A disposed player throws. */ }
    if (poster) set(element, 'data-vds-poster', poster);
  }

  // The inline manifest is a data: URI; only the HTTP sources are downloadable.
  function playerSources(player) {
    let list;
    try { list = player.currentSources?.(); } catch { return []; }
    return (Array.isArray(list) ? list : []).flatMap((source) => {
      const src = httpUrl(source?.src);
      return src && TYPES.test(source.type || '') ? [{ src, type: source.type }] : [];
    }).slice(0, 12);
  }

  // The HLS renditions name the upload's real size, which caps the MP4 renditions' labels.
  function playerShape(player, video) {
    let playlists = [];
    try {
      const main = player.tech?.({ IWillNotUseThisInPlugins: true })?.vhs?.playlists?.main;
      playlists = Array.isArray(main?.playlists) ? main.playlists : [];
    } catch { playlists = []; }
    const sizes = playlists.map((playlist) => playlist?.attributes?.RESOLUTION).filter((size) => size?.width > 0 && size?.height > 0);
    const largest = sizes.sort((a, b) => Math.min(b.width, b.height) - Math.min(a.width, a.height))[0];
    const width = largest?.width || video?.videoWidth || 0;
    const height = largest?.height || video?.videoHeight || 0;
    return { ratio: width && height ? Number((width / height).toFixed(4)) : 0, shortSide: largest ? Math.min(largest.width, largest.height) : 0 };
  }

  function set(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  function httpUrl(value) {
    if (typeof value !== 'string' || value.length > 8192) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch { return ''; }
  }
})();
