const assert = require('node:assert/strict');
const test = require('node:test');

const load = require('./load-source.cjs');

const {
  ESCAPE_HOLD_MS,
  createKeyboardController,
  createMouseController,
  interactionProfile,
  localShortcut,
  parseInteractionMode,
  remoteKey,
} = load('src/utils/controller-input.ts');
const { videoPoint } = load('src/utils/remote-input.ts');
const { BilldDeskBehaviorEnum: Behavior } = load('src/types/websocket.ts');

test('auto mode follows the primary pointer, and overrides win', () => {
  const laptop = { finePointer: true, hover: true };
  const phone = { finePointer: false, hover: false };
  // A pen-only tablet has a fine pointer that cannot hover.
  const pen = { finePointer: true, hover: false };
  assert.equal(interactionProfile('auto', laptop), 'desktop');
  assert.equal(interactionProfile('auto', phone), 'touch');
  assert.equal(interactionProfile('auto', pen), 'touch');
  assert.equal(interactionProfile('touch', laptop), 'touch');
  assert.equal(interactionProfile('desktop', phone), 'desktop');
});
test('saved interaction modes are validated', () => {
  assert.equal(parseInteractionMode('desktop'), 'desktop');
  assert.equal(parseInteractionMode('touch'), 'touch');
  [null, undefined, '', 'mouse', 'DESKTOP', 1, {}].forEach((value) =>
    assert.equal(parseInteractionMode(value), 'auto')
  );
});

function mouse() {
  const state = { enabled: true, messages: [] };
  state.mouse = createMouseController({
    send: (message) => state.messages.push(message),
    enabled: () => state.enabled,
    point: (event, clamp) =>
      videoPoint(
        { left: 20, top: 40, width: 400, height: 200 },
        event.clientX,
        event.clientY,
        clamp
      ),
  });
  state.sent = () =>
    state.messages.map((m) => [Behavior[m.type], m.x, m.y].join(' '));
  return state;
}
const at = (clientX, clientY, timeStamp = 0, button = 0) => ({
  pointerId: 1,
  pointerType: 'mouse',
  button,
  clientX,
  clientY,
  timeStamp,
});
function click(h, x, y, time) {
  h.mouse.down(at(x, y, time));
  h.mouse.up(at(x, y, time + 60));
}

test('a mouse click presses and releases at once, at the pressed point', () => {
  const h = mouse();
  assert.equal(h.mouse.down(at(220, 140)), true);
  h.mouse.move(at(221, 141, 10));
  h.mouse.up(at(222, 141, 40));
  assert.deepEqual(h.sent(), [
    'pressButtonLeft 500 500',
    'releaseButtonLeft 500 500',
  ]);
});
test('a nearby second press within the double-click time repeats the position', () => {
  const h = mouse();
  click(h, 220, 140, 0);
  click(h, 222, 141, 300);
  assert.deepEqual(h.sent(), [
    'pressButtonLeft 500 500',
    'releaseButtonLeft 500 500',
    'pressButtonLeft 500 500',
    'releaseButtonLeft 500 500',
  ]);
  h.messages.length = 0;
  // Too late, then too far: each press keeps its own position.
  click(h, 222, 141, 900);
  click(h, 230, 141, 1000);
  assert.deepEqual(h.sent(), [
    'pressButtonLeft 505 505',
    'releaseButtonLeft 505 505',
    'pressButtonLeft 525 505',
    'releaseButtonLeft 525 505',
  ]);
});
test('dragging moves past the threshold and releases at the clamped end', () => {
  const h = mouse();
  h.mouse.down(at(220, 140));
  h.mouse.move(at(222, 140, 10));
  assert.equal(h.messages.length, 1);
  h.mouse.move(at(260, 140, 20));
  h.mouse.move(at(600, 400, 30));
  h.mouse.up(at(600, 400, 40));
  assert.deepEqual(h.sent(), [
    'pressButtonLeft 500 500',
    'mouseMove 600 500',
    'mouseMove 1000 1000',
    'releaseButtonLeft 1000 1000',
  ]);
  h.messages.length = 0;
  // A drag is not the first half of a double click.
  click(h, 222, 140, 100);
  assert.equal(h.sent()[0], 'pressButtonLeft 505 500');
});
test('the right button sends one right click without holding a button', () => {
  const h = mouse();
  assert.equal(h.mouse.down(at(220, 140, 0, 2)), false);
  h.mouse.up(at(220, 140, 50, 2));
  h.mouse.down(at(220, 140, 100, 1));
  assert.deepEqual(h.sent(), ['rightClick 500 500']);
  assert.equal(h.mouse.pressed(), false);
});
test('hover skips letterbox points and unchanged positions', () => {
  const h = mouse();
  h.mouse.move(at(220, 140));
  h.mouse.move(at(220.1, 140));
  h.mouse.move(at(10, 80));
  h.mouse.move(at(240, 140));
  assert.deepEqual(h.sent(), ['mouseMove 500 500', 'mouseMove 550 500']);
});
test('cancel releases a held button and forgets the double-click position', () => {
  const h = mouse();
  click(h, 220, 140, 0);
  h.mouse.cancel();
  assert.equal(h.messages.length, 2, 'nothing to release after a click');
  h.mouse.down(at(222, 141, 100));
  h.mouse.cancel();
  assert.deepEqual(h.sent().slice(2), [
    'pressButtonLeft 505 505',
    'releaseAll  ',
  ]);
  h.messages.length = 0;
  h.mouse.up(at(222, 141, 150));
  assert.deepEqual(h.messages, []);
});
test('disabled input and letterbox presses send and capture nothing', () => {
  const h = mouse();
  h.enabled = false;
  assert.equal(h.mouse.down(at(220, 140)), false);
  h.mouse.move(at(230, 140));
  h.enabled = true;
  assert.equal(h.mouse.down(at(10, 80)), false);
  h.mouse.up(at(10, 80));
  assert.deepEqual(h.messages, []);
  // A second pointer while one is pressed abandons both.
  h.mouse.down(at(220, 140));
  assert.equal(h.mouse.down({ ...at(230, 140), pointerId: 2 }), false);
  assert.deepEqual(h.sent(), ['pressButtonLeft 500 500', 'releaseAll  ']);
});

