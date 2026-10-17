import { fetchWebPoGenerateIt } from './webpo-fetch.js';
import { youtubeFrameIdentity } from './frame.js';
import {
  PAGE_TOKEN_LIMITS,
  PAGE_TOKEN_PROTOCOL_VERSION,
  PAGE_TOKEN_REQUEST_DIRECTION,
  createPageTokenMessage,
  pageTokenError,
  validateIntegrityData,
  validatePageTokenMessage,
  validatePageTokenReply as validatePageTokenReplyPayload,
  validateVideoId
} from '../../shared/youtube-page-token-protocol.js';

const SERVICE_TARGET = 'service';
const RELAY_TARGET = 'youtube-page-token-relay';
const RELAY_REQUEST_TYPE = 'youtube-page-token.request';
const RELAY_REPLY_TYPE = 'youtube.page-token.reply';
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const GENERATE_IT_HEADERS = Object.freeze({
  'x-goog-api-key': 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw',
  'x-user-agent': 'grpc-web-javascript/0.1'
});

const LIMITS = Object.freeze({
  idChars: PAGE_TOKEN_LIMITS.messageIdBytes,
  videoIdChars: PAGE_TOKEN_LIMITS.videoIdBytes,
  botguardResponseBytes: 128 * 1024,
  integrityTokenBytes: PAGE_TOKEN_LIMITS.integrityBytes,
  poTokenChars: PAGE_TOKEN_LIMITS.poTokenChars,
  initTimeoutMs: PAGE_TOKEN_LIMITS.initTimeoutMs,
  mintTimeoutMs: PAGE_TOKEN_LIMITS.mintTimeoutMs,
  maxPendingMessages: PAGE_TOKEN_LIMITS.maxPendingMessages,
  snapshotRateWindowMs: PAGE_TOKEN_LIMITS.snapshotRateWindowMs,
  maxSnapshotsPerWindowPerTab: PAGE_TOKEN_LIMITS.maxSnapshotsPerWindow,
  maxLifetimeMs: PAGE_TOKEN_LIMITS.maxLifetimeMs,
  statusMessageChars: PAGE_TOKEN_LIMITS.statusMessageChars
});

const ASCII_ID = /^[\x20-\x7e]{1,128}$/;
const encoder = new TextEncoder();

let defaultBroker;

export function requestPageToken(key, signal, options) {
  return getDefaultBroker().requestPageToken(key, signal, options);
}

export function handlePageTokenReply(message, sender) {
  return getDefaultBroker().handlePageTokenReply(message, sender);
}

export function disposePageTokenSession(key) {
  return getDefaultBroker().disposePageTokenSession(key);
}

export function disposePageTokenSessionsForTab(tabId) {
  return getDefaultBroker().disposePageTokenSessionsForTab(tabId);
}

export function disposePageTokenSessionsForFrame(tabId, frameId) {
  return getDefaultBroker().disposePageTokenSessionsForFrame(tabId, frameId);
}

export function validatePageTokenReply(message) {
  assertAllowedKeys(message, 'page token reply', ['target', 'type', 'payload']);
  if (message.target !== SERVICE_TARGET || message.type !== RELAY_REPLY_TYPE) throw pageTokenError('schema', 'Unexpected page token reply route.');
  return validatePageTokenReplyPayload(message.payload);
}

export function createPageTokenBroker({
  chromeApi = globalThis.chrome,
  fetchImpl = (...args) => globalThis.fetch(...args),
  clock = Date,
  randomUUID = () => globalThis.crypto?.randomUUID?.(),
  timeout = (fn, delay) => setTimeout(fn, delay),
  clearTimer = (id) => clearTimeout(id)
} = {}) {
  return new PageTokenBroker({ chromeApi, fetchImpl, clock, randomUUID, timeout, clearTimer });
}

function getDefaultBroker() {
  if (!defaultBroker) defaultBroker = createPageTokenBroker();
  return defaultBroker;
}

export async function requestIntegrity(snapshot, signal, options = {}) {
  assertStringLimit(snapshot, 'botguardResponse', LIMITS.botguardResponseBytes);
  const response = await fetchWebPoGenerateIt([REQUEST_KEY, snapshot], {
    allowedOrigins: ['https://jnn-pa.googleapis.com/*'],
    headers: GENERATE_IT_HEADERS,
    fetch: options.fetch,
    signal
  });
  const raw = await response.json();
  return normalizeIntegrityData(raw);
}

