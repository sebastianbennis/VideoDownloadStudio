export const PAGE_TOKEN_PROTOCOL_VERSION = 1;
export const PAGE_TOKEN_CHANNEL = 'vds.youtube.page-token.v1';
export const PAGE_TOKEN_REQUEST_DIRECTION = 'request';
export const PAGE_TOKEN_REPLY_DIRECTION = 'reply';

export const PAGE_TOKEN_LIMITS = Object.freeze({
  envelopeBytes: 256 * 1024,
  messageIdBytes: 128,
  nonceBytes: 128,
  videoIdBytes: 128,
  integrityBytes: 64 * 1024,
  botguardResponseBytes: 128 * 1024,
  poTokenChars: 512,
  statusMessageChars: 512,
  inlineScanBytes: 4 * 1024 * 1024,
  programBytes: 1024 * 1024,
  globalNameBytes: 128,
  initTimeoutMs: 15000,
  mintTimeoutMs: 5000,
  maxLifetimeMs: 10 * 60 * 1000,
  maxPendingMessages: 4,
  snapshotRateWindowMs: 60 * 1000,
  maxSnapshotsPerWindow: 2
});

const encoder = new TextEncoder();
const OPERATIONS = new Set(['snapshot', 'mint', 'dispose']);

export function validatePageTokenRequest(value) {
  assertEnvelopeLimit(value);
  assertAllowedKeys(value, 'page token request', ['version', 'requestId', 'nonce', 'videoId', 'operation', 'integrity']);
  assertEnvelope(value, 'request');
  if (!OPERATIONS.has(value.operation)) throw pageTokenError('schema', 'Unsupported page token operation.');
  if (value.operation === 'snapshot') {
    rejectUnexpected(value.integrity, 'snapshot integrity');
  } else if (value.operation === 'mint') {
    validateIntegrityData(value.integrity);
  } else if (value.operation === 'dispose') {
    rejectUnexpected(value.integrity, 'dispose integrity');
  }
  return value;
}

export function validatePageTokenReply(value) {
  assertEnvelopeLimit(value);
  assertAllowedKeys(value, 'page token reply', ['version', 'requestId', 'nonce', 'videoId', 'operation', 'botguardResponse', 'poToken', 'disposed', 'code']);
  assertEnvelope(value, 'reply');
  if (!['snapshot', 'mint', 'dispose', 'error'].includes(value.operation)) throw pageTokenError('schema', 'Unsupported page token reply operation.');
  if (value.operation === 'snapshot') {
    assertStringLimit(value.botguardResponse, 'botguardResponse', PAGE_TOKEN_LIMITS.botguardResponseBytes, { nonEmpty: true });
    rejectUnexpected(value.poToken, 'snapshot poToken');
    rejectUnexpected(value.disposed, 'snapshot disposed');
    rejectUnexpected(value.code, 'snapshot code');
  } else if (value.operation === 'mint') {
    assertStringLimit(value.poToken, 'poToken', PAGE_TOKEN_LIMITS.poTokenChars, { nonEmpty: true, chars: true });
    rejectUnexpected(value.botguardResponse, 'mint botguardResponse');
    rejectUnexpected(value.disposed, 'mint disposed');
    rejectUnexpected(value.code, 'mint code');
  } else if (value.operation === 'dispose') {
    if (value.disposed !== true) throw pageTokenError('schema', 'Dispose reply must confirm disposal.');
    rejectUnexpected(value.botguardResponse, 'dispose botguardResponse');
    rejectUnexpected(value.poToken, 'dispose poToken');
    rejectUnexpected(value.code, 'dispose code');
  } else {
    assertStringLimit(value.code, 'error code', PAGE_TOKEN_LIMITS.statusMessageChars, { nonEmpty: true });
    if (!/^[a-z0-9-]{1,64}$/.test(value.code)) throw pageTokenError('schema', 'error code must be a bounded protocol code.');
    rejectUnexpected(value.botguardResponse, 'error botguardResponse');
    rejectUnexpected(value.poToken, 'error poToken');
    rejectUnexpected(value.disposed, 'error disposed');
  }
  return value;
}

export function validatePageTokenMessage(value, expectedDirection) {
  assertEnvelopeLimit(value);
  assertAllowedKeys(value, 'page token message', ['version', 'channel', 'direction', 'payload']);
  if (value.version !== PAGE_TOKEN_PROTOCOL_VERSION) throw pageTokenError('schema', 'Unsupported page token message version.');
  if (value.channel !== PAGE_TOKEN_CHANNEL) throw pageTokenError('source', 'Unexpected page token channel.');
  if (!['request', 'reply'].includes(value.direction)) throw pageTokenError('schema', 'Unsupported page token message direction.');
  if (expectedDirection && value.direction !== expectedDirection) throw pageTokenError('source', 'Unexpected page token message direction.');
  const payload = value.direction === PAGE_TOKEN_REQUEST_DIRECTION
    ? validatePageTokenRequest(value.payload)
    : validatePageTokenReply(value.payload);
  return { ...value, payload };
}

