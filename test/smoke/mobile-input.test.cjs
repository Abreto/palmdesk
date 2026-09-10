const assert = require('node:assert/strict');
const test = require('node:test');

const load = require('./load-source.cjs');

const { createPanController, createPointerController } = load(
  'src/utils/controller-input.ts'
);
const { remoteInput, videoPoint } = load('src/utils/remote-input.ts');
const { CaptureLifecycle } = load('src/utils/capture-lifecycle.ts');
const { BilldDeskBehaviorEnum: Behavior } = load('src/types/websocket.ts');

function controller(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = {
    enabled: true,
    mode: 'tap',
    messages: [],
    singleClick: false,
    verticalScroll: false,
  };
  state.pointer = createPointerController({
    send: (message) => state.messages.push(message),
    enabled: () => state.enabled,
    mode: () => state.mode,
    singleClick: () => state.singleClick,
    verticalScroll: () => state.verticalScroll,
    point: (event, clamp) =>
      videoPoint(
        { left: 20, top: 40, width: 400, height: 200 },
        event.clientX,
        event.clientY,
        clamp
      ),
  });
  return state;
}
const event = (x = 220, y = 140) => ({
  pointerId: 1,
  button: 0,
  clientX: x,
  clientY: y,
});

function panController(t) {
  t.mock.timers.enable({ apis: ['Date'] });
  const state = { enabled: true, messages: [], pans: [] };
  state.pointer = createPanController({
    send: (message) => state.messages.push(message),
    enabled: () => state.enabled,
    point: (input) =>
      videoPoint(
        { left: 20, top: 40, width: 400, height: 200 },
        input.clientX,
        input.clientY
      ),
    pan: (x, y) => state.pans.push([x, y]),
  });
  return state;
}

test('pan mode selects a task with one immediate tap, including finger jitter', (t) => {
  const h = panController(t);
  const touch = (x, y) => ({ ...event(x, y), pointerType: 'touch' });
  assert.equal(h.pointer.down(touch(220, 140)), false);
  h.pointer.move(touch(222, 142));
  h.pointer.up(touch(222, 142));
  h.pointer.lostCapture();
  h.pointer.down(touch(220, 140));
  h.pointer.up(touch(220, 140));
  assert.deepEqual(h.messages, [
    { type: Behavior.leftClick, x: 500, y: 500 },
    { type: Behavior.leftClick, x: 500, y: 500 },
  ]);
  assert.deepEqual(h.pans, []);
});

test('pan mode keeps touch scrolling native and never clicks after a swipe', (t) => {
  const h = panController(t);
  const touch = (x, y) => ({ ...event(x, y), pointerType: 'touch' });
  h.pointer.down(touch(220, 140));
  h.pointer.move(touch(190, 140));
  h.pointer.move(touch(220, 140));
  h.pointer.up(touch(220, 140));
  h.pointer.down(touch(220, 140));
  h.pointer.cancel();
  h.pointer.up(touch(220, 140));
  // A coalesced move that arrives only with pointerup is also a swipe.
  h.pointer.down(touch(220, 140));
  h.pointer.up(touch(190, 140));
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.pans, []);
});

test('mouse dragging pans locally even from a letterbox and never presses the host mouse', (t) => {
  const h = panController(t);
  assert.equal(h.pointer.down(event(10, 80)), true);
  h.pointer.move(event(40, 90));
  h.pointer.move(event(60, 95));
  h.pointer.up(event(60, 95));
  assert.deepEqual(h.pans, [
    [-30, -10],
    [-20, -5],
  ]);
  assert.deepEqual(h.messages, []);
});

test('watch-only or paused control allows panning but cannot click, including a mid-gesture pause', (t) => {
  const h = panController(t);
  h.enabled = false;
  h.pointer.down(event());
  h.pointer.up(event());
  h.pointer.down(event());
  h.pointer.move(event(190, 140));
  h.pointer.up(event(190, 140));
  h.enabled = true;
  h.pointer.down(event());
  h.enabled = false;
  h.pointer.up(event());
  // Resuming control during a read-only gesture must not turn it into a click.
  h.pointer.down(event());
  h.enabled = true;
  h.pointer.up(event());
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.pans, [[30, 0]]);
});

test('pan mode ignores long presses, multiple fingers, letterboxes, and canceled gestures', (t) => {
  const h = panController(t);
  h.pointer.down(event());
  t.mock.timers.tick(550);
  h.pointer.up(event());
  h.pointer.down(event());
  h.pointer.down({ ...event(), pointerId: 2, isPrimary: false });
  h.pointer.up(event());
  h.pointer.up({ ...event(), pointerId: 2 });
  h.pointer.down(event(10, 80));
  h.pointer.up(event(10, 80));
  h.pointer.down(event(21, 80));
  h.pointer.up(event(19, 80));
  h.pointer.down(event());
  h.pointer.cancel();
  h.pointer.up(event());
  assert.deepEqual(h.messages, []);
  h.pointer.down(event());
  h.pointer.up(event());
  assert.equal(h.messages.length, 1);
});

