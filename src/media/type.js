const MIME_BY_EXTENSION = new Map([
  ['mp4', { mimeType: 'video/mp4', extension: 'mp4' }],
  ['m4v', { mimeType: 'video/mp4', extension: 'mp4' }],
  ['m4a', { mimeType: 'audio/mp4', extension: 'm4a' }],
  ['webm', { mimeType: 'video/webm', extension: 'webm' }],
  ['mp3', { mimeType: 'audio/mpeg', extension: 'mp3' }],
  ['aac', { mimeType: 'audio/aac', extension: 'aac' }],
  ['ogg', { mimeType: 'audio/ogg', extension: 'ogg' }],
  ['ogv', { mimeType: 'video/ogg', extension: 'ogv' }],
  ['opus', { mimeType: 'audio/ogg', extension: 'ogg' }],
  ['wav', { mimeType: 'audio/wav', extension: 'wav' }],
  ['ts', { mimeType: 'video/mp2t', extension: 'ts' }]
]);

const MIME_BY_TYPE = new Map([
  ['video/mp4', { mimeType: 'video/mp4', extension: 'mp4' }],
  ['audio/mp4', { mimeType: 'audio/mp4', extension: 'm4a' }],
  ['audio/x-m4a', { mimeType: 'audio/mp4', extension: 'm4a' }],
  ['video/webm', { mimeType: 'video/webm', extension: 'webm' }],
  ['audio/webm', { mimeType: 'audio/webm', extension: 'webm' }],
  ['audio/mpeg', { mimeType: 'audio/mpeg', extension: 'mp3' }],
  ['audio/mp3', { mimeType: 'audio/mpeg', extension: 'mp3' }],
  ['audio/aac', { mimeType: 'audio/aac', extension: 'aac' }],
  ['audio/ogg', { mimeType: 'audio/ogg', extension: 'ogg' }],
  ['video/ogg', { mimeType: 'video/ogg', extension: 'ogv' }],
  ['audio/wav', { mimeType: 'audio/wav', extension: 'wav' }],
  ['audio/x-wav', { mimeType: 'audio/wav', extension: 'wav' }],
  ['video/mp2t', { mimeType: 'video/mp2t', extension: 'ts' }]
]);

const TEXT_TYPES = /^(?:text\/|application\/(?:json|xml|xhtml\+xml)|image\/svg\+xml)/i;

export function classifyMedia({ contentType = '', url = '', sample } = {}) {
  const signature = classifySignature(sample);
  if (signature) return signature;
  const mime = cleanMime(contentType);
  const fromHeader = MIME_BY_TYPE.get(mime);
  if (fromHeader) return fromHeader;
  if (TEXT_TYPES.test(mime)) throw mediaTypeError('The response is text, not downloadable media.');
  const extension = extensionFromUrl(url);
  const fromExtension = MIME_BY_EXTENSION.get(extension);
  if (fromExtension) return fromExtension;
  throw mediaTypeError('The response is not a supported media file.');
}

export function mediaInfoForMime(contentType) {
  return MIME_BY_TYPE.get(cleanMime(contentType)) || null;
}

export function mediaInfoForExtension(extension) {
  return MIME_BY_EXTENSION.get(String(extension || '').replace(/^\./, '').toLowerCase()) || null;
}

export function mediaTypeError(message) {
  const error = new Error(message);
  error.code = 'media-type';
  return error;
}

function cleanMime(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function extensionFromUrl(value) {
  try {
    const pathname = new URL(value).pathname;
    return (pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
  } catch {
    return '';
  }
}

function classifySignature(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (brand === 'm4a ' || brand === 'm4b ' || brand === 'm4p ') return { mimeType: 'audio/mp4', extension: 'm4a' };
    return { mimeType: 'video/mp4', extension: 'mp4' };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { mimeType: 'video/webm', extension: 'webm' };
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return { mimeType: 'audio/mpeg', extension: 'mp3' };
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return (bytes[1] & 0x06) === 0 ? { mimeType: 'audio/aac', extension: 'aac' } : { mimeType: 'audio/mpeg', extension: 'mp3' };
  }
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'OggS') return { mimeType: 'audio/ogg', extension: 'ogg' };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE') return { mimeType: 'audio/wav', extension: 'wav' };
  if (bytes.length >= 377 && bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) return { mimeType: 'video/mp2t', extension: 'ts' };
  if (looksLikeText(bytes)) throw mediaTypeError('The response is text, not downloadable media.');
  return null;
}

function looksLikeText(bytes) {
  const text = ascii(bytes, 0, Math.min(bytes.length, 512)).trimStart().toLowerCase();
  return text.startsWith('<!doctype') || text.startsWith('<html') || text.startsWith('{') || text.startsWith('[');
}

function ascii(bytes, start, end) {
  let value = '';
  for (let index = start; index < end && index < bytes.length; index += 1) value += String.fromCharCode(bytes[index]);
  return value;
}
