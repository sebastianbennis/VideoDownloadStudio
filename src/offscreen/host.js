import { releaseSpool, spoolName, sweepSpools } from '../media/spool.js';
import { runYouTubeTransform } from './youtube-runtime.js';
const initialized = sweepSpools();
const running = new Map();
const leases = new Map();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'offscreen') return false;
  if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('src/background/service.js')) { respond({ ok: false, error: { code: 'permission', message: 'Only the extension service controls media workers.' } }); return false; }
  if (message.type === 'youtube.transform') {
    runYouTubeTransform(message.payload).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: { code: error.code || 'youtube-transform', message: error.message || String(error) } }));
    return true;
  }
  try { respond({ ok: true, data: command(message) }); } catch (error) { respond({ ok: false, error: { code: 'media', message: error.message } }); }
  return false;
});
function command(message) {
  if (message.type === 'inventory') return { jobs: [...running.keys()], leases: [...leases.values()] };
  if (message.type === 'run') {
    const plan = message.plan;
    if (running.has(plan.jobId)) return { accepted: true };
    const worker = new Worker(chrome.runtime.getURL('src/media/worker.js'), { type: 'module' });
    running.set(plan.jobId, worker);
    worker.onmessage = ({ data }) => {
      if (data.jobId !== plan.jobId) return;
      const event = data.event;
      if (event.type === 'sabr-reload' || event.type === 'sabr-token-refresh' || event.type === 'hls-renew') {
        if (running.get(plan.jobId) !== worker || !Number.isSafeInteger(event.requestId) || event.requestId < 1 || (event.type !== 'hls-renew' && event.requestId > 4)) return;
        chrome.runtime.sendMessage({ target: 'service', type: 'media.event', jobId: plan.jobId, event }).then(
          response => {
            if (running.get(plan.jobId) === worker) worker.postMessage({ type: `${event.type}-result`, jobId: plan.jobId, requestId: event.requestId, ...response });
          },
          () => {
            if (running.get(plan.jobId) === worker) worker.postMessage({ type: `${event.type}-result`, jobId: plan.jobId, requestId: event.requestId, ok: false, error: { code: event.type === 'hls-renew' ? 'twitch-renew' : 'sabr-reload', message: 'Playback refresh was interrupted.' } });
          }
        );
        return;
      }
      if (event.type === 'complete') {
        const output = event.output;
        const { data: bytes, ...meta } = output;
        const type = meta.mimeType || 'application/octet-stream';
        const blob = bytes instanceof Blob && bytes.type === type ? bytes : new Blob([bytes], { type });
        const lease = { ...meta, blobUrl: URL.createObjectURL(blob) };
        leases.set(lease.id, lease);
        if (plan.action === 'preview') setTimeout(() => command({type:'release',leaseId:lease.id}), 60*60*1000);
        event.output = lease;
        worker.terminate(); running.delete(plan.jobId);
      } else if (event.type === 'error') { worker.terminate(); running.delete(plan.jobId); }
      emit(plan.jobId, event);
    };
    worker.onerror = (error) => { worker.terminate(); running.delete(plan.jobId); void releaseSpool(spoolName(plan.jobId)); emit(plan.jobId, { type: 'error', error: { code: 'worker', message: error.message || 'Media worker failed.' } }); };
    initialized.then(() => { if (running.has(plan.jobId)) worker.postMessage({ type: 'run', plan }); });
    return { accepted: true };
  }
  if (message.type === 'cancel') { running.get(message.jobId)?.terminate(); running.delete(message.jobId); void releaseSpool(spoolName(message.jobId)); return true; }
  if (message.type === 'stop') { running.get(message.jobId)?.postMessage({ type: 'stop', jobId: message.jobId }); return true; }
  if (message.type === 'release') { const lease = leases.get(message.leaseId); if (lease) { URL.revokeObjectURL(lease.blobUrl); if (lease.spoolName) void releaseSpool(lease.spoolName); } leases.delete(message.leaseId); return true; }
  throw new Error('Unknown offscreen command.');
}
function emit(jobId, event) { chrome.runtime.sendMessage({ target: 'service', type: 'media.event', jobId, event }).catch(() => {}); }
