# Session core

PalmDesk maintains this read-only module. It has no Electron, HTTP server or agent execution dependency. `index.mjs` is the bounded reading API; `index.d.mts` defines the data sent to the controller. The desktop integration currently enables Codex reading on macOS only.

The parser, registry, Markdown renderer and their original tests were imported from [Glassline](https://github.com/Abreto/glassline) commit `63f7d3dd67f723f6f20fe3c91b8e04a725e3bfce`. Their Apache-2.0 [LICENSE](LICENSE) and [NOTICE](NOTICE) are retained. PalmDesk changes include the public reading facade, bounded wire representations, a 32 MiB detail-file limit, incomplete Markdown marker handling and subsequent parser fixes recorded in this repository's history.

The module is maintained in this repository, with no separately deployed Glassline service or separately published package. `src/` uses Node built-ins; `public/timeline-renderers.js` is a separate browser entry and does not import the filesystem adapters. The controller must not import the Node entry at runtime.

Run `pnpm test:session-core` from the repository root. All fixtures are synthetic. The imported raw-session and resume-reference parsing helpers are internal; PalmDesk exposes only session listing and paginated reading, with no raw-file, follow-up or command execution endpoint.
