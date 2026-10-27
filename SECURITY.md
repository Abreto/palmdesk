# Security Policy

PalmDesk is an experimental remote-control client in public preview. It gives a phone or browser control of one window on your computer, so treat its connection credentials like a password.

## Supported Versions

Only the latest preview release receives security fixes. Fixes land on `main` first and ship in the next preview; earlier previews are not patched. The installed version is shown in the desktop app's sidebar.

| Version                                                                          | Supported |
| -------------------------------------------------------------------------------- | --------- |
| Latest preview on [GitHub Releases](https://github.com/Abreto/palmdesk/releases) | Yes       |
| Earlier previews                                                                 | No        |

## How Fixes Are Announced

- Fixed vulnerabilities are published as [GitHub security advisories](https://github.com/Abreto/palmdesk/security/advisories) and listed under **Security** for that version in [CHANGELOG.md](CHANGELOG.md) and the release notes.
- The desktop app does not update itself. Install the newer release from [GitHub Releases](https://github.com/Abreto/palmdesk/releases) to get a fix. To be notified, watch the repository with **Watch → Custom → Releases** and **Security alerts**.
- Self-hosted deployments also need the matching web client, and backend images when the release notes say so.

## Reporting a Vulnerability

Use [Security > Report a vulnerability](https://github.com/Abreto/palmdesk/security/advisories/new) to send a private report. If the entry is unavailable, open an issue requesting a private contact without disclosing the vulnerability details.

Include the affected version or commit, environment, reproduction steps and impact. Do not attach real device passwords, TURN credentials, unredacted connection links or QR codes, private screenshots or session data.

## The Hosted Service

Packaged desktop builds and the connection QR code use the PalmDesk service at `https://palmdesk.abreto.icu` unless you configure other servers under **高级设置 → 连接服务** (Advanced settings → Services). The project maintainer runs it as a best-effort preview, without an availability or security guarantee. The installer does not include a backend.

The service:

- registers each desktop and stores its device code and current temporary password. Passwords are not yet stored as salted hashes;
- checks the password when a controller connects and **decides which controllers may start a remote session with your desktop**. The desktop currently trusts that decision;
- relays signaling between the desktop and controllers: session setup, WebRTC offers and answers, and network candidates;
- issues short-lived TURN credentials. When a direct connection is impossible, WebRTC traffic passes through a Cloudflare TURN relay.

Window video, input, image paste and session reading travel only over the WebRTC connection, encrypted with DTLS between the controller and the desktop; TURN relays forward encrypted packets. The keys behind this encryption are exchanged through the service, so the service is trusted not to interfere with them. Session reading is off by default.

Anyone who obtains your device code and temporary password, or who controls the service, can therefore ask to control the window you share. Keep the password and QR code private, and change the password if they may have been exposed. A successful password change invalidates the old password and QR code. The updated desktop client also disconnects existing controllers, who must use the new password to reconnect.

The updated backend also revokes session tokens and rejects connection attempts that authenticated with the old password but were still being established when it changed. Self-hosted deployments must rebuild and redeploy the backend image to enable this server-side enforcement. With an older backend, disconnection relies on the updated desktop client.

To avoid the hosted service, deploy the PalmDesk-compatible backend from [containers](containers/README.md) and configure its addresses on both the desktop and the phone. See [service configuration](docs/SERVICE_CONFIGURATION.md).

## Current Boundaries

- Window capture does not isolate operating-system input. Mouse and keyboard events depend on the foreground window; local interaction and system shortcuts may change focus.
- All `VITE_*` values are public client configuration. Never put a TURN shared secret, database password or API signing key there.
- Use HTTPS for remote access and keep development servers local. Real-window privacy, iOS Safari, cross-network TURN and permission recovery still require acceptance testing.
- Some dependency advisories remain. See the [dependency audit](docs/OPEN_SOURCE_READINESS.md#依赖审计) before distributing binaries or running a public service.
