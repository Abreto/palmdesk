Experimental Tenori desktop installers for testing. Tenori (Chinese: 过目) is an AI-native remote control for agent-ready workflows.

## v0.0.9 preview draft: migrating from PalmDesk

- **New name:** PalmDesk becomes **Tenori**, or **过目** in Chinese. Your desktop AI agents, perched on your palm. The existing artwork is retained with updated names and text. ([#93](https://github.com/Abreto/palmdesk/issues/93))
- **macOS:** the bundle ID is now `io.github.abreto.tenori`, including new helper identities. Fully quit PalmDesk, install `Tenori.app` (displayed as 过目 in Chinese), and grant **Screen Recording** and **Accessibility** again. Restart Tenori after granting permissions and remove the old `PalmDesk.app`. The existing fixed signing certificate does not preserve permissions across the new bundle ID.
- **Windows:** the new app ID changes the installer identity. Tenori installs **side by side** with PalmDesk instead of upgrading it. Quit and uninstall PalmDesk separately after installing Tenori.
- **Settings:** Tenori has a new application data directory on both platforms. Reconnect devices and reapply custom service settings. Keep your self-hosted server database, Redis, secrets and persistent data.
- **Service address:** new desktop builds default to **https://tenori.abreto.icu** for API, signaling and phone invitations. **https://palmdesk.abreto.icu** remains available as an alias during the transition. Both hostnames must serve the same web frontend and backend, including WebSocket upgrades, without redirecting API or signaling requests. Explicit saved service addresses still take priority. Browser preferences are separate on the new origin.
- **Self-hosting:** new images are `ghcr.io/abreto/tenori-web` and `ghcr.io/abreto/tenori-backend`. Previously published `palmdesk-*` images remain available during the transition; future builds use the new names. Switch both images to matching immutable commit tags after publication. No database rename or migration is required. See the [container guide](https://github.com/Abreto/palmdesk/blob/main/containers/README.md#migration-from-palmdesk).

## Before publishing this draft

Abreto must confirm DNS for `tenori.abreto.icu` in Cloudflare, HTTPS and proxy routing for both hostnames, and backend origins (`PUBLIC_ORIGIN=https://tenori.abreto.icu`, `EXTRA_ALLOWED_ORIGINS=https://palmdesk.abreto.icu`, retaining other needed origins). Verify old/new desktop and web client combinations, QR invitations and TURN. This rename PR does not deploy or publish images, rename the GitHub repository, or create a release. The package version remains unchanged until release preparation.

Complete real-device acceptance of the new identity, Chinese app display name, permissions after installation, Windows side-by-side installation/uninstallation, capture/input, mobile browsers and cross-network TURN before release. This draft makes no claim that those checks have passed.

## Installation

| Download | Computer |
| --- | --- |
| `Tenori-<version>-mac-arm64.dmg` | Apple Silicon Mac, macOS 13 Ventura or later |
| `Tenori-<version>-windows-x64.exe` | Windows 10 1903+ / Windows 11 x64 |

Open the DMG and drag Tenori into Applications, or run the Windows installer. Node.js, pnpm, Xcode and Visual Studio are not needed on the user's computer. Intel Macs are not supported; macOS 13 and 14 remain unvalidated.

macOS builds use the existing fixed self-signed certificate, without Developer ID signing or notarization. Gatekeeper may block opening them. Windows installers are unsigned; SmartScreen or organization policies may warn or block installation. Users do not need signing private keys.

The phone web client and desktop app must use the same backend. The installer does not include the backend. Tenori shows newer-release notices but does not download or install updates; daily checks can be disabled in Advanced settings.

`SHA256SUMS.txt` will contain the hashes of the published installers. See [release prerequisites](https://github.com/Abreto/palmdesk/blob/main/docs/OPEN_SOURCE_READINESS.md) for dependency and validation limitations.

## 中文说明：v0.0.9 预览版草案

PalmDesk 更名为**过目（Tenori）**，取自「请您过目」。过目是面向 agent-ready workflows（便于衔接 Agent 工作流）的 AI-native（围绕 AI Agent 使用流程设计）远程控制工具，保留现有掌中窗口图形。

- **macOS：** 应用标识改为 `io.github.abreto.tenori`。完全退出旧 PalmDesk，安装 `Tenori.app`（中文显示名「过目」），重新授予**屏幕录制**和**辅助功能**权限，重启后移除旧 `PalmDesk.app`。沿用原签名证书也不能保留旧 bundle ID 的权限。
- **Windows：** 新应用身份会与 PalmDesk **并排安装**，不会覆盖升级。安装过目后，请退出并单独卸载旧 PalmDesk。
- **设置：** 两平台都使用新的应用数据目录，需要重新连接设备、设置自托管服务地址。不要删除服务端数据库、Redis、密钥或数据卷。
- **新服务地址：** 默认使用 **https://tenori.abreto.icu**，旧 **https://palmdesk.abreto.icu** 在过渡期作为同一服务的别名保留。手机网页与桌面端必须连接同一个后端；切换网页域名后可能需要重新连接及设置偏好。
- **自托管：** 镜像改为 `ghcr.io/abreto/tenori-web` 和 `ghcr.io/abreto/tenori-backend`。旧 `palmdesk-*` 镜像和已有标签在过渡期仍可用。新镜像发布后再同时切换到对应提交标签，保留现有数据库、配置与数据，无需迁移表结构。

发版前由 Abreto 确认新 DNS、两域名的 HTTPS/代理、来源白名单，以及新旧客户端组合、扫码和 TURN。仍需实机验收中文显示名、重新授权、Windows 并排安装与卸载、窗口捕获及输入。本次改名不执行部署、推镜像、仓库改名或 Release，包版本号留待正式准备 v0.0.9 时更新。

Mac 安装包仅支持 Apple Silicon、macOS 13 Ventura 及以上，使用固定自签名证书，未经 Developer ID 签名和公证；Windows 安装包未签名。系统仍可能阻止安装或启动。应用只提示更新，不自动下载安装，用户无需 Node.js、pnpm 或签名私钥。
