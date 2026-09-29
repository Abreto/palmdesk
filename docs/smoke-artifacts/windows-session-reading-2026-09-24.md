# Windows local session reading — 2026-09-24

Issue: [#28](https://github.com/Abreto/palmdesk/issues/28). Implementation and initial validation based on `a962c62`; the PR was subsequently rebased onto `198560a` (v0.0.5).

## Environment and storage evidence

- Windows 10 x64, build 19045; Node 24.16.0; pnpm 11.19.0; Electron 33.2.1.
- Installed Claude MSIX: `Claude_1.24012.9.0_x64__pzs8sxrjxfjjc`.
- Inspected the installed package's `app/resources/app.asar` read-only. SHA-256: `b3990de6613f0b6a30ddd610e8ae315df43fcb92b0e561734f2f58c66f24341c`.
- The package bootstrap honors `CLAUDE_USER_DATA_DIR`. The ordinary profile uses Electron's roaming app data; its third-party profile uses `%LOCALAPPDATA%\Claude-3p` and migrates the legacy `%APPDATA%\Claude-3p` profile. A separate, unpackaged PalmDesk must also check the package's virtualized `LocalCache\Roaming` and `LocalCache\Local` locations.
- The package's local Code session manager stores `claude-code-sessions/<account>/<org>/<sessionId>.json`, with `local_<uuid>` IDs. Its transcript resolver uses the native Claude config directory's `projects/*/<cliSessionId>.jsonl`. Titles, `createdAt`, `lastActivityAt` and `cliSessionId` agree with the existing parser. SSH/WSL configurations are separate and are excluded by PalmDesk. No paths embedded in an index are followed.
- Two actual indexes were found under `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\Claude-3p`. Both resolved to global native Claude transcripts, retained their Desktop titles and produced exactly two unique entries. Read 2 and 12 timeline items respectively. These sessions did not have enough items for history pagination. Only counts and comparisons were recorded; private titles, IDs, paths and transcript contents were not copied into the repository.
- A real native Codex session produced 25 timeline items. No standalone native Claude Code session was available: the two local Claude logs belonged to Desktop indexes. Standalone CLI behavior is covered by synthetic fixtures.

The Windows package and real global transcripts verify the Windows format and packaged third-party location. The ordinary/legacy profile locations and per-session full/short storage layouts have synthetic coverage; no fresh session was created in those profiles. These are application internals, not a stable Anthropic storage API.

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm test:smoke` | 310 tests: 307 passed, 3 skipped, 0 failed |
| `pnpm typecheck` | Passed |
| `pnpm build:prod` | Passed |
| `pnpm build:native` | Passed; compiled `native-bin/palmdesk-window.exe` |
| `pnpm build:desktop:win` | Passed; unpacked Windows x64 app, no publishing |

After rebasing, the complete smoke suite (307 passed, 3 skipped), typecheck and production web build passed again. The two UI-copy conflicts were resolved using the current UI's concise wording. Native/desktop builds and the real-source/browser evidence below were collected before the rebase; the rebase did not alter the reader implementation.

The three skips are the existing macOS app-artifact preflight test, POSIX-only Desktop file-symlink test, and explicitly opt-in interactive Windows native test. Windows junction tests run without administrator privileges and are not skipped; Windows file-symlink behavior was not separately exercised. The desktop output is `electron-release/0.0.4/worktree-b4cbce7642/win-unpacked/`; it is unsigned, as expected for this local build.

Production builds required execution outside the filesystem sandbox because esbuild traverses workspace ancestors. Dependency setup used the existing pnpm/Electron caches after the initial Electron download timed out. Builds retained existing Sass/Browserslist/chunk-size warnings. No dependencies or lockfile entries changed.

New regressions cover:

- Windows supported/off-by-default status, persistence, malformed settings, failed persistence, invalid configuration, and unsupported Linux status.
- Revocation of pending list and detail reads, subsequent denial, and rejection of old results even after re-enabling. The same cases still run for macOS; existing DataChannel tests cover immediate client clearing and cancellation under backpressure.
- Native default roots, all six Windows Desktop profile candidates, three environment overrides, spaces/non-ASCII paths, CRLF and partial-log appends, 40/40/5 history pages, source labels, titles, search and cross-profile/CLI deduplication.
- Junction replacement after cached reads at every Desktop directory layer and at the Codex `sessions` / Claude Code `projects` scan roots. Discovery no longer follows these root junctions. Controller requests using raw paths, traversal or an NTFS stream suffix are rejected.
- Existing source tests continue to exercise malformed/missing indexes and logs, size limits, tool output, Markdown, updates, authentication, input blocking, video activity and reconnect state. macOS resolver and permission behavior remain covered by the shared tests; no physical Mac was used in this run.

## Browser checks

Used the existing synthetic fixture at `test/smoke/session-reader.html` on this Windows host, through two real local WebRTC peers, with a 390 × 844 browser viewport. This is a browser check with synthetic files and a canvas video, not a physical phone or packaged-host acceptance run.

- Three sources appeared with distinct labels and Desktop titles.
- All three sources loaded history back to their first synthetic messages. Searching for the Codex title returned only that session.
- A Desktop reply appended to JSONL triggered the eight-second polling notice. Reading position stayed at `scrollTop = 3790`; clicking the notice displayed the new Markdown reply.
- Read/window switching retained the draft `Windows 未发送草稿`. Reconnecting retained the selected Desktop session and `scrollTop = 5938`; the draft remained present when returning to the window.
- Disabling reading immediately removed the session content and showed the opt-in prompt. Re-enabling restored the list.
- Codex and Claude Code rendered Markdown, code and collapsed tool activity; Claude's long output showed a truncation notice and copying a reply showed `已复制`. The remote-input counter stayed zero while reading. No horizontal page overflow was observed.

The fixture watcher stopped on a locked temporary packaging file when the desktop build completed. It was restarted after packaging; this was a test-server interruption, not a reader failure.

## Remaining physical acceptance

**Not validated:** a real Windows PalmDesk host connected to a physical phone for all three sources, with a live agent-appended reply, history loading, read/window switching, unsent drafts, reconnect, actual video pause/input blocking and disabling access. Android Chrome and iOS Safari have not been exercised in this run. Standalone native Claude Code, fresh ordinary/legacy Desktop profiles and Windows per-session transcript creation also need real-app validation.

For that run, launch PalmDesk with the intended source-directory environment, verify reading is initially disabled, enable it, connect the phone before selecting a window, and open each source. Load older history, generate a reply in the original agent app, wait for the update notice, switch to/from its window with an unsent draft, reconnect, then disable reading while a request is pending. Record the app/browser versions and outcomes without publishing private session content.

WSL-home discovery, remote/cloud/SSH retrieval, Chat/Cowork, agent execution and automatic GUI task selection remain outside this feature.
