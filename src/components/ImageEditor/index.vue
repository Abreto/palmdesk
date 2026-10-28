<template>
  <div
    ref="dialog"
    class="image-editor"
    role="dialog"
    aria-modal="true"
    aria-label="编辑图片"
    tabindex="-1"
    @keydown.stop="keydown"
    @keyup.stop
  >
    <header class="editor-header">
      <button
        type="button"
        :class="{ danger: confirmingDiscard }"
        @click="cancel"
      >
        {{ confirmingDiscard ? '放弃修改' : '取消' }}
      </button>
      <div class="editor-title">
        <strong>编辑图片</strong>
        <span>{{ caption }}</span>
      </div>
      <button
        type="button"
        class="primary"
        :disabled="!source || exporting"
        @click="finish"
      >
        完成
      </button>
    </header>
    <div
      ref="stage"
      class="editor-stage"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @pointercancel="pointerCancel"
      @lostpointercapture="lostCapture"
    >
      <div
        v-if="source && surfaceStyle"
        class="editor-surface"
        :style="surfaceStyle"
      >
        <canvas ref="canvas"></canvas>
        <div
          v-if="tool === 'crop' && cropStyle"
          class="crop-box"
          :style="cropStyle"
        >
          <i
            v-for="corner in ['nw', 'ne', 'sw', 'se']"
            :key="corner"
            :class="corner"
          ></i>
        </div>
      </div>
      <p
        v-if="status"
        class="editor-status"
        :class="{ error: status.error }"
        :role="status.error ? 'alert' : 'status'"
      >
        {{ status.text }}
      </p>
    </div>
    <div class="editor-tools">
      <div
        class="tool-row"
        role="group"
        aria-label="编辑工具"
      >
        <button
          v-for="item in tools"
          :key="item.value"
          type="button"
          :class="item.value"
          :aria-pressed="tool === item.value"
          :disabled="!source || exporting"
          @click="selectTool(item.value)"
        >
          <component :is="item.icon" /><span>{{ item.label }}</span>
        </button>
        <button
          type="button"
          :disabled="!steps.length || exporting"
          @click="undo"
        >
          <ArrowUndoOutline /><span>撤销</span>
        </button>
        <button
          type="button"
          :disabled="!markup?.edited || exporting"
          @click="reset"
        >
          <RefreshOutline /><span>重置</span>
        </button>
      </div>
      <div
        class="color-row"
        role="radiogroup"
        aria-label="标注颜色"
      >
        <button
          v-for="item in MARKUP_COLORS"
          :key="item.value"
          type="button"
          role="radio"
          :aria-checked="color === item.value"
          :aria-label="item.label"
          :style="{ background: item.value }"
          :disabled="!source || exporting"
          @click="selectColor(item.value)"
        ></button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowForwardOutline,
  ArrowUndoOutline,
  BrushOutline,
  CropOutline,
  RefreshOutline,
  SquareOutline,
} from '@vicons/ionicons5';
import { useResizeObserver } from '@vueuse/core';
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';

import {
  type CropHandle,
  type Mark,
  type MarkupExport,
  type MarkupStep,
  type MarkupTool,
  type Point,
  type Rect,
  type Size,
  MARKUP_COLORS,
  clampPoint,
  cropHandleAt,
  dragCrop,
  drawMark,
  exportMarkup,
  fullRect,
  replayMarkup,
  sameRect,
  snapRect,
} from '@/utils/image-markup';

// Stroke and touch sizes are CSS pixels, whatever the image scale; small
// images are enlarged at most MAX_ZOOM times.
const STROKE = 4;
const TOUCH_REACH = 22;
const MIN_CROP = 24;
const MAX_ZOOM = 4;

