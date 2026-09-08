const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const load = require('./load-source.cjs');

test('Windows capture enables WGC while preserving other Chromium features', () => {
  const { enableWindowsCapture } = load('electron-main/native-window.ts');
  const switches = { 'enable-features': 'ExistingFeature' };
  const commandLine = {
    getSwitchValue: (key) => switches[key] || '',
    appendSwitch: (key, value) => {
      switches[key] = value;
    },
  };
  assert.equal(enableWindowsCapture(commandLine), true);
  assert.equal(
    switches['enable-features'],
    'ExistingFeature,AllowWgcWindowCapturer'
  );
  enableWindowsCapture(commandLine);
  assert.equal(
    switches['enable-features'],
    'ExistingFeature,AllowWgcWindowCapturer'
  );
});

test('explicitly disabled WGC cannot silently fall back to incompatible capture bounds', () => {
  const { enableWindowsCapture } = load('electron-main/native-window.ts');
  assert.equal(
    enableWindowsCapture({
      getSwitchValue: (key) =>
        key === 'disable-features' ? 'Other,AllowWgcWindowCapturer' : '',
      appendSwitch: () => assert.fail('disabled WGC must reject capture'),
    }),
    false
  );
});

test('whitespace around disabled WGC cannot permit fallback capture', () => {
  const { enableWindowsCapture } = load('electron-main/native-window.ts');
  for (const disabled of [
    'Other, AllowWgcWindowCapturer',
    'AllowWgcWindowCapturer ,Other',
    'Other,\tAllowWgcWindowCapturer<Trial ',
  ]) {
    assert.equal(
      enableWindowsCapture({
        getSwitchValue: (key) => (key === 'disable-features' ? disabled : ''),
        appendSwitch: () => assert.fail('disabled WGC must reject capture'),
      }),
      false
    );
  }
});

test('whitespace around enabled WGC preserves its parameters without duplication', () => {
  const { enableWindowsCapture } = load('electron-main/native-window.ts');
  const configured = 'Other, AllowWgcWindowCapturer:mode/value ';
  let enabled = configured;
  assert.equal(
    enableWindowsCapture({
      getSwitchValue: (key) => (key === 'enable-features' ? enabled : ''),
      appendSwitch: (_key, value) => {
        enabled = value;
      },
    }),
    true
  );
  assert.equal(enabled, configured);
});

test('helper paths distinguish Windows resources from the macOS executable directory', () => {
  const { nativeHelperPath } = load('electron-main/native-window.ts');
  const main = path.resolve('electron-dist');
  const resources = path.resolve('packaged-resources');
  assert.equal(
    nativeHelperPath('win32', main),
    path.resolve('native-bin/palmdesk-window.exe')
  );
  assert.equal(
    nativeHelperPath('win32', main, resources),
    path.join(resources, 'native/palmdesk-window.exe')
  );
  assert.equal(
    nativeHelperPath('darwin', main, resources),
    path.join(resources, '../MacOS/codex-window')
  );
});

test('Windows helper starts hidden and preserves structured errors and request IDs', async () => {
  let spawned = 0;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  const { NativeWindowBridge, NativeWindowError } = load(
    'electron-main/native-window.ts',
    {
      'node:child_process': {
        spawn: (executable, args, options) => {
          spawned += 1;
          assert.equal(executable, 'palmdesk-window.exe');
          assert.deepEqual(args, []);
          assert.equal(options.windowsHide, true);
          return child;
        },
      },
    }
  );
  child.stdin.on('data', (buffer) => {
    const request = JSON.parse(buffer.toString());
    child.stdout.write(
      `${JSON.stringify(
        request.command === 'list'
          ? { requestId: request.requestId, data: [] }
          : {
              requestId: request.requestId,
              error: 'Access denied',
              errorCode: 'permission',
            }
      )}\n`
    );
  });
  const bridge = new NativeWindowBridge('palmdesk-window.exe', 'win32');
  try {
    assert.deepEqual(await bridge.request('list'), []);
    await assert.rejects(bridge.request('focus'), (error) => {
      assert.ok(error instanceof NativeWindowError);
      assert.equal(error.code, 'permission');
      return true;
    });
    assert.equal(spawned, 1);
  } finally {
    bridge.close();
  }
});

test('unsupported hosts never launch a native helper', async () => {
  const { NativeWindowBridge } = load('electron-main/native-window.ts', {
    'node:child_process': { spawn: () => assert.fail('unsupported platform') },
  });
  const bridge = new NativeWindowBridge('unused', 'linux');
  await assert.rejects(bridge.request('list'), /macOS.*Windows/);
});

test('Windows AI app preference comes from executable identity, not a window title', () => {
  const { matchCaptureSources } = load('electron-main/native-window.ts');
  const owner = (nativeId, bundleId) => ({
    nativeId,
    bundleId,
    ownerPid: 10,
    name: 'Codex',
    isOnScreen: true,
    bounds: { x: -1500, y: 50, width: 1200, height: 900 },
  });
  const windows = matchCaptureSources(
    [],
    [
      owner(1, 'win32:c:\\apps\\editor.exe#123'),
      owner(2, 'win32:c:\\apps\\Codex.exe#456'),
      owner(3, 'win32:c:\\apps\\ChatGPT.exe#789'),
      owner(4, 'win32:c:\\apps\\Claude.exe#890'),
      owner(5, 'win32:c:\\apps\\Kimi Work.exe#901'),
      owner(6, 'win32:c:\\apps\\ZCode.exe#abc'),
    ]
  );
  assert.deepEqual(
    windows.map((item) => item.nativeId),
    [2, 3, 4, 5, 6, 1]
  );
  assert.equal(windows[0].isAiTarget, true);
  assert.equal(windows[4].isAiTarget, true);
  assert.equal(windows[5].isCodex, false);
  assert.equal(windows[5].isAiTarget, false);
  assert.equal(windows[0].inputScale, 1);
  assert.equal(windows[0].bounds.x, -1500);
  assert.equal(windows[0].captureId, undefined);
});
