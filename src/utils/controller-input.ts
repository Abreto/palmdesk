import { BilldDeskBehaviorEnum as Behavior } from '../types/websocket';

import type { WsBilldDeskBehaviorType } from '../types/websocket';

type Point = { x: number; y: number };
type Pointer = {
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  pointerType?: string;
};
type Send = (data: Partial<WsBilldDeskBehaviorType['data']>) => void;

export type InteractionMode = 'auto' | 'touch' | 'desktop';
export type InteractionProfile = Exclude<InteractionMode, 'auto'>;
export const INTERACTION_MODES: readonly InteractionMode[] = [
  'auto',
  'touch',
  'desktop',
];

export function parseInteractionMode(value: unknown): InteractionMode {
  return INTERACTION_MODES.find((mode) => mode === value) || 'auto';
}

// Follow the primary input device rather than the width, so a narrow desktop
// window keeps mouse controls and a wide tablet keeps touch controls.
export function interactionProfile(
  mode: InteractionMode,
  input: { finePointer: boolean; hover: boolean }
): InteractionProfile {
  if (mode !== 'auto') return mode;
  return input.finePointer && input.hover ? 'desktop' : 'touch';
}

// macOS scroll units are pixels; compensate for the desktop being reduced on phones.
const TOUCH_SCROLL_GAIN = 6;

type ScrollAccumulator = {
  direction: number;
  distance: number;
};

function scrollAmount(delta: number, accumulator: ScrollAccumulator) {
  const direction = Math.sign(delta);
  if (!direction) return 0;
  if (accumulator.direction !== direction) {
    accumulator.direction = direction;
    accumulator.distance = 0;
  }
  accumulator.distance += Math.abs(delta) * TOUCH_SCROLL_GAIN;
  const amount = Math.floor(accumulator.distance);
  accumulator.distance -= amount;
  return amount;
}

export function createPointerController(options: {
  send: Send;
  enabled: () => boolean;
  mode: () => 'tap' | 'scroll' | 'drag';
  point: (
    event: Pick<Pointer, 'clientX' | 'clientY'>,
    clamp: boolean
  ) => Point | null;
}) {
  let active:
    | {
        id: number;
        start: Point;
        x: number;
        y: number;
        pressed: boolean;
        moved: boolean;
        scrollX: ScrollAccumulator;
        scrollY: ScrollAccumulator;
      }
    | undefined;
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTap: Point | undefined;
  const emit = (type: Behavior, point: Point, amount = 0) => {
    if (options.enabled()) options.send({ type, ...point, amount });
  };
  const cancel = () => {
    clearTimeout(holdTimer);
    clearTimeout(tapTimer);
    tapTimer = undefined;
    lastTap = undefined;
    if (active?.pressed) options.send({ type: Behavior.releaseAll });
    active = undefined;
  };
  return {
    cancel,
    flush() {
      const point = tapTimer ? lastTap : undefined;
      clearTimeout(tapTimer);
      tapTimer = undefined;
      lastTap = undefined;
      if (point) emit(Behavior.leftClick, point);
    },
    lostCapture() {
      if (active) cancel();
    },
    down(event: Pointer) {
      if (!options.enabled() || event.button !== 0) return false;
      if (active) {
        cancel();
        return false;
      }
      const point = options.point(event, false);
      if (!point) return false;
      active = {
        id: event.pointerId,
        start: point,
        x: event.clientX,
        y: event.clientY,
        pressed: options.mode() === 'drag',
        moved: false,
        scrollX: { direction: 0, distance: 0 },
        scrollY: { direction: 0, distance: 0 },
      };
      if (active.pressed) emit(Behavior.pressButtonLeft, point);
      if (event.pointerType === 'touch' && options.mode() === 'tap') {
        holdTimer = setTimeout(() => {
          if (active && !active.moved && !active.pressed) {
            active.moved = true;
            emit(Behavior.rightClick, active.start);
          }
        }, 500);
      }
      return true;
    },
    move(event: Pointer) {
      if (!options.enabled() || (active && active.id !== event.pointerId))
        return;
      const point = options.point(event, Boolean(active));
      if (!point) return;
      if (!active) {
        emit(Behavior.mouseMove, point);
        return;
      }
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      if (
        Math.hypot(dx, dy) < 4 &&
        !active.moved &&
        options.mode() !== 'scroll'
      )
        return;
      active.moved = true;
      clearTimeout(holdTimer);
      clearTimeout(tapTimer);
      tapTimer = undefined;
      if (options.mode() === 'scroll') {
        const verticalAmount = scrollAmount(dy, active.scrollY);
        if (verticalAmount)
          emit(
            dy > 0 ? Behavior.scrollUp : Behavior.scrollDown,
            active.start,
            verticalAmount
          );
        const horizontalAmount = scrollAmount(dx, active.scrollX);
        if (horizontalAmount)
          emit(
            dx > 0 ? Behavior.scrollLeft : Behavior.scrollRight,
            active.start,
            horizontalAmount
          );
      } else {
        if (!active.pressed) {
          active.pressed = true;
          emit(Behavior.pressButtonLeft, active.start);
        }
        emit(Behavior.mouseMove, point);
      }
      active.x = event.clientX;
      active.y = event.clientY;
    },
    up(event: Pointer) {
      if (!active || active.id !== event.pointerId) return;
      clearTimeout(holdTimer);
      const point = options.point(event, true) || active.start;
      if (active.pressed) emit(Behavior.releaseButtonLeft, point);
      else if (!active.moved) {
        if (
          tapTimer &&
          lastTap &&
          Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 35
        ) {
          clearTimeout(tapTimer);
          tapTimer = undefined;
          lastTap = undefined;
          emit(Behavior.doubleClick, point);
        } else {
          if (tapTimer && lastTap) emit(Behavior.leftClick, lastTap);
          clearTimeout(tapTimer);
          lastTap = point;
          tapTimer = setTimeout(() => {
            tapTimer = undefined;
            emit(Behavior.leftClick, point);
          }, 230);
        }
      }
      active = undefined;
    },
    context(event: Pick<Pointer, 'clientX' | 'clientY'>) {
      const point = options.point(event, false);
      if (point) emit(Behavior.rightClick, point);
    },
  };
}

