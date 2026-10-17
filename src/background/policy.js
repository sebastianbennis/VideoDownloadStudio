import { MEDIA_KINDS, OUTPUT_ACTIONS } from '../shared/constants.js';
import { isYouTubePage } from '../shared/url.js';
import { normalizeVariants } from '../shared/media-variants.js';
import { normalizeSabrMetadata } from '../shared/sabr-plan.js';
import { bestTitle } from '../shared/titles.js';

export function isExtensionPage(sender) {
  return Boolean(sender?.id === chrome.runtime.id && sender?.url === chrome.runtime.getURL('src/ui/panel.html'));
}

export function isContentSender(sender) {
  return Number.isInteger(sender?.tab?.id) && typeof sender?.url === 'string';
}

export function parseUiCommand(message, sender) {
  if (!isExtensionPage(sender)) throw userError('permission', 'Only extension pages can run commands.');
  if (!message || message.target !== 'service' || typeof message.type !== 'string') throw userError('bad-request', 'Malformed command.');
  return message;
}

export function validateObservation(message, sender, { trustedAdapter = false } = {}) {
  if (!isContentSender(sender)) throw userError('permission', 'Only content scripts can report media.');
  if (!message || message.target !== 'service' || message.type !== 'media.observed' || !Array.isArray(message.items)) {
    throw userError('bad-request', 'Malformed media observation.');
  }
  const pageUrl = new URL(sender.url);
  return message.items.slice(0, 50).map((item) => normalizeObservedItem(item, sender, pageUrl, trustedAdapter)).filter(Boolean);
}

export function requireAllowedAction(action) {
  if (!OUTPUT_ACTIONS.includes(action)) throw userError('bad-request', 'Unknown action.');
  return action;
}

export function userError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeObservedItem(item, sender, pageUrl, trustedAdapter) {
  if (!item || typeof item.url !== 'string' || item.url.length > 8000) return null;
  // Generic page assets do not identify the selected YouTube video's streams.
  if (isYouTubePage(pageUrl.href) && item.source !== 'manual' && !(trustedAdapter && item.adapterId === 'youtube')) return null;
  if (item.adapterId === 'youtube' && !trustedAdapter) return null;
  let mediaUrl;
  try {
    mediaUrl = new URL(item.url, pageUrl.href);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(mediaUrl.protocol) || mediaUrl.username || mediaUrl.password) return null;
  const kind = MEDIA_KINDS.includes(item.kind) ? item.kind : inferKind(mediaUrl.href, item.mimeType);
  if (kind === 'sabr' && !(trustedAdapter && item.adapterId === 'youtube')) return null;
  const sabr = trustedAdapter && item.adapterId === 'youtube' ? normalizeSabrMetadata(item.sabr) : undefined;
  if (kind === 'sabr' && !sabr) return null;
  return {
    tabId: sender.tab.id,
    frameId: sender.frameId || 0,
    documentId: sender.documentId || String(sender.frameId || 0),
    pageOrigin: pageUrl.origin,
    // One cleanup for every source: captions, adapter titles and tab titles (see shared/titles.js).
    title: cleanText(bestTitle({ title: item.title, pageTitle: sender.tab.title, author: item.author, host: pageUrl.hostname }), 240),
    author: cleanText(item.author || '', 80) || undefined,
    url: mediaUrl.href,
    kind,
    sabr,
    mimeType: cleanText(item.mimeType || '', 120),
    source: ['adapter', 'network', 'manual'].includes(item.source) ? item.source : 'dom',
    adapterId: cleanText(item.adapterId || '', 80) || undefined,
    thumbnail: safeHttp(item.thumbnail),
    audioUrl: safeHttp(item.audioUrl),
    height: Number.isFinite(item.height) ? Number(item.height) : undefined,
    width: Number.isFinite(item.width) ? Number(item.width) : undefined,
    duration: Number.isFinite(item.duration) ? Number(item.duration) : undefined,
    videoId: trustedAdapter && item.adapterId === 'youtube' ? cleanText(item.videoId, 32) : undefined,
    live: item.live === true,
    liveIdentity: trustedAdapter && item.adapterId === 'twitch' ? twitchLiveIdentity(item.liveIdentity, pageUrl) : undefined,
    route: cleanText(item.route || '', 20),
    variants: normalizeVariants(item.variants, { url: mediaUrl.href, kind, mimeType: item.mimeType }).filter(variant => variant.kind !== 'sabr' || Boolean(sabr)),
    protection: item.protection || (kind === 'hls' ? 'unknown' : 'clear'),
    discoveredAt: Date.now()
  };
}

function inferKind(url, mimeType) {
  const value = `${url} ${mimeType || ''}`.toLowerCase();
  if (value.includes('.m3u8') || value.includes('mpegurl')) return 'hls';
  if (value.includes('.mpd') || value.includes('dash+xml')) return 'dash';
  return 'direct';
}

function cleanText(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}


function safeHttp(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length < 8000 ? url.href : undefined; } catch { return undefined; } }

function twitchLiveIdentity(value, pageUrl) {
  if (!(pageUrl.hostname === 'twitch.tv' || pageUrl.hostname.endsWith('.twitch.tv')) || value?.site !== 'twitch' || !/^[a-z0-9_]{3,25}$/.test(value.channel || '') || !/^\d{1,30}$/.test(value.streamId || '')) return undefined;
  const channel = pageUrl.hostname === 'player.twitch.tv' ? pageUrl.searchParams.get('channel') : pageUrl.pathname.split('/')[1];
  if (channel?.toLowerCase() !== value.channel) return undefined;
  return { site: 'twitch', channel: value.channel, streamId: value.streamId };
}
