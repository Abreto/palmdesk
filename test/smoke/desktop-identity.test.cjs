const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getDesktopIdentity } = require('../../scripts/desktop-identity.cjs');
const { findLegacyApps } = require('../../scripts/check-desktop-identity.cjs');

let temporary;
let main;
let first;
let second;
function git(root, ...args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
test.before(() => {
  temporary = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'palmdesk-identity-'))
  );
  main = path.join(temporary, 'main checkout');
  first = path.join(temporary, 'worktree one');
  second = path.join(temporary, 'worktree two');
  mkdirSync(main);
  git(main, 'init', '-b', 'main');
  git(
    main,
    '-c',
    'user.name=Identity Test',
    '-c',
    'user.email=identity@example.invalid',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    'Initial test commit'
  );
  git(main, 'worktree', 'add', '--detach', first);
  git(main, 'worktree', 'add', '--detach', second);
});
test.after(() => rmSync(temporary, { recursive: true, force: true }));

test('the primary checkout retains the production identity and separates development', () => {
  assert.deepEqual(getDesktopIdentity(main), {
    appId: 'io.github.abreto.palmdesk',
    productName: 'PalmDesk',
    worktreeId: '',
  });
  assert.equal(
    getDesktopIdentity(main, { development: true }).appId,
    'io.github.abreto.palmdesk.dev'
  );
  assert.equal(
    getDesktopIdentity(main, { development: true }).productName,
    'PalmDesk Dev'
  );
});

test('different worktrees and build modes have distinct app IDs and names', () => {
  const identities = [
    getDesktopIdentity(main),
    getDesktopIdentity(first),
    getDesktopIdentity(second),
    getDesktopIdentity(first, { development: true }),
    getDesktopIdentity(second, { development: true }),
  ];
  assert.equal(
    new Set(identities.map((identity) => identity.appId)).size,
    identities.length
  );
  assert.equal(
    new Set(identities.map((identity) => identity.productName)).size,
    identities.length
  );
  assert.match(
    identities[1].appId,
    /^io\.github\.abreto\.palmdesk\.worktree\.[a-f0-9]{10}$/
  );
  assert.deepEqual(getDesktopIdentity(first), identities[1]);
});

test('changing branches and moving a worktree preserves its permission identity', () => {
  const before = getDesktopIdentity(first);
  git(first, 'checkout', '-b', 'identity-test');
  assert.deepEqual(getDesktopIdentity(first), before);
  const moved = path.join(temporary, 'moved worktree');
  git(main, 'worktree', 'move', first, moved);
  first = moved;
  assert.deepEqual(getDesktopIdentity(first), before);
  const alias = path.join(temporary, 'worktree alias');
  symlinkSync(first, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(getDesktopIdentity(alias), before);
});

test('source archives use the primary identity but broken Git metadata fails the build', () => {
  const archive = path.join(temporary, 'archive');
  mkdirSync(archive);
  assert.equal(getDesktopIdentity(archive).appId, 'io.github.abreto.palmdesk');
  writeFileSync(
    path.join(archive, '.git'),
    'gitdir: /nonexistent-palmdesk-git-directory\n'
  );
  assert.throws(() => getDesktopIdentity(archive));
});

test('packaging embeds the same isolated identity in its bundle and runtime metadata', () => {
  const root = path.resolve(__dirname, '../..');
  const expected = getDesktopIdentity(root);
  const config = require('../../electron-builder.cjs');
  assert.equal(config.appId, expected.appId);
  assert.equal(config.productName, expected.productName);
  assert.equal(config.extraMetadata.productName, expected.productName);
});

test(
  'build preflight finds old app artifacts even when their worktree source has not been upgraded',
  { skip: process.platform !== 'darwin' },
  () => {
    function bundle(root, relative, appId) {
      const directory = path.join(root, relative);
      mkdirSync(path.join(directory, 'Contents'), { recursive: true });
      writeFileSync(
        path.join(directory, 'Contents/Info.plist'),
        JSON.stringify({ CFBundleIdentifier: appId })
      );
      return directory;
    }
    const release = 'electron-release/0.0.1/mac-arm64/PalmDesk.app';
    bundle(main, release, getDesktopIdentity(main).appId);
    const legacy = bundle(first, release, getDesktopIdentity(main).appId);
    const renamed = bundle(
      first,
      '.local/PalmDesk-before-isolation.app.disabled',
      getDesktopIdentity(main).appId
    );
    bundle(
      first,
      '.local/FocusFixture.app',
      'io.github.abreto.palmdesk.focus-fixture'
    );
    const isolated = getDesktopIdentity(first);
    bundle(
      first,
      `electron-release/0.0.1/worktree-${isolated.worktreeId}/PalmDesk.app`,
      isolated.appId
    );
    bundle(second, release, getDesktopIdentity(second).appId);
    const development = bundle(
      second,
      '.local/electron-dev/Electron.app',
      getDesktopIdentity(main, { development: true }).appId
    );

    assert.deepEqual(findLegacyApps(main), [
      {
        bundle: legacy,
        actual: getDesktopIdentity(main).appId,
        expected: isolated.appId,
      },
      {
        bundle: renamed,
        actual: getDesktopIdentity(main).appId,
        expected: isolated.appId,
      },
      {
        bundle: development,
        actual: getDesktopIdentity(main, { development: true }).appId,
        expected: getDesktopIdentity(second, { development: true }).appId,
      },
    ]);
    rmSync(legacy, { recursive: true });
    rmSync(renamed, { recursive: true });
    rmSync(development, { recursive: true });
    assert.deepEqual(findLegacyApps(main), []);
  }
);