// @nut-tree-fork/shared Key values for the keys these tests use.
const keys = {
  Escape: 0,
  Tab: 49,
  ShiftLeft: 86,
  ControlLeft: 103,
  MetaLeft: 106,
  CapsLock: 70,
  Home: 43,
  Enter: 102,
  NumpadEnter: 102,
  A: 71,
  V: 90,
  W: 51,
  1: 29,
  ',': 94,
};
test('keys map by code, then character, then physical position', () => {
  const map = (code, key) => remoteKey({ code, key }, keys);
  assert.equal(map('Escape', 'Escape'), keys.Escape);
  assert.equal(map('KeyA', 'a'), keys.A);
  assert.equal(map('KeyA', 'A'), keys.A);
  assert.equal(map('Digit1', '!'), keys[1], 'shifted digit');
  assert.equal(map('Comma', '<'), keys[','], 'shifted punctuation');
  assert.equal(map('KeyA', 'ф'), keys.A, 'non-Latin layout');
  assert.equal(map('KeyA', 'Dead'), keys.A, 'dead key');
  assert.equal(map('KeyM', ','), keys[','], 'AZERTY comma keeps its meaning');
  assert.equal(map('NumpadEnter', 'Enter'), keys.Enter);
  assert.equal(map('Numpad7', 'Home'), keys.Home, 'numpad without Num Lock');
  assert.equal(map('ContextMenu', 'ContextMenu'), undefined);
  assert.equal(map('', 'constructor'), undefined);
});

function keyboard(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = { enabled: true, messages: [], exits: 0 };
  state.keyboard = createKeyboardController({
    send: (message) => state.messages.push(message),
    enabled: () => state.enabled,
    key: (event) => remoteKey(event, keys),
    escape: keys.Escape,
    exit: () => {
      state.exits += 1;
    },
    ...options,
  });
  state.sent = () =>
    state.messages.map((m) => [
      Behavior[m.type] === 'keyboardPressKey' ? 'down' : 'up',
      m.key[0],
    ]);
  return state;
}
const key = (code, value = code, extra = {}) => ({
  code,
  key: value,
  ...extra,
});

