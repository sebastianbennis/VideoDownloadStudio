import { normalizeSabrMetadata, sameSabrFormatIdentity } from '../../shared/sabr-plan.js';
import { isUrlAllowed } from '../../media/fetch.js';
import { requestPageToken } from './page-token.js';
import { youtubeFrameIdentity } from './frame.js';
import { refreshYouTubeSabr } from './provider.bundle.js';

// Reload contexts and proof tokens live only for this request, never in storage.
export async function refreshSabrJob(job, context, signal, options = {}) {
  const token = context?.reloadPlaybackParams?.token;
  if (typeof token !== 'string' || !/^(?:[A-Za-z0-9_+\/=-]|%[0-9A-Fa-f]{2})+$/.test(token) || token.length > 16384) throw new Error('Invalid YouTube playback reload request.');
  return refreshPlayback(job, { reloadPlaybackParams: { token } }, signal, options);
}

export async function refreshSabrToken(job, status, signal, options = {}) {
  if (status !== 2 && status !== 3) throw new Error('Invalid YouTube proof refresh request.');
  return refreshPlayback(job, null, signal, options);
}

async function refreshPlayback(job, context, signal, options) {
  const candidate = job?.candidate;
  if (job?.phase !== 'downloading' || candidate?.adapterId !== 'youtube' || candidate.kind !== 'sabr') throw new Error('This job cannot refresh YouTube playback.');
  const chromeApi = options.chromeApi || chrome;
  const assertCurrent = async () => {
    signal?.throwIfAborted();
    const frame = await chromeApi.webNavigation.getFrame({ tabId: candidate.tabId, frameId: candidate.frameId ?? 0 });
    let page;
    try { page = new URL(frame?.url); } catch { throw new Error('The YouTube page is no longer available.'); }
    const identity = youtubeFrameIdentity(page.href);
    if (!identity || frame.documentId !== candidate.documentId || page.origin !== candidate.pageOrigin || identity.videoId !== candidate.videoId) throw new Error('The YouTube page changed. Scan the current video again.');
    if (!await chromeApi.permissions.contains({ origins: [`${page.origin}/*`] })) throw new Error('Allow this YouTube site before refreshing playback.');
    signal?.throwIfAborted();
  };
  await assertCurrent();
  const refreshMetadata = options.refreshMetadata || refreshYouTubeSabr;
  const grants = await chromeApi.permissions.getAll();
  const raw = context ? await refreshMetadata(candidate, context, { signal, allowedOrigins: grants.origins || [] }) : candidate.sabr;
  const sabr = normalizeSabrMetadata(raw);
  const assertPlaybackGranted = async () => {
    const currentGrants = await chromeApi.permissions.getAll();
    if (!sabr || !isUrlAllowed(new URL(sabr.serverAbrStreamingUrl), currentGrants.origins || [], candidate.pageOrigin)) throw new Error('Refreshed YouTube playback is outside this job scope.');
    signal?.throwIfAborted();
  };
  await assertPlaybackGranted();
  for (const [itag, mime] of [[candidate.videoItag, candidate.mimeType], [candidate.audioItag, candidate.audioMimeType]]) {
    const original = candidate.sabr?.formats.find(format => format.itag === itag);
    const refreshed = sabr.formats.find(format => format.itag === itag);
    if (!sameSabrFormatIdentity(original, refreshed) || refreshed.mimeType.split(';', 1)[0] !== mime?.split(';', 1)[0]) throw new Error('The selected YouTube format is no longer available. Scan again.');
  }
  await assertCurrent();
  const proof = await (options.requestToken || requestPageToken)({ tabId: candidate.tabId, frameId: candidate.frameId ?? 0, documentId: candidate.documentId, videoId: candidate.videoId }, signal, context ? undefined : { forceRefresh: true });
  await assertCurrent();
  await assertPlaybackGranted();
  return { sabr, poToken: proof.poToken, tokenExpiresAt: proof.expiresAt };
}
