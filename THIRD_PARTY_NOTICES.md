# Third Party Notices

VideoDownloadStudio 0.2.1 bundles a pinned FFmpeg WebAssembly core for local remuxing and audio extraction.

## @ffmpeg/core 0.12.10

- Runtime package: `@ffmpeg/core` 0.12.10
- Runtime package license field: GPL-2.0-or-later
- Bundled license copy: `vendor/media/GPL-2.0-or-later.txt`
- Runtime provenance file: `vendor/media/ffmpeg-core-PROVENANCE.txt`
- Source archive manifest and retrieval script: `docs/external/media-engine/source-archives.json` and `scripts/fetch-media-source.mjs` in `VideoDownloadStudio-0.2.1-source.zip`, attached to the 0.2.1 release on GitHub together with the upstream source archives.
- NPM package page: https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10
- NPM tarball: https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz
- NPM integrity: `sha512-dzNplnn2Nxle2c2i2rrDhqcB19q9cglCkWnoMTDN9Q9l3PvdjZWd1HfSPjCNWc/p8Q3CT+Es9fWOR0UhAeYQZA==`
- NPM shasum: `3177e88852bfbfaad5d258e9e0ac1fd9dffd3223`
- NPM publish time for `0.12.10`: `2025-01-07T10:13:14.328Z`
- Upstream repository: https://github.com/ffmpegwasm/ffmpeg.wasm
- Correct upstream source tag for `@ffmpeg/core` 0.12.10: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15
- Correct upstream source tag commit: `71aa99d37c02a7b4c435275ca9ef50e612f6efa1`
- Upstream build guide: https://github.com/ffmpegwasm/ffmpeg.wasm/blob/v12.15/apps/website/docs/contribution/core.md
- Upstream build recipe files: `Dockerfile`, `Makefile`, and `build/*.sh` in the `v12.15` tag

Bundled runtime files and SHA-256 hashes:

- `vendor/media/ffmpeg-core.js`: `67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3`
- `vendor/media/ffmpeg-core.wasm`: `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7`
- `vendor/media/GPL-2.0-or-later.txt`: `edaef632cbb643e4e7a221717a6c441a4c1a7c918e6e4d56debc3d8739b233f6`

Provenance correction: the upstream `v0.12.10` tag is not corresponding source for `@ffmpeg/core` 0.12.10. In that tag, `packages/core/package.json` declares `@ffmpeg/core` 0.12.6. The correct source tag is `v12.15`, where `packages/core/package.json` declares `@ffmpeg/core` 0.12.10 and GPL-2.0-or-later.

The published NPM tarball contains built distribution files and package metadata, not the full corresponding source tree. The source archive manifest in the release source ZIP records the `v12.15` upstream source archive plus dependency source archives and hashes. The upstream `v12.15` Dockerfile uses Emscripten 3.1.40, FFmpeg n5.1.4, x264, x265, libvpx, LAME, zimg, and other external libraries. LAME is referenced as mutable `master` in the upstream Dockerfile, so the local archive records the current remote resolution, not proven publish-time source. The recorded LAME commit is `2badea1974ae36cb8312afe99cff1e6b3b5decee`, committed on `2020-10-29T11:19:54+08:00`, which predates the `@ffmpeg/core` 0.12.10 NPM publish time of `2025-01-07T10:13:14.328Z`. zimg is cloned with `--recursive`; its `test/extra/googletest` submodule is recorded separately as `zimg-googletest` in that source archive manifest.

Direct media is fetched through the extension's guarded pipeline into temporary local storage, then handed to Chrome's downloads API as a local blob. Clear HLS and DASH media are fetched locally and passed to FFmpeg for remuxing when needed.

## youtubei.js 18.1.0

- Runtime package: `youtubei.js` 18.1.0
- Runtime package license field: MIT
- Bundled license copy: `vendor/youtube/youtubei.js-LICENSE.txt`
- Runtime provenance file: `vendor/youtube/PROVENANCE.txt`
- NPM package page: https://www.npmjs.com/package/youtubei.js/v/18.1.0
- Upstream repository: https://github.com/LuanRT/YouTube.js
- Bundled runtime file: `src/background/youtube/provider.bundle.js`, which includes the package's browser build (`vendor/youtube/youtubei-browser.js` in the source tree)

