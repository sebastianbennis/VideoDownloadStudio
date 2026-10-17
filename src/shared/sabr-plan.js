// SABR metadata is data-only. Playback tokens are supplied separately at dispatch.
export function normalizeSabrMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (JSON.stringify(value).length > 256 * 1024) return undefined;
  let url;
  try { url = new URL(value.serverAbrStreamingUrl); } catch { return undefined; }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com') || url.port || url.username || url.password || url.pathname !== '/videoplayback') return undefined;
  if (url.searchParams.has('pot') || url.href.length > 16000) return undefined;
  const config = value.videoPlaybackUstreamerConfig;
  if (typeof config !== 'string' || !config || config.length > 64 * 1024 || !/^[A-Za-z0-9_+/=-]+$/.test(config)) return undefined;
  const durationMs = positive(value.durationMs);
  const client = value.clientInfo;
  if (!durationMs || !client || !Number.isInteger(client.clientName) || typeof client.clientVersion !== 'string' || !client.clientVersion || client.clientVersion.length > 100) return undefined;
  const clientInfo = { clientName: client.clientName, clientVersion: client.clientVersion };
  for (const key of ['osName', 'osVersion', 'deviceMake', 'deviceModel']) {
    if (typeof client[key] === 'string' && client[key].length <= 100) clientInfo[key] = client[key];
  }
  if (!Array.isArray(value.formats) || value.formats.length > 200) return undefined;
  const formats = value.formats.map(normalizeSabrFormat).filter(Boolean);
  if (!formats.some(x => x.mimeType.startsWith('audio/')) || !formats.some(x => x.mimeType.startsWith('video/'))) return undefined;
  return { serverAbrStreamingUrl: url.href, videoPlaybackUstreamerConfig: config, durationMs, clientInfo, formats };
}

export function sameSabrFormatIdentity(previous, next) {
  if (!previous || !next || previous.itag !== next.itag || previous.mimeType !== next.mimeType) return false;
  for (const key of ['lastModified', 'xtags', 'audioTrackId', 'language']) {
    if ((previous[key] ?? '') !== (next[key] ?? '')) return false;
  }
  for (const key of ['isDrc', 'isDubbed', 'isAutoDubbed', 'isDescriptive', 'isSecondary', 'isOriginal']) {
    if (Boolean(previous[key]) !== Boolean(next[key])) return false;
  }
  return true;
}

function normalizeSabrFormat(value) {
  if (!value || !Number.isInteger(value.itag) || value.itag <= 0 || value.itag > 100000) return undefined;
  if (typeof value.mimeType !== 'string' || !/^(audio|video)\/(mp4|webm)(?:;|$)/.test(value.mimeType) || value.mimeType.length > 160) return undefined;
  if (typeof value.lastModified !== 'string' || !/^\d{1,30}$/.test(value.lastModified)) return undefined;
  const format = { itag: value.itag, mimeType: value.mimeType, lastModified: value.lastModified, bitrate: positive(value.bitrate) || 0, approxDurationMs: positive(value.approxDurationMs) || 0 };
  for (const key of ['width', 'height', 'fps', 'contentLength', 'averageBitrate']) if (positive(value[key])) format[key] = Number(value[key]);
  for (const key of ['xtags', 'audioTrackId', 'quality', 'qualityLabel', 'audioQuality', 'language']) {
    if (typeof value[key] === 'string' && value[key].length <= 256) format[key] = value[key];
  }
  for (const key of ['isDrc', 'isDubbed', 'isAutoDubbed', 'isDescriptive', 'isSecondary', 'isOriginal']) if (typeof value[key] === 'boolean') format[key] = value[key];
  return format;
}

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
}
