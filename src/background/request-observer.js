// Register network observation only after the user grants host access.
export function createRequestObserver(api, observe) {
  let signature = '';
  let pending = Promise.resolve();
  const listener = details => { void Promise.resolve().then(() => observe(details)).catch(() => {}); };
  function refresh() {
    pending = pending.catch(() => {}).then(async () => {
      const granted = await api.permissions.getAll();
      const origins = [...new Set((granted.origins || []).flatMap(origin =>
        origin === '<all_urls>' ? ['http://*/*', 'https://*/*'] : /^(https?|\*):\/\//.test(origin) ? [origin] : []
      ))].sort();
      const next = origins.join('\n');
      if (next === signature) return;
      if (api.webRequest.onHeadersReceived.hasListener(listener)) api.webRequest.onHeadersReceived.removeListener(listener);
      signature = '';
      if (origins.length) {
        api.webRequest.onHeadersReceived.addListener(listener, { urls: origins }, ['responseHeaders']);
        signature = next;
      }
    });
    return pending;
  }
  const onChanged = () => { void refresh().catch(console.error); };
  api.permissions.onAdded.addListener(onChanged);
  api.permissions.onRemoved.addListener(onChanged);
  return { refresh };
}
