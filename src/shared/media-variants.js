const containers = new Set(['mp4', 'webm', 'mkv', 'ts', 'm4a', 'mp3', 'ogg', 'aac', 'wav']);

export function normalizeVariants(items, base = {}) {
  if (!Array.isArray(items)) return [];
  const ids = new Set();
  return items.slice(0, 200).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const url = httpUrl(item.url || base.url);
    if (!url) return [];
    const id = String(item.id ?? item.itag ?? index).slice(0, 100);
    if (ids.has(id)) return [];
    ids.add(id);
    const mimeType = String(item.mimeType || base.mimeType || '').slice(0, 120);
    const container = containers.has(item.container) ? item.container : /webm/i.test(mimeType) ? 'webm' : 'mp4';
    return [{
      id, url, kind: ['direct', 'hls', 'dash', 'sabr'].includes(item.kind) ? item.kind : base.kind || 'direct',
      audioUrl: httpUrl(item.audioUrl), mimeType, container,
      audioMimeType: String(item.audioMimeType || '').slice(0, 120),
      width: positive(item.width), height: positive(item.height), bitrate: positive(item.bitrate),
      fps: positive(item.fps), codecs: String(item.codecs || '').slice(0, 160),
      duration: positive(item.duration ?? item.durationSeconds),
      contentLength: positive(item.contentLength), audioContentLength: positive(item.audioContentLength),
      expiresAt: positive(item.expiresAt), audioLanguage: String(item.audioLanguage || '').slice(0, 40),
      representationId: stringValue(item.representationId), audioRepresentationId: stringValue(item.audioRepresentationId),
      videoItag: positive(item.videoItag), audioItag: positive(item.audioItag),
      hasAudio: item.hasAudio !== false, hasVideo: item.hasVideo !== false
    }];
  });
}

export function selectVariant(candidate, variantId, settings = {}) {
  const variants = candidate.variants || [];
  if (!variants.length) {
    if (variantId && variantId !== candidate.variantId) throw new Error('This format is no longer available. Scan again.');
    return candidate;
  }
  const id = variantId || candidate.selectedVariantId;
  const selected = id ? variants.find(item => item.id === id) : preferredVariant(variants, settings);
  if (!selected) throw new Error('This format is no longer available. Scan again.');
  return { ...candidate, ...selected, id: candidate.id, variantId: selected.id, selectedVariantId: selected.id };
}

export function preferredVariant(variants, settings = {}) {
  const height = settings.preferredHeight || 1080;
  // Quality is the short side, so a 1080x1920 portrait video counts as 1080p (as the panel names it).
  const quality = item => item.width > 0 && item.height > 0 ? Math.min(item.width, item.height) : item.height;
  const videoRank = item => item.hasVideo === false ? 2 : quality(item) > 0 || /avc|hev|hvc|vp0?[89]|av01|theora/i.test(item.codecs || '') ? 0 : 1;
  return variants.slice().sort((a, b) => {
    const video = videoRank(a) - videoRank(b);
    if (video) return video;
    const aq = quality(a) || 0;
    const bq = quality(b) || 0;
    const ao = aq > height ? 1 : 0;
    const bo = bq > height ? 1 : 0;
    const distance = Math.abs((aq || height) - height) - Math.abs((bq || height) - height);
    const format = Number(b.container === settings.preferredContainer) - Number(a.container === settings.preferredContainer);
    return ao - bo || distance || format || (b.bitrate || 0) - (a.bitrate || 0);
  })[0];
}

// Converted streams take the Format setting; native HLS saves keep their source format.
// MPEG-TS cannot carry VP9, AV1 or Opus, so those conversions use MKV.
export function stitchedContainer(preferred, codecs = '') {
  const container = ['mp4', 'mkv', 'ts'].includes(preferred) ? preferred : 'mp4';
  return container === 'ts' && /vp0?9|av01|opus|vorbis/i.test(codecs) ? 'mkv' : container;
}

export function httpUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 16000) return undefined;
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function stringValue(value) {
  return value === undefined || value === null ? undefined : String(value).slice(0, 160);
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= Number.MAX_SAFE_INTEGER ? number : undefined;
}
