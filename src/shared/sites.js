// Social sites play video through MediaSource (blob: URLs) and stream it from CDN hosts
// that differ from the page. Each profile names the page hosts it covers, the host
// patterns needed to observe and fetch its media, and the scripts that read the site's
// own video data. `files` run in the content-script world before discover.js; files
// ending in `.page.js` run in the page world before page-bridge.js. `embedHosts` are the
// hosts of the site's own player when another site embeds it in an iframe; a page with such
// a frame asks for the player's access too. `pagePatterns` are media hosts only the site's own
// pages use, left out for its embedded players.
export const SITE_PROFILES = Object.freeze([
  {
    id: 'youtube', hosts: ['youtube.com'], embedHosts: ['www.youtube.com', 'youtube.com'],
    patterns: ['https://*.youtube.com/*', 'https://*.googlevideo.com/*'], files: []
  },
  {
    id: 'bilibili', hosts: ['bilibili.com'],
    patterns: ['https://*.bilibili.com/*', 'https://*.bilivideo.com/*', 'https://*.bilivideo.cn/*', 'https://upos-hz-mirrorakam.akamaized.net/*'],
    files: ['src/content/sites/bilibili.js']
  },
  {
    id: 'streamable',
    hosts: ['streamable.com'],
    patterns: ['https://*.streamable.com/*'],
    files: ['src/content/sites/streamable.js']
  },
  {
    id: 'ninegag',
    hosts: ['9gag.com'],
    patterns: ['https://*.9gag.com/*', 'https://*.9cache.com/*'],
    files: ['src/content/sites/ninegag.js']
  },
  {
    id: 'loom',
    hosts: ['loom.com'],
    patterns: ['https://*.loom.com/*'],
    files: ['src/content/sites/loom.js']
  },
  {
    id: 'rumble',
    hosts: ['rumble.com'],
    patterns: ['https://*.rumble.com/*', 'https://*.rumble.cloud/*', 'https://*.rmbl.ws/*', 'https://*.1a-1791.com/*'],
    files: ['src/content/sites/rumble.js']
  },
  {
    id: 'kick',
    hosts: ['kick.com'],
    patterns: ['https://*.kick.com/*'],
    files: ['src/content/sites/kick.js']
  },
  {
    id: 'soundcloud',
    hosts: ['soundcloud.com'],
    patterns: ['https://*.soundcloud.com/*', 'https://*.sndcdn.com/*', 'https://playback.media-streaming.soundcloud.cloud/*'],
    files: ['src/content/sites/soundcloud.js']
  },
  {
    id: 'facebook',
    embedHosts: ['www.facebook.com'],
    hosts: ['facebook.com', 'fb.watch'],
    patterns: ['https://*.facebook.com/*', 'https://*.fbcdn.net/*'],
    files: ['src/content/sites/facebook.js', 'src/content/sites/facebook.page.js']
  },
  {
    id: 'instagram',
    embedHosts: ['www.instagram.com'],
    hosts: ['instagram.com'],
    patterns: ['https://*.instagram.com/*', 'https://*.cdninstagram.com/*', 'https://*.fbcdn.net/*'],
    files: ['src/content/sites/instagram.js']
  },
  {
    id: 'reddit',
    hosts: ['reddit.com'],
    patterns: ['https://*.reddit.com/*', 'https://*.redd.it/*'],
    files: ['src/content/sites/reddit.js']
  },
  {
    id: 'x',
    embedHosts: ['platform.twitter.com'],
    hosts: ['x.com', 'twitter.com'],
    patterns: ['https://*.x.com/*', 'https://*.twitter.com/*', 'https://*.twimg.com/*'],
    // Spaces stream from Periscope's media hosts (its chat and API hosts stay outside). Only X's
    // own pages play Spaces, so a page with an embedded tweet does not ask for them.
    pagePatterns: ['https://*.video.pscp.tv/*'],
    files: ['src/content/sites/x.js']
  },
  {
    id: 'linkedin',
    hosts: ['linkedin.com'],
    patterns: ['https://*.linkedin.com/*', 'https://*.licdn.com/*'],
    files: ['src/content/sites/linkedin.js', 'src/content/sites/linkedin.page.js']
  },
  {
    id: 'tiktok',
    embedHosts: ['www.tiktok.com'],
    hosts: ['tiktok.com'],
    patterns: ['https://*.tiktok.com/*', 'https://v45.tiktokcdn-eu.com/*'],
    files: ['src/content/sites/tiktok.js']
  },
  {
    id: 'vimeo',
    hosts: ['vimeo.com'],
    patterns: ['https://*.vimeo.com/*', 'https://*.vimeocdn.com/*'],
    embedHosts: ['player.vimeo.com'],
    files: ['src/content/sites/vimeo.js']
  },
  {
    id: 'twitch',
    hosts: ['twitch.tv'],
    // Clips come from one CloudFront host. VOD playlists sit on several others, so the Download
    // click asks for that one host instead of all of cloudfront.net.
    patterns: ['https://*.twitch.tv/*', 'https://*.ttvnw.net/*', 'https://*.twitchcdn.net/*', 'https://*.jtvnw.net/*', 'https://d1ndex63qxojbr.cloudfront.net/*'],
    embedHosts: ['player.twitch.tv', 'clips.twitch.tv'],
    files: ['src/content/sites/twitch.js']
  },
  {
    id: 'dailymotion',
    hosts: ['dailymotion.com', 'dai.ly'],
    patterns: ['https://*.dailymotion.com/*', 'https://*.dmcdn.net/*'],
    embedHosts: ['geo.dailymotion.com', 'www.dailymotion.com'],
    files: ['src/content/sites/dailymotion.js']
  },
  {
    id: 'threads',
    hosts: ['threads.com', 'threads.net'],
    patterns: ['https://*.threads.com/*', 'https://*.threads.net/*', 'https://*.cdninstagram.com/*', 'https://*.fbcdn.net/*'],
    embedHosts: ['www.threads.com', 'www.threads.net'],
    files: ['src/content/sites/threads.js']
  },
  {
    id: 'bluesky',
    hosts: ['bsky.app'],
    patterns: ['https://*.bsky.app/*'],
    embedHosts: ['embed.bsky.app'],
    files: ['src/content/sites/bluesky.js']
  },
  {
    id: 'pinterest',
    // Regional domains (pinterest.co.uk and others) redirect to <country>.pinterest.com.
    hosts: ['pinterest.com', 'pin.it'],
    patterns: ['https://*.pinterest.com/*', 'https://*.pinimg.com/*'],
    embedHosts: ['assets.pinterest.com'],
    files: ['src/content/sites/pinterest.js']
  },
  {
    id: 'tumblr',
    hosts: ['tumblr.com'],
    patterns: ['https://*.tumblr.com/*'],
    embedHosts: ['embed.tumblr.com'],
    files: ['src/content/sites/tumblr.js']
  }
]);

