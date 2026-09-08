const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  validateRelease,
  prepareReleaseAssets,
} = require('../../scripts/desktop-release.cjs');

const manifest = { version: '0.1.0-beta.1', productName: 'PalmDesk' };

function directory(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'palmdesk release '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function repository(t) {
  const root = directory(t);
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=Release Test',
        '-c',
        'user.email=release@example.invalid',
        ...args,
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
  git('init', '-b', 'main');
  git('commit', '--allow-empty', '--no-gpg-sign', '-m', 'Release fixture');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  return { root, git, commit: git('rev-parse', 'HEAD') };
}

function assets(t) {
  const root = directory(t);
  const config = require('../../electron-builder.cjs');
  const names = [
    [config.mac.artifactName, 'arm64', 'dmg'],
    [config.win.artifactName, 'x64', 'exe'],
  ].map(([pattern, arch, ext]) =>
    pattern.replace(
      /\$\{(productName|version|arch|ext)\}/g,
      (_, key) => ({ ...manifest, arch, ext })[key]
    )
  );
  for (const name of names)
    writeFileSync(path.join(root, name), `fixture ${name}`);
  return { root, names };
}

test('release accepts an exact package version and a new tag', (t) => {
  const { root, commit } = repository(t);
  assert.deepEqual(validateRelease(root, 'v0.1.0-beta.1', commit), {
    version: manifest.version,
    tag: 'v0.1.0-beta.1',
    commit,
  });
});

for (const tag of ['0.1.0-beta.1', 'v0.0.1', 'v0.1.0-beta.1\nvalue=injected']) {
  test(`release rejects a mismatched tag ${JSON.stringify(tag)}`, (t) => {
    const { root, commit } = repository(t);
    assert.throws(
      () => validateRelease(root, tag, commit),
      /match package.json/
    );
  });
}

test('release rejects checkout drift', (t) => {
  const { root } = repository(t);
  assert.throws(
    () => validateRelease(root, 'v0.1.0-beta.1', '0'.repeat(40)),
    /workflow commit/
  );
});

for (const annotated of [false, true]) {
  test(`release accepts an existing ${annotated ? 'annotated' : 'lightweight'} tag only at the build commit`, (t) => {
    const { root, git, commit } = repository(t);
    const tag = 'v0.1.0-beta.1';
    git('tag', '--no-sign', ...(annotated ? ['-a', '-m', 'Preview'] : []), tag);
    assert.equal(validateRelease(root, tag, commit).commit, commit);
    git('commit', '--allow-empty', '--no-gpg-sign', '-m', 'Newer source');
    assert.throws(
      () => validateRelease(root, tag, git('rev-parse', 'HEAD')),
      /different commit/
    );
  });
}

test('release assets match the builder names and include verifiable SHA256 hashes', async (t) => {
  const { root, names } = assets(t);
  assert.deepEqual(await prepareReleaseAssets(root, manifest), names);
  const checksums = readFileSync(path.join(root, 'SHA256SUMS.txt'), 'utf8');
  for (const name of names) {
    const digest = createHash('sha256').update(`fixture ${name}`).digest('hex');
    assert.ok(checksums.includes(`${digest}  ${name}\n`));
  }
  assert.equal(checksums.trim().split('\n').length, 2);
});

for (const kind of [
  'missing',
  'wrong version',
  'extra installer',
  'Intel Mac installer',
  'empty',
  'directory',
]) {
  test(`release refuses ${kind} assets before writing checksums`, async (t) => {
    const { root, names } = assets(t);
    const filename = path.join(root, names[0]);
    if (kind === 'missing') rmSync(filename);
    if (kind === 'wrong version') {
      rmSync(filename);
      writeFileSync(
        path.join(root, 'PalmDesk-0.0.1-mac-arm64.dmg'),
        'old build'
      );
    }
    if (kind === 'extra installer')
      writeFileSync(path.join(root, 'extra.exe'), 'extra');
    if (kind === 'Intel Mac installer')
      writeFileSync(
        path.join(root, `PalmDesk-${manifest.version}-mac-x64.dmg`),
        'unsupported architecture'
      );
    if (kind === 'empty') writeFileSync(filename, '');
    if (kind === 'directory') {
      rmSync(filename);
      mkdirSync(filename);
    }
    await assert.rejects(prepareReleaseAssets(root, manifest));
    assert.equal(existsSync(path.join(root, 'SHA256SUMS.txt')), false);
  });
}
