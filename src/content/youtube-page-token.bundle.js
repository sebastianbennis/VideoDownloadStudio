(() => {
  // node_modules/bgutils-js/dist/utils/helpers.js
  var base64urlCharRegex = /[-_.]/g;
  var base64urlToBase64Map = {
    "-": "+",
    _: "/",
    ".": "="
  };
  var DeferredPromise = class {
    promise;
    resolve;
    reject;
    constructor() {
      this.promise = new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      });
    }
  };
  var BgError = class extends TypeError {
    info;
    constructor(message, info) {
      super(message);
      this.name = "BgError";
      if (info)
        this.info = info;
    }
  };
  function base64ToU8(base64) {
    let base64Mod;
    if (base64urlCharRegex.test(base64)) {
      base64Mod = base64.replace(base64urlCharRegex, function(match) {
        return base64urlToBase64Map[match];
      });
    } else {
      base64Mod = base64;
    }
    base64Mod = atob(base64Mod);
    return new Uint8Array([...base64Mod].map((char) => char.charCodeAt(0)));
  }
  function u8ToBase64(u8, base64url = false) {
    const result = btoa(String.fromCharCode(...u8));
    if (base64url) {
      return result.replace(/\+/g, "-").replace(/\//g, "_");
    }
    return result;
  }

  // node_modules/bgutils-js/dist/utils/EventEmitterLike.js
  var EventEmitterLike = class {
    #listeners = /* @__PURE__ */ new Map();
    #onceWrappers = /* @__PURE__ */ new Map();
    emit(type, ...args) {
      const listeners = this.#listeners.get(type);
      if (!listeners || listeners.size === 0)
        return;
      for (const listener of [...listeners]) {
        listener(...args);
      }
    }
    on(type, listener) {
      let listeners = this.#listeners.get(type);
      if (!listeners) {
        listeners = /* @__PURE__ */ new Set();
        this.#listeners.set(type, listeners);
      }
      listeners.add(listener);
    }
    once(type, listener) {
      const wrapper = (...args) => {
        this.off(type, listener);
        listener(...args);
      };
      let wrappersByType = this.#onceWrappers.get(listener);
      if (!wrappersByType) {
        wrappersByType = /* @__PURE__ */ new Map();
        this.#onceWrappers.set(listener, wrappersByType);
      }
      wrappersByType.set(type, wrapper);
      this.on(type, wrapper);
    }
    off(type, listener) {
      const listeners = this.#listeners.get(type);
      if (!listeners)
        return;
      let target = listener;
      const wrappersByType = this.#onceWrappers.get(listener);
      if (wrappersByType) {
        const onceWrapper = wrappersByType.get(type);
        if (onceWrapper) {
          target = onceWrapper;
          wrappersByType.delete(type);
          if (wrappersByType.size === 0)
            this.#onceWrappers.delete(listener);
        }
      }
      listeners.delete(target);
      if (listeners.size === 0)
        this.#listeners.delete(type);
    }
    removeAllListeners(type) {
      if (!type) {
        this.#listeners.clear();
        this.#onceWrappers.clear();
        return;
      }
      this.#listeners.delete(type);
      for (const [listener, wrappersByType] of this.#onceWrappers.entries()) {
        wrappersByType.delete(type);
        if (wrappersByType.size === 0)
          this.#onceWrappers.delete(listener);
      }
    }
  };

  // node_modules/bgutils-js/dist/core/BotGuardClient.js
  var BotGuardClient = class _BotGuardClient extends EventEmitterLike {
    vm;
    program;
    userInteractionElement;
    syncSnapshotFunction;
    deferredVmFunctions = new DeferredPromise();
    defaultTimeout = 3e3;
    on(type, listener) {
      super.on(type, listener);
    }
    off(type, listener) {
      super.off(type, listener);
    }
    constructor(options) {
      super();
      if (!options.globalObject || !options.globalName || !options.program) {
        throw new BgError("Invalid options", { options });
      }
      this.userInteractionElement = options.userInteractionElement;
      this.vm = options.globalObject[options.globalName];
      this.program = options.program;
    }
    /**
     * Factory method to create and load a BotGuardClient instance.
     * @param options - Configuration options for the BotGuardClient.
     * @returns A loaded BotGuardClient instance.
     */
    static async create(options) {
      return await new _BotGuardClient(options).load();
    }
    async load() {
      if (!this.vm)
        throw new BgError("EGOU: BotGuard unavailable");
      if (!this.vm.a)
        throw new BgError("ELIU: BotGuard initialization function unavailable");
      const vmSetupCallback = (asyncSnapshotFunction, shutdownFunction, passEventFunction, checkCameraFunction) => {
        this.deferredVmFunctions.resolve({
          asyncSnapshotFunction,
          shutdownFunction,
          passEventFunction,
          checkCameraFunction
        });
      };
      const logEvent = (event, elapsedTime) => {
        this.emit("record-bg-event", { event, elapsedTime });
      };
      const incrementClientErrorCount = (errorCode) => {
        this.emit("increment-client-error-count", { errorCode });
      };
      const recordPayloadSize = (payloadSize) => {
        this.emit("record-payload-size", { payloadSize });
      };
      const recordLatency = (latency, et) => {
        this.emit("record-latency", { latency, et });
      };
      const incrementEventCount = (event) => {
        this.emit("increment-bg-event-count", { event });
      };
      const loggerFunctions = [
        logEvent,
        incrementClientErrorCount,
        recordPayloadSize,
        recordLatency,
        incrementEventCount
      ];
      const vmTelemetryCallback = (latency, eventFlag1, eventFlag2) => {
        let event = "k";
        if (eventFlag1) {
          event = "h";
        } else if (eventFlag2) {
          event = "u";
        }
        incrementEventCount(event);
        logEvent(event, latency);
      };
      try {
        this.syncSnapshotFunction = await this.vm.a(this.program, vmSetupCallback, true, this.userInteractionElement, vmTelemetryCallback, [[], []], void 0, false, loggerFunctions)?.[0];
      } catch (error) {
        throw new BgError("Could not load program", { error });
      }
      return this;
    }
    /**
     * Calls a VM function with a timeout.
     * @param vmFunctionName - The name of the VM function to execute.
     * @param timeout - The timeout in milliseconds.
     * @param args - The arguments to pass to the VM function.
     */
    async execute(vmFunctionName, timeout, ...args) {
      return await Promise.race([
        (async () => {
          const vmFunctions = await this.deferredVmFunctions.promise;
          const vmFunction = vmFunctions[vmFunctionName];
          if (!vmFunction)
            throw new BgError(`${vmFunctionName} function not found`);
          return vmFunction(...args);
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new BgError("VM operation timed out")), timeout))
      ]);
    }
    /**
     * Takes a snapshot asynchronously.
     * @returns The snapshot result.
     * @example
     * ```ts
     * const result = await botguard.snapshot({
     *   contentBinding: {
     *     c: "a=6&a2=10&b=SZWDwKVIuixOp7Y4euGTgwckbJA&c=1729143849&d=1&t=7200&c1a=1&c6a=1&c6b=1&hh=HrMb5mRWTyxGJphDr0nW2Oxonh0_wl2BDqWuLHyeKLo",
     *     e: "ENGAGEMENT_TYPE_VIDEO_LIKE",
     *     encryptedVideoId: "P-vC09ZJcnM"
     *    }
     * });
     *
     * console.log(result);
     * ```
     */
    async snapshot(args, timeout = this.defaultTimeout) {
      return await new Promise(async (resolve, reject) => {
        await this.execute("asyncSnapshotFunction", timeout, (response) => resolve(response), [
          args.contentBinding,
          args.signedTimestamp,
          args.webPoSignalOutput,
          args.skipPrivacyBuffer
        ]).catch(reject);
      });
    }
    /**
     * Passes an event to the VM.
     */
    async passEvent(args, timeout = this.defaultTimeout) {
      return this.execute("passEventFunction", timeout, args);
    }
    /**
     * Checks the "camera".
     */
    async checkCamera(args, timeout = this.defaultTimeout) {
      return this.execute("checkCameraFunction", timeout, args);
    }
    /**
     * Shuts down the VM. Once called, the VM is no longer usable.
     */
    async shutdown(timeout = this.defaultTimeout) {
      return this.execute("shutdownFunction", timeout);
    }
    /**
     * Takes a snapshot synchronously.
     * @returns The snapshot result.
     */
    async snapshotSynchronous(args) {
      if (!this.syncSnapshotFunction)
        throw new BgError("Synchronous snapshot function not found");
      return this.syncSnapshotFunction([
        args.contentBinding,
        args.signedTimestamp,
        args.webPoSignalOutput,
        args.skipPrivacyBuffer
      ]);
    }
  };

  // node_modules/bgutils-js/dist/core/WebPoMinter.js
  var WebPoMinter = class _WebPoMinter {
    mintCallback;
    constructor(mintCallback) {
      this.mintCallback = mintCallback;
    }
    /**
     * Factory method to create a WebPoMinter instance.
     * @param integrityTokenResponse - The integrity token response object.
     * @param webPoSignalOutput - The output array containing the minter function.
     */
    static async create(integrityTokenResponse, webPoSignalOutput) {
      const getMinter = webPoSignalOutput[0];
      if (!getMinter)
        throw new BgError("PMD:Undefined");
      if (!integrityTokenResponse.integrityToken)
        throw new BgError("No integrity token provided", { integrityTokenResponse });
      const mintCallback = await getMinter(base64ToU8(integrityTokenResponse.integrityToken));
      if (!(mintCallback instanceof Function))
        throw new BgError("APF:Failed");
      return new _WebPoMinter(mintCallback);
    }
    /**
     * Mints a proof and returns it as a web-safe base64 string.
     * @param contentBinding - A Visitor ID, Video ID, or Data Sync ID.
     */
    async mintAsWebsafeString(contentBinding) {
      return u8ToBase64(await this.mint(contentBinding), true);
    }
    /**
     * Mints a proof and returns it as a Uint8Array.
     * @param contentBinding - A Visitor ID, Video ID, or Data Sync ID.
     */
    async mint(contentBinding) {
      const result = await this.mintCallback(new TextEncoder().encode(contentBinding));
      if (!result)
        throw new BgError("YNJ:Undefined");
      if (!(result instanceof Uint8Array))
        throw new BgError("ODM:Invalid");
      return result;
    }
  };

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
  function validatePageChallenge(value) {
    assertAllowedKeys(value, "page challenge", ["globalName", "program"]);
    assertStringLimit(value.globalName, "globalName", PAGE_TOKEN_LIMITS.globalNameBytes, { nonEmpty: true });
    if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(value.globalName)) throw pageTokenError("schema", "globalName must be a JavaScript identifier.");
    assertStringLimit(value.program, "program", PAGE_TOKEN_LIMITS.programBytes, { nonEmpty: true });
    return value;
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

  // src/content/youtube-page-token.js
  var STATE_KEY = "__VDS_YOUTUBE_PAGE_TOKEN_HELPER_V1__";
  var SAFE_ERROR_CODES = /* @__PURE__ */ new Set(["schema", "source", "too-large", "challenge-missing", "interpreter-missing", "state", "timeout", "botguard", "frame", "video-mismatch"]);
  var dependencies = {
    BotGuardClient,
    WebPoMinter
  };
  function installYoutubePageTokenHelper(root = globalThis) {
    if (!root?.addEventListener || !root?.postMessage || !root?.document) return;
    const state = getState(root);
    if (state.installed) return;
    state.installed = true;
    root.addEventListener("message", (event) => {
      void handlePageTokenMessage(event, root).catch((error) => {
        const request = safeRequest(event?.data);
        if (request) postReply(root, errorReply(request, error));
      });
    });
    for (const eventName of ["pagehide", "beforeunload", "popstate", "hashchange", "yt-navigate-start"]) {
      root.addEventListener(eventName, () => {
        void disposeSession(root);
      });
    }
  }
  async function handlePageTokenMessage(event, root = globalThis) {
    if (event.source !== root) return;
    if (event.origin !== root.location?.origin) return;
    const message = validatePageTokenMessage(event.data, PAGE_TOKEN_REQUEST_DIRECTION);
    const request = validatePageTokenRequest(message.payload);
    if (request.operation === "snapshot") {
      assertMatchingVideoFrame(root, request.videoId);
      const reply = await snapshot(request, root);
      postReply(root, reply);
      return;
    }
    if (request.operation === "mint") {
      assertMatchingVideoFrame(root, request.videoId);
      const reply = await mint(request, root);
      postReply(root, reply);
      return;
    }
    if (request.operation === "dispose") {
      await disposeSession(root);
      postReply(root, {
        version: PAGE_TOKEN_PROTOCOL_VERSION,
        requestId: request.requestId,
        nonce: request.nonce,
        videoId: request.videoId,
        operation: "dispose",
        disposed: true
      });
    }
  }
  function setYoutubePageTokenTestDependencies(nextDependencies = {}) {
    dependencies = {
      BotGuardClient: nextDependencies.BotGuardClient || BotGuardClient,
      WebPoMinter: nextDependencies.WebPoMinter || WebPoMinter
    };
  }
  function readExistingPageChallenge(documentObject = globalThis.document) {
    if (!documentObject?.scripts) throw pageTokenError("challenge-missing", "Document scripts are unavailable.");
    let scannedBytes = 0;
    for (const script of Array.from(documentObject.scripts)) {
      const source = String(script?.textContent || "");
      scannedBytes += byteLength2(source);
      if (scannedBytes > PAGE_TOKEN_LIMITS.inlineScanBytes) throw pageTokenError("too-large", "YouTube inline challenge scan exceeded the allowed size.");
      const challenge = parseYtAtnChallenge(source);
      if (challenge) return validatePageChallenge(challenge);
    }
    throw pageTokenError("challenge-missing", "YouTube page challenge was not found.");
  }
  function parseYtAtnChallenge(source) {
    const marker = "window.ytAtN({'R':";
    let searchStart = 0;
    while (searchStart < source.length) {
      const markerIndex = source.indexOf(marker, searchStart);
      if (markerIndex === -1) return null;
      const quoteIndex = findNextSingleQuote(source, markerIndex + marker.length);
      if (quoteIndex === -1) return null;
      const raw = readSingleQuotedJavascriptString(source, quoteIndex);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw.value);
        if (parsed?.bgChallenge) {
          return {
            globalName: parsed.bgChallenge.globalName,
            program: parsed.bgChallenge.program
          };
        }
      } catch {
      }
      searchStart = raw.end + 1;
    }
    return null;
  }
  function readSingleQuotedJavascriptString(source, quoteIndex) {
    if (source[quoteIndex] !== "'") throw pageTokenError("schema", "Expected single quoted JavaScript string.");
    let value = "";
    for (let index = quoteIndex + 1; index < source.length; index += 1) {
      const char = source[index];
      if (char === "'") return { value, end: index };
      if (char !== "\\") {
        value += char;
        continue;
      }
      index += 1;
      if (index >= source.length) throw pageTokenError("schema", "Unterminated JavaScript string escape.");
      value += decodeJavascriptEscape(source, index);
      const escape = source[index];
      if (escape === "x") index += 2;
      if (escape === "u") index += 4;
    }
    throw pageTokenError("schema", "Unterminated JavaScript string.");
  }
  function decodeJavascriptEscape(source, index) {
    const escape = source[index];
    if (escape === "x") {
      const value = source.slice(index + 1, index + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(value)) throw pageTokenError("schema", "Invalid hex JavaScript escape.");
      return String.fromCharCode(Number.parseInt(value, 16));
    }
    if (escape === "u") {
      const value = source.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(value)) throw pageTokenError("schema", "Invalid unicode JavaScript escape.");
      return String.fromCharCode(Number.parseInt(value, 16));
    }
    if (escape === "b") return "\b";
    if (escape === "f") return "\f";
    if (escape === "n") return "\n";
    if (escape === "r") return "\r";
    if (escape === "t") return "	";
    if (escape === "v") return "\v";
    if (escape === "0") return "\0";
    return escape;
  }
  async function snapshot(request, root) {
    const state = getState(root);
    await disposeSession(root);
    const generation = state.generation;
    const challenge = readExistingPageChallenge(root.document);
    if (typeof root[challenge.globalName]?.a !== "function") {
      throw pageTokenError("interpreter-missing", "Existing YouTube interpreter is unavailable.");
    }
    const webPoSignalOutput = [];
    let botguardClient;
    let botguardResponse;
    const deadline = Date.now() + PAGE_TOKEN_LIMITS.initTimeoutMs;
    try {
      botguardClient = await withDeadline(
        dependencies.BotGuardClient.create({
          globalObject: root,
          globalName: challenge.globalName,
          program: challenge.program
        }),
        deadline,
        "BotGuard initialization timed out."
      );
      botguardResponse = await withDeadline(
        botguardClient.snapshot({ webPoSignalOutput }, PAGE_TOKEN_LIMITS.initTimeoutMs),
        deadline,
        "BotGuard snapshot timed out."
      );
    } catch (error) {
      await safeShutdown(botguardClient);
      throw sanitizeBotguardError(error, "BotGuard snapshot failed.");
    }
    if (state.generation !== generation) {
      await safeShutdown(botguardClient);
      throw pageTokenError("state", "Page token session was disposed before snapshot completed.");
    }
    state.session = {
      active: true,
      videoId: request.videoId,
      nonce: request.nonce,
      botguardClient,
      webPoSignalOutput,
      expiresAt: Date.now() + PAGE_TOKEN_LIMITS.maxLifetimeMs
    };
    return {
      version: PAGE_TOKEN_PROTOCOL_VERSION,
      requestId: request.requestId,
      nonce: request.nonce,
      videoId: request.videoId,
      operation: "snapshot",
      botguardResponse
    };
  }
  async function mint(request, root = globalThis) {
    const { session } = getState(root);
    if (!session.active) throw pageTokenError("state", "Page token session is not initialized.");
    if (session.videoId !== request.videoId || session.nonce !== request.nonce) throw pageTokenError("state", "Page token session does not match request.");
    if (Date.now() > session.expiresAt) {
      await disposeSession(root);
      throw pageTokenError("state", "Page token session expired.");
    }
    const integrity = validateIntegrityData(request.integrity);
    session.expiresAt = Math.min(session.expiresAt, Date.now() + Math.min(integrity.estimatedTtlSecs * 1e3, PAGE_TOKEN_LIMITS.maxLifetimeMs));
    let poToken;
    try {
      const minter = await withTimeout(
        dependencies.WebPoMinter.create(integrity, session.webPoSignalOutput),
        PAGE_TOKEN_LIMITS.mintTimeoutMs,
        "WebPO minter initialization timed out."
      );
      poToken = await withTimeout(
        minter.mintAsWebsafeString(request.videoId),
        PAGE_TOKEN_LIMITS.mintTimeoutMs,
        "WebPO token mint timed out."
      );
    } catch (error) {
      throw sanitizeBotguardError(error, "WebPO token mint failed.");
    }
    return {
      version: PAGE_TOKEN_PROTOCOL_VERSION,
      requestId: request.requestId,
      nonce: request.nonce,
      videoId: request.videoId,
      operation: "mint",
      poToken
    };
  }
  async function disposeSession(root = globalThis) {
    const state = getState(root);
    state.generation += 1;
    const current = state.session;
    state.session = emptySession();
    if (current.botguardClient) await safeShutdown(current.botguardClient);
  }
  function postReply(root, payload) {
    root.postMessage(createPageTokenMessage(PAGE_TOKEN_REPLY_DIRECTION, payload), root.location?.origin || "*");
  }
  function errorReply(request, error) {
    return {
      version: PAGE_TOKEN_PROTOCOL_VERSION,
      requestId: request.requestId,
      nonce: request.nonce,
      videoId: request.videoId,
      operation: "error",
      code: safeErrorCode(error)
    };
  }
  function safeRequest(message) {
    try {
      return validatePageTokenMessage(message, PAGE_TOKEN_REQUEST_DIRECTION).payload;
    } catch {
      return null;
    }
  }
  async function safeShutdown(client) {
    try {
      await client?.shutdown?.(PAGE_TOKEN_LIMITS.mintTimeoutMs);
    } catch {
    }
  }
  function sanitizeBotguardError(error, fallback) {
    if (error?.code === "too-large") return error;
    if (error?.code === "timeout") return error;
    return pageTokenError("botguard", fallback);
  }
  function safeErrorCode(error) {
    const code = String(error?.code || "");
    if (SAFE_ERROR_CODES.has(code)) return code;
    return "page-token";
  }
  function withTimeout(promise, timeoutMs, message) {
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(pageTokenError("timeout", message)), timeoutMs);
      })
    ]).finally(() => clearTimeout(timer));
  }
  function withDeadline(promise, deadline, message) {
    return withTimeout(promise, Math.max(0, deadline - Date.now()), message);
  }
  function assertMatchingVideoFrame(root, requestedVideoId) {
    const actualVideoId = readCurrentYouTubeVideoId(root);
    if (actualVideoId !== requestedVideoId) throw pageTokenError("video-mismatch", "Requested video does not match the current YouTube page.");
  }
  function readCurrentYouTubeVideoId(root = globalThis) {
    let url;
    try {
      url = new URL(String(root.location?.href || ""));
    } catch {
      throw pageTokenError("video-mismatch", "Current page URL is not a valid YouTube URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) throw pageTokenError("video-mismatch", "Current page is not a secure YouTube URL.");
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be") return validateVideoIdFromPath(url.pathname);
    if (host !== "youtube.com" && !host.endsWith(".youtube.com")) throw pageTokenError("video-mismatch", "Current page is not YouTube.");
    if (url.pathname === "/watch") {
      const videoId = url.searchParams.get("v") || "";
      if (/^[0-9A-Za-z_-]{11}$/.test(videoId)) return videoId;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (["shorts", "embed", "live"].includes(parts[0])) return validateVideoIdFromPath(`/${parts[1] || ""}`);
    throw pageTokenError("video-mismatch", "Current YouTube page does not expose a video id.");
  }
  function validateVideoIdFromPath(pathname) {
    const videoId = String(pathname || "").split("/").filter(Boolean)[0] || "";
    if (!/^[0-9A-Za-z_-]{11}$/.test(videoId)) throw pageTokenError("video-mismatch", "Current YouTube path does not expose a valid video id.");
    return videoId;
  }
  function getState(root) {
    if (!root[STATE_KEY]) {
      Object.defineProperty(root, STATE_KEY, {
        value: {
          installed: false,
          generation: 0,
          session: emptySession()
        },
        configurable: false,
        enumerable: false,
        writable: false
      });
    }
    return root[STATE_KEY];
  }
  function findNextSingleQuote(source, start) {
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === "'") return index;
    }
    return -1;
  }
  function emptySession() {
    return {
      active: false,
      videoId: "",
      nonce: "",
      botguardClient: null,
      webPoSignalOutput: null,
      expiresAt: 0
    };
  }
  function byteLength2(value) {
    return new TextEncoder().encode(String(value ?? "")).byteLength;
  }
  installYoutubePageTokenHelper();
})();
