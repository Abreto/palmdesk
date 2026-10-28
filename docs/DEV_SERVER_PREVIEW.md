# Previewing host development servers: architecture decision

Status: proposed, 2026-10-28. Research spike for [#26](https://github.com/Abreto/palmdesk/issues/26); the product requirements are in [#35](https://github.com/Abreto/palmdesk/issues/35). Nothing described here ships in PalmDesk yet.

**Decision.** Build an authenticated HTTP preview transport over the existing WebRTC connection, rendered in a separate, sandboxed preview origin on the phone (option B). Keep window capture of a host browser (option A) as the fallback that already works today, but do not build further on it for #35. The first implementation is bounded to HTTP/1.1 development servers on host-approved loopback ports, verified controllers only, and controllers opened over HTTPS.

**中文摘要。** 推荐方案 B：在现有 WebRTC 连接上新增经认证的 HTTP 预览通道，手机端在独立、沙箱化的预览来源（preview origin）中用 Service Worker 呈现主机开发服务，WebSocket/HMR 由注入脚本经同一通道转发。主机只连接用户显式批准的回环端口（可限定路径前缀），只服务已通过临时密码验证（#88）的控制端，并在主机侧改写 Host/Origin/Cookie、拒绝越界重定向。预览内容与 PalmDesk 的来源、存储和远控输入完全隔离；断开、撤销或改密后立即拆除，并清空预览来源的存储。窗口捕获方案（A）不满足 #35「验收入口不要求启动窗口捕获」和真实手机视口的要求，仅作为现有备选。原型在无头 Chromium 中用真实 Vite 应用验证了静态资源、客户端路由与刷新、同源请求、流式响应、Cookie、重定向限制、HMR、撤销和断开；iOS Safari 与 Android 实机结果仍待采集。自部署需要额外提供一个 HTTPS 预览域名（最好与 PalmDesk 网页不同站点），后端无需改动。

## Context

### What #35 asks for

After an agent starts a development server on the host, the phone user should open it, use it at a real phone viewport with touch, and return to the reading view or window with their place and drafts intact. #35 adds: no window capture to reach the preview; access only for authenticated devices and host-approved ports; isolation from PalmDesk credentials, storage and remote-input rights; closing access on revocation or session end; clear states for a stopped server, invalid port and lost connection; and Vite validation of pages, assets, client routing and refresh, same-origin API calls and WebSocket/HMR, with redirect, cookie and cross-port limits recorded.

A `localhost` link in a transcript refers to the host. A browser page cannot open a TCP listener, so on the phone that address can only be emulated, not forwarded. Mapping a port to the controller's own `127.0.0.1` (as Moshi does with SSH forwarding in a native client) needs a native controller and is out of scope here; the same channel protocol could serve such a client later.

### What PalmDesk has today

- The controller is a web page that owns the `RTCPeerConnection`. On the host, the Electron renderer owns the peer and the main process owns native capabilities behind the IPC allowlist from #61.
- DataChannels are per feature: `MessageChannel` (input and control), `SessionReader`, `ImageTransfer`. Once [#88](https://github.com/Abreto/palmdesk/pull/88) merges, `PalmDeskAuth` verifies each controller's temporary password with CPace, the host ignores channels it does not know, and features check `controllerVerified()`.
- The controller keeps device codes and temporary passwords on its own origin: the persisted Pinia cache in `localStorage` (`linkDeviceList`, `remoteDeskUserPassword`) and `codex-remote-session` in `sessionStorage`. Any preview code running on PalmDesk's origin could read them.
- The web build's CSP has `frame-src 'none'`.

### Platform facts that shape the design

1. Service workers see the page's fetches, navigations and subresources, including cross-origin requests from pages they control, but never WebSocket handshakes.
2. Service workers need a secure context. A frame is a secure context only if its top-level page is one, so an HTTPS preview frame inside a controller served over LAN HTTP cannot use them (measured below).
3. A response constructed in a service worker cannot set browser cookies (`Set-Cookie` is a forbidden response header), and the browser's HTTP cache never stores it.
4. WebKit partitions service workers by top-level site, so a worker registered by a third-party frame serves only that frame's partition ([WebKit, 2018](https://webkit.org/blog/8090/workers-at-your-service/)); Chromium does the same since storage partitioning.

## The two options

| Concern                  | A: capture a host browser window                                                                  | B: HTTP preview transport into an isolated origin                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Data flow                | Host browser renders; existing window video and input                                             | Phone renders; requests and WebSockets travel as frames on dedicated DataChannels to a host gateway |
| Phone viewport and touch | Desktop rendering, mouse emulation; no real mobile WebKit                                         | Real phone viewport, touch, keyboard and engine                                                     |
| Window capture needed    | Yes, which #35 rules out for the acceptance entry                                                 | No                                                                                                  |
| Authorization            | Existing session plus window selection; a browser window can navigate anywhere unless locked down | Verified controller, host-approved loopback port and optional path prefix, enforced on the host     |
| Isolation                | Content stays on the host, but it receives OS-level remote input                                  | Separate origin and sandbox on the phone; no input rights; storage cleared on teardown              |
| LAN HTTP controller      | Works                                                                                             | Unsupported (needs a secure context)                                                                |
| Bandwidth                | Continuous video (Balanced ceiling 3000 kbit/s)                                                   | On demand: about 2 MiB for a cold load of a 119-module Vue app, kilobytes for reloads and HMR       |
| Self-hosting             | Nothing new                                                                                       | A second HTTPS host name for the preview origin; no backend change                                  |
| Work                     | Small (selection and lifecycle only)                                                              | Large, but prototyped end to end below                                                              |

### Option A: capture a host browser window

The host opens the approved URL in a browser window, the controller selects it like any window, and the existing video, input, teardown and offline handling apply. Users can already do this today by selecting a browser window. A PalmDesk-owned `BrowserWindow` would improve it: a separate session partition, no preload, sandboxed, navigation restricted to the approved loopback origins, and an emulated phone viewport (`webContents.enableDeviceEmulation`).

It fails #35 on two points: the acceptance entry must not require window capture, and the result should use a real phone viewport and touch. Emulation is still Chromium on a desktop, input arrives as OS events that depend on the foreground window (see [SECURITY.md](../SECURITY.md#current-boundaries)), the phone keyboard and IME behave differently, and video costs bandwidth for as long as the preview is open. Selecting the user's own browser window also hands the controller that browser profile's signed-in sessions. Option A needs no new deployment and works over LAN HTTP, so it stays the fallback for unsupported controllers, not a target for new work.

### Option B: HTTP preview transport into an isolated origin

#### Data flow

```text
Phone                                                         Host computer
+-- PalmDesk origin (controller page) ------------+          +-- PalmDesk desktop ---------------------------------+
| RTCPeerConnection                               |  WebRTC  | renderer: channels <--IPC--> main: preview gateway  |
|   PalmDeskPreview        (control: requests)    |<-------->|   checks verification     | policy, cookie jar,     |
|   PalmDeskPreviewData0-3 (one stream each)      |  (DTLS)  |   per-channel send queues | HTTP/WS client ---------+--> 127.0.0.1 / ::1
| preview bridge (validates, assigns stream ids)  |          +-----------------------------------------------------+     approved port only
|   iframe sandbox -> preview origin              |
+-------------------|-----------------------------+
+-- preview origin (separate site, HTTPS) ---------v-------+
| relay.html: registers sw.js, holds the bridge's port     |
|   app frame: the dev app, controlled by sw.js;           |
|   client.js (injected) tunnels WebSockets via the relay  |
+----------------------------------------------------------+
```

1. The controller opens a control channel and four data channels. After [#88](https://github.com/Abreto/palmdesk/pull/88) verifies the controller, the host answers `hello` with the approved targets (`id`, label, port, path prefix) and limits, or with `denied`.
2. Choosing a target embeds `https://<preview origin>/__palmdesk_preview/relay.html` in a sandboxed frame. The relay greets PalmDesk with a nonce from its URL fragment; the bridge checks the message's origin and source window, then transfers a `MessagePort`.
3. The relay registers `sw.js` with scope `/` (the server sends `Service-Worker-Allowed: /`) and loads the app path in a nested frame. Every request from that frame, including navigations and absolute `http://localhost:<port>` URLs, reaches the worker, which sends it to the relay with a reply port. The relay passes it to the bridge.
4. The bridge accepts only preview-origin URLs (mapped to the open target) and loopback URLs whose port and path match an approved target. It assigns a stream id and sends `req` with the target id and an origin-form path, never a URL.
5. The host gateway checks the request again, connects to `127.0.0.1` or `::1` on the approved port, and returns `res`, body frames and `end` on one data channel per stream. Text responses are gzip-compressed with a sync flush per write; the worker decompresses with `DecompressionStream`. The worker returns credits as the page consumes data, so a stalled reader stops the host instead of filling memory.
6. Before returning an HTML document, the worker injects `/__palmdesk_preview/client.js` after `<head>`. The shim replaces `WebSocket` for same-origin and loopback URLs with one carried by the relay over the same channels; other WebSockets (internet services) connect directly. It also refuses `navigator.serviceWorker.register`.
7. The worker keeps validated responses with an `ETag` in Cache Storage and revalidates them with `If-None-Match`, because the browser's HTTP cache never sees constructed responses.

Frames are JSON control messages (`hello`, `grant`/`denied`, `req`, `res`, `end`, `fail`, `credit`, `cancel`, `ws-open`, `ws-opened`, `ws-closed`, `ws-close`) plus binary frames with a one-byte kind, a 32-bit stream id and the payload. The host sizes frames from the phone's `RTCSctpTransport.maxMessageSize` (64 KiB at most; 16 KiB when the browser does not report it). One WebSocket message must fit in one frame in this version.

#### Authentication and authorization

- **Who:** only controllers the host has verified. With #88, that means the controller proved the temporary password over `PalmDeskAuth`; hosts without #88 (`hostAuth === 'legacy'`) must not offer preview. Unverified controllers get `denied/unverified`, and requests sent anyway are refused (measured).
- **What:** the host user turns preview on and approves targets explicitly, each a loopback port with an optional path prefix and a label. Ports on the Fetch "bad port" list are refused. Preview is off and the list empty by default. The list lives in the main process, like other host settings, and the renderer cannot widen it.
- **Where to:** the gateway only ever connects to `127.0.0.1` or `::1` on an approved port. It never resolves host names, so DNS rebinding does not apply, and it tries both addresses because Vite's default `localhost` bound only `::1` on the test Mac while other servers bind only IPv4.
- **Revocation:** removing a target or turning preview off ends that target's requests and sockets at once (`revoked`, WebSocket close 4403) and publishes the shorter list. A password change already disconnects every controller (#65), which closes the channels.
- **Consent caveat:** approval covers a port, not a process. Whatever listens there at request time answers, including the dev server's own proxy rules. The host UI should show whether something is listening and warn that controllers can use the service as the host user.

How requests stay inside the approved destinations:

| Attempt                                                                                     | Result                                                                                                           |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Absolute or scheme-relative path in a frame (`http://127.0.0.1:22/`, `//127.0.0.1:22/`)     | Refused (`bad-path`): only origin-form paths starting with a single `/`                                          |
| Dot segments or encoded separators (`/api/%2e%2e/admin`, `/api/..%2fadmin`)                 | Normalized with the URL parser, then checked against the prefix; encoded `/` and `\` are refused                 |
| Unknown target id                                                                           | Refused (`not-approved`)                                                                                         |
| Choosing `Host`, `Origin`, `Referer`, `Cookie`, `X-Forwarded-*`, `Sec-*`, `Upgrade` headers | Dropped; the host sets `Host: localhost:<port>`, `Origin`/`Referer` to that origin and `Cookie` from its own jar |
| Methods such as `CONNECT` or `TRACE`                                                        | Refused (`bad-method`); `Upgrade` and `Connection` are dropped, so WebSockets open only through `ws-open`        |
| Redirect inside the target (`/login`, `http://localhost:<port>/x`)                          | Returned to the browser with `Location` rewritten to a preview-origin path, then checked again when followed     |
| Redirect to another port, a LAN address or another site                                     | Not followed; answered with a blocked page (`redirect-blocked`)                                                  |
| App fetch of `http://localhost:<other port>/` or of a path outside a prefix                 | Answered `403 not-routed` by the worker; the phone never contacts its own loopback                               |
| App fetch of an internet URL (CDN, API)                                                     | Loaded directly by the phone, as on any page; the host is not involved                                           |

#### Browser constraints

| Constraint                                          | Measured in headless Chromium 156                                                                                   | iOS Safari (all iOS browsers use WebKit)                                                            | Android Chrome                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Worker registration in a cross-site sandboxed frame | Works (`allow-scripts allow-same-origin`), cross-site and same-site, over HTTPS                                     | Partitioned workers are documented; the sandboxed case is unverified                                | Same engine as measured; unverified on a device |
| Controller over LAN HTTP                            | Relay reports `insecure-context`; preview unsupported                                                               | Expected the same (secure-context rules)                                                            | Expected the same                               |
| Origin isolation and storage                        | PalmDesk storage and cookies invisible; top storage access throws; preview storage cleared on teardown              | Third-party storage is partitioned and may be session-only; acceptable because it is cleared anyway | As measured                                     |
| Cookies                                             | Upstream cookies work through the host jar; `document.cookie` sees none; script-set cookies are not sent upstream   | Same by design (no browser cookies involved)                                                        | Same                                            |
| CSP                                                 | Upstream CSP kept except `frame-ancestors`; `X-Frame-Options` dropped; the shim loads as same-origin `<script src>` | Same; nonce-only CSPs with `strict-dynamic` would block the shim (not handled yet)                  | Same                                            |
| Streaming responses                                 | `ReadableStream` bodies and `DecompressionStream`; first chunk after 5–19 ms; SSE works                             | `DecompressionStream` needs iOS 16.4+; otherwise unsupported                                        | Supported                                       |
| WebSocket and HMR                                   | Shim plus tunnel; Vite 6 token and `vite-ping` work; reconnect reload after re-approval works                       | Unverified                                                                                          | Unverified                                      |
| DataChannel message size                            | `maxMessageSize` 262144; 64 KiB frames                                                                              | Unknown; negotiated at runtime                                                                      | As measured                                     |
| Background tabs                                     | Not measured                                                                                                        | WebRTC may stop when Safari is backgrounded; the preview tears down and must reload                 | Background tabs may freeze                      |

Other limits: an app whose own service worker matters (PWA work) cannot install it; WebSockets opened inside workers are not tunneled; HTML documents are buffered before the shim is injected; frame-busting scripts that navigate `top` are blocked by the sandbox; one preview at a time per browser, because the worker routes requests to the single relay it finds.

#### Isolation from PalmDesk

- Preview code never runs on PalmDesk's origin. The preview origin should be a separate site (the prototype also passed with a same-site subdomain, which still lets preview pages set cookies for the parent domain; PalmDesk does not rely on cookies for authentication today).
- The frame is sandboxed with `allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads`, without top navigation, with no permission delegation (camera and clipboard reads report not allowed) and `referrerpolicy="no-referrer"`.
- The bridge accepts only the preview protocol over its port and counts everything else as ignored; the preview has no path to the input, reader, image or authentication channels. On the host, the gateway is an HTTP and WebSocket client for approved loopback ports and nothing else: no capture, input, clipboard or file access.
- Upstream cookies live in host memory per controller connection and target, and are discarded on revocation and disconnect.
- Teardown unregisters the worker and clears the preview origin's `localStorage`, `sessionStorage`, Cache Storage and IndexedDB, so the next host or project starts clean. The relay's port grants nothing beyond what preview pages can already do; anything on the preview origin, including the app, is treated as untrusted.

#### Teardown

| Trigger                                                | Effect                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Phone closes or loses the connection cleanly           | Bridge fails pending requests and sockets, removes the frame and clears storage; host aborts upstream requests |
| Host ends the session (password change, quit, removal) | Same, initiated by the host closing the peer connection                                                        |
| Host removes a target or turns preview off             | Upstream requests and sockets for that target end at once; new requests are answered `403 revoked`             |
| Controller stops the preview or switches target        | The relay unregisters the worker and clears storage before a new one starts                                    |
| Network silently drops                                 | Detected only by PalmDesk's existing connection recovery; the gateway should also time out idle streams        |

#### States the controller shows

| State                   | Cause                                                        | Recovery hint                                                 |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| `unsupported`           | Controller not on HTTPS, no service workers, iOS before 16.4 | Open PalmDesk over HTTPS, update the browser, or use option A |
| `denied` (`unverified`) | Host has not verified this controller, or is too old         | Reconnect with the current password; update the desktop app   |
| No targets              | Preview off or no approved ports                             | Add the port on the computer                                  |
| `upstream-unavailable`  | Nothing listening on the approved port                       | Start the development server, then reload                     |
| `redirect-blocked`      | Redirect outside the approved target                         | Open that address outside PalmDesk                            |
| `revoked`               | Host removed the target                                      | Ask the host to approve it again; the page then resumes       |
| `disconnected`          | Channel closed                                               | Reconnect; previews reload from scratch                       |
| `not-routed`            | App called another local port or path                        | Approve that port on the computer                             |

#### Bandwidth and relays

Preview bytes travel only over the WebRTC connection: directly between phone and host, or through the TURN relay when a direct path fails, where every byte counts in and out. The PalmDesk backend only signals, and the preview origin serves about 20 KiB of static files.

Measured payloads (through the prototype; details below):

| Load                                              | Requests | From the dev server | Over the DataChannel |
| ------------------------------------------------- | -------- | ------------------- | -------------------- |
| Fixture Vite app, first load                      | 8        | 194.7 KiB           | 42.2 KiB             |
| Fixture, reload (6 answered 304)                  | 8        | 0.6 KiB             | 2.4 KiB              |
| Fixture, one HMR module update                    | 1        | 0.4 KiB             | 1.4 KiB              |
| PalmDesk's own web client in dev mode, first load | 119      | 9.43 MiB            | 1.98 MiB             |
| PalmDesk's own web client, reload                 | 102      | 0.6 KiB             | 26 KiB               |

A first load of a mid-sized Vue app therefore moves about 2 MiB over the connection, or about 4 MiB of TURN traffic when relayed, and later reloads and HMR edits are small. Over a phone link the unbundled module graph makes latency matter more than bandwidth: each level of imports costs at least one round trip. For comparison, window video at the Balanced ceiling may use up to 3000 kbit/s for as long as it runs.

#### Self-hosting

- Serve the preview files (`relay.html`, `relay.js`, `sw.js`, `client.js`) from a second HTTPS host name with no API, no cookies and a 404 page for every other path. Send `Service-Worker-Allowed: /` with `sw.js` and `Content-Security-Policy: frame-ancestors <PalmDesk web origins>` with `relay.html`. Prefer a different registrable domain from the web client, for example `palmdesk-preview.example` beside `palmdesk.example`.
- Configure the web client with that preview origin, and allow it in `frame-src` (the built-in CSP currently says `'none'`).
- No backend, database or TURN change. TURN traffic grows with preview use.
- Wildcard DNS and certificates are not needed for this design; they would be for per-target origins, a later option.
- LAN-only deployments over HTTP cannot use preview; they need HTTPS, for example with a local certificate authority trusted by the phone.
- The hosted service needs a decision on its preview domain before the controller can offer preview there.

## Prototype

The prototype in [`test/dev-preview/`](../test/dev-preview/) implements option B end to end on this machine. It is not wired into PalmDesk's pages, Electron app or CI.

| File                                       | Stands in for                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `policy.mjs`, `gateway.mjs`                | The host gateway in the Electron main process: target list, path and header policy, redirects, cookie jar, HTTP and WebSocket client, gzip, credits |
| `public/host.js`                           | The host renderer: accepts the preview channels and assigns each stream to the least busy data channel                                              |
| `public/bridge.js`, `public/controller.js` | The controller page: channels, bridge, sandboxed frame                                                                                              |
| `preview-origin/`                          | The preview origin's relay, service worker and WebSocket shim                                                                                       |
| `server.mjs`, `prototype-worker.mjs`       | Local signaling and static servers, run on their own thread                                                                                         |
| `fixture-app/`                             | A small Vite app: imported and public assets, CSS, history routing, API endpoints, an HMR-accepted module                                           |
| `run.mjs`                                  | 25 headless checks and measurements                                                                                                                 |
| `measure.mjs`, `channel-bench.mjs`         | Loading any local dev server through the preview; raw DataChannel behaviour                                                                         |
| `policy.test.mjs`                          | Unit tests for the host policy                                                                                                                      |

Run, under the shared browser lock, after `pnpm install`:

```bash
node --test test/dev-preview/*.test.mjs
```

```bash
lockf -k "$(git rev-parse --git-common-dir)/browser-smoke.lock" node test/dev-preview/run.mjs
```

`--https` runs the same checks over TLS with a throwaway certificate under `palmdesk.test` and `preview.test`, and `--https --same-site` uses `preview.palmdesk.test`. `--serve` keeps the servers running and prints a host page and a controller URL for a desktop browser on the same machine. `measure.mjs <port>` loads an already running dev server through the preview and directly. Everything listens on loopback and nothing contacts a PalmDesk service; Vite runs in its own process, like a real project.

### Results

Checked on 2026-10-28 on an Apple Silicon Mac (macOS 26.6), Node 26.5.0, Playwright's Chromium 156.0.8078.4 headless, Vite 6.4.5, phone viewport 390×844 with touch. All 25 checks passed in five consecutive runs with `*.localhost` origins, and the 24 that apply passed with `--https` both cross-site and same-site:

- an unverified controller is denied and its requests are refused; a verified one receives the approved list;
- cold load with worker installation; public, imported and CSS assets; history routing, then a refresh on the deep route; a navigation redirect inside the target;
- same-origin GET and POST with a JSON body (the dev server saw `Host: localhost:<port>`); streamed text and server-sent events;
- cookies kept in the host jar and invisible to scripts; redirects rewritten inside the target and blocked otherwise, as navigations and fetches;
- cross-port calls to a second approved server (IPv4 only, limited to `/api/`), while `/admin` and an unapproved canary port were refused; eight crafted frames that try to leave the list (the canary server never received a request);
- module and CSS HMR over the tunneled `vite-hmr` WebSocket without a reload;
- isolation: PalmDesk storage and cookies unreadable, top navigation and app service workers refused, camera and clipboard reads not allowed, foreign `postMessage`s ignored;
- revocation closes HMR and answers new requests `403 revoked`; approving the port again lets Vite's client reconnect and reload; a stopped server shows `upstream-unavailable`;
- a dropped connection aborts the upstream request and clears the worker, storage and cache; the host ending the session tears the preview down; a controller on LAN HTTP reports `insecure-context`.

Medians of the five runs on loopback (range in parentheses), with machine load averages of 3–7 from other work:

| Measure                                       | Direct from Vite        | Through the preview                                                        |
| --------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| Fixture first load                            | 87 ms (71–137)          | 249 ms (194–370), including 63 ms (35–88) to install the worker            |
| Fixture reload                                | 33 ms (27–113)          | 85 ms (60–154)                                                             |
| One small request                             | 1.5 ms (0.9–2.2)        | 9.2 ms (6.1–11.7): 0.2 worker routing, 0.4 cache lookup, 4.0 until headers |
| HMR module update after a file write          | 124 ms (120–130)        | 133 ms (126–138)                                                           |
| 8 MiB incompressible download                 | 1428 Mbit/s (1157–2237) | 41 Mbit/s (28–55)                                                          |
| 8 MiB JavaScript-like text                    | —                       | 266 Mbit/s effective (186–331), 0.4% of it on the wire                     |
| Small request during that download            | —                       | 102 ms (18–177); 9 ms (7–18) when idle                                     |
| Teardown after the phone drops the connection | —                       | Phone 19 ms (15–21); host aborted the upstream request after 17 ms (14–21) |
| Teardown after the host ends the session      | —                       | 42 ms (32–53)                                                              |

PalmDesk's own web client in dev mode (Vue and Naive UI, 119 module requests, Vite already warm, backend proxies removed): first load 2.3–3.5 s through the preview against 0.65–1.2 s direct, reload 0.5–1.2 s against 0.2–0.45 s, in five runs at load averages around 6–7.

### Findings that shaped the design

- **One ordered channel causes head-of-line blocking.** With a 4 MiB send buffer, small messages sent on the same channel during an 8 MiB transfer waited 280–420 ms (up to 1.5 s under heavy load); on a second channel they took 11–82 ms (`channel-bench.mjs`). A 256 KiB buffer kept the same channel at 13–73 ms on a quiet machine, but the full-stack runs with a single channel still took 0.34–0.59 s for a small request during a download. The design therefore uses a control channel plus four data channels, assigns each stream to the channel with the fewest open streams, and caps each channel's send buffer at 256 KiB.
- **No shared FIFO anywhere on the host path.** Timing the small request at the host page showed that most of the remaining delay under load came from the prototype's host plumbing (socket.io standing in for IPC, and the gateway thread), not from the DataChannels: 6–66 ms of the total was spent on the phone and the channels. In PalmDesk the main-to-renderer path needs per-stream fairness too, for example one `MessagePort` per data channel.
- **DataChannel throughput is the bulk limit.** Raw Chromium DataChannels moved 52–86 Mbit/s on a quiet machine and 19–51 Mbit/s under heavy load, where larger messages helped. Development payloads are compressible, so effective throughput for JavaScript is several times higher.
- **The worker cache matters.** Without it, every reload would re-download every module; with `ETag` revalidation the fixture reload costs 2.4 KiB and PalmDesk's client 26 KiB.
- **Loopback is not one address.** Vite's default host bound only `::1`, while other servers bind only `127.0.0.1`; the gateway tries both and remembers which answered.
- **Vite 6 HMR works through the tunnel** because its WebSocket token is embedded in the client the preview already served, and the gateway sends an `Origin` matching the target. Node's WebSocket client cannot set `Host`, so Vite saw an IP host, which it accepts; the product gateway should use a client that sets `Host: localhost:<port>` for stricter servers.

### Limits of these measurements

Everything ran on one Mac over loopback, with the phone emulated by headless Chromium and other sessions loading the machine; absolute times varied two- to threefold between runs. No physical phone, WebKit build, real network, TURN relay or Electron host was involved. The prototype host page and gateway stand in for the Electron renderer and main process, and socket.io stands in for IPC. Other dev servers (webpack, Next.js), HTTPS upstreams and the phone backgrounding the browser were not tested.

## Decision

Adopt option B for #35, bounded as below. Option A stays available as it is today.

### First implementation

1. **Host gateway** (`electron-main/`): the policy and gateway from the prototype, ported to TypeScript with the unit tests in `test/smoke/`; settings for preview on/off and the approved targets in the main process; a `MessagePort` per controller between renderer and main instead of per-frame `invoke`, registered with the IPC allowlist and refused by smoke runs; per-stream fairness and a 1 MiB credit window; idle and header timeouts.
2. **Host UI**: turn preview on, add or remove ports with an optional path prefix and label, show whether each port is listening, warn what approval means, list which controllers are previewing, and stop all previews.
3. **Host renderer**: accept `PalmDeskPreview` and `PalmDeskPreviewData0`–`3` only from controllers that `controllerVerified()` accepts (#88), forward frames, and keep each channel's send buffer below 256 KiB.
4. **Controller**: the bridge as a module beside the session reader; a Preview view next to Read and Window that stays mounted the same way, so returning keeps the reading position and drafts; window video suspended while previewing; toolbar with reload, back and stop; the states above.
5. **Preview origin**: the relay, worker and shim built as static files, the preview origin configurable like the other service addresses, the web CSP's `frame-src` set to it, and self-hosting documentation.
6. **Limits for this version**: HTTP/1.1 upstreams on loopback ports; GET, HEAD, POST, PUT, PATCH, DELETE and OPTIONS; request bodies up to 8 MiB; WebSocket messages up to one frame; 64 streams per controller; one preview at a time per browser.

### Not in the first implementation

Native port mapping to a desktop controller's own `127.0.0.1`; HTTPS or self-signed upstreams; LAN or remote hosts; automatic port discovery; a top-level preview tab (which would serve LAN HTTP controllers and full screen, but gives preview code an `opener` it can navigate); per-target origins; fragmented WebSocket messages; service workers inside previewed apps; `document.cookie` access to server cookies; shims for nonce-only CSPs and for workers' WebSockets; streaming request bodies.

### Against #35's acceptance criteria

| #35 criterion                                                       | First implementation                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Supported controllers and access methods recorded                   | Browser preview on HTTPS controllers; native port mapping recorded as later work |
| Loopback-only dev server reachable through an explicitly added port | Yes, macOS and Windows hosts (Windows untested in this spike)                    |
| Vite pages, assets, routing and refresh, API calls, WebSocket/HMR   | Yes; prototype-verified in Chromium                                              |
| View and stop; clear states for stopped server, bad port, lost link | Yes; local port conflicts do not apply to browser preview                        |
| Device authentication, host-approved ports, revocation, isolation   | Yes                                                                              |
| No window capture; returning keeps reading position and drafts      | Yes, by keeping the views mounted                                                |
| Real-device acceptance across networks, iOS, Android, desktop       | Remaining work                                                                   |

## Remaining work

- **Physical devices**: on iOS Safari and Android Chrome, against a host on a real network and through TURN, check worker registration in the sandboxed cross-site frame, `pc.sctp.maxMessageSize`, cold load and reload times, HMR, streaming, cookies, revocation, backgrounding and returning to the browser, and storage clearing. Repeat on desktop Safari and Firefox. Running the prototype on a phone needs both origins on trusted HTTPS names reachable from it.
- **Windows hosts**, other dev servers (webpack, Next.js) and an Electron-hosted gateway.
- **Hosted service**: choose the preview domain.
