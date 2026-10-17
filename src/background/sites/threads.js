// Background rules for Threads. See ./index.js for the contract.
// Logged out, the player streams the progressive MP4 the content adapter lists, so that
// sighting merges into the adapter's card. A DASH player fetches byte-range fragments
// (bytestart/byteend query parameters) from cdninstagram.com or fbcdn.net, as on Instagram;
// they are never whole videos, so they are dropped.
export default {
  networkItems(details) {
    return isFragment(details.url) ? null : undefined;
  }
};

export function isFragment(value) {
  try {
    const url = new URL(value);
    return /\.(cdninstagram\.com|fbcdn\.net)$/i.test(url.hostname) && (url.searchParams.has('bytestart') || url.searchParams.has('byteend'));
  } catch { return false; }
}
