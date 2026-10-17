import { BILIBILI_HEADER_PERMISSION, needsBilibiliHeaders } from '../shared/bilibili.js';
import { buildFilename, validateNamingRules } from '../naming.js';
import { localize, localizeDocument } from './localization.js';
import { selectVariant, stitchedContainer } from '../shared/media-variants.js';
import { originFromUrl, isYouTubePage } from '../shared/url.js';
import { accessPatternsForUrl } from '../shared/sites.js';

const YOUTUBE_ORIGIN_PATTERNS = Object.freeze([
  'https://www.youtube.com/*',
  'https://youtubei.googleapis.com/*',
  'https://jnn-pa.googleapis.com/*',
  'https://*.googlevideo.com/*',
  'https://*.ytimg.com/*',
  'https://*.youtube-nocookie.com/*'
]);

const ACTIVE_PHASES = new Set(['queued', 'preparing', 'downloading', 'processing', 'saving']);
const FINISHED_PHASES = new Set(['completed', 'complete']);
const STOPPED_PHASES = new Set(['failed', 'interrupted', 'cancelled']);
const READY_BAND_MS = 8000;
const IS_MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');

const state = {
  data: null,
  activeView: 'media',
  busy: false,
  settingsDirty: false,
  selectedId: '',
  userSelected: false,
  selectedVariants: new Map(),
  editedFilenames: new Map(),
  // Cards whose file the user renamed; the others take the naming rules and folder from Settings.
  renamed: new Set(),
  dirtyFields: new Set(),
  previewJobs: new Map(),
  startingPreviews: new Set(),
  hoveredCandidates: new Set(),
  openDetails: new Set(),
  openMenus: new Set(),
  seenActive: new Set(),
  readyUntil: new Map(),
  rates: new Map(),
  saveTimer: 0
};

const els = {
  tabLabel: document.querySelector('#tabLabel'),
  siteMark: document.querySelector('#siteMark'),
  scanButton: document.querySelector('#scanButton'),
  scanMenuItem: document.querySelector('#scanMenuItem'),
  pasteMenuItem: document.querySelector('#pasteMenuItem'),
  settingsMenuItem: document.querySelector('#settingsMenuItem'),
  moreMenu: document.querySelector('#moreMenu'),
  grantButton: document.querySelector('#grantButton'),
  grantAllButton: document.querySelector('#grantAllButton'),
  notice: document.querySelector('#notice'),
  candidateList: document.querySelector('#candidateList'),
  mediaView: document.querySelector('#mediaView'),
  jobList: document.querySelector('#jobList'),
  historyLabel: document.querySelector('#historyLabel'),
  historyList: document.querySelector('#historyList'),
  manualForm: document.querySelector('#manualForm'),
  manualUrl: document.querySelector('#manualUrl'),
  clearHistory: document.querySelector('#clearHistory'),
  settingsForm: document.querySelector('#settingsForm'),
  settingsDone: document.querySelector('#settingsDone'),
  savedNote: document.querySelector('#savedNote'),
  siteDefault: document.querySelector('#siteDefault'),
  siteDefaultText: document.querySelector('#siteDefaultText'),
  siteDefaultReset: document.querySelector('#siteDefaultReset'),
  advanced: document.querySelector('#advancedSettings'),
  band: document.querySelector('#band'),
  bandPrint: document.querySelector('#bandPrint'),
  bandSmall: document.querySelector('#bandSmall'),
  bandTitle: document.querySelector('#bandTitle'),
  bandPct: document.querySelector('#bandPct'),
  bandReveal: document.querySelector('#bandReveal')
};

markPopup();
document.addEventListener('DOMContentLoaded', init);

// A toolbar popup sizes itself to the page; the side panel and a tab fill their space.
function markPopup() {
  let popup = false;
  try {
    popup = Boolean(chrome.extension?.getViews?.({ type: 'popup' })?.includes(window));
  } catch {}
  document.documentElement.classList.toggle('is-popup', popup);
}

async function init() {
  bindViews();
  bindActions();
  bindKeyboard();
  window.addEventListener('pagehide', () => {
    for (const candidateId of state.previewJobs.keys()) releasePreview(candidateId, false).catch(() => {});
  });
  await refresh().catch((error) => showNotice(error.message || String(error), true));
  setInterval(() => {
    refresh().catch((error) => showNotice(error.message || String(error), true));
  }, 1000);
}

function bindViews() {
  for (const control of document.querySelectorAll('[data-view]')) {
    control.addEventListener('click', () => setView(control.dataset.view));
  }
}

function setView(view) {
  if (state.activeView === 'settings' && view !== 'settings' && state.settingsDirty) saveSettings().catch(() => {});
  state.activeView = view;
  document.body.dataset.screen = view;
  document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  document.querySelectorAll('.view').forEach((section) => section.classList.toggle('active', section.id === `${view}View`));
  closeMenus();
}

function bindActions() {
  const scan = async () => {
    closeMenus();
    await withBusy(async () => {
      await ensurePageAccess();
      if (isYouTubePage(state.data?.tab?.url)) await ensurePatterns(YOUTUBE_ORIGIN_PATTERNS);
      await send({ type: 'scan', tabId: state.data?.tab?.id });
      showNotice(isYouTubePage(state.data?.tab?.url)
        ? translate('scanYouTubeStarted', 'Reading formats from YouTube. They appear here when ready.')
        : translate('scanStarted', 'Looking for videos. Start the video if nothing appears.'));
    });
    await refresh();
  };
  els.scanButton.addEventListener('click', scan);
  els.scanMenuItem.addEventListener('click', scan);
  els.candidateList.addEventListener('click', (event) => {
    if (event.target.closest('[data-scan]')) scan();
  });

  els.grantButton.addEventListener('click', async () => {
    closeMenus();
    await withBusy(async () => {
      await ensurePageAccess();
      await send({ type: 'grants.changed', tabId: state.data?.tab?.id });
    });
    await refresh();
  });

  els.grantAllButton.addEventListener('click', async () => {
    closeMenus();
    await withBusy(async () => {
      const granted = await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
      if (!granted) throw new Error(translate('grantAllDenied', 'Chrome did not grant access to all websites.'));
      await send({ type: 'grants.changed', tabId: state.data?.tab?.id });
      showNotice(translate('grantAllDone', 'All websites allowed, for videos served from other domains.'));
    });
    await refresh();
  });

  els.pasteMenuItem.addEventListener('click', () => {
    closeMenus();
    setView('media');
    els.manualUrl.focus();
  });
  els.settingsMenuItem.addEventListener('click', () => setView('settings'));

  els.manualForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await addLink(els.manualUrl.value.trim());
  });

  els.clearHistory.addEventListener('click', async () => {
    await send({ type: 'history.clear' });
    await refresh();
  });

  els.moreMenu.addEventListener('toggle', () => {
    if (els.moreMenu.open) placeMenu(els.moreMenu);
  });
  document.addEventListener('click', (event) => {
    for (const menu of document.querySelectorAll('details[open]:is(.action-menu, .more-menu)')) {
      if (!menu.contains(event.target)) menu.open = false;
    }
  });
  els.mediaView.addEventListener('scroll', () => closeMenus(), { passive: true });

  els.band.querySelector('.band-open').addEventListener('click', () => setView('jobs'));
  els.bandReveal.addEventListener('click', async (event) => {
    event.stopPropagation();
    const jobId = els.bandReveal.dataset.jobId;
    if (jobId) await send({ type: 'job.show', jobId }).catch((error) => showNotice(error.message, true));
  });

  els.settingsForm.addEventListener('input', (event) => {
    const name = event.target?.name;
    if (!name) return;
    state.settingsDirty = true;
    state.dirtyFields.add(name);
    if (name === 'theme') applyTheme(event.target.value);
    // Typed fields save shortly after typing stops, so closing the popup does not lose them.
    if (event.target.tagName === 'INPUT' && ['text', 'number'].includes(event.target.type)) scheduleSave(400);
  });
  els.settingsForm.addEventListener('change', (event) => {
    const name = event.target?.name;
    if (!name || name === 'desktopNotifications') return;
    state.settingsDirty = true;
    state.dirtyFields.add(name);
    if (name === 'dock') return switchDock(event.target.value);
    // Choices save at once; a popup can close right after the click.
    scheduleSave(event.target.tagName === 'SELECT' || event.target.type === 'checkbox' ? 0 : 150);
  });
  window.addEventListener('pagehide', () => {
    if (state.settingsDirty) saveSettings().catch(() => {});
  });
  els.siteDefaultReset?.addEventListener('click', () => {
    setDefaultAction(state.data?.settings?.defaultAction || 'download').catch((error) => showNotice(error.message || String(error), true));
  });
  els.settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveSettings();
  });
  els.settingsDone.addEventListener('click', async () => {
    if (state.settingsDirty && !(await saveSettings())) return;
    setView('media');
  });

  els.settingsForm.elements.desktopNotifications?.addEventListener('change', async (event) => {
    if (event.target.checked) {
      await withBusy(async () => {
        const granted = await chrome.permissions.request({ permissions: ['notifications'] });
        if (!granted) {
          event.target.checked = false;
          throw new Error(translate('notificationsDenied', 'Chrome did not grant notification permission.'));
        }
      });
    }
    state.settingsDirty = true;
    state.dirtyFields.add('desktopNotifications');
    scheduleSave(0);
  });
}

