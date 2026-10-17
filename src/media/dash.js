import { concatBytes, makeByteBudget, readBytes } from './fetch.js';

export async function readDash(plan, signal, onProgress) {
  const budget = makeByteBudget(plan.maxBytes);
  const opts = { signal, allowedOrigins: plan.allowedOrigins, pageOrigin: plan.pageOrigin, budget };
  const text = new TextDecoder().decode(await readBytes(plan.url, { ...opts, maxBytes: 2 * 1024 * 1024 }));
  const groups = parseSegmentGroups(plan.url, text, plan.preferredHeight, { representationId: plan.representationId, audioRepresentationId: plan.audioRepresentationId });
  let written = 0;
  const inputs = [];
  for (const group of groups) {
    const chunks = [];
    for (const segment of group.segments) {
      const bytes = await readBytes(segment.url, { ...opts, range: segment.range });
      chunks.push(bytes); written += bytes.byteLength;
      onProgress({ phase: 'downloading', bytesWritten: written });
    }
    inputs.push({ name: `${group.type}.mp4`, data: concatBytes(chunks), type: group.type });
  }
  return inputs;
}
export function parseSegmentUrls(url, text, height) { return parseSegmentGroups(url, text, height)[0]?.urls || []; }
export function parseSegmentGroups(url, text, height = 1080, selection = {}) {
  const mpd = parseXml(text);
  if (mpd.name !== 'MPD') throw fail('The DASH manifest is not valid.');
  if (mpd.attrs.type === 'dynamic') throw fail('Live DASH is not supported. Use a clear HLS source.');
  if (has(mpd, 'ContentProtection')) throw Object.assign(fail('Protected DASH content is not supported.'), { code: 'unsupported-drm' });
  const periods = children(mpd, 'Period');
  if (periods.length > 1) throw fail('Multiple-period DASH is not supported.');
  const period = periods[0] || mpd;
  const duration = isoDuration(period.attrs.duration || mpd.attrs.mediaPresentationDuration);
  const mpdBase = baseOf(mpd, url);
  const periodBase = period === mpd ? mpdBase : baseOf(period, mpdBase);
  const adaptations = children(period, 'AdaptationSet');
  const groups = [];
  for (const adaptation of adaptations.length ? adaptations : [period]) {
    const reps = children(adaptation, 'Representation');
    const typeValue = `${adaptation.attrs.contentType || ''} ${adaptation.attrs.mimeType || ''} ${reps.map(rep => `${rep.attrs.contentType || ''} ${rep.attrs.mimeType || ''}`).join(' ')}`;
    const type = typeValue.includes('audio') ? 'audio' : typeValue.includes('video') ? 'video' : 'unknown';
    const wantedId = type === 'audio' ? selection.audioRepresentationId : selection.representationId;
    const selected = selectRepresentation(reps, height, wantedId) || adaptation;
    if (!['audio','video','unknown'].includes(type)) continue;
    const base = baseOf(selected, adaptation === period ? periodBase : baseOf(adaptation, periodBase));
    const levels = [mpd, period, adaptation, selected];
    const list = inherited(levels, 'SegmentList');
    const template = inherited(levels, 'SegmentTemplate');
    let segments = [];
    if (list) {
      const init = child(list, 'Initialization');
      if (init) segments.push({ url: resolve(base, init.attrs.sourceURL || ''), range: range(init.attrs.range) });
      for (const item of children(list, 'SegmentURL')) segments.push({ url: resolve(base, item.attrs.media || ''), range: range(item.attrs.mediaRange) });
    } else if (template) {
      const attrs = template.attrs;
      const timescale = positive(attrs.timescale || 1, 'timescale');
      const startNumber = positive(attrs.startNumber || 1, 'startNumber', true);
      const rep = selected.attrs;
      const expand = (value, number, time) => expandTemplate(value, { RepresentationID: rep.id || '', Bandwidth: rep.bandwidth || '', Number: number, Time: time });
      if (attrs.initialization) segments.push({ url: resolve(base, expand(attrs.initialization, startNumber, 0)) });
      if (!attrs.media) throw fail('DASH SegmentTemplate has no media URL.');
      const timeline = child(template, 'SegmentTimeline');
      const points = [];
      if (timeline) {
        const entries = children(timeline, 'S');
        let time = 0;
        for (let index = 0; index < entries.length; index++) {
          const s = entries[index].attrs;
          if (s.t !== undefined) time = positive(s.t, 'timeline time', true);
          const d = positive(s.d, 'segment duration');
          let repeat = Number(s.r || 0);
          if (!Number.isInteger(repeat) || repeat < -1) throw fail('Invalid DASH timeline repeat.');
          if (repeat === -1) {
            const next = entries[index + 1]?.attrs.t;
            const end = next !== undefined ? Number(next) : duration ? duration * timescale + Number(attrs.presentationTimeOffset || 0) : NaN;
            if (!Number.isFinite(end) || end <= time) throw fail('Unbounded DASH timeline is not supported.');
            repeat = Math.ceil((end - time) / d) - 1;
          }
          if (points.length + repeat + 1 > 20000) throw fail('DASH manifest contains too many segments.');
          for (let r = 0; r <= repeat; r++) { points.push(time); time += d; }
        }
      } else {
        const segmentDuration = positive(attrs.duration, 'segment duration');
        if (!duration) throw fail('DASH duration is required without a timeline.');
        const count = Math.ceil(duration * timescale / segmentDuration);
        if (count > 20000) throw fail('DASH manifest contains too many segments.');
        for (let i = 0; i < count; i++) points.push(i * segmentDuration);
      }
      for (let i = 0; i < points.length; i++) segments.push({ url: resolve(base, expand(attrs.media, startNumber + i, points[i])) });
    } else if (child(selected, 'BaseURL') || child(adaptation, 'BaseURL') || inherited(levels, 'SegmentBase')) {
      segments = [{ url: base }];
    }
    if (segments.length) groups.push({ type, segments, urls: segments.map(x => x.url) });
  }
  if (!groups.length) throw fail('No clear DASH segments were found.');
  const selected = [];
  for (const type of ['video','audio','unknown']) { const group = groups.find(x => x.type === type); if (group) selected.push(group); }
  return selected;
}
export function dashVariants(url, text) {
  const mpd = parseXml(text);
  if (mpd.name !== 'MPD') throw fail('The DASH manifest is not valid.');
  if (mpd.attrs.type === 'dynamic') throw fail('Live DASH is not supported. Use a clear HLS source.');
  if (has(mpd, 'ContentProtection')) throw Object.assign(fail('Protected DASH content is not supported.'), { code: 'unsupported-drm' });
  const period = children(mpd, 'Period')[0] || mpd;
  const adaptations = children(period, 'AdaptationSet');
  const videos = [];
  const audios = [];
  for (const adaptation of adaptations.length ? adaptations : [period]) {
    for (const rep of children(adaptation, 'Representation')) {
      const typeValue = `${adaptation.attrs.contentType || ''} ${adaptation.attrs.mimeType || ''} ${rep.attrs.contentType || ''} ${rep.attrs.mimeType || ''}`;
      const type = typeValue.includes('audio') ? 'audio' : typeValue.includes('video') ? 'video' : '';
      if (!type) continue;
      const item = {
        representationId: rep.attrs.id || '',
        kind: 'dash',
        url,
        container: 'mp4',
        mimeType: rep.attrs.mimeType || adaptation.attrs.mimeType || 'application/dash+xml',
        codecs: rep.attrs.codecs || adaptation.attrs.codecs,
        width: Number(rep.attrs.width || 0) || undefined,
        height: Number(rep.attrs.height || 0) || undefined,
        bitrate: Number(rep.attrs.bandwidth || 0) || undefined
      };
      if (type === 'audio') audios.push(item);
      else videos.push(item);
    }
  }
  const audio = audios.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  return videos.slice().sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0)).map((video, index) => ({
    ...video,
    id: `dash-${video.representationId || index}-${audio?.representationId || 'audio'}`,
    audioRepresentationId: audio?.representationId,
    audioMimeType: audio?.mimeType
  }));
}

