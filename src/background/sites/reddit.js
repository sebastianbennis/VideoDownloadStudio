// Background rules for reddit. See ./index.js for the contract.
// The content adapter lists every Reddit-hosted video from its player markup (signed HLS or
// DASH master, packaged MP4s, GIF renditions). On the wire the same videos show up again as
// CMAF/DASH byte ranges, variant and audio playlists, 96p seek previews and ad streams, so
// Reddit media hosts never become cards of their own. A master seen here would also merge
// into the adapter's card and replace its post title and poster with the tab's.
const MEDIA_HOST = /^(?:v|packaged-media|preview|external-preview|i)\.redd\.it$/;

export default {
  networkItems(details) {
    let host;
    try { host = new URL(details.url).hostname; } catch { return undefined; }
    return MEDIA_HOST.test(host) ? null : undefined;
  }
};
