export const BOTGUARD_PROTOCOL_VERSION = 1;
export const PARENT_SOURCE = 'vds.botguard.parent';
export const SANDBOX_SOURCE = 'vds.botguard.sandbox';
export const SANDBOX_TARGET = 'vds.botguard.sandbox';
export const PARENT_TARGET = 'vds.botguard.parent';
export const FAKE_INTERPRETER_JAVASCRIPT = 'vds.fake.botguard.interpreter.v1';
export const FAKE_INTERPRETER_PROGRAM = 'vds.fake.botguard.program.v1';

export const BOTGUARD_LIMITS = Object.freeze({
  envelopeBytes: 5 * 1024 * 1024,
  interpreterJavascriptBytes: 4 * 1024 * 1024,
  interpreterProgramBytes: 1 * 1024 * 1024,
  challengeMetadataBytes: 256 * 1024,
  integrityTokenBytes: 64 * 1024,
  responseBytes: 128 * 1024,
  contentBindingBytes: 128,
  poTokenChars: 512,
  statusMessageChars: 2048,
  initTimeoutMs: 15000,
  mintTimeoutMs: 5000,
  maxQueuedMintRequests: 8,
  requestRateWindowMs: 60 * 1000,
  maxRequestsPerWindow: 120,
  maxContentBindingsPerSession: 20,
  maxLifetimeMs: 10 * 60 * 1000,
  maxIframeRebuilds: 1
});

const encoder = new TextEncoder();

export function byteLength(value) {
  return encoder.encode(String(value || '')).byteLength;
}

export function jsonByteLength(value) {
  return byteLength(JSON.stringify(value ?? null));
}

export function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw protocolError('schema', `${name} must be an object.`);
}

export function assertAllowedKeys(value, name, allowedKeys) {
  assertPlainObject(value, name);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw protocolError('schema', `${name} contains unsupported field ${key}.`);
  }
}

export function assertStringLimit(value, name, limit) {
  if (typeof value !== 'string') throw protocolError('schema', `${name} must be a string.`);
  if (byteLength(value) > limit) throw protocolError('too-large', `${name} exceeds the allowed size.`);
}

export function assertJsonLimit(value, name, limit) {
  if (jsonByteLength(value) > limit) throw protocolError('too-large', `${name} exceeds the allowed size.`);
}

export function assertEnvelopeLimit(message) {
  if (jsonByteLength(message) > BOTGUARD_LIMITS.envelopeBytes) throw protocolError('too-large', 'Broker message exceeds the allowed envelope size.');
}

export function assertInitPayload(payload) {
  assertAllowedKeys(payload, 'init payload', ['interpreterJavascript', 'interpreterProgram', 'challengeMetadata', 'integrityToken']);
  assertStringLimit(payload.interpreterJavascript, 'interpreterJavascript', BOTGUARD_LIMITS.interpreterJavascriptBytes);
  assertStringLimit(payload.interpreterProgram, 'interpreterProgram', BOTGUARD_LIMITS.interpreterProgramBytes);
  assertChallengeMetadata(payload.challengeMetadata || {});
  if (payload.integrityToken !== undefined) assertIntegrityToken(payload.integrityToken);
}

export function assertMintPayload(payload) {
  assertAllowedKeys(payload, 'mint payload', ['contentBinding', 'integrityToken']);
  assertStringLimit(payload.contentBinding, 'contentBinding', BOTGUARD_LIMITS.contentBindingBytes);
  if (payload.integrityToken !== undefined) assertIntegrityToken(payload.integrityToken);
}

export function assertChallengeMetadata(metadata) {
  assertAllowedKeys(metadata, 'challengeMetadata', ['globalName', 'contentBinding', 'signedTimestamp', 'skipPrivacyBuffer', 'youtubeConfig']);
  assertJsonLimit(metadata, 'challengeMetadata', BOTGUARD_LIMITS.challengeMetadataBytes);
  if (metadata.youtubeConfig !== undefined) assertYoutubeConfig(metadata.youtubeConfig);
  if (metadata.globalName !== undefined) {
    assertStringLimit(metadata.globalName, 'globalName', 128);
    if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(metadata.globalName)) throw protocolError('schema', 'globalName must be a JavaScript identifier.');
  }
  if (metadata.contentBinding !== undefined) assertContentBindingMetadata(metadata.contentBinding);
  if (metadata.signedTimestamp !== undefined && typeof metadata.signedTimestamp !== 'string' && typeof metadata.signedTimestamp !== 'number') throw protocolError('schema', 'signedTimestamp must be a string or number.');
  if (metadata.skipPrivacyBuffer !== undefined && typeof metadata.skipPrivacyBuffer !== 'boolean') throw protocolError('schema', 'skipPrivacyBuffer must be a boolean.');
}


export function assertYoutubeConfig(youtubeConfig) {
  assertAllowedKeys(youtubeConfig, 'youtubeConfig', ['EVENT_ID']);
  assertStringLimit(youtubeConfig.EVENT_ID, 'youtubeConfig.EVENT_ID', 4096);
}

export function assertContentBindingMetadata(contentBinding) {
  assertAllowedKeys(contentBinding, 'contentBinding metadata', ['c', 'e', 'encryptedVideoId', 'externalChannelId', 'commentId', 'atr_challenge']);
  assertJsonLimit(contentBinding, 'contentBinding metadata', BOTGUARD_LIMITS.challengeMetadataBytes);
  for (const [key, value] of Object.entries(contentBinding)) assertStringLimit(value, `contentBinding.${key}`, BOTGUARD_LIMITS.contentBindingBytes);
}

