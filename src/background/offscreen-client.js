const OFFSCREEN_URL = 'src/offscreen/host.html';
let creating;
export async function ensureOffscreen() {
  if (creating) return creating;
  creating = (async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], incognito: chrome.extension.inIncognitoContext, documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)] });
    if (!contexts.length) await chrome.offscreen.createDocument({ url: OFFSCREEN_URL, reasons: ['BLOBS', 'WORKERS'], justification: 'Process requested media in cancellable workers and retain output until Chrome saves it.' });
  })();
  try { await creating; } finally { creating = undefined; }
}
export async function runOffscreen(plan) { await ensureOffscreen(); const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'run', plan }); if (!result?.ok) throw new Error(result?.error?.message || 'Media worker unavailable.'); return result.data; }
export async function offscreenCommand(type, fields = {}) { try { const result = await chrome.runtime.sendMessage({ target: 'offscreen', type, ...fields }); return result?.data; } catch { return null; } }
export function releaseOffscreen(leaseId) { return offscreenCommand('release', { leaseId }); }
