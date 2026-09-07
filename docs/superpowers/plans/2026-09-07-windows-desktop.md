# Windows Desktop Implementation Plan

**Goal:** Run PalmDesk as a Windows 10 1903+ / Windows 11 x64 host with the existing phone window selection, video and input workflow.

**Architecture:** Keep the newline-delimited JSON helper protocol and the Electron/nut-js capture session. Add a C# Win32 helper, compiled with the Windows .NET Framework compiler, using HWND, PID and executable/process identity. Read physical DWM frame bounds with per-monitor DPI awareness. Restore only the selected minimized window and verify foreground identity before input. Enumerate ordinary windows on the current virtual desktop; exclude desktop surfaces, cloaked windows and PalmDesk itself. Do not switch Windows virtual desktops.

**Tech Stack:** Electron, TypeScript, Win32 P/Invoke, .NET Framework, node:test, electron-builder.

Windows capture requires WGC to keep captured frame boundaries consistent with DWM input coordinates. Enable Chromium's WGC window feature and reject unsupported OS builds, unavailable GraphicsCaptureSession APIs, missing displays, or explicitly disabled WGC. Do not fall back to GDI's different window crop.

Literal text uses Win32 Unicode SendInput with a fresh identity/focus/privilege check. This avoids IME composition of strings sent from the controller; pointer and key events keep the existing nut-js driver.

## Native Host

- [x] Add failing protocol/identity regression coverage and a real Windows helper smoke test using temporary windows.
- [x] Implement `electron-main/native/palmdesk-window.cs` with list, focus, permissions, diagnostics and optional thumbnail commands.
- [x] Update `electron-main/native-window.ts` and `electron-main/index.ts` for platform paths, Windows support and platform-specific permission checks.
- [x] Verify stale identities, closed windows, minimized restoration and physical bounds; fail closed on denied foreground activation or elevated targets.

## Build And Packaging

- [x] Compile `native-bin/palmdesk-window.exe` on Windows without extra package dependencies.
- [x] Package the helper under resources; build the current host platform and expose an explicit Windows build command.
- [x] Run as the current user by default, and add Windows source/native checks to CI.

## Verification And Documentation

- [x] Run `pnpm test:smoke`, `pnpm typecheck`, `pnpm build:prod`, `pnpm build:native` and the Windows native smoke test.
- [x] Build Windows desktop output and launch the desktop development server when the local runtime is available.
- [x] Document Windows setup, supported windows, privilege/virtual desktop boundaries and actual verification results.

## Verification Results (2026-09-07)

- Windows 10 build 19045 x64, Node.js 24.16.0, Electron 33.2.1.
- Source smoke: 113 passed; the opt-in interactive suite is skipped by default.
- Native interactive suite: 10 passed, including stale/invalid text rejection.
- Typecheck, production web build, changed TypeScript/Vue lint and Windows directory build passed.
- Development and packaged Electron smoke: real captures of two fixture windows decoded at 388x274, exactly matching DWM; selected colors, clicks, mixed Chinese/English literal input with IME enabled, invalid sessions, track/process cleanup passed.
- Desktop development server is running at http://127.0.0.1:5173/; Electron loaded and the transformed entry module returns HTTP 200. Prettier accepts Windows checkout line endings. The local backend is not running, so account creation requests remain unavailable.
- Phone/network end-to-end testing and mixed-DPI multi-monitor hardware remain outside this local verification.

Alternative approaches considered: a PowerShell helper adds startup/policy overhead; a C++ addon adds Node ABI and Visual Studio toolchain requirements. A standalone C# helper matches the existing process boundary and uses the compiler already shipped with Windows.
