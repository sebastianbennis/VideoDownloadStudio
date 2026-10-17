import { clearTab, clearFrame, getCandidates, ingestCandidates, reapplyPreferredVariants, selectCandidateVariant } from './catalog.js';
import { cancelJob, getJobs, startJob, stopJob, retryJob, mediaEvent, downloadChanged, recoverJobs, pumpQueue, handleMediaPermissionRemoval } from './jobs.js';
import { parseUiCommand, requireAllowedAction, validateObservation } from './policy.js';
import { loadState, saveState, updateSettings } from './store.js';
import { createRequestObserver } from './request-observer.js';
import { isYouTubePage } from '../shared/url.js';
import { accessPatternsForPage, protectedSiteForUrl, siteProfileForUrl, siteScripts } from '../shared/sites.js';
import { resolveSiteRequest, siteNetworkItems } from './sites/index.js';
import { discoverManifestVariants } from './manifest-variants.js';
import { probeYouTubeMedia } from './youtube/provider.bundle.js';
import { ensureOffscreen } from './offscreen-client.js';
import { handlePageTokenReply, disposePageTokenSessionsForTab, disposePageTokenSessionsForFrame } from './youtube/page-token.js';
import { youtubeFrameIdentity } from './youtube/frame.js';
const discoveries = new Map();
const youtubeDiscoveries = new Map();
// Tabs whose page played media through EME (DRM). Nothing is fetched or decrypted; the panel only says so.
const protectedPlayback = new Map();
// Site adapters fetch and resolve videos after the page loads, so a scan keeps the panel in a
// "looking" state for a while instead of saying nothing was found.
const SEARCH_MS = 6000;
const SITE_SEARCH_MS = 15000;
// Installing, updating or reloading resets the toolbar to the manifest popup; the saved choice wins.
// A browser start wakes the worker through this listener, before the first toolbar click.
chrome.runtime.onStartup.addListener(() => { void loadState().then(state => applyDock(state.settings)).catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { void loadState().then(state => applyDock(state.settings)).catch(() => {}); chrome.alarms.create('vds-maintenance', { periodInMinutes: 1 }); });
chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => { if (frameId === 0) { cancelDiscovery(tabId); protectedPlayback.delete(tabId); void clearTab(tabId); } else { cancelFrameDiscovery(tabId, frameId); void clearFrame(tabId, frameId); } });
chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId }) => { if (frameId === 0) { cancelDiscovery(tabId); protectedPlayback.delete(tabId); void clearTab(tabId).then(() => scanTab(tabId)).catch(() => {}); } else { cancelFrameDiscovery(tabId, frameId); void clearFrame(tabId, frameId).then(() => scanYouTubeFrameById(tabId, frameId)).catch(() => {}); } });
chrome.webNavigation.onCompleted.addListener(({ tabId, frameId }) => { if (frameId === 0) void scanTab(tabId).catch(() => {}); else void scanYouTubeFrameById(tabId, frameId).catch(() => {}); });
chrome.tabs.onRemoved.addListener(tabId => { cancelDiscovery(tabId); protectedPlayback.delete(tabId); void clearTab(tabId); });
chrome.downloads.onChanged.addListener(delta => { void downloadChanged(delta).catch(console.error); });
chrome.permissions.onRemoved.addListener(() => { void handleMediaPermissionRemoval().catch(console.error); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'vds-maintenance') void recoverJobs().catch(console.error); });
const requestObserver = createRequestObserver(chrome, observeNetwork);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'service') return false;
  handleMessage(message, sender).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: { code: error.code || 'error', message: error.message || String(error) } }));
  return true;
});
const ready = Promise.all([requestObserver.refresh(), recoverJobs(), loadState().then(state => applyDock(state.settings))]).catch(console.error);
async function handleMessage(message, sender) {
  await ready;
  if (message.type === 'youtube.page-token.reply') return handlePageTokenReply(message, sender);
  if (message.type === 'media.observed') {
    const frame = await chrome.webNavigation.getFrame({ tabId: sender.tab?.id, frameId: sender.frameId || 0 }).catch(() => null);
    if (!frame || (sender.documentId && frame.documentId !== sender.documentId)) throw new Error('Observation belongs to a previous document.');
    // Adapter and manual provenance are assigned by the service, never by page messages.
    const observed = { ...message, items: message.items?.map(item => ({ ...item, source: item.source === 'manual' ? 'dom' : item.source })) };
    return ingestObserved(validateObservation(observed, sender));
  }
  if (message.type === 'media.protected') {
    if (!Number.isInteger(sender.tab?.id)) throw new Error('Only content scripts can report protected playback.');
    const frame = await chrome.webNavigation.getFrame({ tabId: sender.tab.id, frameId: sender.frameId || 0 }).catch(() => null);
    if (!frame || (sender.documentId && frame.documentId !== sender.documentId)) throw new Error('Report belongs to a previous document.');
    protectedPlayback.set(sender.tab.id, Date.now());
    return true;
  }
  if (message.type === 'site.resolve') {
    if (!Number.isInteger(sender.tab?.id) || typeof sender.url !== 'string') throw new Error('Only content scripts can resolve site media.');
    const frame = await chrome.webNavigation.getFrame({ tabId: sender.tab.id, frameId: sender.frameId || 0 }).catch(() => null);
    if (!frame || frame.url !== sender.url || (sender.documentId && frame.documentId !== sender.documentId)) throw new Error('Request belongs to a previous document.');
    const observedFrame = { documentId: frame.documentId, url: frame.url };
    const siteId = String(message.siteId || '');
    const grants = await chrome.permissions.getAll();
    const items = await resolveSiteRequest(sender.url, siteId, message.request, { allowedOrigins: grants.origins || [], pageUrl: sender.url });
    const current = await chrome.webNavigation.getFrame({ tabId: sender.tab.id, frameId: sender.frameId || 0 }).catch(() => null);
    if (!current || current.documentId !== observedFrame.documentId || current.url !== observedFrame.url) return { count: 0 };
    const added = await ingestObserved(validateObservation({ target: 'service', type: 'media.observed', items: (items || []).map(item => ({ source: 'adapter', ...item, adapterId: siteId })) }, sender, { trustedAdapter: true }), observedFrame);
    return { count: added.length };
  }
  if (message.type === 'media.event') {
    if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('src/offscreen/host.html')) throw new Error('Only the media host may report job events.');
    return mediaEvent(message.jobId, message.event);
  }
  const command = parseUiCommand(message, sender);
  switch (command.type) {
    case 'state.get': return readState(command.tabId);
    case 'scan': return scanTab(command.tabId);
    case 'candidate.addUrl': return addManualCandidate(command);
    case 'candidate.select': return selectCandidateVariant(String(command.candidateId || ''), String(command.variantId || ''));
    case 'job.start': return startJob({ candidateId: String(command.candidateId || ''), variantId: command.variantId, action: requireAllowedAction(command.action || 'download'), filename: command.filename });
    case 'job.cancel': return cancelJob(String(command.jobId || ''));
    case 'job.stop': return stopJob(String(command.jobId || ''));
    case 'job.retry': return retryJob(String(command.jobId || ''));
    case 'job.show': { const job = (await getJobs()).find(x => x.id === command.jobId); if (!Number.isInteger(job?.chromeDownloadId)) throw new Error('No saved download available.'); await chrome.downloads.show(job.chromeDownloadId); return { shown: true }; }
    case 'history.clear': await saveState({ history: [] }); return true;
    case 'settings.update': {
      const result = await updateSettings(command.patch || {});
      await applyDock(result.settings);
      if ('preferredHeight' in (command.patch || {}) || 'preferredContainer' in (command.patch || {})) await reapplyPreferredVariants();
      void pumpQueue();
      return result.settings;
    }
    case 'grants.changed': await requestObserver.refresh(); return readState(command.tabId);
    default: throw new Error(`Unsupported command: ${command.type}`);
  }
}
async function readState(tabId) {
  const state = await loadState();
  const tab = await getTab(tabId);
  const origin = /^https?:/.test(tab?.url || '') ? new URL(tab.url).origin : '';
  const frames = origin ? await chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => null) || [] : [];
  const accessPatterns = origin ? accessPatternsForPage(tab.url, frames.map(frame => frame.url)) : [];
  const protectedSite = origin ? protectedSiteForUrl(tab.url) : '';
  const protection = protectedSite || protectedPlayback.has(tab?.id) ? { drm: true, site: protectedSite || undefined } : undefined;
  const candidates = (await getCandidates(tab?.id ?? tabId)).filter(item => !isYouTubePage(tab?.url) || item.adapterId === 'youtube' || item.source === 'manual');
  const discovery = discoveries.get(tab?.id);
  if (discovery?.until && discovery.until <= Date.now()) discoveries.delete(tab.id);
  return { discovery: discoveries.get(tab?.id)?.status, protection, settings: state.settings, candidates: candidates.map(({ sabr, ...candidate }) => candidate), jobs: await getJobs(), history: state.history, tab, permissions: { hasAllHosts: await chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] }), origin, accessPatterns, hasHostAccess: accessPatterns.length ? await chrome.permissions.contains({ origins: accessPatterns }) : false, granted: await chrome.permissions.getAll() } };
}
async function scanTab(tabId) {
  const tab = await getTab(tabId);
  if (!Number.isInteger(tab?.id) || !/^https?:/.test(tab.url || '')) throw new Error('Open a web page to scan for media.');
  if (isYouTubePage(tab.url)) return scanYouTubeTab(tab);
  // Site adapters register before the generic scanners that call them. Each frame gets the
  // scripts for its own URL, so another site's embedded player (a Vimeo iframe on a blog) is read
  // by that player's adapter. Frames without access are skipped, as allFrames does.
  const frames = (await chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => null) || [])
    .map(frame => ({ ...frame, scripts: siteScripts(frame.url) }));
  const inject = (world, pick) => Promise.all(frames.filter(frame => pick(frame.scripts).length).map(frame =>
    chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frame.frameId] }, world, files: pick(frame.scripts) }).catch(() => {})));
  await inject('ISOLATED', scripts => scripts.isolated);
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/content/discover.js'] });
  await inject('MAIN', scripts => scripts.page);
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'MAIN', files: ['src/content/page-bridge.js'] });
  const sited = siteProfileForUrl(tab.url) || frames.some(frame => frame.scripts.isolated.length);
  const until = Date.now() + (sited ? SITE_SEARCH_MS : SEARCH_MS);
  discoveries.set(tab.id, { controller: new AbortController(), status: { phase: 'searching', until }, until });
  await Promise.all(frames.filter(frame => youtubeFrameIdentity(frame.url)).map(frame => scanYouTubeFrame(tab, frame).catch(() => {})));
  return { scanned: true };
}