function bindKeyboard() {
  document.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape') {
      if (document.querySelector('details[open]:is(.action-menu, .more-menu)')) {
        closeMenus();
        event.preventDefault();
      }
      return;
    }
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key === ',') {
      event.preventDefault();
      setView('settings');
      return;
    }
    if (isTyping(event.target)) return;
    const selected = selectedCandidateRecord();
    if (state.activeView !== 'media' || !selected) return;
    if (command && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      toggleDetails(selected.id);
    } else if (command && event.key.toLowerCase() === 'c' && !String(window.getSelection?.() || '')) {
      event.preventDefault();
      await copySelectedUrl(selected).catch((error) => showNotice(error.message || String(error), true));
    } else if (!command && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      if (event.target.closest?.('select, details')) return;
      event.preventDefault();
      moveSelection(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' && !command && !event.target.closest?.('button, summary, a, select')) {
      event.preventDefault();
      await runCandidateAction(selected, event.altKey ? 'download-as' : actionForCandidate(selected));
    } else if (event.key === ' ' && !event.target.closest?.('button, summary, a, select')) {
      event.preventDefault();
      state.hoveredCandidates.add(selected.id);
      await startPreview(selected, { requestPermission: true }).catch((error) => showNotice(error.message || String(error), true));
    }
  });
  document.addEventListener('paste', async (event) => {
    if (isTyping(event.target)) return;
    const text = event.clipboardData?.getData('text')?.trim() || '';
    if (!/^https?:\/\//i.test(text)) return;
    event.preventDefault();
    setView('media');
    els.manualUrl.value = text;
    await addLink(text);
  });
}

function isTyping(target) {
  return Boolean(target?.closest?.('input, textarea, [contenteditable="true"]'));
}

async function addLink(url) {
  await withBusy(async () => {
    await ensureOrigins([originFromUrl(url)]);
    const added = await send({ type: 'candidate.addUrl', url, tabId: state.data?.tab?.id });
    els.manualUrl.value = '';
    if (added?.id) {
      state.selectedId = added.id;
      state.userSelected = true;
    }
  });
  await refresh();
}

async function refresh() {
  if (state.busy) return;
  const rememberedTabId = Number.parseInt(sessionStorage.getItem('vdsTargetTabId') || '', 10);
  const targetTab = await targetWebTab(state.data?.tab?.id || (Number.isInteger(rememberedTabId) ? rememberedTabId : undefined));
  if (Number.isInteger(targetTab?.id)) sessionStorage.setItem('vdsTargetTabId', String(targetTab.id));
  const response = await send({ type: 'state.get', tabId: targetTab?.id });
  state.data = response;
  render();
}

function render() {
  const { tab, permissions, candidates = [], jobs = [], history = [], settings, discovery } = state.data;
  if (!state.settingsDirty) applyTheme(settings?.theme || 'system');
  localizeDocument(document, settings?.translations || {});
  trackJobs(jobs);
  renderHeader(tab, permissions, candidates);
  renderTabs(candidates, jobs);
  renderCandidates(candidates, discovery);
  renderBand(jobs);
  renderJobs(jobs);
  renderHistory(history, settings);
  renderSettings(settings);
}

// ---- Header and tabs ----

function renderHeader(tab, permissions = {}, candidates) {
  const host = hostLabel(tab?.url).replace(/^www\./, '');
  els.tabLabel.textContent = host || tab?.title || translate('ready', 'Ready');
  els.tabLabel.title = tab?.title || '';
  renderSiteMark(host, tab?.favIconUrl);
  els.scanButton.hidden = !candidates.length;
  const allowed = Boolean(permissions.hasHostAccess);
  els.grantButton.classList.toggle('is-checked', allowed);
  els.grantButton.disabled = !permissions.origin || allowed;
  els.grantButton.firstElementChild.textContent = allowed
    ? translate('siteAllowed', 'Allowed on {host}').replace('{host}', host)
    : translate('allowThisSite', 'Allow This Site');
  els.grantAllButton.classList.toggle('is-checked', Boolean(permissions.hasAllHosts));
  els.grantAllButton.disabled = Boolean(permissions.hasAllHosts);
}

function renderSiteMark(host, favIconUrl) {
  const key = `${host}|${favIconUrl || ''}`;
  els.siteMark.hidden = !host;
  if (els.siteMark.dataset.key === key) return;
  els.siteMark.dataset.key = key;
  els.siteMark.replaceChildren();
  // Only an inline favicon is shown, so opening the panel never fetches from the site.
  if (/^data:image\//.test(favIconUrl || '')) {
    const image = document.createElement('img');
    image.src = favIconUrl;
    image.alt = '';
    image.width = 16;
    image.height = 16;
    els.siteMark.style.background = 'transparent';
    els.siteMark.append(image);
    return;
  }
  els.siteMark.style.background = 'var(--ink)';
  els.siteMark.style.color = 'var(--field)';
  els.siteMark.style.font = '800 10px/16px var(--display)';
  els.siteMark.style.textAlign = 'center';
  els.siteMark.textContent = (host.split('.').find((part) => part.length > 2) || host).charAt(0).toUpperCase();
}

function renderTabs(candidates, jobs) {
  const mediaTab = document.querySelector('.tab[data-view="media"]');
  const jobsTab = document.querySelector('.tab[data-view="jobs"]');
  setCount(mediaTab, candidates.length);
  setCount(jobsTab, jobs.filter((job) => job.action !== 'preview' && ACTIVE_PHASES.has(job.phase)).length);
}

function setCount(node, count) {
  if (count > 0) node.dataset.count = String(count);
  else delete node.dataset.count;
}

// ---- On this page ----

function renderCandidates(candidates, discovery) {
  const existing = new Map(Array.from(els.candidateList.querySelectorAll('[data-candidate-id]')).map((card) => [card.dataset.candidateId, card]));
  const nextIds = new Set(candidates.map((candidate) => candidate.id));
  for (const [id, card] of existing) {
    if (!nextIds.has(id)) {
      releasePreview(id, false).catch(() => {});
      card.remove();
      existing.delete(id);
    }
  }
  els.mediaView.classList.toggle('has-band', !els.band.hidden);
  if (!candidates.length) {
    state.selectedId = '';
    state.userSelected = false;
    const key = emptyKey(discovery);
    if (els.candidateList.firstElementChild?.dataset.emptyKey !== key) els.candidateList.replaceChildren(emptyCandidateNode(discovery, key));
    return;
  }
  for (const node of els.candidateList.querySelectorAll(':scope > .empty')) node.remove();
  chooseSelected(candidates);
  const ordered = [candidates.find((item) => item.id === state.selectedId), ...candidates.filter((item) => item.id !== state.selectedId)];
  let label = els.candidateList.querySelector(':scope > .label');
  if (!label) {
    label = element('h3', 'label');
    label.dataset.label = 'alsoOnThisPage';
  }
  label.textContent = translate('alsoOnThisPage', 'Also on this page');
  const nodes = [];
  for (const candidate of ordered) {
    const oldCard = existing.get(candidate.id);
    const card = oldCard?.querySelector('details.action-menu')?.open ? oldCard : renderCandidateCard(candidate, oldCard);
    nodes.push(card);
    if (card === nodes[0] && ordered.length > 1) nodes.push(label);
  }
  if (ordered.length < 2) label.remove();
  const current = Array.from(els.candidateList.children);
  if (current.length !== nodes.length || current.some((node, index) => node !== nodes[index])) {
    els.candidateList.replaceChildren(...nodes);
  }
  updateDevelopingCards();
}

function chooseSelected(candidates) {
  if (state.selectedId && candidates.some((item) => item.id === state.selectedId) && state.userSelected) return;
  // The longest video is usually the one the page is about.
  const longest = candidates.reduce((best, item) => (durationOf(item) > durationOf(best) ? item : best), candidates[0]);
  if (state.selectedId && state.selectedId !== longest.id) releasePreview(state.selectedId, false).catch(() => {});
  state.selectedId = longest.id;
}

function durationOf(candidate) {
  return Number(candidate?.durationSeconds || candidate?.duration || candidate?.variants?.[0]?.duration) || 0;
}

