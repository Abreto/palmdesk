const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-source.cjs');
const { CaptureSession } = load('electron-main/capture-session.ts');
const { pasteClipboardImage, supportsImagePaste } = load(
  'electron-main/image-paste.ts'
);
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
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness() {
  const h = { events: [], focus: async (value) => value };
  const driver = {
    canPasteImage: (value) => supportsImagePaste(value, 'darwin'),
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
    async () => [source],
    (value) => h.focus(value)
  );
  return h;
}

test('image capability is limited to the macOS Codex identity', () => {
  assert.equal(supportsImagePaste(source, 'darwin'), true);
  assert.equal(supportsImagePaste(source, 'win32'), false);
  assert.equal(
    supportsImagePaste(
      { ...source, bundleId: 'com.apple.Terminal', name: 'Codex' },
      'darwin'
    ),
    false
  );
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
