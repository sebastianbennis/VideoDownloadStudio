const GENERATE_IT_URL = 'https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT';
const INTERPRETER_ORIGIN = 'https://www.google.com';
const INTERPRETER_PATH = /^\/js\/th\/[^/?#]+\.js$/;
const WAA_MAX_RESPONSE_BYTES = 256 * 1024;
const WAA_MAX_REQUEST_BYTES = 128 * 1024;
const INTERPRETER_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export function isWebPoGenerateItUrl(url) {
  const parsed = parseUrl(url);
  return Boolean(parsed && parsed.href === GENERATE_IT_URL);
}

export function isWebPoInterpreterUrl(url) {
  return isWebPoInterpreterUrlWithRaw(url, url);
}

function isWebPoInterpreterUrlWithRaw(url, rawUrl) {
  const parsed = parseUrl(url);
  return Boolean(parsed
    && !hasExplicitPort(rawUrl)
    && parsed.protocol === 'https:'
    && parsed.origin === INTERPRETER_ORIGIN
    && parsed.hostname === 'www.google.com'
    && parsed.port === ''
    && !parsed.username
    && !parsed.password
    && parsed.search === ''
    && parsed.hash === ''
    && INTERPRETER_PATH.test(parsed.pathname));
}

export async function fetchWebPoGenerateIt(body, context = {}) {
  const payload = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body ?? {});
  const payloadBytes = byteLength(payload);
  if (payloadBytes > WAA_MAX_REQUEST_BYTES) throw userError('webpo-size', 'WebPO request exceeded the allowed byte limit.');
  const headers = scrubHeaders(context.headers);
  headers.set('accept', 'application/json');
  headers.set('content-type', 'application/json+protobuf');
  const response = await guardedFetch(GENERATE_IT_URL, {
    method: 'POST',
    headers,
    body: payload
  }, {
    ...context,
    endpoint: 'webpo-generate-it',
    maxBytes: WAA_MAX_RESPONSE_BYTES,
    allowedContentType: /^application\/(?:json|json\+protobuf)(?:\s*;|$)/i,
    validateUrl: isWebPoGenerateItUrl
  });
  return response;
}

export async function fetchWebPoInterpreter(interpreterUrl, context = {}) {
  const response = await guardedFetch(interpreterUrl, {
    method: 'GET',
    headers: { accept: 'text/javascript, application/javascript;q=0.9, */*;q=0.1' }
  }, {
    ...context,
    endpoint: 'webpo-interpreter',
    maxBytes: INTERPRETER_MAX_BYTES,
    allowedContentType: /^(text\/javascript|application\/javascript|application\/x-javascript)(?:\s*;|$)/i,
    validateUrl: isWebPoInterpreterUrl
  });
  return response.text();
}

