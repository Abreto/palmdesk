# 服务配置

## 组成

手机端是普通网页。macOS 电脑运行本仓库的 Electron 客户端并捕获选定窗口。两端连接同一个 BilldDesk API/Socket.IO 服务，视频和输入走 WebRTC；无法直连时使用自己的 TURN 中继。

这条链路不使用 Codex app-server。后端负责设备注册、密码校验和信令，不需要访问 Codex 会话目录。

## 配置项

环境变量示例在根目录 `.env.example`。在 `.env.local` 或构建环境中提供值，修改后重启 Vite/重新构建。设置页保存的值优先于构建环境变量，并在保存后重载客户端生效。

| 配置                   | 浏览器默认      | 打包后的 Electron 默认  |
| ---------------------- | --------------- | ----------------------- |
| `VITE_API_BASE_URL`    | `/api`          | `http://127.0.0.1:4300` |
| `VITE_SIGNALING_URL`   | 当前网页 origin | `http://127.0.0.1:4300` |
| `VITE_CLIENT_BASE_URL` | 空，手机端无需设置 | 空，需设置手机可访问的网页首页 |
| `VITE_TURN_URL`        | 空，无中继      | 空，无中继              |
| `VITE_TURN_USERNAME`   | 空              | 空                      |
| `VITE_TURN_CREDENTIAL` | 空              | 空                      |

`VITE_ENABLE_UPSTREAM_VERSION_CHECK=true` 才调用上游版本接口；`VITE_OPEN_DEVTOOLS=true` 才在开发客户端自动打开控制台。默认都关闭。

信令地址填服务的 origin，例如 `https://remote.example.com`，Socket.IO 会使用 `/socket.io` 路径。API 地址可填同域的 `/api`，或完整的 `https://remote.example.com/api`。

打包版 Electron 使用 `file:` 页面，需给它配置完整 HTTPS API/信令地址；手机网页使用同一个服务。开发时 Vite 已提供同域代理。

## 扫码连接

电脑端“手机扫码连接”的设置按钮以及“高级设置 → 连接服务”中的“手机网页地址”使用同一项配置。可以填写 `https://remote.example.com/`，局域网调试可以填写 `http://192.168.1.10:5173/`；实际 IP 和端口以运行环境为准。也可通过 `VITE_CLIENT_BASE_URL` 设置构建默认值，界面保存的值优先。

这里必须是本项目网页客户端的首页，不是 API 或 Socket.IO 地址。可以包含部署子路径，例如 `https://remote.example.com/client/`。地址不能带登录信息、查询参数或邀请内容；不接受 `localhost`、回环 IP、`0.0.0.0` 等手机无法直接使用的监听地址。未配置地址或电脑尚未完成服务连接时，不生成二维码。手机网页与电脑必须连到同一个 BilldDesk 后端。

二维码是普通 HTTP/HTTPS 链接，设备代码和临时密码位于 `#/remote?...` 片段中。系统相机或微信识别后打开网页，即可自动发起连接；网页内也可通过扫码按钮调用后置相机，或从相册选择二维码图片。若扫到另一部署地址的连接码，会打开该码对应的客户端地址。

连接信息在接收后从地址栏和当前历史记录中移除，片段不会被浏览器发送到 HTTP 服务端。二维码、复制出的链接和截图仍相当于临时密码，不能公开分享；成功连接后的设备历史沿用现有密码保存行为。修改密码只有在服务器确认成功后才会更新二维码，旧码随后无法通过认证。设备离线、密码错误、网络失败都会显示错误并允许重试。

网页实时相机扫码需要有效 HTTPS 和相机权限。局域网 HTTP 调试可以使用系统相机打开链接，或在网页里选择二维码图片。正式访问需要部署 HTTPS，本次功能不自动部署网站、签发证书或建立公网隧道。

微信扫码使用微信内置浏览器打开同一个网页链接，没有接入微信 JS-SDK、公众号或原生 App 唤起。扫码后是否出现确认页面，以及内置浏览器的 WebRTC 能力，取决于微信版本、系统和域名状态；不承诺强制跳到 Safari/Chrome。缺少 WebRTC 时会提示改用系统浏览器，并提供复制连接链接入口。系统相机、iOS Safari 和微信的实机验收仍需在最终 HTTPS 地址上完成。

## 手机与服务器

同局域网临时调试可运行：

```bash
npm run dev:web:lan
```

手机打开电脑的局域网 IP 和 Vite 端口。该命令会允许局域网访问开发服务；默认命令只监听本机回环地址。局域网 HTTP 只适合临时浏览器兼容性检查，正式手机访问使用 HTTPS。

部署网页：

```bash
npm run build:prod
```

把 `dist/` 作为静态站点，代理 `/api/` 到 BilldDesk HTTP 服务，代理 `/socket.io/` 到同一服务并支持 WebSocket Upgrade。可参考 [Nginx 配置模板](../config/nginx.conf.example)，替换域名、证书和静态目录后使用。此模板未在本次环境部署。

BilldDesk 服务端也要允许该网页的 origin；本次固定后端快照默认只适配了本地开发域名。手机和电脑需能访问相同的信令/API 地址。

Windows 打包版 Electron 的 WebSocket 握手使用 `Origin: file://`。服务端若校验 WebSocket 来源（例如 Socket.IO 的 `allowRequest`），需显式允许 `file://`；允许字符串 `null` 不能替代它。API 登录成功但 WebSocket 握手返回 HTTP 400 时，应检查这项配置。开发客户端则使用实际页面 origin，例如 `http://127.0.0.1:5173`，也需要被允许。

## TURN

例如：

```dotenv
VITE_TURN_URL=turn:relay.example.com:3478?transport=udp
VITE_TURN_USERNAME=your-client-username
VITE_TURN_CREDENTIAL=your-client-password
```

中继地址也可以使用 `turns:`，或只配置 `stun:`。两端都要设置可达的 ICE 服务。TURN 需要部署 coturn、配置公网地址和中继端口范围，并放通相应的 UDP/TCP 端口。

所有 `VITE_*` 值都会进入客户端，TURN 客户端凭据对用户可见。不要把 coturn 的 `static-auth-secret` 放进前端；面向多用户的服务应由后端签发有有效期的 TURN 凭据，这部分尚未实现。

本次 WebRTC 已验证同机直连；跨 NAT、蜂窝网络和强制 relay 还没有验证。正式服务的账户、配额、短期中继凭据和分发签名属于后续服务化工作。
