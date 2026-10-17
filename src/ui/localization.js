const CUSTOM_KEY_ALIASES = Object.freeze({
  downloadas: 'downloadAs',
  downloadaudio: 'downloadAudio',
  copyurl: 'copyUrl',
  saveSettings: 'savesettings'
});

export function localize(key, fallback = '', custom = {}) {
  const rawKey = String(key || '').trim();
  const direct = customValue(custom, rawKey);
  if (direct) return direct;
  const alias = CUSTOM_KEY_ALIASES[rawKey];
  const aliased = alias ? customValue(custom, alias) : '';
  if (aliased) return aliased;
  const message = getChromeMessage(rawKey) || getChromeMessage(alias);
  return message || String(fallback || '');
}

// The panel calls this on every refresh, so it only writes what changed: rewriting an <option>'s
// text closes its open menu, and rewriting labels re-announces them to screen readers.
export function localizeDocument(root = document, custom = {}) {
  for (const node of root.querySelectorAll('[data-label]')) {
    node.dataset.defaultText ||= node.textContent;
    const text = localize(node.dataset.label, node.dataset.defaultText, custom);
    if (node.textContent !== text) node.textContent = text;
  }
  for (const node of root.querySelectorAll('[data-title-label]')) {
    node.dataset.defaultTitle ||= node.getAttribute('title') || '';
    setChanged(node, 'title', localize(node.dataset.titleLabel, node.dataset.defaultTitle, custom));
  }
  for (const node of root.querySelectorAll('[data-placeholder-label]')) {
    node.dataset.defaultPlaceholder ||= node.getAttribute('placeholder') || '';
    setChanged(node, 'placeholder', localize(node.dataset.placeholderLabel, node.dataset.defaultPlaceholder, custom));
  }
  for (const node of root.querySelectorAll('[data-aria-label-key]')) {
    node.dataset.defaultAriaLabel ||= node.getAttribute('aria-label') || '';
    setChanged(node, 'aria-label', localize(node.dataset.ariaLabelKey, node.dataset.defaultAriaLabel, custom));
  }
}

function setChanged(node, name, value) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function customValue(custom, key) {
  const value = custom?.[key];
  return typeof value === 'string' && value.trim() ? value : '';
}

function getChromeMessage(key) {
  if (!key || !globalThis.chrome?.i18n?.getMessage) return '';
  try {
    return chrome.i18n.getMessage(key) || '';
  } catch {
    return '';
  }
}
