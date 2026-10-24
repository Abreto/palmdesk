# Electron 44 upgrade validation — 2026-10-21

Scope: [issue #46](https://github.com/Abreto/palmdesk/issues/46), based on `cd366c1`. Electron 33.2.1 (end of life since 2025-04-28) is replaced by Electron 44.9.3 (Chromium 152.0.7977.167, Node 24.22.0, V8 15.2). Checks ran on an Apple Silicon Mac with macOS 26.6. No Windows host, real target window or phone was used.

## Breaking changes reviewed

| Electron change                                                                           | Effect on PalmDesk                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 44: `clipboard` became asynchronous and MIME based; `readImage`/`writeImage` were removed | Image paste now writes and reads the clipboard through `electron-main/clipboard-image.ts` as `image/png`. The pixel read-back check is unchanged. Both image-paste smoke scripts save and restore every clipboard format with the new API. |
| 44: macOS 13 or later required; no 32-bit Windows builds                                  | macOS 12 hosts can no longer run new releases. Installers were already Apple Silicon and Windows x64 only. The packaged app reports `LSMinimumSystemVersion` 13.0.                                                                         |
| 42: the npm package downloads the binary on first use instead of in `postinstall`         | `require('electron')` and `pnpm exec electron` fetch the binary on demand. `pnpm-workspace.yaml` no longer allows an Electron install script. electron-builder still downloads its own copy for packaging.                                 |
| 39: `desktopCapturer` needs `NSAudioCaptureUsageDescription` on macOS 14.2 and later      | Added to the packaged and development app `Info.plist`. PalmDesk still requests video only.                                                                                                                                                |
| 36: `app.commandLine` lowercases switch names                                             | Only switch names are lowercased. The Windows `enable-features=AllowWgcWindowCapturer` value is unaffected.                                                                                                                                |
| 43: `NativeImage.toBitmap()` normalizes to sRGB                                           | Both sides of the clipboard comparison use the same conversion; Display P3 images still compare equal (below).                                                                                                                             |
| 45 (not adopted): window capture is reported to permission handlers as `display-capture`  | The permission policy in #61 already allows it for the host window, so a later move to 45 keeps capture working.                                                                                                                           |

`@nut-tree-fork/libnut` and `@nut-tree-fork/node-mac-permissions` are N-API modules (`napi_register_module_v1`), so they load on the new ABI without rebuilding.

## Automated evidence

| Check                                  | Result and boundary                                                                                                                                                                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:smoke`                      | 347 tests: 342 passed, 5 platform-specific skips. Adds a rejected clipboard-write case.                                                                                                                                                                                                |
| `pnpm typecheck`                       | Passed against Electron 44 typings.                                                                                                                                                                                                                                                    |
| `pnpm build:prod`                      | Passed; existing chunk-size and deprecation warnings remain.                                                                                                                                                                                                                           |
| `pnpm build:native`                    | Passed (Swift helper).                                                                                                                                                                                                                                                                 |
| `pnpm build:desktop`                   | Passed with electron-builder 25.1.8 and an ad-hoc signature: `PalmDesk Local <id>.app` on Electron Framework 44.9.3, with the native helper, `LSMinimumSystemVersion` 13.0 and the audio usage description. `app.asar` no longer contains `billd-deploy`, `vconsole`, webpack or Vite. |
| `test/smoke/electron-image-paste.cjs`  | Passed on Electron 44.9.3: PNG (238 × 48, transparent) and JPEG (512 × 512) were written through the new clipboard API, read back pixel-identical and delivered to a paste event as `image/png`. The saved clipboard was restored afterwards.                                          |
| `pnpm audit --prod --audit-level high` | Passes. See [dependency audit](../OPEN_SOURCE_READINESS.md#依赖审计) for the remaining moderate findings and the one ignored advisory.                                                                                                                                                 |

Clipboard round trip on Electron 44.9.3 (macOS), decoding each file as the host does and comparing `toBitmap()` after `clipboard.write`/`clipboard.read`:

| Input                                                | Result                                     |
| ---------------------------------------------------- | ------------------------------------------ |
| `logo.png`, RGBA, no profile                         | Identical; pasted as `image/png` 238 × 48  |
| `billd.jpg`, sRGB profile                            | Identical; pasted as `image/png` 512 × 512 |
| Saturated PNG, no profile                            | Identical; pasted as `image/png` 64 × 64   |
| Same PNG tagged Display P3 (like iPhone screenshots) | Identical; pasted as `image/png` 64 × 64   |

The clipboard then offers `image/png` plus the native PNG and TIFF pasteboard types.

## Still pending

- **macOS host acceptance with permissions:** window capture and video quality, nut-js pointer and keyboard input into a real window, image paste into the Codex app with Cmd+V, permission prompts and recovery, and session reading. The isolated development app is rebuilt for Electron 44, so macOS asks for Screen Recording and Accessibility again.
- **Windows:** `pnpm build:native`, `pnpm build:desktop:win`, Windows Graphics Capture, `test/smoke/native-window-windows.test.cjs` and `test/smoke/windows-image-paste.cjs`. The Windows clipboard smoke was ported to the asynchronous clipboard API but not run. It checks that Codex-compatible PNG data still reaches the clipboard and that a locked clipboard still blocks the paste.
- **Packaged launch:** the local `.app` was inspected but not opened, to avoid permission prompts for a throwaway identity. Release builds with the fixed certificate also need the prerelease workflow.
