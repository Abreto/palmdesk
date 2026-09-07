# TURN 验证

## 自动化检查

```bash
node --test containers/test/*.test.mjs
pnpm test:smoke
pnpm typecheck
pnpm build:prod
```

后端测试使用内存 Redis 和模拟 Cloudflare 响应，覆盖请求协议、域名/端口转换、凭据隔离、固定过期时间、上游错误、授权校验及限流。前端测试覆盖请求合并、过期回退、取消请求、凭据更新及 ICE restart 协商和清理。

## 浏览器业务回归

准备已安装依赖的 `containers/backend.lock.json` 对应后端源码，并在项目的测试环境中安装 Playwright（或通过 `NODE_PATH` 使用已有安装）。分别启动：

```bash
SMOKE_BACKEND_SOURCE=/absolute/path/to/backend node containers/test/smoke-backend.mjs
```

```bash
pnpm dev:web --port 5194 --strictPort
```

然后运行：

```bash
SMOKE_CLIENT_URL=http://127.0.0.1:5194 \
SMOKE_ARTIFACT_DIR=.local/turn-smoke \
SMOKE_TURN=true node test/smoke/business-flow.mjs
```

测试后端仅监听 `127.0.0.1:4300`，设备和数据库状态均为内存数据，不读取生产配置。它使用本分支的真实会话/凭据服务，签发针对回环地址的 coturn 测试凭据。测试用浏览器直连传输，不要求本机部署 TURN。`/__smoke/expire-ice` 仅存在于这个测试进程，用于验证续期；不会加入生产容器。

浏览器回归运行实际 Vue 页面、Socket.IO、WebRTCClass 和 DataChannel，只模拟原生窗口与系统输入。`SMOKE_TURN=true` 增加未授权请求检查、主动失效缓存、领取新凭据、ICE restart，以及重新协商后的视频和输入检查。它必须与上述内存测试后端一起使用。

## 实际中继验收

### 本地 Cloudflare 烟测

在 `containers/backend/turn.env` 中配置配套的 TURN Key ID 和专用 API Token。此文件应由 Git 忽略。凭据只由测试后端读取；网页进程不加载该文件。使用空闲端口启动：

```bash
SMOKE_BACKEND_SOURCE=/absolute/path/to/backend \
SMOKE_BACKEND_PORT=4302 SMOKE_WEB_PORT=5195 \
SMOKE_TURN_ENV_FILE=containers/backend/turn.env SMOKE_TURN_TTL=600 \
node containers/test/smoke-backend.mjs
```

```bash
SMOKE_BACKEND_PORT=4302 SMOKE_WEB_PORT=5195 node containers/test/smoke-web.mjs
```

`SMOKE_TURN_TTL` 仅覆盖测试进程的 TTL。内存 Redis 使用实际时间过期，不修改生产服务或凭据文件。然后运行：

```bash
SMOKE_CLIENT_URL=http://127.0.0.1:5195 \
SMOKE_ARTIFACT_DIR=.local/turn-cloudflare/tls \
SMOKE_RELAY_TRANSPORT=tls SMOKE_TURN_SOAK=true \
node test/smoke/business-flow.mjs
```

将 `SMOKE_RELAY_TRANSPORT` 改为 `udp` 或 `tcp` 并使用独立的输出目录，可以单独验证自有域名 UDP/TCP 3478。测试仅在浏览器入口限制 ICE 配置：创建和更新连接时均强制 `relay`，只保留指定传输的 URL；应用的鉴权、凭据获取、协商、续期及数据通道照常执行。不要同时启用使用测试缓存失效接口的 `SMOKE_TURN=true`。

系统代理可能影响浏览器的 UDP TURN 解析和通信。排查时可设置 `SMOKE_NO_PROXY=true`，只为测试 Chrome 添加 `--no-proxy-server`，不修改系统设置。应分别记录代理与直连网络的结果；候选收集出现 `701` 不代表所有传输都不可用，以实际选中候选和媒体传输为准。

`SMOKE_RELAY_TRANSPORT=all` 保留后端返回的完整 ICE 列表，仅强制中继，用于验证浏览器在当前网络中选择可用传输。

`SMOKE_TURN_SOAK=true` 会运行约 11 分钟，持续记录两端选中的中继候选、传输字节数和解码帧数，确认自动领取了新凭据、执行了 ICE restart，并在两端原始凭据到期后继续验证视频和文字输入。`turn-relay.json` 及失败时的 `relay-failure-*.json` 只记录脱敏诊断，不含凭据、会话令牌或 SDP。默认业务回归仍使用本地测试凭据和直连；必须显式设置中继模式才能声称验证了 TURN。

### 部署和实机

Cloudflare 正式密钥只配置在服务器。部署前后端后，用电脑与手机蜂窝网络完成连接，检查 `getStats()` 的选中 candidate pair 是否包含 `relay`，同时确认视频持续解码、文字和触摸输入正常。

需要排除直连时，可在独立测试页面于创建 offer 前设置 `iceTransportPolicy: 'relay'`。分别测试 UDP 与只保留 `turns:turn.cloudflare.com:443?transport=tcp` 的 TLS 路径。CNAME 必须为灰云，TLS 路径不能替换成自有域名。

缩短服务端 TTL 至 600 秒以观察自动续期，保持连接越过旧凭据到期时间，再测试网络切换、短暂断网和后端重启。旧凭据过期后新会话应能继续中继，离线或结束的会话应无法继续领取凭据。真实 Cloudflare 中继、境内网络延迟和 iOS Safari 实机结果需要单独记录，不能由本地直连回归替代。
