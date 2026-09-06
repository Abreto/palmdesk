# 本地开发

## 环境与服务端

客户端使用 Node.js 22 和 `package.json` 固定的 pnpm 版本；macOS 主机还需要 Xcode Command Line Tools。浏览器前端可以独立启动，但设备注册和连接必须有后端。

1. 在独立目录部署 [billd-desk-server](https://github.com/galaxy-s10/billd-desk-server)。历史烟测使用提交 `c73983e543341c08ce9e4fb7c52446be50b6c6a2`，参见 [对应服务端说明](https://github.com/galaxy-s10/billd-desk-server/tree/c73983e543341c08ce9e4fb7c52446be50b6c6a2)。
2. 按服务端文档配置 MySQL、Redis 和服务端密钥，初始化数据库及 live 配置。服务端密钥留在服务端目录，不写入客户端的 `VITE_*` 变量。
3. 将开发后端监听地址配置为 `127.0.0.1:4300`，并允许实际前端 origin。改用其他地址时，调整本项目 `vite.config.ts` 的开发代理或显式配置 API / 信令 URL。
4. 在本仓库运行以下命令，再按 [服务配置](SERVICE_CONFIGURATION.md) 连接手机。

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev:desktop
```

依赖含原生模块和 Electron，首次安装需要访问 npm 和 Electron 的下载服务。`pnpm-workspace.yaml` 已允许 Electron、esbuild 和 vue-demi 的必要安装脚本，并禁用遗留部署、图标工具及提示信息脚本。CI 的 `--ignore-scripts` 安装仅用于源码检查；本地启动桌面端请使用上面的普通安装命令。

Electron 下载器需要代理时，设置 `ELECTRON_GET_USE_PROXY=1` 和指向自己 HTTP 代理的 `GLOBAL_AGENT_HTTP_PROXY`。这些是本机安装环境变量，不写入客户端构建配置。本次首次安装在配置代理后完成，并核对了 Electron 可执行文件和 Vue 3 兼容层。

只开发网页时运行 `pnpm dev:web`，局域网实机调试使用 `pnpm dev:web:lan`。启动时以终端输出的端口为准。

## 检查

无需后端的检查：

```bash
pnpm test:smoke
pnpm typecheck
pnpm build:prod
```

macOS 上另可运行 `pnpm build:native` 和 `pnpm build:desktop`。GitHub Actions 工作流仍需在新仓库中实际运行后确认云端通过。

后端启动后运行信令测试：

```bash
node --test test/smoke/signaling.test.mjs
```

## 浏览器与 Electron 烟测

烟测使用 Playwright 和本机 Chrome。把额外依赖装在被 Git 忽略的目录：

```bash
npm install --prefix .local/smoke --no-package-lock --no-save playwright
NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/business-flow.mjs
```

默认 Chrome 路径为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，可用 `SMOKE_BROWSER_EXECUTABLE` 覆盖。`SMOKE_CLIENT_URL` 默认 `http://localhost:5173`，`SMOKE_BACKEND_URL` 默认 `http://127.0.0.1:4300`。

Electron 外壳烟测要求已构建 `electron-dist/`，通过 `pnpm dev:desktop` 生成了独立开发应用，前端及后端仍在运行，并且没有其他 PalmDesk 实例占用单实例锁：

```bash
NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/desktop-shell.mjs
```

扫码流程使用同一个烟测入口，指定可达的局域网地址（不要用回环地址）：

```bash
pnpm dev:web:lan --port 5187
```

另一个终端运行：

```bash
NODE_PATH="$PWD/.local/smoke/node_modules" \
SMOKE_HOST_URL=http://127.0.0.1:5187 \
SMOKE_CLIENT_URL=http://192.168.1.10:5187 \
SMOKE_QR=true \
SMOKE_ARTIFACT_DIR=.local/qr-artifacts \
node test/smoke/business-flow.mjs
```

将客户端 IP 替换为本机地址。模拟电脑端使用回环地址获得与 Electron 一致的安全上下文，手机端使用局域网 HTTP 验证相机受限时的流程。该测试实际渲染和解码 host 二维码，运行本地 API、Socket.IO 和 WebRTC，覆盖链接直达、图片识码、相机帧识码、密码变更、无效码、设备离线、失败重试和相机释放。相机视频、原生窗口捕获和系统输入使用测试替身，不操作真实应用窗口，也不代表手机相机或微信已实机验收。

测试会写入 `docs/smoke-artifacts/`。提交截图前检查设备代码、密码和窗口内容；合成视频测试不代表真实窗口验收完成。旧报告记录的是当时的本机测试环境，临时目录、容器和进程不属于新克隆的前置条件。

## 应用身份

开发版为 `io.github.abreto.palmdesk.dev`，打包版为 `io.github.abreto.palmdesk`。从旧 Codex Remote 版本迁移需要重新授予权限，原有连接设置不自动迁移。

应用不会读取 Codex 会话目录；视频捕获使用窗口源，输入使用操作系统鼠标、键盘和前台焦点。真实窗口和手机验收项目见 [验证报告](CODEX_REMOTE_REPAIR_RESULTS.md)。
