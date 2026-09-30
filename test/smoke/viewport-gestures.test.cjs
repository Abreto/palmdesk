const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-source.cjs');
const { createViewportGestures } = load('src/utils/viewport-gestures.ts');
const { createPointerController } = load('src/utils/controller-input.ts');
const { videoPoint } = load('src/utils/remote-input.ts');
const { BilldDeskBehaviorEnum: Behavior } = load('src/types/websocket.ts');

const touch = (pointerId, clientX = 120, clientY = 120) => ({
  pointerId,
  clientX,
  clientY,
  button: 0,
  pointerType: 'touch',
});
function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = {
    zoom: 1,
    rect: { left: 20, top: 40, width: 400, height: 200 },
    mode: 'tap',
    localPan: false,
    messages: [],
    zooms: [],
    pans: [],
  };
  const pointer = createPointerController({
    enabled: () => !h.localPan && !gestures.active(),
    mode: () => h.mode,
    point: (event, clamp) =>
      videoPoint(h.rect, event.clientX, event.clientY, clamp),
    send: (data) => h.messages.push(data),
  });
  const gestures = createViewportGestures({
    view: () => ({ zoom: h.zoom, rect: h.rect }),
    localPan: () => h.localPan,
    cancelInput: pointer.cancel,
    zoomAt: (zoom, anchor, center) => {
      const width = (h.rect.width * zoom) / h.zoom;
      const height = (h.rect.height * zoom) / h.zoom;
      h.rect = {
        width,
        height,
        left: center.clientX - anchor.x * width,
        top: center.clientY - anchor.y * height,
      };
      h.zoom = zoom;
      h.zooms.push({ zoom, anchor, center });
    },
    panBy: (x, y) => h.pans.push({ x, y }),
  });
  return Object.assign(h, {
    gestures,
    down: (event) => {
      if (!gestures.down(event)) pointer.down(event);
    },
    move: (event) => {
      if (!gestures.move(event)) pointer.move(event);
    },
    up: (event) => {
      if (!gestures.up(event)) pointer.up(event);
    },
    lost: (event) => {
      if (!gestures.cancel(event)) pointer.lostCapture();
    },
    reset: () => {
      pointer.cancel();
      gestures.reset();
    },
  });
}

test('pinch keeps an off-center video point under the moving midpoint', (t) => {
  const h = harness(t);
  h.down(touch(1));
  h.down(touch(2, 220));
  h.move(touch(1, 70, 140));
  h.move(touch(2, 270, 140));
  assert.deepEqual(h.zooms.at(-1), {
    zoom: 2,
    anchor: { x: 0.375, y: 0.4 },
    center: { clientX: 170, clientY: 140 },
  });
  assert.deepEqual(videoPoint(h.rect, 170, 140), { x: 375, y: 400 });
  h.up(touch(1, 70, 140));
  h.up(touch(2, 270, 140));
  t.mock.timers.tick(600);
  assert.deepEqual(h.messages, []);
});

test('pinch is bounded by fit and 300%, and reversing can return to fit', (t) => {
  const h = harness(t);
  h.down(touch(1));
  h.down(touch(2, 220));
  h.move(touch(2, 720));
  assert.equal(h.zoom, 3);
  h.move(touch(2, 320));
  assert.equal(h.zoom, 2);
  h.move(touch(2, 130));
  assert.equal(h.zoom, 1);
});

test('pinching cancels queued taps and long-press timers', (t) => {
  const h = harness(t);
  h.down(touch(1));
  h.up(touch(1));
  t.mock.timers.tick(50);
  h.down(touch(2));
  h.down(touch(3, 220));
  t.mock.timers.tick(600);
  h.up(touch(2));
  h.lost(touch(2));
  h.up(touch(3));
  h.lost(touch(3));
  t.mock.timers.tick(300);
  assert.deepEqual(h.messages, []);
});

