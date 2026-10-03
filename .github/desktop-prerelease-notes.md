Experimental PalmDesk desktop installers for testing.

## What's new in v0.0.7

- Conceal connection credentials by default: hide the temporary password and blur the connection QR code until explicitly revealed, reducing accidental exposure in screenshots and screen recordings. Revealed codes and copied connection links still grant access and must be kept private.
- Open installed Codex, Claude, ChatGPT, Kimi and ZCode desktop apps from the Agent directory on macOS and Windows. PalmDesk uses the authenticated connection to request an explicit launch, then refreshes the window list: one matching window opens through the existing selection flow, while multiple windows remain your choice. Apps are not installed, prompts are not submitted, and launch requests are not replayed after reconnecting. Supported installation types and platform limits are documented in the usage guide.
- Start both connection entry points with Balanced quality: up to 2160p, 20 fps and a 3000 kbit/s (3 Mbps) bitrate ceiling. High detail retains the previous 2160p / 30 fps / 8 Mbps settings; Low data offers 1080p / 10 fps / 1 Mbps. Explicit choices and manual overrides are saved locally. Bitrate values are ceilings, not measured usage or hard data budgets; quality changes preserve background and reading-mode video suspension.

Update the desktop app and refresh the phone web client together for the new features. Self-hosted installations need the matching web frontend; the backend source and deployment adapter are unchanged from v0.0.6, so this release does not require a backend update or database migration.

Source and synthetic-browser regressions cover the new controls, preferences, authorization and recovery behavior. macOS launch/reopen has native-fixture coverage; actual Windows app launching and complete physical-phone workflows remain unvalidated. The new quality profiles have not been measured on physical phones, native Retina/Windows capture or constrained networks. iOS Safari, Android Chrome, Windows Codex image attachments, permission recovery and cross-network TURN behavior still need device validation. See the [usage guide](https://github.com/Abreto/palmdesk/blob/v0.0.7/README.md), [Agent launch validation](https://github.com/Abreto/palmdesk/blob/v0.0.7/docs/smoke-artifacts/agent-launch-2026-10-02.md) and [quality validation](https://github.com/Abreto/palmdesk/blob/v0.0.7/docs/VIDEO_QUALITY.md) for the exact boundaries.

[Changes since v0.0.6](https://github.com/Abreto/palmdesk/compare/v0.0.6...v0.0.7)

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
This prerelease does not resolve the known dependency and license review items in [release prerequisites](https://github.com/Abreto/palmdesk/blob/v0.0.7/docs/OPEN_SOURCE_READINESS.md).

## 中文说明

供测试使用的 PalmDesk 桌面安装包。

### v0.0.7 更新内容

- 默认隐藏连接凭据：临时密码保持隐藏，连接二维码保持模糊，需主动显示，减少截图和录屏时意外泄露。已显示的二维码和复制的连接链接仍可用于访问设备，请勿公开分享。
- 支持从 Agent 目录打开 macOS 和 Windows 上已安装的 Codex、Claude、ChatGPT、Kimi 和 ZCode 桌面应用。通过已认证连接明确发起启动后刷新窗口列表；一个匹配窗口进入现有选窗流程，多个窗口由用户选择。不安装应用、不提交提示词，重连后不重放启动请求。支持的安装类型及平台限制见使用指南。
- 两个连接入口默认使用「均衡」画质：最高 2160p、20 fps、3000 kbit/s（3 Mbps）码率上限。「高细节」保留原有 2160p / 30 fps / 8 Mbps 设置；「省流量」提供 1080p / 10 fps / 1 Mbps。主动选择及手动调整保存在本地。码率是上限，不代表实测流量或严格流量预算；调整画质仍保留后台和阅读模式下的视频暂停行为。

请更新桌面 App 并刷新手机网页，以使用新功能。自部署需更新到对应的网页前端；后端源码与部署适配器相较 v0.0.6 未变，本次无需更新后端或迁移数据库。

源码和模拟浏览器回归覆盖新增控件、偏好保存、鉴权及恢复行为。macOS 启动／重新打开已有原生测试应用验证；真实 Windows 应用启动及手机完整流程尚未验收。新画质预设尚无真实手机、原生 Retina／Windows 捕获或受限网络的测量结果。iOS Safari、Android Chrome、Windows Codex 图片附件、权限恢复及跨网络 TURN 仍需实机验收。具体边界见[使用指南](https://github.com/Abreto/palmdesk/blob/v0.0.7/README.zh-CN.md)、[打开 Agent 验证记录](https://github.com/Abreto/palmdesk/blob/v0.0.7/docs/smoke-artifacts/agent-launch-2026-10-02.md)及[画质验证说明](https://github.com/Abreto/palmdesk/blob/v0.0.7/docs/VIDEO_QUALITY.md)。

[查看自 v0.0.6 以来的改动](https://github.com/Abreto/palmdesk/compare/v0.0.6...v0.0.7)

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
本测试版未解决[发行前提](https://github.com/Abreto/palmdesk/blob/v0.0.7/docs/OPEN_SOURCE_READINESS.md)中已知的依赖和许可证审查事项。
