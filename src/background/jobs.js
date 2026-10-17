import { acquireBilibiliHeaders, releaseMediaHeaders, recoverMediaHeaders } from './media-headers.js';
import { BILIBILI_HEADER_PERMISSION, isBilibiliMediaUrl, needsBilibiliHeaders } from '../shared/bilibili.js';
import { refreshTwitchPlaylist } from './sites/twitch.js';
import { requestPageToken } from './youtube/page-token.js';
import { refreshSabrJob, refreshSabrToken } from './youtube/sabr-reload.js';
import { normalizeSabrMetadata } from '../shared/sabr-plan.js';
import { getCandidate } from './catalog.js';
import { runOffscreen, offscreenCommand, releaseOffscreen } from './offscreen-client.js';
import { loadState, mutateState } from './store.js';
import { isUrlAllowed } from '../media/fetch.js';
import { makeId } from '../shared/id.js';
import { isYouTubePage } from '../shared/url.js';
import { selectVariant, stitchedContainer } from '../shared/media-variants.js';
import { buildFilename, sanitizeFilename, directMediaExtension, withMediaExtension } from '../naming.js';
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
let pumping = false;
const dispatching = new Set();
const preparingTokens = new Map();
export async function startJob({ candidateId, variantId, action = 'download', filename, candidate: retryCandidate }) {
  const original = retryCandidate || await getCandidate(candidateId);
  if (!original) throw new Error('Media is no longer available. Scan the page again.');
  const { settings } = await loadState();
  const candidate = selectVariant(original, variantId || retryCandidate?.variantId, settings);
  if (isYouTubePage(candidate.pageOrigin) && candidate.adapterId !== 'youtube' && candidate.source !== 'manual') throw new Error('This is an incidental YouTube page asset, not a verified video stream. Scan the current video again to resolve its formats.');
  if (candidate.kind === 'sabr' && (candidate.adapterId !== 'youtube' || !normalizeSabrMetadata(candidate.sabr))) throw new Error('This adaptive format is no longer available. Scan again.');
  if (candidate.protection === 'unsupported-drm') throw new Error('Protected media is not supported.');
  for (const url of [candidate.url, candidate.audioUrl].filter(Boolean)) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid media URL.');
    if (!await chrome.permissions.contains({ origins: [`${parsed.origin}/*`] })) throw new Error(`Allow access to ${parsed.origin} before downloading.`);
  }
  const grants = await chrome.permissions.getAll();
  for (const url of [candidate.url, candidate.audioUrl].filter(Boolean)) if (!isUrlAllowed(url, grants.origins || [], candidate.pageOrigin)) throw new Error('Media URL is outside the allowed network scope.');
  const frame = await chrome.webNavigation.getFrame({ tabId: candidate.tabId, frameId: candidate.frameId || 0 }).catch(() => null);
  if (!frame || (candidate.documentId && !candidate.documentId.startsWith('manual:') && frame.documentId !== candidate.documentId) || new URL(frame.url).origin !== candidate.pageOrigin) throw new Error('This media belongs to a previous page. Scan the current page again.');
  if (candidate.adapterId === 'youtube' && candidate.videoId && youtubeVideoId(frame.url) !== candidate.videoId) throw new Error('The selected video has changed. Scan the current page again.');
  if (candidate.expiresAt && candidate.expiresAt <= Date.now() + 10000) throw new Error('This video URL has expired. Scan again to refresh its formats.');
  if (needsBilibiliHeaders(candidate)) {
    if (![candidate.url, candidate.audioUrl].filter(Boolean).every(isBilibiliMediaUrl)) throw new Error('Bilibili media is outside the supported CDN scope.');
    if (!await chrome.permissions.contains({ permissions: [BILIBILI_HEADER_PERMISSION] })) throw new Error('Allow Bilibili download headers from the Download button first.');
  }
  const hlsNativeOutput = candidate.kind === 'hls' && !candidate.audioUrl && ['download', 'download-as'].includes(action) && !chrome.extension.inIncognitoContext;
  const stitched = ['hls', 'dash'].includes(candidate.kind);
  const container = action === 'audio' ? 'mp3'
    : action === 'preview' ? candidate.container || 'mp4'
    : stitched ? stitchedContainer(settings.preferredContainer, candidate.codecs)
    : candidate.container || settings.preferredContainer;
  const direct = candidate.adapterId !== 'youtube' && candidate.kind === 'direct' && !candidate.audioUrl && ['download', 'download-as'].includes(action);
  const inputBytes = action === 'audio' && candidate.audioUrl ? candidate.audioContentLength : (candidate.contentLength || 0) + (candidate.audioContentLength || 0);
  if (!direct && !hlsNativeOutput && action !== 'preview' && inputBytes > 512 * 1024 * 1024) throw new Error('This format exceeds the 512 MiB browser processing limit. Select a smaller format.');
  const extension = direct ? directMediaExtension(candidate.url, candidate.mimeType) : container;
  const job = { id: makeId('job'), candidateId: candidate.id, variantId: candidate.variantId, candidate: { ...candidate, variants: undefined }, title: candidate.title, phase: 'queued', action, outputContainer: container, filename: buildFilename(filename
    // A name typed on the card still goes into the chosen folder; only the naming rules give way to it.
    ? { title: String(filename).replace(/\.[a-z0-9]{1,5}$/i, ''), url: candidate.url, extension, subdirectory: settings.subdirectory }
    : { title: candidate.title, author: candidate.author, url: candidate.url, extension, template: settings.namingRules, rules: settings.namingRules, subdirectory: settings.subdirectory }), bytesWritten: 0, createdAt: Date.now(), direct, hlsNativeOutput };
  await mutateState(state => {
    if (state.jobs.filter(item => !terminal.has(item.phase)).length >= 50) throw new Error('The queue is full. Wait for a job to finish.');
    return { ...state, jobs: [...state.jobs, job] };
  });
  void pumpQueue();
  return publicJob(job);
}
export async function getJobs() { return (await loadState()).jobs.slice().reverse().map(publicJob); }
export async function retryJob(jobId) {
  const job = await find(jobId);
  if (!terminal.has(job.phase)) throw new Error('This job is still running.');
  return startJob({ candidate: job.candidate, candidateId: job.candidateId, action: job.action });
}
export async function cancelJob(jobId) {
  const job = await find(jobId);
  if (terminal.has(job.phase)) { if (job.outputLeaseId) { await releaseOffscreen(job.outputLeaseId); await patch(job.id, { previewUrl: undefined, outputLeaseId: undefined }); } return; }
  preparingTokens.get(jobId)?.abort();
  await patch(jobId, { phase: 'cancelled' });
  try {
    const actions = [offscreenCommand('cancel', { jobId })];
    if (Number.isInteger(job.chromeDownloadId)) actions.push(chrome.downloads.cancel(job.chromeDownloadId));
    if (job.outputLeaseId) actions.push(releaseOffscreen(job.outputLeaseId));
    await Promise.allSettled(actions);
  } finally { await finishHeaderUse(jobId); void pumpQueue(); }
}
export async function stopJob(jobId) { const job = await find(jobId); if (job.candidate.kind !== 'hls' || terminal.has(job.phase)) return cancelJob(jobId); await offscreenCommand('stop', { jobId }); return patch(jobId, { partial: true }); }
export async function pumpQueue() {
  if (pumping) return;
  pumping = true;
  try {
    const { jobs, settings } = await loadState();
    let slots = settings.concurrentDownloads - jobs.filter(x => !terminal.has(x.phase) && x.phase !== 'queued').length;
    for (const job of jobs.filter(x => x.phase === 'queued')) {
      if (slots-- <= 0) break;
      dispatching.add(job.id);
      await patch(job.id, { phase: 'preparing' });
      void dispatch(job).catch(error => failJob(job.id, error)).finally(() => dispatching.delete(job.id));
    }
  } finally { pumping = false; }
}
async function dispatch(job) {
  if (terminal.has((await find(job.id)).phase)) return;
  const permissions = await chrome.permissions.getAll();
  let tokenFields = {};
  if (job.candidate.kind === 'sabr') {
    const controller = new AbortController();
    preparingTokens.set(job.id, controller);
    try {
      const token = await requestPageToken({ tabId: job.candidate.tabId, frameId: job.candidate.frameId ?? 0, documentId: job.candidate.documentId, videoId: job.candidate.videoId }, controller.signal);
      tokenFields = { poToken: token.poToken, tokenExpiresAt: token.expiresAt };
    } finally { preparingTokens.delete(job.id); }
    if (terminal.has((await find(job.id)).phase)) return;
  }
  if (needsBilibiliHeaders(job.candidate)) {
    await acquireBilibiliHeaders(job.id, [job.candidate.url, job.candidate.audioUrl], permissions.origins || []);
    if (terminal.has((await find(job.id)).phase)) { await releaseMediaHeaders(job.id); return; }
  }
  await patch(job.id, { phase: 'downloading' });
  await runOffscreen({ ...tokenFields, hlsNativeOutput: job.hlsNativeOutput, liveIdentity: job.candidate.liveIdentity, sabr: job.candidate.sabr, videoItag: job.candidate.videoItag, audioItag: job.candidate.audioItag, jobId: job.id, url: job.candidate.url, audioUrl: job.candidate.audioUrl, kind: job.candidate.kind, action: job.action, filename: job.filename, outputContainer: job.outputContainer, allowedOrigins: permissions.origins || [], pageOrigin: job.candidate.pageOrigin, privateContext: chrome.extension.inIncognitoContext, preferredHeight: job.candidate.height || (await loadState()).settings.preferredHeight, adapterId: job.candidate.adapterId, contentLength: job.candidate.contentLength, audioContentLength: job.candidate.audioContentLength, mimeType: job.candidate.mimeType, audioMimeType: job.candidate.audioMimeType, duration: job.candidate.duration, representationId: job.candidate.representationId, audioRepresentationId: job.candidate.audioRepresentationId, maxBytes: (job.direct || job.hlsNativeOutput ? 4096 : job.action === 'preview' ? 128 : 512) * 1024 * 1024 });
  if ((await find(job.id)).phase === 'cancelled') await offscreenCommand('cancel', { jobId: job.id });
}
export async function mediaEvent(jobId, event) {
  const job = (await loadState()).jobs.find(x => x.id === jobId);
  if (!job || terminal.has(job.phase)) { if (event.output?.id) await releaseOffscreen(event.output.id); return; }
  if (event.type === 'hls-renew') return renewHls(job, event);
  if (event.type === 'sabr-reload' || event.type === 'sabr-token-refresh') {
    const tokenRefresh = event.type === 'sabr-token-refresh';
    if (!Number.isInteger(event.requestId) || event.requestId < 1 || event.requestId > 4) throw new Error('Invalid YouTube refresh request.');
    if (tokenRefresh && event.context?.status !== 2 && event.context?.status !== 3) throw new Error('Invalid YouTube proof refresh request.');
    const countKey = tokenRefresh ? 'sabrTokenRefreshCount' : 'sabrReloadCount';
    if (preparingTokens.has(jobId)) throw new Error('YouTube playback refresh is already running.');
    const controller = new AbortController();
    preparingTokens.set(jobId, controller);
    try {
      await mutateState(state => {
        const active = state.jobs.find(item => item.id === jobId);
        if (active?.phase !== 'downloading' || (active[countKey] || 0) >= 2) throw new Error('YouTube playback could not be refreshed. Scan the video again.');
        return { ...state, jobs: state.jobs.map(item => item.id === jobId ? { ...item, [countKey]: (item[countKey] || 0) + 1, bytesWritten: 0, percent: 0 } : item) };
      });
      const result = tokenRefresh
        ? await refreshSabrToken(job, event.context.status, controller.signal)
        : await refreshSabrJob(job, event.context, controller.signal);
      if (terminal.has((await find(jobId)).phase)) throw new Error('YouTube playback refresh was cancelled.');
      return result;
    } finally { preparingTokens.delete(jobId); }
  } else if (event.type === 'progress') {
    const progress = { phase: ['downloading', 'processing'].includes(event.phase) ? event.phase : job.phase, bytesWritten: Number(event.bytesWritten) || job.bytesWritten };
    if (event.totalBytes > 0) { progress.totalBytes = event.totalBytes; progress.percent = Math.min(99, Math.round(progress.bytesWritten / event.totalBytes * 100)); }
    if (Number.isFinite(event.percent)) progress.percent = Math.min(99, Math.max(0, event.percent));
    await patch(jobId, progress);
  } else if (event.type === 'error') await failJob(jobId, event.error);
  else if (event.type === 'complete') {
    const output = event.output;
    if (!output?.blobUrl?.startsWith(`blob:${chrome.runtime.getURL('')}`)) throw new Error('Invalid output lease URL.');
    const filename = output.extension ? withMediaExtension(job.filename, output.extension) : job.filename;
    await patch(jobId, { filename, outputContainer: output.extension || job.outputContainer, outputLeaseId: output.id, bytesWritten: output.bytes, totalBytes: output.bytes, partial: output.partial, partialReason: typeof output.partialReason === 'string' ? output.partialReason.slice(0, 300) : undefined });
    try {
      if (job.action === 'preview') { await patch(jobId, { phase: 'completed', previewUrl: output.blobUrl, percent: 100 }); void pumpQueue(); }
      else await save({ ...job, filename, outputLeaseId: output.id }, output.blobUrl).catch(error => failJob(job.id, error));
    } finally { await finishHeaderUse(jobId); }
  }
}
async function save(job, url) {
  if ((await find(job.id)).phase === 'cancelled') { if (job.outputLeaseId) await releaseOffscreen(job.outputLeaseId); return; }
  await patch(job.id, { phase: 'saving' });
  const id = await chrome.downloads.download({ url, filename: job.filename, saveAs: job.action === 'download-as', conflictAction: 'uniquify', ...(chrome.extension.inIncognitoContext ? { incognito: true } : {}) });
  await patch(job.id, { chromeDownloadId: id });
  if ((await find(job.id)).phase === 'cancelled') { await chrome.downloads.cancel(id).catch(() => {}); return; }
  const [download] = await chrome.downloads.search({ id });
  if (download?.state !== 'in_progress') await downloadChanged({ id, state: { current: download?.state } });
}
export async function downloadChanged(delta) {
  const job = (await loadState()).jobs.find(x => x.chromeDownloadId === delta.id);
  if (!job || terminal.has(job.phase)) return;
  if (delta.state?.current === 'complete') {
    const [item] = await chrome.downloads.search({ id: delta.id });
    // save() and downloads.onChanged can both report one completion; only the first one finishes the
    // job, so history and the notification happen once.
    let finished = false;
    await mutateState(state => {
      const current = state.jobs.find(x => x.id === job.id);
      if (!current || terminal.has(current.phase)) return state;
      finished = true;
      Object.assign(current, { phase: 'completed', percent: 100, bytesWritten: item?.fileSize || current.bytesWritten, totalBytes: item?.fileSize || current.totalBytes });
      if (state.settings.historyDays && !chrome.extension.inIncognitoContext) state.history.push({ id: job.id, title: job.title, filename: job.filename, action: job.action, bytes: item?.fileSize || job.bytesWritten, createdAt: Date.now() });
      return state;
    });
    if (!finished) return;
    if ((await loadState()).settings.desktopNotifications && await chrome.permissions.contains({ permissions: ['notifications'] })) await chrome.notifications.create(job.id, { type: 'basic', iconUrl: chrome.runtime.getURL('assets/icon-128.png'), title: 'VideoDownloadStudio', message: `Saved ${job.filename}` }).catch(() => {});
  } else if (delta.state?.current === 'interrupted') await patch(job.id, { phase: 'interrupted', error: { code: 'save', message: delta.error?.current || 'Chrome interrupted the file save.' } });
  else return;
  if (job.outputLeaseId) await releaseOffscreen(job.outputLeaseId);
  void pumpQueue();
}
export async function recoverJobs() {
  const inventory = await offscreenCommand('inventory');
  for (const job of (await loadState()).jobs) {
    if (terminal.has(job.phase) || job.phase === 'queued' || dispatching.has(job.id)) continue;
    if (Number.isInteger(job.chromeDownloadId)) { const [item] = await chrome.downloads.search({ id: job.chromeDownloadId }); if (item?.state === 'in_progress') continue; await downloadChanged({ id: job.chromeDownloadId, state: { current: item?.state || 'interrupted' } }); }
    else if (inventory?.jobs?.includes(job.id)) continue;
    else { const output = inventory?.leases?.find(x => x.jobId === job.id); if (output && job.phase === 'saving') { const saved = await chrome.downloads.search({ url: output.blobUrl, startedAfter: new Date(job.createdAt).toISOString() }); if (saved.length) { await patch(job.id, { chromeDownloadId: saved[0].id }); await downloadChanged({id:saved[0].id,state:{current:saved[0].state}}); continue; } } if (output) await mediaEvent(job.id, { type: 'complete', output }); else await patch(job.id, { phase: 'interrupted', error: { code: 'restart', message: 'The browser stopped this job. Retry to start again.' } }); }
  }
  await recoverMediaHeaders(async () => (await loadState()).jobs);
  void pumpQueue();
}
async function failJob(id, error) {
  const job = await find(id);
  if (terminal.has(job.phase)) return;
  preparingTokens.get(id)?.abort();
  await patch(id, { phase: 'failed', error: { code: error.code || 'media', message: error.message || String(error) } });
  try { if (job.outputLeaseId) await releaseOffscreen(job.outputLeaseId); }
  finally { await finishHeaderUse(id); void pumpQueue(); }
}
async function finishHeaderUse(id) {
  // Header cleanup must not prevent worker termination or saving an output lease.
  // Retry transient API failures now; wake/maintenance reconciliation retries later.
  try { await releaseMediaHeaders(id); }
  catch {
    try { await releaseMediaHeaders(id); }
    catch { console.warn('Scoped media header cleanup will be retried on maintenance.'); }
  }
}
function publicJob({ candidate, direct, hlsNativeOutput, ...job }) { return job; }
async function find(id) { const job = (await loadState()).jobs.find(x => x.id === id); if (!job) throw new Error('Job not found.'); return job; }
function patch(id, values) { return mutateState(state => ({ ...state, jobs: state.jobs.map(job => job.id === id ? { ...job, ...values } : job) })); }
function youtubeVideoId(value) { try { const url = new URL(value); return url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1]; } catch { return undefined; } }