test('a second finger releases an existing remote drag exactly once', (t) => {
  const h = harness(t);
  h.mode = 'drag';
  h.down(touch(1));
  h.down(touch(2, 220));
  h.move(touch(2, 270));
  h.up(touch(1));
  h.lost(touch(1));
  h.move(touch(2, 250, 150));
  h.up(touch(2));
  h.lost(touch(2));
  t.mock.timers.tick(600);
  assert.deepEqual(
    h.messages.map((data) => data.type),
    [Behavior.pressButtonLeft, Behavior.releaseAll]
  );
  assert.deepEqual(h.pans, [{ x: 20, y: -30 }]);
});

test('two-finger navigation never scrolls the remote application', (t) => {
  const h = harness(t);
  h.mode = 'scroll';
  h.down(touch(1));
  h.down(touch(2, 220));
  h.move(touch(1, 100, 100));
  h.move(touch(2, 200, 100));
  h.up(touch(1));
  h.up(touch(2));
  t.mock.timers.tick(300);
  assert.equal(h.zoom, 1);
  assert.deepEqual(h.messages, []);
});

test('fresh taps after zoom use the displayed video coordinates', (t) => {
  const h = harness(t);
  h.down(touch(1));
  h.down(touch(2, 220));
  h.move(touch(2, 320));
  h.up(touch(1));
  h.up(touch(2));
  const target = touch(3, h.rect.left + h.rect.width * 0.7, 120);
  h.down(target);
  h.up(target);
  h.lost(target);
  t.mock.timers.tick(300);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].type, Behavior.leftClick);
  assert.equal(h.messages[0].x, 700);
});

test('pan and watch-only modes allow one-finger local panning', (t) => {
  const h = harness(t);
  h.localPan = true;
  h.down(touch(1));
  h.move(touch(1, 100, 90));
  h.up(touch(1));
  t.mock.timers.tick(600);
  assert.deepEqual(h.pans, [{ x: 20, y: 30 }]);
  assert.deepEqual(h.messages, []);
});

test('cancellation or lost capture suppresses the remaining finger', (t) => {
  const h = harness(t);
  h.down(touch(1));
  h.down(touch(2, 220));
  h.lost(touch(1));
  h.move(touch(2, 260));
  h.up(touch(2));
  t.mock.timers.tick(600);
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.zooms, []);
  assert.deepEqual(h.pans, []);
  h.down(touch(3));
  h.up(touch(3));
  t.mock.timers.tick(300);
  assert.equal(h.messages[0].type, Behavior.leftClick);
});

test('reset ignores orphaned touch moves and releases without blocking a fresh tap', (t) => {
  const h = harness(t);
  h.down(touch(1));
  h.down(touch(2, 220));
  h.reset();
  h.move(touch(1, 100));
  h.up(touch(1));
  h.up(touch(2));
  t.mock.timers.tick(600);
  assert.deepEqual(h.messages, []);
  h.down(touch(3));
  h.up(touch(3));
  t.mock.timers.tick(300);
  assert.equal(h.messages[0].type, Behavior.leftClick);
});

test('replacing a finger in a three-touch gesture rebases without a zoom jump', (t) => {
  const h = harness(t);
  h.down(touch(1));
  h.down(touch(2, 220));
  h.move(touch(2, 320));
  h.down(touch(3, 270));
  h.up(touch(1));
  h.move(touch(3, 270));
  assert.equal(h.zoom, 2);
  h.up(touch(2));
  h.up(touch(3));
  t.mock.timers.tick(600);
  assert.deepEqual(h.messages, []);
});

test('coincident touches do not create an infinite scale', (t) => {
  const h = harness(t);
  h.down(touch(1));
  h.down(touch(2));
  h.move(touch(2, 220));
  h.move(touch(2, 270));
  assert.equal(h.zoom, 1.5);
});

test('mouse clicks retain the existing remote pointer behavior', (t) => {
  const h = harness(t);
  const mouse = { ...touch(1), pointerType: 'mouse' };
  h.down(mouse);
  h.up(mouse);
  h.lost(mouse);
  t.mock.timers.tick(300);
  assert.equal(h.messages[0].type, Behavior.leftClick);
});
