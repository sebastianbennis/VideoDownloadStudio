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
    static async create(integrityTokenResponse, webPoSignalOutput2) {
      const getMinter = webPoSignalOutput2[0];
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

  // src/sandbox/lockdown.js
  var RTC_GLOBAL_NAMES = Object.freeze([
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection",
    "RTCDataChannel",
    "RTCDataChannelEvent",
    "RTCDtlsTransport",
    "RTCIceCandidate",
    "RTCIceTransport",
    "RTCIceGatherer",
    "RTCIceServer",
    "RTCRtpReceiver",
    "RTCRtpSender",
    "RTCRtpTransceiver",
    "RTCSctpTransport",
    "RTCSessionDescription",
    "RTCStatsReport",
    "MediaStreamTrackProcessor",
    "MediaStreamTrackGenerator"
  ]);
  var lockedGlobals = /* @__PURE__ */ new WeakSet();
  function lockdownRealtimeGlobals(globalObject = globalThis) {
    assertObject(globalObject, "global object");
    if (lockedGlobals.has(globalObject)) return;
    const aliases = discoverRealtimeGlobalNames(globalObject);
    for (const name of aliases) lockGlobalName(globalObject, name);
    for (const name of aliases) assertLocked(globalObject, name);
    lockedGlobals.add(globalObject);
  }
  function discoverRealtimeGlobalNames(globalObject = globalThis) {
    assertObject(globalObject, "global object");
    const names = new Set(RTC_GLOBAL_NAMES);
    const constructors = /* @__PURE__ */ new Set();
    for (const name of RTC_GLOBAL_NAMES) {
      const value = globalObject[name];
      if (typeof value === "function") constructors.add(value);
    }
    for (const name of Reflect.ownKeys(globalObject)) {
      if (typeof name !== "string") continue;
      if (isRealtimeName(name)) names.add(name);
      const descriptor = Reflect.getOwnPropertyDescriptor(globalObject, name);
      if (!descriptor) continue;
      if ("value" in descriptor && constructors.has(descriptor.value)) names.add(name);
    }
    for (const constructor of constructors) collectConstructorAliases(globalObject, constructor, names);
    return [...names].sort();
  }
  function collectConstructorAliases(globalObject, constructor, names) {
    const prototype = constructor?.prototype;
    if (!prototype) return;
    const prototypeConstructor = Reflect.getOwnPropertyDescriptor(prototype, "constructor")?.value;
    if (prototypeConstructor && prototypeConstructor !== constructor) {
      for (const name of Reflect.ownKeys(globalObject)) {
        if (typeof name !== "string") continue;
        const descriptor = Reflect.getOwnPropertyDescriptor(globalObject, name);
        if (descriptor && "value" in descriptor && descriptor.value === prototypeConstructor) names.add(name);
      }
    }
  }
  function lockGlobalName(globalObject, name) {
    const descriptor = Reflect.getOwnPropertyDescriptor(globalObject, name);
    if (descriptor && descriptor.configurable === false) {
      if (!("value" in descriptor) || descriptor.value !== void 0 || descriptor.writable !== false) {
        throw lockdownError(`Cannot lock non-configurable realtime global ${name}.`);
      }
      return;
    }
    if (!Reflect.defineProperty(globalObject, name, {
      value: void 0,
      writable: false,
      enumerable: false,
      configurable: false
    })) {
      throw lockdownError(`Failed to lock realtime global ${name}.`);
    }
  }
  function assertLocked(globalObject, name) {
    const descriptor = Reflect.getOwnPropertyDescriptor(globalObject, name);
    if (!descriptor || !("value" in descriptor) || descriptor.value !== void 0 || descriptor.writable !== false || descriptor.configurable !== false) {
      throw lockdownError(`Realtime global ${name} is not locked.`);
    }
  }
  function isRealtimeName(name) {
    return /^(?:webkit|moz)?RTC/.test(name) || name.includes("RTCPeerConnection") || name.includes("RTCDataChannel");
  }
  function assertObject(value, name) {
    if (!value || typeof value !== "object") throw lockdownError(`${name} must be an object.`);
  }
  function lockdownError(message) {
    const error = new Error(message);
    error.code = "lockdown";
    return error;
  }

  // src/shared/botguard-protocol.js
  var BOTGUARD_PROTOCOL_VERSION = 1;
  var PARENT_SOURCE = "vds.botguard.parent";
  var SANDBOX_SOURCE = "vds.botguard.sandbox";
  var SANDBOX_TARGET = "vds.botguard.sandbox";
  var PARENT_TARGET = "vds.botguard.parent";
  var FAKE_INTERPRETER_JAVASCRIPT = "vds.fake.botguard.interpreter.v1";
  var FAKE_INTERPRETER_PROGRAM = "vds.fake.botguard.program.v1";
  var BOTGUARD_LIMITS = Object.freeze({
    envelopeBytes: 5 * 1024 * 1024,
    interpreterJavascriptBytes: 4 * 1024 * 1024,
    interpreterProgramBytes: 1 * 1024 * 1024,
    challengeMetadataBytes: 256 * 1024,
    integrityTokenBytes: 64 * 1024,
    responseBytes: 128 * 1024,
    contentBindingBytes: 128,
    poTokenChars: 512,
    statusMessageChars: 2048,
    initTimeoutMs: 15e3,
    mintTimeoutMs: 5e3,
    maxQueuedMintRequests: 8,
    requestRateWindowMs: 60 * 1e3,
    maxRequestsPerWindow: 120,
    maxContentBindingsPerSession: 20,
    maxLifetimeMs: 10 * 60 * 1e3,
    maxIframeRebuilds: 1
  });
  var encoder = new TextEncoder();
  function byteLength(value) {
    return encoder.encode(String(value || "")).byteLength;
  }
  function jsonByteLength(value) {
    return byteLength(JSON.stringify(value ?? null));
  }
  function assertPlainObject(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw protocolError("schema", `${name} must be an object.`);
  }
  function assertAllowedKeys(value, name, allowedKeys) {
    assertPlainObject(value, name);
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw protocolError("schema", `${name} contains unsupported field ${key}.`);
    }
  }
  function assertStringLimit(value, name, limit) {
    if (typeof value !== "string") throw protocolError("schema", `${name} must be a string.`);
    if (byteLength(value) > limit) throw protocolError("too-large", `${name} exceeds the allowed size.`);
  }
  function assertJsonLimit(value, name, limit) {
    if (jsonByteLength(value) > limit) throw protocolError("too-large", `${name} exceeds the allowed size.`);
  }
  function assertEnvelopeLimit(message) {
    if (jsonByteLength(message) > BOTGUARD_LIMITS.envelopeBytes) throw protocolError("too-large", "Broker message exceeds the allowed envelope size.");
  }
  function assertInitPayload(payload) {
    assertAllowedKeys(payload, "init payload", ["interpreterJavascript", "interpreterProgram", "challengeMetadata", "integrityToken"]);
    assertStringLimit(payload.interpreterJavascript, "interpreterJavascript", BOTGUARD_LIMITS.interpreterJavascriptBytes);
    assertStringLimit(payload.interpreterProgram, "interpreterProgram", BOTGUARD_LIMITS.interpreterProgramBytes);
    assertChallengeMetadata(payload.challengeMetadata || {});
    if (payload.integrityToken !== void 0) assertIntegrityToken(payload.integrityToken);
  }
  function assertMintPayload(payload) {
    assertAllowedKeys(payload, "mint payload", ["contentBinding", "integrityToken"]);
    assertStringLimit(payload.contentBinding, "contentBinding", BOTGUARD_LIMITS.contentBindingBytes);
    if (payload.integrityToken !== void 0) assertIntegrityToken(payload.integrityToken);
  }
  function assertChallengeMetadata(metadata) {
    assertAllowedKeys(metadata, "challengeMetadata", ["globalName", "contentBinding", "signedTimestamp", "skipPrivacyBuffer", "youtubeConfig"]);
    assertJsonLimit(metadata, "challengeMetadata", BOTGUARD_LIMITS.challengeMetadataBytes);
    if (metadata.youtubeConfig !== void 0) assertYoutubeConfig(metadata.youtubeConfig);
    if (metadata.globalName !== void 0) {
      assertStringLimit(metadata.globalName, "globalName", 128);
      if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(metadata.globalName)) throw protocolError("schema", "globalName must be a JavaScript identifier.");
    }
    if (metadata.contentBinding !== void 0) assertContentBindingMetadata(metadata.contentBinding);
    if (metadata.signedTimestamp !== void 0 && typeof metadata.signedTimestamp !== "string" && typeof metadata.signedTimestamp !== "number") throw protocolError("schema", "signedTimestamp must be a string or number.");
    if (metadata.skipPrivacyBuffer !== void 0 && typeof metadata.skipPrivacyBuffer !== "boolean") throw protocolError("schema", "skipPrivacyBuffer must be a boolean.");
  }
  function assertYoutubeConfig(youtubeConfig) {
    assertAllowedKeys(youtubeConfig, "youtubeConfig", ["EVENT_ID"]);
    assertStringLimit(youtubeConfig.EVENT_ID, "youtubeConfig.EVENT_ID", 4096);
  }
  function assertContentBindingMetadata(contentBinding) {
    assertAllowedKeys(contentBinding, "contentBinding metadata", ["c", "e", "encryptedVideoId", "externalChannelId", "commentId", "atr_challenge"]);
    assertJsonLimit(contentBinding, "contentBinding metadata", BOTGUARD_LIMITS.challengeMetadataBytes);
    for (const [key, value] of Object.entries(contentBinding)) assertStringLimit(value, `contentBinding.${key}`, BOTGUARD_LIMITS.contentBindingBytes);
  }
  function assertIntegrityToken(integrityToken) {
    assertAllowedKeys(integrityToken, "integrityToken", ["integrityToken", "estimatedTtlSecs", "mintRefreshThreshold", "websafeFallbackToken"]);
    assertJsonLimit(integrityToken, "integrityToken", BOTGUARD_LIMITS.integrityTokenBytes);
    if (integrityToken.integrityToken !== void 0) assertStringLimit(integrityToken.integrityToken, "integrityToken.integrityToken", BOTGUARD_LIMITS.integrityTokenBytes);
    if (integrityToken.websafeFallbackToken !== void 0) assertStringLimit(integrityToken.websafeFallbackToken, "integrityToken.websafeFallbackToken", BOTGUARD_LIMITS.poTokenChars);
    if (integrityToken.estimatedTtlSecs !== void 0 && typeof integrityToken.estimatedTtlSecs !== "number") throw protocolError("schema", "estimatedTtlSecs must be a number.");
    if (integrityToken.mintRefreshThreshold !== void 0 && typeof integrityToken.mintRefreshThreshold !== "number") throw protocolError("schema", "mintRefreshThreshold must be a number.");
  }
  function validateParentMessage(message) {
    assertAllowedKeys(message, "message", ["v", "source", "target", "id", "nonce", "type", "payload"]);
    assertEnvelopeLimit(message);
    if (message.v !== BOTGUARD_PROTOCOL_VERSION) throw protocolError("schema", "Unsupported broker protocol version.");
    if (message.source !== PARENT_SOURCE || message.target !== SANDBOX_TARGET) throw protocolError("source", "Unexpected broker message source.");
    if (typeof message.id !== "string" || !message.id) throw protocolError("schema", "Missing broker message id.");
    if (typeof message.nonce !== "string" || !message.nonce) throw protocolError("schema", "Missing broker nonce.");
    if (!["init", "mint", "dispose"].includes(message.type)) throw protocolError("schema", "Unsupported broker message type.");
    if (message.type === "init") assertInitPayload(message.payload);
    if (message.type === "mint") assertMintPayload(message.payload);
    if (message.type === "dispose") assertAllowedKeys(message.payload, "dispose payload", []);
  }
  function protocolError(code, message) {
    const error = new Error(String(message || code).slice(0, BOTGUARD_LIMITS.statusMessageChars));
    error.code = code;
    return error;
  }

  // src/sandbox/botguard.js
  var activeNonce = "";
  var initialized = false;
  var initTime = 0;
  var interpreterMode = "";
  var botguardClient = null;
  var webPoSignalOutput = null;
  lockdownRealtimeGlobals();
  addEventListener("message", (event) => {
    void handleMessage(event).catch((error) => reply(event.data, false, void 0, error));
  });
  async function handleMessage(event) {
    if (event.source !== parent) throw protocolError("source", "Unexpected parent window.");
    const message = event.data;
    validateParentMessage(message);
    if (message.source !== PARENT_SOURCE || message.target !== SANDBOX_TARGET) throw protocolError("source", "Unexpected parent message.");
    if (activeNonce && message.nonce !== activeNonce) throw protocolError("nonce", "Broker nonce mismatch.");
    if (message.type === "init") {
      activeNonce = message.nonce;
      assertInitPayload(message.payload);
      const data = await initializeInterpreter(message.payload);
      reply(message, true, data);
      return;
    }
    if (message.type === "mint") {
      if (!initialized) throw protocolError("state", "Sandbox is not initialized.");
      assertMintPayload(message.payload);
      const data = await mintToken(message.payload);
      reply(message, true, data);
      return;
    }
    if (message.type === "dispose") {
      await disposeState();
      activeNonce = "";
      reply(message, true, { disposed: true });
    }
  }
  async function initializeInterpreter(payload) {
    await disposeState();
    if (payload.interpreterJavascript === FAKE_INTERPRETER_JAVASCRIPT && payload.interpreterProgram === FAKE_INTERPRETER_PROGRAM) {
      return initializeFakeInterpreter(payload);
    }
    return initializeBotguardInterpreter(payload);
  }
  function initializeFakeInterpreter(payload) {
    if (payload.interpreterJavascript !== FAKE_INTERPRETER_JAVASCRIPT || payload.interpreterProgram !== FAKE_INTERPRETER_PROGRAM) {
      throw protocolError("unsupported-interpreter", "Only the bounded fake interpreter payload is supported in this slice.");
    }
    initialized = true;
    interpreterMode = "fake";
    initTime = Date.now();
    const botguardResponse = "fake-botguard-response-v1";
    assertStringLimit(botguardResponse, "botguardResponse", BOTGUARD_LIMITS.responseBytes);
    return {
      interpreter: "fake",
      botguardResponse,
      initializedAt: initTime,
      capabilities: {
        chromeApiPresent: Boolean(globalThis.chrome?.runtime),
        directFetchPresent: typeof globalThis.fetch === "function"
      }
    };
  }
  async function initializeBotguardInterpreter(payload) {
    const metadata = payload.challengeMetadata || {};
    assertChallengeMetadata(metadata);
    if (!metadata.globalName) throw protocolError("schema", "BotGuard challenge metadata requires globalName.");
    installYoutubeConfig(metadata.youtubeConfig);
    executeInterpreterJavascript(payload.interpreterJavascript, metadata.globalName);
    webPoSignalOutput = [];
    let botguardResponse;
    try {
      botguardClient = await BotGuardClient.create({
        globalObject: globalThis,
        globalName: metadata.globalName,
        program: payload.interpreterProgram
      });
      botguardResponse = await botguardClient.snapshot({
        contentBinding: metadata.contentBinding,
        signedTimestamp: metadata.signedTimestamp,
        webPoSignalOutput,
        skipPrivacyBuffer: metadata.skipPrivacyBuffer
      }, BOTGUARD_LIMITS.mintTimeoutMs);
    } catch {
      throw protocolError("botguard", "BotGuard initialization failed.");
    }
    assertStringLimit(botguardResponse, "botguardResponse", BOTGUARD_LIMITS.responseBytes);
    initialized = true;
    interpreterMode = "botguard";
    initTime = Date.now();
    return {
      interpreter: "botguard",
      botguardResponse,
      initializedAt: initTime
    };
  }
  async function mintToken(payload) {
    if (interpreterMode === "fake") return mintFakeToken(payload);
    if (interpreterMode !== "botguard") throw protocolError("state", "Unsupported interpreter mode.");
    if (!payload.integrityToken) throw protocolError("schema", "BotGuard mint requires integrityToken.");
    assertIntegrityToken(payload.integrityToken);
    if (!webPoSignalOutput) throw protocolError("state", "BotGuard WebPO signal output is unavailable.");
    let poToken;
    try {
      const minter = await WebPoMinter.create(payload.integrityToken, webPoSignalOutput);
      poToken = await minter.mintAsWebsafeString(payload.contentBinding);
    } catch {
      throw protocolError("botguard", "BotGuard mint failed.");
    }
    assertStringLimit(poToken, "poToken", BOTGUARD_LIMITS.poTokenChars);
    return {
      poToken,
      contentBinding: payload.contentBinding,
      mintedAt: Date.now()
    };
  }
  function mintFakeToken(payload) {
    const token = `fake-po-v1.${toBase64Url(payload.contentBinding)}`;
    if (token.length > BOTGUARD_LIMITS.poTokenChars) throw protocolError("too-large", "Fake token exceeds the token budget.");
    return {
      poToken: token,
      contentBinding: payload.contentBinding,
      mintedAt: Date.now()
    };
  }
  function installYoutubeConfig(youtubeConfig) {
    if (!youtubeConfig) return;
    globalThis.yt = { config_: { EVENT_ID: youtubeConfig.EVENT_ID } };
  }
  function clearYoutubeConfig() {
    if (globalThis.yt?.config_ && Object.keys(globalThis.yt.config_).length === 1 && globalThis.yt.config_.EVENT_ID !== void 0) {
      try {
        delete globalThis.yt;
      } catch {
        globalThis.yt = void 0;
      }
    }
  }
  function executeInterpreterJavascript(interpreterJavascript, globalName) {
    const before = globalThis[globalName];
    try {
      Function(interpreterJavascript)();
    } catch {
      throw protocolError("botguard", "BotGuard interpreter execution failed.");
    }
    if (!globalThis[globalName] || globalThis[globalName] === before) throw protocolError("botguard", "BotGuard interpreter did not expose the expected global.");
  }
  async function disposeState() {
    const client = botguardClient;
    initialized = false;
    interpreterMode = "";
    botguardClient = null;
    webPoSignalOutput = null;
    initTime = 0;
    clearYoutubeConfig();
    if (client?.shutdown) {
      try {
        await client.shutdown(BOTGUARD_LIMITS.mintTimeoutMs);
      } catch {
      }
    }
  }
  function reply(request, ok, data, error) {
    const response = {
      v: BOTGUARD_PROTOCOL_VERSION,
      source: SANDBOX_SOURCE,
      target: PARENT_TARGET,
      id: request?.id || "",
      nonce: request?.nonce || activeNonce,
      ok,
      data: ok ? data : void 0,
      error: ok ? void 0 : {
        code: error?.code || "sandbox",
        message: String(error?.message || error || "Sandbox failure").slice(0, BOTGUARD_LIMITS.statusMessageChars)
      }
    };
    parent.postMessage(response, "*");
  }
  function toBase64Url(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }
})();