class PageTokenBroker {
  constructor({ chromeApi, fetchImpl, clock, randomUUID, timeout, clearTimer }) {
    this.chrome = chromeApi;
    this.fetch = fetchImpl;
    this.clock = clock;
    this.randomUUID = randomUUID;
    this.timeout = timeout;
    this.clearTimer = clearTimer;
    this.sessions = new Map();
    this.pending = new Map();
    this.inFlightRequests = 0;
    this.snapshotTimesByTab = new Map();
  }

  async requestPageToken(key, signal, options = {}) {
    const normalizedKey = validateSessionKey(key);
    const forceRefresh = options?.forceRefresh === true;
    signal?.throwIfAborted?.();
    if (this.inFlightRequests >= LIMITS.maxPendingMessages) throw pageTokenError('queue-full', 'Page token request queue is full.');
    this.inFlightRequests += 1;
    let session;
    try {
      const pageOrigin = await this.assertCurrentGrantedDocument(normalizedKey);
      session = await this.ensureSession(normalizedKey, signal, pageOrigin);
      if (session.activeRequest) return await this.waitForActiveRequest(session, signal);
      if (!forceRefresh && session.cachedResult && session.cachedResult.expiresAt > this.clock.now() + 1000) {
        return { ...session.cachedResult };
      }
      if (forceRefresh) session.cachedResult = null;
      if (!session.activeRequest) this.startActiveRequest(session);
      return await this.waitForActiveRequest(session, signal);
    } finally {
      this.inFlightRequests -= 1;
    }
  }

  startActiveRequest(session) {
    this.assertSessionActive(session);
    const activeRequest = {
      controller: new AbortController(),
      consumers: 0,
      settled: false,
      promise: null
    };
    session.activeRequest = activeRequest;
    activeRequest.promise = this.runActiveRequest(session, activeRequest);
  }

  async runActiveRequest(session, activeRequest) {
    try {
      const operationSignal = anySignal([session.abortController.signal, activeRequest.controller.signal]);
      await this.assertCurrentGrantedDocument(session.key);
      const { integrity, startedAt } = await this.ensureFreshIntegrity(session, operationSignal);
      await this.assertCurrentGrantedDocument(session.key);
      const minted = await this.sendToRelay(session, 'mint', { integrity }, LIMITS.mintTimeoutMs, operationSignal);
      await this.assertCurrentGrantedDocument(session.key);
      const result = {
        requestId: minted.requestId,
        videoId: session.key.videoId,
        poToken: minted.poToken,
        expiresAt: this.computeExpiry(integrity, startedAt)
      };
      session.cachedResult = { ...result };
      return result;
    } catch (error) {
      await this.disposeSession(session);
      throw error;
    } finally {
      activeRequest.settled = true;
      if (session.activeRequest === activeRequest) session.activeRequest = null;
    }
  }

  async ensureFreshIntegrity(session, signal) {
    const cached = session.cachedIntegrity;
    if (cached?.expiresAt > this.clock.now() + 1000) {
      return { integrity: cached.integrity, startedAt: cached.startedAt };
    }
    this.enforceSnapshotRate(session.key.tabId);
    const snapshot = await this.sendToRelay(session, 'snapshot', undefined, LIMITS.initTimeoutMs, signal);
    await this.assertCurrentGrantedDocument(session.key);
    const startedAt = this.clock.now();
    const integrity = await requestIntegrity(snapshot.botguardResponse, signal, { fetch: this.fetch });
    const expiresAt = this.computeExpiry(integrity, startedAt);
    session.cachedIntegrity = {
      integrity: { ...integrity },
      startedAt,
      expiresAt
    };
    return { integrity, startedAt };
  }

