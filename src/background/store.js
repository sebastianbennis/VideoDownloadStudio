import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings.js';
import { validateNamingRules } from '../naming.js';
let writing = Promise.resolve();
const session = chrome.storage.session;
const SESSION_KEY = chrome.extension.inIncognitoContext ? 'vdsPrivateSession' : 'vdsSession';
export async function loadState() {
  await writing;
  const [local, transient] = await Promise.all([chrome.storage.local.get('vdsPreferences'), session.get(SESSION_KEY)]);
  const preferences = local.vdsPreferences || {};
  const settings = normalizeSettings(transient[SESSION_KEY]?.privateSettings || preferences.settings || DEFAULT_SETTINGS);
  const privateContext = chrome.extension.inIncognitoContext;
  const cutoff = Date.now() - settings.historyDays * 86400000;
  return { settings, jobs: transient[SESSION_KEY]?.jobs || [], candidates: transient[SESSION_KEY]?.candidates || [], history: privateContext || !settings.historyDays ? [] : (preferences.history || []).filter(x => x.createdAt >= cutoff) };
}
export function mutateState(change) {
  const operation = writing.then(async () => {
    const [local, transient] = await Promise.all([chrome.storage.local.get('vdsPreferences'), session.get(SESSION_KEY)]);
    const old = { settings: normalizeSettings(transient[SESSION_KEY]?.privateSettings || local.vdsPreferences?.settings), history: local.vdsPreferences?.history || [], jobs: transient[SESSION_KEY]?.jobs || [], candidates: transient[SESSION_KEY]?.candidates || [] };
    const next = change(old) || old;
    await session.set({ [SESSION_KEY]: { jobs: next.jobs.slice(-100), candidates: next.candidates.slice(-800), ...(chrome.extension.inIncognitoContext ? {privateSettings: next.settings} : {}) } });
    if (!chrome.extension.inIncognitoContext) await chrome.storage.local.set({ vdsPreferences: { settings: next.settings, history: next.settings.historyDays ? next.history.filter(x => x.createdAt >= Date.now() - next.settings.historyDays * 86400000).slice(-300) : [] } });
    return next;
  });
  writing = operation.catch(() => {});
  return operation;
}
export function saveState(patch) { return mutateState(state => ({ ...state, ...patch })); }
export function updateSettings(patch) {
  const valid = validateNamingRules(String(patch.namingRules || ''));
  if (patch.namingRules && !valid.ok) throw new Error(valid.message || 'Invalid naming rules.');
  return mutateState(state => ({ ...state, settings: normalizeSettings({ ...state.settings, ...patch }) }));
}
