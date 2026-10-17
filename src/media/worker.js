import { runDownload } from './pipeline.js';

const controllers = new Map();
const stopped = new Set();
const reloads = new Map();
let reloadSequence = 0;

self.onmessage = async (message) => {
  const data = message.data || {};
  if (data.type === 'run') run(data.plan);
  if (data.type === 'cancel') controllers.get(data.jobId)?.abort();
  if (data.type === 'stop') {
    stopped.add(data.jobId);
    for (const pending of reloads.values()) if (pending.jobId === data.jobId && pending.type === 'hls-renew') pending.reject(Object.assign(new Error('Recording stopped.'), { code: 'stopped' }));
  }
  if (data.type === 'sabr-reload-result' || data.type === 'sabr-token-refresh-result' || data.type === 'hls-renew-result') {
    const pending = reloads.get(data.requestId);
    if (pending?.jobId !== data.jobId || `${pending.type}-result` !== data.type) return;
    if (data.ok) pending.resolve(data.data);
    else pending.reject(Object.assign(new Error(data.error?.message || 'Playback refresh failed.'), { code: data.error?.code || pending.type }));
  }
};

async function run(plan) {
  const controller = new AbortController();
  controllers.set(plan.jobId, controller);
  try {
    const output = await runDownload(
      plan,
      controller.signal,
      (progress) => postMessage({ jobId: plan.jobId, event: { type: 'progress', ...progress } }),
      {
        stopRequested: () => stopped.has(plan.jobId),
        onReloadPlayerResponse: context => requestReload(plan.jobId, context, controller.signal),
        onRenewPlaylist: plan.liveIdentity ? () => requestReload(plan.jobId, {}, controller.signal, 'hls-renew') : undefined,
        onRefreshPoToken: context => requestReload(plan.jobId, context, controller.signal, 'sabr-token-refresh')
      }
    );
    postMessage(
      { jobId: plan.jobId, event: { type: 'complete', output } },
      output.data?.buffer ? [output.data.buffer] : []
    );
  } catch (error) {
    postMessage({ jobId: plan.jobId, event: { type: 'error', error: { code: error.code || 'network', message: error.message || 'Download failed' } } });
  } finally {
    controllers.delete(plan.jobId);
    stopped.delete(plan.jobId);
  }
}

function requestReload(jobId, context, signal, type = 'sabr-reload') {
  signal.throwIfAborted();
  const requestId = ++reloadSequence;
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reloads.delete(requestId);
      callback(value);
    };
    const abort = () => finish(reject, signal.reason);
    const timer = setTimeout(() => finish(reject, Object.assign(new Error('Playback refresh timed out. Scan the video again.'), { code: type === 'hls-renew' ? 'twitch-renew' : type })), 60000);
    reloads.set(requestId, { jobId, type, resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
    signal.addEventListener('abort', abort, { once: true });
    postMessage({ jobId, event: { type, requestId, context } });
  });
}