  async waitForActiveRequest(session, signal) {
    const activeRequest = session.activeRequest;
    if (!activeRequest) throw pageTokenError('disposed', 'Page token session is disposed.');
    if (signal?.aborted) throw signal.reason || pageTokenError('aborted', 'Page token request was aborted.');
    activeRequest.consumers += 1;
    return await new Promise((resolve, reject) => {
      let settled = false;
      const releaseConsumer = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener?.('abort', abortConsumer);
        activeRequest.consumers -= 1;
        if (!activeRequest.settled && activeRequest.consumers === 0) {
          activeRequest.controller.abort(pageTokenError('aborted', 'All page token consumers were aborted.'));
        }
      };
      const abortConsumer = () => {
        const reason = signal.reason || pageTokenError('aborted', 'Page token request was aborted.');
        releaseConsumer();
        reject(reason);
      };
      signal?.addEventListener?.('abort', abortConsumer, { once: true });
      activeRequest.promise.then(
        result => {
          releaseConsumer();
          resolve({ ...result });
        },
        error => {
          releaseConsumer();
          reject(error);
        }
      );
    });
  }

  async handlePageTokenReply(message, sender) {
    const reply = validatePageTokenReply(message);
    const pending = this.pending.get(reply.requestId);
    if (!pending) return { accepted: false };
    try {
      this.assertSenderMatchesSession(sender, pending.session);
      await this.assertCurrentGrantedDocument(pending.session.key);
      if (this.pending.get(reply.requestId) !== pending) return { accepted: false };
      if (reply.nonce !== pending.session.nonce) throw pageTokenError('nonce', 'Page token nonce mismatch.');
      if (reply.videoId !== pending.session.key.videoId) throw pageTokenError('video', 'Page token video mismatch.');
      if (reply.operation !== pending.operation && reply.operation !== 'error') throw pageTokenError('operation', 'Page token operation mismatch.');
    } catch (error) {
      this.rejectPending(pending, error);
      return { accepted: false };
    }
    if (reply.operation === 'error') {
      this.rejectPending(pending, pageTokenError(reply.code || 'page-token', 'Page token helper failed.'));
      return { accepted: true };
    }
    this.resolvePending(pending, reply);
    return { accepted: true };
  }

  async disposePageTokenSession(key) {
    const normalizedKey = validateSessionKey(key);
    const session = this.sessions.get(sessionId(normalizedKey));
    if (!session) return { disposed: false };
    await this.disposeSession(session);
    return { disposed: true };
  }

  async disposePageTokenSessionsForTab(tabId) {
    let disposed = 0;
    for (const session of [...this.sessions.values()]) {
      if (session.key.tabId === tabId) {
        disposed += 1;
        await this.disposeSession(session);
      }
    }
    return { disposed };
  }

  async disposePageTokenSessionsForFrame(tabId, frameId) {
    let disposed = 0;
    for (const session of [...this.sessions.values()]) {
      if (session.key.tabId === tabId && session.key.frameId === frameId) {
        disposed += 1;
        await this.disposeSession(session);
      }
    }
    return { disposed };
  }

  async ensureSession(key, signal, pageOrigin) {
    const id = sessionId(key);
    const existing = this.sessions.get(id);
    if (existing && !existing.disposed) {
      await abortableWait(existing.readyPromise, signal);
      return existing;
    }
    const session = {
      id,
      key,
      pageOrigin,
      nonce: createNonce(this.randomUUID),
      cachedResult: null,
      cachedIntegrity: null,
      activeRequest: null,
      abortController: new AbortController(),
      disposed: false,
      readyPromise: null,
      lifetimeTimer: null
    };
    session.lifetimeTimer = this.timeout(() => { void this.disposeSession(session); }, LIMITS.maxLifetimeMs);
    session.lifetimeTimer?.unref?.();
    this.sessions.set(id, session);
    session.readyPromise = this.injectRelayAndHelper(key, session.abortController.signal).catch(async error => {
      await this.disposeSession(session);
      throw error;
    });
    await abortableWait(session.readyPromise, signal);
    return session;
  }

  async injectRelayAndHelper(key, signal) {
    signal?.throwIfAborted?.();
    await this.chrome.scripting.executeScript({
      target: { tabId: key.tabId, documentIds: [key.documentId] },
      files: ['src/content/youtube-token-relay.bundle.js']
    });
    signal?.throwIfAborted?.();
    await this.chrome.scripting.executeScript({
      target: { tabId: key.tabId, documentIds: [key.documentId] },
      world: 'MAIN',
      files: ['src/content/youtube-page-token.bundle.js']
    });
  }

  async sendToRelay(session, operation, data, timeoutMs, signal) {
    this.assertSessionActive(session);
    if (this.pending.size >= LIMITS.maxPendingMessages) throw pageTokenError('queue-full', 'Page token request queue is full.');
    const requestId = createNonce(this.randomUUID);
    const requestPayload = {
      version: PAGE_TOKEN_PROTOCOL_VERSION,
      operation,
      requestId,
      nonce: session.nonce,
      videoId: session.key.videoId
    };
    if (operation === 'mint') requestPayload.integrity = data?.integrity;
    const message = {
      target: RELAY_TARGET,
      type: RELAY_REQUEST_TYPE,
      payload: createPageTokenMessage(PAGE_TOKEN_REQUEST_DIRECTION, requestPayload)
    };
    validateRelayRequest(message);
    return await new Promise((resolve, reject) => {
      const timer = this.timeout(() => {
        const pending = this.pending.get(requestId);
        if (pending) this.rejectPending(pending, pageTokenError('timeout', `Page token ${operation} timed out.`));
      }, timeoutMs);
      const abort = () => {
        const pending = this.pending.get(requestId);
        if (pending) this.rejectPending(pending, signal.reason || pageTokenError('aborted', 'Page token request was aborted.'));
      };
      signal?.addEventListener?.('abort', abort, { once: true });
      const pending = { requestId, operation, session, resolve, reject, timer, signal, abort };
      this.pending.set(requestId, pending);
      this.chrome.tabs.sendMessage(session.key.tabId, message, {
        documentId: session.key.documentId
      }).catch(error => {
        const item = this.pending.get(requestId);
        if (item) this.rejectPending(item, pageTokenError('relay', error?.message || 'Page token relay is unavailable.'));
      });
    });
  }

  resolvePending(pending, value) {
    this.pending.delete(pending.requestId);
    this.clearTimer(pending.timer);
    pending.signal?.removeEventListener?.('abort', pending.abort);
    pending.resolve(value);
  }

  rejectPending(pending, error) {
    this.pending.delete(pending.requestId);
    this.clearTimer(pending.timer);
    pending.signal?.removeEventListener?.('abort', pending.abort);
    pending.reject(error);
  }

  async disposeSession(session) {
    if (!session || session.disposed) return;
    session.disposed = true;
    session.abortController.abort(pageTokenError('disposed', 'Page token session was disposed.'));
    this.clearTimer(session.lifetimeTimer);
    this.sessions.delete(session.id);
    for (const pending of [...this.pending.values()]) {
      if (pending.session === session) this.rejectPending(pending, pageTokenError('disposed', 'Page token session was disposed.'));
    }
    try {
      const payload = {
        version: PAGE_TOKEN_PROTOCOL_VERSION,
        operation: 'dispose',
        requestId: createNonce(this.randomUUID),
        nonce: session.nonce,
        videoId: session.key.videoId
      };
      await this.chrome.tabs.sendMessage(session.key.tabId, {
        target: RELAY_TARGET,
        type: RELAY_REQUEST_TYPE,
        payload: createPageTokenMessage(PAGE_TOKEN_REQUEST_DIRECTION, payload)
      }, { documentId: session.key.documentId });
    } catch {}
  }

  async assertCurrentGrantedDocument(key) {
    const [tab, frame] = await Promise.all([
      this.chrome.tabs.get(key.tabId),
      this.chrome.webNavigation.getFrame({ tabId: key.tabId, frameId: key.frameId })
    ]);
    if (!tab || !frame) throw pageTokenError('document', 'The YouTube tab is unavailable.');
    if (frame.documentId !== key.documentId) throw pageTokenError('document', 'The YouTube page changed before token minting.');
    const identity = youtubeFrameIdentity(frame.url);
    if (!identity) throw pageTokenError('document', 'Open an ordinary YouTube video frame before minting a token.');
    if (identity.videoId !== key.videoId) throw pageTokenError('video', 'The active YouTube video changed before token minting.');
    const origin = identity.origin;
    const allowed = await this.chrome.permissions.contains({ origins: [`${origin}/*`] });
    if (!allowed) throw pageTokenError('permission', 'Allow this YouTube site before minting a token.');
    return origin;
  }

  assertSenderMatchesSession(sender, session) {
    if (sender?.id !== this.chrome.runtime.id) throw pageTokenError('sender', 'Unexpected extension sender.');
    if (sender.tab?.id !== session.key.tabId || (sender.frameId ?? 0) !== session.key.frameId) throw pageTokenError('sender', 'Page token reply came from the wrong frame.');
    if (sender.documentId !== session.key.documentId) throw pageTokenError('document', 'Page token reply came from a stale document.');
    const identity = youtubeFrameIdentity(sender.url);
    if (!identity || identity.origin !== session.pageOrigin || identity.videoId !== session.key.videoId) throw pageTokenError('video', 'Page token reply came from a different video.');
  }

  assertSessionActive(session) {
    if (!session || session.disposed || this.sessions.get(session.id) !== session) throw pageTokenError('disposed', 'Page token session is disposed.');
  }

  enforceSnapshotRate(tabId) {
    const now = this.clock.now();
    const cutoff = now - LIMITS.snapshotRateWindowMs;
    const current = (this.snapshotTimesByTab.get(tabId) || []).filter(timestamp => timestamp > cutoff);
    if (current.length >= LIMITS.maxSnapshotsPerWindowPerTab) throw pageTokenError('rate-limit', 'Page token snapshot rate limit reached.');
    current.push(now);
    this.snapshotTimesByTab.set(tabId, current);
  }

  computeExpiry(integrity, fromTimestamp = this.clock.now()) {
    const ttlMs = Math.max(1, Math.min(LIMITS.maxLifetimeMs, Number(integrity.estimatedTtlSecs || 60) * 1000));
    return fromTimestamp + ttlMs;
  }
}

