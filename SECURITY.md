# Security Policy

PalmDesk is an experimental remote-control client. There is no stable release or long-term support branch yet; fixes target `main`.

## Reporting a Vulnerability

Use the repository's **Security > Report a vulnerability** entry when available. The maintainer must enable private vulnerability reporting when creating the public repository. If the entry is unavailable, open an issue requesting a private contact without disclosing the vulnerability details.

Include the affected commit, environment, reproduction steps and impact in the private report. Do not attach real device passwords, TURN credentials, private screenshots or session data.

## Current Boundaries

- Window capture does not isolate OS input. Mouse and keyboard events depend on the foreground window; local interaction and system shortcuts may change focus.
- Device authentication and signaling depend on a separately deployed BilldDesk backend. PalmDesk does not ship a hosted service or a production backend security review.
- All `VITE_*` values are public client configuration. Never use a TURN shared secret, database password or API signing key there.
- Use HTTPS for remote access and keep development servers local. Real-window privacy, iOS Safari, cross-network TURN and permission recovery still require acceptance testing.
- The existing dependency lockfile has known vulnerability advisories. See [release readiness](docs/OPEN_SOURCE_READINESS.md) before distributing binaries or running a public service.
