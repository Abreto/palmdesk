const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-source.cjs');
const { assertUniqueApplicationIdentity } = load(
  'electron-main/app-identity.ts'
);

test('runtime identity accepts path aliases but rejects duplicate apps, shared Electron, and the wrong executable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'palmdesk-startup-'));
  try {
    const bundle = path.join(root, 'PalmDesk.app');
    const duplicate = path.join(root, 'worktree', 'PalmDesk.app');
    fs.mkdirSync(bundle);
    fs.mkdirSync(duplicate, { recursive: true });
    const alias = path.join(root, 'alias.app');
    fs.symlinkSync(
      bundle,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const identity = {
      bundleId: 'io.github.abreto.palmdesk',
      bundlePath: bundle,
      executablePath: process.execPath,
      registeredPaths: [bundle, alias],
    };
    assertUniqueApplicationIdentity(identity, process.execPath, true);
    assert.throws(
      () =>
        assertUniqueApplicationIdentity(
          { ...identity, registeredPaths: [bundle, duplicate] },
          process.execPath,
          true
        ),
      (error) =>
        error.message.includes(bundle) && error.message.includes(duplicate)
    );
    for (const invalid of [
      { bundleId: 'com.github.Electron' },
      { bundleId: 'io.github.abreto.palmdesk.dev' },
      { executablePath: bundle },
    ]) {
      assert.throws(
        () =>
          assertUniqueApplicationIdentity(
            { ...identity, ...invalid },
            process.execPath,
            true
          ),
        /当前进程不一致/
      );
    }
    assertUniqueApplicationIdentity(
      {
        ...identity,
        bundleId: 'io.github.abreto.palmdesk.worktree.0123456789.dev',
      },
      process.execPath,
      false
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('startup validates identity before singleton handoff or loading the permission-requesting input module', async () => {
  for (const conflict of [true, false]) {
    const events = new Map();
    const calls = [];
    const overrides = {
      process: { platform: 'darwin' },
      'node:fs': { mkdirSync() {} },
      electron: {
        app: {
          isPackaged: false,
          getName: () => 'PalmDesk Dev',
          setName() {},
          getPath: () => '/tmp',
          setPath() {},
          on: (event, listener) => events.set(event, listener),
          requestSingleInstanceLock: () => {
            calls.push('lock');
            return false;
          },
          quit: () => calls.push('quit'),
          exit: (code) => calls.push(`exit:${code}`),
        },
        dialog: { showErrorBox: (_title, message) => calls.push(message) },
      },
      './capture-session': { CaptureSession: class {} },
      './app-identity': {
        assertUniqueApplicationIdentity: () => {
          calls.push('verify');
          if (conflict) throw new Error('Duplicate application');
        },
      },
      './native-window': {
        nativeHelperPath: () => '/unused-native-helper',
        NativeWindowBridge: class {
          async request(command) {
            calls.push(command);
            return {};
          }
          close() {
            calls.push('close');
          }
        },
      },
    };
    Object.defineProperty(overrides, '@nut-tree-fork/nut-js', {
      get() {
        assert.fail(
          'Input module must not load before identity and singleton checks pass'
        );
      },
    });
    load('electron-main/index.ts', overrides);
    assert.deepEqual(calls, []);
    await events.get('ready')();
    assert.deepEqual(
      calls,
      conflict
        ? ['appIdentity', 'verify', 'close', 'Duplicate application', 'exit:1']
        : ['appIdentity', 'verify', 'lock', 'close', 'quit']
    );
  }
});
