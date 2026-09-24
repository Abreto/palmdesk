/* eslint-disable no-restricted-syntax, require-await -- Cases run in sequence; async input-driver doubles match the production contract. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const load = require('./load-source.cjs');

const capture = load('electron-main/capture-session.ts');
const { CaptureSession, InputUnavailableError } = capture;
const nativeWindow = load('electron-main/native-window.ts');
const { pasteClipboardImage, pasteWindowsClipboardImage, supportsImagePaste } =
  load('electron-main/image-paste.ts', {
    './capture-session': capture,
    './native-window': nativeWindow,
  });
const { inspectImage } = load('src/utils/image-payload.ts');
const image = {
  mime: 'image/png',
  bytes: new Uint8Array(
    fs.readFileSync(path.join(__dirname, '../../src/assets/img/logo.png'))
  ),
};
const source = {
  id: 'window:10:0',
  captureId: 'window:10:0',
  nativeId: 10,
  ownerPid: 42,
  bundleId: 'com.openai.codex',
  isOnScreen: true,
  boundsSource: 'window',
  bounds: { x: 0, y: 0, width: 500, height: 500 },
};
const windowsSource = {
  ...source,
  bundleId: 'win32:c:\\apps\\codex.exe#1dd0123456789ab',
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness(target = source, platform = 'darwin') {
  const h = { events: [], sources: [target], focus: async (value) => value };
  const driver = {
    canPasteImage: (value) => supportsImagePaste(value, platform),
    position: async () => {},
    buttonDown: async () => h.events.push(['buttonDown']),
    buttonUp: async () => h.events.push(['buttonUp']),
    validKey: () => true,
    keysDown: async (keys) => {
      h.events.push(['down', keys]);
    },
    keysUp: async (keys) => {
      h.events.push(['up', keys]);
    },
    text: async (text) => {
      h.events.push(['text', text]);
    },
    pasteImage: async (payload, target, current) => {
      assert.equal(current(), true);
      assert.deepEqual(payload, image);
      assert.equal(target.ownerPid, 42);
      h.events.push(['image']);
    },
  };
  h.driver = driver;
  h.session = new CaptureSession(
    driver,
    async () => h.sources,
    (value) => h.focus(value)
  );
  return h;
}

test('image capability accepts platform-specific Codex identities, never titles or other agents', () => {
  assert.equal(supportsImagePaste(source, 'darwin'), true);
  assert.equal(supportsImagePaste(source, 'win32'), false);
  assert.equal(supportsImagePaste(windowsSource, 'win32'), true);
  assert.equal(supportsImagePaste(windowsSource, 'darwin'), false);
  assert.equal(supportsImagePaste(windowsSource, 'linux'), false);
  for (const bundleId of [
    'win32:c:\\apps\\claude.exe#123',
    'win32:c:\\apps\\not-codex.exe#123',
    'win32:c:\\apps\\codex.exe',
    'win32:c:\\apps\\codex.exe#not-a-start-time',
    '',
  ]) {
    assert.equal(
      supportsImagePaste(
        { ...windowsSource, bundleId, name: 'Codex' },
        'win32'
      ),
      false
    );
  }
  assert.equal(
    supportsImagePaste(
      { ...source, bundleId: 'com.apple.Terminal', name: 'Codex' },
      'darwin'
    ),
    false
  );
});

test('Windows paste advertises the phone controls and releases buttons and keys before pasting', async () => {
  const h = harness(windowsSource, 'win32');
  const { sessionId, imagePaste } = await h.session.begin(source.id);
  assert.equal(imagePaste, true);
  await h.session.input(sessionId, { action: 'down', x: 0, y: 0 });
  await h.session.input(sessionId, { action: 'keysDown', keys: [1] });
  await Promise.all([
    h.session.pasteImage(sessionId, 1, image),
    h.session.input(sessionId, { action: 'text', text: '中文 draft' }),
  ]);
  assert.deepEqual(h.events, [
    ['buttonDown'],
    ['down', [1]],
    ['up', [1]],
    ['buttonUp'],
    ['image'],
    ['text', '中文 draft'],
  ]);
});

test('Windows paste rejects a changed HWND, PID, executable or process start time', async () => {
  for (const change of [
    { nativeId: 11 },
    { ownerPid: 99 },
    { bundleId: 'win32:c:\\elsewhere\\codex.exe#1dd0123456789ab' },
    { bundleId: 'win32:c:\\apps\\codex.exe#1dd0123456789ac' },
    { isOnScreen: false },
  ]) {
    const h = harness(windowsSource, 'win32');
    const { sessionId } = await h.session.begin(source.id);
    h.focus = async () => ({ ...windowsSource, ...change });
    await assert.rejects(
      h.session.pasteImage(sessionId, 1, image),
      /窗口已变化/
    );
    assert.deepEqual(h.events, []);
  }
});

test('Windows paste permission failure reports recovery and allows an explicit image retry', async () => {
  const h = harness(windowsSource, 'win32');
  const { sessionId } = await h.session.begin(source.id);
  const paste = h.driver.pasteImage;
  h.driver.pasteImage = async () => {
    throw new InputUnavailableError('请使用相同权限级别');
  };
  await assert.rejects(h.session.pasteImage(sessionId, 1, image), /权限级别/);
  assert.deepEqual(h.events, []);
  h.driver.pasteImage = paste;
  await h.session.pasteImage(sessionId, 2, image);
  assert.deepEqual(h.events, [['image']]);
});

test('failed key or button release prevents paste and is retried on the next explicit action', async () => {
  for (const release of ['keysUp', 'buttonUp']) {
    const h = harness(windowsSource, 'win32');
    const { sessionId } = await h.session.begin(source.id);
    await h.session.input(sessionId, { action: 'down', x: 0, y: 0 });
    await h.session.input(sessionId, { action: 'keysDown', keys: [1] });
    const original = h.driver[release];
    h.driver[release] = async () => {
      throw new Error('release failed');
    };
    await assert.rejects(h.session.pasteImage(sessionId, 1, image), /释放/);
    assert.equal(
      h.events.some(([event]) => event === 'image'),
      false
    );
    h.events.length = 0;
    h.driver[release] = original;
    await h.session.pasteImage(sessionId, 2, image);
    assert.deepEqual(h.events, [
      release === 'keysUp' ? ['up', [1]] : ['buttonUp'],
      ['image'],
    ]);
  }
});

function windowsDriver() {
  const events = [];
  const driver = {
    decode: (bytes) => {
      assert.deepEqual(bytes, image.bytes);
      return { isEmpty: () => false, getSize: () => inspectImage(bytes) };
    },
    write: () => events.push('write'),
    request: async (command, target) => {
      assert.deepEqual(target, {
        nativeId: 10,
        ownerPid: 42,
        bundleId: windowsSource.bundleId,
      });
      events.push(command);
    },
  };
  return { events, driver };
}

test('Windows clipboard is verified before writing and uses the guarded native paste command once', async () => {
  const { events, driver } = windowsDriver();
  await pasteWindowsClipboardImage(image, windowsSource, () => true, driver);
  assert.deepEqual(events, ['verifyImagePaste', 'write', 'pasteImage']);
});

test('Windows verification failures leave the clipboard untouched and explain recovery', async () => {
  for (const [code, message] of [
    ['permission', /权限级别/],
    ['focus', /前台/],
    ['gone', /窗口.*变化|窗口.*关闭/],
  ]) {
    const { events, driver } = windowsDriver();
    driver.request = async () => {
      throw new nativeWindow.NativeWindowError('native failure', code);
    };
    await assert.rejects(
      pasteWindowsClipboardImage(image, windowsSource, () => true, driver),
      message
    );
    assert.deepEqual(events, []);
  }
});

test('cancellation during Windows verification prevents clipboard writes and native input', async () => {
  const { events, driver } = windowsDriver();
  let current = true;
  const request = driver.request;
  driver.request = async (...args) => {
    await request(...args);
    current = false;
  };
  await assert.rejects(
    pasteWindowsClipboardImage(image, windowsSource, () => current, driver),
    /取消/
  );
  assert.deepEqual(events, ['verifyImagePaste']);
});

test('cancellation after a clipboard write prevents the Windows paste shortcut', async () => {
  const { events, driver } = windowsDriver();
  let current = true;
  driver.write = () => {
    events.push('write');
    current = false;
  };
  await assert.rejects(
    pasteWindowsClipboardImage(image, windowsSource, () => current, driver),
    /取消/
  );
  assert.deepEqual(events, ['verifyImagePaste', 'write']);
});

test('a failed Windows shortcut reports an unconfirmed result without replaying input', async () => {
  const { events, driver } = windowsDriver();
  const request = driver.request;
  driver.request = async (...args) => {
    await request(...args);
    if (args[0] === 'pasteImage')
      throw new nativeWindow.NativeWindowError(
        'partial input',
        'paste_unconfirmed'
      );
  };
  await assert.rejects(
    pasteWindowsClipboardImage(image, windowsSource, () => true, driver),
    /未确认.*Codex/
  );
  assert.deepEqual(events, ['verifyImagePaste', 'write', 'pasteImage']);
});

test('image paste releases held keys and serializes with text input', async () => {
  const h = harness();
  const { sessionId, imagePaste } = await h.session.begin(source.id);
  assert.equal(imagePaste, true);
  await h.session.input(sessionId, { action: 'keysDown', keys: [1] });
  await Promise.all([
    h.session.pasteImage(sessionId, 1, image),
    h.session.input(sessionId, { action: 'text', text: 'draft' }),
  ]);
  assert.deepEqual(h.events, [
    ['down', [1]],
    ['up', [1]],
    ['image'],
    ['text', 'draft'],
  ]);
});

test('cancelling while focus is pending prevents clipboard changes and preserves the session', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin(source.id);
  let release;
  h.focus = () =>
    new Promise((resolve) => {
      release = () => resolve(source);
    });
  const pending = h.session.pasteImage(sessionId, 1, image);
  const rejected = assert.rejects(pending, /取消/);
  await tick();
  h.session.cancelImagePaste(sessionId, 1);
  release();
  await rejected;
  assert.deepEqual(h.events, []);
  assert.equal((await h.session.refresh()).sessionId, sessionId);
});

test('a session ending during focus cannot paste into a later window', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin(source.id);
  let release;
  h.focus = () =>
    new Promise((resolve) => {
      release = () => resolve(source);
    });
  const pending = h.session.pasteImage(sessionId, 1, image);
  const rejected = assert.rejects(pending, /取消/);
  await tick();
  const end = h.session.end(sessionId);
  release();
  await rejected;
  await end;
  assert.deepEqual(h.events, []);
});

test('bad images, unsupported targets and stale session tokens do not reach the clipboard', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin(source.id);
  await assert.rejects(h.session.pasteImage('old', 1, image), /会话已结束/);
  await assert.rejects(
    h.session.pasteImage(sessionId, 2, {
      mime: 'image/png',
      bytes: new Uint8Array([1]),
    }),
    /PNG/
  );
  h.driver.canPasteImage = () => false;
  await assert.rejects(h.session.pasteImage(sessionId, 3, image), /macOS/);
  assert.deepEqual(h.events, []);
  assert.equal((await h.session.refresh()).sessionId, sessionId);
});

test('clipboard write precedes the paste shortcut, and modifiers release even on failure', async () => {
  const events = [];
  const native = {
    isEmpty: () => false,
    getSize: () => inspectImage(image.bytes),
  };
  const driver = {
    decode: () => native,
    write: (value) => {
      assert.equal(value, native);
      events.push('write');
    },
    press: async () => {
      events.push('paste');
      throw new Error('keyboard failed');
    },
    release: async () => {
      events.push('release');
    },
  };
  await assert.rejects(
    pasteClipboardImage(image, () => true, driver),
    /keyboard failed/
  );
  assert.deepEqual(events, ['write', 'paste', 'release']);
  events.length = 0;
  await assert.rejects(
    pasteClipboardImage(image, () => false, driver),
    /取消/
  );
  assert.deepEqual(events, []);
  await assert.rejects(
    pasteClipboardImage(image, () => true, {
      ...driver,
      decode: () => ({
        isEmpty: () => true,
        getSize: () => ({ width: 0, height: 0 }),
      }),
    }),
    /解码/
  );
  assert.deepEqual(events, []);
});
