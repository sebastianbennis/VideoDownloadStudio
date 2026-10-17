// A frame URL is an identity boundary, not an arbitrary player endpoint.
// Privacy-enhanced embeds need separate metadata and proof compatibility evidence.
export function youtubeFrameIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname !== 'youtube.com' && !url.hostname.endsWith('.youtube.com')) return null;
    const videoId = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : /^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(url.pathname)?.[1];
    return /^[0-9A-Za-z_-]{6,20}$/.test(videoId || '') ? { origin: url.origin, videoId } : null;
  } catch { return null; }
}
