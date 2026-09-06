# Codex Remote

基于 [BilldDesk](https://github.com/galaxy-s10/billd-desk) 二次开发的手机远控客户端：手机浏览器连接电脑，从窗口列表中选择并观看或操作普通应用窗口，包括 Codex、ChatGPT、Claude 和终端。

视频来自 Electron 单窗口捕获，输入经 WebRTC DataChannel、Electron IPC 和系统鼠标键盘接口到达目标窗口。设备注册、连接密码与信令使用 BilldDesk 后端。没有使用 Codex app-server，也不读取或同步聊天记录。

## 当前范围

- 手机连接页、设备历史、横竖屏控制界面、画质和帧率选择。
- 手机端窗口列表、应用名和标题搜索、缩略图、手动刷新；选择后才开始视频捕获。
- 控制页可“断开并重选窗口”，保留设备连接信息并重新获取列表；Codex/ChatGPT 窗口优先显示，同组窗口保持原有顺序。
- 点击、双击、长按右键、拖拽、滚动、画面缩放与本地平移、只读模式。
- 本地中文输入框、发送文字、回车和常用按键、硬件键盘。
- macOS 主机按应用 bundle ID、PID 和原生窗口 ID 识别目标，标题可以是任务名。
- 每次输入刷新精确窗口边界并验证聚焦；窗口消失、捕获结束和连接断开时停止输入并释放按键。
- API、信令和 TURN 地址可配置；浏览器默认使用当前域名。

目前原生主机适配器支持 macOS。Windows/Linux 主机没有经过身份校验的适配器，会明确拒绝捕获和输入。浏览器控制端不受此主机限制。

## 本地启动

需要 Node.js 22、项目依赖、macOS Xcode Command Line Tools，以及运行中的 BilldDesk API/Socket.IO 后端。服务端是单独的项目，不随前端自动启动。

```bash
pnpm install
npm run dev:desktop
```

桌面启动脚本会编译 Swift 窗口辅助程序，并创建独立身份的开发应用：

```text
.local/electron-dev/Electron.app
bundle ID: com.codexremote.desktop.dev
```

首次启动会复制并本地签名 Electron。给该应用配置“屏幕录制”和“辅助功能”权限，避免将权限授予其他项目共用的 Electron 身份。只观看需要屏幕录制，输入还需要辅助功能。屏幕录制授权后可能需要重启客户端。

打开要观察或控制的普通应用窗口，使其位于当前桌面且未最小化。手机打开同一服务的网页，输入电脑显示的设备代码和密码，通过验证后在手机上选择窗口。电脑端和手机网页需要使用本版本。

窗口列表通过已验证连接的 WebRTC DataChannel 传输，不需要修改 BilldDesk 服务端。列表只包含当前桌面可捕获的普通应用窗口，排除本客户端自己的窗口；不包含整个屏幕、最小化窗口或其他桌面的窗口。窗口关闭或身份变化后不会自动选择其他窗口。

只开发手机网页：

```bash
npm run dev:web
```

默认本地地址为 `http://localhost:5173/`，Vite 将 `/api` 和 `/socket.io` 代理到本机 `4300`。端口已占用时以终端输出为准。手机上的 `localhost` 指手机自身；使用手机实机时需可达的局域网/HTTPS 地址，参见 [服务配置](docs/SERVICE_CONFIGURATION.md)。

本次已启动的官方本地测试后端及重启方式见 [开发环境](docs/LOCAL_DEVELOPMENT.md)。

## 构建与检查

```bash
npm run test:smoke
node --test test/smoke/signaling.test.mjs
./node_modules/.bin/vue-tsc --noEmit
./node_modules/.bin/vite build
npm run build:prod
```

信令测试需要本地后端。浏览器和 Electron 烟测命令见 [最新验证报告](docs/CODEX_REMOTE_REPAIR_RESULTS.md)。

macOS 本地应用打包：

```bash
npm run build:desktop
```

输出位于 `electron-release/`，窗口辅助程序由打包钩子编译并复制。正式分发仍需自己的应用签名和公证。

## 验证边界

最新业务烟测运行了真实 Vue 页面、官方本地后端、Socket.IO、WebRTC 视频解码和输入 DataChannel；其中原生视频源与系统输入使用测试替身。独立 Electron 客户端的启动、权限读取、IPC 来源校验已经实测。

窗口选择烟测覆盖选窗前不捕获、跨应用选择、搜索和刷新、权限错误、空列表、选窗前关闭窗口、断开重选、视频像素检查及手机横竖屏布局。单元测试覆盖列表选择标识的隔离、失效标识和捕获前的窗口身份复核。

真实 Codex 窗口的画面隐私、系统输入和权限恢复，以及 iOS Safari 实机、跨 NAT/TURN，尚未完成验收。系统输入依赖操作系统前台焦点，并非应用内部输入 API；本机用户同时操作或系统快捷键仍可能改变焦点。详细结果和剩余验收步骤见 [最新报告](docs/CODEX_REMOTE_REPAIR_RESULTS.md)。

## 上游

保留 BilldDesk 的 [MIT 许可证](LICENSE.txt) 和版权声明。上游开源版介绍见 [README_OpenSource.md](README_OpenSource.md)；上游 Pro 功能清单不代表本分支已实现或通过验证。
