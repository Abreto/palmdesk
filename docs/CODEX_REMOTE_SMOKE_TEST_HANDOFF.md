# Codex Desktop 单窗口远控：实现与烟测交接

> 此文保留 2026-09-06 首版交接与验收清单。2026-09-07 已修复窗口身份、输入隔离、手机界面和业务连接，请优先阅读 [最新修复与验证结果](CODEX_REMOTE_REPAIR_RESULTS.md)。下文的标题筛选、显示器坐标回退和 800 ms 聚焦节流均已被替换，不代表当前实现。

更新日期：2026-09-06  
工作区：`/Users/abreto/workspace/codex-remote`  
分支：`main`  
基线提交：`dcfe26a`（`docs: readme`）

## 1. 当前状态

本轮已经完成 Codex Desktop 单窗口远程控制的第一版实现，并通过类型检查、Lint、格式检查和生产构建。

2026-09-06 已执行本地烟测，详见 [烟测结果与复跑命令](CODEX_REMOTE_SMOKE_TEST_RESULTS.md)。Electron 二进制已恢复，开发窗口可以启动；自行部署的官方 BilldDesk 后端、15 项主进程隔离测试及两轮浏览器合成视频 WebRTC 传输测试通过，并修复了构建和输入失效保护问题。

**当前结论为部分通过，第 9 节最低原生验收标准尚未满足。** 实际窗口枚举未找到允许的 Codex 目标，临时辅助功能授权遇到共享 Electron 应用身份问题，已撤销该次授权。真实 Codex 视频、系统输入、权限恢复、跨平台和 coturn 场景仍未验证；合成视频传输测试不能代替这些原生验收项。

实现相关改动目前都未提交，请保留现有工作区，不要重置或覆盖：

- `README.md`
- `electron-builder.json5`
- `electron-main/index.ts`
- `src/event.ts`
- `src/hooks/use-ipcRendererSend.ts`
- `src/pure-interface.ts`
- `src/views/remote/index.vue`
- `src/views/webrtc/index.vue`

以上为首次交接时的修改。本轮烟测另修改了 `vite.config.ts`，并新增 `test/smoke/`、结果文档和测试证据；全部改动仍未提交。

## 2. 产品目标和边界

目标是基于 BilldDesk 现有能力，直接远程观看和操作一台机器上的单个 Codex Desktop 窗口。

明确采用的方案：

- 使用 Electron `desktopCapturer` 捕获单个窗口。
- 使用 BilldDesk 原有 WebSocket 信令、设备码、临时密码、WebRTC 视频和 DataChannel 输入通道。
- 使用操作系统窗口 API/命令读取目标窗口边界并聚焦窗口。
- 使用 `@nut-tree-fork/nut-js` 注入鼠标、滚轮和键盘事件。

明确不做的事情：

- 不使用 Codex `app-server`。
- 不解析 Codex 内部协议。
- 不读取或同步 Codex 会话数据。
- 不默认捕获整块桌面。
- 不替换 BilldDesk 原有信令、API、鉴权或 coturn 部署。

## 3. 端到端数据流

```text
主控端 WebRTC 页面
  |  鼠标坐标归一化到 0..1000，键盘/滚轮保持行为消息
  v
WebRTC DataChannel
  v
被控端 Vue 页面
  |  转为 Electron IPC
  v
Electron 主进程
  |  校验当前激活源 -> 刷新/读取窗口边界 -> 聚焦目标窗口
  |  归一化坐标映射到目标窗口 -> nut.js 注入系统输入
  v
Codex Desktop 窗口

Codex Desktop 窗口
  |  desktopCapturer(types: ['window']) + 指定 sourceId
  v
被控端 MediaStream -> WebRTC -> 主控端 video
```

视频和输入共享同一个选中 `sourceId`。连接建立后，界面禁止手动刷新或切换窗口，避免用户主动造成视频源和输入目标不一致。

## 4. 已完成实现

### 4.1 Electron 主进程

文件：`electron-main/index.ts`

- 捕获源枚举固定为 `types: ['window']`，没有 `screen` 类型回退。
- 只保留标题匹配 `\b(codex|chatgpt|openai)\b` 的窗口。
- 返回窗口 `id`、标题、缩略图、应用图标、显示器 ID、边界来源和输入缩放比例。
- 保存唯一的 `activeCaptureSource`，所有远程输入都以该目标为准。
- 捕获请求只能选择允许列表中的源；目标不存在时清空激活源并返回错误。
- 输入前先聚焦激活窗口；聚焦调用有 800 ms 节流和并发复用。
- 主控端的 0..1000 坐标在主进程中映射到目标窗口的绝对屏幕坐标，越界值会被钳制。
- 窗口源从枚举结果中消失后，激活源会被清空，后续输入因“没有已激活的 Codex 窗口”而失败。

