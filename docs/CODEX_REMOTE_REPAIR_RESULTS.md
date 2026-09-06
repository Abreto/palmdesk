# Codex Remote 修复与验证结果

日期：2026-09-07，Asia/Shanghai。工作区：`/Users/abreto/workspace/codex-remote`。基线为 `dcfe26a`，保留此前未提交修改；本轮没有提交或重置 Git。

## 结论

已将现有代码修复为面向手机的 Codex/ChatGPT 单窗口远控原型，沿用 BilldDesk 的设备密码、信令、WebRTC 视频和 DataChannel。未使用 app-server。

40 项输入与生命周期测试、14 项浏览器业务检查、官方后端鉴权/信令、开发版和打包版 Electron 冷启动及真实 IPC 校验均通过。macOS 本地应用目录已构建。**真实 Codex 窗口的画面与系统输入尚未通过原生验收，不能将本次结果视为已可正式发布。**

## 修复内容

| 问题                                                             | 当前行为                                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 只凭窗口标题识别目标，任务名窗口可能漏掉或被其他应用同名窗口混入 | 使用 macOS bundle ID `com.openai.codex` / `com.openai.chat`、PID 和 CGWindow ID，与 Electron 捕获源交叉匹配 |
| 边界失败时按整块显示器映射输入                                   | 仅接受精确窗口边界，异常时关闭输入，无显示器回退                                                            |
| 800 ms 聚焦缓存与并发输入可能使用过期目标                        | 原生输入串行执行，每次聚焦并验证目标身份，使用最新窗口坐标                                                  |
| 断开后异步捕获或输入仍可能返回                                   | 使用独立会话 token 与 generation；旧刷新/输入响应不能关闭新会话；释放按住的键和鼠标按钮                     |
| 渲染器关闭或崩溃残留输入状态                                     | 主窗口关闭、主框架导航、渲染进程退出和应用退出时结束捕获会话                                                |
| 共享 Electron 身份导致授权落在其他应用上                         | 开发版 `com.codexremote.desktop.dev`，打包版 `com.codexremote.desktop`；开发副本经过本地 ad-hoc 签名        |
| 主机初次加入信令时没有设备身份，必须等心跳才上线                 | 初始化设备后立即把设备代码和密码传入信令 join                                                               |
| 手机只有桌面式控制页                                             | 连接表单、横竖屏工具栏、点按/双击/长按右键、拖拽、滚动、缩放和平移、只读、中文文字发送、常用按键            |
| 快速点击与 pointer capture 丢失导致输入丢失                      | 保留延迟单击；相邻双击合并；不同位置的快速两次点击都发送                                                    |
| 默认连接上游公共 API/TURN                                        | 默认同域浏览器服务，本机打包端默认 `4300`；API、信令、TURN 凭据可配置                                       |
| 设置保存后网络实例继续使用旧地址                                 | 地址校验通过后保存并重载；手机设置和设备历史入口可用                                                        |
| ICE 早到、DataChannel 丢包和连接清理不完整                       | 排队早到 ICE，使用有序可靠通道；关闭双向通道、tracks 和统计定时器                                           |
| 主进程开发热重启与单实例锁存在竞争                               | Vite 等旧 Electron 进程退出后再启动新进程                                                                   |

具体配置和启动说明见 [README](../README.md)、[本地开发](LOCAL_DEVELOPMENT.md) 和 [服务配置](SERVICE_CONFIGURATION.md)。

## 验证记录

| 检查                     | 结果与证据                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 主进程和输入测试         | 40/40，含 29 项窗口身份/会话/输入测试与 11 项触摸/流生命周期测试；[TAP](smoke-artifacts/repair-unit-tests.tap)              |
| 官方设备 API / Socket.IO | PASS；设备注册、正确/错误密码、接收方查询、远控鉴权、offer/answer/ICE 转发                                                  |
| 浏览器完整业务链路       | 14 项 PASS；[结构化结果](smoke-artifacts/business-flow.json)                                                                |
| 视频解码                 | 实际业务 WebRTC 收到 960 × 600 视频，并通过 canvas 像素采样检查；媒体源为合成 canvas                                        |
| 中文与按键               | 中文多行文字、Enter、触摸点击/拖拽/释放/滚动、长按右键到达真实业务 IPC 调用点；系统驱动为测试替身                           |
| 手机本地平移与只读       | 放大后的滑动改变本地 viewport，不发送主机输入；只读模式阻断输入并释放按住状态                                               |
| 清理与重连               | 断开停止原 tracks，重连产生新 track ID；源消失关闭业务连接；设备历史可回到连接表单                                          |
| 手机设置                 | 错误 URL 被拒绝，保存后页面重新加载且使用保存值                                                                             |
| 响应式布局               | 390 × 844、844 × 390、1440 × 900 均无页面横向/纵向溢出，截图已检查                                                          |
| 开发版 Electron          | 冷启动、后端连接、权限读取、无效会话输入拒绝、第二渲染器 IPC 拒绝；[结果](smoke-artifacts/desktop-shell.json)               |
| 打包版 Electron          | 从应用目录直接启动，使用构建后的 `file:` 页面；同样通过冷启动、后端和 IPC 检查；[结果](smoke-artifacts/packaged-shell.json) |
| Swift / 应用标识         | helper 编译成功，打包后为 arm64 Mach-O；两个应用的 bundle ID 已读取确认；开发副本 `codesign --verify --deep --strict` 通过  |
| 静态检查                 | Vue TypeScript、修改范围 ESLint/Prettier、Electron 输出语法检查和 `git diff --check` 通过                                   |
| 构建                     | Vite 前端、Electron 主进程/preload、纯 Web 生产构建及 macOS arm64 应用目录构建通过                                          |

