import { BilldDeskBehaviorEnum as Behavior } from '../types/websocket';

import type { WsBilldDeskBehaviorType } from '../types/websocket';

type Point = { x: number; y: number };
type Pointer = {
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  pointerType?: string;
  isPrimary?: boolean;
};
type Send = (data: Partial<WsBilldDeskBehaviorType['data']>) => void;

/** Keep native touch panning; a stationary, short tap can still click the host. */
export function createPanController(options: {
  send: Send;
  enabled: () => boolean;
  point: (event: Pick<Pointer, 'clientX' | 'clientY'>) => Point | null;
  pan: (dx: number, dy: number) => void;
}) {
  const pointers = new Set<number>();
  let lastScroll = -Infinity;
  let active:
    | {
        id: number;
        startX: number;
        startY: number;
        x: number;
        y: number;
        point: Point | null;
        touch: boolean;
        moved: boolean;
        clickable: boolean;
        started: number;
      }
    | undefined;
  const cancel = () => {
    active = undefined;
    pointers.clear();
  };
  return {
    cancel,
    lostCapture() {
      if (active) cancel();
    },
    scrolled() {
      lastScroll = Date.now();
      if (active) active.clickable = false;
    },
    down(event: Pointer) {
      if (event.button !== 0) return false;
      pointers.add(event.pointerId);
      if (pointers.size !== 1 || event.isPrimary === false) {
        active = undefined;
        return false;
      }
      active = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        point: options.point(event),
        touch: event.pointerType === 'touch',
        moved: false,
        // A touch that stops momentum scrolling must not also click the host.
        clickable: options.enabled() && Date.now() - lastScroll > 150,
        started: Date.now(),
      };
      // Mouse/pen drags are handled locally; touch keeps browser scrolling.
      return !active.touch;
    },
    move(event: Pointer) {
      if (!active || active.id !== event.pointerId) return;
      if (
        Math.hypot(
          event.clientX - active.startX,
          event.clientY - active.startY
        ) >= 6
      )
        active.moved = true;
      if (!active.moved) return;
      if (!active.touch)
        options.pan(active.x - event.clientX, active.y - event.clientY);
      active.x = event.clientX;
      active.y = event.clientY;
    },
    up(event: Pointer) {
      pointers.delete(event.pointerId);
      if (!active || active.id !== event.pointerId) return;
      const gesture = active;
      active = undefined;
      if (
        gesture.clickable &&
        options.enabled() &&
        gesture.point &&
        options.point(event) &&
        !gesture.moved &&
        Math.hypot(
          event.clientX - gesture.startX,
          event.clientY - gesture.startY
        ) < 6 &&
        Date.now() - gesture.started < 500
      )
        options.send({ type: Behavior.leftClick, ...gesture.point });
    },
  };
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
  singleClick?: () => boolean;
  verticalScroll?: () => boolean;
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
        touch: boolean;
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
        touch: event.pointerType === 'touch',
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
      const scrolling = options.mode() === 'scroll';
      const vertical = scrolling && options.verticalScroll?.();
      if (
        !active.moved &&
        Math.hypot(dx, dy) < (active.touch ? 6 : 4) &&
        (!scrolling || active.touch)
      )
        return;
      active.moved = true;
      clearTimeout(holdTimer);
      clearTimeout(tapTimer);
      tapTimer = undefined;
      if (scrolling) {
        const verticalAmount = scrollAmount(dy, active.scrollY);
        if (verticalAmount)
          emit(
            dy > 0 ? Behavior.scrollUp : Behavior.scrollDown,
            active.start,
            verticalAmount
          );
        const horizontalAmount = vertical
          ? 0
          : scrollAmount(dx, active.scrollX);
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
        if (options.singleClick?.()) {
          emit(Behavior.leftClick, active.start);
        } else if (
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
