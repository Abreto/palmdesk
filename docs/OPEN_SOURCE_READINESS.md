# 开源准备记录

检查日期：2026-09-07。仓库：[`Abreto/palmdesk`](https://github.com/Abreto/palmdesk)，已公开并验证匿名可访问。本轮公开范围为实验项目源码；稳定安装包与公共服务另行验收。README 保留实验状态、独立后端要求和已知限制。

## 源码公开准备

- [x] 保留上游 MIT 全文和版权，加入 Abreto 署名。
- [x] README、包信息、应用名称和反馈入口统一为 PalmDesk；保留上游归属说明。
- [x] 写明 macOS 主机限制、外部后端依赖、真实窗口与手机验收缺口。
- [x] 去除开发指南对个人绝对路径和临时后端实例的依赖。
- [x] 扩充环境文件、日志和签名密钥的 Git 忽略规则。
- [x] 加入贡献说明、问题模板、安全报告说明和基础 CI。
- [x] 在代码提交 `f31382a` 上使用 Gitleaks 8.30.1 复查全部可达 Git 历史，工具统计 204 个提交；3 处命中仍为已人工核对的上游旧广告页公开 `cps_key` 推广参数，没有新增命中，未发现真实凭据。
- [x] `f31382a` 的完整源码快照完成 Gitleaks 扫描，未发现凭据。
- [x] 公开前现有 5 次 GitHub Actions 运行日志完成 Gitleaks 扫描，未发现凭据；仓库没有 Actions 附件。
- [x] 首次准备时在干净目录按锁文件安装并验证源码检查；配置允许的安装脚本后完成普通安装，核对 Electron 运行时、esbuild 和 Vue 3 兼容层。本机 Electron 下载需要显式代理。此检查复用了本机 pnpm 缓存，网络下载可用性以无缓存 CI 为准。
- [x] 最新代码 `f31382a` 的 Linux、macOS CI 全部通过：无缓存安装、65 项测试、类型检查、网页构建，以及 macOS 原生辅助程序编译，详见 [CI 运行记录](https://github.com/Abreto/palmdesk/actions/runs/34064178053)。
- [x] 已启用 [private vulnerability reporting](https://github.com/Abreto/palmdesk/security/advisories/new)，并通过 GitHub API 核实。

本地 `build:desktop` 已生成未签名的 `PalmDesk.app`，核对 bundle ID 为 `io.github.abreto.palmdesk`，包内包含项目许可证与归属说明。Playwright 在 1280×900 和 390×844 视口检查了名称、项目/上游链接、设置页宽度和旧入口的冷启动跳转，未出现页面异常；这不替代真实 iOS Safari 或远控验收。

Gitleaks 只做本地扫描，不上传源码。历史扫描没有改写 Git 历史；本次未发现真实凭据不代表完整安全审计已经完成。旧烟测报告和截图保留当时的名称与环境，不能用作新版本验收结果。

## 依赖审计

对代码提交 `f31382a` 的 `pnpm-lock.yaml` 重新运行 `pnpm audit --json --registry=https://registry.npmjs.org`，结果仍为 **5 critical、111 high、107 moderate、23 low**。这些是审计接口报告的依赖告警计数，包括开发工具与传递依赖，不能直接解释为同等数量的可利用产品漏洞。

优先处理项：

| 来源                      | 证据或影响                                                                    | 后续处理                                                   |
| ------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Electron 33.2.1           | 直接依赖存在安全公告，属于主机运行时                                          | 升级到受支持版本，并重新验证窗口捕获、原生输入、权限和打包 |
| Axios 1.4.0               | 直接依赖存在多项公告；其 `form-data` 链出现 critical                          | 升级并回归设备注册、密码校验和请求行为                     |
| `billd-deploy`            | 已无可用部署脚本，传递引入旧云 SDK 与 XML 解析器                              | 确认引用后移除遗留部署依赖                                 |
| 旧图标与发布工具          | `electron-icon-builder`、`standard-version`、`@electron/rebuild` 等引入告警链 | 清理未使用工具，升级仍需要的构建链                         |
| Vue I18n、Vite、js-cookie | 审计直接命中                                                                  | 按运行时和开发时可达性分类升级并验证                       |

critical 公告涉及 [form-data](https://github.com/advisories/GHSA-fjxv-7rqg-78g4)、[fast-xml-parser](https://github.com/advisories/GHSA-m7jm-9gc2-mpf2)、[handlebars](https://github.com/advisories/GHSA-2w6w-674q-4c4q) 和 [tar](https://github.com/advisories/GHSA-23hp-3jrh-7fpw)。本轮报告原件保存在被忽略的 `.local/palmdesk-public-audit.json`，可按上述命令重新生成。本轮不进行未经回归验证的批量依赖升级。

### 2026-10-21 复查（#46）

升级 Electron 33.2.1 → 44.9.3、Vite 6.0.3 → 6.4.5、Axios 1.4.0 → 1.20.0（`form-data` 4.0.6、`follow-redirects` 1.16.1）、Vue I18n 9.9.1 → 11.4.16、Vue 3.5.13 → 3.5.44、socket.io-client 4.8.0 → 4.8.4、js-cookie 3.0.5 → 3.0.8，并在各自版本范围内更新了存在公告的传递依赖。移除从未引用的 `billd-deploy` 和 `vconsole`，`billd-html-webpack-plugin` 只在构建时使用，移入 `devDependencies`。Electron 升级的验证记录见 [Electron 44 升级验证](smoke-artifacts/electron-44-upgrade-2026-10-21.md)。

| 审计范围 | `cd366c1`（升级前） | 升级后 |
| --- | --- | --- |
| `pnpm audit --prod` | 3 critical、62 high、68 moderate、10 low | 0 critical、1 high（已忽略）、3 moderate |
| `pnpm audit`（含开发工具） | 7 critical、135 high、122 moderate、23 low | 5 critical、59 high、51 moderate、9 low |

剩余生产依赖告警均判断为不可达：

| 公告 | 来源 | 不可达原因 | 处理 |
| --- | --- | --- | --- |
| [GHSA-5c6j-r48x-rmvq](https://github.com/advisories/GHSA-5c6j-r48x-rmvq) serialize-javascript（high） | `billd-utils` 把自己的 Rollup 构建工具链声明为运行时依赖 | 客户端只打包 `billd-utils` 的辅助函数，`rollup-plugin-terser` 从不执行 | 在 `pnpm-workspace.yaml` 的 `auditConfig.ignoreGhsas` 中忽略；移除 `billd-utils` 后删除（#52） |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) esbuild 0.15（moderate） | 同上 | 只影响 esbuild 开发服务器，PalmDesk 不运行它 | 随 #52 移除 |
| [GHSA-x565-32qp-m3vf](https://github.com/advisories/GHSA-x565-32qp-m3vf) phin（moderate） | `@nut-tree-fork/nut-js` → `jimp` | PalmDesk 只用 nut-js 控制鼠标和键盘，从不通过 jimp 下载图片 | 等待 nut-js 更新 |
| [GHSA-5v7r-6r5c-r473](https://github.com/advisories/GHSA-5v7r-6r5c-r473) file-type（moderate） | `@nut-tree-fork/nut-js` → `jimp` | 只在解析 ASF 媒体时触发，PalmDesk 不用 jimp 读取文件 | 等待 nut-js 更新 |

CI 在每个拉取请求上运行 `pnpm audit --prod --audit-level high`，新的 high 或 critical 告警会使检查失败。Dependabot 每周提交 npm、GitHub Actions 和容器基础镜像的更新。pnpm 只解析发布满一天的版本（`minimumReleaseAge`）；`minimumReleaseAgeExclude` 中列出的两个当日安全版本到期后应删除。开发工具链中的告警主要来自 electron-builder 25、standard-version、commitizen 和旧 ESLint 插件，留待 #52 和 #54 清理。

## 安装包与对外服务

- [ ] 处理高风险依赖，重新审计并记录剩余告警的可达性。
- [x] 已替换继承的应用图标；仍需收集完整第三方 LICENSE / NOTICE。
- [ ] 验收真实 Codex / ChatGPT 窗口捕获、系统输入、焦点变化和权限恢复。
- [ ] 验收 iOS Safari、蜂窝网络、断线恢复与强制 TURN 中继。
- [ ] 完成自己的 macOS 签名和公证，再发布面向普通用户的安装包。
- [ ] 对外托管时补齐后端鉴权审查、HTTPS、TURN 短期凭据和资源配额。

手机选窗、Claude Desktop 等普通应用窗口和跨 macOS Spaces 选择已纳入当前实现，实际验证范围见 [中文 README](../README.zh-CN.md#验证边界与计划)。保存目标后自动直达、重连恢复仍属后续计划。
