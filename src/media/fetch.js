export async function fetchResource(url, { signal, allowedOrigins, pageOrigin, range, maxBytes, budget } = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw userError('permission', `Unsupported media URL protocol: ${parsed.protocol}`);
  if (!isUrlAllowed(parsed, allowedOrigins, pageOrigin)) throw userError('permission', `Origin is outside this job: ${parsed.origin}`);
  const headers = {};
  if (range) headers.Range = `bytes=${range.start}-${range.end ?? ''}`;
  const response = await fetch(parsed.href, { signal, credentials: 'include', headers, redirect: 'error' });
  if (!response.ok) throw userError('http', `Media request failed with HTTP ${response.status}.`, response.status);
  if (range && (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${range.start}-${range.end}/`))) { await response.body?.cancel(); throw userError('range', 'Server did not honor the requested byte range.'); }
  const length = Number(response.headers.get('content-length') || 0);
  if (maxBytes && length > maxBytes) { await response.body?.cancel(); throw userError('storage', 'Response is larger than the allowed job size.'); }
  if (budget && length && length > budget.remaining) { await response.body?.cancel(); throw userError('storage', 'Media exceeds this job byte limit.'); }
  return response;
}

export async function readBytes(url, options = {}) {
  const response = await fetchResource(url, options);
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (options.budget) {
      options.budget.remaining -= bytes.byteLength;
      if (options.budget.remaining < 0) throw userError('storage', 'Media exceeds this job byte limit.');
    }
    return bytes;
  }
  const chunks = [];
  let total = 0;
  try { while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (options.maxBytes && total > options.maxBytes) throw userError('storage', 'Response exceeded the allowed byte limit.');
    if (options.budget) {
      options.budget.remaining -= value.byteLength;
      if (options.budget.remaining < 0) throw userError('storage', 'Media exceeds this job byte limit.');
    }
    chunks.push(value);
    options.onChunk?.(total, Number(response.headers.get('content-length') || 0) || undefined);
  }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return concatBytes(chunks, total);
}

export function concatBytes(chunks, knownTotal) {
  const total = knownTotal ?? chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function resolveRelative(baseUrl, value) {
  return new URL(value, baseUrl).href;
}

export function makeByteBudget(maxBytes) {
  return { remaining: Number.isFinite(maxBytes) ? maxBytes : 512 * 1024 * 1024 };
}

export function isUrlAllowed(url, allowedOrigins = [], pageOrigin = '') {
  const parsed = url instanceof URL ? url : new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
  if (isPrivateHost(parsed.hostname)) {
    return parsed.origin === pageOrigin && allowedOrigins.some(entry => matchAllowedEntry(parsed, entry));
  }
  return allowedOrigins.some((entry) => matchAllowedEntry(parsed, entry));
}

function samePageHost(pageOrigin, hostname) {
  try {
    return new URL(pageOrigin).hostname === hostname;
  } catch {
    return false;
  }
}

function matchAllowedEntry(parsed, entry) {
  if (!entry) return false;
  if (entry === parsed.origin) return true;
  if (entry === '<all_urls>' || entry === '*://*/*') return true;
  const match = String(entry).match(/^(https?|\*):\/\/(\*|\*\.[^/]+|[^/]+)\/\*$/);
  if (!match) return false;
  const [, scheme, host] = match;
  if (scheme !== '*' && `${scheme}:` !== parsed.protocol) return false;
  if (host === '*') return true;
  if (host.startsWith('*.')) {
    const suffix = host.slice(1);
    return parsed.hostname.endsWith(suffix) || parsed.hostname === host.slice(2);
  }
  return parsed.host === host || parsed.hostname === host;
}

function isPrivateHost(hostname) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === '0.0.0.0' || /^169\.254\./.test(hostname) || /^\[(?:f[cd]|fe[89ab]|::ffff:)/i.test(hostname)) return true;
  if (/^127\./.test(hostname) || hostname === '::1' || hostname === '[::1]') return true;
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
  const match = hostname.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function userError(code, message, httpStatus) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}
