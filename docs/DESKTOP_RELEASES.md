# 桌面安装包与预发布

当前发行流程用于测试版：macOS 使用本地 ad-hoc 签名，不包含 Developer ID 签名和 Apple 公证；Windows 安装包未签名。系统可能提示或阻止打开。发行证书、自动更新和真实远控验收不包含在此流程中。

## 手动触发 GitHub Actions

1. 将待发布代码及工作流合并到 `main`，确认 `package.json` 中的版本号。
2. 打开仓库 **Actions → Desktop Prerelease → Run workflow**。
3. 选择 `main`，输入与版本号完全对应的标签，例如版本 `0.0.1` 输入 `v0.0.1`，然后运行。
4. 等待三个平台的测试、编译和打包全部成功。最后一个任务会创建公开的 GitHub Prerelease，上传三个安装包及 `SHA256SUMS.txt`，并在运行摘要提供下载页面链接。

也可通过 GitHub CLI 手动触发：

```bash
gh workflow run desktop-release.yml --repo Abreto/palmdesk --ref main -f tag=v0.0.1
```

| 平台                | Runner           | 安装包                               |
| ------------------- | ---------------- | ------------------------------------ |
| macOS Apple Silicon | `macos-15`       | `PalmDesk-<version>-mac-arm64.dmg`   |
| macOS Intel         | `macos-15-intel` | `PalmDesk-<version>-mac-x64.dmg`     |
| Windows x64         | `windows-2022`   | `PalmDesk-<version>-windows-x64.exe` |

两个 Mac 包都在 macOS 15 构建，较早系统尚未验收。Windows 运行时要求 Windows 10 1903 及以上或 Windows 11 x64，并具有可用的 Windows Graphics Capture。

普通 push 和 pull request 不触发此发布流程。工作流固定构建触发时的提交；输入标签必须匹配该提交的版本，已有标签必须指向同一提交。标签不存在时，发布步骤为该提交创建标签。已存在的 Release 不覆盖；发布阶段失败若留下草稿，需先检查和处理该草稿再重跑，或者使用新版本。

构建任务仅有仓库读取权限，发布任务使用 `contents: write` 的内置 `GITHUB_TOKEN`。当前流程不需要额外 PAT、签名证书或 Actions Secrets。所有构建成功后才进入发布任务；临时安装包也会在 Actions Artifacts 中保留 14 天。预发布不会标记为 Latest。

发布前会检查三份安装包的名称、版本和非空文件状态，并生成 SHA256 校验和。macOS 还校验主程序及 Swift 辅助程序架构和应用本地签名，Windows 检查原生辅助程序已包含在包内。

## 本地构建

开发机需要 Node.js 22.16.0 及以上、pnpm 11.19.0。macOS 需要 Xcode Command Line Tools，Windows 使用系统 .NET Framework 4.x 编译器。正常安装依赖，不使用源码检查流水线的 `--ignore-scripts`，以便下载 Electron 并准备运行依赖。

```bash
pnpm install --frozen-lockfile
pnpm dist:mac
```

Windows PowerShell：

```powershell
pnpm install --frozen-lockfile
pnpm dist:win
```

命令会先构建桌面页面与 Electron 主进程，再编译原生辅助程序并生成安装包，本地构建不会上传 GitHub。macOS 构建当前主机架构；Intel 包在 Intel Mac 上构建，Apple Silicon 包在 Apple Silicon Mac 上构建。Windows 输出 x64 安装包。

主工作区的安装包位于 `electron-release/<version>/`。linked worktree 会自动使用隔离的应用名称、bundle ID 和输出子目录，适合开发测试；对外发布使用主工作区或干净 clone 的正式身份。原有 `pnpm build:desktop` 和 `pnpm build:desktop:win` 仍只生成本地应用目录。

## 用户安装与后续发行

用户打开 DMG 并将应用拖入 Applications，或运行 Windows 安装向导，无需安装 Node.js、pnpm 或开发工具。macOS 远控需要屏幕录制和辅助功能权限。默认连接 `https://palmdesk.abreto.icu`；手机网页和桌面端必须使用同一服务，安装包不包含服务端。

CI 的源码检查和打包验证不能替代真实屏幕捕获、键鼠输入、权限恢复、手机及跨网络 TURN 验收。稳定分发前继续处理 [发行前提](OPEN_SOURCE_READINESS.md)，并接入 macOS Developer ID 签名与公证及 Windows 代码签名。证书和私钥只通过 CI 的安全配置提供，不写入仓库或 `VITE_*` 变量。
