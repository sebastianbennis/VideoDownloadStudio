// Turns what a page or site adapter calls a video (a caption, a post, a tab title) into a title fit
// for a card and a filename. Every candidate passes through here, so titles look alike on all sites.

const MAX_LENGTH = 100;
const SITE_NAMES = Object.freeze({
  'facebook.com': 'Facebook', 'fb.watch': 'Facebook', 'instagram.com': 'Instagram', 'reddit.com': 'Reddit',
  'x.com': 'X', 'twitter.com': 'X', 'linkedin.com': 'LinkedIn', 'tiktok.com': 'TikTok', 'youtube.com': 'YouTube',
  'vimeo.com': 'Vimeo', 'dailymotion.com': 'Dailymotion', 'dai.ly': 'Dailymotion', 'twitch.tv': 'Twitch', 'threads.com': 'Threads',
  'threads.net': 'Threads', 'bsky.app': 'Bluesky', 'pinterest.com': 'Pinterest', 'pin.it': 'Pinterest', 'tumblr.com': 'Tumblr'
});
// Page titles that name the site or a section rather than a video.
const GENERIC = new Set(['video', 'videos', 'media', 'untitled', 'untitled media', 'home', 'feed', 'watch', 'reels', 'reel', 'explore',
  'for you', 'notifications', 'messages', 'search', 'login', 'log in', 'sign in', 'sign up', 'facebook', 'instagram', 'tiktok',
  'reddit', 'x', 'twitter', 'linkedin', 'youtube', 'vimeo', 'reddit - dive into anything', 'tiktok - make your day', 'video player',
  'twitch', 'dailymotion', 'threads', 'bluesky', 'pinterest', 'tumblr']);

// Page-title shapes sites use; each returns the part that names the video.
const PAGE_TITLES = [
  [/^(.+?) on (?:X|Twitter): ["“](.+?)["”]\s*(?:\/\s*(?:X|Twitter))?$/i, (m) => `${m[1]} - ${m[2]}`],
  [/^(.+?) on Instagram: ["“](.+?)["”]$/i, (m) => `${m[1]} - ${m[2]}`],
  [/^(.+?)\s*:\s*r\/\w+$/i, (m) => m[1]],
  [/^(.+?) on Vimeo$/i, (m) => m[1]]
];
const SITE_SUFFIX = /\s+[|\-\u2013\u2014·•:/]\s+(?:Facebook|Instagram|TikTok|Reddit|LinkedIn|YouTube|Vimeo|Dailymotion|Twitch|X|Twitter)(?:\s+(?:Watch|Video|Reels?))?\s*$/i;

export function siteName(host = '') {
  const hostname = String(host).toLowerCase().replace(/^www\./, '');
  const known = Object.entries(SITE_NAMES).find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`));
  if (known) return known[1];
  // Country domains such as .co.uk and .com.au name the site one label further left.
  const parts = hostname.split('.');
  const label = (parts.length > 2 && parts.at(-2).length <= 3 && parts.at(-1).length === 2 ? parts.at(-3) : parts.at(-2)) || parts[0];
  return label ? label[0].toUpperCase() + label.slice(1) : '';
}

// Quotes around the whole title go, and so does an unmatched one left at either end by a cut; a
// quoted word at the end ("in “english”") keeps both of its quotes.
function trimQuotes(text) {
  for (const [open, close, any] of [[/^["“”]/, /["“”]$/, /["“”]/g], [/^['‘’]/, /['‘’]$/, /['‘’]/g]]) {
    const count = (text.match(any) || []).length;
    if (count === 2 && open.test(text) && close.test(text)) return text.slice(1, -1).trim();
    if (count % 2 && open.test(text)) text = text.slice(1).trim();
    else if (count % 2 && close.test(text)) text = text.slice(0, -1).trim();
  }
  return text;
}

// Returns a cleaned title, or '' when nothing in `raw` names the video.
export function cleanMediaTitle(raw, { host = '' } = {}) {
  if (typeof raw !== 'string') return '';
  // The first line names the video; later lines of a caption are its body.
  let text = raw.replace(/[​-‏⁠-⁤﻿]/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
  text = text.replace(/^\(\d+\+?\)\s*/, '');
  for (const [shape, pick] of PAGE_TITLES) {
    const match = shape.exec(text);
    if (match) { text = pick(match); break; }
  }
  let previous;
  do {
    previous = text;
    text = text.replace(SITE_SUFFIX, '').replace(siteSuffix(host), '');
  } while (text !== previous);
  // Links and trailing hashtag runs are noise in a filename; hashtags inside a sentence stay.
  text = text.replace(/\bhttps?:\/\/\S+/gi, ' ').replace(/\bt\.co\/\S+/gi, ' ')
    // Feeds append "… more" or "See more" to a truncated caption.
    .replace(/\s*(?:…|\.\.\.)\s*(?:see\s+)?more$/i, '').replace(/\s+see more$/i, '')
    .replace(/(?:\s*#[\p{L}\p{N}_]+)+\s*$/u, '')
    .replace(/\s+/g, ' ').trim();
  text = trimQuotes(text).replace(/[\s\-_|·•:,;]+$/u, '').trim();
  if (!/[\p{L}\p{N}]/u.test(text) || isGeneric(text, host)) return '';
  return shorten(text);
}

// The title for a video nothing on the page names.
export function fallbackTitle({ host = '', author = '' } = {}) {
  const name = cleanMediaTitle(author);
  if (name) return `Video by ${name}`;
  const site = siteName(host);
  return site ? `${site} video` : 'Video';
}

export function bestTitle({ title, pageTitle, author, host } = {}) {
  return cleanMediaTitle(title, { host }) || cleanMediaTitle(pageTitle, { host }) || fallbackTitle({ host, author });
}

function siteSuffix(host) {
  const site = siteName(host);
  if (!site) return /$^/;
  return new RegExp(`\\s+[|\\-\u2013\u2014·•:/]\\s+${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
}

function isGeneric(text, host) {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return GENERIC.has(normalized) || normalized === siteName(host).toLowerCase() || normalized === String(host).toLowerCase().replace(/^www\./, '');
}

function shorten(text) {
  const characters = [...text];
  if (characters.length <= MAX_LENGTH) return text;
  const cut = characters.slice(0, MAX_LENGTH).join('');
  const space = cut.lastIndexOf(' ');
  return (space > MAX_LENGTH * 0.6 ? cut.slice(0, space) : cut).replace(/[\s\-_|·•:,;]+$/u, '');
}
