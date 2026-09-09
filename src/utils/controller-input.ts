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