// Streaming services that encrypt every title with DRM (Widevine, PlayReady, FairPlay). The
// panel says so instead of searching; nothing on these sites is ever fetched or decrypted.
export const PROTECTED_SITES = Object.freeze([
  { name: 'Netflix', hosts: ['netflix.com'] },
  { name: 'Disney+', hosts: ['disneyplus.com'] },
  { name: 'Prime Video', hosts: ['primevideo.com'] },
  { name: 'Max', hosts: ['max.com', 'hbomax.com'] },
  { name: 'Hulu', hosts: ['hulu.com'] },
  { name: 'Apple TV+', hosts: ['tv.apple.com'] },
  { name: 'Paramount+', hosts: ['paramountplus.com'] },
  { name: 'Peacock', hosts: ['peacocktv.com'] },
  { name: 'Crunchyroll', hosts: ['crunchyroll.com'] }
]);

function hostnameOf(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
}

const onHost = (hostname, host) => hostname === host || hostname.endsWith(`.${host}`);

export function siteProfileForUrl(value) {
  const hostname = hostnameOf(value);
  return hostname && SITE_PROFILES.find(profile => profile.hosts.some(host => onHost(hostname, host))) || null;
}

export function protectedSiteForUrl(value) {
  const hostname = hostnameOf(value);
  return hostname && PROTECTED_SITES.find(site => site.hosts.some(host => onHost(hostname, host)))?.name || '';
}

// The profile of a frame that is another site's embedded player, or null.
export function embedProfileForUrl(value) {
  const hostname = hostnameOf(value);
  return hostname && SITE_PROFILES.find(profile => profile.embedHosts?.includes(hostname)) || null;
}

// Host patterns to request for a page: its own origin plus the site's media hosts. An embedded
// player's frame leaves out the hosts only the site's own pages use.
export function accessPatternsForUrl(value, { embedded = false } = {}) {
  let origin;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return [];
    origin = url.origin;
  } catch { return []; }
  const profile = siteProfileForUrl(value);
  return [...new Set([`${origin}/*`, ...(profile?.patterns || []), ...(embedded ? [] : profile?.pagePatterns || [])])];
}

// A page's patterns plus those of the site players embedded in its frames.
export function accessPatternsForPage(pageUrl, frameUrls = []) {
  const patterns = accessPatternsForUrl(pageUrl);
  if (!patterns.length) return patterns;
  for (const url of frameUrls) if (embedProfileForUrl(url)) patterns.push(...accessPatternsForUrl(url, { embedded: true }));
  return [...new Set(patterns)];
}

export function siteScripts(value) {
  const files = siteProfileForUrl(value)?.files || [];
  return {
    isolated: files.filter(file => !file.endsWith('.page.js')),
    page: files.filter(file => file.endsWith('.page.js'))
  };
}
