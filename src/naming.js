const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const TOKENS = /\{(title|author|host|hostname|date)\}|%(title|author|host|hostname|date)%/g;
const MEDIA_EXTENSIONS = new Set(['mp4', 'm4v', 'm4a', 'webm', 'mov', 'mkv', 'ts', 'mp3', 'aac', 'ogg', 'ogv', 'opus', 'wav', 'flac']);
export function directMediaExtension(url, mimeType = '') {
  const mime = mimeType.split(';')[0].trim().toLowerCase();
  const typed = { 'video/mp4': 'mp4', 'audio/mp4': 'm4a', 'video/webm': 'webm', 'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'video/quicktime': 'mov', 'video/mp2t': 'ts', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'video/ogg': 'ogv', 'audio/wav': 'wav', 'audio/flac': 'flac' }[mime];
  if (typed) return typed;
  const suffix = new URL(url).pathname.split('.').pop().toLowerCase();
  return MEDIA_EXTENSIONS.has(suffix) ? suffix : 'mp4';
}

export function withMediaExtension(filename, extension) {
  if (!MEDIA_EXTENSIONS.has(extension)) throw new Error('Unknown output media type.');
  const parts = filename.split('/');
  const basename = parts.pop().replace(/\.[a-z0-9]{2,12}$/i, '');
  return [...parts, sanitizeFilename(basename, extension)].join('/');
}
export function sanitizeFilename(input, extension = '') {
  const ext = String(extension).replace(/[^a-z0-9]/gi, '').slice(0,12).toLowerCase();
  let name = String(input || 'video').normalize('NFKC').replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
  if (!name) name = 'video';
  if (RESERVED.test(name)) name = `_${name}`;
  if (ext && name.toLowerCase().endsWith(`.${ext}`)) name = name.slice(0, -(ext.length+1));
  name = [...name].slice(0, 140).join('').replace(/[. ]+$/g, '') || 'video';
  while (new TextEncoder().encode(name).length > 220) name = [...name].slice(0,-1).join('');
  return ext ? `${name}.${ext}` : name;
}
export function validateNamingRules(text) {
  try {
    if (!String(text || '').trim()) return { ok: true, template: '{title}', rules: [] };
    if (typeof text !== 'string' || text.length > 8000) throw new Error('Naming rules must be JSON under 8,000 characters.');
    let config;
    try { config = JSON.parse(text); } catch { throw new Error('Naming rules must be valid JSON, for example {"template":"{title}-{date}"}.'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Naming rules must be a JSON object.');
    const template = validTemplate(config.template || '{title}');
    const rules = config.rules || [];
    if (!Array.isArray(rules) || rules.length > 32) throw new Error('Use at most 32 naming rules.');
    const clean = rules.map(rule => {
      if (!rule || typeof rule.match !== 'string' || rule.match.length > 256) throw new Error('Each rule needs a match string under 256 characters.');
      const replacements = rule.replace || [];
      if (!Array.isArray(replacements) || replacements.length > 16 || replacements.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(value => typeof value !== 'string' || value.length > 160) || !pair[0])) throw new Error('replace must contain up to 16 [find, replacement] string pairs.');
      return { match: rule.match, template: validTemplate(rule.template || template), replace: replacements };
    });
    return { ok: true, template, rules: clean };
  } catch (error) { return { ok: false, message: error.message }; }
}
export function buildFilename({ title, url, extension = 'mp4', template = '', rules, subdirectory = '', author = '' }) {
  const config = validateNamingRules(rules || template);
  if (!config.ok) throw new Error(config.message);
  const parsed = new URL(url);
  const rule = config.rules.find(item => glob(item.match, parsed.hostname + parsed.pathname) || glob(item.match, parsed.href));
  let value = String(title || parsed.hostname || 'video');
  for (const [find, replacement] of rule?.replace || []) value = value.split(find).join(replacement).slice(0, 1000);
  const tokens = { title: value, author: String(author || '').trim(), host: parsed.hostname.replace(/^www\./, ''), hostname: parsed.hostname, date: new Date().toISOString().slice(0,10) };
  // An empty token (a video with no known author) must not leave " - " behind.
  const name = (rule?.template || config.template).replace(TOKENS, (_,a,b) => tokens[a || b])
    .replace(/(\s*[-_|·]\s*)(?:[-_|·]\s*)+/g, '$1').replace(/^[\s\-_|·]+|[\s\-_|·]+$/g, '');
  const directory = String(subdirectory).replaceAll('\\','/').split('/').filter(part => part && part !== '.' && part !== '..').slice(0,3).map(part => sanitizeFilename(part)).join('/');
  return (directory ? `${directory}/` : '') + sanitizeFilename(name, extension);
}
function validTemplate(value) {
  if (typeof value !== 'string' || value.length > 240 || /[\\/]|\.\./.test(value) || /[{}]/.test(value.replace(TOKENS, ''))) throw new Error('Template supports {title}, {author}, {host}, {hostname}, and {date}, without paths.');
  return value;
}
function glob(pattern, value) {
  let p=0, v=0, star=-1, checkpoint=0;
  while (v < value.length) {
    if (pattern[p] === '?' || pattern[p] === value[v]) { p++; v++; }
    else if (pattern[p] === '*') { star=p++; checkpoint=v; }
    else if (star >= 0) { p=star+1; v=++checkpoint; }
    else return false;
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}