function selectCandidate(id) {
  if (state.selectedId === id) return;
  if (state.selectedId) releasePreview(state.selectedId, false).catch(() => {});
  state.selectedId = id;
  state.userSelected = true;
  renderCandidates(state.data?.candidates || [], state.data?.discovery);
  els.candidateList.querySelector('.video.is-selected')?.focus({ preventScroll: true });
  els.mediaView.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function moveSelection(step) {
  const candidates = state.data?.candidates || [];
  const index = candidates.findIndex((item) => item.id === state.selectedId);
  const next = candidates[(index + step + candidates.length) % candidates.length];
  if (next) selectCandidate(next.id);
}

function selectedCandidateRecord() {
  return (state.data?.candidates || []).find((item) => item.id === state.selectedId);
}

function renderCandidateCard(candidate, oldCard) {
  const card = oldCard || element('article', 'video');
  if (!oldCard) {
    card.dataset.testid = 'candidate-card';
    card.dataset.candidateId = candidate.id;
  }
  const variants = candidate.variants?.length ? candidate.variants : [fallbackVariant(candidate)];
  // The card follows the service's pick (preferred quality) until the user picks one here.
  const selectedId = state.selectedVariants.get(candidate.id) || candidate.selectedVariantId || variants[0]?.id || '';
  const selected = safeSelectVariant({ ...candidate, variants }, selectedId);
  const isSelected = candidate.id === state.selectedId;
  const previewJob = isSelected ? previewJobFor(candidate.id) : null;
  const detailsOpen = state.openDetails.has(candidate.id);
  const signature = candidateSignature(candidate, variants, selected, previewJob, detailsOpen, isSelected);
  if (oldCard?.dataset.signature === signature) {
    if (isSelected) {
      bindCardHover(oldCard, candidate);
      updatePreviewVisibility(oldCard, candidate.id);
    }
    return oldCard;
  }
  const oldPreview = oldCard?.querySelector('.inline-preview');
  card.className = isSelected ? 'video is-selected' : 'video row';
  if (isSelected) card.tabIndex = -1;
  else card.removeAttribute('tabindex');
  card.onmouseenter = card.onmouseover = card.onpointerenter = card.onmouseleave = card.onmouseout = card.onpointerleave = null;
  if (isSelected) {
    card.replaceChildren(
      renderPrint(candidate, isProtected(candidate) ? null : renderInlinePreview(candidate, previewJob, oldPreview), true),
      element('h2', 'video-title', candidate.title || translate('untitled', 'Untitled media')),
      renderFileLine(candidate, selected),
      renderControls(candidate, variants, selected),
      selected.kind === 'hls' && !selected.audioUrl && !chrome.extension.inIncognitoContext ? element('p', 'quiet-note', 'Download keeps the stream format (.ts or .mp4) so long recordings can save directly to disk.') : document.createTextNode(''),
      detailsOpen ? renderDetails(candidate, selected) : document.createTextNode('')
    );
    bindCardHover(card, candidate);
    updatePreviewVisibility(card, candidate.id);
  } else {
    card.replaceChildren(...renderRow(candidate, variants, selected));
  }
  card.dataset.signature = signature;
  return card;
}

function renderPrint(candidate, previewNode, withDuration) {
  const print = element('div', 'print');
  const frame = element('div', 'img');
  const thumbnail = candidate.thumbnail || candidate.candidate?.thumbnail;
  if (thumbnail) {
    const image = document.createElement('img');
    image.src = thumbnail;
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      print.classList.add('is-blank');
      image.replaceWith(blankGlyph(candidate));
    }, { once: true });
    frame.append(image);
  } else {
    print.classList.add('is-blank');
    frame.append(blankGlyph(candidate));
  }
  const duration = withDuration ? formatDuration(candidate.durationSeconds || candidate.duration) : '';
  if (duration) frame.append(element('span', 'dur', duration));
  if (previewNode) frame.append(previewNode);
  print.append(frame);
  return print;
}

function blankGlyph(item) {
  return icon(item?.hasVideo === false || item?.action === 'audio' ? 'note' : 'film');
}

