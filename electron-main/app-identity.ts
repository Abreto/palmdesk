import { realpathSync } from 'node:fs';

export interface ApplicationIdentity {
  bundleId: string;
  bundlePath: string;
  executablePath: string;
  registeredPaths: string[];
}

export function assertUniqueApplicationIdentity(
  identity: ApplicationIdentity,
  executable: string,
  packaged: boolean
) {
  if (
    !/^io\.github\.abreto\.palmdesk(?:\.worktree\.[a-f0-9]{10})?(?:\.dev)?$/.test(
      identity.bundleId
    ) ||
    identity.bundleId.endsWith('.dev') === packaged ||
    realpathSync(identity.executablePath) !== realpathSync(executable)
  ) {
    throw new Error('应用身份与当前进程不一致，请重新构建 PalmDesk 后启动。');
  }
  const current = realpathSync(identity.bundlePath);
  const conflicts = [
    ...new Set(identity.registeredPaths.map((item) => realpathSync(item))),
  ].filter((item) => item !== current);
  if (conflicts.length) {
    throw new Error(
      `macOS 为 ${identity.bundleId} 注册了多个应用副本，无法确定权限归属。\n\n当前应用：\n${current}\n\n冲突副本：\n${conflicts.join('\n')}\n\n请归档并移除冲突副本、清理其 LaunchServices 注册，然后重新启动。`
    );
  }
}
