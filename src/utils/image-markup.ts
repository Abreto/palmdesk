import {
  MAX_IMAGE_BYTES,
  fitsImageBounds,
  formatImageBytes,
  validateImage,
} from './image-payload';

import type { ImagePayload } from './image-payload';

export type MarkupTool = 'crop' | 'pen' | 'arrow' | 'rect';
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;
type Stroke = { color: string; width: number };
export type Mark =
  | (Stroke & { type: 'pen'; points: Point[] })
  | (Stroke & { type: 'arrow' | 'rect'; from: Point; to: Point });
// Coordinates are source pixels of the decoded (EXIF-oriented) image. Steps
// replay in order: undo drops the latest step, and a reset can be undone.
export type MarkupStep =
  | { type: 'crop'; rect: Rect }
  | { type: 'mark'; mark: Mark }
  | { type: 'reset' };
export type CropHandle =
  | 'move'
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw';
export type MarkupExport = { image: ImagePayload } & Size;

export const MARKUP_COLORS = [
  { label: '红色', value: '#ff3b30' },
  { label: '黄色', value: '#ffcc00' },
  { label: '蓝色', value: '#0a84ff' },
  { label: '黑色', value: '#111111' },
  { label: '白色', value: '#ffffff' },
];
const DEVICE_LIMIT = '此设备无法生成这么大的图片，请裁剪更小的区域后重试';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function clampPoint(point: Point, rect: Rect): Point {
  return {
    x: clamp(point.x, rect.x, rect.x + rect.width),
    y: clamp(point.y, rect.y, rect.y + rect.height),
  };
}

export function fullRect({ width, height }: Size): Rect {
  return { x: 0, y: 0, width, height };
}

