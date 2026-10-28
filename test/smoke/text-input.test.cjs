const assert = require('node:assert/strict');
const test = require('node:test');

const load = require('./load-source.cjs');

const {
  CaptureSession,
  InputUnavailableError,
  TEXT_CHUNK_LENGTH,
  typeInChunks,
} = load('electron-main/capture-session.ts');

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

function typist() {
  const events = [];
  return {
    events,
    type: async (chunk) => {
      events.push(['type', chunk]);
    },
    verifyFocus: async () => {
      events.push(['verifyFocus']);
    },
  };
}

test('long text is typed in chunks with a focus check before every later chunk', async () => {
  const driver = typist();
  const text = 'a'.repeat(TEXT_CHUNK_LENGTH * 2 + 5);
  await typeInChunks(text, () => true, driver);
  assert.deepEqual(driver.events, [
    ['type', 'a'.repeat(TEXT_CHUNK_LENGTH)],
    ['verifyFocus'],
    ['type', 'a'.repeat(TEXT_CHUNK_LENGTH)],
    ['verifyFocus'],
    ['type', 'aaaaa'],
  ]);
  driver.events.length = 0;
  await typeInChunks('短 prompt', () => true, driver);
  assert.deepEqual(driver.events, [['type', '短 prompt']]);
});

test('chunks never split a character outside the Basic Multilingual Plane', async () => {
  const driver = typist();
  const text = `${'中'.repeat(TEXT_CHUNK_LENGTH - 1)}😀${'🙂'.repeat(3)}`;
  await typeInChunks(text, () => true, driver);
  const typed = driver.events.filter(([kind]) => kind === 'type');
  assert.deepEqual(
    typed.map(([, chunk]) => chunk),
    [`${'中'.repeat(TEXT_CHUNK_LENGTH - 1)}😀`, '🙂🙂🙂']
  );
  assert.equal(typed.map(([, chunk]) => chunk).join(''), text);
});

test('typing stops at the next chunk once the session is no longer current', async () => {
  const driver = typist();
  let current = true;
  driver.type = async (chunk) => {
    driver.events.push(['type', chunk]);
    current = false;
  };
  await assert.rejects(
    typeInChunks('x'.repeat(TEXT_CHUNK_LENGTH * 3), () => current, driver),
    /会话已结束/
  );
  assert.deepEqual(driver.events, [['type', 'x'.repeat(TEXT_CHUNK_LENGTH)]]);
});

test('losing focus stops the remaining text and reports how much was typed', async () => {
  const driver = typist();
  driver.verifyFocus = async () => {
    throw new Error('focus');
  };
  const text = 'y'.repeat(TEXT_CHUNK_LENGTH + 1);
  await assert.rejects(
    typeInChunks(text, () => true, driver),
    (error) =>
      error instanceof InputUnavailableError &&
      error.message.includes(`${TEXT_CHUNK_LENGTH}/${text.length}`)
  );
  assert.deepEqual(driver.events, [['type', 'y'.repeat(TEXT_CHUNK_LENGTH)]]);
});

test('ending control stops typing at the next chunk and does not wait for the rest', async () => {
  const events = [];
  let release;
  const firstChunk = new Promise((resolve) => {
    release = resolve;
  });
  const driver = {
    position: async () => {},
    buttonDown: async () => {},
    buttonUp: async () => {},
    click: async () => {},
    scroll: async () => {},
    keysDown: async () => {},
    keysUp: async () => {},
    validKey: () => true,
    text: (value, _target, current) =>
      typeInChunks(value, current, {
        type: async (chunk) => {
          events.push(chunk.length);
          if (events.length === 1) await firstChunk;
        },
        verifyFocus: async () => {},
      }),
  };
  const session = new CaptureSession(
    driver,
    async () => [source],
    async (value) => value
  );
  const { sessionId } = await session.begin(source.id);
  const typing = session.input(sessionId, {
    action: 'text',
    text: 'z'.repeat(4096),
  });
  await new Promise((resolve) => setImmediate(resolve));
  const ended = session.end(sessionId);
  release();
  await assert.rejects(typing, /会话已结束/);
  await ended;
  assert.deepEqual(events, [TEXT_CHUNK_LENGTH]);
  await assert.rejects(
    session.input(sessionId, { action: 'text', text: 'late' }),
    /会话已结束/
  );
});

test('quitting waits for input to stop, but not longer than the quit timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = new Map();
  const calls = [];
  load('electron-main/index.ts', {
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
        quit: () => calls.push('quit'),
      },
    },
    './capture-session': {
      CaptureSession: class {
        end() {
          calls.push('end');
          return new Promise(() => {});
        }
      },
      InputUnavailableError: class extends Error {},
      typeInChunks() {},
    },
    './native-window': {
      nativeHelperPath: () => '/unused-native-helper',
      NativeWindowBridge: class {
        close() {
          calls.push('close');
        }
      },
    },
  });
  let prevented = false;
  events.get('before-quit')({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(calls, ['end']);
  t.mock.timers.tick(2999);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['end']);
  t.mock.timers.tick(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['end', 'close', 'quit']);
});

test('startup turns off the nut-js delay before every typed character and key press', async () => {
  const events = new Map();
  const nutjs = {
    mouse: { config: { autoDelayMs: 100 } },
    keyboard: { config: { autoDelayMs: 300 } },
  };
  load('electron-main/index.ts', {
    process: { platform: 'darwin' },
    'node:fs': { mkdirSync() {} },
    '@nut-tree-fork/nut-js': nutjs,
    electron: {
      app: {
        isPackaged: false,
        getName: () => 'PalmDesk Dev',
        setName() {},
        getPath: () => '/tmp',
        setPath() {},
        on: (event, listener) => events.set(event, listener),
        requestSingleInstanceLock: () => true,
      },
    },
    './app-identity': { assertUniqueApplicationIdentity() {} },
    './native-window': {
      nativeHelperPath: () => '/unused-native-helper',
      NativeWindowBridge: class {
        async request() {
          return {};
        }
      },
    },
  });
  // The rest of startup needs Electron windows, which this test omits.
  await events
    .get('ready')()
    .catch(() => {});
  assert.equal(nutjs.keyboard.config.autoDelayMs, 0);
  assert.equal(nutjs.mouse.config.autoDelayMs, 0);
});