const props = defineProps<{ src: string; steps: readonly MarkupStep[] }>();
const emit = defineEmits<{
  apply: [steps: readonly MarkupStep[], result?: MarkupExport];
  close: [];
}>();
const tools = [
  { value: 'crop' as const, label: '裁剪', icon: CropOutline },
  { value: 'pen' as const, label: '画笔', icon: BrushOutline },
  { value: 'arrow' as const, label: '箭头', icon: ArrowForwardOutline },
  { value: 'rect' as const, label: '矩形', icon: SquareOutline },
];
const dialog = ref<HTMLDivElement>();
const stage = ref<HTMLDivElement>();
const canvas = ref<HTMLCanvasElement>();
const source = shallowRef<HTMLImageElement>();
const size = shallowRef<Size>();
const stageSize = shallowRef<Size>({ width: 0, height: 0 });
const steps = shallowRef<readonly MarkupStep[]>(props.steps);
const tool = ref<MarkupTool>(props.steps.length ? 'pen' : 'crop');
const color = ref(MARKUP_COLORS[0].value);
const draftCrop = shallowRef<Rect>();
const loadError = ref('');
const exportError = ref('');
const exporting = ref(false);
const confirmingDiscard = ref(false);
let disposed = false;
let frame = 0;
let discardTimer: ReturnType<typeof setTimeout> | undefined;
let draftMark: Mark | undefined;
let gesture:
  | { id: number; origin: Point; start: Rect; handle?: CropHandle | 'new' }
  | undefined;
let backdrop: { key: string; canvas: HTMLCanvasElement } | undefined;
const pointers = new Set<number>();

const markup = computed(
  () => size.value && replayMarkup(steps.value, size.value)
);
const changed = computed(
  () =>
    steps.value.length !== props.steps.length ||
    steps.value.some((step, index) => step !== props.steps[index])
);
// Cropping shows the whole image; the other tools show the cropped result.
const view = computed(() => {
  if (!size.value || !markup.value) return undefined;
  return tool.value === 'crop' ? fullRect(size.value) : markup.value.crop;
});
// CSS pixels per source pixel.
const scale = computed(() => {
  const area = view.value;
  const { width, height } = stageSize.value;
  if (!area || !width || !height) return 0;
  const padding = tool.value === 'crop' ? 28 : 12;
  return Math.min(
    MAX_ZOOM,
    Math.max(1, width - padding * 2) / area.width,
    Math.max(1, height - padding * 2) / area.height
  );
});
const surfaceStyle = computed(
  () =>
    view.value &&
    scale.value && {
      width: `${view.value.width * scale.value}px`,
      height: `${view.value.height * scale.value}px`,
    }
);
const shownCrop = computed(() => draftCrop.value ?? markup.value?.crop);
const cropStyle = computed(() => {
  const rect = shownCrop.value;
  return (
    rect && {
      left: `${rect.x * scale.value}px`,
      top: `${rect.y * scale.value}px`,
      width: `${rect.width * scale.value}px`,
      height: `${rect.height * scale.value}px`,
    }
  );
});
const caption = computed(() => {
  const rect = shownCrop.value;
  if (!rect || !size.value) return '';
  const { width, height } = snapRect(rect, size.value);
  return `${width} × ${height}`;
});
const status = computed(() => {
  const error = loadError.value || exportError.value;
  if (error) return { text: error, error: true };
  if (exporting.value) return { text: '正在生成 PNG…', error: false };
  if (confirmingDiscard.value)
    return { text: '再点一次「放弃修改」将丢弃本次编辑', error: false };
  if (!source.value) return { text: '正在加载图片…', error: false };
  return undefined;
});

useResizeObserver(stage, ([entry]) => {
  stageSize.value = {
    width: entry.contentRect.width,
    height: entry.contentRect.height,
  };
});

function transformFor(area: Rect, width: number, height: number) {
  const x = width / area.width;
  const y = height / area.height;
  return [x, 0, 0, y, -area.x * x, -area.y * y] as const;
}
// Redraw the scaled image only when the view changes, not on every stroke.
function backdropFor(
  image: HTMLImageElement,
  area: Rect,
  width: number,
  height: number
) {
  const key = [area.x, area.y, area.width, area.height, width, height].join();
  if (backdrop?.key !== key) {
    const element = backdrop?.canvas ?? document.createElement('canvas');
    element.width = width;
    element.height = height;
    const context = element.getContext('2d');
    if (context) {
      context.imageSmoothingQuality = 'high';
      context.setTransform(...transformFor(area, width, height));
      context.drawImage(image, 0, 0);
    }
    backdrop = { key, canvas: element };
  }
  return backdrop.canvas;
}
function render() {
  frame = 0;
  const element = canvas.value;
  const image = source.value;
  const area = view.value;
  const current = markup.value;
  if (!element || !image || !area || !current || !scale.value) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.max(1, Math.round(area.width * scale.value * ratio));
  const height = Math.max(1, Math.round(area.height * scale.value * ratio));
  if (element.width !== width) element.width = width;
  if (element.height !== height) element.height = height;
  const context = element.getContext('2d');
  if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.drawImage(backdropFor(image, area, width, height), 0, 0);
  context.setTransform(...transformFor(area, width, height));
  current.marks.forEach((mark) => drawMark(context, mark));
  if (draftMark) drawMark(context, draftMark);
}
function schedule() {
  if (!frame && !disposed) frame = requestAnimationFrame(render);
}
watch([view, scale, markup, source], () => nextTick(schedule));

