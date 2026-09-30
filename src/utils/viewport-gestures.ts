type Position = { clientX: number; clientY: number };
type TouchPointer = Position & { pointerId: number; pointerType?: string };
type Anchor = { x: number; y: number };
type View = {
  zoom: number;
  rect: { left: number; top: number; width: number; height: number };
};

export function clampViewportZoom(zoom: number) {
  return Math.max(1, Math.min(3, zoom));
}

// Arbitrate local touch navigation before forwarding single-pointer input.
export function createViewportGestures(options: {
  view: () => View | undefined;
  localPan: () => boolean;
  cancelInput: () => void;
  zoomAt: (zoom: number, anchor: Anchor, center: Position) => void;
  panBy: (x: number, y: number) => void;
}) {
  const touches = new Map<number, Position>();
  let local = false;
  let cancelled = false;
  let pinch: { distance: number; zoom: number; anchor: Anchor } | undefined;

  function pair() {
    const [first, second] = [...touches.values()];
    if (!first || !second) return;
    return {
      distance: Math.hypot(
        second.clientX - first.clientX,
        second.clientY - first.clientY
      ),
      center: {
        clientX: (first.clientX + second.clientX) / 2,
        clientY: (first.clientY + second.clientY) / 2,
      },
    };
  }
  function rebase() {
    pinch = undefined;
    const points = pair();
    const view = options.view();
    if (
      !points ||
      points.distance < 1 ||
      !view ||
      view.rect.width <= 0 ||
      view.rect.height <= 0
    )
      return;
    pinch = {
      distance: points.distance,
      zoom: view.zoom,
      anchor: {
        x: (points.center.clientX - view.rect.left) / view.rect.width,
        y: (points.center.clientY - view.rect.top) / view.rect.height,
      },
    };
  }
  function reset() {
    touches.clear();
    local = false;
    cancelled = false;
    pinch = undefined;
  }
  return {
    reset,
    active: () => local,
    down(event: TouchPointer) {
      if (event.pointerType !== 'touch') return local;
      touches.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (touches.size >= 2 || options.localPan()) {
        local = true;
        options.cancelInput();
        if (!cancelled) rebase();
      }
      return local;
    },
    move(event: TouchPointer) {
      if (event.pointerType !== 'touch') return local;
      const previous = touches.get(event.pointerId);
      // Ignore leftover fingers after blur, disconnect or view changes.
      if (!previous) return true;
      touches.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (!local) return false;
      if (cancelled) return true;
      const points = pair();
      if (points) {
        if (!pinch) rebase();
        else
          options.zoomAt(
            clampViewportZoom((pinch.zoom * points.distance) / pinch.distance),
            pinch.anchor,
            points.center
          );
      } else {
        options.panBy(
          previous.clientX - event.clientX,
          previous.clientY - event.clientY
        );
      }
      return true;
    },
    up(event: TouchPointer) {
      if (event.pointerType !== 'touch') return local;
      if (!touches.has(event.pointerId)) return true;
      const consumed = local;
      touches.delete(event.pointerId);
      if (!touches.size) reset();
      else if (local && !cancelled) rebase();
      return consumed;
    },
    cancel(event: TouchPointer) {
      if (!touches.delete(event.pointerId)) return false;
      options.cancelInput();
      // A cancelled gesture cannot become a click when the other finger lifts.
      local = true;
      cancelled = true;
      pinch = undefined;
      if (!touches.size) reset();
      return true;
    },
  };
}
