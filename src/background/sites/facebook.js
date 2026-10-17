// Background rules for facebook. See ./index.js for the contract.
// The player streams DASH representations as byte-range fragments (bytestart/byteend query
// parameters on 200 responses), each one a separate URL. The content adapter lists the whole
// representations and the progressive files from page data, so fragments are dropped instead
// of becoming one partial card per request.
export default {
  networkItems(details) {
    return isFragment(details.url) ? null : undefined;
  }
};

export function isFragment(value) {
  try {
    const url = new URL(value);
    return /\.fbcdn\.net$/i.test(url.hostname) && (url.searchParams.has('bytestart') || url.searchParams.has('byteend'));
  } catch { return false; }
}
