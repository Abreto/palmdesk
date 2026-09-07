const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, realpathSync } = require('node:fs');
const path = require('node:path');

function getDesktopIdentity(root, { development = false } = {}) {
  let worktreeId = '';
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
    if (gitDir !== commonDir) {
      // The worktree's Git directory survives branch changes and worktree moves.
      worktreeId = createHash('sha256')
        .update(gitDir)
        .digest('hex')
        .slice(0, 10);
    }
  }
  const baseId = `io.github.abreto.palmdesk${worktreeId ? `.worktree.${worktreeId}` : ''}`;
  const baseName = `PalmDesk${worktreeId ? ` WT ${worktreeId}` : ''}`;
  return {
    appId: `${baseId}${development ? '.dev' : ''}`,
    productName: `${baseName}${development ? ' Dev' : ''}`,
    worktreeId,
  };
}

module.exports = { getDesktopIdentity };