function sourcePoint(event: { clientX: number; clientY: number }): Point {
  const rect = canvas.value!.getBoundingClientRect();
  const area = view.value!;
  return {
    x: area.x + ((event.clientX - rect.left) * area.width) / rect.width,
    y: area.y + ((event.clientY - rect.top) * area.height) / rect.height,
  };
}
function push(step: MarkupStep) {
  steps.value = [...steps.value, step];
  exportError.value = '';
}
function cancelGesture() {
  gesture = undefined;
  draftMark = undefined;
  draftCrop.value = undefined;
  schedule();
}
function pointerDown(event: PointerEvent) {
  // A new touch starts afresh, even if an earlier pointer's end was missed.
  if (event.isPrimary) pointers.clear();
  pointers.add(event.pointerId);
  // A second finger is probably a pinch or a palm; drop the stroke.
  if (pointers.size > 1) {
    cancelGesture();
    return;
  }
  const current = markup.value;
  if (
    !current ||
    !size.value ||
    !canvas.value ||
    !scale.value ||
    exporting.value ||
    event.button > 0
  )
    return;
  event.preventDefault();
  stage.value?.setPointerCapture(event.pointerId);
  confirmingDiscard.value = false;
  const point = sourcePoint(event);
  if (tool.value === 'crop') {
    const zoom = scale.value;
    let handle: CropHandle | 'new' | undefined = cropHandleAt(
      {
        x: current.crop.x * zoom,
        y: current.crop.y * zoom,
        width: current.crop.width * zoom,
        height: current.crop.height * zoom,
      },
      { x: point.x * zoom, y: point.y * zoom },
      TOUCH_REACH
    );
    // Dragging across an uncropped image selects a new area.
    if (
      !handle ||
      (handle === 'move' && sameRect(current.crop, fullRect(size.value)))
    )
      handle = 'new';
    gesture = {
      id: event.pointerId,
      origin: point,
      start: current.crop,
      handle,
    };
    return;
  }
  const at = clampPoint(point, current.crop);
  const width = Math.max(2, STROKE / scale.value);
  draftMark =
    tool.value === 'pen'
      ? { type: 'pen', color: color.value, width, points: [at] }
      : { type: tool.value, color: color.value, width, from: at, to: at };
  gesture = { id: event.pointerId, origin: at, start: current.crop };
  schedule();
}
function pointerMove(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.id || !size.value) return;
  const { origin, start, handle } = gesture;
  if (handle) {
    const point = sourcePoint(event);
    draftCrop.value =
      handle === 'new'
        ? snapRect(
            {
              ...origin,
              width: point.x - origin.x,
              height: point.y - origin.y,
            },
            size.value
          )
        : dragCrop(
            start,
            handle,
            { x: point.x - origin.x, y: point.y - origin.y },
            size.value,
            MIN_CROP / scale.value
          );
    return;
  }
  const mark = draftMark;
  if (!mark) return;
  if (mark.type === 'pen') {
    const samples = event.getCoalescedEvents?.() ?? [];
    (samples.length ? samples : [event]).forEach((sample) => {
      const point = clampPoint(sourcePoint(sample), start);
      const last = mark.points[mark.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) * scale.value >= 1.5)
        mark.points.push(point);
    });
  } else mark.to = clampPoint(sourcePoint(event), start);
  schedule();
}
function pointerUp(event: PointerEvent) {
  pointers.delete(event.pointerId);
  const current = gesture;
  if (!current || event.pointerId !== current.id || !size.value) return;
  gesture = undefined;
  if (current.handle) {
    const draft = draftCrop.value;
    draftCrop.value = undefined;
    if (!draft) return;
    const rect = snapRect(draft, size.value);
    // A tap or tiny drag keeps the current crop.
    if (
      current.handle === 'new' &&
      Math.min(rect.width, rect.height) * scale.value < MIN_CROP
    )
      return;
    if (!sameRect(rect, current.start)) push({ type: 'crop', rect });
    return;
  }
  const mark = draftMark;
  draftMark = undefined;
  if (
    mark &&
    (mark.type === 'pen' ||
      Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y) *
        scale.value >=
        6)
  )
    push({ type: 'mark', mark });
  schedule();
}
function pointerCancel(event: PointerEvent) {
  pointers.delete(event.pointerId);
  if (gesture?.id === event.pointerId) cancelGesture();
}
// Implicit touch capture moving from a child to the stage is not a loss.
function lostCapture(event: PointerEvent) {
  if (event.target === stage.value) pointerCancel(event);
}

