# PalmDesk

从手机浏览器观看并操作电脑上的指定窗口。

PalmDesk 由 [Abreto](https://github.com/Abreto) 维护，基于 [BilldDesk](https://github.com/galaxy-s10/billd-desk) 开源版开发。支持从手机端选择 macOS 普通应用窗口，包括 Codex、ChatGPT、Claude 和终端，电脑浏览器也可作为控制端。

**状态：实验原型，尚未发布稳定版。** 当前需要自行部署后端、连接设备后在手机端选择窗口；“打开即恢复到上次窗口”属于后续计划。已知依赖告警和发布前待办见 [开源准备记录](docs/OPEN_SOURCE_READINESS.md)。

## 当前能力

- Electron 单窗口视频捕获，WebRTC 视频与输入 DataChannel。
- 手机连接页、设备历史、横竖屏界面、画质和帧率选择。
- 手机端窗口列表、应用名和标题搜索、缩略图、手动刷新；选择后才开始视频捕获。
- 控制页可“断开并重选窗口”，保留设备连接信息并重新获取列表；Codex/ChatGPT 窗口优先显示，同组窗口保持原有顺序。
- 点击、双击、长按右键、拖拽、滚动、缩放、平移与只读模式。
- 本地中文输入框、发送文字、回车、常用按键和硬件键盘。
- macOS 按应用 bundle ID、PID 和原生窗口 ID 识别目标；输入前刷新边界并验证聚焦。
- 窗口消失、捕获结束、连接断开时停止输入并释放按键。
- 可配置 API、信令和 TURN；浏览器默认使用当前域名。

Windows / Linux 暂无原生主机适配器，会拒绝捕获和输入。浏览器控制端不受此主机限制。视频采用窗口源，但输入仍依赖系统焦点和鼠标键盘接口，不等于操作系统级的输入隔离。

## 本地启动

已验证开发环境为 Node.js 22.16.0、pnpm 11.19.0、macOS / Apple Silicon。桌面端需要 Xcode Command Line Tools。

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev:desktop
```

**服务端需单独部署。** 两端必须连接同一个 [BilldDesk API / Socket.IO 后端](https://github.com/galaxy-s10/billd-desk-server)，本仓库不包含后端和数据库，也不提供公共连接服务。部署顺序和浏览器测试方法见 [开发环境](docs/LOCAL_DEVELOPMENT.md)，地址、HTTPS 和 TURN 配置见 [服务配置](docs/SERVICE_CONFIGURATION.md)。

开发脚本编译 Swift 窗口辅助程序，并创建、本地签名独立的 Electron 应用：

```text
.local/electron-dev/Electron.app
bundle ID: io.github.abreto.palmdesk.dev
```

给 PalmDesk Dev 配置“屏幕录制”和“辅助功能”权限。只观看需要屏幕录制，输入还需要辅助功能；屏幕录制授权后可能需要重启。从 Codex Remote 开发版迁移时，应用身份和本地数据目录已改变，需要重新授权和设置连接服务。

打开要观察或控制的普通应用窗口，使其位于当前桌面且未最小化。手机打开同一服务的网页，输入电脑显示的设备代码和密码，通过验证后在手机上选择窗口。电脑端和手机网页需要使用本版本。

窗口列表通过已验证连接的 WebRTC DataChannel 传输，不需要修改 BilldDesk 服务端。列表只包含当前桌面可捕获的普通应用窗口，排除本客户端自己的窗口；不包含整个屏幕、最小化窗口或其他桌面的窗口。窗口关闭或身份变化后不会自动选择其他窗口。

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

`build:native` 和 `build:desktop` 的主机目标是 macOS；本地应用输出在 `electron-release/`，构建命令不发布 GitHub Release。正式安装包分发仍需处理依赖告警、图标来源、第三方许可、应用签名与公证。

信令集成测试需要正在运行的后端：

```bash
node --test test/smoke/signaling.test.mjs
```

GitHub Actions 配置包含单元测试、类型检查、网页构建及 macOS 辅助程序编译，不覆盖真实远控或公网部署。

## 验证边界与计划

已有烟测覆盖真实 Vue 页面、官方本地后端、Socket.IO、WebRTC 视频解码和输入 DataChannel，其中原生视频源与系统输入使用测试替身。历史结果见 [验证报告](docs/CODEX_REMOTE_REPAIR_RESULTS.md)，报告与截图中的 Codex Remote 是项目旧名称。

窗口选择烟测覆盖选窗前不捕获、跨应用选择、搜索和刷新、权限错误、空列表、选窗前关闭窗口、断开重选、视频像素检查及手机横竖屏布局。单元测试覆盖列表选择标识的隔离、失效标识和捕获前的窗口身份复核。

尚待完成：真实窗口捕获与系统输入验收、权限恢复、iOS Safari 实机、跨 NAT / TURN；以及保存目标后自动直达和重连恢复。系统输入依赖操作系统前台焦点，本机用户同时操作或系统快捷键仍可能改变焦点。

## 贡献与许可证

问题和建议提交到 [PalmDesk Issues](https://github.com/Abreto/palmdesk/issues)，参见 [贡献说明](.github/CONTRIBUTING.md)。安全问题见 [SECURITY.md](SECURITY.md)，不要公开设备密码、TURN 凭据或未脱敏的窗口截图。

项目采用 [MIT 许可证](LICENSE.txt)，保留上游 shuisheng 的版权声明并增加 Abreto 的署名。上游归属和依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。[上游开源版说明](README_OpenSource.md) 中的产品、服务和 Pro 功能不代表 PalmDesk 的能力。PalmDesk 是独立项目，与 OpenAI、Anthropic 或 BilldDesk 官方无隶属关系。
