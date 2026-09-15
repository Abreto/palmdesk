Experimental PalmDesk desktop installers for testing.

## What's new in v0.0.3

- Read local Codex, Claude Code and Claude Desktop Code sessions from your phone on macOS. The reader is built into PalmDesk and does not require a separate Glassline deployment.
- Search sessions by project, title or recent messages, read Markdown replies and tool output, copy text, load earlier history and return to the application window. Session reading is off by default; enable it on the computer to allow connected devices to read local session content.
- Improve macOS window streaming sharpness and video quality settings.
- Sign macOS previews with a fixed self-signed certificate and stable native helper identity. Release builds now refuse missing or mismatched certificates instead of using ad-hoc signing.

Session reading currently supports the current user's local logs on macOS. Claude Desktop support covers local Code sessions, not Chat/Cowork, cloud or SSH sessions. Windows continues to use the window view. See the [session reader guide](https://github.com/Abreto/palmdesk/blob/v0.0.3/README.md) for details and limits.

[Changes since v0.0.2](https://github.com/Abreto/palmdesk/compare/v0.0.2...v0.0.3)

## Installation

| Download            | Computer                          |
| ------------------- | --------------------------------- |
| `*-mac-arm64.dmg`   | Apple Silicon Mac                 |
| `*-windows-x64.exe` | Windows 10 1903+ / Windows 11 x64 |

Open the DMG and drag PalmDesk into Applications, or run the Windows installer.
Node.js, pnpm, Xcode and Visual Studio are not needed on the user's computer.

- macOS builds now use a fixed self-signed certificate, not a Developer ID signature, and are not notarized. Gatekeeper may still block opening them. Screen Recording and Accessibility permissions are required for remote control.
- **Upgrading from v0.0.2 or earlier:** the signing identity changes once. Fully quit PalmDesk, install this version, and reauthorize Screen Recording and Accessibility if needed. If the old entries remain ineffective, remove them and add `/Applications/PalmDesk.app` again, then restart. Later builds using the same certificate retain a stable signing identity; actual permission retention still needs validation on your macOS version. Users do not need the signing private key.
- Windows installers are unsigned. SmartScreen or organization policies may warn or block installation.
- The macOS package is for Apple Silicon only, built on macOS 15. Intel Macs are not supported by this prerelease. Earlier macOS versions have not been validated.
- The desktop app connects to https://palmdesk.abreto.icu by default. The phone web client and desktop must use the same service. The installer does not include the backend.
- Automatic updates are not included. Download and install a newer release to update.

These builds pass source checks and packaging verification in CI. Real screen capture, input, permission recovery and phone/network behavior still require testing on physical devices.

`SHA256SUMS.txt` contains SHA256 hashes of the two installers.
This prerelease does not resolve the known dependency and license review items in [release prerequisites](https://github.com/Abreto/palmdesk/blob/main/docs/OPEN_SOURCE_READINESS.md).

## 中文说明

供测试使用的 PalmDesk 桌面安装包。

### v0.0.3 更新内容

- 支持从手机阅读 macOS 当前用户的 Codex、Claude Code 和 Claude Desktop 本地 Code 会话。读取模块已内置，无须单独部署 Glassline。
- 支持按项目、标题或最近消息搜索会话，阅读 Markdown 回复和工具输出、复制文字、加载历史以及返回应用窗口。「会话阅读」默认关闭，需要在电脑上开启后，已连接设备才能读取本地内容。
- 改善 macOS 窗口视频清晰度和画质设置。
- macOS 测试版改用固定自签名证书，并固定原生辅助程序的签名标识。发布时若证书缺失或不匹配，构建会失败，不再退回 ad-hoc 签名。

会话阅读目前仅支持 macOS 当前用户的本地日志。Claude Desktop 仅支持本地 Code，会话不包括 Chat/Cowork、云端和 SSH；Windows 继续使用窗口视图。详细说明及限制见[会话阅读指南](https://github.com/Abreto/palmdesk/blob/v0.0.3/README.zh-CN.md)。

[查看自 v0.0.2 以来的改动](https://github.com/Abreto/palmdesk/compare/v0.0.2...v0.0.3)

### 安装说明

| 下载                | 适用设备                                |
| ------------------- | --------------------------------------- |
| `*-mac-arm64.dmg`   | Apple Silicon Mac                       |
| `*-windows-x64.exe` | Windows 10 1903 及以上 / Windows 11 x64 |

打开 DMG 后将 PalmDesk 拖入“应用程序”，或运行 Windows 安装程序。用户电脑无需安装 Node.js、pnpm、Xcode 或 Visual Studio。

- macOS 构建改用固定自签名证书，没有 Developer ID 签名，也没有经过公证。Gatekeeper 仍可能阻止打开；远程控制需要授予“屏幕录制”和“辅助功能”权限。
- **从 v0.0.2 或更早版本升级：** 本次签名身份会变化。请完全退出 PalmDesk，安装本版本，按需重新授予两项权限。若旧条目仍不生效，请移除后重新添加 `/Applications/PalmDesk.app`，然后重启应用。后续使用同一证书的构建保持稳定签名身份；实际权限保留仍需在所用 macOS 版本上验证。普通用户无需导入签名私钥。
- Windows 安装包未签名，SmartScreen 或组织安全策略可能发出警告或阻止安装。
- macOS 安装包仅支持 Apple Silicon，使用 macOS 15 构建；本测试版不支持 Intel Mac，尚未验证更早版本的 macOS。
- 桌面端默认连接 https://palmdesk.abreto.icu。手机网页端和桌面端必须使用同一个服务；安装包不包含后端服务。
- 不包含自动更新。升级时请下载并安装新版本。

这些构建已通过 CI 中的源码检查和打包验证。真实的屏幕捕获、输入、权限恢复以及手机和网络行为仍需在实体设备上测试。

`SHA256SUMS.txt` 包含两个安装包的 SHA256 校验和。
本测试版未解决[发行前提](https://github.com/Abreto/palmdesk/blob/main/docs/OPEN_SOURCE_READINESS.md)中已知的依赖和许可证审查事项。
