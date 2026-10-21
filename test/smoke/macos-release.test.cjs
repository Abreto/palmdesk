const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const filename = path.resolve(__dirname, '../../scripts/macos-release.cjs');
const source = fs.readFileSync(filename, 'utf8');
const manifest = { productName: 'PalmDesk', version: '0.1.0' };

// Loads the script with child_process replaced, recording system tool calls.
function load(calls = []) {
  const modules = {
    'node:assert/strict': assert,
    'node:child_process': {
      execFileSync: (command, args) => {
        calls.push([command, [...args]]);
        return command === 'plutil' ? 'PalmDesk 0.1.0-arm64\n' : '';
      },
    },
    'node:fs': fs,
    'node:os': os,
    'node:path': path,
    './verify-macos-signing.cjs': { verify() {} },
  };
  const context = {
    module: { exports: {} },
    __dirname: path.dirname(filename),
    process,
    console,
    require: (name) => modules[name],
  };
  vm.runInNewContext(source, context, { filename });
  return context.module.exports;
}

function stage(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'palmdesk release stage ')
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'stage');
  const framework = path.join(
    directory,
    'PalmDesk.app/Contents/Frameworks/Electron Framework.framework'
  );
  fs.mkdirSync(path.join(framework, 'Versions/A'), { recursive: true });
  fs.writeFileSync(path.join(framework, 'Versions/A/Electron Framework'), '');
  fs.symlinkSync('A', path.join(framework, 'Versions/Current'));
  fs.mkdirSync(path.join(directory, '.background'));
  fs.writeFileSync(path.join(directory, '.background/background.tiff'), '');
  fs.writeFileSync(path.join(directory, '.DS_Store'), '');
  fs.writeFileSync(path.join(directory, '.VolumeIcon.icns'), '');
  fs.writeFileSync(
    path.join(directory, 'dmg.json'),
    JSON.stringify({ app: 'PalmDesk.app', volumeName: 'PalmDesk 0.1.0-arm64' })
  );
  return { root, directory, framework };
}

test('an unsigned app archive with the expected layout passes', (t) => {
  const { checkStage } = load();
  const { directory } = stage(t);
  assert.deepEqual(
    { ...checkStage(directory, manifest) },
    { app: 'PalmDesk.app', volumeName: 'PalmDesk 0.1.0-arm64' }
  );
});

[
  [
    'an unexpected top-level file',
    ({ directory }) => fs.writeFileSync(path.join(directory, 'install.sh'), ''),
  ],
  [
    'an absolute symlink',
    ({ framework }) =>
      fs.symlinkSync('/Users', path.join(framework, 'Resources')),
  ],
  [
    'a symlink out of the app',
    ({ framework }) =>
      fs.symlinkSync('../../../../..', path.join(framework, 'Resources')),
  ],
  [
    'a symlink in the layout files',
    ({ directory }) =>
      fs.symlinkSync(
        '../PalmDesk.app',
        path.join(directory, '.background/app')
      ),
  ],
  [
    'another version',
    ({ directory }) =>
      fs.writeFileSync(
        path.join(directory, 'dmg.json'),
        JSON.stringify({
          app: 'PalmDesk.app',
          volumeName: 'PalmDesk 0.0.9-arm64',
        })
      ),
  ],
].forEach(([kind, change]) => {
  test(`the signing job rejects ${kind} before importing the key`, (t) => {
    const { checkStage } = load();
    const fixture = stage(t);
    change(fixture);
    assert.throws(() => checkStage(fixture.directory, manifest));
  });
});

test('an archive is never extracted over files from an earlier attempt', (t) => {
  const calls = [];
  const { unpack } = load(calls);
  const { directory } = stage(t);
  assert.throws(
    () => unpack('/tmp/unsigned.zip', directory, manifest),
    /EEXIST/
  );
  assert.equal(calls.length, 0);
});

test('the DMG keeps the build layout, adds Applications and marks the volume icon', (t) => {
  const calls = [];
  const { createDmg } = load(calls);
  const { root, directory } = stage(t);
  const output = path.join(root, 'out/PalmDesk-0.1.0-mac-arm64.dmg');
  createDmg(directory, output, manifest);
  assert.equal(fs.existsSync(path.join(directory, 'dmg.json')), false);
  assert.equal(
    fs.readlinkSync(path.join(directory, 'Applications')),
    '/Applications'
  );
  const [create, attach, icon, detach, convert] = calls;
  assert.deepEqual(create[1].slice(0, 9), [
    'create',
    '-volname',
    'PalmDesk 0.1.0-arm64',
    '-srcfolder',
    directory,
    '-fs',
    'APFS',
    '-format',
    'UDRW',
  ]);
  const writable = create[1].at(-1);
  assert.deepEqual(attach[1].slice(0, 5), [
    'attach',
    writable,
    '-nobrowse',
    '-noautoopen',
    '-readwrite',
  ]);
  const mountpoint = attach[1].at(-1);
  assert.deepEqual(icon, [
    'xattr',
    [
      '-wx',
      'com.apple.FinderInfo',
      `${'00'.repeat(8)}0400${'00'.repeat(22)}`,
      mountpoint,
    ],
  ]);
  assert.deepEqual(detach, ['hdiutil', ['detach', mountpoint]]);
  assert.deepEqual(convert[1], [
    'convert',
    writable,
    '-format',
    'UDZO',
    '-imagekey',
    'zlib-level=9',
    '-ov',
    '-o',
    output,
  ]);
  assert.equal(fs.existsSync(mountpoint), false);
  assert.equal(fs.existsSync(path.dirname(writable)), false);
});
