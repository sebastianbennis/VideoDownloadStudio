let corePromise;
let counter = 0;
const SUPPORTED_COPY_CONTAINERS = new Set(['mp4', 'webm', 'mkv', 'ts']);
const MAX_ERROR_TEXT = 800;
const MEDIA_ENGINE_PROVENANCE_URLS = [
  new URL('../../vendor/media/GPL-2.0-or-later.txt', import.meta.url).href,
  new URL('../../vendor/media/ffmpeg-core-PROVENANCE.txt', import.meta.url).href
];


export async function processMedia({ inputs, action, container, signal, onProgress = () => {} }) {
  if (!Array.isArray(inputs) || !inputs.length) throw userError('codec', 'Media engine received no inputs.');
  const core = await getCore();
  const runId = `${Date.now()}-${counter++}`;
  const files = [];
  const inputNames = inputs.map((input, index) => {
    const name = `in-${runId}-${index}${extensionForInput(input)}`;
    core.FS.writeFile(name, input.data);
    files.push(name);
    return name;
  });
  const outputContainer = outputContainerFor(action, container);
  const outputName = `out-${runId}.${outputContainer}`;
  files.push(outputName);
  try {
    if (signal?.aborted) throw userError('cancelled', 'Media processing cancelled.');
    core.setProgress(({ progress, time }) => {
      onProgress({ percent: Math.max(0, Math.min(100, Math.round((progress || 0) * 100))), mediaSeconds: time ? time / 1000000 : undefined });
    });
    const errors = [];
    const args = commandFor(action, inputNames, outputName, outputContainer);
    core.reset();
    core.setLogger(({ type, message }) => {
      if (type === 'fferr' && message) errors.push(String(message));
    });
    const code = core.exec(...args);
    if (code !== 0) throw userError('codec', `FFmpeg exited with code ${code}${formatLastError(errors)}.`);
    return core.FS.readFile(outputName);
  } finally {
    for (const file of files) {
      try {
        core.FS.unlink(file);
      } catch {}
    }
    core.setProgress(() => {});
    core.setLogger(() => {});
  }
}

async function getCore() {
  if (!corePromise) {
    corePromise = (async () => {
      const coreUrl = new URL('../../vendor/media/ffmpeg-core.js', import.meta.url).href;
      const wasmUrl = new URL('../../vendor/media/ffmpeg-core.wasm', import.meta.url).href;
      const module = await import(coreUrl);
      const core = await module.default({
        mainScriptUrlOrBlob: `${coreUrl}#${btoa(JSON.stringify({ wasmURL: wasmUrl }))}`
      });
      await core.ready;
      core.setLogger(() => {});
      return core;
    })();
  }
  return corePromise;
}

function commandFor(action, inputNames, outputName, outputContainer) {
  if (action === 'audio') {
    const audioInput = inputNames.length > 1 ? inputNames[1] : inputNames[0];
    return ['-i', audioInput, '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', outputName];
  }
  if (action === 'preview') {
    if (inputNames.length > 1) {
      return ['-t', '5', '-i', inputNames[0], '-t', '5', '-i', inputNames[1], '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', ...fastStartArgs(outputContainer), outputName];
    }
    return ['-t', '5', '-i', inputNames[0], '-c', 'copy', ...fastStartArgs(outputContainer), outputName];
  }
  if (inputNames.length > 1) {
    return ['-i', inputNames[0], '-i', inputNames[1], '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', ...fastStartArgs(outputContainer), outputName];
  }
  return ['-i', inputNames[0], '-c', 'copy', ...fastStartArgs(outputContainer), outputName];
}

function extensionForInput(input) {
  const name = String(input.name || '').toLowerCase();
  const match = name.match(/\.([a-z0-9]{2,8})$/);
  if (match) return `.${match[1]}`;
  if (input.mimeType === 'video/mp2t') return '.ts';
  if (input.mimeType === 'audio/mpeg') return '.mp3';
  if (/webm/i.test(input.mimeType || '')) return '.webm';
  if (/mp4|m4a/i.test(input.mimeType || '')) return input.mimeType.startsWith('audio/') ? '.m4a' : '.mp4';
  return looksLikeMp4(input.data) ? '.mp4' : '.bin';
}

function outputContainerFor(action, container) {
  if (action === 'audio') return 'mp3';
  const value = normalizeContainer(container);
  if (SUPPORTED_COPY_CONTAINERS.has(value) || value === 'webm') return value;
  throw userError('unsupported-container', `Unsupported output container: ${value}.`);
}

function normalizeContainer(container) {
  const value = String(container || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return value || 'mp4';
}

function fastStartArgs(container) {
  return container === 'mp4' ? ['-movflags', 'faststart'] : [];
}

function formatLastError(errors) {
  const text = errors.slice(-8).join(' ').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? `: ${text.slice(0, MAX_ERROR_TEXT)}` : '';
}

function looksLikeMp4(bytes) {
  return bytes?.[4] === 0x66 && bytes?.[5] === 0x74 && bytes?.[6] === 0x79 && bytes?.[7] === 0x70;
}

function userError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