function validateRelayRequest(message) {
  assertAllowedKeys(message, 'page token request', ['target', 'type', 'payload']);
  if (message.target !== RELAY_TARGET || message.type !== RELAY_REQUEST_TYPE) throw pageTokenError('schema', 'Unexpected relay request route.');
  validatePageTokenMessage(message.payload, PAGE_TOKEN_REQUEST_DIRECTION);
}

function validateSessionKey(key) {
  assertAllowedKeys(key, 'token session key', ['tabId', 'frameId', 'documentId', 'videoId']);
  if (!Number.isInteger(key.tabId) || key.tabId < 0) throw pageTokenError('schema', 'tabId must be a non-negative integer.');
  if (!Number.isInteger(key.frameId) || key.frameId < 0) throw pageTokenError('schema', 'frameId must be a non-negative integer.');
  assertStringLimit(key.documentId, 'documentId', LIMITS.idChars);
  if (!key.documentId) throw pageTokenError('schema', 'documentId is required.');
  validateVideoId(key.videoId);
  return { tabId: key.tabId, frameId: key.frameId, documentId: key.documentId, videoId: key.videoId };
}

function normalizeIntegrityData(raw) {
  const token = Array.isArray(raw?.[0]) ? raw[0][0] : raw?.[0] ?? raw?.integrityToken;
  const ttl = Array.isArray(raw) ? raw[1] : raw?.estimatedTtlSecs;
  const threshold = Array.isArray(raw?.[2]) ? raw[2][0] : raw?.[2] ?? raw?.mintRefreshThreshold;
  const integrity = {
    integrityToken: token,
    estimatedTtlSecs: Number(ttl)
  };
  if (threshold !== undefined) integrity.mintRefreshThreshold = Number(threshold);
  validateIntegrityData(integrity);
  return integrity;
}

