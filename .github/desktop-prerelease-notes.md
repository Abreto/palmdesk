Experimental PalmDesk desktop installers for testing.

## What's new in v0.0.4

- Select or paste an image on your phone, preview it, then paste it into a macOS Codex prompt. Supports one PNG/JPEG at a time, up to 10 MiB and approximately 25 megapixels, with original resolution preserved.
- Tap the Codex prompt in the remote video before choosing “粘贴到 Codex” (Paste into Codex). PalmDesk preserves the order of the click and paste, keeps your text draft, and leaves sending the message to you. Pasting replaces the computer's clipboard with the image.
- Cancel or explicitly retry image transfers, and reconnect the image channel independently. Closing the input panel restores control; selecting a replacement image cannot accidentally send the previous image.

Update the desktop app and refresh the phone web client together. Image paste currently supports macOS Codex only; Windows image paste is not enabled. Clipboard reads need HTTPS and browser paste permission; use the image picker when unavailable. Physical iOS Safari and actual Codex attachment display still require validation. See the [image paste guide](https://github.com/Abreto/palmdesk/blob/v0.0.4/README.md#paste-images-into-codex-from-your-phone-macos) for details and limits.

[Changes since v0.0.3](https://github.com/Abreto/palmdesk/compare/v0.0.3...v0.0.4)

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
This prerelease does not resolve the known dependency and license review items in [release prerequisites](https://github.com/Abreto/palmdesk/blob/main/docs/OPEN_SOURCE_READINESS.md).

## 中文说明

供测试使用的 PalmDesk 桌面安装包。

### v0.0.4 更新内容

- 支持从手机选择或粘贴图片，预览后粘贴到 macOS Codex 的 prompt。每次支持一张 PNG/JPEG，最大 10 MiB、约 2500 万像素，保留原始分辨率。
- 先在远程画面中点击 Codex 输入框，再点击「粘贴到 Codex」。点击与粘贴按顺序执行，文字草稿保留，由你确认附件后发送消息。粘贴会将电脑剪贴板替换为图片。
- 支持取消、手动重试和单独重连图片通道；收起输入面板后恢复控制，替换图片时不会误发旧图。

请更新桌面 App 并刷新手机网页。图片粘贴目前只支持 macOS Codex，Windows 尚未开放。读取手机剪贴板需要 HTTPS 和浏览器允许粘贴，不可用时可选择图片。iOS Safari 和真实 Codex 附件显示仍需实机验收。详细说明及限制见[图片粘贴指南](https://github.com/Abreto/palmdesk/blob/v0.0.4/README.zh-CN.md#从手机给-codex-粘贴图片macos)。

[查看自 v0.0.3 以来的改动](https://github.com/Abreto/palmdesk/compare/v0.0.3...v0.0.4)

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
本测试版未解决[发行前提](https://github.com/Abreto/palmdesk/blob/main/docs/OPEN_SOURCE_READINESS.md)中已知的依赖和许可证审查事项。