各平台窗口处理：

- macOS：通过 `osascript`/System Events 读取窗口位置和大小，使用应用激活、`frontmost` 和 `AXRaise` 聚焦。
- Windows：通过 PowerShell 调用 `user32.dll` 的 `GetWindowRect`，并设置 DPI aware；通过 `WScript.Shell.AppActivate` 聚焦。
- Linux：通过 `wmctrl -lG` 读取边界，通过 `wmctrl -a` 聚焦；聚焦失败时尝试 `xdotool`，再按进程名回退到 `wmctrl`。
- 窗口边界读取失败时，仅鼠标坐标映射回退到窗口所在显示器；视频仍然是选中的窗口流，不会回退成整屏视频。

### 4.2 IPC 和共享类型

文件：`src/event.ts`、`src/pure-interface.ts`、`src/hooks/use-ipcRendererSend.ts`

- 新增 `getCaptureSources` 和 `focusCaptureSource` IPC 事件。
- 新增 `ICaptureSource`、`ICaptureBounds` 和 `CaptureBoundsSource`。
- `handleScreen` 接收明确的 `sourceId`。
- 鼠标移动、按下、释放、点击、双击和拖拽消息支持 `normalized` 标记。
- DataChannel 收到的鼠标行为不再提前按主显示器换算，而是原样交给主进程按当前窗口换算。

### 4.3 被控端窗口选择和流生命周期

文件：`src/views/remote/index.vue`

- 新增“Codex 控制窗口”区域，展示允许窗口的缩略图、标题和边界读取状态。
- 支持手动刷新和选择目标；没有目标或权限失败时展示错误。
- Web 模式明确提示不能捕获本机 Codex 窗口。
- 连接建立后禁用选择和刷新按钮。
- 连接期间每 5 秒重新枚举窗口，用于刷新移动或调整大小后的边界。
- 建立捕获时将选中的 `sourceId` 传给 Electron，再用返回 ID 创建桌面 MediaStream。
- 断开连接、组件卸载或重新捕获前，会停止旧 MediaStream 的全部 track。
- 若连接在异步捕获完成前已断开，新创建的 track 会立即停止。

### 4.4 主控端输入

文件：`src/views/webrtc/index.vue`

- 根据远端 `<video>` 实际边界计算鼠标位置。
- 坐标统一归一化到 `0..1000`，不再依赖主控端或被控端显示器分辨率。
- 单击、双击、右键、按下、释放、移动/拖拽、滚轮和键盘行为继续通过原有 DataChannel 发送。

### 4.5 文档和 macOS 权限声明

文件：`README.md`、`electron-builder.json5`

- README 增加单窗口模式、使用流程、权限、平台限制和开发说明。
- macOS 打包配置增加屏幕录制和 Apple Events 用途说明。

## 5. 安全边界和已知风险

烟测时不要跳过本节。

1. 视频隔离与输入隔离不是同一件事。视频固定为窗口级捕获；但窗口边界读取失败时，鼠标会按整个显示器映射，坐标可能落到目标窗口之外。看到“按所在显示器映射”时，只能认为视频隐私边界成立，不能认为鼠标严格隔离成立。
2. 窗口识别目前只基于标题关键字，不校验进程签名、bundle ID 或可执行文件路径。标题中含 Codex、ChatGPT 或 OpenAI 的其他窗口也可能进入列表。
3. 键盘输入依赖“注入前聚焦目标窗口”。系统拒绝聚焦、应用切换竞态或辅助功能权限变化时，不能从代码层绝对保证按键只进入目标窗口。
4. macOS 尚未实际验证权限拒绝和授权后的行为；Windows DPI、多显示器；Linux X11/Wayland 均未实测。
5. Linux 读取精确边界依赖 `wmctrl`，聚焦回退依赖 `xdotool`。Wayland 通常限制全局输入和窗口枚举，当前实现主要面向 X11。
6. BilldDesk 原有远程鉴权和网络暴露面没有在本轮审计。不要在完成鉴权、TLS、日志和依赖安全审查前将测试实例暴露给不可信网络。
7. 同一个设备代码不能连接自己；完整链路应使用第二台设备或独立浏览器端。

## 6. 已完成验证

以下命令在当前改动上均已通过：

