Experimental PalmDesk desktop installers for testing.

## What's new in v0.0.5

- Pinch with two fingers to zoom the remote window from fit to 300%, centered on your gesture. Pan with both fingers, or continue panning with one after lifting the other. The toolbar and text composer stay in place; choose Fit to reset.
- Pause video when the phone browser goes into the background or switches to Read mode. If the browser cannot notify the desktop before suspension, video pauses after ten seconds without controller updates.
- Resume or reconnect when returning to the same browser page, preserving the reading position and unsent text. After a disconnect, the selected window can be restored for five minutes for the same authenticated controller, after checking that the original window still exists. Closed or expired windows return to the picker.
- Refresh the desktop and mobile interface with a light theme, green actions and status indicators, compact navigation, clearer device cards, and concise copy across settings, dialogs, session reading, and window controls.

Update the desktop app and refresh the phone web client together for pause/resume support. Recovery preserves state only in the same surviving browser page; reloading or discarding the page clears it. Reading mode does not restart window capture until you return to Window. Gesture and recovery behavior has browser smoke-test coverage; physical iOS Safari, Android Chrome, and network handoffs still need device validation. See the [usage guide](https://github.com/Abreto/palmdesk/blob/v0.0.5/README.md) for details and limits.

[Changes since v0.0.4](https://github.com/Abreto/palmdesk/compare/v0.0.4...v0.0.5)

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

### v0.0.5 更新内容

- 支持围绕双指手势位置，将远程窗口从「适合」连续缩放至 300%。双指可平移画面，抬起一指后另一指可继续平移；工具栏和文字输入框保持原位，选择「适合」可重置。
- 手机浏览器进入后台或切换到阅读模式时暂停视频。若浏览器挂起前未能通知电脑，电脑端会在十秒未收到控制端状态后暂停视频。
- 返回同一浏览器页面时恢复连接或自动重连，保留阅读位置和未发送的文字。断线后五分钟内，同一已认证控制端可在重新校验原窗口身份后恢复所选窗口；窗口已关闭或恢复信息过期时返回选窗。
- 更新桌面端和手机端界面，采用浅色主题、绿色操作与状态提示、紧凑导航和更清晰的设备卡片，并精简设置、弹窗、会话阅读及窗口控制中的文案。

请更新桌面 App 并刷新手机网页，以使用暂停与恢复功能。状态仅保留在同一存活页面中，刷新页面或页面被系统回收后会清除；阅读模式重连后，只有切回「窗口」才重新捕获。手势和恢复行为已有浏览器烟测覆盖，iOS Safari、Android Chrome 以及网络切换仍需实机验收。详细说明及限制见[使用指南](https://github.com/Abreto/palmdesk/blob/v0.0.5/README.zh-CN.md)。

[查看自 v0.0.4 以来的改动](https://github.com/Abreto/palmdesk/compare/v0.0.4...v0.0.5)

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