The package parses YouTube player metadata and streaming formats through guarded fetch paths. Page-side metadata can use the browser-managed YouTube session; extension-hosted metadata requests omit credentials. A dedicated experimental SABR reader handles selected adaptive formats, while generic direct downloads reject UMP playback envelopes. See PRIVACY.md and the README for the current scope and limitations.

## quickjs-emscripten 0.32.0

- Runtime package: `quickjs-emscripten` 0.32.0
- Runtime package license field: MIT
- Bundled license copy: `vendor/youtube/quickjs-emscripten-LICENSE.txt`
- Runtime provenance file: `vendor/youtube/PROVENANCE.txt`
- NPM package page: https://www.npmjs.com/package/quickjs-emscripten/v/0.32.0
- Upstream repository: https://github.com/justjake/quickjs-emscripten
- Bundled runtime file: `vendor/youtube/youtube-transform-worker.js`

## @jitl/quickjs-wasmfile-release-sync 0.32.0

- Runtime package: `@jitl/quickjs-wasmfile-release-sync` 0.32.0
- Runtime package license field: MIT
- Bundled license copy: `vendor/youtube/quickjs-wasmfile-release-sync-LICENSE.txt`
- Runtime provenance file: `vendor/youtube/PROVENANCE.txt`
- NPM package page: https://www.npmjs.com/package/@jitl/quickjs-wasmfile-release-sync/v/0.32.0
- Upstream repository: https://github.com/justjake/quickjs-emscripten
- Bundled runtime file: `vendor/youtube/emscripten-module.wasm`

QuickJS is used only inside a disposable worker to evaluate YouTube player transform snippets produced by `youtubei.js`. The runtime is bounded by source size, serialized output size, heap, stack and wall clock deadline, and exposes no DOM, Chrome, fetch, filesystem or process host callbacks.


## Archivo typeface

- Archivo variable font (Latin subset, width and weight axes), from `@fontsource-variable/archivo` 5.2.5, Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo).
- License: SIL Open Font License 1.1, bundled copy `src/ui/fonts/Archivo-OFL.txt`.
- Bundled file: `src/ui/fonts/archivo-variable.woff2`, used for titles, percentages and section labels in the panel.

## Transitive runtime packages bundled into YouTube support

The YouTube support bundles the browser distribution from `youtubei.js` and the QuickJS worker bundle. Runtime notices and hashes are recorded in `vendor/youtube/PROVENANCE.txt` for these bundled packages:

- `@bufbuild/protobuf` 2.16.0, license field `(Apache-2.0 AND BSD-3-Clause)`, bundled notice files `vendor/youtube/bufbuild-protobuf-LICENSE.txt` and `vendor/youtube/BSD-3-Clause.txt`.
- `fflate` 0.8.3, MIT, bundled license copy `vendor/youtube/fflate-LICENSE.txt`.
- `meriyah` 7.4.0, ISC, bundled license copy `vendor/youtube/meriyah-LICENSE.txt`.
- `quickjs-emscripten-core` 0.32.0, MIT, bundled license copy `vendor/youtube/quickjs-emscripten-core-LICENSE.txt`.
- `@jitl/quickjs-ffi-types` 0.32.0, MIT, bundled license copy `vendor/youtube/quickjs-ffi-types-LICENSE.txt`.

Bundling preserves esbuild legal comments at EOF for the generated YouTube provider bundle and QuickJS worker bundle.

## Experimental SABR dependencies

- `googlevideo` 4.1.1, MIT, upstream https://github.com/LuanRT/googlevideo, license copy `vendor/youtube/googlevideo-LICENSE.txt`.
- `bgutils-js` 4.0.3, MIT, upstream https://github.com/LuanRT/BgUtils, license copy `vendor/youtube/bgutils-js-LICENSE.txt`.

These pinned dependencies support the experimental SABR reader and playback-token helpers. Sustained adaptive HD download support remains unresolved. Their inclusion does not establish support for every YouTube stream.
