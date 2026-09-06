# Codex Remote 本地烟测结果

> 历史报告：本文对应 2026-09-06 的首次烟测，最新实现和验证范围见 [2026-09-07 修复报告](CODEX_REMOTE_REPAIR_RESULTS.md)。本文保留当时的失败记录和授权撤销经过。

测试日期：2026-09-06（Asia/Shanghai）  
工作区：`/Users/abreto/workspace/codex-remote`  
基线：`main` / `dcfe26a`，保留了测试前的全部未提交改动。

## 结论

**部分通过，交接文档第 9 节的最低原生验收标准尚未满足。**

Electron 已恢复并能启动。自行部署的官方 BilldDesk 本地后端通过设备注册、密码校验和信令测试；浏览器中的两个 WebRTC peer 完成了两轮合成视频传输、DataChannel 往返和连接清理。主进程的 15 项隔离测试全部通过，烟测发现的构建和输入失效保护问题已修复。

真实 `desktopCapturer` 枚举返回 7 个窗口，但允许列表中没有 Codex、ChatGPT 或 OpenAI 目标。实际 Codex 窗口为何未进入列表尚未定位。辅助功能授权还遇到了开发版 Electron 与其他应用共用 bundle ID 的问题。因此，真实 Codex 窗口的视频隐私、系统鼠标键盘、聚焦、移动缩放及权限恢复测试未完成，不能标为 PASS。

## 环境

