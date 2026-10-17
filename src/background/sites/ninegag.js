export default { networkItems };

export function networkItems({ url }) {
  try {
    const parsed = new URL(url);
    // The state-backed adapter owns every rendition of a post, including its low quality player.
    return /(^|\.)9cache\.com$/i.test(parsed.hostname) && /^\/photo\//.test(parsed.pathname) && /\.(?:mp4|webm)$/i.test(parsed.pathname)
      ? null : undefined;
  } catch { return undefined; }
}