function renderFileLine(candidate, selected) {
  const line = element('div', 'file');
  const input = element('input', 'filename-input');
  input.type = 'text';
  input.value = displayFilename(candidate, selected);
  input.ariaLabel = translate('filename', 'File name');
  input.title = translate('filenameHelp', 'Click to rename the file');
  input.addEventListener('input', () => {
    state.renamed.add(candidate.id);
    state.editedFilenames.set(candidate.id, input.value);
  });
  input.addEventListener('blur', () => {
    if (!state.renamed.has(candidate.id)) return;
    const normalized = withSelectedExtension(input.value, selected);
    input.value = normalized;
    state.editedFilenames.set(candidate.id, normalized);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  line.append(icon('doc'), input);
  return line;
}

function renderControls(candidate, variants, selected) {
  const row = element('div', 'ctl');
  if (isProtected(candidate)) row.append(renderSplitActions(candidate, selected));
  else row.append(renderVariantSelect(candidate, variants, selected), renderSplitActions(candidate, selected));
  return row;
}

function renderVariantSelect(candidate, variants, selected) {
  const pick = element('label', 'pick');
  const face = quality(selected);
  const size = sizeText(selected, candidate);
  pick.append(element('b', '', face.face), element('span', 'more trunc', size), icon('chev'));
  const select = document.createElement('select');
  select.dataset.testid = 'variant-select';
  select.ariaLabel = translate('format', 'Quality');
  select.title = variantLabel(selected, candidate);
  for (const variant of variants) {
    const option = document.createElement('option');
    option.value = variant.id || '';
    option.textContent = variantLabel(variant, candidate);
    if ((variant.id || '') === (selected.variantId || selected.selectedVariantId || '')) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', async () => {
    state.selectedVariants.set(candidate.id, select.value);
    const next = safeSelectVariant({ ...candidate, variants }, select.value);
    if (state.renamed.has(candidate.id)) state.editedFilenames.set(candidate.id, withSelectedExtension(state.editedFilenames.get(candidate.id), next));
    await releasePreview(candidate.id).catch(() => {});
    await send({ type: 'candidate.select', candidateId: candidate.id, variantId: select.value }).catch((error) => showNotice(error.message || String(error), true));
    renderCandidates(state.data?.candidates || [], state.data?.discovery);
  });
  pick.append(select);
  return pick;
}

function renderSplitActions(candidate, selected) {
  const row = element('div', 'split split-actions');
  if (isProtected(candidate)) {
    // DRM media cannot be saved; say so on the card instead of offering a download that fails.
    const locked = element('button', 'go');
    locked.type = 'button';
    locked.disabled = true;
    locked.title = translate('protectedHelp', 'This video is encrypted with DRM, so it cannot be saved.');
    locked.append(icon('lock'), document.createTextNode(translate('protectedLabel', 'Protected')));
    row.append(locked);
    return row;
  }
  const primaryAction = actionForCandidate(candidate);
  const primary = element('button', 'go');
  primary.type = 'button';
  primary.append(icon(primaryAction === 'copy' ? 'link' : 'down'), document.createTextNode(primaryLabel(primaryAction, candidate, selected)));
  primary.addEventListener('click', () => runCandidateAction(candidate, primaryAction).catch((error) => showNotice(error.message || String(error), true)));
  primary.dataset.action = primaryAction === 'copy' ? 'copy' : primaryAction;
  if (primaryAction === 'download') primary.dataset.testid = 'download-action';
  const menu = element('details', 'action-menu');
  const summary = element('summary');
  summary.title = translate('downloadOptions', 'More ways to save');
  summary.ariaLabel = summary.title;
  summary.append(icon('chev'));
  const list = element('div', 'menu');
  const current = primaryAction;
  const items = [
    [translate('downloadAudioAndVideoMenu', 'Download Audio & Video'), () => runCandidateAction(candidate, 'download'), { key: current === 'download' ? '↩' : '' }],
    [translate('downloadAsMenu', 'Download As…'), () => runCandidateAction(candidate, 'download-as'), { key: '⌥↩' }],
    [translate('downloadAudio', 'Download Audio'), () => runCandidateAction(candidate, 'audio')],
    'sep',
    [copyUrlLabel(candidate, selected), () => copySelectedUrl(candidate), { key: '⌘C' }],
    'sep',
    ['head', translate('makeDefault', 'Make it the default')],
    [translate('alwaysDownloadAudioAndVideo', 'Always Download Audio & Video'), () => setDefaultAction('download'), { checked: current === 'download' }],
    [translate('alwaysDownloadAs', 'Always Download As…'), () => setDefaultAction('download-as'), { checked: current === 'download-as' }],
    [translate('alwaysAudioOnlyWebsite', 'Always Audio Only for This Website'), () => setDefaultAction('audio', candidate), { checked: current === 'audio' }],
    [translate('alwaysCopyUrl', 'Always Copy URL'), () => setDefaultAction('copy'), { checked: current === 'copy' }],
    'sep',
    [translate('smartnaming', 'Smartnaming…'), () => focusSettings('namingRules')],
    [translate('details', 'Details'), () => toggleDetails(candidate.id), { key: '⌘I' }]
  ];
  for (const item of items) {
    if (item === 'sep') list.append(element('div', 'menu-sep'));
    else if (item[0] === 'head') list.append(element('div', 'menu-head', item[1]));
    else {
      const [label, handler, options = {}] = item;
      list.append(menuItem(label, async () => {
        state.openMenus.delete(candidate.id);
        menu.open = false;
        await handler();
      }, options));
    }
  }
  menu.open = state.openMenus.has(candidate.id);
  menu.addEventListener('toggle', () => {
    if (menu.open) {
      state.openMenus.add(candidate.id);
      placeMenu(menu);
    } else state.openMenus.delete(candidate.id);
  });
  menu.append(summary, list);
  row.append(primary, menu);
  return row;
}

// Menus escape the scrolling list: fixed, below the trigger, or above it when there is no room.
function placeMenu(details) {
  const panel = details.querySelector('.menu');
  const trigger = details.querySelector('summary');
  if (!panel || !trigger) return;
  panel.classList.add('is-fixed');
  panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = '';
  const anchor = trigger.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  const below = anchor.bottom + 6;
  const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - 6 - height);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function closeMenus() {
  for (const menu of document.querySelectorAll('details[open]:is(.action-menu, .more-menu)')) menu.open = false;
}

function renderRow(candidate, variants, selected) {
  const main = element('button', 'row-main');
  main.type = 'button';
  main.title = translate('showOptions', 'Show options');
  main.addEventListener('click', () => selectCandidate(candidate.id));
  const text = element('span', 'row-text');
  text.append(element('b', 'trunc', candidate.title || translate('untitled', 'Untitled media')), element('small', 'trunc', rowMeta(candidate, selected)));
  main.append(renderPrint(candidate, null, false), text);
  const action = actionForCandidate(candidate);
  const quick = element('button', 'row-dl');
  quick.type = 'button';
  if (isProtected(candidate)) {
    quick.disabled = true;
    quick.title = translate('protectedHelp', 'This video is encrypted with DRM, so it cannot be saved.');
    quick.ariaLabel = quick.title;
    quick.append(icon('lock'));
    return [main, quick];
  }
  quick.title = `${primaryLabel(action, candidate, selected)} · ${quality(selected).face}`;
  quick.ariaLabel = quick.title;
  quick.append(icon(action === 'copy' ? 'link' : 'down'));
  quick.addEventListener('click', () => runCandidateAction(candidate, action).catch((error) => showNotice(error.message || String(error), true)));
  return [main, quick];
}

function rowMeta(candidate, selected) {
  const q = quality(selected);
  return [
    formatDuration(selected.duration || candidate.durationSeconds),
    q.hasVideo ? `${q.face}${q.portrait ? ` ${translate('portrait', 'portrait')}` : ''}` : q.face,
    q.hasVideo && selected.hasAudio === false && !selected.audioUrl ? translate('noSound', 'no sound') : '',
    sizeText(selected, candidate)
  ].filter(Boolean).join(' · ');
}

function bindCardHover(card, candidate) {
  const enter = (event) => {
    if (event?.relatedTarget && card.contains(event.relatedTarget)) return;
    state.hoveredCandidates.add(candidate.id);
    updatePreviewVisibility(card, candidate.id);
    startPreview(candidate, { requestPermission: false }).catch((error) => showNotice(error.message || String(error), true));
  };
  const leave = (event) => {
    if (event?.relatedTarget && card.contains(event.relatedTarget)) return;
    state.hoveredCandidates.delete(candidate.id);
    pausePreview(candidate.id);
    updatePreviewVisibility(card, candidate.id);
  };
  card.onmouseenter = enter;
  card.onmouseover = enter;
  card.onpointerenter = enter;
  card.onmouseleave = leave;
  card.onmouseout = leave;
  card.onpointerleave = leave;
}

// The signature: a print develops as its download progresses.
function updateDevelopingCards() {
  const jobs = state.data?.jobs || [];
  for (const card of els.candidateList.querySelectorAll('[data-candidate-id]')) {
    const job = jobs
      .filter((item) => item.candidateId === card.dataset.candidateId && item.action !== 'preview' && ACTIVE_PHASES.has(item.phase))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    const print = card.querySelector('.print');
    if (!print) continue;
    print.classList.toggle('is-developing', Boolean(job));
    if (job) print.style.setProperty('--p', developed(job.percent));
    else print.style.removeProperty('--p');
  }
}

function developed(percent) {
  const p = Math.max(0, Math.min(1, (Number(percent) || 0) / 100));
  return Math.pow(p, 1.6).toFixed(3);
}

// ---- The band ----

function trackJobs(jobs) {
  const now = Date.now();
  for (const job of jobs) {
    if (job.action === 'preview') continue;
    if (ACTIVE_PHASES.has(job.phase)) {
      state.seenActive.add(job.id);
      const bytes = Number(job.bytesWritten) || 0;
      const previous = state.rates.get(job.id);
      if (previous && now > previous.t && bytes >= previous.bytes) {
        const instant = (bytes - previous.bytes) / ((now - previous.t) / 1000);
        const rate = previous.rate ? previous.rate * 0.7 + instant * 0.3 : instant;
        state.rates.set(job.id, { bytes, t: now, rate });
      } else if (!previous) state.rates.set(job.id, { bytes, t: now, rate: 0 });
    } else if (FINISHED_PHASES.has(job.phase) && state.seenActive.has(job.id)) {
      state.seenActive.delete(job.id);
      state.rates.delete(job.id);
      state.readyUntil.set(job.id, now + READY_BAND_MS);
    }
  }
  for (const [id, until] of state.readyUntil) if (until < now) state.readyUntil.delete(id);
}

function renderBand(jobs) {
  const active = jobs
    .filter((job) => job.action !== 'preview' && ACTIVE_PHASES.has(job.phase))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const ready = jobs.find((job) => state.readyUntil.has(job.id) && FINISHED_PHASES.has(job.phase));
  const job = active[0] || ready;
  els.band.hidden = !job;
  els.mediaView.classList.toggle('has-band', Boolean(job));
  if (!job) return;
  const isReady = !active[0];
  const percent = isReady ? 100 : Math.max(0, Math.min(100, Number(job.percent) || 0));
  els.band.style.setProperty('--p', String(percent / 100));
  const thumbnail = job.candidate?.thumbnail || '';
  const frame = els.bandPrint.firstElementChild;
  if (els.bandPrint.dataset.src !== thumbnail) {
    els.bandPrint.dataset.src = thumbnail;
    els.bandPrint.classList.toggle('is-blank', !thumbnail);
    if (thumbnail) {
      const image = document.createElement('img');
      image.src = thumbnail;
      image.alt = '';
      frame.replaceChildren(image);
    } else frame.replaceChildren(blankGlyph(job));
  }
  els.bandPrint.classList.toggle('is-developing', !isReady);
  els.bandPrint.style.setProperty('--p', developed(percent));
  els.bandPrint.querySelector('.mark')?.remove();
  if (isReady) els.bandPrint.append(markNode('check'));
  const more = active.length > 1 ? ` · ${translate('moreDownloading', '{count} more').replace('{count}', String(active.length - 1))}` : '';
  els.bandSmall.textContent = isReady
    ? [job.partial ? 'Partial recording saved' : translate('ready', 'Ready'), formatBytes(job.totalBytes || job.bytesWritten)].join(' · ')
    : [phaseLabel(job), quality(job.candidate || {}).face, etaText(job)].filter(Boolean).join(' · ') + more;
  els.bandTitle.textContent = job.title || job.filename || translate('untitled', 'Untitled media');
  els.bandPct.hidden = isReady;
  els.bandPct.textContent = `${Math.round(percent)}%`;
  const canReveal = isReady && Number.isInteger(job.chromeDownloadId);
  els.bandReveal.hidden = !canReveal;
  els.bandReveal.dataset.jobId = job.id;
  els.bandReveal.title = revealLabel();
  els.bandReveal.ariaLabel = revealLabel();
}

function etaText(job) {
  const total = Number(job.totalBytes) || 0;
  const rate = state.rates.get(job.id)?.rate || 0;
  if (job.phase !== 'downloading' || !total || rate < 1) return '';
  const seconds = Math.max(0, (total - (Number(job.bytesWritten) || 0)) / rate);
  if (seconds < 60) return translate('etaUnderMinute', 'under a minute left');
  if (seconds < 90 * 60) return translate('etaMinutes', 'about {n} min left').replace('{n}', String(Math.round(seconds / 60)));
  return translate('etaHours', 'about {n} h left').replace('{n}', String(Math.round(seconds / 3600)));
}

function phaseLabel(job) {
  if (job.partial && FINISHED_PHASES.has(job.phase)) return 'Partial recording saved';
  const labels = {
    queued: ['phaseQueued', 'Waiting to start'],
    preparing: ['phasePreparing', 'Getting ready'],
    downloading: ['phaseDownloading', 'Developing'],
    processing: ['phaseProcessing', 'Putting it together'],
    saving: ['phaseSaving', 'Saving'],
    completed: ['phaseCompleted', 'Saved'],
    complete: ['phaseCompleted', 'Saved'],
    failed: ['phaseFailed', 'Stopped'],
    interrupted: ['phaseInterrupted', 'Interrupted'],
    cancelled: ['phaseCancelled', 'Cancelled']
  };
  const [key, fallback] = labels[job.phase] || ['', job.phase || ''];
  return key ? translate(key, fallback) : fallback;
}

function revealLabel() {
  return IS_MAC ? translate('revealMac', 'Show in Finder') : translate('reveal', 'Show in Folder');
}

// ---- Downloads ----

function renderJobs(jobs) {
  const visible = jobs
    .filter((job) => job.action !== 'preview')
    .sort((a, b) => jobRank(a) - jobRank(b) || (b.createdAt || 0) - (a.createdAt || 0));
  if (!visible.length) {
    if (!els.jobList.querySelector(':scope > .empty')) {
      els.jobList.replaceChildren(emptyNode(translate('noJobs', 'Nothing downloading'), translate('noJobsBody', 'Videos you save appear here, with their progress.'), { small: true }));
    }
    return;
  }
  const existing = new Map(Array.from(els.jobList.querySelectorAll('[data-job-id]')).map((card) => [card.dataset.jobId, card]));
  const nodes = visible.map((job) => {
    const oldCard = existing.get(job.id);
    const signature = JSON.stringify([job, etaText(job)]);
    if (oldCard?.dataset.signature === signature) return oldCard;
    return renderJobCard(job, oldCard, signature);
  });
  const current = Array.from(els.jobList.children);
  if (current.length !== nodes.length || current.some((node, index) => node !== nodes[index])) els.jobList.replaceChildren(...nodes);
}

function jobRank(job) {
  if (ACTIVE_PHASES.has(job.phase)) return 0;
  if (STOPPED_PHASES.has(job.phase)) return 1;
  return 2;
}

function renderJobCard(job, oldCard, signature) {
  const card = oldCard || element('article', 'job');
  card.dataset.jobId = job.id;
  card.dataset.signature = signature;
  const percent = Math.max(0, Math.min(100, Number(job.percent) || 0));
  const active = ACTIVE_PHASES.has(job.phase);
  const stopped = STOPPED_PHASES.has(job.phase);
  const done = FINISHED_PHASES.has(job.phase);
  const print = renderPrint({ thumbnail: job.candidate?.thumbnail, hasVideo: job.action === 'audio' ? false : undefined, action: job.action }, null, false);
  if (active) {
    print.classList.add('is-developing');
    print.style.setProperty('--p', developed(percent));
  }
  if (stopped) {
    print.classList.add('is-failed');
    if (job.phase !== 'cancelled') print.append(markNode('bang', true));
  }
  if (done) print.append(markNode('check'));
  const text = element('div', 'job-text');
  text.append(element('b', 'trunc', job.title || job.filename || translate('untitled', 'Untitled media')));
  if (active) {
    text.append(element('small', '', jobProgressLine(job)));
    text.append(progress(percent));
  } else if (stopped) {
    const message = job.error?.message
      ? translate('stoppedAt', 'Stopped at {percent}%.').replace('{percent}', String(Math.round(percent))) + ` ${job.error.message}`
      : phaseLabel(job);
    text.append(element('small', job.phase === 'cancelled' ? '' : 'error', message));
  } else {
    text.append(element('small', '', [quality(job.candidate || {}).face, formatBytes(job.totalBytes || job.bytesWritten), `${translate('savedAt', 'saved')} ${formatWhen(job.completedAt || job.createdAt)}`].filter(Boolean).join(' · ')));
  }
  if (job.partial && done) text.append(element('small', '', job.partialReason || 'Partial recording saved.'));
  text.append(jobButtons(job));
  const parts = [print, text];
  if (active) {
    const side = element('div', 'job-side');
    side.append(element('span', 'pct', `${Math.round(percent)}%`));
    parts.push(side);
  }
  card.replaceChildren(...parts);
  return card;
}

function jobProgressLine(job) {
  const written = Number(job.bytesWritten) || 0;
  const total = Number(job.totalBytes) || 0;
  const doneText = formatBytes(written);
  const totalText = formatBytes(total);
  // "1.1 of 1.8 GB" rather than "1.1 GB of 1.8 GB" when the units match.
  const sameUnit = doneText && doneText.split(' ')[1] === totalText.split(' ')[1];
  const amount = total
    ? translate('bytesOf', '{done} of {total}').replace('{done}', sameUnit ? doneText.split(' ')[0] : doneText || '0').replace('{total}', totalText)
    : written ? translate('bytesSoFar', '{done} so far').replace('{done}', formatBytes(written)) : '';
  if (job.phase !== 'downloading') return [phaseLabel(job), amount].filter(Boolean).join(' · ');
  return [quality(job.candidate || {}).face, amount, etaText(job)].filter(Boolean).join(' · ');
}

function jobButtons(job) {
  const container = element('div', 'job-actions');
  if (ACTIVE_PHASES.has(job.phase)) {
    container.append(button(translate('cancel', 'Cancel'), () => send({ type: 'job.cancel', jobId: job.id }).then(refresh), 'btn is-quiet', 'x'));
    if (job.candidate?.kind === 'hls' || job.candidate?.route === 'HLS') {
      const stop = button(translate('stop', 'Stop and Save'), () => send({ type: 'job.stop', jobId: job.id }).then(refresh), 'btn', 'stop');
      stop.title = translate('stopHelp', 'Stop recording and save what has downloaded');
      container.append(stop);
    }
  }
  if (STOPPED_PHASES.has(job.phase)) container.append(button(translate('retry', 'Try Again'), () => send({ type: 'job.retry', jobId: job.id }).then(refresh), 'btn is-primary', 'retry'));
  if (Number.isInteger(job.chromeDownloadId) && FINISHED_PHASES.has(job.phase)) container.append(button(revealLabel(), () => send({ type: 'job.show', jobId: job.id }), 'btn', 'folder'));
  return container;
}

function renderHistory(history, settings = {}) {
  const jobIds = new Set((state.data?.jobs || []).map((job) => job.id));
  const items = history.filter((item) => !jobIds.has(item.id)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const historyOff = !Number(settings.historyDays);
  els.historyLabel.hidden = historyOff ? false : !items.length;
  els.clearHistory.hidden = !history.length;
  const signature = JSON.stringify([items, historyOff]);
  if (els.historyList.dataset.signature === signature) return;
  els.historyList.dataset.signature = signature;
  els.historyList.replaceChildren();
  if (historyOff) {
    const note = element('p', 'quiet-note', translate('historyOff', 'History is off. Turn it on in Settings to keep a list of saved files.'));
    els.historyList.append(note);
    return;
  }
  for (const item of items) {
    const row = element('div', 'hist');
    row.append(
      element('b', 'trunc', item.title || item.filename),
      element('small', '', [item.action === 'audio' ? translate('sound', 'Sound') : '', formatBytes(item.bytes), formatWhen(item.createdAt)].filter(Boolean).join(' · '))
    );
    row.title = item.filename || '';
    els.historyList.append(row);
  }
}

// ---- Settings ----

// Runs on every refresh: it leaves the field being used alone and writes only changed values, so an
// open menu stays open and a caret stays where it is.
function renderSettings(settings = {}) {
  if (state.settingsDirty) return;
  for (const [key, value] of Object.entries(settings)) {
    const input = els.settingsForm.elements[key];
    if (!input || input === document.activeElement) continue;
    if (input.type === 'checkbox') {
      if (input.checked !== Boolean(value)) input.checked = Boolean(value);
      continue;
    }
    const text = key === 'translations' ? (Object.keys(value || {}).length ? JSON.stringify(value, null, 2) : '') : String(value ?? '');
    if (input.tagName === 'SELECT' && ![...input.options].some((option) => option.value === text)) {
      const option = document.createElement('option');
      option.value = text;
      option.textContent = key === 'preferredHeight' ? `${value}p` : text;
      input.append(option);
    }
    if (input.value !== text) input.value = text;
  }
  renderSiteDefault(settings);
}

// A site's own default (set from a card's menu) wins over the Download button setting, so say so.
function renderSiteDefault(settings) {
  if (!els.siteDefault) return;
  let host = '';
  try { host = new URL(state.data?.tab?.url || '').hostname; } catch {}
  const action = host && settings.defaultActionPerHostname?.[host];
  els.siteDefault.hidden = !action;
  if (!action) return;
  const option = els.settingsForm.elements.defaultAction?.querySelector(`option[value="${action}"]`);
  const text = translate('siteDefaultNote', 'On {host}: {action}').replace('{host}', host.replace(/^www\./, '')).replace('{action}', option?.textContent || action);
  if (els.siteDefaultText.textContent !== text) els.siteDefaultText.textContent = text;
}

function scheduleSave(delay = 150) {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveSettings().catch((error) => showNotice(error.message || String(error), true)), delay);
}

async function saveSettings() {
  clearTimeout(state.saveTimer);
  // Only fields changed here are sent, so a value changed elsewhere meanwhile is not overwritten.
  const fields = new Set(state.dirtyFields);
  if (!fields.size) {
    state.settingsDirty = false;
    return true;
  }
  const form = new FormData(els.settingsForm);
  const patch = {};
  if (fields.has('translations')) {
    try {
      const translations = JSON.parse(String(form.get('translations') || '{}').trim() || '{}');
      if (!translations || Array.isArray(translations) || typeof translations !== 'object' || Object.values(translations).some((value) => typeof value !== 'string')) throw new Error();
      patch.translations = translations;
    } catch {
      els.advanced.open = true;
      showNotice(translate('translationsInvalid', 'Custom labels must be a JSON object of label keys and text.'), true);
      return false;
    }
  }
  if (fields.has('namingRules')) {
    const namingRules = String(form.get('namingRules') || '');
    const validation = validateNamingRules(namingRules);
    if (!validation.ok) {
      els.advanced.open = true;
      showNotice(validation.message || validation.error || translate('namingInvalid', 'File naming rules are not valid.'), true);
      return false;
    }
    patch.namingRules = namingRules;
  }
  const values = {
    concurrentDownloads: () => Number(form.get('concurrentDownloads')),
    historyDays: () => Number(form.get('historyDays')),
    preferredHeight: () => Number(form.get('preferredHeight')),
    preferredContainer: () => String(form.get('preferredContainer')),
    defaultAction: () => String(form.get('defaultAction')),
    theme: () => String(form.get('theme')),
    dock: () => String(form.get('dock')),
    subdirectory: () => String(form.get('subdirectory') || ''),
    desktopNotifications: () => form.get('desktopNotifications') === 'on'
  };
  for (const [name, value] of Object.entries(values)) if (fields.has(name)) patch[name] = value();
  const sent = Object.fromEntries([...fields].map((name) => [name, els.settingsForm.elements[name]?.value]));
  const saved = await send({ type: 'settings.update', patch });
  // Show what was stored (a clamped number, a cleaned folder) even in the focused field, unless the
  // user has typed more since this save started.
  for (const name of fields) {
    const input = els.settingsForm.elements[name];
    if (!input || !(name in (saved || {})) || input.type === 'checkbox' || ['namingRules', 'translations'].includes(name)) continue;
    if (input.value === sent[name] && input.value !== String(saved[name])) input.value = String(saved[name]);
  }
  for (const name of fields) state.dirtyFields.delete(name);
  state.settingsDirty = state.dirtyFields.size > 0;
  els.savedNote.textContent = translate('saved', 'Saved');
  setTimeout(() => { els.savedNote.textContent = ''; }, 2000);
  await refresh();
  return true;
}

// "Open as" changes what the toolbar button opens next time; open that view now as well so the
// choice visibly takes effect.
function switchDock(dock) {
  const popup = document.documentElement.classList.contains('is-popup');
  const windowId = state.data?.tab?.windowId;
  // sidePanel.open needs the click's user gesture, so it starts before anything is awaited.
  const sidePanel = dock === 'side-panel' && popup && Number.isInteger(windowId)
    ? chrome.sidePanel.open({ windowId }).then(() => true, () => false)
    : Promise.resolve(false);
  void (async () => {
    if (!(await saveSettings())) return;
    if (await sidePanel) return window.close();
    if (dock === 'popup' && !popup) {
      // action.openPopup exists from Chrome 127 and fails when the window is not focused.
      let opened = false;
      try {
        if (chrome.action.openPopup) { await chrome.action.openPopup(); opened = true; }
      } catch {}
      if (opened) return window.close();
      showNotice(translate('dockPopupNext', 'Saved. The toolbar button now opens a popup.'));
    } else if (dock === 'side-panel' && popup) {
      showNotice(translate('dockSidePanelNext', 'Saved. The toolbar button now opens the side panel.'));
    }
  })().catch((error) => showNotice(error.message || String(error), true));
}

function focusSettings(name) {
  setView('settings');
  if (name === 'namingRules' || name === 'translations') els.advanced.open = true;
  els.settingsForm.elements[name]?.focus();
}

// ---- Actions ----

async function startCandidate(candidate, action) {
  await withBusy(async () => {
    const selected = selectedCandidate(candidate);
    const filename = action !== 'preview' && state.renamed.has(candidate.id) ? state.editedFilenames.get(candidate.id) : undefined;
    const origins = [originFromUrl(selected.url), originFromUrl(selected.audioUrl)].filter(Boolean);
    await ensureOrigins(origins, needsBilibiliHeaders(candidate) ? [BILIBILI_HEADER_PERMISSION] : []);
    await send({ type: 'job.start', candidateId: candidate.id, variantId: selected.variantId || selected.selectedVariantId, action, filename });
  });
  await refresh();
}

async function runCandidateAction(candidate, action) {
  if (action === 'copy') return copySelectedUrl(candidate);
  return startCandidate(candidate, action);
}

async function copySelectedUrl(candidate) {
  const selected = selectedCandidate(candidate);
  const url = copyUrlForCandidate(candidate, selected);
  await navigator.clipboard.writeText(url);
  showNotice(isSabrSelection(candidate, selected) ? 'Page URL copied.' : 'Media URL copied.');
}

function copyUrlForCandidate(candidate, selected = selectedCandidate(candidate)) {
  if (!isSabrSelection(candidate, selected)) return selected.url;
  const url = sabrPageUrl(candidate, selected);
  if (!url) throw new Error('No public YouTube page URL is available for this format.');
  return url;
}

function sabrPageUrl(candidate, selected = {}) {
  const id = validatedYouTubeVideoId(candidate?.videoId || selected.videoId);
  return id ? `https://www.youtube.com/watch?v=${id}` : '';
}

function isSabrSelection(candidate, selected = {}) {
  return candidate?.kind === 'sabr' || selected.kind === 'sabr' || candidate?.route === 'SABR' || selected.route === 'SABR';
}

function validatedYouTubeVideoId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? id : '';
}

