import { isUrlAllowed } from '../media/fetch.js';
import { BILIBILI_HEADER_PERMISSION, isBilibiliMediaUrl, needsBilibiliHeaders } from '../shared/bilibili.js';

const FIRST_ID = 730000;
const LAST_ID = 730199;
const owners = new Map();
let cleanupNeeded = false;
let pending = Promise.resolve();
const serialize = task => { const next = pending.then(task); pending = next.catch(() => {}); return next; };
const ownRule = rule => rule.id >= FIRST_ID && rule.id <= LAST_ID;

export function bilibiliHeaderRule(url, id, extensionId) {
  if (!isBilibiliMediaUrl(url)) throw new Error('Bilibili media is outside the supported CDN scope.');
  const normalized = new URL(url).href;
  const regexFilter = `^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  if (regexFilter.length > 2000) throw new Error('Bilibili media URL is too long for a scoped header rule.');
  return {
    id, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://www.bilibili.com/' }] },
    condition: { regexFilter, isUrlFilterCaseSensitive: true, initiatorDomains: [extensionId], requestMethods: ['get'], resourceTypes: ['xmlhttprequest'] }
  };
}

export function acquireBilibiliHeaders(jobId, urls, grantedOrigins) {
  return serialize(async () => {
    if (!await chrome.permissions.contains({ permissions: [BILIBILI_HEADER_PERMISSION] })) throw new Error('Allow Bilibili download headers from the Download button first.');
    const selected = [...new Set(urls.filter(Boolean))];
    if (!selected.length || selected.length > 2 || selected.some(url => !isBilibiliMediaUrl(url) || !isUrlAllowed(url, grantedOrigins))) throw new Error('Bilibili media is outside the allowed network scope.');
    const previous = owners.get(jobId);
    owners.set(jobId, selected);
    try { await synchronize(); } catch (error) { if (previous) owners.set(jobId, previous); else owners.delete(jobId); throw error; }
  });
}

export function releaseMediaHeaders(jobId) {
  return serialize(async () => {
    if (!owners.delete(jobId) && !cleanupNeeded) return;
    // Keep the desired ownership removed even if Chrome temporarily rejects cleanup.
    // A repeated release or maintenance pass must retry the outstanding removal.
    cleanupNeeded = true;
    await synchronize();
  });
}

// Rebuild from persisted active jobs on service-worker wake and maintenance. Session rules
// survive a worker restart but never a browser restart; stale rules cannot outlive their job.
export function recoverMediaHeaders(readJobs) {
  return serialize(async () => {
    owners.clear();
    const grants = await chrome.permissions.getAll();
    if (await chrome.permissions.contains({ permissions: [BILIBILI_HEADER_PERMISSION] })) {
      // Read inside the serialized operation so an earlier completion cannot be resurrected.
      for (const job of await readJobs()) {
        if (!['preparing', 'downloading'].includes(job.phase) || job.outputLeaseId || !needsBilibiliHeaders(job.candidate)) continue;
        const urls = [job.candidate.url, job.candidate.audioUrl].filter(Boolean);
        if (urls.every(url => isBilibiliMediaUrl(url) && isUrlAllowed(url, grants.origins || []))) owners.set(job.id, urls);
      }
    }
    await synchronize();
  });
}

async function synchronize() {
  const api = chrome.declarativeNetRequest;
  if (!api) { if (owners.size) throw new Error('Scoped download headers are unavailable.'); return; }
  const existing = (await api.getSessionRules()).filter(ownRule);
  const urls = [...new Set([...owners.values()].flat())].sort();
  if (urls.length > LAST_ID - FIRST_ID + 1) throw new Error('Too many active Bilibili downloads.');
  const rules = urls.map((url, index) => bilibiliHeaderRule(url, FIRST_ID + index, chrome.runtime.id));
  for (const rule of rules) {
    const result = await api.isRegexSupported({ regex: rule.condition.regexFilter, isCaseSensitive: true });
    if (!result.isSupported) throw new Error('Chrome cannot safely match this Bilibili media URL.');
  }
  if (JSON.stringify(existing) !== JSON.stringify(rules)) await api.updateSessionRules({ removeRuleIds: existing.map(rule => rule.id), addRules: rules });
  cleanupNeeded = false;
}