| 项目                  | 本次环境                                                                     |
| --------------------- | ---------------------------------------------------------------------------- |
| 操作系统              | macOS 26.6.2，build 25G83，Apple Silicon                                     |
| Electron              | 33.2.1，darwin-arm64；内置 Node.js 20.18.1                                   |
| Codex Desktop         | 26.901.51231，`/Applications/ChatGPT.app`，bundle ID `com.openai.codex`      |
| 显示器                | 3440 × 1440，scaleFactor 1；工作区 `(0, 30, 3440, 1326)`                     |
| 原生目标 boundsSource | 无可用目标，未测得                                                           |
| 屏幕录制权限          | Electron 探针返回 `granted`                                                  |
| 辅助功能权限          | Electron 探针返回 `false`；临时尝试的授权已关闭                              |
| 客户端                | [http://localhost:5173/](http://localhost:5173/)                             |
| API / Socket.IO       | [http://127.0.0.1:4300/](http://127.0.0.1:4300/)                             |
| 浏览器传输测试        | [http://localhost:5193/transport.html](http://localhost:5193/transport.html) |
| coturn / 跨 NAT       | 未部署、未验证；本次 WebRTC 使用同机直连                                     |
| Windows / Linux       | 未验证                                                                       |

## 已修复问题

### Electron 开发构建输出损坏

`vite-plugin-electron` 合并默认 library 构建配置后，ESM 与 CommonJS 输出写入同一个 `electron-dist/index.cjs`，导致开发启动报语法错误。`vite.config.ts` 改为 `lib: false`，通过 Rollup 明确指定入口、CommonJS 格式和文件名。

修复后生产构建和冷启动开发构建均成功，`node --check electron-dist/index.cjs` 通过。修改 Vite 配置期间出现过旧 watcher 残留，最终停止旧进程后进行了冷启动验证。

### 输入目标失效保护

`electron-main/index.ts` 修复了以下行为：

- `mouseSetPosition`、`mouseMove` 在注入前检查激活源并等待聚焦；无目标或聚焦失败时拒绝输入。
- 刷新时只按原 source ID 保留激活目标；同名的新窗口不能替换正在捕获的窗口。
- 枚举或捕获请求异常时清空激活目标，阻断后续输入。
- 输入等待聚焦期间，如果目标被清空或替换，该次输入也会被拒绝。

新增测试先复现了相关失败，再验证了修复。以上结论来自执行真实主进程代码、替换原生 API 的隔离测试，不等同于真实系统输入验收。

## 测试结果

| 检查                                         | 结果                     | 证据与范围                                                                                                        |
| -------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Electron 二进制和开发窗口启动                | PASS                     | 33.2.1 可执行；Vite、主进程和 preload 冷启动成功                                                                  |
| 主进程隔离测试                               | PASS，15/15              | 窗口筛选、四角/中心/越界坐标、移动后边界刷新、无目标输入阻断、同名替换阻断、捕获异常及聚焦竞态；原生 API 使用替身 |
| 设备 API 和鉴权                              | PASS                     | 两个独立设备；正确密码成功，错误密码被拒绝；设备接收方查询成功                                                    |
| Socket.IO 信令                               | PASS                     | 双客户端加入、远控密码拒绝/接受、offer/answer/ICE 转发；后端重启后再次通过                                        |
| 浏览器 WebRTC 视频                           | PASS，2 轮               | 同一浏览器页面内的两个真实 peer；合成 canvas 视频解码为 320 × 180，采样像素 `21,169,153,255`                      |
| DataChannel                                  | PASS，2 轮               | 输入格式消息往返一致；未接入业务页面或系统输入                                                                    |
| 传输测试清理和重连                           | PASS                     | 测试自己的源 track 停止、peer 关闭；第二轮使用不同的 track ID 和 socket ID                                        |
| 原生窗口枚举 / 目标识别                      | 枚举成功，目标识别未通过 | 返回 7 个原生窗口，允许目标 0 个；无法进入实际目标选择和捕获流程                                                  |
| 单窗口视频隐私                               | BLOCKED                  | 未捕获真实 Codex；遮挡、最小化、恢复和背景泄露均未验证                                                            |
| 鼠标坐标、点击、双击、右键、拖拽、释放、滚轮 | BLOCKED                  | 无可用目标；本项目 Electron 未获得可独立识别的辅助功能授权                                                        |
| 键盘、组合键、失焦后重新聚焦                 | BLOCKED                  | 未进行真实系统输入                                                                                                |
| 移动、缩放后的真实边界映射                   | BLOCKED                  | 仅隔离测试验证了坐标换算及刷新                                                                                    |
| 目标关闭后的真实输入阻断                     | BLOCKED                  | 仅隔离测试验证了源 ID 消失及失效竞态                                                                              |
| 业务组件断开、捕获初始化中断、重连清理       | BLOCKED                  | 合成视频测试未执行 Vue 业务组件的 MediaStream 生命周期                                                            |
| macOS 权限拒绝 / 恢复                        | BLOCKED                  | 已读取权限状态，未完成拒绝、重新授权、重启后的完整工作流                                                          |
| TypeScript / ESLint / Prettier / 生产构建    | PASS                     | 命令见下文；无新增编译错误                                                                                        |

主进程测试输出：[main-process.tap](smoke-artifacts/main-process.tap)。  
浏览器传输截图：[webrtc-transport.png](smoke-artifacts/webrtc-transport.png)。

截图中的画面来自测试生成的 canvas，**不是 Codex 窗口**。传输测试使用项目的 Socket.IO 依赖及真实后端，但自行创建 RTCPeerConnection，不覆盖现有 Vue 主控端和被控端的完整远控链路。

## 本地后端和运行状态

后端采用仓库配置引用的官方 [billd-desk-server](https://github.com/galaxy-s10/billd-desk-server/tree/c73983e543341c08ce9e4fb7c52446be50b6c6a2)，固定提交 `c73983e543341c08ce9e4fb7c52446be50b6c6a2`，检出在 `/private/tmp/codex-remote-billd-desk-server`。

| 服务            | 本地地址 / 状态                                                                 |
| --------------- | ------------------------------------------------------------------------------- |
| MySQL 8.0       | 容器 `codex-remote-smoke-mysql`，`127.0.0.1:14306`，数据库 `codex_remote_smoke` |
| Redis 7 Alpine  | 容器 `codex-remote-smoke-redis`，`127.0.0.1:14379`                              |
| API / Socket.IO | 监听 `127.0.0.1:4300`                                                           |
| 最终连通性检查  | 客户端、API 根路径、传输测试页面均返回 HTTP 200；两个容器运行中                 |

后端临时目录中的 `src/secret/secret.ts` 使用本次测试的 MySQL/Redis 配置，其他默认项从 `secretTemp` 导出。数据库表和初始 live 配置使用官方初始化代码建立。`src/setup.ts` 只监听回环地址，并在 `CODEX_REMOTE_SMOKE=true` 时跳过定时任务与 FFmpeg。此临时后端不属于本仓库的提交内容；重启依赖该目录和现有容器仍然存在。

服务已在后台保留，便于继续烟测。日志位置：

- `/private/tmp/codex-remote-smoke-backend.log`
- `/private/tmp/codex-remote-smoke-client.log`
- `/private/tmp/codex-remote-smoke-transport.log`

本次启动时 backend / Vite / 传输测试服务器 PID 分别为 `13639`、`13640`、`13641`，Electron 子进程为 `13658`。需要停服时先用 `ps -p 13639,13640,13641,13658 -o pid=,command=` 核对进程仍属于本次烟测，再停止对应进程；数据库容器可用 `docker stop codex-remote-smoke-mysql codex-remote-smoke-redis` 停止。端口 `5174` 属于其他已有服务。

## 权限处理和原生阻塞

用户允许仅为本次烟测开启本项目 Electron 的辅助功能权限。实际添加开发版 Electron 后，系统设置显示并开启了“微信开发者工具”条目：两者共用 `com.github.Electron` bundle ID。该条目随后立即关闭，并在收尾时再次确认是 `off`；条目仍可留在列表中。本次没有留下新增的有效辅助功能授权。

后续原生输入测试需要给烟测应用使用独立的应用身份，再按本次临时授权范围测试并撤销权限。不要将共享 Electron 身份下显示的其他应用视为已获授权的本项目。

另外，当前 UI 自动化工具明确拒绝操作 `com.openai.codex`。本轮未绕过该工具限制，也未对 Codex 窗口注入系统输入。完成交接清单需要可枚举的实际目标窗口、能独立授权的测试应用，以及可执行原生验收的人工或自动化环境。

## 复跑命令

在项目根目录运行隔离测试和信令测试，后者要求本地后端正在运行：

```bash
node --test test/smoke/main-process.test.cjs
node --test test/smoke/signaling.test.mjs
```

客户端或传输测试服务器停止后，分别在独立终端重启；已运行时无需重复启动：

```bash
npm run dev -- --host 127.0.0.1
```

```bash
./node_modules/.bin/vite --config test/smoke/vite.config.mjs
```

打开 `http://localhost:5193/transport.html`，点击 `Run Smoke Test`。浏览器中的客户端和传输测试都使用 `localhost` 页面地址；该后端快照的浏览器 CORS 规则会拒绝 `127.0.0.1` origin。客户端 `http://localhost:5173/` 已验证返回 HTTP 200，后端也返回匹配此 origin 的 CORS 响应头。

重启已配置且已初始化的临时后端：

```bash
docker start codex-remote-smoke-mysql codex-remote-smoke-redis
cd /private/tmp/codex-remote-billd-desk-server
CODEX_REMOTE_SMOKE=true npm run dev
```

本次已通过的源码检查命令：

```bash
./node_modules/.bin/vue-tsc --noEmit
./node_modules/.bin/eslint electron-main/index.ts src/event.ts \
  src/pure-interface.ts src/hooks/use-ipcRendererSend.ts \
  src/views/remote/index.vue src/views/webrtc/index.vue vite.config.ts \
  --config ./eslint.config.js
./node_modules/.bin/prettier --check electron-main/index.ts src/event.ts \
  src/pure-interface.ts src/hooks/use-ipcRendererSend.ts \
  src/views/remote/index.vue src/views/webrtc/index.vue vite.config.ts \
  README.md electron-builder.json5 'test/smoke/*'
./node_modules/.bin/vite build
node --check electron-dist/index.cjs
node --check electron-dist/preload.mjs
git diff --check
```

恢复的 Electron 安装包为 33.2.1 darwin-arm64，经 npmmirror 下载，并校验 SHA256 为 `15615ce68c1a31b0db186af8607c00a30e3f64e63642aab735b4997d0fab7631`。`electron --version` 已成功。本机所用 pnpm 会触发忽略构建脚本的安装问题，本次使用 npm 启动现有依赖，不修改包管理器的全局策略。

## 其他观察

- 业务页面的 `/desk_version/latest` 请求在本次官方后端快照返回 404；设备注册、鉴权和信令测试仍通过。
- Electron DevTools 打印 `language-mismatch` 和不支持的 `Autofill.enable` / `Autofill.setAddresses` 日志。
- Vite 保留原有 base 路径、Browserslist 数据过期、chunk 较大、Jimp `eval` 警告。
- 初始未提交修改均已保留。本轮产品代码额外修改集中在 `electron-main/index.ts` 和 `vite.config.ts`，另新增 `test/smoke/`、测试证据和本文；未提交 Git commit。

后续优先解决目标窗口识别和测试应用身份，再执行交接文档第 8.2 至 8.7 节。跨平台、coturn 和跨 NAT 验证另需对应环境。
