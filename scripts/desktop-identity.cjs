const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, realpathSync } = require('node:fs');
const path = require('node:path');

function getDesktopIdentity(
  root,
  { development = false, release = false } = {}
) {
  if (release) {
    if (development)
      throw new Error('A development runtime cannot use the release identity.');
    return {
      appId: 'io.github.abreto.palmdesk',
      productName: 'PalmDesk',
      checkoutId: '',
      worktreeId: '',
    };
  }
  let identityDirectory = realpathSync(root);
  let linkedWorktree = false;
  if (existsSync(path.join(root, '.git'))) {
    const directories = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
      .trim()
      .split(/\r?\n/);
    if (directories.length !== 2)
      throw new Error('Cannot determine the desktop build identity.');
    const [gitDir, commonDir] = directories.map((directory) =>
      realpathSync(directory)
    );
    identityDirectory = gitDir;
    linkedWorktree = gitDir !== commonDir;
  }
  // Git directories survive branch changes and linked worktree moves.
  const checkoutId = createHash('sha256')
    .update(identityDirectory)
    .digest('hex')
    .slice(0, 10);
  const worktreeId = linkedWorktree ? checkoutId : '';
  const baseId = `io.github.abreto.palmdesk.${linkedWorktree ? 'worktree' : 'local'}.${checkoutId}`;
  const baseName = `PalmDesk ${linkedWorktree ? 'WT' : 'Local'} ${checkoutId}`;
  return {
    appId: `${baseId}${development ? '.dev' : ''}`,
    productName: `${baseName}${development ? ' Dev' : ''}`,
    checkoutId,
    worktreeId,
  };
}

module.exports = { getDesktopIdentity };
