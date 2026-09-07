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

主工作区打包版为 `io.github.abreto.palmdesk`（PalmDesk），开发版为 `io.github.abreto.palmdesk.dev`（PalmDesk Dev）。linked worktree 自动使用 `io.github.abreto.palmdesk.worktree.<id>`，开发版再加 `.dev`，名称为 `PalmDesk WT <id>` 或 `PalmDesk WT <id> Dev`。`<id>` 根据该 worktree 的 Git 管理目录生成，重复构建、切换分支和 `git worktree move` 不会改变它。

构建配置为 `electron-builder.cjs`，会同时设置 bundle ID、应用名称和包内运行时名称。`pnpm dev:desktop` 同样隔离主应用及 Electron Helper 的标识。各身份的配置、浏览器存储和单实例锁位于各自的 `~/Library/Application Support/<应用名称>` 目录。每个新身份需单独授予屏幕录制和辅助功能权限；开发版从过去与 PalmDesk 共用的数据目录迁移后，需要重新配置连接服务。

`node scripts/dev.mjs --prepare-only` 可只生成开发应用，用于核对 `Info.plist` 和签名，不启动窗口或申请权限。原生及桌面烟测应使用当前 worktree 的开发应用，不能借用主工作区的 Electron，否则权限申请仍会归属被借用的应用。

worktree 的打包产物位于 `electron-release/<version>/worktree-<id>/`。准备开发应用并完成打包后，可运行 `NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/desktop-identity.mjs` 验证两种构建的主应用、Helper 标识、签名和运行时数据目录；测试仅加载空白页面，不申请屏幕录制或辅助功能权限。

### 重建与权限恢复

隔离 bundle ID 解决不同构建互相覆盖的问题；ad-hoc 签名的 designated requirement 通常包含代码哈希，重建后同一个身份仍可能需要重新授权。日常使用的主工作区版本应保持固定安装位置，并使用固定的代码签名证书。已在钥匙串安装 Developer ID 或本机代码签名证书时，可以通过 `CSC_NAME` 指定，打包和开发应用都支持；证书不可用会使构建失败。

```bash
CSC_NAME='证书名称或 SHA-1 指纹' pnpm build:desktop
```

已有权限条目指向错误副本时，先退出相关 PalmDesk 应用，移走或重新构建仍使用正式版 bundle ID 的旧 worktree 副本。在系统设置的“屏幕录制”和“辅助功能”中移除错误的 PalmDesk 条目，再添加固定位置的正式版并重新授权，最后完全退出并重启。隔离后的 worktree 应单独添加其 `PalmDesk WT <id>` 条目。

若仍需通过命令清理旧授权，只重置 PalmDesk 的对应权限，然后重新授权：

```bash
tccutil reset ScreenCapture io.github.abreto.palmdesk
tccutil reset Accessibility io.github.abreto.palmdesk
```

代码签名身份的说明见 [Apple TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html)。从旧 Codex Remote 版本迁移同样需要重新授予权限，原有连接设置不自动迁移。

应用不会读取 Codex 会话目录；视频捕获使用窗口源，输入使用操作系统鼠标、键盘和前台焦点。真实窗口和手机验收项目见 [验证报告](CODEX_REMOTE_REPAIR_RESULTS.md)。