function selectTool(value: MarkupTool) {
  cancelGesture();
  tool.value = value;
  confirmingDiscard.value = false;
}
function selectColor(value: string) {
  color.value = value;
  if (tool.value === 'crop') selectTool('pen');
}
function undo() {
  if (exporting.value || !steps.value.length) return;
  cancelGesture();
  steps.value = steps.value.slice(0, -1);
  exportError.value = '';
  confirmingDiscard.value = false;
}
function reset() {
  if (exporting.value || !markup.value?.edited) return;
  cancelGesture();
  push({ type: 'reset' });
  confirmingDiscard.value = false;
}
function cancel() {
  if (!changed.value || confirmingDiscard.value) {
    emit('close');
    return;
  }
  confirmingDiscard.value = true;
  clearTimeout(discardTimer);
  discardTimer = setTimeout(() => {
    confirmingDiscard.value = false;
  }, 4000);
}
async function finish() {
  const image = source.value;
  const current = markup.value;
  if (!image || !size.value || !current || exporting.value) return;
  cancelGesture();
  if (!changed.value) {
    emit('close');
    return;
  }
  const result = steps.value;
  // A fully undone or reset edit pastes the original bytes again.
  if (!current.edited) {
    emit('apply', result);
    return;
  }
  exporting.value = true;
  exportError.value = '';
  confirmingDiscard.value = false;
  try {
    // Let the status paint before encoding blocks the main thread.
    await new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve));
    });
    const exported = await exportMarkup(image, size.value, result);
    if (!disposed) emit('apply', result, exported);
  } catch (error) {
    if (!disposed)
      exportError.value =
        error instanceof Error ? error.message : '无法生成图片，请重试';
  } finally {
    if (!disposed) exporting.value = false;
  }
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    cancel();
  } else if (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'z'
  ) {
    event.preventDefault();
    undo();
  }
}

onMounted(async () => {
  // Keep keyboard input inside the dialog, away from the remote window.
  dialog.value?.focus();
  const image = new Image();
  image.src = props.src;
  try {
    // Decoded images follow EXIF orientation, in natural size and drawing.
    await image.decode().catch(
      // Safari can reject decode() for large images that still load.
      () =>
        image.complete ||
        new Promise((resolve, reject) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', reject, { once: true });
        })
    );
    if (disposed) return;
    if (!image.naturalWidth || !image.naturalHeight) throw new Error();
    size.value = { width: image.naturalWidth, height: image.naturalHeight };
    source.value = image;
  } catch {
    if (!disposed)
      loadError.value = '无法在此浏览器中编辑这张图片，仍可直接粘贴原图';
  }
});
onBeforeUnmount(() => {
  disposed = true;
  cancelAnimationFrame(frame);
  clearTimeout(discardTimer);
  // Free canvas memory promptly; mobile browsers limit the total.
  [backdrop?.canvas, canvas.value].forEach((element) => {
    if (element) {
      element.width = 0;
      element.height = 0;
    }
  });
});
</script>

