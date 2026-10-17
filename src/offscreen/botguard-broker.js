import {
  BOTGUARD_LIMITS,
  BOTGUARD_PROTOCOL_VERSION,
  PARENT_SOURCE,
  PARENT_TARGET,
  SANDBOX_SOURCE,
  SANDBOX_TARGET,
  assertEnvelopeLimit,
  assertInitPayload,
  assertMintPayload,
  protocolError,
  validateSandboxMessage
} from '../shared/botguard-protocol.js';

export function createBotguardBroker({ document: ownerDocument = globalThis.document, sandboxUrl, expectedOrigin = 'null' } = {}) {
  return new BotguardBroker(ownerDocument, sandboxUrl, expectedOrigin);
}

class BotguardBroker {
  constructor(ownerDocument, sandboxUrl, expectedOrigin) {
    if (!ownerDocument?.createElement) throw protocolError('document', 'A DOM document is required for the BotGuard broker.');
    this.document = ownerDocument;
    this.view = ownerDocument.defaultView || globalThis;
    this.sandboxUrl = sandboxUrl || chrome.runtime.getURL('src/sandbox/botguard.html');
    this.expectedOrigin = expectedOrigin;
    this.nonce = createNonce();
    this.pending = new Map();
    this.inFlightMintRequests = 0;
    this.requestTimestamps = [];
    this.contentBindings = new Set();
    this.initialized = false;
    this.initializing = false;
    this.disposed = false;
    this.rebuilds = 0;
    this.iframe = null;
    this.frameReady = null;
    this.frameReadySettled = false;
    this.frameLoadTimer = 0;
    this.frameLoadReject = null;
    this.lifetimeTimer = this.view.setTimeout(() => this.dispose(), BOTGUARD_LIMITS.maxLifetimeMs);
    this.onMessage = this.onMessage.bind(this);
    this.view.addEventListener('message', this.onMessage);
  }

  async initialize(payload) {
    this.assertActive();
    if (this.initialized) throw protocolError('state', 'BotGuard broker is already initialized.');
    if (this.initializing) throw protocolError('state', 'BotGuard initialization is already in progress.');
    assertInitPayload(payload);
    this.initializing = true;
    try {
      const data = await this.request('init', payload, BOTGUARD_LIMITS.initTimeoutMs);
      this.assertActive();
      this.initialized = true;
      return data;
    } finally {
      this.initializing = false;
    }
  }

