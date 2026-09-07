# 本地开发

## 环境与服务端

客户端使用 Node.js 22.16.0 及以上和 `package.json` 固定的 pnpm 版本；macOS 主机还需要 Xcode Command Line Tools。Windows 10 1903 及以上 / Windows 11 x64 使用系统 .NET Framework 4.x 编译器。浏览器前端可以独立启动，但设备注册和连接必须有后端。

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

桌面端局域网调试运行 `pnpm dev:desktop:lan`，同时启动 Electron 并将开发服务监听到 `0.0.0.0`。同一局域网的设备使用终端输出的 Network 地址访问；也可通过 `pnpm dev:desktop --host 0.0.0.0 --port 5173` 指定端口。

## 检查

无需后端的检查：

```bash
pnpm test:smoke
pnpm typecheck
pnpm build:prod
```

macOS 和 Windows 上另可运行 `pnpm build:native` 和 `pnpm build:desktop`，构建当前主机平台的原生辅助程序和本地应用目录。GitHub Actions 工作流包含 Windows 源码检查和辅助程序编译，云端结果以实际运行记录为准。

## Windows 桌面

在 Windows 10 1903（build 18362）及以上或 Windows 11 x64 的 PowerShell 中运行：

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm dev:desktop
```

`build:native` 和开发脚本使用 `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`，缺失时尝试 `Framework` 目录。辅助程序通过 Win32 API 枚举窗口、查询进程身份、读取物理边界和校验前台焦点。开发输出为 `native-bin/palmdesk-window.exe`，打包后位于 `resources/native/palmdesk-window.exe`，运行时不会打开控制台窗口。

手机选窗、视频和键鼠输入的操作流程与 macOS 相同。窗口列表覆盖当前虚拟桌面可见或最小化的普通应用窗口，排除任务栏、桌面、工具窗口、其他虚拟桌面的隐藏窗口及 PalmDesk 自身。选择最小化窗口时仅还原该窗口。Windows 版本不自动切换虚拟桌面。

Windows 默认以当前用户权限运行，不要求管理员授权。系统不允许普通进程向权限级别更高的程序注入输入，此时视频会保留，控制暂停并提示权限问题。使用相同权限级别运行目标应用和 PalmDesk 后可重试。UAC 安全桌面、锁屏及受保护内容不属于可控制窗口。系统拒绝前台切换或目标被模态对话框禁用时，也会暂停输入，需在电脑上处理后重试。

“发送文字”通过 Windows `SendInput` 的 Unicode 事件输入原文，不经过键盘布局或中文输入法的拼音转换，不写入系统剪贴板。发送前再次校验目标 HWND、进程身份、前台焦点和权限；常用按键与硬件键盘仍使用正常键盘事件。

应用不需要 macOS 的屏幕录制或辅助功能授权，Windows 页面不展示这些设置入口。窗口边界使用每显示器 DPI 感知的物理像素；在输入前重新读取，保留副屏负坐标，不额外乘以主显示器缩放比例。关闭窗口、切换到其他虚拟桌面或进程身份改变会结束对应捕获会话。

Windows 主机启用 Chromium 的 WGC 窗口捕获，并检查系统的 `GraphicsCaptureSession.IsSupported()` 和显示器状态。系统版本过旧、WGC 不可用或被启动参数禁用时拒绝捕获。传统 GDI 捕获的边框裁剪与 WGC 不同，因此本版本不回退到该路径。

```powershell
pnpm build:desktop:win
```

本地构建输出在 `electron-release/<version>/win-unpacked/`，可运行其中的 `PalmDesk.exe`。构建不发布安装包；发行签名和安装包分发需要另外配置。开发配置位于 `%APPDATA%\PalmDesk Dev`，打包版位于 `%APPDATA%\PalmDesk`，linked worktree 继续使用独立名称及配置目录。

原生集成烟测会创建两个临时同名窗口，检查 HWND 身份、边界刷新、指定窗口聚焦、最小化还原、失效身份和关闭窗口后的拒绝。它会短暂改变前台窗口，结束后清理测试窗口；只在解锁的交互式 Windows 会话中显式运行：

```powershell
pnpm build:native
$env:PALMDESK_NATIVE_SMOKE = 'true'
node --test test/smoke/native-window-windows.test.cjs
Remove-Item Env:PALMDESK_NATIVE_SMOKE
```

普通 `pnpm test:smoke` 不操作 Windows 前台窗口。原生烟测验证 Win32 适配器，不替代手机实机、真实 WebRTC 视频和系统输入的完整验收。

开发程序仍在运行时，未修改原生源码的构建会复用已有辅助程序。修改了 C# 源码后，先退出开发版 PalmDesk 再编译，避免 Windows 的可执行文件占用限制。

打包版的窗口视频和输入烟测不需要后端。在可解析 `playwright` 的环境中，先执行 `pnpm build:desktop:win`，然后运行：

```powershell
$env:PALMDESK_NATIVE_SMOKE = 'true'
node test/smoke/electron-window-windows.mjs
Remove-Item Env:PALMDESK_NATIVE_SMOKE
```

该测试使用临时配置目录和两个开启输入法的测试窗口，验证打包版主进程、原生窗口源、解码像素与尺寸、鼠标点击、中英文混合文字和无效会话拒绝；结束后停止视频并关闭测试进程。可用 `SMOKE_ELECTRON_EXECUTABLE` 指定其他打包版路径；`SMOKE_DESKTOP_DEV=true` 使用已构建的开发版主进程和本地辅助程序。它不覆盖手机浏览器、网络传输或混合缩放的多显示器实机组合。

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

macOS 辅助进程回归测试要求已运行 `pnpm build:desktop`、没有其他打包版实例运行，且已有屏幕录制授权：

```bash
NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/native-helper.mjs
```

测试只截取临时测试窗口，验证生成缩略图后和空闲时辅助进程均不出现在 Dock，并检查命令响应、退出和重启。传入 `native-bin/codex-window` 可检查开发版辅助程序。辅助程序启动时显式设置后台策略，避免沿用主应用的前台身份；主应用的名称、标识及权限归属保持原样。

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
