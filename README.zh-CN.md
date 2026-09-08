# PalmDesk

[English](README.md) | 简体中文

从手机浏览器观看并操作电脑上的指定窗口。

PalmDesk 由 [Abreto](https://github.com/Abreto) 维护，基于 [BilldDesk](https://github.com/galaxy-s10/billd-desk) 开源版开发。支持从手机端选择 macOS 和 Windows 普通应用窗口，包括 Codex、ChatGPT、Claude 和终端，电脑浏览器也可作为控制端。

**状态：实验原型，尚未发布稳定版。** 当前需要自行部署后端、连接设备后在手机端选择窗口；“打开即恢复到上次窗口”属于后续计划。已知依赖告警和发布前待办见 [开源准备记录](docs/OPEN_SOURCE_READINESS.md)。

## 当前能力

- Electron 单窗口视频捕获，WebRTC 视频与输入 DataChannel。
- 手机连接页、设备历史、横竖屏界面、画质和帧率选择。
- 电脑展示连接二维码，手机网页支持相机扫码和图片识码；连接链接打开后自动连接并进入选窗页。
- 手机端窗口列表、应用名和标题搜索、缩略图、手动刷新；选择后才开始视频捕获。
- 窗口列表覆盖 macOS 所有桌面（Spaces）；选中其他桌面或最小化的窗口后，先激活该窗口并等待它可捕获。
- 控制页可“断开并重选窗口”，保留设备连接信息并重新获取列表；Codex/ChatGPT 窗口优先显示，同组窗口保持原有顺序。
- 点击、双击、长按右键、拖拽、滚动、缩放、平移与只读模式。
- 本地中文输入框、发送文字、回车、常用按键和硬件键盘。
- macOS 按应用 bundle ID、PID 和原生窗口 ID 识别目标；输入前刷新边界并验证聚焦。
- Windows 按 HWND、PID、可执行文件路径和进程启动时间识别目标；支持当前虚拟桌面的普通窗口、指定窗口最小化还原，以及高 DPI 和多显示器物理坐标。
- Windows 发送文字使用原生 Unicode 输入，保留中英文原文，避免中文输入法把英文转成候选词。
- 窗口消失、捕获结束、连接断开时停止输入并释放按键。
- 可配置 API、信令和 TURN；浏览器默认使用当前域名。

Linux 暂无原生主机适配器，会拒绝捕获和输入。浏览器控制端不受此主机限制。视频采用窗口源，但输入仍依赖系统焦点和鼠标键盘接口，不等于操作系统级的输入隔离。

## 本地启动

客户端需要 Node.js 22.16.0 及以上、pnpm 11.19.0。macOS 桌面端需要 Xcode Command Line Tools；Windows 10 1903 及以上 / Windows 11 x64 使用系统 .NET Framework 4.x 编译器，无需额外安装 Visual Studio，运行时需要可用的 Windows Graphics Capture。

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev:desktop
```

Windows PowerShell 将复制环境文件的命令替换为 `Copy-Item .env.example .env.local`。首次运行会编译 `native-bin/palmdesk-window.exe`，随后启动 Electron。使用 `pnpm dev:desktop:lan` 可开放开发网页供局域网手机访问。Windows 运行和测试说明见 [Windows 桌面](docs/LOCAL_DEVELOPMENT.md#windows-桌面)。

打包后的桌面客户端默认连接 `https://palmdesk.abreto.icu`，手机邀请网页也使用该地址。网页构建默认同源，开发模式使用本地后端代理，两端必须连接同一个服务。自部署可使用本仓库的 [容器适配层](containers/README.md)，它基于固定 BilldDesk 后端快照提供会话认证和 Cloudflare/coturn 临时凭据，需要 MySQL 和 Redis。部署顺序和浏览器测试方法见 [开发环境](docs/LOCAL_DEVELOPMENT.md)，地址、HTTPS 和 TURN 配置见 [服务配置](docs/SERVICE_CONFIGURATION.md)。

macOS 开发脚本编译 Swift 窗口辅助程序，并创建、本地签名独立的 Electron 应用：

```text
.local/electron-dev/Electron.app
bundle ID: io.github.abreto.palmdesk.dev
```

以上为主工作区身份；linked worktree 自动使用独立的 `PalmDesk WT <id> Dev` 名称及 `io.github.abreto.palmdesk.worktree.<id>.dev` 标识，打包版也按 worktree 隔离，避免覆盖正式版的系统权限和配置。详情及已有权限条目的修复步骤见 [应用身份](docs/LOCAL_DEVELOPMENT.md#应用身份)。

macOS 上需给 PalmDesk Dev 配置“屏幕录制”和“辅助功能”权限。观看当前桌面可捕获的窗口需要屏幕录制；切换桌面、还原窗口和发送输入还需要辅助功能，即使处于只读模式也需要授权才能自动切换。屏幕录制授权后可能需要重启。从 Codex Remote 开发版迁移时，应用身份和本地数据目录已改变，需要重新授权和设置连接服务。

打开要观察或控制的普通应用窗口，可以放在任意 macOS 桌面，或当前 Windows 虚拟桌面。手机打开同一服务的网页，输入电脑显示的设备代码和密码，通过验证后在手机上选择窗口。电脑端和手机网页需要使用本版本。

也可在电脑的“手机扫码连接”区域设置手机网页地址，随后用手机网页里的扫码按钮、系统相机或微信扫描二维码。二维码包含当前设备代码和临时密码，网页打开后自动连接；更新密码会使旧二维码失效。地址、HTTPS 和微信兼容性说明见 [扫码连接](docs/SERVICE_CONFIGURATION.md#扫码连接)。

窗口列表通过已验证连接的 WebRTC DataChannel 传输，不需要修改 BilldDesk 服务端。列表包含当前用户会话中 macOS 各桌面或 Windows 当前虚拟桌面的普通应用窗口，排除本客户端、桌面元素和整个屏幕。macOS 其他桌面、隐藏或最小化的窗口标注“未在当前桌面显示”，仍可展示缩略图。macOS 14 及以上在 Electron 缺少预览时，使用 ScreenCaptureKit 单窗口截图补齐，不激活窗口或切换桌面；系统无法提供画面时保留可选择的窗口条目。选择后主机会激活目标窗口，macOS 可按需切换桌面，最小化时只还原所选窗口。系统或应用拒绝激活、无法唯一识别窗口时会报错；只有窗口实际出现在捕获列表中才会启动视频。刷新列表不会切换桌面，窗口关闭、切离可捕获桌面或身份变化后会结束会话，不会自动选择其他窗口。

macOS 的辅助功能接口可能省略其他桌面的窗口。跨桌面激活会按需动态调用 SkyLight 私有接口读取桌面归属，通过 Mission Control 选择目标桌面，再验证目标实际可见、身份和焦点一致；切换时主机会短暂显示 Mission Control。原生 AX 窗口 ID 用于区分同名同尺寸窗口，接口不可用时只接受唯一的标题与边界匹配。这些接口依赖 macOS 版本，无法完成校验时会停止选择并报错。没有辅助功能信息的不可见无标题窗口会被过滤。

只开发网页：

```bash
pnpm dev:web
```

默认地址为 `http://localhost:5173/`，Vite 将 `/api` 和 `/socket.io` 代理到本机 `4300`。端口被占用时以终端输出为准。手机上的 `localhost` 指手机自身，需要使用可达的局域网地址或 HTTPS 域名。

## 构建与检查

```bash
pnpm test:smoke
pnpm typecheck
pnpm build:prod
pnpm build:native
pnpm build:desktop
```

`build:native` 和 `build:desktop` 按当前主机选择 macOS 或 Windows；本地应用输出在 `electron-release/`，Windows 可运行目录为其中的 `win-unpacked/`。在 Windows 上运行 `pnpm build:desktop:win` 可显式构建 Windows 版本。构建命令不发布 GitHub Release。正式安装包分发仍需处理依赖告警、图标来源、第三方许可和应用签名；macOS 还需要公证。

Apple Silicon Mac 上使用 `pnpm dist:mac`、Windows 上使用 `pnpm dist:win` 生成本地安装包。手动触发 **Desktop Prerelease** 工作流可构建 Apple Silicon Mac 和 Windows x64 安装包，全部成功后统一发布到 GitHub Prerelease，并附 SHA256 校验文件。暂不支持 Intel Mac 安装包。这些测试包尚未完成发行签名或公证。版本规则、操作步骤及安装限制见 [桌面安装包与预发布](docs/DESKTOP_RELEASES.md)。

没有签名证书时，macOS 桌面构建会为整个应用及其辅助程序执行本地 ad-hoc 签名并校验，确保 macOS 能识别 PalmDesk 的应用身份；这不替代分发签名。明确配置的证书不可用时构建会失败。

本地签名在重建后可能使旧授权失效，辅助功能和屏幕录制都需要检查。修改授权后，请完全退出 PalmDesk 并重新启动；仅关闭窗口或刷新窗口列表可能仍保留旧进程的权限状态。若重启后仍未授权，请在对应权限列表中移除旧项，再添加并授权当前构建的 `PalmDesk.app`，然后再次完全退出并重启。

信令集成测试需要正在运行的后端：

```bash
node --test test/smoke/signaling.test.mjs
```

GitHub Actions 配置包含 Linux、macOS、Windows 单元测试、类型检查和网页构建，以及 macOS / Windows 辅助程序编译，不覆盖真实远控或公网部署。

网页和部署适配后的后端可通过主仓库的 GitHub Actions 构建为 Docker 镜像，并发布到 GHCR。镜像名称、固定后端版本及构建方式见 [容器镜像](containers/README.md)；生产凭据、数据库和 Tunnel 由部署环境管理。

## 验证边界与计划

已有烟测覆盖真实 Vue 页面、官方本地后端、Socket.IO、WebRTC 视频解码和输入 DataChannel，其中原生视频源与系统输入使用测试替身。历史结果见 [验证报告](docs/CODEX_REMOTE_REPAIR_RESULTS.md)，报告与截图中的 Codex Remote 是项目旧名称。

单独的 Windows 原生测试验证真实窗口捕获与输入。[公网后端验证](docs/smoke-artifacts/public-backend-2026-09-08.md) 记录了打包版 Windows 主机的真实 WGC 视频和 Win32 输入，以及用户随后确认的手机实测成功；跨网络 TURN 行为尚未验证。

窗口选择烟测覆盖选窗前不捕获、跨应用选择、搜索和刷新、权限错误、空列表、选窗前关闭窗口、断开重选、视频像素检查及手机横竖屏布局。单元测试覆盖列表选择标识的隔离、失效标识和捕获前的窗口身份复核。

macOS 原生跨桌面烟测使用两个临时窗口，验证普通桌面与全屏桌面的切换、最小化还原和捕获像素；会短暂切换主机桌面，结束后关闭临时窗口。先编译原生辅助程序，并给开发版 Electron 授予屏幕录制和辅助功能权限，再运行：

```bash
pnpm build:native
.local/electron-dev/Electron.app/Contents/MacOS/Electron test/smoke/native-window-spaces.cjs
```

设置 `SMOKE_PREVIEWS_ONLY=true` 可只验证其他桌面的预览像素与内容刷新，检查截图期间桌面和焦点保持不变。

尚待完成：真实窗口视频流与系统输入的完整验收、权限恢复、iOS Safari 实机、跨 NAT / TURN；以及保存目标后自动直达和重连恢复。原生烟测验证了真实窗口列表、桌面切换、精确焦点和捕获缩略图像素。系统输入依赖操作系统前台焦点，本机用户同时操作或系统快捷键仍可能改变焦点。

## 贡献与许可证

问题和建议提交到 [PalmDesk Issues](https://github.com/Abreto/palmdesk/issues)，参见 [贡献说明](.github/CONTRIBUTING.md)。安全问题见 [SECURITY.md](SECURITY.md)，不要公开设备密码、TURN 凭据或未脱敏的窗口截图。

项目采用 [MIT 许可证](LICENSE.txt)，保留上游 shuisheng 的版权声明并增加 Abreto 的署名。上游归属和依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。[上游开源版说明](README_OpenSource.md) 中的产品、服务和 Pro 功能不代表 PalmDesk 的能力。PalmDesk 是独立项目，与 OpenAI、Anthropic 或 BilldDesk 官方无隶属关系。
