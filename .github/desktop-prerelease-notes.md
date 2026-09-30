Experimental PalmDesk desktop installers for testing.

## What's new in v0.0.6

- Read local Codex, Claude Code and Claude Desktop Code sessions on Windows, alongside the existing macOS support. Enable Session reading on the host to browse searchable sessions, Markdown replies, history and tool output from your phone. Reading is off by default and stays read-only; cloud, SSH, WSL and Desktop Chat/Cowork sessions are not included.
- Paste a single PNG/JPEG from your phone into a Windows Codex prompt, with the same 10 MiB limit as macOS. Click the intended prompt first, then explicitly paste. PalmDesk verifies the target window, focus and clipboard image before sending Ctrl+V; text drafts remain intact and messages are not submitted automatically. Pasting replaces the host clipboard. Cancelled or uncertain operations are not retried automatically.
- Introduce the original Palm Window identity: a desktop window resting in an open palm, with refreshed macOS and Windows application icons, browser icons, and desktop/mobile navigation marks.

Update the desktop app and refresh the phone web client together for the new Windows features. Windows session discovery and image paste have automated and native-fixture coverage; end-to-end testing with a physical phone and the actual agent apps remains incomplete. iOS Safari, Android Chrome, elevated Windows targets and network handoffs still need device validation. See the [usage guide](https://github.com/Abreto/palmdesk/blob/v0.0.6/README.md) for details and limits.

[Changes since v0.0.5](https://github.com/Abreto/palmdesk/compare/v0.0.5...v0.0.6)

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
- The macOS package is for Apple Silicon only, built on macOS 15. Intel Macs are not supported by this prerelease. Earlier macOS versions have not been validated.
- The desktop app connects to https://palmdesk.abreto.icu by default. The phone web client and desktop must use the same service. The installer does not include the backend.
- Automatic updates are not included. Download and install a newer release to update.

These builds pass source checks and packaging verification in CI. Real screen capture, input, permission recovery and phone/network behavior still require testing on physical devices.

`SHA256SUMS.txt` contains SHA256 hashes of the two installers.
This prerelease does not resolve the known dependency and license review items in [release prerequisites](https://github.com/Abreto/palmdesk/blob/v0.0.6/docs/OPEN_SOURCE_READINESS.md).

## 中文说明

供测试使用的 PalmDesk 桌面安装包。

### v0.0.6 更新内容

- 将本地 Codex、Claude Code 和 Claude Desktop Code 会话阅读扩展到 Windows，保留已有 macOS 支持。在电脑端开启「会话阅读」后，可从手机搜索会话、阅读 Markdown 回复、历史记录和工具输出。阅读默认关闭且保持只读；不包含云端、SSH、WSL 和 Desktop Chat/Cowork 会话。
- 支持从手机向 Windows Codex 的 prompt 粘贴单张 PNG/JPEG，最大 10 MiB，与 macOS 一致。先点击目标输入框，再明确执行粘贴；PalmDesk 校验目标窗口、焦点和剪贴板图片后发送 Ctrl+V，保留文字草稿，不自动提交消息。粘贴会替换电脑剪贴板，取消或结果不确定时不会自动重试。
- 引入原创 Palm Window 品牌形象：掌心托起桌面窗口，更新 macOS、Windows 应用图标、浏览器图标以及桌面端和手机端导航标识。

请更新桌面 App 并刷新手机网页，以使用新的 Windows 功能。Windows 会话发现和图片粘贴已有自动化及原生测试窗口验证，但真实手机连接实际 Agent 应用的完整验收尚未完成。iOS Safari、Android Chrome、Windows 提权目标以及网络切换仍需实机验收。详细说明及限制见[使用指南](https://github.com/Abreto/palmdesk/blob/v0.0.6/README.zh-CN.md)。

[查看自 v0.0.5 以来的改动](https://github.com/Abreto/palmdesk/compare/v0.0.5...v0.0.6)

### 安装说明

| 下载                | 适用设备                                |
| ------------------- | --------------------------------------- |
| `*-mac-arm64.dmg`   | Apple Silicon Mac                       |
| `*-windows-x64.exe` | Windows 10 1903 及以上 / Windows 11 x64 |

打开 DMG 后将 PalmDesk 拖入“应用程序”，或运行 Windows 安装程序。用户电脑无需安装 Node.js、pnpm、Xcode 或 Visual Studio。

- macOS 构建沿用 v0.0.3 引入的固定自签名证书，没有 Developer ID 签名，也没有经过公证。Gatekeeper 仍可能阻止打开；远程控制需要授予“屏幕录制”和“辅助功能”权限。
- **从 v0.0.2 或更早版本升级：** 本次签名身份会变化。请完全退出 PalmDesk，安装本版本，按需重新授予两项权限。若旧条目仍不生效，请移除后重新添加 `/Applications/PalmDesk.app`，然后重启应用。后续使用同一证书的构建保持稳定签名身份；实际权限保留仍需在所用 macOS 版本上验证。普通用户无需导入签名私钥。
- Windows 安装包未签名，SmartScreen 或组织安全策略可能发出警告或阻止安装。
- macOS 安装包仅支持 Apple Silicon，使用 macOS 15 构建；本测试版不支持 Intel Mac，尚未验证更早版本的 macOS。
- 桌面端默认连接 https://palmdesk.abreto.icu。手机网页端和桌面端必须使用同一个服务；安装包不包含后端服务。
- 不包含自动更新。升级时请下载并安装新版本。

这些构建已通过 CI 中的源码检查和打包验证。真实的屏幕捕获、输入、权限恢复以及手机和网络行为仍需在实体设备上测试。

`SHA256SUMS.txt` 包含两个安装包的 SHA256 校验和。
本测试版未解决[发行前提](https://github.com/Abreto/palmdesk/blob/v0.0.6/docs/OPEN_SOURCE_READINESS.md)中已知的依赖和许可证审查事项。