async function setDefaultAction(action, candidate) {
  const perHost = { ...(state.data?.settings?.defaultActionPerHostname || {}) };
  if (candidate) perHost[pageHostname(candidate)] = action;
  else {
    try {
      if (state.data?.tab?.url) delete perHost[new URL(state.data.tab.url).hostname];
    } catch {}
  }
  const patch = candidate ? { defaultActionPerHostname: perHost } : { defaultAction: action, defaultActionPerHostname: perHost };
  await send({ type: 'settings.update', patch });
  showNotice(translate('defaultSaved', 'Default saved.'));
  await refresh();
}

function toggleDetails(candidateId) {
  if (state.openDetails.has(candidateId)) state.openDetails.delete(candidateId);
  else state.openDetails.add(candidateId);
  if (candidateId !== state.selectedId) selectCandidate(candidateId);
  else renderCandidates(state.data?.candidates || [], state.data?.discovery);
}

// ---- Preview ----

async function startPreview(candidate, { requestPermission = false } = {}) {
  if (isProtected(candidate)) return;
  if (state.previewJobs.has(candidate.id) || state.startingPreviews.has(candidate.id)) {
    const card = cardFor(candidate.id);
    if (state.hoveredCandidates.has(candidate.id)) resumePreview(card);
    return;
  }
  const selected = previewCandidate(candidate);
  const variantId = selected.variantId || selected.selectedVariantId || '';
  const origins = [originFromUrl(selected.url), originFromUrl(selected.audioUrl)].filter(Boolean);
  state.startingPreviews.add(candidate.id);
  try {
    if (needsBilibiliHeaders(candidate) && !await chrome.permissions.contains({ permissions: [BILIBILI_HEADER_PERMISSION] })) {
      if (!requestPermission) return;
      await ensureOrigins(origins, [BILIBILI_HEADER_PERMISSION]);
    } else if (requestPermission) await ensureOrigins(origins);
    else if (!(await originsGranted(origins))) {
      updatePreviewVisibility(cardFor(candidate.id), candidate.id, true);
      return;
    }
    const job = await send({ type: 'job.start', candidateId: candidate.id, variantId, action: 'preview' });
    if (shouldKeepPreviewJob(candidate.id, variantId)) {
      state.previewJobs.set(candidate.id, job.id);
      await refresh();
    } else {
      await send({ type: 'job.cancel', jobId: job.id }).catch(() => {});
    }
  } finally {
    state.startingPreviews.delete(candidate.id);
  }
}

