# 开源准备记录

检查日期：2026-09-07。目标仓库：`Abreto/palmdesk`。当前先以私有仓库保存和迭代，核心流程完成实机验收后再以实验项目公开；尚未发布安装包。

## 源码公开准备

- [x] 保留上游 MIT 全文和版权，加入 Abreto 署名。
- [x] README、包信息、应用名称和反馈入口统一为 PalmDesk；保留上游归属说明。
- [x] 写明 macOS 主机限制、外部后端依赖、真实窗口与手机验收缺口。
- [x] 去除开发指南对个人绝对路径和临时后端实例的依赖。
- [x] 扩充环境文件、日志和签名密钥的 Git 忽略规则。
- [x] 加入贡献说明、问题模板、安全报告说明和基础 CI。
- [x] Gitleaks 8.30.1 扫描全部可达 Git 历史，工具统计 197 个提交；3 处命中均为上游旧广告页的公开 `cps_key` 推广参数，已人工核对，未发现真实凭据。
- [x] 整理后的当前源码快照完成 Gitleaks 扫描，未发现凭据。
- [x] 整理后的 40 项单元测试、类型检查、网页构建和 macOS 原生辅助程序编译通过。
- [x] 干净目录按锁文件安装并验证源码检查；配置允许的安装脚本后完成普通安装，核对 Electron 运行时、esbuild 和 Vue 3 兼容层。本机 Electron 下载需要显式代理。
- [ ] 确认 CI 在 GitHub 上通过。
- [ ] 切换为公开仓库时启用 private vulnerability reporting。

本地 `build:desktop` 已生成未签名的 `PalmDesk.app`，核对 bundle ID 为 `io.github.abreto.palmdesk`，包内包含项目许可证与归属说明。Playwright 在 1280×900 和 390×844 视口检查了名称、项目/上游链接、设置页宽度和旧入口的冷启动跳转，未出现页面异常；这不替代真实 iOS Safari 或远控验收。

Gitleaks 只做本地扫描，不上传源码。历史扫描没有改写 Git 历史；本次未发现真实凭据不代表完整安全审计已经完成。旧烟测报告和截图保留当时的名称与环境，不能用作新版本验收结果。

## 依赖审计

对现有 `pnpm-lock.yaml` 运行 `pnpm audit --json --registry=https://registry.npmjs.org`，结果为 **5 critical、111 high、107 moderate、23 low**。这些是审计接口报告的依赖告警计数，包括开发工具与传递依赖，不能直接解释为同等数量的可利用产品漏洞。

优先处理项：

| 来源                      | 证据或影响                                                                    | 后续处理                                                   |
| ------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Electron 33.2.1           | 直接依赖存在安全公告，属于主机运行时                                          | 升级到受支持版本，并重新验证窗口捕获、原生输入、权限和打包 |
| Axios 1.4.0               | 直接依赖存在多项公告；其 `form-data` 链出现 critical                          | 升级并回归设备注册、密码校验和请求行为                     |
| `billd-deploy`            | 已无可用部署脚本，传递引入旧云 SDK 与 XML 解析器                              | 确认引用后移除遗留部署依赖                                 |
| 旧图标与发布工具          | `electron-icon-builder`、`standard-version`、`@electron/rebuild` 等引入告警链 | 清理未使用工具，升级仍需要的构建链                         |
| Vue I18n、Vite、js-cookie | 审计直接命中                                                                  | 按运行时和开发时可达性分类升级并验证                       |

critical 公告涉及 [form-data](https://github.com/advisories/GHSA-fjxv-7rqg-78g4)、[fast-xml-parser](https://github.com/advisories/GHSA-m7jm-9gc2-mpf2)、[handlebars](https://github.com/advisories/GHSA-2w6w-674q-4c4q) 和 [tar](https://github.com/advisories/GHSA-23hp-3jrh-7fpw)。报告原件保存在被忽略的 `.local/open-source-audit.json`，可按上述命令重新生成。本轮不进行未经回归验证的批量依赖升级。

## 安装包与对外服务

- [ ] 处理高风险依赖，重新审计并记录剩余告警的可达性。
- [ ] 替换继承的应用图标或核实独立许可，收集完整第三方 LICENSE / NOTICE。
- [ ] 验收真实 Codex / ChatGPT 窗口捕获、系统输入、焦点变化和权限恢复。
- [ ] 验收 iOS Safari、蜂窝网络、断线恢复与强制 TURN 中继。
- [ ] 完成自己的 macOS 签名和公证，再发布面向普通用户的安装包。
- [ ] 对外托管时补齐后端鉴权审查、HTTPS、TURN 短期凭据和资源配额。

自动进入上次目标窗口、Claude Desktop 和任意窗口选择是后续产品能力，不作为当前已完成功能宣传。
