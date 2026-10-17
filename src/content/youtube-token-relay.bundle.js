(() => {
  // src/shared/youtube-page-token-protocol.js
  var PAGE_TOKEN_PROTOCOL_VERSION = 1;
  var PAGE_TOKEN_CHANNEL = "vds.youtube.page-token.v1";
  var PAGE_TOKEN_REQUEST_DIRECTION = "request";
  var PAGE_TOKEN_REPLY_DIRECTION = "reply";
  var PAGE_TOKEN_LIMITS = Object.freeze({
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
    initTimeoutMs: 15e3,
    mintTimeoutMs: 5e3,
    maxLifetimeMs: 10 * 60 * 1e3,
    maxPendingMessages: 4,
    snapshotRateWindowMs: 60 * 1e3,
    maxSnapshotsPerWindow: 2
  });
  var encoder = new TextEncoder();
  var OPERATIONS = /* @__PURE__ */ new Set(["snapshot", "mint", "dispose"]);
  function validatePageTokenRequest(value) {
    assertEnvelopeLimit(value);
    assertAllowedKeys(value, "page token request", ["version", "requestId", "nonce", "videoId", "operation", "integrity"]);
    assertEnvelope(value, "request");
    if (!OPERATIONS.has(value.operation)) throw pageTokenError("schema", "Unsupported page token operation.");
    if (value.operation === "snapshot") {
      rejectUnexpected(value.integrity, "snapshot integrity");
    } else if (value.operation === "mint") {
      validateIntegrityData(value.integrity);
    } else if (value.operation === "dispose") {
      rejectUnexpected(value.integrity, "dispose integrity");
    }
    return value;
  }
  function validatePageTokenReply(value) {
    assertEnvelopeLimit(value);
    assertAllowedKeys(value, "page token reply", ["version", "requestId", "nonce", "videoId", "operation", "botguardResponse", "poToken", "disposed", "code"]);
    assertEnvelope(value, "reply");
    if (!["snapshot", "mint", "dispose", "error"].includes(value.operation)) throw pageTokenError("schema", "Unsupported page token reply operation.");
    if (value.operation === "snapshot") {
      assertStringLimit(value.botguardResponse, "botguardResponse", PAGE_TOKEN_LIMITS.botguardResponseBytes, { nonEmpty: true });
      rejectUnexpected(value.poToken, "snapshot poToken");
      rejectUnexpected(value.disposed, "snapshot disposed");
      rejectUnexpected(value.code, "snapshot code");
    } else if (value.operation === "mint") {
      assertStringLimit(value.poToken, "poToken", PAGE_TOKEN_LIMITS.poTokenChars, { nonEmpty: true, chars: true });
      rejectUnexpected(value.botguardResponse, "mint botguardResponse");
      rejectUnexpected(value.disposed, "mint disposed");
      rejectUnexpected(value.code, "mint code");
    } else if (value.operation === "dispose") {
      if (value.disposed !== true) throw pageTokenError("schema", "Dispose reply must confirm disposal.");
      rejectUnexpected(value.botguardResponse, "dispose botguardResponse");
      rejectUnexpected(value.poToken, "dispose poToken");
      rejectUnexpected(value.code, "dispose code");
    } else {
      assertStringLimit(value.code, "error code", PAGE_TOKEN_LIMITS.statusMessageChars, { nonEmpty: true });
      if (!/^[a-z0-9-]{1,64}$/.test(value.code)) throw pageTokenError("schema", "error code must be a bounded protocol code.");
      rejectUnexpected(value.botguardResponse, "error botguardResponse");
      rejectUnexpected(value.poToken, "error poToken");
      rejectUnexpected(value.disposed, "error disposed");
    }
    return value;
  }
  function validatePageTokenMessage(value, expectedDirection) {
    assertEnvelopeLimit(value);
    assertAllowedKeys(value, "page token message", ["version", "channel", "direction", "payload"]);
    if (value.version !== PAGE_TOKEN_PROTOCOL_VERSION) throw pageTokenError("schema", "Unsupported page token message version.");
    if (value.channel !== PAGE_TOKEN_CHANNEL) throw pageTokenError("source", "Unexpected page token channel.");
    if (!["request", "reply"].includes(value.direction)) throw pageTokenError("schema", "Unsupported page token message direction.");
    if (expectedDirection && value.direction !== expectedDirection) throw pageTokenError("source", "Unexpected page token message direction.");
    const payload = value.direction === PAGE_TOKEN_REQUEST_DIRECTION ? validatePageTokenRequest(value.payload) : validatePageTokenReply(value.payload);
    return { ...value, payload };
  }
  function createPageTokenMessage(direction, payload) {
    if (direction !== PAGE_TOKEN_REQUEST_DIRECTION && direction !== PAGE_TOKEN_REPLY_DIRECTION) {
      throw pageTokenError("schema", "Unsupported page token message direction.");
    }
    const checkedPayload = direction === PAGE_TOKEN_REQUEST_DIRECTION ? validatePageTokenRequest({ ...payload }) : validatePageTokenReply({ ...payload });
    const message = {
      version: PAGE_TOKEN_PROTOCOL_VERSION,
      channel: PAGE_TOKEN_CHANNEL,
      direction,
      payload: checkedPayload
    };
    assertEnvelopeLimit(message);
    return message;
  }
  function validateIntegrityData(value) {
    assertAllowedKeys(value, "integrity", ["integrityToken", "estimatedTtlSecs", "mintRefreshThreshold"]);
    assertJsonLimit(value, "integrity", PAGE_TOKEN_LIMITS.integrityBytes);
    assertStringLimit(value.integrityToken, "integrity.integrityToken", PAGE_TOKEN_LIMITS.integrityBytes, { nonEmpty: true });
    assertFinitePositive(value.estimatedTtlSecs, "integrity.estimatedTtlSecs");
    if (value.mintRefreshThreshold !== void 0) assertFinitePositive(value.mintRefreshThreshold, "integrity.mintRefreshThreshold");
    return value;
  }
  function validateVideoId(videoId) {
    assertStringLimit(videoId, "videoId", PAGE_TOKEN_LIMITS.videoIdBytes, { nonEmpty: true });
    if (!/^[0-9A-Za-z_-]{11}$/.test(videoId)) throw pageTokenError("schema", "videoId is not a valid YouTube identifier.");
    return videoId;
  }
  function validateRequestId(requestId) {
    assertStringLimit(requestId, "requestId", PAGE_TOKEN_LIMITS.messageIdBytes, { nonEmpty: true });
    if (!/^[\x21-\x7e]+$/.test(requestId)) throw pageTokenError("schema", "requestId must be printable ASCII.");
    return requestId;
  }
  function validateNonce(nonce) {
    assertStringLimit(nonce, "nonce", PAGE_TOKEN_LIMITS.nonceBytes, { nonEmpty: true });
    if (!/^[\x21-\x7e]+$/.test(nonce)) throw pageTokenError("schema", "nonce must be printable ASCII.");
    return nonce;
  }
  function byteLength(value) {
    return encoder.encode(String(value ?? "")).byteLength;
  }
  function jsonByteLength(value) {
    return byteLength(JSON.stringify(value ?? null));
  }
  function assertPlainObject(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw pageTokenError("schema", `${name} must be an object.`);
    }
  }
  function assertAllowedKeys(value, name, allowedKeys) {
    assertPlainObject(value, name);
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw pageTokenError("schema", `${name} contains unsupported field ${key}.`);
    }
  }
  function assertStringLimit(value, name, limit, options = {}) {
    if (typeof value !== "string") throw pageTokenError("schema", `${name} must be a string.`);
    if (options.nonEmpty && !value) throw pageTokenError("schema", `${name} must not be empty.`);
    const size = options.chars ? value.length : byteLength(value);
    if (size > limit) throw pageTokenError("too-large", `${name} exceeds the allowed size.`);
  }
  function assertJsonLimit(value, name, limit) {
    if (jsonByteLength(value) > limit) throw pageTokenError("too-large", `${name} exceeds the allowed size.`);
  }
  function assertEnvelopeLimit(value) {
    if (jsonByteLength(value) > PAGE_TOKEN_LIMITS.envelopeBytes) throw pageTokenError("too-large", "Page token message exceeds the allowed size.");
  }
  function pageTokenError(code, message) {
    const error = new Error(String(message || code).slice(0, PAGE_TOKEN_LIMITS.statusMessageChars));
    error.code = code;
    return error;
  }
  function assertEnvelope(value, name) {
    if (value.version !== PAGE_TOKEN_PROTOCOL_VERSION) throw pageTokenError("schema", `Unsupported page token ${name} version.`);
    validateRequestId(value.requestId);
    validateNonce(value.nonce);
    validateVideoId(value.videoId);
  }
  function assertFinitePositive(value, name) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw pageTokenError("schema", `${name} must be a positive number.`);
    }
  }
  function rejectUnexpected(value, name) {
    if (value !== void 0) throw pageTokenError("schema", `${name} is not supported.`);
  }

  // src/content/youtube-token-relay.js
  var SERVICE_TARGET = "service";
  var RELAY_TARGET = "youtube-page-token-relay";
  var RELAY_REQUEST_TYPE = "youtube-page-token.request";
  var RELAY_REPLY_TYPE = "youtube.page-token.reply";
  var pending = /* @__PURE__ */ new Map();
  if (!globalThis.__VDS_YOUTUBE_TOKEN_RELAY__) {
    globalThis.__VDS_YOUTUBE_TOKEN_RELAY__ = true;
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    window.addEventListener("message", handlePageMessage);
    window.addEventListener("pagehide", clearAllPending, { once: true });
  }
  function handleRuntimeMessage(message, _sender, respond) {
    if (message?.target !== RELAY_TARGET || message?.type !== RELAY_REQUEST_TYPE) return false;
    if (!isTrustedServiceSender(_sender)) return false;
    void Promise.resolve().then(() => {
      const request = validateRelayMessage(message);
      if (pending.size >= PAGE_TOKEN_LIMITS.maxPendingMessages && request.operation !== "dispose") {
        throw pageTokenError("queue-full", "Page token relay queue is full.");
      }
      if (request.operation === "dispose") {
        clearMatchingPending(request);
      } else {
        setPending(request);
      }
      window.postMessage(createPageTokenMessage(PAGE_TOKEN_REQUEST_DIRECTION, request), location.origin);
      return { accepted: true };
    }).then(
      (result) => respond(result),
      (error) => respond({ accepted: false, error: { code: safeCode(error), message: safeMessage(error) } })
    );
    return true;
  }
  function setPending(request) {
    clearPending(request.requestId);
    const timer = setTimeout(() => clearPending(request.requestId), PAGE_TOKEN_LIMITS.initTimeoutMs + PAGE_TOKEN_LIMITS.mintTimeoutMs);
    timer?.unref?.();
    pending.set(request.requestId, {
      operation: request.operation,
      nonce: request.nonce,
      videoId: request.videoId,
      timer
    });
  }
  function handlePageMessage(event) {
    if (event.source !== window || event.origin !== location.origin) return;
    if (!isPageTokenReply(event.data)) return;
    let reply;
    try {
      const message = validatePageTokenMessage(event.data, PAGE_TOKEN_REPLY_DIRECTION);
      reply = message.payload;
      const entry = pending.get(reply.requestId);
      if (!entry) return;
      if (reply.nonce !== entry.nonce || reply.videoId !== entry.videoId) {
        throw pageTokenError("nonce", "Page token helper reply mismatch.");
      }
      if (reply.operation !== entry.operation && reply.operation !== "error") {
        throw pageTokenError("operation", "Page token helper operation mismatch.");
      }
      clearPending(reply.requestId);
    } catch (error) {
      const fallback = safeErrorReply(event.data, error);
      if (fallback) void chrome.runtime.sendMessage(fallback).catch(() => {
      });
      return;
    }
    void chrome.runtime.sendMessage({
      target: SERVICE_TARGET,
      type: RELAY_REPLY_TYPE,
      payload: reply
    }).catch(() => {
    });
  }
  function validateRelayMessage(message) {
    if (message.target !== RELAY_TARGET || message.type !== RELAY_REQUEST_TYPE) {
      throw pageTokenError("source", "Unexpected page token relay route.");
    }
    const payload = validatePageTokenMessage(message.payload, PAGE_TOKEN_REQUEST_DIRECTION).payload;
    if (currentVideoId() !== payload.videoId) throw pageTokenError("video", "The YouTube video changed before token minting.");
    return payload;
  }
  function safeErrorReply(value, error) {
    try {
      const reply = validatePageTokenMessage(value, PAGE_TOKEN_REPLY_DIRECTION).payload;
      const entry = pending.get(reply.requestId);
      if (!entry) return null;
      clearPending(reply.requestId);
      return {
        target: SERVICE_TARGET,
        type: RELAY_REPLY_TYPE,
        payload: {
          version: reply.version,
          requestId: reply.requestId,
          nonce: reply.nonce,
          videoId: reply.videoId,
          operation: "error",
          code: protocolErrorCode(error)
        }
      };
    } catch {
      return null;
    }
  }
  function currentVideoId() {
    try {
      const url = new URL(location.href);
      if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
      if (url.hostname !== "youtube.com" && !url.hostname.endsWith(".youtube.com")) return "";
      const id = url.pathname === "/watch" ? url.searchParams.get("v") : /^\/(shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[2];
      return /^[0-9A-Za-z_-]{11}$/.test(id || "") ? id : "";
    } catch {
      return "";
    }
  }
  function isPageTokenReply(value) {
    return value?.direction === PAGE_TOKEN_REPLY_DIRECTION;
  }
  function isTrustedServiceSender(sender) {
    if (!sender || sender.id !== chrome.runtime.id) return false;
    if (sender.tab) return false;
    return sender.url === chrome.runtime.getURL("src/background/service.js");
  }
  function clearPending(requestId) {
    const entry = pending.get(requestId);
    if (entry) clearTimeout(entry.timer);
    pending.delete(requestId);
  }
  function clearMatchingPending(request) {
    for (const [requestId, entry] of pending) {
      if (entry.nonce === request.nonce && entry.videoId === request.videoId) clearPending(requestId);
    }
  }
  function clearAllPending() {
    for (const requestId of [...pending.keys()]) clearPending(requestId);
  }
  function safeCode(error) {
    const code = String(error?.code || "");
    return /^[a-z0-9-]{1,64}$/.test(code) ? code : "relay";
  }
  function protocolErrorCode(error) {
    const code = safeCode(error);
    return ["schema", "source", "too-large", "nonce", "operation", "video", "queue-full"].includes(code) ? code : "relay";
  }
  function safeMessage(error) {
    return String(error?.message || "Page token relay failed.").slice(0, PAGE_TOKEN_LIMITS.statusMessageChars);
  }
})();