type MousePointer = Pointer & { timeStamp: number };

// A physical mouse already tells clicks from drags, so its presses reach the
// host directly instead of waiting for the touch modes' double-tap window.
const DRAG_DISTANCE = 4;
// Hosts recognise a double click from two presses at the same position.
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_DISTANCE = 4;

export function createMouseController(options: {
  send: Send;
  enabled: () => boolean;
  point: (
    event: Pick<Pointer, 'clientX' | 'clientY'>,
    clamp: boolean
  ) => Point | null;
}) {
  let press:
    | {
        id: number;
        point: Point;
        x: number;
        y: number;
        time: number;
        dragging: boolean;
      }
    | undefined;
  let lastClick:
    | { point: Point; x: number; y: number; time: number }
    | undefined;
  let hover: Point | undefined;
  const emit = (type: Behavior, point: Point) => {
    if (options.enabled()) options.send({ type, ...point, amount: 0 });
  };
  const cancel = () => {
    if (press) options.send({ type: Behavior.releaseAll });
    press = undefined;
    lastClick = undefined;
    hover = undefined;
  };
  return {
    cancel,
    pressed: () => Boolean(press),
    down(event: MousePointer, button = event.button) {
      if (!options.enabled()) return false;
      if (press) {
        cancel();
        return false;
      }
      if (button === 2) {
        lastClick = undefined;
        const point = options.point(event, false);
        if (point) emit(Behavior.rightClick, point);
        return false;
      }
      let point = options.point(event, false);
      if (button !== 0 || !point) return false;
      if (
        lastClick &&
        event.timeStamp - lastClick.time <= DOUBLE_CLICK_MS &&
        Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) <=
          DOUBLE_CLICK_DISTANCE
      )
        point = lastClick.point;
      press = {
        id: event.pointerId,
        point,
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
        dragging: false,
      };
      hover = undefined;
      emit(Behavior.pressButtonLeft, point);
      return true;
    },
    move(event: MousePointer) {
      if (!options.enabled()) return;
      if (press) {
        if (press.id !== event.pointerId) return;
        if (
          !press.dragging &&
          Math.hypot(event.clientX - press.x, event.clientY - press.y) <
            DRAG_DISTANCE
        )
          return;
        press.dragging = true;
        const point = options.point(event, true);
        if (point) emit(Behavior.mouseMove, point);
        return;
      }
      const point = options.point(event, false);
      if (!point || (point.x === hover?.x && point.y === hover.y)) return;
      hover = point;
      emit(Behavior.mouseMove, point);
    },
    up(event: MousePointer) {
      if (!press || press.id !== event.pointerId) return;
      const { point, x, y, time, dragging } = press;
      press = undefined;
      lastClick = dragging ? undefined : { point, x, y, time };
      emit(
        Behavior.releaseButtonLeft,
        dragging ? options.point(event, true) || point : point
      );
    },
  };
}

