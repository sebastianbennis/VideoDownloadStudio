import { makeId } from '../shared/id.js';
import { loadState, mutateState } from './store.js';
import { preferredVariant } from '../shared/media-variants.js';
export async function ingestCandidates(items) {
  const added = [];
  await mutateState(state => {
    state.candidates = state.candidates.filter(x => Date.now() - x.discoveredAt < 7200000);
    for (const item of items) {
      // Policy validates this identity against the sending Twitch channel. Playlist URLs
      // rotate between scans, while a broadcast keeps its channel and stream id.
      const twitchLive = item.live === true && item.source === 'adapter' && item.adapterId === 'twitch' && item.liveIdentity?.site === 'twitch' ? item.liveIdentity : null;
      const identity = twitchLive ? `twitch-live:${twitchLive.channel}:${twitchLive.streamId}`
        : item.videoId ? `${item.videoId}:${item.route || item.kind}` : `${item.url}:${item.audioUrl || ''}`;
      const key = `${item.tabId}:${item.frameId}:${item.documentId}:${identity}`;
      const existing = state.candidates.find(x => x.key === key);
      // A site adapter's card (title, poster, formats) outranks a generic sighting of the same URL,
      // and missing fields never erase known ones.
      const update = existing?.source === 'adapter' && item.source !== 'adapter' ? {} : Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
      const candidate = { ...existing, ...update, key, id: existing?.id || makeId('candidate'), discoveredAt: Date.now() };
      if (!item.variants?.length && existing?.variants?.length) candidate.variants = existing.variants;
      if (candidate.variants?.length) candidate.selectedVariantId = candidate.variants.some(x => x.id === existing?.selectedVariantId)
        ? existing.selectedVariantId : preferredVariant(candidate.variants, state.settings)?.id;
      state.candidates = state.candidates.filter(x => x.id !== candidate.id);
      state.candidates.push(candidate);
      added.push(candidate);
    }
    const counts = new Map();
    state.candidates = state.candidates.reverse().filter(x => { const n = (counts.get(x.tabId) || 0) + 1; counts.set(x.tabId, n); return n <= 100; }).reverse();
    return state;
  });
  return added;
}
export async function getCandidates(tabId) { return (await loadState()).candidates.filter(x => tabId === undefined || x.tabId === tabId); }
export async function getCandidate(id) { return (await loadState()).candidates.find(x => x.id === id); }
export async function selectCandidateVariant(candidateId, variantId) {
  let selected;
  await mutateState(state => {
    const candidate = state.candidates.find(item => item.id === candidateId);
    if (!candidate?.variants?.some(item => item.id === variantId)) throw new Error('This format is no longer available. Scan again.');
    candidate.selectedVariantId = variantId;
    // A quality the user picked stays when the preferred quality or format changes.
    candidate.variantPicked = true;
    selected = candidate;
    return state;
  });
  return selected;
}
// Preferred quality and format apply to cards already listed, except where the user chose.
export async function reapplyPreferredVariants() {
  await mutateState(state => {
    for (const candidate of state.candidates) {
      if (candidate.variantPicked || !candidate.variants?.length) continue;
      candidate.selectedVariantId = preferredVariant(candidate.variants, state.settings)?.id || candidate.selectedVariantId;
    }
    return state;
  });
}

export async function clearTab(tabId) { await mutateState(state => ({ ...state, candidates: state.candidates.filter(x => x.tabId !== tabId) })); }

export async function clearFrame(tabId, frameId) { await mutateState(state => ({ ...state, candidates: state.candidates.filter(x => x.tabId !== tabId || x.frameId !== frameId) })); }