async function scanYouTubeTab(tab) {
  const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null);
  if (!frame) throw new Error('The YouTube page is still loading. Try scan again.');
  return scanYouTubeFrame(tab, { ...frame, frameId: 0 });
}

async function scanYouTubeFrameById(tabId, frameId) {
  const [tab, frame] = await Promise.all([
    getTab(tabId), chrome.webNavigation.getFrame({ tabId, frameId }).catch(() => null)
  ]);
  if (tab && frame && youtubeFrameIdentity(frame.url)) return scanYouTubeFrame(tab, { ...frame, frameId });
}

async function scanYouTubeFrame(tab, frame) {
  const identity = youtubeFrameIdentity(frame.url);
  if (!identity || !frame.documentId) throw new Error('Open an ordinary YouTube video before scanning.');
  const { videoId, origin } = identity;
  const frameId = frame.frameId ?? 0;
  const discoveryId = `${tab.id}:${frameId}`;
  const grants = await chrome.permissions.getAll();
  if (!await chrome.permissions.contains({ origins: [`${origin}/*`] })) {
    throw new Error('Allow this site before extracting YouTube formats.');
  }
  const current = youtubeDiscoveries.get(discoveryId);
  if (current?.videoId === videoId && current.documentId === frame.documentId && current.status.phase === 'extracting') {
    updateYouTubeDiscovery(tab.id);
    return { scanned: true, pending: true };
  }
  cancelFrameDiscovery(tab.id, frameId);
  const controller = new AbortController();
  const entry = { tabId: tab.id, frameId, documentId: frame.documentId, controller, videoId, status: { phase: 'extracting', message: 'Resolving available audio and video formats.' } };
  youtubeDiscoveries.set(discoveryId, entry);
  updateYouTubeDiscovery(tab.id);
  const timeout = setTimeout(() => controller.abort(new Error('YouTube extraction timed out. Scan again.')), 120000);
  void (async () => {
    try {
      await ensureOffscreen();
      const groups = await probeYouTubeMedia({ videoId, title: tab.title, url: frame.url, pageOrigin: origin, tabId: tab.id, frameId, documentId: frame.documentId }, { signal: controller.signal, allowedOrigins: grants.origins || [] });
      controller.signal.throwIfAborted();
      const latestFrame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId });
      const latestIdentity = youtubeFrameIdentity(latestFrame?.url);
      if (youtubeDiscoveries.get(discoveryId) !== entry) return;
      if (latestFrame?.documentId !== frame.documentId || latestIdentity?.origin !== origin || latestIdentity?.videoId !== videoId) throw new Error('The YouTube frame changed. Scan the current video again.');
      if (!await chrome.permissions.contains({ origins: [`${origin}/*`] })) throw new Error('YouTube site access was removed. Allow the site and scan again.');
      controller.signal.throwIfAborted();
      const items = validateObservation({ target: 'service', type: 'media.observed', items: groups }, {
        tab, frameId, documentId: frame.documentId, url: frame.url
      }, { trustedAdapter: true });
      if (!items.some(item => item.variants.length)) throw new Error('No downloadable formats were resolved for this video.');
      await ingestCandidates(items);
      entry.status = { phase: 'complete', message: `${items.reduce((count, item) => count + item.variants.length, 0)} formats found.` };
    } catch (error) {
      if (youtubeDiscoveries.get(discoveryId) === entry) entry.status = { phase: 'failed', message: String(error.message || error).slice(0, 1500) };
    } finally {
      clearTimeout(timeout);
      if (youtubeDiscoveries.get(discoveryId) === entry) updateYouTubeDiscovery(tab.id);
    }
  })();
  return { scanned: true, pending: true };
}