test('stopping scrolling cannot click a task, and a later deliberate tap still works', (t) => {
  const h = panController(t);
  h.pointer.down(event());
  h.pointer.scrolled();
  h.pointer.up(event());
  h.pointer.down(event());
  h.pointer.up(event());
  assert.deepEqual(h.messages, []);
  t.mock.timers.tick(160);
  h.pointer.down(event());
  h.pointer.up(event());
  assert.deepEqual(h.messages, [{ type: Behavior.leftClick, x: 500, y: 500 }]);
});

test('single touch survives normal lostpointercapture and sends one click', (t) => {
  const h = controller(t);
  h.pointer.down(event());
  h.pointer.up(event());
  h.pointer.lostCapture();
  t.mock.timers.tick(250);
  assert.deepEqual(
    h.messages.map((m) => m.type),
    [Behavior.leftClick]
  );
  assert.equal(h.messages[0].x, 500);
});
test('double touch emits a double click without a preceding single click', (t) => {
  const h = controller(t);
  h.pointer.down(event());
  h.pointer.up(event());
  t.mock.timers.tick(100);
  h.pointer.down(event());
  h.pointer.up(event());
  t.mock.timers.tick(300);
  assert.deepEqual(
    h.messages.map((m) => m.type),
    [Behavior.doubleClick]
  );
});
test('two fast taps at different positions are both retained', (t) => {
  const h = controller(t);
  h.pointer.down(event(30, 50));
  h.pointer.up(event(30, 50));
  h.pointer.down(event(400, 220));
  h.pointer.up(event(400, 220));
  t.mock.timers.tick(300);
  assert.deepEqual(
    h.messages.map((m) => m.type),
    [Behavior.leftClick, Behavior.leftClick]
  );
});
test('long touch emits a right click and suppresses the following tap', (t) => {
  const h = controller(t);
  const touch = { ...event(), pointerType: 'touch' };
  h.pointer.down(touch);
  t.mock.timers.tick(550);
  h.pointer.up(touch);
  t.mock.timers.tick(300);
  assert.deepEqual(
    h.messages.map((m) => m.type),
    [Behavior.rightClick]
  );
});
test('drag clamps to video edges and releases once', (t) => {
  const h = controller(t);
  h.mode = 'drag';
  h.pointer.down(event());
  h.pointer.move(event(600, 400));
  h.pointer.up(event(600, 400));
  h.pointer.lostCapture();
  assert.deepEqual(
    h.messages.map((m) => m.type),
    [Behavior.pressButtonLeft, Behavior.mouseMove, Behavior.releaseButtonLeft]
  );
  assert.equal(h.messages[2].x, 1000);
  assert.equal(h.messages[2].y, 1000);
});
test('touch scrolling carries a point within the selected video and no mouse press', (t) => {
  const h = controller(t);
  h.mode = 'scroll';
  h.pointer.down(event());
  h.pointer.move(event(220, 116));
  h.pointer.up(event(220, 116));
  assert.deepEqual(
    h.messages.map((m) => m.type),
    [Behavior.scrollDown]
  );
  assert.equal(h.messages[0].x, 500);
  assert.equal(h.messages[0].amount, 144);
});
test('touch scrolling retains subpixel movement at the increased gain', (t) => {
  const h = controller(t);
  h.mode = 'scroll';
  h.pointer.down(event());
  h.pointer.move(event(220, 139.9375));
  h.pointer.move(event(220, 139.875));
  assert.equal(h.messages.length, 0);
  h.pointer.move(event(220, 139.8125));
  h.pointer.up(event(220, 139.8125));
  assert.deepEqual(
    h.messages.map((m) => [m.type, m.amount]),
    [[Behavior.scrollDown, 1]]
  );
});
test('touch scroll reversal resets the remainder and a new gesture starts cleanly', (t) => {
  const h = controller(t);
  h.mode = 'scroll';
  h.pointer.down(event());
  h.pointer.move(event(220, 139.875));
  h.pointer.move(event(220, 139.9375));
  assert.equal(h.messages.length, 0);
  h.pointer.move(event(220, 140.0625));
  assert.deepEqual(
    h.messages.map((m) => [m.type, m.amount]),
    [[Behavior.scrollUp, 1]]
  );
  h.pointer.cancel();
  h.messages.length = 0;
  h.pointer.down(event());
  h.pointer.move(event(220, 140.125));
  assert.equal(h.messages.length, 0);
});
test('horizontal and vertical scrolling retain independent distances', (t) => {
  const h = controller(t);
  h.mode = 'scroll';
  h.pointer.down(event());
  h.pointer.move(event(222, 136));
  assert.deepEqual(
    h.messages.map((m) => [m.type, m.amount]),
    [
      [Behavior.scrollDown, 24],
      [Behavior.scrollLeft, 12],
    ]
  );
});
test('a slightly moving finger still selects a task immediately', (t) => {
  const h = controller(t);
  h.mode = 'scroll';
  h.singleClick = true;
  const touch = (x, y) => ({ ...event(x, y), pointerType: 'touch' });
  h.pointer.down(touch(220, 140));
  h.pointer.move(touch(222, 142));
  h.pointer.up(touch(222, 142));
  assert.deepEqual(
    h.messages.map((m) => m.type),
    [Behavior.leftClick]
  );
  assert.equal(h.messages[0].x, 500);
  assert.equal(h.messages[0].y, 500);
  h.pointer.cancel();
  t.mock.timers.tick(300);
  assert.equal(h.messages.length, 1);
});
test('task scrolling accumulates movement, ignores horizontal drift, and never clicks', (t) => {
  const h = controller(t);
  h.mode = 'scroll';
  h.singleClick = true;
  h.verticalScroll = true;
  const touch = (x, y) => ({ ...event(x, y), pointerType: 'touch' });
  h.pointer.down(touch(220, 140));
  h.pointer.move(touch(221, 138));
  h.pointer.move(touch(222, 136));
  assert.equal(h.messages.length, 0);
  h.pointer.move(touch(222, 128));
  h.pointer.up(touch(222, 128));
  t.mock.timers.tick(300);
  assert.deepEqual(
    h.messages.map((m) => [m.type, m.amount]),
    [[Behavior.scrollDown, 72]]
  );
  assert.equal(h.messages[0].x, 500);
});
test('a horizontal swipe on the task list is not mistaken for a selection', (t) => {
  const h = controller(t);
  h.mode = 'scroll';
  h.singleClick = true;
  h.verticalScroll = true;
  h.pointer.down({ ...event(), pointerType: 'touch' });
  h.pointer.move({ ...event(260, 140), pointerType: 'touch' });
  h.pointer.up({ ...event(260, 140), pointerType: 'touch' });
  t.mock.timers.tick(300);
  assert.equal(h.messages.length, 0);
});
test('successive task selections never become a double click', (t) => {
  const h = controller(t);
  h.singleClick = true;
  h.pointer.down(event());
  h.pointer.up(event());
  h.pointer.down(event());
  h.pointer.up(event());
  assert.deepEqual(
    h.messages.map((m) => m.type),
    [Behavior.leftClick, Behavior.leftClick]
  );
});
test('cancel releases a held button even after switching to watch mode', (t) => {
  const h = controller(t);
  h.mode = 'drag';
  h.pointer.down(event());
  h.enabled = false;
  h.pointer.cancel();
  assert.equal(h.messages.at(-1).type, Behavior.releaseAll);
  h.messages.length = 0;
  h.pointer.down(event());
  h.pointer.move(event());
  h.pointer.up(event());
  h.pointer.context(event());
  t.mock.timers.tick(300);
  assert.equal(h.messages.length, 0);
});
test('letterbox clicks and empty video bounds are ignored', () => {
  assert.equal(
    videoPoint({ left: 20, top: 40, width: 400, height: 200 }, 10, 80),
    null
  );
  assert.equal(
    videoPoint({ left: 0, top: 0, width: 0, height: 0 }, 0, 0),
    null
  );
});
test('text payload preserves composed Chinese, spaces and newlines', () => {
  assert.deepEqual(
    remoteInput({ type: Behavior.keyboardType, text: '你好 Codex\nnext task' }),
    { action: 'text', text: '你好 Codex\nnext task' }
  );
  assert.equal(remoteInput({ type: 99999 }), null);
});

function stream() {
  const track = {
    readyState: 'live',
    stop() {
      this.readyState = 'ended';
    },
  };
  return { getTracks: () => [track], track };
}
test('disconnect during asynchronous capture stops the late stream', async () => {
  const lifecycle = new CaptureLifecycle();
  let resolve;
  const captured = stream();
  const pending = lifecycle.start(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  lifecycle.stop();
  resolve(captured);
  assert.equal(await pending, undefined);
  assert.equal(captured.track.readyState, 'ended');
});
test('reconnect cannot reuse the previous or late-arriving media stream', async () => {
  const lifecycle = new CaptureLifecycle();
  let resolve;
  const first = stream();
  const second = stream();
  const pending = lifecycle.start(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  assert.equal(await lifecycle.start(() => Promise.resolve(second)), second);
  resolve(first);
  assert.equal(await pending, undefined);
  assert.equal(first.track.readyState, 'ended');
  assert.equal(second.track.readyState, 'live');
  lifecycle.stop();
  assert.equal(second.track.readyState, 'ended');
});
