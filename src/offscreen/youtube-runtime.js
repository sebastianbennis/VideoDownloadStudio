const WORKER_URL = 'vendor/youtube/youtube-transform-worker.js';
let nextId = 1;

export function runYouTubeTransform(payload, timeoutMs = 5500) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const worker = new Worker(chrome.runtime.getURL(WORKER_URL), { type: 'module' });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(userError('youtube-transform-timeout', 'Player transform timed out.'));
    }, timeoutMs);
    worker.onmessage = ({ data }) => {
      if (data?.id !== id) return;
      clearTimeout(timeout);
      worker.terminate();
      if (data.ok) resolve(data.data || {});
      else reject(userError(data.error?.code || 'youtube-transform', data.error?.message || 'Player transform failed.'));
    };
    worker.onerror = (error) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(userError('youtube-transform', error.message || 'Player transform worker failed.'));
    };
    worker.postMessage({ id, type: 'transform', payload });
  });
}

function userError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
