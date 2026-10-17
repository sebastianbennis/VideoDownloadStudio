// Bilibili's clear public tracks require its fixed Referer. Never accept page-provided headers.
export const BILIBILI_HEADER_PERMISSION = 'declarativeNetRequestWithHostAccess';
export function isBilibiliMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname.endsWith('.bilivideo.com') || url.hostname.endsWith('.bilivideo.cn') || url.hostname === 'upos-hz-mirrorakam.akamaized.net') &&
      /\.(?:m4s|mp4)(?:$)/i.test(url.pathname);
  } catch { return false; }
}
export function needsBilibiliHeaders(candidate) {
  try {
    const page = new URL(candidate.pageOrigin);
    return candidate.adapterId === 'bilibili' && page.protocol === 'https:' &&
      (page.hostname === 'bilibili.com' || page.hostname.endsWith('.bilibili.com'));
  } catch { return false; }
}
