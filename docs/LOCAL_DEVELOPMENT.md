# 本地开发与测试后端

本次已自行启动官方 [billd-desk-server](https://github.com/galaxy-s10/billd-desk-server/tree/c73983e543341c08ce9e4fb7c52446be50b6c6a2)，固定提交 `c73983e543341c08ce9e4fb7c52446be50b6c6a2`，检出目录为 `/private/tmp/codex-remote-billd-desk-server`。这是本地测试实例，与线上环境无关。

| 服务            | 本机地址                                           |
| --------------- | -------------------------------------------------- |
| 前端            | `http://localhost:5173/`                           |
| API / Socket.IO | `http://127.0.0.1:4300/`                           |
| MySQL 8.0       | `127.0.0.1:14306`，容器 `codex-remote-smoke-mysql` |
| Redis 7         | `127.0.0.1:14379`，容器 `codex-remote-smoke-redis` |

数据库为 `codex_remote_smoke`，只保存烟测设备和官方初始化数据。后端临时目录中的 `src/secret/secret.ts` 已配置这两个本地容器；没有修改本仓库的线上密钥。`src/setup.ts` 固定监听 `127.0.0.1`，在 `CODEX_REMOTE_SMOKE=true` 时跳过定时任务与 FFmpeg 初始化。

## 重启现有测试实例

以下命令依赖上述临时检出目录和已初始化的容器仍然存在。先检查端口，服务在运行时不需要重复启动。

```bash
docker start codex-remote-smoke-mysql codex-remote-smoke-redis
```

在独立终端运行后端：

```bash
cd /private/tmp/codex-remote-billd-desk-server
CODEX_REMOTE_SMOKE=true \
NODE_ENV=development \
NODE_APP_RELEASE_PROJECT_NAME=billd-desk-server \
NODE_APP_RELEASE_PROJECT_ENV=development \
NODE_APP_RELEASE_PROJECT_PORT=4300 \
node -r @swc-node/register ./src/index.ts
```

在本仓库运行客户端：

```bash
npm run dev:desktop
```

只需手机网页时使用 `npm run dev:web`。两条命令可分别使用不同端口，共用同一个后端。`5174` 在本次机器上属于其他任务，不应停止它。

后端临时目录如果已经被系统清理，需要按官方服务端文档重新安装依赖、设置 MySQL/Redis 并初始化表和 live 配置，单独启动前端不会重建数据库。

## 浏览器测试依赖

单元测试使用现有 TypeScript 依赖；浏览器烟测使用 Playwright 和本机 Chrome。可将测试依赖装在被 Git 忽略的目录中：

```bash
npm install --prefix .local/smoke --no-package-lock --no-save playwright
NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/business-flow.mjs
```

默认 Chrome 路径为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，可用 `SMOKE_BROWSER_EXECUTABLE` 覆盖。`SMOKE_CLIENT_URL` 和 `SMOKE_BACKEND_URL` 分别覆盖前端和信令测试后端。

本次环境已提供 Playwright，可直接复用：

```bash
NODE_PATH=/Users/abreto/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
node test/smoke/business-flow.mjs
```

Electron 外壳测试还要求 `electron-dist/` 已构建、独立开发 Electron 已由 `npm run dev:desktop` 生成，并且没有另一个 Codex Remote 实例占用单实例锁：

```bash
NODE_PATH=/Users/abreto/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
node test/smoke/desktop-shell.mjs
```

外壳测试只读取本项目权限与 IPC 状态，不选择、聚焦或输入真实 Codex 窗口，也不修改系统权限。

## 日志与停止

本次后台日志在 `/private/tmp/codex-remote-smoke-backend.log`、`/private/tmp/codex-remote-web.log`、`/private/tmp/codex-remote-dev.log`。停止服务前先核对占用端口的进程命令，避免使用旧文档中的 PID。

```bash
lsof -nP -iTCP:4300 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
docker stop codex-remote-smoke-mysql codex-remote-smoke-redis
```

日志、临时后端和容器属于本机测试环境，不是分发产物。测试凭据不应复用于正式服务。
