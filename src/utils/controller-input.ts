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
      if (Math.hypot(dx, dy) < 4 && !active.moved) return;
      active.moved = true;
      clearTimeout(holdTimer);
      clearTimeout(tapTimer);
      tapTimer = undefined;
      if (options.mode() === 'scroll') {
        if (Math.abs(dy) >= 2)
          emit(
            dy > 0 ? Behavior.scrollUp : Behavior.scrollDown,
            active.start,
            Math.max(1, Math.round(Math.abs(dy) / 12))
          );
        if (Math.abs(dx) >= 2)
          emit(
            dx > 0 ? Behavior.scrollLeft : Behavior.scrollRight,
            active.start,
            Math.max(1, Math.round(Math.abs(dx) / 12))
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
