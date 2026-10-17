# Privacy

Applies to VideoDownloadStudio 0.2.1. Updated 2026-10-17.

VideoDownloadStudio has no developer-operated backend, analytics or advertising service. It does not require an extension account. Media conversion and merging run locally using bundled WebAssembly.

## Information used

After you grant site access, the extension inspects page and player metadata, media URLs and relevant network responses to find downloadable media. Titles, thumbnails, formats and URLs are shown in the panel. Media and metadata requests go to the relevant websites and their CDNs, which receive normal network information such as your IP address.

Permitted media fetches can include browser-managed cookies. Certain site adapters use the current page's session. YouTube page metadata uses a fixed same-origin endpoint; extension-hosted YouTube metadata and integrity requests omit credentials. The extension does not request the Chrome cookies API or export cookie values. It does not send browsing data to the maintainer.

Experimental YouTube SABR support uses the interpreter already loaded by the granted YouTube page and a fixed Google integrity endpoint. Video-bound playback proofs remain in memory and are excluded from persistent history and UI details. Player transform snippets run in a bundled, bounded QuickJS worker without browser or network callbacks.

## Local storage

- Preferences and custom labels are stored in extension-local storage.
- Discovered candidates and current jobs use browser session storage.
- History is off by default. If enabled, it records title, filename, size, action and time, without media URLs. Use the extension's history controls to clear it.
- Normal direct and eligible HLS jobs temporarily spool media into browser origin-private storage. Cleanup runs after completion or cancellation and during recovery. Failed or interrupted browser sessions can require later cleanup.
- Private jobs use separate session state and do not write persistent history. Files you choose to save remain in your downloads folder until you delete them.

Removing the extension removes its extension-managed settings and storage. It does not delete downloaded files or Chrome's own download history.

## Permissions

Core permissions support scanning (`activeTab`, `scripting`, `webRequest`, `webNavigation`), preferences and session state (`storage`), saving (`downloads`), processing (`offscreen`), the interface (`sidePanel`) and maintenance (`alarms`).

HTTP/HTTPS host access is optional and requested for the page and relevant media hosts. **Allow All Websites** grants broader access only when selected and approved through Chrome. Host access can be revoked in Chrome's extension settings. Notifications are optional.

Bilibili separately requests `declarativeNetRequestWithHostAccess` to set its required Referer header on extension-originated GET requests for the exact selected media URLs on allowed Bilibili CDNs. Rules follow active jobs and are removed on completion, failure, cancellation or permission loss, with maintenance recovery.

## External links

The X and GitHub footer links open only when selected. Those sites apply their own privacy policies. The extension does not add tracking analytics to these links.

Questions can be directed to the maintainer through the GitHub profile linked in the README. Never include cookies, credentials or private media URLs in a public issue.
