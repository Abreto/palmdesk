const assert = require('node:assert/strict');
const {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  helperIdentifiers,
  isMachO,
  signApp,
  signingTargets,
} = require('../../scripts/macos-codesign.cjs');

const thin = Buffer.from('cffaedfe0c000001', 'hex');
const fat = Buffer.from('cafebabe00000002', 'hex');
// Java class files share the fat magic, followed by a class version.
const javaClass = Buffer.from('cafebabe00000034', 'hex');

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'palmdesk codesign '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'PalmDesk.app');
  const write = (relative, content = thin) => {
    const file = path.join(app, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  write('Contents/Info.plist', '<plist/>');
  write('Contents/MacOS/PalmDesk');
  write('Contents/MacOS/codex-window');
  write(
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    fat
  );
  write(
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib'
  );
  symlinkSync(
    'A',
    path.join(
      app,
      'Contents/Frameworks/Electron Framework.framework/Versions/Current'
    )
  );
  symlinkSync(
    'Versions/Current/Electron Framework',
    path.join(
      app,
      'Contents/Frameworks/Electron Framework.framework/Electron Framework'
    )
  );
  write(
    'Contents/Frameworks/PalmDesk Helper.app/Contents/MacOS/PalmDesk Helper'
  );
  write('Contents/Resources/app.asar.unpacked/node_modules/libnut/libnut.node');
  write('Contents/Resources/app.asar', Buffer.from('04000000', 'hex'));
  write('Contents/Resources/en.lproj/locale.pak', Buffer.alloc(64, 1));
  write('Contents/Resources/Probe.class', javaClass);
  write('Contents/Resources/short', Buffer.from('cffa', 'hex'));
  return app;
}

test('only Mach-O files are code: resources, short files and Java classes are skipped', (t) => {
  const app = fixture(t);
  const file = (relative) => path.join(app, relative);
  assert.equal(isMachO(file('Contents/MacOS/PalmDesk')), true);
  assert.equal(
    isMachO(
      file(
        'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'
      )
    ),
    true
  );
  [
    'Contents/Info.plist',
    'Contents/Resources/app.asar',
    'Contents/Resources/en.lproj/locale.pak',
    'Contents/Resources/Probe.class',
    'Contents/Resources/short',
  ].forEach((resource) =>
    assert.equal(isMachO(file(resource)), false, resource)
  );
});

test('nested code is signed inside out at its real path, finishing with the app', (t) => {
  const app = fixture(t);
  const targets = signingTargets(app).map(
    (target) => path.relative(app, target).split(path.sep).join('/') || '.'
  );
  assert.deepEqual([...targets].sort(), [
    '.',
    'Contents/Frameworks/Electron Framework.framework',
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib',
    'Contents/Frameworks/PalmDesk Helper.app',
    'Contents/Frameworks/PalmDesk Helper.app/Contents/MacOS/PalmDesk Helper',
    'Contents/MacOS/PalmDesk',
    'Contents/MacOS/codex-window',
    'Contents/Resources/app.asar.unpacked/node_modules/libnut/libnut.node',
  ]);
  assert.equal(targets.at(-1), '.');
  const depth = targets.slice(0, -1).map((target) => target.split('/').length);
  assert.deepEqual(
    depth,
    [...depth].sort((a, b) => b - a)
  );
  const position = (target) => targets.indexOf(target);
  assert.ok(
    position(
      'Contents/Frameworks/PalmDesk Helper.app/Contents/MacOS/PalmDesk Helper'
    ) < position('Contents/Frameworks/PalmDesk Helper.app')
  );
});

test('every item uses the fixed options and only the helper gets a fixed identifier', (t) => {
  const app = fixture(t);
  const calls = [];
  signApp({
    app,
    identity: 'FINGERPRINT',
    keychain: '/tmp/signing.keychain-db',
    identifiers: helperIdentifiers('io.github.abreto.palmdesk'),
    entitlements: '/tmp/entitlements.plist',
    run: (command, args) => calls.push([command, args]),
  });
  assert.equal(calls.length, 9);
  calls.forEach(([command, args]) => {
    assert.equal(command, 'codesign');
    const target = args.at(-1);
    const identifier =
      target === path.join(app, 'Contents/MacOS/codex-window')
        ? ['--identifier', 'io.github.abreto.palmdesk.window-helper']
        : [];
    assert.deepEqual(args, [
      '--sign',
      'FINGERPRINT',
      '--force',
      '--keychain',
      '/tmp/signing.keychain-db',
      '--timestamp=none',
      '--entitlements',
      '/tmp/entitlements.plist',
      ...identifier,
      target,
    ]);
    assert.ok(!args.includes('--options'), 'no hardened runtime');
  });
});

test('ad-hoc signing omits the keychain and defaults to the repository entitlements', (t) => {
  const app = fixture(t);
  const calls = [];
  signApp({ app, identity: '-', run: (_, args) => calls.push(args) });
  const args = calls.at(-1);
  assert.deepEqual(args.slice(0, 3), ['--sign', '-', '--force']);
  assert.ok(!args.includes('--keychain'));
  assert.equal(
    args[args.indexOf('--entitlements') + 1],
    path.resolve(__dirname, '../../build/entitlements.mac.plist')
  );
});