async function renewHls(job, event) {
  const identity = job.candidate.liveIdentity;
  if (job.phase !== 'downloading' || job.candidate.adapterId !== 'twitch' || !identity || !Number.isSafeInteger(event.requestId) || event.requestId < 1 || event.requestId > 10000) throw new Error('Invalid live recording renewal.');
  if (preparingTokens.has(job.id)) throw new Error('Recording renewal is already running.');
  const controller = new AbortController();
  preparingTokens.set(job.id, controller);
  try {
    const frame = await chrome.webNavigation.getFrame({ tabId: job.candidate.tabId, frameId: job.candidate.frameId || 0 }).catch(() => null);
    if (!frame || frame.documentId !== job.candidate.documentId) throw new Error('The recording page changed. Saved the available recording.');
    const page = new URL(frame.url);
    const channel = page.hostname === 'player.twitch.tv' ? page.searchParams.get('channel') : page.pathname.split('/')[1];
    if (page.origin !== job.candidate.pageOrigin || channel?.toLowerCase() !== identity.channel) throw new Error('The recording channel changed. Saved the available recording.');
    const permissions = await chrome.permissions.getAll();
    if (!isUrlAllowed(frame.url, permissions.origins || [])) throw new Error('Access to the recording page was removed.');
    const result = await refreshTwitchPlaylist(identity, job.variantId, { allowedOrigins: permissions.origins || [], signal: controller.signal });
    const current = await chrome.webNavigation.getFrame({ tabId: job.candidate.tabId, frameId: job.candidate.frameId || 0 }).catch(() => null);
    const currentGrants = await chrome.permissions.getAll();
    if (terminal.has((await find(job.id)).phase) || controller.signal.aborted || !current || current.documentId !== frame.documentId || current.url !== frame.url || ![current.url, result.url, result.audioUrl].filter(Boolean).every(url => isUrlAllowed(url, currentGrants.origins || []))) throw new Error('The recording page or access changed during renewal.');
    return result;
  } finally { preparingTokens.delete(job.id); }
}

export async function handleMediaPermissionRemoval() {
  const { jobs } = await loadState();
  const grants = await chrome.permissions.getAll();
  const capability = await chrome.permissions.contains({ permissions: [BILIBILI_HEADER_PERMISSION] });
  for (const job of jobs) {
    if (terminal.has(job.phase) || !needsBilibiliHeaders(job.candidate)) continue;
    if (!capability || [job.candidate.url, job.candidate.audioUrl].filter(Boolean).some(url => !isUrlAllowed(url, grants.origins || []))) await cancelJob(job.id);
  }
  await recoverMediaHeaders(async () => (await loadState()).jobs);
}
