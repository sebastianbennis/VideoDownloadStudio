// Background rules for TikTok. See ./index.js for the contract.
export default {
  // The player's own media requests are MediaSource fetches of Referer-locked CDN copies (403
  // without a TikTok Referer) or login-page decorations; the content adapter lists the
  // renditions that download. Everything else keeps the generic behaviour.
  networkItems(details, { mediaLike }) {
    return mediaLike ? null : undefined;
  }
};
