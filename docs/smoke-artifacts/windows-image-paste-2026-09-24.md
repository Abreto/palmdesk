# Windows image paste validation — 2026-09-24

Scope: [issue #29](https://github.com/Abreto/palmdesk/issues/29), based on `198560a`. Windows 10 x64 (build 19045), Electron 33.2.1. This record distinguishes native fixture results from acceptance in the actual Codex app.

## Implemented behavior

- Windows Codex image capability uses the existing executable/process identity, including full executable path and process start time. HWND, PID and that identity are revalidated before clipboard writes and before the shortcut. A window title does not grant image capability.
- The existing phone picker, clipboard preview, PNG/JPEG validation, authenticated transfer channel and explicit paste action are reused. Original transfer bytes are unchanged; the host writes the decoded image to the Windows clipboard and sends Ctrl+V. It does not type or submit a prompt.
- Input is serialized. Failed key/button releases stop the paste; the native helper also rejects held local input. Clipboard verification and paste never refocus a window. Foreground loss, dialogs, stale/closed targets and insufficient process integrity fail with recovery instructions.
- Native requests wait in the main process, where cancellation and capture termination can discard them before dispatch. Closing the helper invalidates queued requests. A shortcut already handed to the native helper/OS cannot be withdrawn; an uncertain result is reported without automatic retry.
- Image errors preserve the selection for an explicit retry. Reconnecting the image channel retains the selection and does not replay an attachment. macOS retains its existing image clipboard and Cmd+V path.

## Automated evidence

| Check | Result and boundary |
| --- | --- |
| `pnpm test:smoke` | 298 passed, 3 platform/interactive tests skipped. Includes capability, stale target, input ordering, failed releases, native queue cancellation, helper closure and image channel lifecycle tests. |
| `pnpm typecheck` | Passed. |
| `pnpm build:prod` | Passed; existing large-chunk and browser-data/deprecation warnings remain. |
| `pnpm build:native` | Passed on Windows. |
| `pnpm build:desktop:win` | Passed; local unsigned package in `electron-release/0.0.5/worktree-b0e1d579ec/win-unpacked/`. No publication. |
| Windows native window smoke | 11 passed with `PALMDESK_NATIVE_SMOKE=true`. Includes non-Codex, stale PID/path/start-time, and closed-target rejection. |
| Windows clipboard smoke | Passed with real Electron decoding, Windows clipboard and native SendInput, targeting disposable fixture windows only. |
| Phone-layout browser smoke | Passed in headless Edge with real Vue and WebRTC. Covers exact bytes, preview, draft preservation, reading/watch-only cancellation, clipboard permission recovery and independent image-channel reconnect. The host paste is a test double. |

The clipboard test compiles `test/smoke/fixtures/windows-test-window.cs` as a temporary `Codex.exe` to exercise the production identity gate. It never targets the installed Codex app. It reads the registered PNG clipboard format that Chromium uses, including transparency, rather than the legacy Windows Forms bitmap fallback.

| Input | Dimensions | Observed result |
| --- | --- | --- |
| `src/assets/img/logo.png` | 238 × 48 | Exactly one native Ctrl+V paste, decoded pixels identical including transparency. |
| `src/assets/img/billd.jpg` | 512 × 512 | Exactly one native Ctrl+V paste, decoded pixels identical. |

Both pastes retained `请分析截图 / Keep this English draft，别发送。` and left Ctrl and V released. Cancellation before and during verification, stale PID/path/start time, a closed HWND, and foreground loss both before and after the clipboard write produced no additional paste in either fixture window.

Reproduction commands are in [Local Development](../LOCAL_DEVELOPMENT.md). Local logs are in `.local/issue-29/`; clipboard results are in `.local/image-paste/windows-result.json`. Sandbox desktop access and esbuild directory restrictions required running native/browser/build checks outside the sandbox. These are local builds and tests, with no publication.

ESLint also passes for the changed production TypeScript and smoke JavaScript files. Native fixture cases intentionally run sequentially; async input-driver doubles keep the production API contract.

## Still pending: real phone and Codex acceptance

No physical phone was available for this run. The tests above do **not** establish that an attachment thumbnail appeared in an installed Codex prompt. A real elevated-target integrity mismatch was also not exercised; structured permission errors and the existing native integrity guard were checked in code/unit tests.

Before closing the issue, record Windows/PalmDesk/Codex versions and the phone OS/browser, then:

1. Connect the phone to a Windows host and choose its actual Codex window. Click the intended prompt, type mixed Chinese/English draft text, select a PNG and explicitly paste. Confirm one visible attachment and the unchanged draft; repeat with JPEG. Send only when the user chooses to do so.
2. During an upload or pending paste, cancel, switch to reading/watch-only, disconnect, end capture, or close the target. Confirm pending work stops and no other window receives input. If the result is unconfirmed, inspect the prompt before any manual retry.
3. Disconnect/reconnect only the image channel. Confirm the selected preview and draft remain and no attachment appears until another explicit paste action.
4. Move focus to a different app or block the target with a dialog. Confirm the paste fails with an actionable message and no input reaches the other app. Release any locally held keys/buttons before retrying.
5. Run Codex at a higher integrity level than PalmDesk. Confirm permission rejection leaves other windows untouched; return both to the same normal privilege level and verify an explicit retry. No automatic elevation or retry is expected.
6. Repeat the normal workflow on macOS for Cmd+V regression acceptance, including physical iOS Safari if supported by the test device.

Crop/annotation, other agent targets, HEIC/GIF, multiple images and arbitrary file transfer remain out of scope.
