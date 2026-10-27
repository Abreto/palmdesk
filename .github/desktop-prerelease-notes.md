Experimental PalmDesk desktop installers for testing. PalmDesk is an AI-native remote control for agent-ready workflows.

Security: This release restricts desktop renderer privileges, updates the Electron runtime and vulnerable dependencies, and ends existing remote sessions when the temporary password changes. Update the desktop app, web frontend and backend together.

## What's new in v0.0.8

- A successful temporary-password change disconnects existing controllers and stops capture. The updated backend also revokes session tokens and rejects connection attempts authenticated with the old password that were still being established. The updated controller explains the disconnection and requires the new password to reconnect. ([#65](https://github.com/Abreto/palmdesk/pull/65), [#83](https://github.com/Abreto/palmdesk/pull/83))
- Harden the desktop renderer with approved IPC channels, trusted app-frame checks, navigation restrictions, HTTPS GitHub links, permission restrictions and a Content Security Policy. Remove server-provided HTML update dialogs, credentials from controller-window URLs and sensitive payloads from logs. ([#61](https://github.com/Abreto/palmdesk/pull/61))
- Upgrade Electron 33.2.1 to 44.9.3 and vulnerable dependencies, and adapt image paste to the asynchronous clipboard API. **macOS now requires version 13 Ventura or later; macOS 12 is no longer supported.** ([#62](https://github.com/Abreto/palmdesk/pull/62))
- Remove the per-character delay from macOS remote text input. Stop subsequent text chunks when focus is lost or control ends, and recheck focus before image paste. The current chunk can finish; input already delivered to the operating system cannot be undone. ([#63](https://github.com/Abreto/palmdesk/pull/63))
- Show newer-release notices, with a stronger notice for security updates. Check manually from the macOS menu or Advanced settings, or turn off daily checks. Updates are downloaded and installed manually. This notice is new in v0.0.8; v0.0.7 users need to download this release themselves. ([#66](https://github.com/Abreto/palmdesk/pull/66))

## Update the desktop, web frontend and backend

- **Desktop:** install the v0.0.8 package below.
- **Web frontend:** deploy the matching `ghcr.io/abreto/palmdesk-web` image, then reload the phone page.
- **Backend:** deploy the matching `ghcr.io/abreto/palmdesk-backend` image and restart the backend for server-side session revocation. The deployment adapter changed even though the upstream commit in `backend.lock.json` did not. With an older backend, disconnection relies on the updated desktop client.
- **Database:** no schema migration is required. Keep the existing database, Redis, configuration and persistent data.

Use the `sha-<full-commit>` image tags for the commit referenced by `v0.0.8`; the current workflow publishes commit tags and `latest`, not version tags. Publishing a release or image does not deploy the running service. Hosted-service users install the desktop app and reload the phone page; the operator updates the web frontend and backend. See the [container guide](https://github.com/Abreto/palmdesk/blob/v0.0.8/containers/README.md).

Source checks, browser smoke tests and dependency auditing run in CI. Release checks cover both installers, macOS signing identity and packaged native helpers. Complete real-device acceptance of Electron 44 remains pending, including Windows clipboard behavior, real window capture and input, long-text focus changes, permission recovery, mobile browsers and cross-network TURN. See the [Electron upgrade record](https://github.com/Abreto/palmdesk/blob/v0.0.8/docs/smoke-artifacts/electron-44-upgrade-2026-10-21.md) and [usage guide](https://github.com/Abreto/palmdesk/blob/v0.0.8/README.md).

[Changes since v0.0.7](https://github.com/Abreto/palmdesk/compare/v0.0.7...v0.0.8)

## Installation

| Download            | Computer                          |
| ------------------- | --------------------------------- |
| `*-mac-arm64.dmg`   | Apple Silicon Mac                 |
| `*-windows-x64.exe` | Windows 10 1903+ / Windows 11 x64 |

Open the DMG and drag PalmDesk into Applications, or run the Windows installer.
Node.js, pnpm, Xcode and Visual Studio are not needed on the user's computer.

- macOS builds use the same fixed self-signed certificate introduced in v0.0.3, without Developer ID signing or notarization. Gatekeeper may still block opening them. Screen Recording and Accessibility permissions are required for remote control.
- **Upgrading from v0.0.2 or earlier:** the signing identity changes once. Fully quit PalmDesk, install this version, and reauthorize Screen Recording and Accessibility if needed. If the old entries remain ineffective, remove them and add `/Applications/PalmDesk.app` again, then restart. Later builds using the same certificate retain a stable signing identity; actual permission retention still needs validation on your macOS version. Users do not need the signing private key.
- Windows installers are unsigned. SmartScreen or organization policies may warn or block installation.
- The macOS package is for Apple Silicon only, requires macOS 13 Ventura or later and is built on macOS 15. Intel Macs are not supported by this prerelease. macOS 13 and 14 have not been validated.
- The desktop app connects to https://palmdesk.abreto.icu by default. The phone web client and desktop must use the same service. The installer does not include the backend.
- PalmDesk shows a notice when a newer release is published, but it does not download or install updates. Install the new release yourself; the daily check can be turned off in 高级设置 (Advanced settings).

These builds pass source checks and packaging verification in CI. Real screen capture, input, permission recovery and phone/network behavior still require testing on physical devices.

`SHA256SUMS.txt` contains SHA256 hashes of the two installers.
Remaining dependency exceptions, development-tool advisories and license review items are documented in [release prerequisites](https://github.com/Abreto/palmdesk/blob/v0.0.8/docs/OPEN_SOURCE_READINESS.md).

## 中文说明

供测试使用的 PalmDesk 桌面安装包。PalmDesk 是面向 agent-ready workflows（便于衔接 Agent 工作流）的 AI-native（围绕 AI Agent 使用流程设计）远程控制工具。

**安全更新：** 本版收紧桌面渲染页面权限，更新 Electron 及存在安全公告的依赖，并在修改临时密码后结束已有远控会话。请同步更新桌面端、网页前端和后端。

### v0.0.8 更新内容

- 成功修改临时密码后，断开已有控制端并停止捕获。新版后端还会撤销会话令牌，拒绝已通过旧密码认证但尚未完成建立的连接。新版控制端提示密码已更改，要求使用新密码重新连接。([#65](https://github.com/Abreto/palmdesk/pull/65)、[#83](https://github.com/Abreto/palmdesk/pull/83))
- 加固桌面渲染页面：限定 IPC 通道和可信应用页面，限制导航跳转、外部链接及权限，并启用内容安全策略。移除服务端 HTML 更新弹窗、控制窗口 URL 中的凭据及日志中的敏感载荷。([#61](https://github.com/Abreto/palmdesk/pull/61))
- Electron 从 33.2.1 升级到 44.9.3，并更新存在安全公告的依赖；图片粘贴适配新的异步剪贴板接口。**macOS 最低版本升至 13 Ventura，不再支持 macOS 12。** ([#62](https://github.com/Abreto/palmdesk/pull/62))
- 去掉 macOS 远程文字输入的逐字延迟；失去焦点或控制结束后停止后续文字块，粘贴图片前再次核验焦点。当前文字块可能完成，已交给操作系统的输入无法撤回。([#63](https://github.com/Abreto/palmdesk/pull/63))
- 发现新版本时显示通知，安全更新提示更醒目。可在 macOS 菜单或“高级设置”手动检查，也可关闭每日检查；更新仍需手动下载安装。此功能从 v0.0.8 开始提供，v0.0.7 用户需自行下载本次更新。([#66](https://github.com/Abreto/palmdesk/pull/66))

### 桌面端、网页前端和后端更新

- **桌面端：** 安装下方 v0.0.8 安装包。
- **网页前端：** 部署对应的 `ghcr.io/abreto/palmdesk-web` 镜像，再刷新手机页面。
- **后端：** 部署对应的 `ghcr.io/abreto/palmdesk-backend` 镜像并重启后端，启用服务端会话撤销。虽然 `backend.lock.json` 固定的上游提交未变，后端部署适配器已有改动；使用旧后端时，断连依赖新版桌面端。
- **数据库：** 无需迁移表结构，保留现有数据库、Redis、配置及持久化数据。

两个镜像均使用 `v0.0.8` 对应完整提交的 `sha-<full-commit>` 标签；当前工作流发布提交标签和 `latest`，不发布版本号标签。发布 Release 或镜像不会自动更新运行中的服务。托管服务用户安装桌面端并刷新手机网页，服务维护者负责更新网页前端和后端。详见[容器说明](https://github.com/Abreto/palmdesk/blob/v0.0.8/containers/README.md)。

CI 运行源码检查、浏览器烟测和依赖审计；发布检查覆盖两平台安装包、macOS 签名身份及包内原生辅助程序。Electron 44 的完整实机验收仍待完成，包括 Windows 剪贴板、真实窗口捕获和输入、长文本输入时焦点变化、权限恢复、手机浏览器和跨网络 TURN。详见 [Electron 升级记录](https://github.com/Abreto/palmdesk/blob/v0.0.8/docs/smoke-artifacts/electron-44-upgrade-2026-10-21.md)和[使用指南](https://github.com/Abreto/palmdesk/blob/v0.0.8/README.zh-CN.md)。

[查看自 v0.0.7 以来的改动](https://github.com/Abreto/palmdesk/compare/v0.0.7...v0.0.8)

### 安装说明

| 下载                | 适用设备                                |
| ------------------- | --------------------------------------- |
| `*-mac-arm64.dmg`   | Apple Silicon Mac                       |
| `*-windows-x64.exe` | Windows 10 1903 及以上 / Windows 11 x64 |

打开 DMG 后将 PalmDesk 拖入“应用程序”，或运行 Windows 安装程序。用户电脑无需安装 Node.js、pnpm、Xcode 或 Visual Studio。

- macOS 构建沿用 v0.0.3 引入的固定自签名证书，没有 Developer ID 签名，也没有经过公证。Gatekeeper 仍可能阻止打开；远程控制需要授予“屏幕录制”和“辅助功能”权限。
- **从 v0.0.2 或更早版本升级：** 本次签名身份会变化。请完全退出 PalmDesk，安装本版本，按需重新授予两项权限。若旧条目仍不生效，请移除后重新添加 `/Applications/PalmDesk.app`，然后重启应用。后续使用同一证书的构建保持稳定签名身份；实际权限保留仍需在所用 macOS 版本上验证。普通用户无需导入签名私钥。
- Windows 安装包未签名，SmartScreen 或组织安全策略可能发出警告或阻止安装。
- macOS 安装包仅支持 Apple Silicon，需要 macOS 13 Ventura 及以上，使用 macOS 15 构建；本测试版不支持 Intel Mac，尚未验证 macOS 13 和 14。
- 桌面端默认连接 https://palmdesk.abreto.icu。手机网页端和桌面端必须使用同一个服务；安装包不包含后端服务。
- 发现新版本时 PalmDesk 会显示提示，但不会自动下载或安装。请自行下载并安装新版本；每日检查可在“高级设置”关闭。

这些构建已通过 CI 中的源码检查和打包验证。真实的屏幕捕获、输入、权限恢复以及手机和网络行为仍需在实体设备上测试。

`SHA256SUMS.txt` 包含两个安装包的 SHA256 校验和。
剩余依赖例外、开发工具链安全公告及许可证审查事项见[发行前提](https://github.com/Abreto/palmdesk/blob/v0.0.8/docs/OPEN_SOURCE_READINESS.md)。
