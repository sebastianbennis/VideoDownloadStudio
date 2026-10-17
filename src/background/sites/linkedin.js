// Background rules for LinkedIn. See ./index.js for the contract.
const PROGRESSIVE = /^https:\/\/dms\.licdn\.com\/playlist\/vid\//;

export default {
  // A <video src> request or a player's HEAD probe is a progressive file the content adapter
  // already lists with its post text and every quality, so the sighting adds only a bare card
  // titled by the tab. Other fetches (MediaSource playback the DOM cannot see) stay generic.
  networkItems(details, { mimeType }) {
    if (!PROGRESSIVE.test(details.url) || !/^video\//i.test(mimeType)) return undefined;
    // Logged-in feeds stream HLS: every fMP4 segment (/hls-<codec>-<N>p-.../<n>/<time>) is a
    // fragment of a video, never one of its own. Playlists are not video/* and stay generic.
    if (/\/hls-[^/]+\//.test(new URL(details.url).pathname)) return null;
    return details.method === 'HEAD' || details.type === 'media' ? null : undefined;
  }
};
