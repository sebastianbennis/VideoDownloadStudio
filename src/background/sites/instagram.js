// Background rules for instagram. See ./index.js for the contract.
// Like Facebook, the player streams DASH representations as byte-range fragments
// (bytestart/byteend query parameters) from cdninstagram.com or fbcdn.net. The content adapter
// lists whole files from the post data, so fragments are dropped.
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
