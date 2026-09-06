import { BilldDeskBehaviorEnum as Behavior } from '../types/websocket';

import type { RemoteInput } from '../pure-interface';
import type { WsBilldDeskBehaviorType } from '../types/websocket';

export function remoteInput(
  data: WsBilldDeskBehaviorType['data']
): RemoteInput | null {
  const pointer = { x: data.x, y: data.y };
  switch (data.type) {
    case Behavior.mouseMove:
    case Behavior.mouseDrag:
    case Behavior.setPosition:
      return { action: 'move', ...pointer };
    case Behavior.pressButtonLeft:
      return { action: 'down', ...pointer };
    case Behavior.releaseButtonLeft:
      return { action: 'up', ...pointer };
    case Behavior.leftClick:
      return { action: 'click', ...pointer };
    case Behavior.doubleClick:
      return { action: 'doubleClick', ...pointer };
    case Behavior.rightClick:
      return { action: 'rightClick', ...pointer };
    case Behavior.scrollDown:
      return {
        action: 'scroll',
        direction: 'down',
        amount: data.amount,
        ...pointer,
      };
    case Behavior.scrollUp:
      return {
        action: 'scroll',
        direction: 'up',
        amount: data.amount,
        ...pointer,
      };
    case Behavior.scrollLeft:
      return {
        action: 'scroll',
        direction: 'left',
        amount: data.amount,
        ...pointer,
      };
    case Behavior.scrollRight:
      return {
        action: 'scroll',
        direction: 'right',
        amount: data.amount,
        ...pointer,
      };
    case Behavior.keyboardType:
      return { action: 'text', text: data.text };
    case Behavior.keyboardPressKey:
      return { action: 'keysDown', keys: data.key as number[] };
    case Behavior.keyboardReleaseKey:
      return { action: 'keysUp', keys: data.key as number[] };
    case Behavior.releaseAll:
      return { action: 'releaseAll' };
    default:
      return null;
  }
}

export function videoPoint(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  clamp = false
) {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return {
    x: Math.round(Math.max(0, Math.min(1, x)) * 1000),
    y: Math.round(Math.max(0, Math.min(1, y)) * 1000),
  };
}
