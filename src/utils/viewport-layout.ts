import { videoPoint } from './remote-input';

type Size = { width: number; height: number };
type Rect = Size & { left: number; top: number };

/** Fit the source, keeping a task sidebar readable on short landscape screens. */
export function viewportLayout(
  video: Size,
  stage: Size,
  zoom: number,
  sidebar = 1
) {
  if (video.width <= 0 || video.height <= 0) return undefined;
  const fraction = Math.max(0.1, Math.min(1, sidebar));
  const fit = Math.min(
    stage.width / (video.width * fraction),
    stage.height / video.height
  );
  const readable =
    fraction < 1 ? Math.min(240, stage.width) / (video.width * fraction) : 0;
  const scale = Math.max(fit, readable) * zoom;
  return {
    videoWidth: video.width * scale,
    videoHeight: video.height * scale,
    width: video.width * fraction * scale,
    height: video.height * scale,
  };
}

/** Reject letterboxes and clamp dragging to the visible part of the source. */
export function viewportPoint(
  video: Rect,
  surface: Rect,
  stage: Rect,
  clientX: number,
  clientY: number,
  clamp = false
) {
  const left = Math.max(video.left, surface.left, stage.left);
  const top = Math.max(video.top, surface.top, stage.top);
  const right = Math.min(
    video.left + video.width,
    surface.left + surface.width,
    stage.left + stage.width
  );
  const bottom = Math.min(
    video.top + video.height,
    surface.top + surface.height,
    stage.top + stage.height
  );
  if (right <= left || bottom <= top) return null;
  if (
    !clamp &&
    (clientX < left || clientX > right || clientY < top || clientY > bottom)
  )
    return null;
  return videoPoint(
    video,
    Math.max(left, Math.min(right, clientX)),
    Math.max(top, Math.min(bottom, clientY)),
    clamp
  );
}