<style scoped lang="scss">
.image-editor {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  grid-template:
    'header' auto
    'stage' minmax(0, 1fr)
    'tools' auto / minmax(0, 1fr);
  background: #101412;
  color: #f2f5f3;
  font-size: 13px;
  line-height: 1.4;
  outline: none;
  -webkit-touch-callout: none;
  user-select: none;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 44px;
  min-height: 40px;
  padding: 6px 14px;
  border: 1px solid #3a4540;
  border-radius: var(--pd-radius-sm);
  background: #1b221f;
  color: inherit;
  cursor: pointer;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
button.primary {
  border-color: var(--pd-accent);
  background: var(--pd-accent);
  color: var(--pd-on-accent);
}
button.danger {
  border-color: var(--pd-danger);
  color: #ffb3bb;
}
.editor-header {
  grid-area: header;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: max(8px, env(safe-area-inset-top))
    max(12px, env(safe-area-inset-right)) 8px
    max(12px, env(safe-area-inset-left));
}
.editor-title {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  align-items: center;
}
.editor-title span {
  color: #a8b4ad;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.editor-stage {
  grid-area: stage;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
}
.editor-surface {
  position: relative;
  flex: 0 0 auto;
  // Transparent pixels show over a checkerboard, as in the exported PNG.
  background-color: #fff;
  background-image: conic-gradient(
    #d3dad6 25%,
    transparent 0 50%,
    #d3dad6 0 75%,
    transparent 0
  );
  background-size: 16px 16px;
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.crop-box {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid #fff;
  box-shadow: 0 0 0 200vmax rgb(0 0 0 / 55%);
  pointer-events: none;
}
.crop-box i {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 0 solid #fff;
}
.crop-box .nw {
  top: -5px;
  left: -5px;
  border-width: 5px 0 0 5px;
}
.crop-box .ne {
  top: -5px;
  right: -5px;
  border-width: 5px 5px 0 0;
}
.crop-box .sw {
  bottom: -5px;
  left: -5px;
  border-width: 0 0 5px 5px;
}
.crop-box .se {
  right: -5px;
  bottom: -5px;
  border-width: 0 5px 5px 0;
}
.editor-status {
  position: absolute;
  right: 12px;
  bottom: 8px;
  left: 12px;
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--pd-radius-sm);
  background: rgb(16 20 18 / 90%);
  text-align: center;
}
.editor-status.error {
  border: 1px solid var(--pd-danger);
  color: #ffb3bb;
}
.editor-tools {
  grid-area: tools;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px max(12px, env(safe-area-inset-right))
    max(10px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
}
.tool-row {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
}
.tool-row button {
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  min-height: 52px;
  padding: 6px 2px;
  font-size: 11px;
}
.tool-row button svg {
  width: 20px;
  height: 20px;
}
.tool-row .arrow svg {
  transform: rotate(-45deg);
}
.tool-row button[aria-pressed='true'] {
  border-color: var(--pd-accent);
  background: #1f3d2b;
}
.color-row {
  display: flex;
  justify-content: center;
  gap: 12px;
}
.color-row button {
  width: 32px;
  min-width: 32px;
  height: 32px;
  min-height: 32px;
  padding: 0;
  border: 2px solid #56625c;
  border-radius: 50%;
}
.color-row button[aria-checked='true'] {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
// Phones in landscape: keep the full height for the image.
@media (orientation: landscape) and (max-height: 540px) {
  .image-editor {
    grid-template:
      'stage header' auto
      'stage tools' minmax(0, 1fr) / minmax(0, 1fr) auto;
  }
  .editor-header {
    flex-wrap: wrap;
    width: 212px;
    box-sizing: border-box;
    padding: max(8px, env(safe-area-inset-top))
      max(12px, env(safe-area-inset-right)) 4px 4px;
  }
  .editor-header button {
    flex: 1;
  }
  .editor-title {
    order: -1;
    flex-basis: 100%;
  }
  .editor-stage {
    padding-left: env(safe-area-inset-left);
  }
  .editor-tools {
    width: 212px;
    box-sizing: border-box;
    overflow-y: auto;
    padding: 4px max(12px, env(safe-area-inset-right))
      max(8px, env(safe-area-inset-bottom)) 4px;
  }
  .tool-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .color-row {
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
