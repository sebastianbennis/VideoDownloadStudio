// Background rules for Vimeo. See ./index.js for the contract.
// The content-script adapter lists every Vimeo video from its player config, with the quality
// list and DRM state. What the player itself loads from vimeocdn.com are pieces of those videos
// (variant playlists, byte-range and fMP4 segments, DASH JSON), signed copies of masters already
// listed, or DRM streams, so none of it becomes a card of its own. Rules apply by request
// initiator, so this covers vimeo.com and the player frame inside other sites only.
export default { networkItems };

export function networkItems(details) {
  let host;
  try { host = new URL(details.url).hostname; } catch { return undefined; }
  return host.endsWith('.vimeocdn.com') ? null : undefined;
}