test('releases match their physical key even when the character changed', (t) => {
  const h = keyboard(t);
  assert.equal(h.keyboard.down(key('ShiftLeft', 'Shift')), true);
  h.keyboard.down(key('Digit1', '!', { shiftKey: true }));
  assert.equal(h.keyboard.holds(keys.ShiftLeft), true);
  h.keyboard.up(key('ShiftLeft', 'Shift'));
  assert.equal(h.keyboard.up(key('Digit1', '1')), true);
  assert.deepEqual(h.sent(), [
    ['down', keys.ShiftLeft],
    ['down', keys[1]],
    ['up', keys.ShiftLeft],
    ['up', keys[1]],
  ]);
});
test('auto-repeat is forwarded; unmapped, composing and disabled keys are not', (t) => {
  const h = keyboard(t);
  h.keyboard.down(key('KeyA', 'a'));
  h.keyboard.down(key('KeyA', 'a', { repeat: true }));
  h.keyboard.up(key('KeyA', 'a'));
  assert.deepEqual(h.sent(), [
    ['down', keys.A],
    ['down', keys.A],
    ['up', keys.A],
  ]);
  h.messages.length = 0;
  assert.equal(h.keyboard.down(key('KeyA', 'Process')), false);
  assert.equal(h.keyboard.down(key('KeyA', 'a', { isComposing: true })), false);
  assert.equal(h.keyboard.down(key('ContextMenu')), false);
  assert.equal(h.keyboard.up(key('KeyA', 'a')), false);
  h.enabled = false;
  assert.equal(h.keyboard.down(key('KeyA', 'a')), false);
  assert.deepEqual(h.messages, []);
});
test('a short Escape is sent on release; holding it leaves without sending', (t) => {
  const h = keyboard(t);
  assert.equal(h.keyboard.down(key('Escape')), true);
  assert.deepEqual(h.messages, []);
  t.mock.timers.tick(100);
  h.keyboard.up(key('Escape'));
  assert.deepEqual(h.sent(), [
    ['down', keys.Escape],
    ['up', keys.Escape],
  ]);
  h.messages.length = 0;
  h.keyboard.down(key('Escape'));
  t.mock.timers.tick(ESCAPE_HOLD_MS - 1);
  assert.equal(
    h.keyboard.down(key('Escape', 'Escape', { repeat: true })),
    true
  );
  assert.equal(h.exits, 0);
  t.mock.timers.tick(1);
  assert.equal(h.exits, 1);
  assert.equal(h.keyboard.up(key('Escape')), false);
  assert.deepEqual(h.messages, []);
});
test('a modified Escape is sent at once', (t) => {
  const h = keyboard(t);
  h.keyboard.down(key('ShiftLeft', 'Shift'));
  h.keyboard.down(key('Escape', 'Escape', { shiftKey: true }));
  t.mock.timers.tick(ESCAPE_HOLD_MS * 2);
  h.keyboard.up(key('Escape'));
  h.keyboard.up(key('ShiftLeft', 'Shift'));
  assert.equal(h.exits, 0);
  assert.deepEqual(h.sent(), [
    ['down', keys.ShiftLeft],
    ['down', keys.Escape],
    ['up', keys.Escape],
    ['up', keys.ShiftLeft],
  ]);
});
test('a held Escape leaves even when an earlier keyup was lost', (t) => {
  const h = keyboard(t);
  h.keyboard.down(key('KeyA', 'a'));
  h.keyboard.down(key('Escape'));
  t.mock.timers.tick(ESCAPE_HOLD_MS);
  assert.equal(h.exits, 1);
  assert.deepEqual(h.sent(), [['down', keys.A]]);
});
test('keys pressed with Command are released with it', (t) => {
  // macOS sends no keyup for V when it is released before Command (Cmd+V).
  const h = keyboard(t);
  h.keyboard.down(key('MetaLeft', 'Meta', { metaKey: true }));
  h.keyboard.down(key('KeyV', 'v', { metaKey: true }));
  assert.equal(h.keyboard.up(key('MetaLeft', 'Meta')), true);
  h.keyboard.down(key('Escape'));
  t.mock.timers.tick(ESCAPE_HOLD_MS);
  assert.equal(h.exits, 1);
  assert.deepEqual(h.sent(), [
    ['down', keys.MetaLeft],
    ['down', keys.V],
    ['up', keys.V],
    ['up', keys.MetaLeft],
  ]);
  // Command pressed before the window view had focus still releases them.
  h.messages.length = 0;
  h.keyboard.down(key('KeyV', 'v', { metaKey: true }));
  assert.equal(h.keyboard.up(key('MetaLeft', 'Meta')), false);
  assert.deepEqual(h.sent(), [
    ['down', keys.V],
    ['up', keys.V],
  ]);
});
test('macOS Caps Lock toggles on keydown and on keyup, never held', (t) => {
  // macOS: keydown when Caps Lock locks, keyup only when it unlocks.
  const mac = keyboard(t, { locksToggleOnKeyup: true });
  mac.keyboard.down(key('CapsLock'));
  assert.equal(mac.keyboard.holds(keys.CapsLock), false);
  mac.keyboard.down(key('Escape'));
  t.mock.timers.tick(ESCAPE_HOLD_MS);
  assert.equal(mac.exits, 1);
  assert.equal(mac.keyboard.up(key('CapsLock')), true);
  assert.deepEqual(mac.sent(), [
    ['down', keys.CapsLock],
    ['up', keys.CapsLock],
    ['down', keys.CapsLock],
    ['up', keys.CapsLock],
  ]);
});
test('elsewhere a lock key toggles once per press', (t) => {
  // Each press sends a keydown and a keyup; only the keydown toggles.
  const other = keyboard(t);
  other.keyboard.down(key('CapsLock'));
  assert.equal(other.keyboard.up(key('CapsLock')), false);
  assert.deepEqual(other.sent(), [
    ['down', keys.CapsLock],
    ['up', keys.CapsLock],
  ]);
});
test('the controller keeps its own close and quit shortcuts', (t) => {
  const shortcut = (code, value, modifiers, mac) =>
    localShortcut({ code, key: value, ...modifiers }, mac);
  const meta = { metaKey: true };
  const ctrl = { ctrlKey: true };
  assert.equal(shortcut('KeyW', 'w', meta, true), true);
  assert.equal(shortcut('KeyQ', 'q', meta, true), true);
  assert.equal(shortcut('KeyW', 'W', { ...meta, shiftKey: true }, true), true);
  assert.equal(shortcut('KeyZ', 'w', meta, true), true, 'AZERTY Cmd+W');
  assert.equal(shortcut('KeyW', 'z', meta, true), false, 'AZERTY Cmd+Z');
  assert.equal(shortcut('KeyW', 'ц', meta, true), true, 'Russian layout');
  assert.equal(shortcut('KeyW', 'w', ctrl, true), false, 'terminal Ctrl+W');
  assert.equal(shortcut('KeyW', 'w', ctrl, false), true);
  assert.equal(shortcut('KeyQ', 'q', ctrl, false), true);
  assert.equal(shortcut('F4', 'F4', { altKey: true }, false), true);
  assert.equal(
    shortcut('KeyQ', '@', { ctrlKey: true, altKey: true }, false),
    false,
    'AltGr+Q types @'
  );
  assert.equal(shortcut('KeyW', 'w', meta, false), false);
  assert.equal(shortcut('KeyE', 'e', ctrl, false), false);
  const h = keyboard(t, { local: (event) => localShortcut(event, true) });
  h.keyboard.down(key('MetaLeft', 'Meta', { metaKey: true }));
  assert.equal(h.keyboard.down(key('KeyW', 'w', { metaKey: true })), false);
  assert.equal(h.keyboard.up(key('KeyW', 'w', { metaKey: true })), false);
  h.keyboard.up(key('MetaLeft', 'Meta'));
  assert.deepEqual(h.sent(), [
    ['down', keys.MetaLeft],
    ['up', keys.MetaLeft],
  ]);
});
test('another key during a pending Escape sends the Escape first', (t) => {
  const h = keyboard(t);
  h.keyboard.down(key('Escape'));
  h.keyboard.down(key('KeyA', 'a'));
  t.mock.timers.tick(ESCAPE_HOLD_MS * 2);
  h.keyboard.up(key('Escape'));
  h.keyboard.up(key('KeyA', 'a'));
  assert.equal(h.exits, 0);
  assert.deepEqual(h.sent(), [
    ['down', keys.Escape],
    ['down', keys.A],
    ['up', keys.Escape],
    ['up', keys.A],
  ]);
});
test('reset forgets held keys and a pending Escape', (t) => {
  const h = keyboard(t);
  h.keyboard.down(key('ControlLeft', 'Control'));
  assert.equal(h.keyboard.holds(keys.ControlLeft), true);
  h.keyboard.reset();
  assert.equal(h.keyboard.holds(keys.ControlLeft), false);
  h.keyboard.down(key('Escape'));
  h.keyboard.reset();
  t.mock.timers.tick(ESCAPE_HOLD_MS * 2);
  h.keyboard.up(key('Escape'));
  h.keyboard.up(key('ControlLeft', 'Control'));
  assert.equal(h.exits, 0);
  assert.deepEqual(h.sent(), [['down', keys.ControlLeft]]);
});
