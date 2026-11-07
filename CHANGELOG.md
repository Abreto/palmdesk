# Changelog

All notable changes to Tenori are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [semantic versioning](https://semver.org/) while the project is in `0.0.x` preview. Each release lists its security-relevant changes under **Security**; advisories are also published under [GitHub security advisories](https://github.com/Abreto/palmdesk/security/advisories).

## [Unreleased]

### v0.0.9 preview draft — Tenori migration

- PalmDesk is now **Tenori**, with the Chinese name **过目** ("for your review"). The existing window-in-a-palm artwork keeps its geometry and colors; product text, asset names and installers adopt the new name. ([#93](https://github.com/Abreto/palmdesk/issues/93))
- **macOS:** the bundle ID changes from `io.github.abreto.palmdesk` to `io.github.abreto.tenori`, including development and helper identities. Quit PalmDesk, install `Tenori.app` (displayed as **过目** in Chinese), grant **Screen Recording** and **Accessibility** again, then remove the old `PalmDesk.app`. Restart Tenori after granting permissions. The fixed signing certificate is retained, but the new bundle ID makes this a new app to macOS.
- **Windows:** the new app ID changes the installer identity. Tenori installs **side by side** with PalmDesk rather than upgrading it. Quit and uninstall the old PalmDesk app after installing Tenori. The new desktop app has a separate data directory on both platforms; reconnect devices and reapply any self-hosted service settings. Do not remove your self-hosted server data.
- The default desktop API, signaling and phone invitation address becomes **https://tenori.abreto.icu**. The operator must confirm DNS, HTTPS and routing before release. **https://palmdesk.abreto.icu** remains an alias to the same backend during the transition; saved custom service addresses still work. Browser preferences are separate on the new origin.
- Self-hosters can switch to `ghcr.io/abreto/tenori-web` and `ghcr.io/abreto/tenori-backend` after publication. Existing `palmdesk-*` images and published tags remain available during the transition. Preserve the database, Redis, secrets and volumes; see the [migration guide](containers/README.md#migration-from-palmdesk).

中文迁移提示：PalmDesk 更名为**过目（Tenori）**。macOS 需重新授予屏幕录制和辅助功能权限，授权后重启，并移除旧 App；Windows 安装为独立应用，安装后请卸载旧 PalmDesk。两平台均需重新配置新应用的连接信息。新默认服务地址为 **https://tenori.abreto.icu**，旧域名和旧镜像在过渡期保留；发版前仍需确认域名及实机验收。

## [0.0.8] - 2026-10-27

### Added

- Desktop notifications for newer GitHub releases, with a stronger notice for security updates, a manual check and an option to turn off daily checks. Updates are downloaded and installed manually. ([#66](https://github.com/Abreto/palmdesk/pull/66))

### Changed

- Upgrade Electron from 33.2.1 to 44.9.3 and adapt image paste to the asynchronous clipboard API. macOS now requires version 13 Ventura or later; macOS 12 is no longer supported. ([#62](https://github.com/Abreto/palmdesk/pull/62))
- Run the self-contained browser smoke suite in CI alongside the existing source, native-helper and dependency checks. ([#70](https://github.com/Abreto/palmdesk/pull/70))

### Fixed

- Remove the per-character delay from macOS remote text input. Stop subsequent text chunks when the target loses focus or control ends, and recheck focus before image paste. Input already delivered to the operating system cannot be undone. ([#63](https://github.com/Abreto/palmdesk/pull/63))

### Security

- Restrict desktop IPC to approved channels and trusted app frames, block navigation away from the bundled app, limit external links to HTTPS GitHub URLs, deny unneeded permissions and enforce a Content Security Policy. Remove server-provided HTML update dialogs, credentials from controller-window URLs and sensitive payloads from logs. ([#61](https://github.com/Abreto/palmdesk/pull/61))
- Replace the end-of-life Electron runtime and update vulnerable dependencies. Production dependency auditing now runs in CI; documented exceptions and development-tool advisories remain. ([#62](https://github.com/Abreto/palmdesk/pull/62))
- A successful temporary-password change disconnects existing controllers. The updated backend also revokes session tokens and rejects in-flight connection attempts authenticated with the old password. Update the desktop app, web frontend and backend together; the backend deployment adapter changed even though its pinned upstream source did not. No database migration is required. ([#65](https://github.com/Abreto/palmdesk/pull/65), [#83](https://github.com/Abreto/palmdesk/pull/83))

## [0.0.7] - 2026-10-03

### Added

- Open installed Codex, Claude, ChatGPT, Kimi and ZCode desktop apps from the Agent directory on macOS and Windows. A single matching window opens through the normal selection flow; with several windows the choice stays with you. ([#41](https://github.com/Abreto/palmdesk/pull/41))
- Connection quality profiles: Balanced (up to 2160p, 20 fps, 3 Mbps ceiling) is the new default for both connection entry points, alongside High detail (the previous 2160p, 30 fps, 8 Mbps) and Low data (1080p, 10 fps, 1 Mbps). Explicit choices and manual overrides are saved locally. ([#44](https://github.com/Abreto/palmdesk/pull/44))

### Security

- Conceal the temporary password and blur the connection QR code by default, so screenshots and screen recordings do not expose them. ([#40](https://github.com/Abreto/palmdesk/pull/40))
- Launch requests require the authenticated connection, are never replayed after reconnecting and never submit prompts.

## [0.0.6] - 2026-09-30

### Added

- Read local Codex, Claude Code and Claude Desktop Code sessions on Windows. ([#32](https://github.com/Abreto/palmdesk/pull/32))
- Paste a PNG or JPEG from the phone into a Windows Codex prompt. ([#33](https://github.com/Abreto/palmdesk/pull/33))

### Changed

- New Palm Window identity: application, browser and navigation icons. ([#34](https://github.com/Abreto/palmdesk/pull/34))

### Security

- Windows image paste identifies Codex by executable path and process start time, not its title, and verifies the window, focus and clipboard contents before sending Ctrl+V. Uncertain pastes are never retried automatically.
- Windows session reading stays off by default and read-only.

## [0.0.5] - 2026-09-23

### Added

- Pinch-to-zoom and two-finger panning in the remote window view. ([#16](https://github.com/Abreto/palmdesk/pull/16))
- Resume or reconnect when returning to the same phone page, preserving the reading position and unsent text. ([#17](https://github.com/Abreto/palmdesk/pull/17))

### Changed

- Pause video while the phone browser is in the background or in Read mode. ([#17](https://github.com/Abreto/palmdesk/pull/17))
- Refreshed light interface and concise copy on desktop and phone. ([#18](https://github.com/Abreto/palmdesk/pull/18))

### Security

- A disconnected window can be resumed for five minutes only by the same authenticated controller, and only after checking that the original window still exists.

## [0.0.4] - 2026-09-17

### Added

- Paste a PNG or JPEG from the phone into a macOS Codex prompt, up to 10 MiB, with the original resolution. ([#15](https://github.com/Abreto/palmdesk/pull/15))

### Security

- Images travel over a separate authenticated channel and are validated on the host. Pasting is always an explicit action and never sends the message.

## [0.0.3] - 2026-09-16

### Added

- Read local Codex, Claude Code and Claude Desktop Code sessions from the phone on macOS. ([#10](https://github.com/Abreto/palmdesk/pull/10), [#11](https://github.com/Abreto/palmdesk/pull/11), [#12](https://github.com/Abreto/palmdesk/pull/12))

### Fixed

- Blurry macOS window streaming and video quality settings. ([#9](https://github.com/Abreto/palmdesk/pull/9))

### Security

- Session reading is off by default and must be enabled on the computer.
- macOS previews are signed with a fixed self-signed certificate and a stable native helper identity, so Screen Recording and Accessibility grants belong to PalmDesk. Release builds refuse missing or mismatched certificates. Upgrading from v0.0.2 or earlier changes the signing identity once.

## [0.0.2] - 2026-09-09

### Added

- Agent directory recognizing running Codex, Claude, ChatGPT, Kimi and ZCode apps on macOS and Windows, with pinned and recent agents per device. ([#7](https://github.com/Abreto/palmdesk/pull/7))

### Fixed

- Slow and insensitive mobile scrolling. ([#6](https://github.com/Abreto/palmdesk/pull/6), [#8](https://github.com/Abreto/palmdesk/pull/8))

### Security

- Local desktop builds are isolated by checkout, including application identity, permissions and data; only builds made with `--release` use the PalmDesk release identity.

## [0.0.1] - 2026-09-08

First public preview of PalmDesk, an AI-native remote control for agent-ready workflows, based on [BilldDesk](https://github.com/galaxy-s10/billd-desk).

### Added

- Stream one macOS or Windows window to a phone browser and control it with touch, text and keys. ([#3](https://github.com/Abreto/palmdesk/pull/3))
- QR code invitations, mobile window selection and selecting windows across macOS Spaces.
- Desktop installers for Apple Silicon Macs and Windows x64 built by a manual prerelease workflow, and container images for self-hosting. ([#1](https://github.com/Abreto/palmdesk/pull/1), [#5](https://github.com/Abreto/palmdesk/pull/5))
- Packaged builds connect to the hosted PalmDesk service at `https://palmdesk.abreto.icu` by default. ([#2](https://github.com/Abreto/palmdesk/pull/2), [#4](https://github.com/Abreto/palmdesk/pull/4))

### Security

- Targets are identified by bundle ID or executable identity, process ID and native window ID, never by title; input stops when the target disappears, capture ends or the connection closes.
- TURN credentials are short-lived and issued by the backend; clients hold no TURN secret.

[Unreleased]: https://github.com/Abreto/palmdesk/compare/v0.0.8...HEAD
[0.0.8]: https://github.com/Abreto/palmdesk/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/Abreto/palmdesk/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/Abreto/palmdesk/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/Abreto/palmdesk/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/Abreto/palmdesk/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/Abreto/palmdesk/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/Abreto/palmdesk/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/Abreto/palmdesk/releases/tag/v0.0.1