```bash
./node_modules/.bin/vue-tsc --noEmit

./node_modules/.bin/eslint \
  electron-main/index.ts \
  src/event.ts \
  src/pure-interface.ts \
  src/hooks/use-ipcRendererSend.ts \
  src/views/remote/index.vue \
  src/views/webrtc/index.vue \
  --config ./eslint.config.js

./node_modules/.bin/prettier --check \
  electron-main/index.ts \
  src/event.ts \
  src/pure-interface.ts \
  src/hooks/use-ipcRendererSend.ts \
  src/views/remote/index.vue \
  src/views/webrtc/index.vue \
  README.md \
  electron-builder.json5

./node_modules/.bin/vite build
node --check electron-dist/index.cjs
node --check electron-dist/preload.mjs
git diff --check
```

结果：Vue/TypeScript、ESLint、Prettier、Vite 前端构建、Electron 主进程构建和 preload 构建均成功。

构建只有原项目已有的 Browserslist 数据过期、chunk 较大和 Jimp 使用 `eval` 的警告，没有新增编译错误。

## 7. 历史阻塞：Electron 二进制缺失（已解决）

2026-09-06 已恢复 Electron 33.2.1 darwin-arm64，并通过版本检查和冷启动。本机使用 `npm run dev -- --host 127.0.0.1` 启动现有依赖。以下保留首次交接时的失败记录；最新环境与剩余阻塞以 [烟测结果](CODEX_REMOTE_SMOKE_TEST_RESULTS.md) 为准。

首次交接时，依赖目录包含 `electron@33.2.1` 的 JavaScript 包，但没有成功安装平台可执行文件。执行：

```bash
./node_modules/.bin/electron --version
```

会在 `node_modules/.pnpm/electron@33.2.1/node_modules/electron/index.js:17` 报错：

```text
Error: Electron failed to install correctly, please delete node_modules/electron and try installing again
```

此前两次恢复尝试分别失败于访问 GitHub 时的：

```text
getaddrinfo ENOTFOUND github.com
RequestError: socket hang up
```

这属于依赖下载/网络问题，不是本轮 TypeScript 源码构建错误。网络恢复后按以下顺序处理：

```bash
pnpm config get ignore-scripts
pnpm rebuild electron
./node_modules/.bin/electron --version
pnpm dev
```

预期第三条输出 Electron 33.2.1 版本，随后 `pnpm dev` 同时启动 Vite 和 Electron。若 `ignore-scripts` 为 `true`，先查明是项目配置还是用户级配置，再启用 Electron 安装脚本；不要删除或重置当前未提交改动。

## 8. GPT-6-Astra 烟测执行清单

本轮详细结果见 [烟测报告](CODEX_REMOTE_SMOKE_TEST_RESULTS.md)。以下真实窗口与系统输入验收项仍保留未勾选状态，避免与隔离测试或合成视频传输测试混淆。

### 8.1 启动前准备

- [x] 保留当前未提交改动，并记录 `git status --short`。
- [x] 恢复 Electron 二进制，确认 `./node_modules/.bin/electron --version` 成功。
- [ ] 确认 BilldDesk 使用的 WebSocket、API 和 coturn 端点可访问。
- [ ] 在被控机器启动 Codex Desktop。
- [ ] macOS 为当前开发版应用准备“屏幕录制”和“辅助功能”权限。
- [ ] 准备第二台设备或浏览器作为主控端。

### 8.2 窗口枚举与锁定

- [ ] 启动 `pnpm dev`，确认主窗口可打开且没有 renderer/main-process 异常。
- [ ] 未打开 Codex 时，界面应显示“未检测到”提示。
- [ ] 打开 Codex 后点击“刷新窗口”，列表应只包含标题带 Codex、ChatGPT 或 OpenAI 的窗口。
- [ ] 同时打开普通应用，确认其窗口和桌面不会出现在列表中。
- [ ] 多个允许窗口存在时，逐个选择并核对缩略图和标题。
- [ ] 远程连接建立后，刷新按钮和窗口选项应被禁用。

### 8.3 视频隐私边界

- [ ] 将 Codex 窗口缩小，让桌面和其他应用明显露在周围。
- [ ] 从主控端连接，确认视频只包含 Codex 窗口内容，不包含背后桌面、菜单栏、Dock/任务栏或其他窗口。
- [ ] 遮挡、移动、缩放、最小化和恢复 Codex，分别记录远端视频行为。
- [ ] 断开后确认捕获 track 停止；再次连接应重新捕获成功。

### 8.4 鼠标、滚轮和键盘

使用无破坏性的空白编辑区域测试，并观察本机鼠标实际落点：