async function releasePreview(candidateId, refreshAfter = true) {
  const jobId = state.previewJobs.get(candidateId);
  if (!jobId) return;
  state.previewJobs.delete(candidateId);
  await send({ type: 'job.cancel', jobId });
  if (refreshAfter) await refresh();
}

function cardFor(candidateId) {
  return els.candidateList.querySelector(`[data-candidate-id="${cssEscape(candidateId)}"]`);
}

function pausePreview(candidateId) {
  const media = cardFor(candidateId)?.querySelector('.inline-preview video');
  if (media) media.pause();
}

function resumePreview(card) {
  const candidateId = card?.dataset?.candidateId;
  const media = card?.querySelector('.inline-preview video');
  if (media && state.hoveredCandidates.has(candidateId)) media.play().catch(() => {});
}

function updatePreviewVisibility(card, candidateId, forceAffordance = false) {
  const preview = card?.querySelector('.inline-preview');
  if (!preview) return;
  const visible = forceAffordance || state.hoveredCandidates.has(candidateId);
  preview.classList.toggle('hidden-preview', !visible);
  if (visible && state.hoveredCandidates.has(candidateId)) resumePreview(card);
  else pausePreview(candidateId);
}

function previewJobFor(candidateId) {
  const jobId = state.previewJobs.get(candidateId);
  return (state.data?.jobs || []).find((job) => job.id === jobId);
}

function renderInlinePreview(candidate, job, oldPreview) {
  if (!job) return previewAffordance(candidate);
  if (job.previewUrl && oldPreview?.dataset.previewUrl === job.previewUrl) {
    oldPreview.classList.toggle('hidden-preview', !state.hoveredCandidates.has(candidate.id));
    return oldPreview;
  }
  const shell = element('div', 'inline-preview');
  shell.classList.toggle('hidden-preview', !state.hoveredCandidates.has(candidate.id));
  shell.dataset.previewUrl = job.previewUrl || '';
  if (job.previewUrl) {
    const media = document.createElement('video');
    media.src = job.previewUrl;
    media.preload = 'auto';
    media.muted = true;
    media.playsInline = true;
    media.autoplay = true;
    media.loop = true;
    media.controls = false;
    media.addEventListener('canplay', () => media.play().catch(() => {}), { once: true });
    shell.append(media);
  } else {
    shell.append(element('span', 'preview-status', job.phase === 'failed' ? '' : translate('preparingPreview', 'Preparing preview')));
  }
  if (job.error) shell.append(element('span', 'preview-status', job.error.code === 'storage'
    ? translate('previewTooLarge', 'Too long to preview. Download it to watch.')
    : job.error.message || translate('previewFailed', 'Preview failed')));
  return shell;
}

function previewAffordance(candidate) {
  const shell = element('div', 'inline-preview hidden-preview preview-click');
  const control = element('button', 'preview-button');
  control.type = 'button';
  control.append(icon('play'), document.createTextNode(translate('preview', 'Preview')));
  control.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.hoveredCandidates.add(candidate.id);
    await startPreview(candidate, { requestPermission: true });
  });
  shell.append(control);
  return shell;
}

function shouldKeepPreviewJob(candidateId, variantId) {
  if (!cardFor(candidateId)) return false;
  const current = previewCandidate(state.data?.candidates?.find((item) => item.id === candidateId) || { id: candidateId, variants: [] });
  return (current.variantId || current.selectedVariantId || '') === variantId;
}

// A preview keeps only the first seconds (engine.js) but fetches its whole input first, within a
// 128 MiB cap, so it plays the smallest quality: a long 1080p video would otherwise be rejected.
// YouTube keeps the selected format, whose route (FMT or SABR) the preview has to match.
function previewCandidate(candidate) {
  const selected = selectedCandidate(candidate);
  const variants = (candidate.variants || []).filter((variant) => variant.hasVideo !== false);
  if (candidate.adapterId === 'youtube' || variants.length < 2) return selected;
  const side = (variant) => variant.width > 0 && variant.height > 0 ? Math.min(variant.width, variant.height) : variant.height || Infinity;
  const smallest = Math.min(...variants.map(side));
  if (side(selected) <= smallest) return selected;
  const container = state.data?.settings?.preferredContainer;
  const [pick] = variants.filter((variant) => side(variant) === smallest).sort((a, b) => Number(a.container !== container) - Number(b.container !== container)
    || Number(Boolean(a.audioUrl)) - Number(Boolean(b.audioUrl)) || (a.bitrate || Infinity) - (b.bitrate || Infinity));
  return selectVariant(candidate, pick.id, state.data?.settings);
}

// ---- Variants, names and labels ----

function selectedCandidate(candidate) {
  return safeSelectVariant(candidate, state.selectedVariants.get(candidate.id) || candidate.selectedVariantId);
}

