# 桌面安装包与预发布

当前发行流程用于测试版：从 v0.0.3 起，macOS 使用固定自签名证书，不包含 Developer ID 签名和 Apple 公证；Windows 安装包未签名。系统可能提示或阻止打开。自动更新和真实远控验收不包含在此流程中。

当前使用 `0.0.x` 迭代 Preview；`0.1.0` 保留给完成打磨、可正式分发的里程碑。

## 手动触发 GitHub Actions

1. 将待发布代码及工作流合并到 `main`，确认 `package.json` 中的版本号。
2. 打开仓库 **Actions → Desktop Prerelease → Run workflow**。
3. 选择 `main`，输入与版本号完全对应的标签，例如版本 `0.0.3` 输入 `v0.0.3`，然后运行。
4. 等待两个平台的测试、编译和打包成功。macOS 签名任务使用受保护的 `release` 环境，在运行页面点击 **Review deployments** 批准后才会读取证书。
5. 签名完成后，最后一个任务为安装包生成构建来源证明（provenance）和 SBOM 证明，创建公开的 GitHub Prerelease，上传两个安装包、CycloneDX SBOM 及 `SHA256SUMS.txt`，在运行摘要提供下载页面链接，并为该标签发布带版本号的[容器镜像](../containers/README.md)。

也可通过 GitHub CLI 手动触发：

```bash
gh workflow run desktop-release.yml --repo Abreto/palmdesk --ref main -f tag=v0.0.3
```

| 平台                | Runner         | 安装包                               |
| ------------------- | -------------- | ------------------------------------ |
| macOS Apple Silicon | `macos-15`     | `PalmDesk-<version>-mac-arm64.dmg`   |
| Windows x64         | `windows-2022` | `PalmDesk-<version>-windows-x64.exe` |

当前预发布仅支持 Apple Silicon Mac 和 Windows x64，不提供 Intel Mac 安装包。Mac 包在 macOS 15 构建，较早系统尚未验收。Windows 运行时要求 Windows 10 1903 及以上或 Windows 11 x64，并具有可用的 Windows Graphics Capture。

普通 push 和 pull request 不触发此发布流程。工作流固定构建触发时的提交；输入标签必须匹配该提交的版本，已有标签必须指向同一提交。标签不存在时，发布步骤为该提交创建标签。已存在的 Release 不覆盖；发布阶段失败若留下草稿，需先检查和处理该草稿再重跑，或者使用新版本。

构建任务仅有仓库读取权限，会安装全部依赖并运行其安装脚本，因此拿不到签名证书。macOS 应用在构建任务中保持未签名，连同 electron-builder 生成的 DMG Finder 布局作为临时 Artifact 交给签名任务。签名任务只在 `release` 环境中运行，不安装任何包，只运行仅依赖 Node.js 内置模块的仓库脚本、macOS 系统工具和固定到提交 SHA 的 GitHub Actions。发布任务的内置 `GITHUB_TOKEN` 具有 `contents: write`、`attestations: write`、`id-token: write`，以及用于触发镜像工作流的 `actions: write`，不需要额外 PAT。所有构建和签名成功后才进入发布任务；安装包也会在 Actions Artifacts 中保留 14 天，未签名的应用保留 3 天。预发布不会标记为 Latest。

所有工作流的 `uses:` 都固定到完整提交 SHA，并在注释中标明版本；升级 Action 时须同时更新两者。`test/smoke/release-workflows.test.cjs` 检查固定方式、签名 Secrets 的使用范围和证明步骤。

发布前会检查两份安装包及 SBOM 的名称、版本和非空文件状态，并生成 SHA256 校验和。macOS 签名任务在导入证书前解压并检查未签名应用：只接受预期的文件，符号链接不得指向应用之外，并核对 bundle ID、发行渠道和架构。签名后校验签名完整性、主应用及各辅助进程的固定证书和稳定 designated requirement，再用 `hdiutil` 按原有 Finder 布局重建 DMG 并挂载复核。Windows 检查原生辅助程序已包含在包内。签名烟测会编译并签署两个内容不同的测试应用，验证新版主程序和原生辅助程序仍满足旧版签名身份。

### 校验下载文件

```bash
gh attestation verify PalmDesk-<version>-mac-arm64.dmg --repo Abreto/palmdesk
gh attestation verify PalmDesk-<version>-mac-arm64.dmg --repo Abreto/palmdesk --predicate-type https://cyclonedx.org/bom
```

第一条确认文件由本仓库的 Desktop Prerelease 工作流生成，第二条确认对应的 SBOM 证明；Windows 安装包、SBOM 本身同样适用第一条。SBOM 由 `pnpm sbom` 从锁文件生成，包含构建工具在内的全部锁定依赖。

## 固定 macOS 签名

`build/macos-signing.json` 只保存公开证书名称、SHA-1 / SHA-256 指纹和可选的到期日。正式身份的 `--release` 构建必须使用这一证书，不允许退回 ad-hoc 或自动选择其他证书。原生窗口辅助程序固定使用 `<应用 bundle ID>.window-helper`，避免编译器生成的 UUID 改变签名标识。

在仓库 **Settings → Environments** 中创建 `release` 环境：

- 在 **Required reviewers** 中添加发布负责人；
- 将 **Deployment branches and tags** 限制为 `main`；
- 在 **Environment secrets** 中配置下表两项，然后删除同名的仓库级 Actions Secrets，否则其他任务仍可引用它们。

