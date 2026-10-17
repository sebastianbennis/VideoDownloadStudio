export const DEFAULT_SETTINGS = Object.freeze({
  concurrentDownloads: 3,
  historyDays: 0,
  dock: 'popup',
  theme: 'system',
  preview: 'video',
  preferredHeight: 1080,
  preferredContainer: 'mp4',
  desktopNotifications: false,
  defaultAction: 'download',
  defaultActionPerHostname: {},
  namingRules: '',
  subdirectory: '',
  translations: {}
});

const NUMERIC_LIMITS = Object.freeze({
  concurrentDownloads: [1, 6],
  historyDays: [0, 365],
  preferredHeight: [144, 4320]
});

const ENUMS = Object.freeze({
  dock: ['popup', 'side-panel'],
  theme: ['system', 'dark', 'light'],
  preview: ['video', 'audio'],
  defaultAction: ['download', 'download-as', 'audio', 'copy'],
  preferredContainer: ['mp4', 'mkv', 'ts']
});

export function normalizeSettings(value = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(cleanObject(value)).filter(([key]) => Object.hasOwn(DEFAULT_SETTINGS, key))) };
  for (const [key, [min, max]] of Object.entries(NUMERIC_LIMITS)) {
    const number = Number(settings[key]);
    settings[key] = Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : DEFAULT_SETTINGS[key];
  }
  for (const [key, values] of Object.entries(ENUMS)) {
    if (!values.includes(settings[key])) settings[key] = DEFAULT_SETTINGS[key];
  }
  settings.desktopNotifications = Boolean(settings.desktopNotifications);
  settings.defaultActionPerHostname = normalizeDefaultActionPerHostname(settings.defaultActionPerHostname);
  settings.namingRules = String(settings.namingRules || '').slice(0, 8000);
  settings.subdirectory = sanitizeSubdirectory(settings.subdirectory);
  settings.translations = Object.fromEntries(Object.entries(cleanObject(settings.translations)).filter(([key,value]) => /^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(key) && typeof value === 'string' && value.length <= 300).slice(0,100));
  return settings;
}

function normalizeDefaultActionPerHostname(value) {
  return Object.fromEntries(Object.entries(cleanObject(value))
    .filter(([hostname, action]) => /^[a-z0-9.-]{1,253}$/i.test(hostname) && ENUMS.defaultAction.includes(action))
    .slice(0, 200));
}

export function mergeSettings(current, patch) {
  return normalizeSettings({ ...normalizeSettings(current), ...cleanObject(patch) });
}

export function sanitizeSubdirectory(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== '.' && part !== '..')
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, '').slice(0, 80))
    .filter(Boolean)
    .join('/');
}

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => typeof key === 'string'));
}
