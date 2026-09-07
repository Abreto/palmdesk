const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { getDesktopIdentity } = require('./desktop-identity.cjs');

function readAppId(bundle) {
  const plist = JSON.parse(
    execFileSync(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
  );
  return plist.CFBundleIdentifier;
}

function findLegacyApps(root) {
  if (!existsSync(path.join(root, '.git'))) return [];
  const worktrees = execFileSync(
    'git',
    ['worktree', 'list', '--porcelain', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
    .split('\0')
    .filter((field) => field.startsWith('worktree '))
    .map((field) => field.slice('worktree '.length));
  const legacy = [];
  for (const worktree of worktrees) {
    if (!existsSync(worktree)) continue;
    function scan(current) {
      if (!existsSync(current)) return;
      // Renaming an app to .app.disabled does not retire its system identity.
      if (existsSync(path.join(current, 'Contents/Info.plist'))) {
        const actual = readAppId(current);
        if (
          /^io\.github\.abreto\.palmdesk(?:\.worktree\.[a-f0-9]{10})?(?:\.dev)?$/.test(
            actual
          )
        ) {
          const expected = getDesktopIdentity(worktree, {
            development: actual.endsWith('.dev'),
          });
          if (actual !== expected.appId)
            legacy.push({ bundle: current, actual, expected: expected.appId });
        }
        return;
      }
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (
          !entry.isDirectory() ||
          ['node_modules', '.git', 'swift-cache'].includes(entry.name)
        )
          continue;
        scan(path.join(current, entry.name));
      }
    }
    scan(path.join(worktree, 'electron-release'));
    scan(path.join(worktree, '.local'));
  }
  return legacy;
}

function checkDesktopIdentity(root) {
  if (process.platform !== 'darwin') return;
  const legacy = findLegacyApps(root);
  if (legacy.length) {
    throw new Error(
      "Legacy desktop apps still use another checkout's identity. Archive and remove these .app bundles, then unregister them from LaunchServices (see docs/LOCAL_DEVELOPMENT.md):\n" +
        legacy
          .map(
            ({ bundle, actual, expected }) =>
              `  ${bundle}\n    ${actual} -> ${expected}`
          )
          .join('\n')
    );
  }
}

if (require.main === module) {
  try {
    checkDesktopIdentity(path.resolve(__dirname, '..'));
    console.log('No legacy desktop identity conflicts in the Git worktrees.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { findLegacyApps, checkDesktopIdentity };
