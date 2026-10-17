import bilibili from './bilibili.js';
import streamable from './streamable.js';
import ninegag from './ninegag.js';
import loom from './loom.js';
import rumble from './rumble.js';
import kick from './kick.js';
import soundcloud from './soundcloud.js';
import { siteProfileForUrl } from '../../shared/sites.js';
import facebook from './facebook.js';
import instagram from './instagram.js';
import reddit from './reddit.js';
import x from './x.js';
import linkedin from './linkedin.js';
import tiktok from './tiktok.js';
import vimeo from './vimeo.js';
import twitch from './twitch.js';
import dailymotion from './dailymotion.js';
import threads from './threads.js';
import bluesky from './bluesky.js';
import pinterest from './pinterest.js';
import tumblr from './tumblr.js';

// Background halves of the site adapters, keyed by SITE_PROFILES id.
const RULES = {
  bilibili, streamable, ninegag, loom, rumble, kick, soundcloud, facebook, instagram, reddit, x, linkedin, tiktok, vimeo, twitch, dailymotion, threads, bluesky, pinterest, tumblr };

// Lets a site rewrite or drop a network-observed media response before it becomes a card.
// Returns undefined to keep the generic behaviour, null to drop it, or replacement items.
export function siteNetworkItems(pageUrl, details, context) {
  const id = siteProfileForUrl(pageUrl)?.id;
  const rule = RULES[id]?.networkItems;
  if (!rule) return undefined;
  try {
    const result = rule(details, context);
    return result === undefined || result === null ? result : [].concat(result).filter(Boolean).map(item => ({ adapterId: id, ...item }));
  } catch { return undefined; }
}

// Resolves a content-script request that needs extension host access (no page CORS).
// Each site builds its own request URLs from validated identifiers; the page never
// chooses what the extension fetches.
export async function resolveSiteRequest(pageUrl, siteId, request, context) {
  const profile = siteProfileForUrl(pageUrl);
  if (!profile || profile.id !== siteId) throw new Error('This request does not belong to the current site.');
  const resolve = RULES[siteId]?.resolve;
  if (!resolve) throw new Error('This site has no background resolver.');
  return resolve(request, context);
}
