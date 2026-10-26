# Changelog

All notable changes to PalmDesk are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [semantic versioning](https://semver.org/) while the project is in `0.0.x` preview. Each release lists its security-relevant changes under **Security**; advisories are also published under [GitHub security advisories](https://github.com/Abreto/palmdesk/security/advisories).

## [Unreleased]

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

[Unreleased]: https://github.com/Abreto/palmdesk/compare/v0.0.7...HEAD
[0.0.7]: https://github.com/Abreto/palmdesk/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/Abreto/palmdesk/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/Abreto/palmdesk/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/Abreto/palmdesk/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/Abreto/palmdesk/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/Abreto/palmdesk/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/Abreto/palmdesk/releases/tag/v0.0.1