export function sameRect(a: Rect, b: Rect) {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

export function replayMarkup(steps: readonly MarkupStep[], size: Size) {
  let crop = fullRect(size);
  let marks: Mark[] = [];
  steps.forEach((step) => {
    if (step.type === 'reset') {
      crop = fullRect(size);
      marks = [];
    } else if (step.type === 'crop') crop = step.rect;
    else marks.push(step.mark);
  });
  return {
    crop,
    marks,
    edited: marks.length > 0 || !sameRect(crop, fullRect(size)),
  };
}

// Round a dragged rectangle to whole source pixels inside the image.
export function snapRect(rect: Rect, size: Size): Rect {
  const left = clamp(
    Math.round(Math.min(rect.x, rect.x + rect.width)),
    0,
    size.width - 1
  );
  const top = clamp(
    Math.round(Math.min(rect.y, rect.y + rect.height)),
    0,
    size.height - 1
  );
  const right = clamp(
    Math.round(Math.max(rect.x, rect.x + rect.width)),
    left + 1,
    size.width
  );
  const bottom = clamp(
    Math.round(Math.max(rect.y, rect.y + rect.height)),
    top + 1,
    size.height
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function dragCrop(
  start: Rect,
  handle: CropHandle,
  delta: Point,
  size: Size,
  minimum: number
): Rect {
  if (handle === 'move')
    return {
      ...start,
      x: clamp(start.x + delta.x, 0, size.width - start.width),
      y: clamp(start.y + delta.y, 0, size.height - start.height),
    };
  const minWidth = Math.min(minimum, start.width);
  const minHeight = Math.min(minimum, start.height);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = clamp(left + delta.x, 0, right - minWidth);
  if (handle.includes('e'))
    right = clamp(right + delta.x, left + minWidth, size.width);
  if (handle.includes('n')) top = clamp(top + delta.y, 0, bottom - minHeight);
  if (handle.includes('s'))
    bottom = clamp(bottom + delta.y, top + minHeight, size.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function nearestEdge(value: number, start: number, end: number, reach: number) {
  const before = Math.abs(value - start);
  const after = Math.abs(value - end);
  if (Math.min(before, after) > reach) return 0;
  return before <= after ? -1 : 1;
}

// The rectangle and point share one coordinate space, normally CSS pixels so
// that the touch tolerance does not depend on the image scale.
export function cropHandleAt(
  rect: Rect,
  point: Point,
  reach: number
): CropHandle | undefined {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  if (
    point.x < rect.x - reach ||
    point.x > right + reach ||
    point.y < rect.y - reach ||
    point.y > bottom + reach
  )
    return undefined;
  // Keep part of a small box free for moving it.
  const horizontal = nearestEdge(
    point.x,
    rect.x,
    right,
    Math.min(reach, rect.width / 3)
  );
  const vertical = nearestEdge(
    point.y,
    rect.y,
    bottom,
    Math.min(reach, rect.height / 3)
  );
  const handle = `${['n', '', 's'][vertical + 1]}${['w', '', 'e'][horizontal + 1]}`;
  if (handle) return handle as CropHandle;
  return point.x > rect.x &&
    point.x < right &&
    point.y > rect.y &&
    point.y < bottom
    ? 'move'
    : undefined;
}

export function drawMark(context: CanvasRenderingContext2D, mark: Mark) {
  context.save();
  context.strokeStyle = mark.color;
  context.fillStyle = mark.color;
  context.lineWidth = mark.width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (mark.type === 'pen') {
    const [first, ...rest] = mark.points;
    if (rest.length) {
      context.moveTo(first.x, first.y);
      rest.forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
    } else if (first) {
      context.arc(first.x, first.y, mark.width / 2, 0, Math.PI * 2);
      context.fill();
    }
  } else if (mark.type === 'rect') {
    context.strokeRect(
      Math.min(mark.from.x, mark.to.x),
      Math.min(mark.from.y, mark.to.y),
      Math.abs(mark.to.x - mark.from.x),
      Math.abs(mark.to.y - mark.from.y)
    );
  } else {
    const length = Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y);
    if (length) {
      const angle = Math.atan2(
        mark.to.y - mark.from.y,
        mark.to.x - mark.from.x
      );
      const head = Math.min(length, mark.width * 4.5);
      const spread = Math.PI / 7;
      const corner = (side: number) => ({
        x: mark.to.x - head * Math.cos(angle + side * spread),
        y: mark.to.y - head * Math.sin(angle + side * spread),
      });
      const left = corner(-1);
      const right = corner(1);
      // End the shaft inside the head so its round cap cannot show at the tip.
      context.moveTo(mark.from.x, mark.from.y);
      context.lineTo((left.x + right.x) / 2, (left.y + right.y) / 2);
      context.stroke();
      context.beginPath();
      context.moveTo(mark.to.x, mark.to.y);
      context.lineTo(left.x, left.y);
      context.lineTo(right.x, right.y);
      context.closePath();
      context.fill();
    }
  }
  context.restore();
}

// Draws the oriented image and marks in source-pixel coordinates; the caller
// sets the transform.
function drawMarkup(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  marks: readonly Mark[]
) {
  context.drawImage(source, 0, 0);
  marks.forEach((mark) => drawMark(context, mark));
}

export async function exportMarkup(
  source: CanvasImageSource,
  size: Size,
  steps: readonly MarkupStep[],
  createCanvas = () => document.createElement('canvas')
): Promise<MarkupExport> {
  const { crop, marks } = replayMarkup(steps, size);
  if (!fitsImageBounds(crop.width, crop.height))
    throw new Error('编辑后的图片尺寸过大，请裁剪更小的区域');
  const canvas = createCanvas();
  canvas.width = crop.width;
  canvas.height = crop.height;
  try {
    // Mobile browsers return no context, or an empty image, beyond their
    // canvas memory limits.
    const context = canvas.getContext('2d');
    if (!context) throw new Error(DEVICE_LIMIT);
    context.translate(-crop.x, -crop.y);
    drawMarkup(context, source, marks);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!blob?.size) throw new Error(DEVICE_LIMIT);
    if (blob.size > MAX_IMAGE_BYTES)
      throw new Error(
        `编辑后的 PNG 为 ${formatImageBytes(blob.size)}，超过 10 MB；请裁剪更小的区域，或重置后粘贴原图`
      );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { width, height } = validateImage({ mime: 'image/png', bytes });
    if (width !== crop.width || height !== crop.height)
      throw new Error(DEVICE_LIMIT);
    return { image: { mime: 'image/png', bytes }, width, height };
  } finally {
    // Release the full-size bitmap now; mobile browsers cap total canvas memory.
    canvas.width = 0;
    canvas.height = 0;
  }
}
