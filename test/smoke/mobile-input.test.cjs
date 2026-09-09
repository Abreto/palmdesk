const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-source.cjs');
const { createPointerController } = load('src/utils/controller-input.ts');
const { remoteInput, videoPoint } = load('src/utils/remote-input.ts');
const { CaptureLifecycle } = load('src/utils/capture-lifecycle.ts');
const { BilldDeskBehaviorEnum: Behavior } = load('src/types/websocket.ts');

function controller(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = { enabled: true, mode: 'tap', messages: [] };
  state.pointer = createPointerController({
    send: (message) => state.messages.push(message),
    enabled: () => state.enabled,
    mode: () => state.mode,
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
  assert.equal(await lifecycle.start(async () => second), second);
  resolve(first);
  assert.equal(await pending, undefined);
  assert.equal(first.track.readyState, 'ended');
  assert.equal(second.track.readyState, 'live');
  lifecycle.stop();
  assert.equal(second.track.readyState, 'ended');
});