export function assertIntegrityToken(integrityToken) {
  assertAllowedKeys(integrityToken, 'integrityToken', ['integrityToken', 'estimatedTtlSecs', 'mintRefreshThreshold', 'websafeFallbackToken']);
  assertJsonLimit(integrityToken, 'integrityToken', BOTGUARD_LIMITS.integrityTokenBytes);
  if (integrityToken.integrityToken !== undefined) assertStringLimit(integrityToken.integrityToken, 'integrityToken.integrityToken', BOTGUARD_LIMITS.integrityTokenBytes);
  if (integrityToken.websafeFallbackToken !== undefined) assertStringLimit(integrityToken.websafeFallbackToken, 'integrityToken.websafeFallbackToken', BOTGUARD_LIMITS.poTokenChars);
  if (integrityToken.estimatedTtlSecs !== undefined && typeof integrityToken.estimatedTtlSecs !== 'number') throw protocolError('schema', 'estimatedTtlSecs must be a number.');
  if (integrityToken.mintRefreshThreshold !== undefined && typeof integrityToken.mintRefreshThreshold !== 'number') throw protocolError('schema', 'mintRefreshThreshold must be a number.');
}

export function validateParentMessage(message) {
  assertAllowedKeys(message, 'message', ['v', 'source', 'target', 'id', 'nonce', 'type', 'payload']);
  assertEnvelopeLimit(message);
  if (message.v !== BOTGUARD_PROTOCOL_VERSION) throw protocolError('schema', 'Unsupported broker protocol version.');
  if (message.source !== PARENT_SOURCE || message.target !== SANDBOX_TARGET) throw protocolError('source', 'Unexpected broker message source.');
  if (typeof message.id !== 'string' || !message.id) throw protocolError('schema', 'Missing broker message id.');
  if (typeof message.nonce !== 'string' || !message.nonce) throw protocolError('schema', 'Missing broker nonce.');
  if (!['init', 'mint', 'dispose'].includes(message.type)) throw protocolError('schema', 'Unsupported broker message type.');
  if (message.type === 'init') assertInitPayload(message.payload);
  if (message.type === 'mint') assertMintPayload(message.payload);
  if (message.type === 'dispose') assertAllowedKeys(message.payload, 'dispose payload', []);
}

export function validateSandboxMessage(message, expectedType) {
  assertAllowedKeys(message, 'message', ['v', 'source', 'target', 'id', 'nonce', 'ok', 'data', 'error']);
  assertEnvelopeLimit(message);
  if (message.v !== BOTGUARD_PROTOCOL_VERSION) throw protocolError('schema', 'Unsupported broker protocol version.');
  if (message.source !== SANDBOX_SOURCE || message.target !== PARENT_TARGET) throw protocolError('source', 'Unexpected sandbox message source.');
  if (typeof message.id !== 'string' || !message.id) throw protocolError('schema', 'Missing sandbox message id.');
  if (typeof message.nonce !== 'string' || !message.nonce) throw protocolError('schema', 'Missing sandbox nonce.');
  if (typeof message.ok !== 'boolean') throw protocolError('schema', 'Sandbox response must include ok boolean.');
  if (message.ok) validateSandboxData(message.data, expectedType);
  else validateSandboxError(message.error);
}

export function validateSandboxData(data, expectedType) {
  assertPlainObject(data, 'sandbox response data');
  if (expectedType === 'init') {
    assertAllowedKeys(data, 'init response data', ['interpreter', 'botguardResponse', 'initializedAt', 'capabilities']);
    if (!['fake', 'botguard'].includes(data.interpreter)) throw protocolError('schema', 'Unexpected interpreter response.');
    assertStringLimit(data.botguardResponse, 'botguardResponse', BOTGUARD_LIMITS.responseBytes);
    if (typeof data.initializedAt !== 'number') throw protocolError('schema', 'Missing initializedAt value.');
    if (data.capabilities !== undefined) assertJsonLimit(data.capabilities, 'capabilities', BOTGUARD_LIMITS.challengeMetadataBytes);
    return;
  }
  if (expectedType === 'mint') {
    assertAllowedKeys(data, 'mint response data', ['poToken', 'contentBinding', 'mintedAt']);
    assertStringLimit(data.poToken, 'poToken', BOTGUARD_LIMITS.poTokenChars);
    assertStringLimit(data.contentBinding, 'contentBinding', BOTGUARD_LIMITS.contentBindingBytes);
    if (typeof data.mintedAt !== 'number') throw protocolError('schema', 'Missing mintedAt value.');
    return;
  }
  if (expectedType === 'dispose') {
    assertAllowedKeys(data, 'dispose response data', ['disposed']);
    if (data.disposed !== true) throw protocolError('schema', 'Unexpected dispose response.');
    return;
  }
  throw protocolError('schema', 'Unexpected sandbox response type.');
}

export function validateSandboxError(error) {
  assertAllowedKeys(error, 'sandbox error', ['code', 'message']);
  assertStringLimit(error.code, 'error code', 128);
  assertStringLimit(error.message, 'error message', BOTGUARD_LIMITS.statusMessageChars);
}

export function protocolError(code, message) {
  const error = new Error(String(message || code).slice(0, BOTGUARD_LIMITS.statusMessageChars));
  error.code = code;
  return error;
}
