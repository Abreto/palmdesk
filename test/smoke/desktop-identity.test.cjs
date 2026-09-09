const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  copyFileSync,
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
let clone;
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
  clone = path.join(temporary, 'separate clone');
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
  git(temporary, 'clone', '--local', main, clone);
});
test.after(() => rmSync(temporary, { recursive: true, force: true }));

test('the primary checkout isolates local packages and development from the release', () => {
  const packaged = getDesktopIdentity(main);
  assert.match(
    packaged.appId,
    /^io\.github\.abreto\.palmdesk\.local\.[a-f0-9]{10}$/
  );
  assert.equal(packaged.productName, `PalmDesk Local ${packaged.checkoutId}`);
  assert.equal(packaged.worktreeId, '');
  assert.equal(
    getDesktopIdentity(main, { development: true }).appId,
    `${packaged.appId}.dev`
  );
  assert.equal(
    getDesktopIdentity(main, { development: true }).productName,
    `${packaged.productName} Dev`
  );
});

test('checkouts, clones and build modes have distinct app IDs and names', () => {
  const identities = [
    getDesktopIdentity(main),
    getDesktopIdentity(first),
    getDesktopIdentity(second),
    getDesktopIdentity(clone),
    getDesktopIdentity(main, { development: true }),
    getDesktopIdentity(first, { development: true }),
    getDesktopIdentity(second, { development: true }),
    getDesktopIdentity(clone, { development: true }),
    getDesktopIdentity(main, { release: true }),
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

test('only explicit release builds use the same production identity in every checkout', () => {
  for (const checkout of [main, first, second, clone]) {
    assert.deepEqual(getDesktopIdentity(checkout, { release: true }), {
      appId: 'io.github.abreto.palmdesk',
      productName: 'PalmDesk',
      checkoutId: '',
      worktreeId: '',
    });
    assert.throws(
      () => getDesktopIdentity(checkout, { release: true, development: true }),
      /development runtime cannot use the release identity/
    );
  }
});

test('branch changes and path aliases preserve the main checkout identity', () => {
  const before = getDesktopIdentity(main);
  git(main, 'checkout', '-b', 'main-identity-test');
  assert.deepEqual(getDesktopIdentity(main), before);
  const alias = path.join(temporary, 'main alias');
  symlinkSync(main, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(getDesktopIdentity(alias), before);
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

test('source archives get isolated local identities but broken Git metadata fails the build', () => {
  const archive = path.join(temporary, 'archive');
  const another = path.join(temporary, 'another archive');
  mkdirSync(archive);
  mkdirSync(another);
  assert.match(
    getDesktopIdentity(archive).appId,
    /^io\.github\.abreto\.palmdesk\.local\.[a-f0-9]{10}$/
  );
  assert.notEqual(
    getDesktopIdentity(archive).appId,
    getDesktopIdentity(another).appId
  );
  assert.equal(
    getDesktopIdentity(archive, { release: true }).appId,
    'io.github.abreto.palmdesk'
  );
  writeFileSync(
    path.join(archive, '.git'),
    'gitdir: /nonexistent-palmdesk-git-directory\n'
  );
  assert.throws(() => getDesktopIdentity(archive));
});

test('builder configuration isolates local artifacts and reserves the production metadata for releases', () => {
  const source = path.resolve(__dirname, '../..');
  for (const checkout of [main, first, clone]) {
    mkdirSync(path.join(checkout, 'scripts'));
    for (const filename of [
      'electron-builder.cjs',
      'scripts/desktop-identity.cjs',
    ])
      copyFileSync(path.join(source, filename), path.join(checkout, filename));
    for (const channel of ['local', 'release']) {
      const expected = getDesktopIdentity(checkout, {
        release: channel === 'release',
      });
      const config = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '-e',
            'process.stdout.write(JSON.stringify(require(process.argv[1])))',
            path.join(checkout, 'electron-builder.cjs'),
          ],
          {
            encoding: 'utf8',
            env: { ...process.env, PALMDESK_BUILD_CHANNEL: channel },
          }
        )
      );
      assert.equal(config.appId, expected.appId);
      assert.equal(config.productName, expected.productName);
      assert.equal(config.extraMetadata.productName, expected.productName);
      assert.equal(config.mac.extendInfo.PalmDeskBuildChannel, channel);
      assert.equal(
        config.directories.output,
        channel === 'release'
          ? 'electron-release/${version}'
          : `electron-release/\${version}/${expected.worktreeId ? 'worktree' : 'local'}-${expected.checkoutId}`
      );
    }
  }
});

test(
  'build preflight finds old app artifacts even when their worktree source has not been upgraded',
  { skip: process.platform !== 'darwin' },
  () => {
    function bundle(root, relative, appId, extra = {}) {
      const directory = path.join(root, relative);
      mkdirSync(path.join(directory, 'Contents'), { recursive: true });
      writeFileSync(
        path.join(directory, 'Contents/Info.plist'),
        JSON.stringify({ CFBundleIdentifier: appId, ...extra })
      );
      return directory;
    }
    const release = 'electron-release/0.0.1/mac-arm64/PalmDesk.app';
    const productionId = getDesktopIdentity(main, { release: true }).appId;
    const legacyMain = bundle(main, release, productionId);
    const legacyMainDev = bundle(
      main,
      '.local/electron-dev/Electron.app',
      `${productionId}.dev`
    );
    for (const checkout of [main, first])
      bundle(
        checkout,
        'electron-release/0.0.2/mac-arm64/PalmDesk.app',
        productionId,
        {
          PalmDeskBuildChannel: 'release',
        }
      );
    const legacy = bundle(first, release, productionId);
    const renamed = bundle(
      first,
      '.local/PalmDesk-before-isolation.app.disabled',
      productionId
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
        bundle: legacyMain,
        actual: productionId,
        expected: getDesktopIdentity(main).appId,
      },
      {
        bundle: legacyMainDev,
        actual: `${productionId}.dev`,
        expected: getDesktopIdentity(main, { development: true }).appId,
      },
      {
        bundle: legacy,
        actual: productionId,
        expected: isolated.appId,
      },
      {
        bundle: renamed,
        actual: productionId,
        expected: isolated.appId,
      },
      {
        bundle: development,
        actual: getDesktopIdentity(main, { development: true }).appId,
        expected: getDesktopIdentity(second, { development: true }).appId,
      },
    ]);
    rmSync(legacyMain, { recursive: true });
    rmSync(legacyMainDev, { recursive: true });
    rmSync(legacy, { recursive: true });
    rmSync(renamed, { recursive: true });
    rmSync(development, { recursive: true });
    assert.deepEqual(findLegacyApps(main), []);
  }
);