function assertAllowedKeys(value, name, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw pageTokenError('schema', `${name} must be an object.`);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw pageTokenError('schema', `${name} contains unsupported field ${key}.`);
  }
}

function assertStringLimit(value, name, limit) {
  if (typeof value !== 'string') throw pageTokenError('schema', `${name} must be a string.`);
  if (encoder.encode(value).byteLength > limit) throw pageTokenError('too-large', `${name} exceeds the allowed size.`);
}

function createNonce(randomUUID) {
  const value = randomUUID?.();
  if (typeof value === 'string' && ASCII_ID.test(value)) return value;
  if (!globalThis.crypto?.getRandomValues) throw pageTokenError('crypto', 'Secure crypto is required for page token nonces.');
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sessionId(key) {
  return `${key.tabId}:${key.frameId}:${key.documentId}:${key.videoId}`;
}


async function abortableWait(promise, signal) {
  if (!signal) return await promise;
  if (signal.aborted) throw signal.reason || pageTokenError('aborted', 'Page token request was aborted.');
  return await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener?.('abort', abort);
      return true;
    };
    const abort = () => {
      if (cleanup()) reject(signal.reason || pageTokenError('aborted', 'Page token request was aborted.'));
    };
    signal.addEventListener?.('abort', abort, { once: true });
    promise.then(
      value => {
        if (cleanup()) resolve(value);
      },
      error => {
        if (cleanup()) reject(error);
      }
    );
  });
}

function anySignal(signals) {
  const active = signals.filter(Boolean);
  if (!active.length) return undefined;
  if (active.length === 1) return active[0];
  if (AbortSignal.any) return AbortSignal.any(active);
  const controller = new AbortController();
  const abort = event => controller.abort(event?.target?.reason);
  for (const signal of active) {
    if (signal.aborted) return AbortSignal.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

export const PAGE_TOKEN_TESTING = Object.freeze({
  LIMITS,
  RELAY_TARGET,
  RELAY_REQUEST_TYPE,
  RELAY_REPLY_TYPE,
  SERVICE_TARGET,
  REQUEST_KEY,
  normalizeIntegrityData,
  validateRelayRequest,
  validateSessionKey
});