export function createPageTokenMessage(direction, payload) {
  if (direction !== PAGE_TOKEN_REQUEST_DIRECTION && direction !== PAGE_TOKEN_REPLY_DIRECTION) {
    throw pageTokenError('schema', 'Unsupported page token message direction.');
  }
  const checkedPayload = direction === PAGE_TOKEN_REQUEST_DIRECTION
    ? validatePageTokenRequest({ ...payload })
    : validatePageTokenReply({ ...payload });
  const message = {
    version: PAGE_TOKEN_PROTOCOL_VERSION,
    channel: PAGE_TOKEN_CHANNEL,
    direction,
    payload: checkedPayload
  };
  assertEnvelopeLimit(message);
  return message;
}

export function validateIntegrityData(value) {
  assertAllowedKeys(value, 'integrity', ['integrityToken', 'estimatedTtlSecs', 'mintRefreshThreshold']);
  assertJsonLimit(value, 'integrity', PAGE_TOKEN_LIMITS.integrityBytes);
  assertStringLimit(value.integrityToken, 'integrity.integrityToken', PAGE_TOKEN_LIMITS.integrityBytes, { nonEmpty: true });
  assertFinitePositive(value.estimatedTtlSecs, 'integrity.estimatedTtlSecs');
  if (value.mintRefreshThreshold !== undefined) assertFinitePositive(value.mintRefreshThreshold, 'integrity.mintRefreshThreshold');
  return value;
}

export function validateVideoId(videoId) {
  assertStringLimit(videoId, 'videoId', PAGE_TOKEN_LIMITS.videoIdBytes, { nonEmpty: true });
  if (!/^[0-9A-Za-z_-]{11}$/.test(videoId)) throw pageTokenError('schema', 'videoId is not a valid YouTube identifier.');
  return videoId;
}

export function validateRequestId(requestId) {
  assertStringLimit(requestId, 'requestId', PAGE_TOKEN_LIMITS.messageIdBytes, { nonEmpty: true });
  if (!/^[\x21-\x7e]+$/.test(requestId)) throw pageTokenError('schema', 'requestId must be printable ASCII.');
  return requestId;
}

export function validateNonce(nonce) {
  assertStringLimit(nonce, 'nonce', PAGE_TOKEN_LIMITS.nonceBytes, { nonEmpty: true });
  if (!/^[\x21-\x7e]+$/.test(nonce)) throw pageTokenError('schema', 'nonce must be printable ASCII.');
  return nonce;
}

export function validatePageChallenge(value) {
  assertAllowedKeys(value, 'page challenge', ['globalName', 'program']);
  assertStringLimit(value.globalName, 'globalName', PAGE_TOKEN_LIMITS.globalNameBytes, { nonEmpty: true });
  if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(value.globalName)) throw pageTokenError('schema', 'globalName must be a JavaScript identifier.');
  assertStringLimit(value.program, 'program', PAGE_TOKEN_LIMITS.programBytes, { nonEmpty: true });
  return value;
}

export function byteLength(value) {
  return encoder.encode(String(value ?? '')).byteLength;
}

export function jsonByteLength(value) {
  return byteLength(JSON.stringify(value ?? null));
}

export function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw pageTokenError('schema', `${name} must be an object.`);
  }
}

export function assertAllowedKeys(value, name, allowedKeys) {
  assertPlainObject(value, name);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw pageTokenError('schema', `${name} contains unsupported field ${key}.`);
  }
}

export function assertStringLimit(value, name, limit, options = {}) {
  if (typeof value !== 'string') throw pageTokenError('schema', `${name} must be a string.`);
  if (options.nonEmpty && !value) throw pageTokenError('schema', `${name} must not be empty.`);
  const size = options.chars ? value.length : byteLength(value);
  if (size > limit) throw pageTokenError('too-large', `${name} exceeds the allowed size.`);
}

export function assertJsonLimit(value, name, limit) {
  if (jsonByteLength(value) > limit) throw pageTokenError('too-large', `${name} exceeds the allowed size.`);
}

export function assertEnvelopeLimit(value) {
  if (jsonByteLength(value) > PAGE_TOKEN_LIMITS.envelopeBytes) throw pageTokenError('too-large', 'Page token message exceeds the allowed size.');
}

export function pageTokenError(code, message) {
  const error = new Error(String(message || code).slice(0, PAGE_TOKEN_LIMITS.statusMessageChars));
  error.code = code;
  return error;
}

function assertEnvelope(value, name) {
  if (value.version !== PAGE_TOKEN_PROTOCOL_VERSION) throw pageTokenError('schema', `Unsupported page token ${name} version.`);
  validateRequestId(value.requestId);
  validateNonce(value.nonce);
  validateVideoId(value.videoId);
}

function assertFinitePositive(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw pageTokenError('schema', `${name} must be a positive number.`);
  }
}

function rejectUnexpected(value, name) {
  if (value !== undefined) throw pageTokenError('schema', `${name} is not supported.`);
}
