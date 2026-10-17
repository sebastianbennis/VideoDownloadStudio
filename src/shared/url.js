export function originFromUrl(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function isYouTubePage(value) {
  try {
    const host = new URL(value).hostname;
    return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com');
  } catch { return false; }
}

export function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sameOrAllowedOrigin(url, allowedOrigins = []) {
  const origin = originFromUrl(url);
  return Boolean(origin && allowedOrigins.includes(origin));
}

export function uniqueUrls(urls) {
  return Array.from(new Set(urls.filter(isHttpUrl)));
}

export function resolveMaybeUrl(value, baseUrl) {
  if (!value) return '';
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return '';
  }
}