function updateYouTubeDiscovery(tabId) {
  const entries = [...youtubeDiscoveries.values()].filter(entry => entry.tabId === tabId);
  const pending = entries.find(entry => entry.status.phase === 'extracting');
  const latest = pending || entries.find(entry => entry.status.phase === 'failed') || entries.at(-1);
  if (latest) discoveries.set(tabId, { youtube: true, status: latest.status });
  else if (discoveries.get(tabId)?.youtube) discoveries.delete(tabId);
}

async function applyDock(settings) {
  const sidePanel = settings?.dock === 'side-panel';
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: sidePanel }).catch(() => {});
  await chrome.action.setPopup({ popup: sidePanel ? '' : 'src/ui/panel.html' }).catch(() => {});
}

function cancelDiscovery(tabId) {
  void disposePageTokenSessionsForTab(tabId);
  discoveries.get(tabId)?.controller?.abort();
  discoveries.delete(tabId);
  for (const [id, entry] of youtubeDiscoveries) {
    if (entry.tabId === tabId) {
      entry.controller.abort();
      youtubeDiscoveries.delete(id);
    }
  }
}

function cancelFrameDiscovery(tabId, frameId) {
  void disposePageTokenSessionsForFrame(tabId, frameId);
  const id = `${tabId}:${frameId}`;
  youtubeDiscoveries.get(id)?.controller.abort();
  youtubeDiscoveries.delete(id);
  updateYouTubeDiscovery(tabId);
}
async function addManualCandidate(command) {
  const tab = await getTab(command.tabId);
  const url = new URL(command.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP or HTTPS media URL without embedded credentials.');
  return ingestObserved(validateObservation({ target: 'service', type: 'media.observed', items: [{ url: url.href, title: command.title || url.pathname.split('/').pop() || url.hostname, source: 'manual' }] }, { tab: { id: tab?.id ?? 0, title: tab?.title }, frameId: 0, documentId: `manual:${Date.now()}`, url: tab?.url || url.href }));
}
async function getTab(tabId) {
  if (Number.isInteger(tabId)) { try { return await chrome.tabs.get(tabId); } catch { return null; } }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (/^https?:/.test(active?.url || '')) return active;
  return (await chrome.tabs.query({})).filter(x => /^https?:/.test(x.url || '')).sort((a,b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || active || null;
}
async function observeNetwork(details) {
  if (details.tabId < 0 || details.statusCode < 200 || details.statusCode >= 300) return;
  const mimeType = details.responseHeaders?.find(x => x.name.toLowerCase() === 'content-type')?.value || '';
  const mediaLike = (/^(video|audio)\//i.test(mimeType) || /mpegurl|dash\+xml/i.test(mimeType) || /\.(m3u8|mpd)(\?|$)/i.test(details.url)) && !/\.(ts|m4s)(\?|$)/i.test(details.url);
  // Sites can rewrite fragments into whole files, or drop streams their adapter already lists.
  const siteItems = details.initiator ? siteNetworkItems(details.initiator, details, { mimeType, mediaLike }) : undefined;
  if (siteItems === null || siteItems?.length === 0 || (siteItems === undefined && !mediaLike)) return;
  const tab = await getTab(details.tabId);
  if (!/^https?:/.test(tab?.url || '')) return;
  const frame = await chrome.webNavigation.getFrame({ tabId: details.tabId, frameId: details.frameId }).catch(() => null);
  if (!frame || (details.documentId && frame.documentId !== details.documentId)) return;
  const observed = siteItems
    ? siteItems.map(item => ({ title: tab.title, source: 'network', ...item }))
    : [{ url: details.url, mimeType, title: tab.title, source: 'network' }];
  const items = validateObservation({ target: 'service', type: 'media.observed', items: observed }, { tab, url: frame.url, frameId: details.frameId, documentId: frame.documentId });
  await ingestObserved(items);
}
async function ingestObserved(items, observedFrame) {
  const grants = await chrome.permissions.getAll();
  const expanded = await Promise.all(items.map(item => discoverManifestVariants(item, grants.origins || [])));
  if (observedFrame && !await chrome.permissions.contains({ origins: [`${new URL(observedFrame.url).origin}/*`] })) return [];
  const current = await Promise.all(expanded.map(async item => {
    const frame = await chrome.webNavigation.getFrame({ tabId: item.tabId, frameId: item.frameId || 0 }).catch(() => null);
    return frame && (!observedFrame || (frame.documentId === observedFrame.documentId && frame.url === observedFrame.url)) &&
      (item.documentId.startsWith('manual:') || frame.documentId === item.documentId) && new URL(frame.url).origin === item.pageOrigin ? item : null;
  }));
  return ingestCandidates(current.filter(Boolean));
}