function safeSelectVariant(candidate, variantId) {
  try {
    return selectVariant(candidate, variantId, state.data?.settings || {});
  } catch {
    const selected = selectVariant(candidate, '', state.data?.settings || {});
    state.selectedVariants.set(candidate.id, selected.selectedVariantId || selected.variantId || '');
    return selected;
  }
}

function actionForCandidate(candidate) {
  const hostname = pageHostname(candidate);
  return state.data?.settings?.defaultActionPerHostname?.[hostname] || state.data?.settings?.defaultAction || 'download';
}

function pageHostname(candidate) {
  try {
    return new URL(candidate.pageOrigin || state.data?.tab?.url || selectedCandidate(candidate).url).hostname;
  } catch {
    return hostLabel(selectedCandidate(candidate).url);
  }
}

function fallbackVariant(candidate) {
  return {
    id: '',
    url: candidate.url,
    audioUrl: candidate.audioUrl,
    kind: candidate.kind,
    mimeType: candidate.mimeType,
    container: inferContainer(candidate),
    height: candidate.height,
    width: candidate.width,
    bitrate: candidate.bitrate,
    fps: candidate.fps,
    codecs: candidate.codecs,
    duration: candidate.duration || candidate.durationSeconds,
    contentLength: candidate.contentLength,
    audioContentLength: candidate.audioContentLength,
    hasAudio: candidate.hasAudio,
    hasVideo: candidate.hasVideo
  };
}

const QUALITY_NAMES = { 4320: '8K', 2160: '4K', 1440: 'QHD', 1080: 'Full HD', 720: 'HD', 480: 'SD', 360: 'SD', 240: 'Low', 144: 'Low' };

// Portrait video is named by its short side: a 1080 x 1920 clip is 1080p.
function quality(variant = {}) {
  if (variant.hasVideo === false) return { hasVideo: false, face: translate('audioOnly', 'Audio only'), option: translate('audioOnly', 'Audio only') };
  const width = Number(variant.width);
  const height = Number(variant.height);
  const short = width > 0 && height > 0 ? Math.min(width, height) : height > 0 ? height : 0;
  if (!short) return { hasVideo: true, face: translate('original', 'Original'), option: translate('original', 'Original') };
  const name = QUALITY_NAMES[short];
  const portrait = width > 0 && height > width;
  return {
    hasVideo: true,
    portrait,
    face: `${short}p${short >= 2160 && name ? ` ${name}` : ''}`,
    option: `${short}p${name ? ` ${name}` : ''}${portrait ? ` ${translate('portrait', 'portrait')}` : ''}`
  };
}

function variantLabel(variant, candidate = {}) {
  return [quality(variant).option, (variant.container || inferContainer(variant)).toUpperCase(), variantDetails(variant), sizeText(variant, candidate)].filter(Boolean).join(' · ');
}

function variantDetails(variant) {
  const codecs = variant.codecs || /codecs\s*=\s*["']?([^"';]+)/i.exec(variant.mimeType || '')?.[1] || '';
  const codec = codecs.split(',').map(value => {
    const name = value.trim().toLowerCase();
    if (/^(avc[13]|h264)/.test(name)) return 'H.264';
    if (/^(hev1|hvc1|hevc|h265)/.test(name)) return 'H.265';
    if (/^(av01|av1)/.test(name)) return 'AV1';
    if (/^(vp09|vp9)/.test(name)) return 'VP9';
    if (/^(vp08|vp8)/.test(name)) return 'VP8';
    return '';
  }).find(Boolean);
  const fps = Number(variant.fps);
  return [
    codec,
    Number.isFinite(fps) && fps > 0 ? `${Number(fps.toFixed(2))} fps` : '',
    formatBitrate(variant.bitrate)
  ].filter(Boolean).join(' · ');
}

// Exact when the server said how big the file is; otherwise an estimate from bitrate and length.
function sizeText(variant = {}, candidate = {}) {
  const video = Number(variant.contentLength) || 0;
  const audio = Number(variant.audioContentLength) || 0;
  const needsAudio = Boolean(variant.audioUrl);
  if (video && (!needsAudio || audio)) return formatBytes(video + audio);
  const duration = Number(variant.duration || candidate.durationSeconds || candidate.duration) || 0;
  const bitrate = Number(variant.bitrate) || 0;
  if (duration > 0 && bitrate > 0) {
    const bits = bitrate * duration + (needsAudio && !audio ? 128000 * duration : 0);
    return `~${formatBytes(bits / 8 + audio)}`;
  }
  return video ? `~${formatBytes(video)}` : '';
}

function candidateSignature(candidate, variants, selected, previewJob, detailsOpen, isSelected) {
  return JSON.stringify({
    id: candidate.id,
    isSelected,
    title: candidate.title,
    route: candidate.route,
    thumbnail: candidate.thumbnail,
    selected: selected.variantId || selected.selectedVariantId || '',
    filename: displayFilename(candidate, selected),
    detailsOpen,
    defaultAction: actionForCandidate(candidate),
    protection: candidate.protection,
    variants: variants.map((variant) => [variant.id, variant.container, variant.width, variant.height, variant.bitrate, variant.mimeType, variant.codecs, variant.fps, variant.url, variant.audioUrl, variant.contentLength]),
    hovered: isSelected && state.hoveredCandidates.has(candidate.id),
    preview: previewJob ? [previewJob.id, previewJob.phase, previewJob.previewUrl, previewJob.error?.message] : null,
    labels: state.data?.settings?.translations || {}
  });
}

function displayFilename(candidate, selected) {
  return state.renamed.has(candidate.id) ? state.editedFilenames.get(candidate.id) || currentFilename(candidate, selected) : currentFilename(candidate, selected);
}

// The name the download gets: the naming rules from Settings (the folder is added when saving).
function currentFilename(candidate, selected) {
  const title = candidate.title || 'Untitled media';
  try {
    return buildFilename({ title, author: candidate.author, url: selected.url || candidate.url, extension: selectedExtension(selected), rules: state.data?.settings?.namingRules || '' });
  } catch {
    return withSelectedExtension(`${safeName(title)}.${selectedExtension(selected)}`, selected);
  }
}

function withSelectedExtension(filename, selected) {
  const extension = selectedExtension(selected);
  const cleaned = String(filename || '').trim() || `Untitled media.${extension}`;
  return /\.[a-z0-9]{1,8}$/i.test(cleaned) ? cleaned.replace(/\.[a-z0-9]{1,8}$/i, `.${extension}`) : `${cleaned}.${extension}`;
}

function selectedExtension(selected) {
  // Native HLS determines its final extension from the first segment when saving.
  if (selected.kind === 'hls' && !selected.audioUrl && !chrome.extension.inIncognitoContext) return selected.container === 'ts' ? 'ts' : 'mp4';
  if (selected.container === 'webm') return 'webm';
  if (selected.container === 'm4a') return 'm4a';
  if (selected.container === 'mp3') return 'mp3';
  if (selected.kind === 'hls' || selected.kind === 'dash') return stitchedContainer(state.data?.settings?.preferredContainer, selected.codecs);
  if (/webm/i.test(selected.mimeType || '')) return 'webm';
  return selected.container || 'mp4';
}

function inferContainer(item) {
  if (/webm/i.test(item.mimeType || '')) return 'webm';
  if (/audio\/mp4|m4a/i.test(item.mimeType || '')) return 'm4a';
  return 'mp4';
}

function safeName(value) {
  return String(value || 'Untitled media').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) || 'Untitled media';
}

function isProtected(candidate) {
  return candidate?.protection === 'unsupported-drm';
}

function primaryLabel(action, candidate, selected) {
  if (action === 'download-as') return translate('downloadas', 'Download As…');
  if (action === 'audio') return translate('downloadaudio', 'Download Audio');
  if (action === 'copy') return copyUrlLabel(candidate, selected);
  return translate('download', 'Download');
}

function copyUrlLabel(candidate, selected) {
  return isSabrSelection(candidate, selected) ? translate('copyPageUrl', 'Copy Page URL') : translate('copyUrl', 'Copy URL');
}

function menuItem(label, handler, { checked = false, key = '' } = {}) {
  const control = element('button', `menu-item${checked ? ' is-checked' : ''}`);
  control.type = 'button';
  if (checked) control.setAttribute('aria-pressed', 'true');
  control.append(document.createTextNode(label));
  if (key) {
    const hint = element('span', 'key', key);
    hint.ariaHidden = 'true';
    control.append(hint);
  }
  control.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      await handler();
    } catch (error) {
      showNotice(error.message || String(error), true);
    }
  });
  return control;
}

function renderDetails(candidate, selected) {
  const details = element('dl', 'candidate-details');
  const sabr = isSabrSelection(candidate, selected);
  const rows = [
    ['Route', candidate.route || candidate.kind],
    ['Container', selected.container],
    ['Kind', selected.kind],
    ['Resolution', selected.width && selected.height ? `${selected.width}x${selected.height}` : selected.height ? `${selected.height}p` : ''],
    ['Bitrate', formatBitrate(selected.bitrate)],
    ['Video itag', sabr ? selected.videoItag : ''],
    ['Audio itag', sabr ? selected.audioItag : ''],
    ['Video bytes', selected.contentLength ? formatBytes(selected.contentLength) : ''],
    ['Audio bytes', selected.audioContentLength ? formatBytes(selected.audioContentLength) : ''],
    ['Duration', formatDuration(selected.duration || candidate.durationSeconds)],
    [sabr ? 'Page URL' : 'Host', sabr ? sabrPageUrl(candidate, selected) : hostLabel(selected.url)]
  ];
  for (const [term, value] of rows.filter(([, value]) => value)) details.append(element('dt', '', term), element('dd', '', String(value)));
  return details;
}

// ---- Empty states ----