function selectRepresentation(reps, height, id) {
  if (id) {
    const selected = reps.find(rep => String(rep.attrs.id || '') === String(id));
    if (selected) return selected;
  }
  return reps.slice().sort((a,b) => quality(a, height) - quality(b, height) || Number(b.attrs.bandwidth || 0) - Number(a.attrs.bandwidth || 0))[0];
}

function inherited(levels, name) {
  let result;
  for (const level of levels) {
    const value = child(level, name);
    if (value) result = { name, attrs: { ...result?.attrs, ...value.attrs }, children: value.children.length ? value.children : result?.children || [], text: value.text };
  }
  return result;
}
function quality(rep, target) { const h = Number(rep.attrs.height || target); return (h > target ? 100000 : 0) + Math.abs(h-target); }
function resolve(base, value) { return new URL(value, base).href; }
function baseOf(node, base) { const value = child(node, 'BaseURL')?.text.trim(); return value ? resolve(base, value) : base; }
function child(node, name) { return node.children.find(x => x.name === name); }
function children(node, name) { return node.children.filter(x => x.name === name); }
function has(node, name) { return node.name === name || node.children.some(x => has(x, name)); }
function range(value) { if (!value) return undefined; const m = value.match(/^(\d+)-(\d+)$/); if (!m || +m[2] < +m[1]) throw fail('Invalid DASH byte range.'); return { start: +m[1], end: +m[2] }; }
function positive(value, label, zero = false) { const n = Number(value); if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1)) throw fail(`Invalid DASH ${label}.`); return n; }
function isoDuration(value = '') { const m = value.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/); return m ? (+m[1] || 0)*86400+(+m[2] || 0)*3600+(+m[3] || 0)*60+(+m[4] || 0) : 0; }
function expandTemplate(value, vars) {
  const out = value.replace(/\$\$/g, '\u0000').replace(/\$(RepresentationID|Bandwidth|Number|Time)(?:%0(\d+)d)?\$/g, (_,key,width) => String(vars[key]).padStart(Math.min(20, +width || 0), '0'));
  if (/\$[^$]+\$/.test(out)) throw fail('Unsupported DASH template token.');
  return out.replaceAll('\u0000', '$');
}
function parseXml(text) {
  if (text.length > 2*1024*1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw fail('DASH XML is too large or contains external declarations.');
  const root = { name: 'root', children: [], text: '' }; const stack = [root];
  const tokens = text.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]+>|[^<]+/g) || [];
  let count = 0;
  for (const token of tokens) {
    if (token.startsWith('<?') || token.startsWith('<!--')) continue;
    if (token.startsWith('</')) { const name = token.slice(2,-1).trim().split(':').pop(); if (stack.length < 2 || stack.pop().name !== name) throw fail('Malformed DASH XML.'); continue; }
    if (token.startsWith('<')) {
      const match = /^<([\w:.-]+)([\s\S]*?)\/?\s*>$/.exec(token); if (!match) throw fail('Malformed DASH XML.');
      const attrs = Object.create(null);
      for (const a of match[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].split(':').pop()] = decode(a[2] ?? a[3]);
      const node = { name: match[1].split(':').pop(), attrs, children: [], text: '' };
      stack.at(-1).children.push(node);
      if (++count > 50000 || stack.length > 32) throw fail('DASH XML exceeds the structural limit.');
      if (!/\/\s*>$/.test(token)) stack.push(node);
    } else stack.at(-1).text += decode(token);
  }
  if (stack.length !== 1 || root.children.length !== 1) throw fail('Malformed DASH XML.');
  return root.children[0];
}
function decode(value) { return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_,s) => s[0] === '#' ? String.fromCodePoint(s[1].toLowerCase() === 'x' ? parseInt(s.slice(2),16) : +s.slice(1)) : ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[s]); }
function fail(message) { return Object.assign(new Error(message), { code: 'manifest' }); }
