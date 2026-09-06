const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-source.cjs');
const { CaptureSession, normalizedPoint } = load(
  'electron-main/capture-session.ts'
);
const { matchCaptureSources } = load('electron-main/native-window.ts');

const source = (extra = {}) => ({
  id: 'window:10:0',
  nativeId: 10,
  ownerPid: 42,
  bundleId: 'com.openai.codex',
  name: 'Project notes',
  thumbnail: '',
  appIcon: '',
  isCodex: true,
  bounds: { x: 100, y: 200, width: 600, height: 400 },
  boundsSource: 'window',
  inputScale: 1,
  ...extra,
});
function harness() {
  const state = { sources: [source()], events: [], focusCalls: 0 };
  const record =
    (name) =>
    async (...args) => {
      state.events.push([name, ...args]);
    };
  const driver = {
    position: record('position'),
    buttonDown: record('down'),
    buttonUp: record('up'),
    click: record('click'),
    scroll: record('scroll'),
    text: record('text'),
    keysDown: record('keysDown'),
    keysUp: record('keysUp'),
    validKey: (key) => Number.isInteger(key) && key >= 0 && key <= 200,
  };
  state.session = new CaptureSession(
    driver,
    async () => {
      if (state.listError) throw state.listError;
      if (state.listWait) await state.listWait;
      return state.sources;
    },
    async (target) => {
      state.focusCalls += 1;
      if (state.focusWait) await state.focusWait;
      if (state.focusError) throw state.focusError;
      const current = state.sources.find((item) => item.id === target.id);
      if (!current) throw new Error('Window closed');
      return current;
    }
  );
  return state;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const desktopSource = (id, name) => ({
  id,
  name,
  display_id: '1',
  thumbnail: { toJPEG: () => Buffer.from('thumbnail') },
  appIcon: null,
});

test('native owner identity admits ordinary app windows without trusting their titles', () => {
  const sources = [
    desktopSource('window:10:0', 'Project notes'),
    desktopSource('window:11:0', 'Codex'),
    desktopSource('screen:10:0', 'Codex'),
  ];
  const owners = [
    source(),
    source({ nativeId: 11, ownerPid: 99, bundleId: 'com.google.Chrome' }),
  ];
  const result = matchCaptureSources(sources, owners);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'window:10:0');
  assert.equal(result[0].ownerPid, 42);
  assert.equal(result[1].bundleId, 'com.google.Chrome');
  assert.equal(result[1].isCodex, false);
});
test('ChatGPT is supported and windows without native identities are excluded', () => {
  const result = matchCaptureSources(
    [desktopSource('window:12:0', '')],
    [source({ nativeId: 12, bundleId: 'com.openai.chat' })]
  );
  assert.equal(result[0].bundleId, 'com.openai.chat');
  assert.equal(
    matchCaptureSources([desktopSource('window:13:0', 'OpenAI')], []).length,
    0
  );
});
test('Terminal and Claude can each be captured and controlled using their exact identity', async () => {
  for (const bundleId of [
    'com.apple.Terminal',
    'com.anthropic.claudefordesktop',
  ]) {
    const h = harness();
    h.sources = [source({ bundleId })];
    const { sessionId } = await h.session.begin('window:10:0', {
      ownerPid: 42,
      bundleId,
    });
    await h.session.input(sessionId, { action: 'text', text: 'selected' });
    assert.deepEqual(h.events, [['text', 'selected']]);
  }
});
test('a window identity changed since listing cannot begin capture', async () => {
  for (const change of [{ ownerPid: 99 }, { bundleId: 'com.apple.Terminal' }]) {
    const h = harness();
    h.sources = [source(change)];
    await assert.rejects(
      h.session.begin('window:10:0', source()),
      /身份已变化/
    );
    assert.equal((await h.session.refresh()).sessionId, '');
  }
});
test('corners, center, out-of-range and negative desktop coordinates map to the exact window', () => {
  for (const [x, y, expected] of [
    [0, 0, { x: 100, y: 200 }],
    [1000, 1000, { x: 699, y: 599 }],
    [1000, 0, { x: 699, y: 200 }],
    [0, 1000, { x: 100, y: 599 }],
    [500, 500, { x: 400, y: 400 }],
    [-20, 1200, { x: 100, y: 599 }],
  ])
    assert.deepEqual(normalizedPoint(source(), x, y), expected);
  assert.deepEqual(
    normalizedPoint(
      source({ bounds: { x: -600, y: 50, width: 800, height: 600 } }),
      0,
      1000
    ),
    { x: -600, y: 649 }
  );
});
test('display fallback and non-finite coordinates are rejected', () => {
  assert.throws(() =>
    normalizedPoint(source({ boundsSource: 'display' }), 500, 500)
  );
  for (const value of [NaN, Infinity, '500', undefined])
    assert.throws(() => normalizedPoint(source(), value, 0));
  for (const change of [
    { width: 0 },
    { height: -1 },
    { x: NaN },
    { y: Infinity },
    { width: Infinity },
  ])
    assert.throws(() =>
      normalizedPoint(
        source({ bounds: { ...source().bounds, ...change } }),
        0,
        0
      )
    );
});
for (const action of [
  'move',
  'down',
  'up',
  'click',
  'doubleClick',
  'rightClick',
  'scroll',
  'text',
  'keysDown',
  'keysUp',
]) {
  test(action + ' is rejected without an active capture session', async () => {
    const h = harness();
    await assert.rejects(
      h.session.input('old', {
        action,
        x: 500,
        y: 500,
        text: 'x',
        keys: [1],
        direction: 'up',
        amount: 1,
      })
    );
    assert.equal(h.events.length, 0);
  });
}
test('starting capture requires an explicit existing source ID', async () => {
  const h = harness();
  await assert.rejects(h.session.begin(''));
  await assert.rejects(h.session.begin('screen:0:0'));
});
test('a new capture uses a fresh token and rejects the previous token', async () => {
  const h = harness();
  const first = await h.session.begin('window:10:0');
  const second = await h.session.begin('window:10:0');
  assert.notEqual(first.sessionId, second.sessionId);
  await assert.rejects(
    h.session.input(first.sessionId, { action: 'text', text: 'stale' })
  );
  await h.session.input(second.sessionId, {
    action: 'text',
    text: '你好 Codex',
  });
  assert.deepEqual(h.events, [['text', '你好 Codex']]);
});
test('pointer, scroll and keys each verify focus without an 800 ms bypass', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  await h.session.input(sessionId, { action: 'move', x: 500, y: 500 });
  await h.session.input(sessionId, {
    action: 'scroll',
    x: 0,
    y: 1000,
    direction: 'down',
    amount: 3,
  });
  await h.session.input(sessionId, { action: 'keysDown', keys: [1] });
  assert.equal(h.focusCalls, 3);
  assert.deepEqual(h.events.slice(0, 3), [
    ['position', { x: 400, y: 400 }],
    ['position', { x: 100, y: 599 }],
    ['scroll', 'down', 3],
  ]);
});
test('bounds are read again before each pointer event', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  h.sources = [source({ bounds: { x: -800, y: 20, width: 800, height: 600 } })];
  await h.session.input(sessionId, { action: 'move', x: 1000, y: 0 });
  assert.deepEqual(h.events[0], ['position', { x: -1, y: 20 }]);
});
test('same title with a new window ID cannot take over the video target', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  h.sources = [source({ id: 'window:99:0', nativeId: 99 })];
  await h.session.refresh();
  await assert.rejects(
    h.session.input(sessionId, { action: 'text', text: 'x' })
  );
  assert.equal(h.events.length, 0);
});
test('PID reuse or bundle mismatch invalidates input', async () => {
  for (const change of [{ ownerPid: 77 }, { bundleId: 'com.google.Chrome' }]) {
    const h = harness();
    const { sessionId } = await h.session.begin('window:10:0');
    h.sources = [source(change)];
    await assert.rejects(
      h.session.input(sessionId, { action: 'text', text: 'x' })
    );
    assert.equal(h.events.length, 0);
  }
});
test('enumeration error clears the session', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  h.listError = new Error('Capture denied');
  await assert.rejects(h.session.refresh());
  await assert.rejects(
    h.session.input(sessionId, { action: 'text', text: 'x' })
  );
});
test('focus denial blocks system input', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  h.focusError = new Error('Accessibility denied');
  await assert.rejects(
    h.session.input(sessionId, { action: 'move', x: 0, y: 0 })
  );
  assert.equal(h.events.length, 0);
});
test('disconnect invalidates input already awaiting focus', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  let release;
  h.focusWait = new Promise((resolve) => {
    release = resolve;
  });
  const input = h.session.input(sessionId, { action: 'text', text: 'late' });
  const rejection = assert.rejects(input);
  await tick();
  const ended = h.session.end(sessionId);
  release();
  await rejection;
  await ended;
  assert.equal(h.events.length, 0);
});
test('down, move and up remain ordered even while focus awaits', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  let release;
  h.focusWait = new Promise((resolve) => {
    release = resolve;
  });
  const pending = [
    h.session.input(sessionId, { action: 'down', x: 0, y: 0 }),
    h.session.input(sessionId, { action: 'move', x: 500, y: 500 }),
    h.session.input(sessionId, { action: 'up', x: 1000, y: 1000 }),
  ];
  await tick();
  assert.equal(h.focusCalls, 1);
  release();
  await Promise.all(pending);
  assert.deepEqual(
    h.events.map(([action]) => action),
    ['position', 'down', 'position', 'position', 'up']
  );
});
test('disconnect releases held modifiers and mouse buttons', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  await h.session.input(sessionId, { action: 'keysDown', keys: [1, 2] });
  await h.session.input(sessionId, { action: 'down', x: 0, y: 0 });
  await h.session.end(sessionId);
  assert.ok(h.events.some(([action]) => action === 'keysUp'));
  assert.ok(h.events.some(([action]) => action === 'up'));
});
test('stopping an obsolete session does not stop a new capture', async () => {
  const h = harness();
  const first = await h.session.begin('window:10:0');
  const second = await h.session.begin('window:10:0');
  await h.session.end(first.sessionId);
  await h.session.input(second.sessionId, { action: 'text', text: 'current' });
  assert.deepEqual(h.events, [['text', 'current']]);
});
test('a cancelled capture lookup cannot create a new session', async () => {
  const h = harness();
  let release;
  h.listWait = new Promise((resolve) => {
    release = resolve;
  });
  const starting = h.session.begin('window:10:0');
  const rejection = assert.rejects(starting);
  await tick();
  const ended = h.session.end();
  release();
  await rejection;
  await ended;
  assert.equal((await h.session.refresh()).sessionId, '');
});
test('obsolete enumeration success or failure cannot end a newer capture', async () => {
  for (const fail of [false, true]) {
    const h = harness();
    await h.session.begin('window:10:0');
    let finish;
    h.session.list = () =>
      new Promise((resolve, reject) => {
        finish = () =>
          fail ? reject(new Error('Old enumeration failed')) : resolve([]);
      });
    const refresh = h.session.refresh();
    const result = fail ? assert.rejects(refresh) : refresh;
    h.session.list = async () => h.sources;
    const current = await h.session.begin('window:10:0');
    finish();
    await result;
    await h.session.input(current.sessionId, {
      action: 'text',
      text: 'current',
    });
    assert.deepEqual(h.events, [['text', 'current']]);
  }
});
test('malformed keys and oversized text never reach the native driver', async () => {
  for (const input of [
    { action: 'keysDown', keys: ['a'] },
    { action: 'keysDown', keys: [9999] },
    { action: 'text', text: 'x'.repeat(4097) },
  ]) {
    const h = harness();
    const { sessionId } = await h.session.begin('window:10:0');
    await assert.rejects(h.session.input(sessionId, input));
    assert.equal(h.events.length, 0);
  }
});
