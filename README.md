# Codex Remote

基于 [BilldDesk](https://github.com/galaxy-s10/billd-desk) 二次开发的手机远控客户端：手机浏览器连接电脑，观看并操作选定的 Codex Desktop 或 ChatGPT Desktop 窗口。

视频来自 Electron 单窗口捕获，输入经 WebRTC DataChannel、Electron IPC 和系统鼠标键盘接口到达目标窗口。设备注册、连接密码与信令使用 BilldDesk 后端。没有使用 Codex app-server，也不读取或同步聊天记录。

## 当前范围

- 手机连接页、设备历史、横竖屏控制界面、画质和帧率选择。
- 电脑展示连接二维码，手机网页支持相机扫码和图片识码；连接链接打开后自动连接。
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

打开 Codex/ChatGPT 的普通窗口，使其位于当前桌面且未最小化，在电脑端选择目标窗口。手机打开同一服务的网页，输入电脑显示的设备代码和密码。

也可在电脑的“手机扫码连接”区域设置手机网页地址，随后用手机网页里的扫码按钮、系统相机或微信扫描二维码。二维码包含当前设备代码和临时密码，网页打开后自动连接；更新密码会使旧二维码失效。地址、HTTPS 和微信兼容性说明见 [扫码连接](docs/SERVICE_CONFIGURATION.md#扫码连接)。

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

真实 Codex 窗口的画面隐私、系统输入和权限恢复，以及 iOS Safari 实机、跨 NAT/TURN，尚未完成验收。系统输入依赖操作系统前台焦点，并非应用内部输入 API；本机用户同时操作或系统快捷键仍可能改变焦点。详细结果和剩余验收步骤见 [最新报告](docs/CODEX_REMOTE_REPAIR_RESULTS.md)。

## 上游

保留 BilldDesk 的 [MIT 许可证](LICENSE.txt) 和版权声明。上游开源版介绍见 [README_OpenSource.md](README_OpenSource.md)；上游 Pro 功能清单不代表本分支已实现或通过验证。
