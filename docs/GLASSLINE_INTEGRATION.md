# PalmDesk 会话阅读

Codex 首版实现于 2026-09-15，2026-09-16 扩展 Claude Code。读取能力迁入 PalmDesk 仓库，Glassline 独立项目未作修改。

## 产品与代码归属

PalmDesk 承接会话阅读与远程窗口操作的整合体验。`session-core/` 是仓库内独立模块，来自 Glassline 的固定提交 `63f7d3dd67f723f6f20fe3c91b8e04a725e3bfce`，包含 Codex 与 Claude Code 解析器、会话目录缓存、数据模型、Markdown 渲染器及相关测试。保留 Apache-2.0 LICENSE 和 NOTICE；后续修复直接在 PalmDesk 维护。

不需要额外的 Glassline HTTP 服务、部署地址或第三个仓库。模块边界保留，后续确有其他消费者时再考虑发布共享包。

## 已实现的流程

1. 电脑首页开启「会话阅读」。默认关闭，仅在 macOS 可启用，范围是当前用户的 Codex 与 Claude Code 本地会话目录（分别遵循 `CODEX_HOME` 与 `CLAUDE_CONFIG_DIR`）。两种来源按更新时间合并展示，列表、详情和助手署名标明来源。
2. 扫码认证后进入阅读视图，无须先授权或启动窗口捕获。没有开启读取时默认进入窗口选择。
3. 选择会话，阅读 Markdown、复制回复、向前加载历史；工具活动及长输出默认折叠。
4. 页面可见时每 8 秒检查所选会话，出现新内容后显示提示；点击查看更新才重新定位到最近消息。
5. 切换到窗口，选择原应用后可关联到正在阅读的会话。已有窗口也可手动关联。发送 prompt 前由用户确认 GUI 当前任务。
6. 切回阅读保留位置、会话和连接；窗口输入草稿也保留。阅读时窗口控制被阻止，并释放按住的键和鼠标按钮。

关联只在当前连接内有效，是导航提示。窗口 ID 不代表 GUI 当前会话，首版没有自动切换 GUI 内任务，也没有从阅读页直接向声称的某个会话发送 prompt。

## 实现入口

| 模块 | 职责 |
| --- | --- |
| `session-core/index.mjs` | 本地会话列表与分页读取、对外数据投影、长内容限制 |
| `session-core/src/` | Codex、Claude Code 解析器和缓存，以及共享的有界文件读取；Codex 摘要读取头尾各最多 64 KiB，Claude 摘要以流读取并保留紧凑父链记录，最多 32 MiB |
| `session-core/public/timeline-renderers.js` | 浏览器端 Markdown 渲染，转义原始 HTML 并限制链接协议 |
| `electron-main/session-reader.ts` | 默认关闭的读取设置、平台检查、设置持久化、撤销正在处理的请求 |
| `src/utils/session-reader-channel.ts` | 独立可靠通道上的请求、分片、背压、超时、撤销和断开处理 |
| `src/components/SessionReader/` | 手机会话列表与阅读组件 |
| `src/components/SessionReaderSettings/` | 本机读取开关 |
| `src/views/remote/index.vue` | 认证连接到本机读取 IPC 的桥接 |
| `src/views/webrtc/index.vue` | 阅读／窗口切换与临时关联 |

远端只提交会话 ID 和历史游标，源文件路径由本机目录映射解析，不提供任意文件、raw 数据或执行接口。主进程仅接受主窗口 IPC；网络桥接在每次请求和分片发送时核对当前认证连接。关闭开关会令进行中的读取失效，并通知手机清除内容。

读取通道与原有输入通道分离。回复以最多 8,000 UTF-16 单元分片，每片 JSON 小于 64 KiB；发送队列有背压检查和时限，客户端重组上限 8 MiB。客户端可同时等待最多三项请求，主机有界串行处理。

## Claude Code 读取范围

按照 [Claude Code 会话文档](https://code.claude.com/docs/en/sessions)，读取 `CLAUDE_CONFIG_DIR` 或 `~/.claude` 下的 `projects/*/*.jsonl`。自定义目录须出现在启动 PalmDesk 的环境中。只发现项目根会话文件，不递归读取嵌套子 Agent 日志，也不读取 Claude 网页聊天。

会话 ID 使用 `claude-code:session-file:<uuid>`，与 Codex 的相同 UUID 分开路由。标题优先使用 `custom-title`（用户重命名），其次为 `agent-name`、`ai-title` 和首条有效用户消息。存在有效 `last-prompt.leafUuid` 时沿当前父链读取，并接上标记之后的回复；缺失或损坏时退回有效文件顺序。Sidechain、thinking、图片和内部命令包装不展示。Bash 映射为命令，其他工具显示名称、输入和按 `tool_use_id` 匹配的结果。

为保留父链，Claude 摘要会流式扫描变化的文件，超过 32 MiB 时保留为不可读的会话项；打开后明确提示前往原窗口。摘要按文件指纹缓存。损坏行不会使其余记录消失，尚未写完的尾行可在后续刷新恢复。两个适配器均关闭进程扫描，不调用 Agent CLI。

## 本版限制

- 提供 macOS 上的 Codex 与 Claude Code 读取；其他平台和 Agent 继续使用原窗口功能。
- 搜索覆盖已发现的全部会话，每次显示最近 100 条匹配项。
- 历史每页 40 项，单项正文或输出各保留前 16,384 字符，截断有明确提示。
- 日志并非稳定 API，可能缺失记录；本轮状态可以是未知。首次建立目录需扫描文件，详情仍会解析相应日志文件，超过 32 MiB 时拒绝读取并提示前往原窗口，读取过程中也检查大小上限。
- 附件预览、自动识别 GUI 当前任务、跨断线保留阅读会话和选择另一窗口时保留连接尚未实现。
- 切换视图会保留已启动的视频流，本版尚未按阅读状态自动暂停捕获或降低帧率。
- 未接入 Glassline 的 CLI follow-up：本版 prompt 继续通过原 GUI 输入。

## 验证

```sh
pnpm test:session-core
pnpm test:smoke
pnpm typecheck
pnpm build:prod
pnpm exec vite build --mode production
```

测试覆盖合成 JSONL 的分页、追加与未完整写入的尾行、跨轮次重复 prompt、超长输出、32 MiB 文件上限（含读取中增长）、Markdown 截断标记与搜索，以及默认关闭、启用持久化、撤销、分片完整性、背压、请求排队和断开。Claude 扩展另外覆盖混合来源排序、同 UUID 路由、重命名、父链、子 Agent 排除、工具结果配对、缓存失效、损坏日志恢复和主进程读取开关。

浏览器联调页仅使用临时目录内的合成记录，通过两个真实 WebRTC peer 连接阅读组件与读取模块，同时提供合成窗口视频。它不会读取本机真实会话或发送真实 GUI 输入：

```sh
pnpm exec vite --config test/smoke/session-reader.vite.mjs
```

打开 `http://127.0.0.1:5194/test/smoke/session-reader.html`。列表同时包含 Codex 和 Claude Code；可为当前选中的会话添加合成回复、切换读取开关、重连，并检查阅读位置、输出折叠和窗口输入。此页面用于验证新增功能，不替代真实手机、原生窗口输入或跨网络 TURN 验收。