- [ ] 点击视频左上、右上、左下、右下和中心，误差应在可接受范围内。
- [ ] 验证单击、双击和右键。
- [ ] 验证按下后移动再释放，确认拖拽连续且释放状态正确。
- [ ] 验证垂直滚轮；平台支持时再验证水平滚轮。
- [ ] 输入普通 ASCII、空格、回车、退格和方向键。
- [ ] 验证 Shift/Ctrl/Alt/Meta 修饰键及至少一个无破坏性组合键。
- [ ] 主控端视频尺寸变化或全屏后，重复四角和中心点击。

若界面显示“按所在显示器映射”，应将鼠标测试结果标为降级状态，重点确认是否发生窗口外点击。

### 8.5 聚焦与窗口边界刷新

- [ ] 连接后在被控机主动切换到其他应用，再从主控端点击；Codex 应重新置前并接收输入。
- [ ] 重复上述步骤测试键盘输入，确认字符没有进入原前台应用。
- [ ] 移动 Codex 窗口，等待至少 5 秒，再重复四角和中心点击。
- [ ] 调整 Codex 窗口大小，等待至少 5 秒，再重复坐标测试。
- [ ] macOS 重点观察 `boundsSource` 是否为 `window`；不是时检查辅助功能权限。
- [ ] Windows 分别在 100%、125%、150% 缩放下测试，并覆盖副显示器及负坐标布局。
- [ ] Linux 优先在 X11 且安装 `wmctrl` 的环境测试；Wayland 结果单独记录。

### 8.6 失效保护

- [ ] 连接中关闭目标 Codex 窗口，等待一次 5 秒刷新周期。
- [ ] 继续从主控端移动、点击和输入，确认事件被拒绝，没有落到其他应用。
- [ ] 重新打开 Codex 并刷新，重新连接后应恢复。
- [ ] 连接建立和捕获初始化的瞬间主动断开，确认没有残留采集指示或活跃 track。
- [ ] 网络中断后重连，确认没有复用旧窗口源 ID。

### 8.7 权限场景（macOS 最低要求）

- [ ] 拒绝屏幕录制权限，确认捕获失败且界面给出可理解的错误。
- [ ] 允许屏幕录制并按系统要求重启应用，确认窗口视频恢复。
- [ ] 拒绝辅助功能权限，确认边界/聚焦失败时有提示，且应用不会崩溃。
- [ ] 允许辅助功能并重启，确认 `窗口边界已读取`、聚焦和输入都恢复。

## 9. 最低验收标准

第一版可以进入后续开发的最低条件：

- [ ] 远端视频在正常和移动/缩放场景下始终不泄露目标窗口之外的桌面内容。
- [ ] `boundsSource === 'window'` 时，四角和中心的鼠标映射准确。
- [ ] 点击、双击、右键、拖拽、滚轮和常用键盘输入可用。
- [ ] 切换前台应用后，远程输入能重新聚焦 Codex。
- [ ] 目标窗口消失后，输入停止且不落到其他窗口。
- [ ] 断开和重连不会遗留旧 MediaStream 或旧 `sourceId`。
- [ ] 权限拒绝会以可诊断方式失败，不会静默捕获整屏或继续盲目注入输入。

## 10. 烟测结果记录模板

```text
平台/版本：
Electron 版本：
Codex Desktop 版本：
显示器布局和缩放：
boundsSource：window / display / unknown
信令/API/coturn 环境：

窗口枚举：PASS / FAIL
单窗口视频隐私：PASS / FAIL
鼠标坐标：PASS / FAIL
点击/双击/右键：PASS / FAIL
拖拽/释放：PASS / FAIL
滚轮：PASS / FAIL
键盘/组合键：PASS / FAIL
失焦后重聚焦：PASS / FAIL
移动/缩放后映射：PASS / FAIL
目标关闭后的输入阻断：PASS / FAIL
断开/重连和 track 清理：PASS / FAIL
权限拒绝/恢复：PASS / FAIL

控制台错误：
复现步骤：
截图/录屏：
结论与下一步：
```

## 11. 后续可能需要的加固

这些不是当前烟测前置条件，但不应被误认为已经完成：

- 使用 macOS bundle ID、Windows PID/可执行路径、Linux WM_CLASS 等信息替代纯标题识别。
- 在不能读取精确窗口边界时禁用鼠标输入，而不是按显示器降级映射。
- 为窗口关闭、最小化、源 ID 变化和权限变化增加更明确的状态机和 UI。
- 增加主进程坐标转换、源失效和输入阻断的自动化测试。
- 审计 BilldDesk 原有鉴权、日志脱敏、TLS、信令服务和 coturn 的生产配置。