  async mint(payload) {
    this.assertActive();
    if (!this.initialized) throw protocolError('state', 'BotGuard broker must be initialized before minting.');
    assertMintPayload(payload);
    this.enforceContentBindingLimit(payload.contentBinding);
    if (this.inFlightMintRequests >= BOTGUARD_LIMITS.maxQueuedMintRequests) throw protocolError('queue-full', 'BotGuard mint queue is full.');
    this.inFlightMintRequests += 1;
    try {
      return await this.request('mint', payload, BOTGUARD_LIMITS.mintTimeoutMs);
    } finally {
      this.inFlightMintRequests -= 1;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.view.clearTimeout(this.lifetimeTimer);
    this.view.clearTimeout(this.frameLoadTimer);
    this.view.removeEventListener('message', this.onMessage);
    this.frameLoadReject?.(protocolError('disposed', 'BotGuard broker was disposed.'));
    this.frameLoadReject = null;
    this.failAll(protocolError('disposed', 'BotGuard broker was disposed.'));
    try {
      this.enforceRequestRate();
      this.iframe?.contentWindow?.postMessage(this.envelope('dispose', {}), '*');
    } catch {}
    this.iframe?.remove?.();
    this.iframe = null;
    this.frameReady = null;
    this.frameReadySettled = false;
    this.initialized = false;
    this.initializing = false;
  }

  async request(type, payload, timeoutMs) {
    this.enforceRequestRate();
    await this.ensureFrame();
    this.assertActive();
    if (!this.iframe?.contentWindow) throw protocolError('sandbox', 'BotGuard sandbox is unavailable.');
    const id = createNonce();
    const message = this.envelope(type, payload, id);
    assertEnvelopeLimit(message);
    return await new Promise((resolve, reject) => {
      const timer = this.view.setTimeout(() => {
        this.pending.delete(id);
        const error = protocolError('timeout', `BotGuard ${type} timed out.`);
        reject(error);
        this.failAll(protocolError('sandbox-reset', 'BotGuard sandbox was reset after a request timeout.'));
        this.destroyFrame();
      }, timeoutMs);
      this.pending.set(id, { type, resolve, reject, timer });
      this.iframe.contentWindow.postMessage(message, '*');
    });
  }

  envelope(type, payload, id = createNonce()) {
    return {
      v: BOTGUARD_PROTOCOL_VERSION,
      source: PARENT_SOURCE,
      target: SANDBOX_TARGET,
      id,
      nonce: this.nonce,
      type,
      payload
    };
  }

  async ensureFrame() {
    this.assertActive();
    if (this.iframe?.contentWindow) return this.frameReady;
    if (this.rebuilds > BOTGUARD_LIMITS.maxIframeRebuilds) throw protocolError('rebuild-limit', 'BotGuard sandbox rebuild limit reached.');
    this.rebuilds += 1;
    const iframe = this.document.createElement('iframe');
    iframe.src = this.sandboxUrl;
    iframe.sandbox = 'allow-scripts';
    iframe.referrerPolicy = 'no-referrer';
    iframe.hidden = true;
    this.iframe = iframe;
    this.frameReadySettled = false;
    this.frameReady = new Promise((resolve, reject) => {
      this.frameLoadReject = reject;
      const failLoad = error => {
        this.view.clearTimeout(this.frameLoadTimer);
        this.frameLoadReject = null;
        this.frameReady = null;
        this.frameReadySettled = false;
        if (this.iframe === iframe) this.destroyFrame();
        reject(error);
      };
      this.frameLoadTimer = this.view.setTimeout(() => failLoad(protocolError('timeout', 'BotGuard sandbox did not load.')), BOTGUARD_LIMITS.initTimeoutMs);
      iframe.addEventListener('load', () => {
        if (this.disposed || this.iframe !== iframe) return;
        if (this.frameReadySettled) {
          this.failAll(protocolError('navigation', 'BotGuard sandbox navigated after load.'));
          this.destroyFrame();
          return;
        }
        this.view.clearTimeout(this.frameLoadTimer);
        this.frameLoadReject = null;
        if (iframe.src !== this.sandboxUrl) {
          failLoad(protocolError('sandbox-url', 'BotGuard sandbox URL changed.'));
          return;
        }
        this.frameReadySettled = true;
        resolve();
      });
      iframe.addEventListener('error', () => failLoad(protocolError('sandbox-load', 'BotGuard sandbox failed to load.')), { once: true });
    });
    (this.document.body || this.document.documentElement).append(iframe);
    return this.frameReady;
  }

  onMessage(event) {
    if (!this.iframe?.contentWindow || event.source !== this.iframe.contentWindow) return;
    if (this.expectedOrigin && event.origin !== this.expectedOrigin) {
      this.failAll(protocolError('origin', 'Unexpected BotGuard sandbox origin.'));
      this.destroyFrame();
      return;
    }
    const pending = this.pending.get(event.data?.id);
    let message;
    try {
      message = event.data;
      validateSandboxMessage(message, pending?.type);
      if (message.source !== SANDBOX_SOURCE || message.target !== PARENT_TARGET || message.nonce !== this.nonce) throw protocolError('nonce', 'BotGuard response nonce mismatch.');
    } catch (error) {
      this.failAll(error);
      this.destroyFrame();
      return;
    }
    if (!pending) return;
    this.pending.delete(message.id);
    this.view.clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.data);
    else pending.reject(protocolError(message.error?.code || 'sandbox', message.error?.message || 'Sandbox request failed.'));
  }

  enforceRequestRate() {
    const now = Date.now();
    const cutoff = now - BOTGUARD_LIMITS.requestRateWindowMs;
    this.requestTimestamps = this.requestTimestamps.filter(timestamp => timestamp > cutoff);
    if (this.requestTimestamps.length >= BOTGUARD_LIMITS.maxRequestsPerWindow) throw protocolError('rate-limit', 'BotGuard broker request rate limit reached.');
    this.requestTimestamps.push(now);
  }

  enforceContentBindingLimit(contentBinding) {
    if (this.contentBindings.has(contentBinding)) return;
    if (this.contentBindings.size >= BOTGUARD_LIMITS.maxContentBindingsPerSession) {
      throw protocolError('binding-limit', 'BotGuard content binding session limit reached.');
    }
    this.contentBindings.add(contentBinding);
  }

  failAll(error) {
    for (const item of this.pending.values()) {
      this.view.clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }

  destroyFrame() {
    this.view.clearTimeout(this.frameLoadTimer);
    this.frameLoadReject = null;
    this.iframe?.remove?.();
    this.iframe = null;
    this.frameReady = null;
    this.frameReadySettled = false;
    this.initialized = false;
    this.initializing = false;
    if (!this.disposed && this.rebuilds > BOTGUARD_LIMITS.maxIframeRebuilds) this.dispose();
  }

  assertActive() {
    if (this.disposed) throw protocolError('disposed', 'BotGuard broker is disposed.');
  }
}

function createNonce() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw protocolError('crypto', 'Secure crypto is required for BotGuard broker nonces.');
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
