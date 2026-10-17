export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  concurrentDownloads: 3,
  historyDays: 0,
  dock: 'popup',
  theme: 'system',
  preview: 'video',
  preferredHeight: 1080,
  preferredContainer: 'mp4',
  desktopNotifications: false,
  namingRules: '',
  subdirectory: '',
  translations: {}
});

export const MEDIA_KINDS = Object.freeze(['direct', 'hls', 'dash', 'sabr']);
export const OUTPUT_ACTIONS = Object.freeze(['download', 'download-as', 'audio', 'preview']);