export async function guardedFetch(input, init = {}, context = {}) {
  const url = normalizeUrl(input);
  const rawUrl = rawInputUrl(input);
  const validUrl = context.validateUrl === isWebPoInterpreterUrl
    ? isWebPoInterpreterUrlWithRaw(url, rawUrl)
    : context.validateUrl?.(url);
  if (!validUrl) throw userError('webpo-fetch', `Blocked unexpected WebPO request to ${safeOrigin(url)}.`);
  assertAllowedOrigin(url, context.allowedOrigins);

  const method = String(init.method || 'GET').toUpperCase();
  const headers = scrubHeaders(init.headers);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(timeoutError(context.endpoint)), positiveInteger(context.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const signal = anySignal([context.signal, init.signal, controller.signal]);
  try {
    const requestInit = {
      ...init,
      method,
      headers,
      credentials: 'omit',
      redirect: 'error',
      signal
    };
    if (method === 'GET' || method === 'HEAD') delete requestInit.body;
    const response = await (context.fetch || fetch)(url.href, requestInit);
    await validateWebPoResponse(response, context);
    return await boundedResponse(response, context.maxBytes);
  } catch (error) {
    if (error?.name === 'AbortError' && !context.signal?.aborted && !init.signal?.aborted) {
      throw timeoutError(context.endpoint);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function validateWebPoResponse(response, context) {
  if (!response?.ok) {
    await response?.body?.cancel?.().catch(() => {});
    throw userError('webpo-http', `WebPO request failed with HTTP ${response?.status || 0}.`, response?.status);
  }
  const type = response.headers?.get?.('content-type') || '';
  if (context.allowedContentType && (!type || !context.allowedContentType.test(type))) {
    await response.body?.cancel?.().catch(() => {});
    throw userError('webpo-type', `WebPO returned ${type || 'a missing content type'}.`);
  }
  if (/text\/html|\bjson\b/i.test(type) && context.endpoint === 'webpo-interpreter') {
    await response.body?.cancel?.().catch(() => {});
    throw userError('webpo-type', `WebPO interpreter returned ${type || 'a non-script response'}.`);
  }
  const length = Number(response.headers?.get?.('content-length') || 0);
  if (length && context.maxBytes && length > context.maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw userError('webpo-size', 'WebPO response exceeded the allowed byte limit.');
  }
}

async function boundedResponse(response, limit) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (limit && bytes.byteLength > limit) throw userError('webpo-size', 'WebPO response exceeded the allowed byte limit.');
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (limit && total > limit) {
        await reader.cancel().catch(() => {});
        throw userError('webpo-size', 'WebPO response exceeded the allowed byte limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return new Response(concat(chunks, total), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

function assertAllowedOrigin(url, allowedOrigins = []) {
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length || !originAllowed(url, allowedOrigins)) {
    throw userError('webpo-permission', `Allow access to ${url.origin} before using YouTube WebPO.`);
  }
}

function scrubHeaders(input) {
  const headers = new Headers(input || {});
  headers.delete('authorization');
  headers.delete('cookie');
  headers.delete('x-goog-authuser');
  return headers;
}

function normalizeUrl(input) {
  if (typeof input === 'string' || input instanceof URL) return new URL(input);
  if (typeof input?.url === 'string') return new URL(input.url);
  throw userError('webpo-fetch', 'Invalid WebPO request URL.');
}

function rawInputUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof input?.url === 'string') return input.url;
  return '';
}

function hasExplicitPort(url) {
  if (typeof url !== 'string') return false;
  const match = url.match(/^https:\/\/([^/]+)/i);
  return Boolean(match?.[1]?.includes(':'));
}

function parseUrl(url) {
  try {
    return url instanceof URL ? url : new URL(String(url));
  } catch {
    return undefined;
  }
}

function safeOrigin(url) {
  try {
    return (url instanceof URL ? url : new URL(url)).origin;
  } catch {
    return 'invalid URL';
  }
}

function originAllowed(url, allowedOrigins) {
  return allowedOrigins.some((pattern) => {
    if (pattern === '<all_urls>' || pattern === '*://*/*') return true;
    const text = String(pattern || '');
    try {
      const grant = new URL(text);
      const protocolMatches = grant.protocol === '*:' || grant.protocol === url.protocol;
      const host = url.hostname.toLowerCase();
      const grantHost = grant.hostname.toLowerCase();
      const hostMatches = grantHost === '*' || grantHost === host || (grantHost.startsWith('*.') && (host === grantHost.slice(2) || host.endsWith(grantHost.slice(1))));
      return protocolMatches && hostMatches;
    } catch {
      return url.origin.startsWith(text.replace(/\*.*$/, ''));
    }
  });
}

function anySignal(signals) {
  const active = signals.filter(Boolean);
  if (active.length === 1) return active[0];
  if (AbortSignal.any) return AbortSignal.any(active);
  const controller = new AbortController();
  const abort = (event) => controller.abort(event?.target?.reason);
  for (const signal of active) {
    if (signal.aborted) return AbortSignal.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

function byteLength(value) {
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
  if (value instanceof Uint8Array) return value.byteLength;
  return 0;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function timeoutError(endpoint = 'webpo') {
  return userError('webpo-timeout', `WebPO ${endpoint} request timed out.`);
}

function concat(chunks, total) {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function userError(code, message, httpStatus) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

export const WEBPO_ENDPOINTS = Object.freeze({
  generateItUrl: GENERATE_IT_URL,
  interpreterOrigin: INTERPRETER_ORIGIN,
  interpreterMaxBytes: INTERPRETER_MAX_BYTES,
  generateItMaxBytes: WAA_MAX_RESPONSE_BYTES,
  generateItMaxRequestBytes: WAA_MAX_REQUEST_BYTES
});
