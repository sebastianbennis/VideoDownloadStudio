// facebook adapter, page world. Feed posts often render without a permalink, but the player's
// React props name the video (coreVideoPlayerMetaData.videoFBID). Tag each <video> with that id
// so the content-script half (facebook.js) can read the video's data.
(() => {
  const ID = /^\d{5,25}$/;
  const adapters = window[Symbol.for('vds.page-site-adapters')] ||= {};
  adapters.facebook = {
    matches: (location) => /(^|\.)facebook\.com$/i.test(location.hostname),
    collect({ document }) {
      for (const video of document.querySelectorAll('video')) {
        const id = playerVideoId(video);
        if (id && video.getAttribute('data-vds-fbid') !== id) video.setAttribute('data-vds-fbid', id);
      }
      return [];
    }
  };
  if (globalThis.__VDS_SITE_TEST__) (globalThis.__VDS_SITE_INTERNALS__ ||= {})['facebook.page'] = { playerVideoId };

  function playerVideoId(video) {
    let node = video;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const key = Object.keys(node).find(name => name.startsWith('__reactFiber$'));
      if (!key) continue;
      for (let fiber = node[key], steps = 0; fiber && steps < 60; fiber = fiber.return, steps += 1) {
        const props = fiber.memoizedProps;
        const id = String(props?.coreVideoPlayerMetaData?.videoFBID ?? props?.videoFBID ?? '');
        if (ID.test(id)) return id;
      }
      return '';
    }
    return '';
  }
})();