| Secret                      | 内容                                         |
| --------------------------- | -------------------------------------------- |
| `PALMDESK_SIGNING_P12`      | 含原始证书和私钥的 `.p12` 文件的 Base64 编码 |
| `PALMDESK_SIGNING_PASSWORD` | `.p12` 导出密码                              |

Base64 只是编码，必须存为 Secret。原始 `.p12`、密码和到期日保存在 1Password；不要提交私钥或密码。换构建机时恢复原证书，不重新生成同名证书。若确需更换证书，同时更新固定指纹并说明用户可能需要重新授权。

签名任务将证书导入随机密码保护的临时钥匙串：`.p12` 密码经 `security -i` 的标准输入传入，不出现在进程参数中；私钥导入后不可导出，只信任该证书的代码签名用途。CI 仅支持一次性 GitHub 托管 runner：通过非交互管理员命令配置公开证书信任，随虚拟机销毁清除，避免 macOS 移除信任时等待 GUI 授权。签名结束或构建失败后，清理步骤恢复钥匙串搜索列表、删除含私钥的临时钥匙串和文件；自托管 runner 会在导入前被拒绝。证书与密码不进入构建产物，也不提供给构建任务或 Windows 构建。

从 v0.0.2 及更早 ad-hoc 版本升级到固定证书时，可能需要重新授予屏幕录制及辅助功能权限一次。后续签名身份保持稳定，但 CI 校验不能替代真实 macOS 升级授权测试。自签名仍不满足 Gatekeeper 的 Developer ID 和公证要求。

### 证书到期与轮换

签名任务在运行摘要中写出证书到期日，剩余不足 180 天时给出警告，证书过期后停止签名。可在 `build/macos-signing.json` 中以 `"notAfter": "YYYY-MM-DD"`（UTC）记录到期日，签名任务会核对它与实际证书一致；到期日可从 1Password 中的证书或运行摘要读取。

自签名证书无法撤销。macOS 的屏幕录制和辅助功能授权绑定在包含证书指纹的 designated requirement 上，更换证书后用户需要重新授权一次。轮换步骤：

1. 至少提前一个发行周期生成新的自签名代码签名证书，与密码一起保存到 1Password。
2. 更新 `build/macos-signing.json` 中的名称、SHA-1、SHA-256 和 `notAfter`，并替换 `release` 环境中的两项 Secrets。
3. 在发行说明中提示用户升级后重新授予两项权限，做法同 v0.0.3 从 ad-hoc 签名迁移时的说明。
4. 若私钥可能泄露，立即删除环境 Secrets，按以上步骤换用新证书，并通过安全公告说明受影响的版本。

### 本机发布构建

本机发布构建前，将同一证书及私钥导入钥匙串，并在证书信任设置中允许代码签名。`pnpm dist:mac --release` 会按固定指纹选取它，并与 CI 一样由 `scripts/macos-codesign.cjs` 签名；使用独立钥匙串时可指定 `CSC_KEYCHAIN`。自签名不使用 Apple 团队标识自动填充、公证或时间戳服务。

## 本地构建

开发机需要 Node.js 22.16.0 及以上、pnpm 11.19.0。macOS 需要 Xcode Command Line Tools，Windows 使用系统 .NET Framework 4.x 编译器。正常安装依赖，不使用源码检查流水线的 `--ignore-scripts`，以便下载 Electron 并准备运行依赖。

```bash
pnpm install --frozen-lockfile
pnpm dist:mac --release
```

Windows PowerShell：

```powershell
pnpm install --frozen-lockfile
pnpm dist:win --release
```

命令会先构建桌面页面与 Electron 主进程，再编译原生辅助程序并生成安装包，本地构建不会上传 GitHub。macOS 请在 Apple Silicon Mac 上构建；Intel Mac 安装包暂不支持。Windows 输出 x64 安装包。

`--release` 显式选择固定的正式身份 `io.github.abreto.palmdesk`（PalmDesk），产物位于 `electron-release/<version>/`；从主工作区、clone 或 linked worktree 执行结果一致。GitHub Actions 同样显式传入该参数，并检查 macOS 包的正式 bundle ID。

本地开发测试请省略 `--release`。`pnpm dist:mac`、`pnpm dist:win` 和 `pnpm build:desktop` 默认使用当前工作区独立的应用名称及 bundle ID：主工作区或普通 clone 的产物位于 `electron-release/<version>/local-<id>/`，linked worktree 位于 `electron-release/<version>/worktree-<id>/`，权限及配置与正式版隔离。`build:desktop` 和 `build:desktop:win` 只生成本地应用目录。身份规则及旧开发包的迁移步骤见 [本地开发](LOCAL_DEVELOPMENT.md#应用身份)。

## 用户安装与后续发行

用户打开 DMG 并将应用拖入 Applications，或运行 Windows 安装向导，无需安装 Node.js、pnpm 或开发工具。macOS 远控需要屏幕录制和辅助功能权限。默认连接 `https://palmdesk.abreto.icu`；手机网页和桌面端必须使用同一服务，安装包不包含服务端。

CI 的源码检查和打包验证不能替代真实屏幕捕获、键鼠输入、权限恢复、手机及跨网络 TURN 验收。稳定分发前继续处理 [发行前提](OPEN_SOURCE_READINESS.md)，并接入 macOS Developer ID 签名与公证及 Windows 代码签名。证书和私钥只通过 CI 的安全配置提供，不写入仓库或 `VITE_*` 变量。
