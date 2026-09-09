Experimental PalmDesk desktop installers for testing.

## What's new in v0.0.2

- The phone now opens an Agent directory that recognizes running Codex, Claude, ChatGPT, Kimi and ZCode apps on macOS and Windows. Open a single window directly or choose among multiple windows; apps without an available window still keep an entry.
- Pin Agents per device and sort by recent use. Other applications remain available, and terminal or other windows can be manually linked to an Agent. These links survive refreshes within the current connection and reset after reconnecting.
- Improve mobile scrolling responsiveness and sensitivity in both directions, accumulate small touch movements, remove the default mouse input delay and speed up macOS focus checks when the target window is already focused.
- Isolate local desktop builds by checkout, including application identity, permissions and data. Distribution builds explicitly use `--release` to retain the PalmDesk release identity.
- Add Chinese installation notes and update backend source references to the PalmDesk-maintained fork.

Agent discovery identifies running applications; it does not read Agent sessions, project directories or task status.

[Changes since v0.0.1](https://github.com/Abreto/palmdesk/compare/v0.0.1...v0.0.2)

## Installation

| Download            | Computer                          |
| ------------------- | --------------------------------- |
| `*-mac-arm64.dmg`   | Apple Silicon Mac                 |
| `*-windows-x64.exe` | Windows 10 1903+ / Windows 11 x64 |

Open the DMG and drag PalmDesk into Applications, or run the Windows installer.
Node.js, pnpm, Xcode and Visual Studio are not needed on the user's computer.

- macOS builds have a local ad-hoc signature, not a Developer ID signature, and are not notarized. Gatekeeper may block opening them. Screen Recording and Accessibility permissions are required for remote control.
- Windows installers are unsigned. SmartScreen or organization policies may warn or block installation.
- The macOS package is for Apple Silicon only, built on macOS 15. Intel Macs are not supported by this prerelease. Earlier macOS versions have not been validated.
- The desktop app connects to https://palmdesk.abreto.icu by default. The phone web client and desktop must use the same service. The installer does not include the backend.
- Automatic updates are not included. Download and install a newer release to update.

These builds pass source checks and packaging verification in CI. Real screen capture, input, permission recovery and phone/network behavior still require testing on physical devices.

`SHA256SUMS.txt` contains SHA256 hashes of the two installers.
This prerelease does not resolve the known dependency and license review items in [release prerequisites](https://github.com/Abreto/palmdesk/blob/main/docs/OPEN_SOURCE_READINESS.md).

## 中文说明

供测试使用的 PalmDesk 桌面安装包。

### v0.0.2 更新内容

- 手机连接后进入 Agent 目录，自动识别 macOS 和 Windows 上已打开的 Codex、Claude、ChatGPT、Kimi 和 ZCode。单窗口直接进入，多窗口展开选择；没有可用窗口的应用仍保留入口。
- 支持按设备置顶 Agent、按最近使用排序；“其他应用”保留通用窗口控制，并可将终端等窗口手动关联到 Agent。关联在本次连接内刷新后保留，重新连接后需重新关联。
- 改善手机横向和纵向滚动的响应与灵敏度，累积细微触摸位移、移除默认鼠标输入延迟，并优化 macOS 目标窗口已聚焦时的检查流程。
- 本地桌面构建按工作区隔离应用身份、权限和数据；发行构建显式使用 `--release`，保持 PalmDesk 正式身份。
- 补充中文安装说明，将后端源码引用更新为 PalmDesk 维护的 fork。

Agent 识别仅表示检测到已打开的应用，尚不读取真实会话、项目目录或任务状态。

[查看自 v0.0.1 以来的改动](https://github.com/Abreto/palmdesk/compare/v0.0.1...v0.0.2)

### 安装说明

| 下载                 | 适用设备                          |
| -------------------- | --------------------------------- |
| `*-mac-arm64.dmg`    | Apple Silicon Mac                 |
| `*-windows-x64.exe`  | Windows 10 1903 及以上 / Windows 11 x64 |

打开 DMG 后将 PalmDesk 拖入“应用程序”，或运行 Windows 安装程序。用户电脑无需安装 Node.js、pnpm、Xcode 或 Visual Studio。

- macOS 构建使用本地 ad-hoc 签名，没有 Developer ID 签名，也没有经过公证。Gatekeeper 可能会阻止打开；远程控制需要授予“屏幕录制”和“辅助功能”权限。
- Windows 安装包未签名，SmartScreen 或组织安全策略可能发出警告或阻止安装。
- macOS 安装包仅支持 Apple Silicon，使用 macOS 15 构建；本测试版不支持 Intel Mac，尚未验证更早版本的 macOS。
- 桌面端默认连接 https://palmdesk.abreto.icu。手机网页端和桌面端必须使用同一个服务；安装包不包含后端服务。
- 不包含自动更新。升级时请下载并安装新版本。

这些构建已通过 CI 中的源码检查和打包验证。真实的屏幕捕获、输入、权限恢复以及手机和网络行为仍需在实体设备上测试。

`SHA256SUMS.txt` 包含两个安装包的 SHA256 校验和。
本测试版未解决[发行前提](https://github.com/Abreto/palmdesk/blob/main/docs/OPEN_SOURCE_READINESS.md)中已知的依赖和许可证审查事项。