function emptyKey(discovery) {
  const tabUrl = state.data?.tab?.url || '';
  return [tabUrl, state.data?.permissions?.hasHostAccess, discovery?.phase, discovery?.message, state.data?.protection?.drm, state.data?.protection?.site, JSON.stringify(state.data?.settings?.translations || {})].join('|');
}

function emptyCandidateNode(discovery, key) {
  const host = hostLabel(state.data?.tab?.url).replace(/^www\./, '');
  const allowed = Boolean(state.data?.permissions?.hasHostAccess);
  let node;
  if (!/^https?:/.test(state.data?.tab?.url || '')) {
    node = emptyNode(translate('openWebPage', 'Open a web page'), translate('openWebPageBody', 'VideoDownloadStudio finds videos on web pages. Open one, then come back here.'));
  } else if (state.data?.protection?.drm) {
    // Streaming services encrypt their titles with DRM; finding nothing there is expected, not a failure.
    const site = state.data.protection.site;
    node = emptyNode(translate('protectedTitle', 'This video is protected'), site
      ? translate('protectedSiteBody', '{site} encrypts its videos with DRM, so they cannot be saved. VideoDownloadStudio does not remove copy protection.').replace('{site}', site)
      : translate('protectedBody', 'This page plays its video with DRM encryption, so it cannot be saved. VideoDownloadStudio does not remove copy protection.'), { lock: true });
  } else if (isYouTubePage(state.data?.tab?.url) && discovery?.phase === 'extracting') {
    node = emptyNode(translate('extractingFormats', 'Reading formats from YouTube'), discovery.message || translate('extractingFormatsBody', 'Keep the video tab open. This takes a few seconds.'), { prints: true, developing: true, scan: translate('findAgain', 'Find Videos Again'), quiet: true });
  } else if (isYouTubePage(state.data?.tab?.url) && discovery?.phase === 'failed') {
    node = emptyNode(translate('noVerifiedYouTubeFormats', 'No verified YouTube formats'), discovery.message || translate('noVerifiedYouTubeFormatsBody', 'The extractor could not resolve downloadable formats for this video.'), { scan: translate('findAgain', 'Find Videos Again') });
  } else if (allowed && discovery?.phase === 'searching') {
    // Social sites list their videos a few seconds after the page loads; say so instead of "none found".
    node = emptyNode(translate('searchingTitle', 'Looking for videos'), translate('searchingBody', 'Videos on {host} appear here in a few seconds.').replace('{host}', host || 'this page'), { prints: true, developing: true });
  } else if (!allowed) {
    node = emptyNode(translate('findTitle', 'Find the videos on this page.'), translate('findBody', 'VideoDownloadStudio needs permission to read {host}. Files are made on your computer; nothing is uploaded.').replace('{host}', host || 'this site'), { prints: true, scan: translate('scan', 'Find Videos'), large: true });
  } else {
    node = emptyNode(translate('noMediaYet', 'No videos found yet'), isYouTubePage(state.data?.tab?.url)
      ? translate('noMediaYouTubeBody', 'Open a video page, then click Find Videos.')
      : translate('noMediaBody', 'Start the video playing, then click Find Videos. Some sites only load video when it plays.'), { prints: true, scan: translate('scan', 'Find Videos') });
  }
  node.dataset.emptyKey = key;
  return node;
}

function emptyNode(title, body, { prints = false, developing = false, scan = '', quiet = false, large = false, small = false, lock = false } = {}) {
  const node = element('div', developing ? 'empty is-searching' : 'empty');
  if (lock) {
    const mark = element('div', 'empty-lock');
    mark.append(icon('lock'));
    node.append(mark);
  }
  if (prints) {
    const fan = element('div', 'fan');
    fan.ariaHidden = 'true';
    for (let index = 0; index < 3; index += 1) {
      const print = element('div', `print is-blank${developing ? ' is-developing' : ''}`);
      const frame = element('div', 'img');
      frame.append(icon('film'));
      print.append(frame);
      fan.append(print);
    }
    node.append(fan);
  }
  node.append(element('h2', large ? '' : 'is-small', title), element('p', '', body));
  if (small) node.querySelector('h2').style.fontSize = '17px';
  if (scan) {
    const control = element('button', quiet ? 'cta is-quiet' : 'cta');
    control.type = 'button';
    control.dataset.scan = 'true';
    control.append(icon('refresh'), document.createTextNode(scan));
    node.append(control);
  }
  return node;
}

// ---- Permissions and messaging ----

async function ensurePageAccess() {
  const origin = state.data?.permissions?.origin;
  if (!origin) throw new Error('This tab does not have a web origin.');
  // Social sites stream from separate CDN hosts, and embedded players from their own site; the
  // service lists all of them for this page, so ask for them together.
  const patterns = state.data?.permissions?.accessPatterns;
  await ensurePatterns(patterns?.length ? patterns : accessPatternsForUrl(state.data?.tab?.url || origin));
}

async function ensureOrigins(origins, permissions = []) {
  const patterns = Array.from(new Set(origins.filter(Boolean).map((origin) => `${origin}/*`)));
  if (!patterns.length) throw new Error('No HTTP or HTTPS origin was found.');
  await ensurePatterns(patterns, permissions);
}

async function ensurePatterns(patterns, permissions = []) {
  if (!patterns.length) return;
  const granted = await chrome.permissions.request({ origins: patterns, ...(permissions.length ? { permissions } : {}) });
  if (!granted) throw new Error('Chrome did not grant access to that site.');
}

async function originsGranted(origins) {
  const patterns = Array.from(new Set(origins.filter(Boolean).map((origin) => `${origin}/*`)));
  if (!patterns.length) return true;
  try {
    if (await chrome.permissions.contains({ origins: patterns })) return true;
  } catch {}
  return hasOriginsGranted(origins);
}

function hasOriginsGranted(origins) {
  const granted = state.data?.permissions?.granted?.origins || [];
  return origins.every((origin) => granted.some((pattern) => patternMatchesOrigin(pattern, origin)));
}

function patternMatchesOrigin(pattern, origin) {
  try {
    const originUrl = new URL(origin);
    const match = String(pattern).match(/^(https?):\/\/([^/]+)\/\*$/);
    if (!match || `${match[1]}:` !== originUrl.protocol) return false;
    const host = match[2];
    if (host === '*') return true;
    if (host.startsWith('*.')) return originUrl.hostname === host.slice(2) || originUrl.hostname.endsWith(`.${host.slice(2)}`);
    return originUrl.host === host || originUrl.hostname === host;
  } catch {
    return false;
  }
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}

async function withBusy(task) {
  state.busy = true;
  setBusy(true);
  try {
    await task();
  } catch (error) {
    showNotice(error.message || String(error), true);
  } finally {
    state.busy = false;
    setBusy(false);
  }
}

async function send(message) {
  const response = await chrome.runtime.sendMessage({ target: 'service', ...message });
  if (!response?.ok) throw new Error(response?.error?.message || 'Extension service did not respond.');
  return response.data;
}

async function targetWebTab(existingTabId) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (/^https?:/.test(active?.url || '')) return active;
  if (Number.isInteger(existingTabId)) {
    try {
      const tab = await chrome.tabs.get(existingTabId);
      if (/^https?:/.test(tab?.url || '')) return tab;
    } catch {}
  }
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => /^https?:/.test(tab.url || ''))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
}

// ---- Small builders ----

function button(label, handler, className = 'btn', iconId = '') {
  const control = element('button', className);
  control.type = 'button';
  if (iconId) control.append(icon(iconId));
  control.append(document.createTextNode(label));
  control.addEventListener('click', async () => {
    try {
      await handler();
    } catch (error) {
      showNotice(error.message || String(error), true);
    }
  });
  return control;
}

function progress(percent = 0) {
  const outer = element('div', 'progress');
  outer.setAttribute('role', 'progressbar');
  outer.setAttribute('aria-label', translate('downloadProgress', 'Download progress'));
  outer.setAttribute('aria-valuenow', String(Math.round(percent || 0)));
  const inner = element('span');
  inner.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
  outer.append(inner);
  return outer;
}

function markNode(iconId, negative = false) {
  const mark = element('span', `mark${negative ? ' is-negative' : ''}`);
  mark.append(icon(iconId));
  return mark;
}

function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.append(use);
  return svg;
}

function hostLabel(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function formatBytes(bytes = 0) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatBitrate(bits = 0) {
  if (!bits) return '';
  return bits >= 1000000 ? `${Number((bits / 1000000).toFixed(2))} Mbps` : `${Math.round(bits / 1000)} kbps`;
}

function formatDuration(seconds = 0) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return '';
  const total = Math.round(Number(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}

// Today shows the time; this week shows the day; older shows the date.
function formatWhen(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const today = new Date();
  const startOfDay = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(today) - startOfDay(date)) / 86400000);
  if (days <= 0) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return translate('yesterday', 'Yesterday');
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function showNotice(message, error = false) {
  els.notice.textContent = message;
  els.notice.classList.remove('hidden');
  els.notice.classList.toggle('is-error', error);
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => els.notice.classList.add('hidden'), 4500);
}

function applyTheme(theme) {
  const value = ['dark', 'light'].includes(theme) ? theme : 'system';
  // Runs every refresh; an unchanged write would still restyle the whole panel.
  if (document.body.dataset.theme !== value) document.body.dataset.theme = value;
}

function setBusy(disabled) {
  for (const control of document.querySelectorAll('button,input,select,textarea')) {
    control.disabled = disabled;
  }
  if (!disabled && state.data) renderHeader(state.data.tab, state.data.permissions, state.data.candidates || []);
}

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function translate(key, fallback) { return localize(key, fallback, state.data?.settings?.translations || {}); }
