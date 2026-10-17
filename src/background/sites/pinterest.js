// Background rules for Pinterest. See ./index.js for the contract.
// The content-script adapter looks pins up itself (PinResource only answers same-origin
// requests carrying the web app's handler header), so only network sightings need a rule.
export default { networkItems };

// Every pin video plays from v1.pinimg.com: masters, renditions and segments of streams the
// adapter lists with their pin's title, and autoplaying grid previews it cannot tie to a pin,
// which would only carry the open page's title.
export function networkItems(details) {
  try {
    const url = new URL(details.url);
    return /^v\d*\.pinimg\.com$/.test(url.hostname) && url.pathname.startsWith('/videos/') ? null : undefined;
  } catch { return undefined; }
}