type KeyInput = {
  code: string;
  key: string;
  repeat?: boolean;
  isComposing?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

// Shifted characters and non-Latin layouts fall back to the physical key; the
// host applies the modifiers held with it.
const PHYSICAL_KEYS: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

export function remoteKey(
  event: Pick<KeyInput, 'code' | 'key'>,
  keys: Record<string, number>
) {
  const physical =
    /^(?:Key|Digit)([A-Z0-9])$/.exec(event.code)?.[1] ??
    PHYSICAL_KEYS[event.code];
  const name = [event.code, event.key, event.key.toUpperCase(), physical].find(
    (candidate) => candidate && typeof keys[candidate] === 'number'
  );
  return name ? keys[name] : undefined;
}

// The controller's own close and quit shortcuts stay with it, in a browser or
// the desktop app, so they never close or quit an app on the computer.
export function localShortcut(event: KeyInput, mac: boolean) {
  if (!mac && event.altKey && event.code === 'F4') return true;
  const letter = (
    /^[a-z]$/i.test(event.key)
      ? event.key
      : /^Key([A-Z])$/.exec(event.code)?.[1] || ''
  ).toLowerCase();
  if (letter !== 'w' && letter !== 'q') return false;
  // Windows reports AltGr as Control+Alt; those combinations type characters.
  return mac ? Boolean(event.metaKey) : Boolean(event.ctrlKey && !event.altKey);
}

// Holding Escape without modifiers hands the keyboard back to PalmDesk; a
// short press still reaches the computer when it is released.
export const ESCAPE_HOLD_MS = 800;
// Lock keys toggle on the computer instead of staying down.
const LOCK_KEYS = ['CapsLock', 'NumLock', 'ScrollLock'];
const COMMAND_KEYS = ['MetaLeft', 'MetaRight'];
const MODIFIER_KEYS = [
  ...COMMAND_KEYS,
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
];

export function createKeyboardController(options: {
  send: Send;
  enabled: () => boolean;
  key: (event: KeyInput) => number | undefined;
  escape: number;
  exit: () => void;
  local?: (event: KeyInput) => boolean;
  // macOS reports locking Caps Lock as a keydown and unlocking it as a keyup.
  locksToggleOnKeyup?: boolean;
}) {
  // Track presses by physical key so each release matches its press.
  const held = new Map<string, number>();
  // macOS sends no keyup for a key released while Command is down, so those
  // keys are released together with Command.
  const withCommand = new Set<string>();
  let escape:
    | { code: string; timer: ReturnType<typeof setTimeout> }
    | undefined;
  const press = (code: string, key: number) => {
    held.set(code, key);
    options.send({ type: Behavior.keyboardPressKey, key: [key] });
  };
  const lift = (code: string) => {
    const key = held.get(code);
    withCommand.delete(code);
    if (key === undefined) return false;
    held.delete(code);
    options.send({ type: Behavior.keyboardReleaseKey, key: [key] });
    return true;
  };
  const tap = (code: string, key: number) => {
    press(code, key);
    lift(code);
  };
  const takeEscape = () => {
    const pending = escape;
    clearTimeout(pending?.timer);
    escape = undefined;
    return pending;
  };
  return {
    holds: (key: number) => [...held.values()].includes(key),
    reset() {
      takeEscape();
      held.clear();
      withCommand.clear();
    },
    down(event: KeyInput) {
      if (
        !options.enabled() ||
        event.isComposing ||
        event.key === 'Process' ||
        options.local?.(event)
      )
        return false;
      const key = options.key(event);
      if (key === undefined) return false;
      const code = event.code || event.key;
      // Only the modifiers held now matter, never a press whose keyup was lost.
      if (
        key === options.escape &&
        !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      ) {
        if (!escape && !event.repeat)
          escape = {
            code,
            timer: setTimeout(() => {
              escape = undefined;
              options.exit();
            }, ESCAPE_HOLD_MS),
          };
        return true;
      }
      const pending = takeEscape();
      if (pending) press(pending.code, options.escape);
      if (LOCK_KEYS.includes(code)) {
        tap(code, key);
        return true;
      }
      press(code, key);
      if (event.metaKey && !MODIFIER_KEYS.includes(code)) withCommand.add(code);
      return true;
    },
    up(event: KeyInput) {
      const code = event.code || event.key;
      if (LOCK_KEYS.includes(code)) {
        const key = options.key(event);
        if (
          !options.locksToggleOnKeyup ||
          !options.enabled() ||
          key === undefined
        )
          return false;
        tap(code, key);
        return true;
      }
      if (escape?.code === code) {
        takeEscape();
        if (options.enabled()) press(code, options.escape);
      }
      if (COMMAND_KEYS.includes(code)) [...withCommand].forEach(lift);
      return lift(code);
    },
  };
}
