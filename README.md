# PalmDesk

English | [简体中文](README.zh-CN.md)

View and control a selected desktop window from your phone's browser.

PalmDesk is maintained by [Abreto](https://github.com/Abreto) and built on the open-source edition of [BilldDesk](https://github.com/galaxy-s10/billd-desk). It lets you choose a regular macOS or Windows application window, including Codex, ChatGPT, Claude, or a terminal, from your phone. A desktop browser can also act as the controller.

**Status: experimental prototype, with no stable release yet.** You need to deploy your own backend and select a window after connecting. Automatically reopening the last selected window is planned. Known dependency warnings and release prerequisites are tracked in the [open-source readiness notes](docs/OPEN_SOURCE_READINESS.md).

## Features

- Stream a single application window via Electron capture and WebRTC, with input sent over a DataChannel.
- Connect from a mobile page with device history, portrait and landscape layouts, and quality and frame-rate controls.
- Connect using a device code and password, or scan the desktop's QR code with a camera or an image. Connection links open the window picker automatically after authentication.
- Browse application windows across macOS Spaces, search by application name or window title, view thumbnails, and refresh the list. Capture starts only after you select a window.
- Activate windows on other Spaces or restore a selected minimized window before capture begins.
- Disconnect and choose another window while retaining device connection details. Codex and ChatGPT windows appear first, with the original order preserved within each group.
- Use tap, double tap, long-press right click, drag, scroll, zoom, pan, and read-only mode.
- Compose text locally, including Chinese text, then send it to the host. Send Enter, common keys, and hardware keyboard input.
- On macOS, identify the target by application bundle ID, process ID, and native window ID; refresh its bounds and verify focus before sending input.
- On Windows, identify the target by HWND, process ID, executable path, and process start time. Support regular windows on the current virtual desktop, restoring a selected minimized window, and physical coordinates across high-DPI and multiple displays.
- Send literal Unicode text on Windows, preserving Chinese and English text without conversion by the host's input method.
- Stop input and release held keys when the window disappears, capture ends, or the connection closes.
- Configure API, signaling, and TURN services. Browser clients use the current origin by default.

**Hosts support macOS and Windows.** Linux has no native host adapter and rejects capture and input. This host restriction does not apply to browser controllers. Video uses a window source, but input still relies on system focus and mouse/keyboard APIs; it does not provide operating-system-level input isolation.

## Getting Started

### Prerequisites

The client requires Node.js 22.16.0 or later and pnpm 11.19.0. macOS desktop development requires Xcode Command Line Tools. Windows hosts require Windows 10 1903 or later / Windows 11 x64 with Windows Graphics Capture available. The helper uses the system .NET Framework 4.x compiler; Visual Studio is not required.

Packaged desktop builds default to `https://palmdesk.abreto.icu`, including the phone invitation homepage. Browser builds use their current origin; development uses the local backend proxy. Both clients must connect to the same service. For self-hosting, the [container adapter](containers/README.md) builds the pinned BilldDesk backend with PalmDesk session authentication and Cloudflare/coturn credential issuance; MySQL and Redis are required. See the [local development guide](docs/LOCAL_DEVELOPMENT.md) and [service configuration](docs/SERVICE_CONFIGURATION.md).

### Start the Desktop Client

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev:desktop
```

In Windows PowerShell, copy the environment file with `Copy-Item .env.example .env.local`. The first launch compiles `native-bin/palmdesk-window.exe` and starts Electron. See the [Windows desktop guide](docs/LOCAL_DEVELOPMENT.md#windows-桌面) for development and testing. Use `pnpm dev:desktop:lan` to expose the development page to phones on the local network.

Configure your service addresses in `.env.local` or the client's connection settings. See the [service configuration guide](docs/SERVICE_CONFIGURATION.md) for API, signaling, HTTPS, and TURN settings.

On macOS, the development script compiles the Swift window helper and creates a separately identified, locally signed Electron application:

```text
.local/electron-dev/Electron.app
bundle ID: io.github.abreto.palmdesk.dev
```

Grant **Screen Recording** and **Accessibility** permissions to PalmDesk Dev in macOS System Settings:

- Screen Recording is required to view a window that is available for capture on the current desktop.
- Accessibility is required to switch Spaces, restore windows, and send input. Automatic window activation needs this permission even in read-only mode.

You may need to restart the application after granting Screen Recording access. See [Application Identity and Permissions](#macos-application-identity-and-permissions) for worktree builds, migration, and permission recovery.

### Open the Web Client

For browser-only development:

```bash
pnpm dev:web
```

The default URL is `http://localhost:5173/`. Vite proxies `/api` and `/socket.io` to the local backend on port `4300`. If the port is occupied, use the URL printed in the terminal.

For temporary testing from a phone on the same local network:

```bash
pnpm dev:web:lan
```

Open the computer's reachable LAN IP and Vite port on the phone. `localhost` on a phone refers to the phone itself. Use HTTPS for deployed mobile access and in-page camera scanning; on LAN HTTP, use the system camera to open a connection link or select a QR-code image in the web client.

### Connect and Select a Window

1. Open the application window you want to view or control on the computer. It can be on any macOS Space, or on the current Windows virtual desktop.
2. Open the PalmDesk web client on your phone. The desktop and web clients must both use this version and connect to the same backend.
3. Enter the device code and password displayed by the desktop client, or use its QR code.
4. After authentication, select a window on the phone. The host activates it and starts capture once it is available.

To enable QR connections, configure the phone-accessible web client homepage in the desktop's QR connection area. Scan with the web client's scanner, the system camera, or WeChat. The code includes the device code and temporary password; changing the password invalidates old codes. See [QR connection configuration](docs/SERVICE_CONFIGURATION.md#扫码连接) for URL requirements, HTTPS, and WeChat compatibility.

## Window Selection and Session Behavior

The window list travels over the authenticated connection's WebRTC DataChannel, so no BilldDesk server changes are needed. It includes regular application windows across the current user's macOS Spaces, or on the current Windows virtual desktop, and excludes PalmDesk itself, desktop elements, and entire displays.

Windows on other Spaces, hidden windows, and minimized windows are marked as not visible on the current desktop. They remain selectable and may have thumbnails. On macOS 14 and later, ScreenCaptureKit fills in missing Electron previews using single-window snapshots without activating the window or switching Spaces. If the system cannot provide a preview, the selectable entry remains.

Selecting a window activates it and, on macOS, switches Spaces as needed. If it is minimized, only the selected window is restored. Capture starts only when that window appears in the capture source list. Selection fails if the system or application rejects activation or the target cannot be uniquely identified.

Refreshing the list does not switch Spaces. If the selected window closes, leaves the capturable desktop, or changes identity, the session ends. PalmDesk does not automatically select another window. Use the controller's disconnect-and-reselect action to fetch a new list while keeping the device connection details.

### macOS Implementation Limits

macOS Accessibility APIs may omit windows on other Spaces. When necessary, cross-Space activation dynamically uses private SkyLight APIs to identify Space membership, selects the target Space through Mission Control, and verifies visibility, identity, and focus. The host briefly displays Mission Control during this process.

Native Accessibility window IDs distinguish windows with identical titles and sizes. If those APIs are unavailable, PalmDesk accepts only a unique title-and-bounds match. These APIs depend on the macOS version; selection stops with an error if validation cannot complete. Invisible, untitled windows without Accessibility information are filtered out.

System input depends on foreground focus. Concurrent local use or system shortcuts can still change that focus.

## macOS Application Identity and Permissions

The main workspace uses `PalmDesk Dev` with bundle ID `io.github.abreto.palmdesk.dev` for development. Linked worktrees automatically use `PalmDesk WT <id> Dev` and `io.github.abreto.palmdesk.worktree.<id>.dev`. Packaged builds also use separate identities per worktree to avoid overwriting the main application's system permissions and configuration. See the [application identity guide](docs/LOCAL_DEVELOPMENT.md#应用身份) for details and repair steps for existing permission entries.

Without a signing certificate, desktop builds apply and verify local ad-hoc signatures for the application and its helpers so macOS can identify PalmDesk. This does not replace distribution signing. A build fails if an explicitly configured certificate is unavailable.

Rebuilding an ad-hoc signed application can invalidate existing permissions. Check both Accessibility and Screen Recording, then fully quit and restart PalmDesk after changing permissions. Closing the window or refreshing the window list may leave the old process and its permission state running. If access still fails, remove the old entry from the relevant permission list, add and authorize the current `PalmDesk.app`, then fully quit and restart again.

When migrating from the former Codex Remote development build, the application identity and local data directory have changed. Grant permissions again and reconfigure the connection services.

## Build and Test

Run the source checks and web build:

```bash
pnpm test:smoke
pnpm typecheck
pnpm build:prod
```

Build the native helper and desktop application on macOS or Windows:

```bash
pnpm build:native
pnpm build:desktop
```

`build:native` and `build:desktop` select the current host platform. Local desktop artifacts are written to `electron-release/`, with the Windows executable under `win-unpacked/`. On Windows, `pnpm build:desktop:win` explicitly builds the Windows version. These commands do not publish a GitHub Release. Distributing installers still requires resolving dependency warnings, confirming icon provenance and third-party licenses, and completing application signing; macOS also requires notarization.

Use `pnpm dist:mac` on an Apple Silicon Mac or `pnpm dist:win` on Windows to create a local installer. The manually triggered **Desktop Prerelease** workflow builds Apple Silicon Mac and Windows x64 installers and publishes them together as a GitHub Prerelease with SHA256 checksums. Intel Mac installers are not currently supported. These test packages are not distribution-signed or notarized. See [desktop releases](docs/DESKTOP_RELEASES.md) for version rules, triggering the workflow and installation limits.

With the backend running, run the signaling integration test:

```bash
node --test test/smoke/signaling.test.mjs
```

GitHub Actions runs unit tests, type checking, and the web build on Linux, macOS, and Windows, plus native helper compilation on macOS and Windows. It does not cover live remote control or public deployment. Additional browser and Electron smoke-test setup is documented in the [development guide](docs/LOCAL_DEVELOPMENT.md).

GitHub Actions in the main repository can build the web client and the backend with its deployment adapter as Docker images and publish them to GHCR. See [Container Images](containers/README.md) for image names, the pinned backend version, and build instructions. Production credentials, databases, and the tunnel are managed by the deployment environment.

### Validation Coverage

Existing smoke tests exercise real Vue pages, the official backend running locally, Socket.IO, WebRTC video decoding, and the input DataChannel. Native video sources and system input use test doubles in those tests. Historical results are in the [validation report](docs/CODEX_REMOTE_REPAIR_RESULTS.md); references to Codex Remote in reports and screenshots use the project's former name.

Separate Windows native tests verify real window capture and input. The [public backend verification](docs/smoke-artifacts/public-backend-2026-09-08.md) records a packaged Windows host with real WGC video and Win32 input, followed by user-confirmed testing from a physical phone. Cross-network TURN behavior remains unverified.

Window-picker smoke tests cover deferred capture, selection across applications, search and refresh, permission errors, empty lists, windows closing before selection, disconnecting and reselecting, video pixel checks, and mobile portrait and landscape layouts. Unit tests cover selection identifier isolation, invalid identifiers, and window identity checks before capture.

The native macOS Spaces smoke test creates two temporary windows and verifies switching between regular and full-screen Spaces, restoring minimized windows, exact focus, and captured thumbnail pixels. It briefly switches the host's desktop and closes the temporary windows afterward. First prepare the development Electron application with `pnpm dev:desktop`, grant it Screen Recording and Accessibility permissions, and compile the native helper, then run:

```bash
pnpm build:native
.local/electron-dev/Electron.app/Contents/MacOS/Electron test/smoke/native-window-spaces.cjs
```

Set `SMOKE_PREVIEWS_ONLY=true` to check only previews from other Spaces and content refresh, including that the desktop and focus remain unchanged during snapshots.

### Remaining Work

- Complete end-to-end acceptance of real window video streams and system input, including permission recovery.
- Validate on physical iOS Safari devices and across NAT / TURN connections.
- Save the selected target for direct access on the next connection.
- Restore sessions after disconnection.

## Documentation

The detailed guides are currently in Chinese.

| Guide                                                    | Contents                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Chinese README](README.zh-CN.md)                        | Chinese project overview and usage instructions                                                |
| [Local development](docs/LOCAL_DEVELOPMENT.md)           | Backend setup, browser and Electron smoke tests, application identity, and permission recovery |
| [Service configuration](docs/SERVICE_CONFIGURATION.md)   | API and signaling addresses, QR connections, HTTPS deployment, and TURN                        |
| [Validation report](docs/CODEX_REMOTE_REPAIR_RESULTS.md) | Historical test results and remaining acceptance work                                          |
| [Open-source readiness](docs/OPEN_SOURCE_READINESS.md)   | Dependency warnings and release prerequisites                                                  |

## Contributing and License

Report bugs and suggestions through [PalmDesk Issues](https://github.com/Abreto/palmdesk/issues) and read the [contributing guide](.github/CONTRIBUTING.md). For security reports, follow [SECURITY.md](SECURITY.md). Do not publish device passwords, TURN credentials, or window screenshots containing sensitive information.

PalmDesk uses the [MIT license](LICENSE.txt), retaining upstream shuisheng's copyright notice and adding attribution to Abreto. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream attribution and dependency notices.

The preserved [upstream open-source README](README_OpenSource.md) describes upstream products, services, and Pro features; those are not PalmDesk's feature set. PalmDesk is an independent project and is not affiliated with OpenAI, Anthropic, or the BilldDesk maintainers.