截图：[手机连接](smoke-artifacts/mobile-connect.png)、[手机控制](smoke-artifacts/mobile-controller.png)、[横屏](smoke-artifacts/mobile-landscape.png)、[桌面控制](smoke-artifacts/desktop-controller.png)、[手机设置](smoke-artifacts/mobile-settings.png)、[Electron 主窗口](smoke-artifacts/desktop-shell.png)。控制画面的 fixture 标记说明其为合成视频，不能当作 Codex 实拍。Electron 截图已隐藏连接密码。

主进程热重启也已验证：文件变更后旧进程退出，新进程完成主窗口初始化，网页与后端继续正常响应；[重启证据](smoke-artifacts/development-restart.json)。

测试环境为 macOS 26.6.2 / Apple Silicon、Electron 33.2.1、Node.js 22.16.0、本机 Chrome 和官方 BilldDesk 后端快照 `c73983e543341c08ce9e4fb7c52446be50b6c6a2`。

构建仍有上游依赖的 Browserslist 数据陈旧、Jimp `eval` 和较大 chunk 提示。应用目录构建关闭了个人签名自动发现，未进行分发签名、公证、DMG 发布或公网部署。

## 原生与实机验收

本机只读原生诊断发现 Codex 正在运行，但它的正常窗口不在当前屏幕的可捕获列表中。界面已区分“应用未运行”和“窗口不在当前桌面或已最小化”，并提供用户主动显示应用窗口的按钮。

开发版和打包版读取的屏幕录制状态均为 `granted`，辅助功能状态均为 `false`。此前共享 Electron 身份的临时授权已经撤销，本轮没有留下新增的辅助功能权限。自动化工具此前明确拒绝操作 `com.openai.codex`，本轮未绕过限制执行聚焦、系统输入或目标窗口画面测试。

以下项目仍需在允许操作真实目标窗口的环境中完成：

1. 显示实际 Codex 窗口，给当前独立身份应用授权辅助功能，选择目标并从手机连接。
2. 验证捕获画面不包含其他窗口、桌面、Dock 和菜单栏，检查遮挡、移动、缩放及多显示器。
3. 验证真实点击、双击、右键、滚动、拖拽、中文输入、组合键，以及焦点切换时的行为。
4. 验证关闭/最小化目标、断网、应用退出、权限撤销与重新授权时的输入释放和恢复。
5. 用真实 iOS Safari / Android 手机验证触摸、软键盘、旋转、全屏及后台恢复。
6. 部署 coturn 后验证跨 NAT 和强制 relay。Windows/Linux 主机目前明确不支持，不能沿用旧报告的跨平台承诺。

系统鼠标键盘注入依赖前台焦点，无法等同于应用内部输入 API。当前实现收紧了窗口身份、坐标与会话边界，但本机并发操作和系统快捷键的实际影响仍属于原生验收范围。

## 复跑和产物

```bash
npm run test:smoke
node --test test/smoke/signaling.test.mjs
./node_modules/.bin/vue-tsc --noEmit
./node_modules/.bin/vite build
node --check electron-dist/index.cjs
node --check electron-dist/preload.mjs
npm run build:prod
```

浏览器与桌面外壳测试的 Playwright 环境设置见 [本地开发](LOCAL_DEVELOPMENT.md)。本次本地打包命令：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder \
  --mac --dir --config.electronDist=node_modules/electron/dist
```

生成的本地应用为 `electron-release/0.0.1/mac-arm64/Codex Remote.app`，该目录被 Git 忽略。macOS 辅助程序位于应用 `Contents/Resources/native-bin/codex-window`。

网页开发服务保留在 `http://localhost:5173/`，桌面开发服务在 `http://localhost:5175/`，后端在 `http://127.0.0.1:4300/`。手机实机请按服务配置文档使用可达地址，不能使用手机自己的 localhost。原有 `5174` 服务未操作。
