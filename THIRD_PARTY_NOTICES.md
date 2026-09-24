# Third-Party Notices

## BilldDesk

PalmDesk is derived from the open-source [BilldDesk](https://github.com/galaxy-s10/billd-desk) client. Its upstream source, copyright notice and MIT license are retained in [LICENSE.txt](LICENSE.txt). The original documentation is preserved in `README_OpenSource.md`, `doc/` and `readme_img/`; those product and contact details belong to upstream.

BilldDesk Pro is a separate upstream product. Its feature lists and download links are not PalmDesk releases or features.

## Dependencies and Assets

The `session-core/` module includes Glassline's Codex parser, session registry, Markdown renderer and tests, imported from commit `63f7d3dd67f723f6f20fe3c91b8e04a725e3bfce` and subsequently maintained in PalmDesk. Glassline is copyright Abreto and licensed under Apache-2.0; its [LICENSE](session-core/LICENSE) and [NOTICE](session-core/NOTICE) are retained. PalmDesk's MIT license does not replace the license of these files.

Dependencies retain their own licenses; PalmDesk's MIT license does not replace them. Direct dependencies currently declare MIT, Apache-2.0, or a dual license including MIT. In particular, the nut.js packages declare Apache-2.0, and the Ionicons components provided by `@vicons/ionicons5` declare MIT.

The lockfile records exact dependency versions. Before binary distribution, collect the applicable LICENSE and NOTICE files for the complete packaged dependency tree and bundled browser assets, including Electron / Chromium notices. This document is an attribution overview, not a complete binary license bundle.

Legacy marketing images are inherited from upstream. Their independent provenance has not been verified. PalmDesk's current application icons are original project assets; review any remaining upstream imagery before distributing installers.

OpenAI, Codex, ChatGPT and Claude identify the third-party applications the project works with or plans to support. PalmDesk is independently maintained and is not an official product of those vendors.
