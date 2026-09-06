# Contributing to PalmDesk

PalmDesk is an experimental project maintained by [Abreto](https://github.com/Abreto), based on [BilldDesk](https://github.com/galaxy-s10/billd-desk). Upstream contributors include [galaxy-s10](https://github.com/galaxy-s10) and [xiaolu289](https://github.com/xiaolu289).

Read the [README](../README.md) and [development guide](../docs/LOCAL_DEVELOPMENT.md) before changing the client. The signaling backend is a separate project.

## Issues and Pull Requests

- Include the commit or version, macOS version, target application, controller browser and reproduction steps.
- Describe the intended behavior and keep each pull request focused on one change.
- Run `pnpm test:smoke`, `pnpm typecheck` and `pnpm build:prod`. For native changes, also run `pnpm build:native` on macOS and describe real-window testing performed.
- State when capture or input was mocked. Do not present synthetic video tests as real-device verification.
- Remove passwords, tokens, device identifiers and private window content from logs and screenshots. Report vulnerabilities according to [SECURITY.md](../SECURITY.md).
- Keep upstream copyright and license notices. Contributions are made under the project's MIT license.
