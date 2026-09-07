# Windows Integration Verification (2026-09-08)

Source: `c0905b0` on `codex/windows-support`, integrating `main` at `66384d3`.
Environment: Windows 10 x64 build 19045, Node.js 24.16.0, pnpm 11.19.0, Electron 33.2.1.

## Integration And Review

- Resolved conflicts in `README.md`, `package.json`, and `scripts/before-pack.cjs`. Retained the English/Chinese README structure, Windows build commands, and macOS application identity checks.
- Updated packaging and startup test fixtures for the combined dependencies and Windows directory junctions.
- Independent review found a WGC feature-switch whitespace issue. Two new regression tests failed before the fix and passed after trimming feature names. Follow-up review confirmed the finding was resolved, with no further findings.

## Passed

- `pnpm test:smoke`: 117 passed, 2 skipped. The skips are the macOS-only bundle preflight and the opt-in Windows native suite, which was run separately below.
- `node --test containers/test/deployment.test.mjs`: 8 passed.
- `pnpm typecheck` and `pnpm build:prod`.
- `pnpm build:native`: Windows helper build/check succeeded.
- With `PALMDESK_NATIVE_SMOKE=true`, `node --test test/smoke/native-window-windows.test.cjs`: 10 passed.
- ESLint passed for the changed production TypeScript/Vue files: `electron-main/capture-session.ts`, `electron-main/index.ts`, `electron-main/native-window.ts`, and `src/views/remote/index.vue`.
- Final desktop renderer and main process: `pnpm exec vite build`.
- Final Windows directory package: `pnpm exec electron-builder --win --x64 --dir --publish never --config.directories.output=.local/merge-verification/desktop`.
- `test/smoke/electron-window-windows.mjs` passed in both development and packaged modes against the final code. Both real fixture windows decoded at 388x274, exactly matching their DWM bounds. Pixel colors, native mouse clicks, literal Chinese/English input, and invalid-session rejection passed. Capture tracks, fixtures, and test application processes were cleaned up.
- The public signaling integration test passed during preparation with separate API and signaling URLs. Earlier real public-backend capture/input verification and user-confirmed physical phone testing are recorded in [the public backend report](public-backend-2026-09-08.md).

The validation package is stored in the Git-ignored `.local/merge-verification/desktop/win-unpacked/`. It did not replace the user's existing executable. For packaged runtime acceptance, the original instance was briefly stopped to release its single-instance lock, then reopened visibly after the test. Overriding `APPDATA` does not redirect Electron's Windows known-folder lookup, so this packaged test uses the application's normal profile.

## Limits

- Repository-wide `pnpm lint` did not pass: it scans local/generated files and also reports source/test rule violations. Representative failures also exist on `origin/main` (`import/order`, `require-await`, and test-loop rules). The scoped lint result above does not establish a clean full-repository lint run.
- The build retains existing dependency/toolchain warnings, including Browserslist age, bundle size, and Node.js shell-argument deprecation. No distribution signing certificate was configured for the Windows test executable.
- macOS native compilation and real macOS permission/Spaces behavior could not be rerun on this Windows host. The PR's macOS CI check and hardware acceptance remain relevant.
- Mixed-DPI multi-monitor hardware combinations, physical iOS Safari, and cross-network NAT/TURN behavior remain unverified. The local Electron fixture tests do not exercise the mobile browser or network transport.
