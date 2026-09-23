<template>
  <section class="viewport-shell">
    <div
      class="tools"
      aria-label="远控工具栏"
    >
      <div
        class="modes"
        role="group"
        aria-label="触摸模式"
      >
        <button
          v-for="mode in modes"
          :key="mode.value"
          type="button"
          :class="{ active: touchMode === mode.value }"
          :aria-pressed="touchMode === mode.value"
          :title="mode.label"
          :aria-label="mode.label"
          :disabled="watchOnly && mode.value !== 'pan'"
          @click="touchMode = mode.value"
        >
          <component :is="mode.icon" />
        </button>
      </div>
      <label class="watch-toggle"
        ><input
          v-model="watchOnly"
          type="checkbox"
        />仅观看</label
      >
      <label class="zoom-label"
        ><span>缩放</span
        ><select
          :value="zoom"
          aria-label="画面缩放"
          @change="selectZoom"
        >
          <option :value="1">适合</option>
          <option :value="1.5">150%</option>
          <option :value="2">200%</option>
          <option :value="3">300%</option>
          <option
            v-if="![1, 1.5, 2, 3].includes(zoom)"
            :value="zoom"
          >
            {{ Math.round(zoom * 100) }}%
          </option>
        </select></label
      >
      <button
        type="button"
        title="文字输入"
        aria-label="文字输入"
        :aria-pressed="showKeyboard"
        @click="showKeyboard = !showKeyboard"
      >
        <KeypadOutline />
      </button>
      <button
        type="button"
        title="全屏"
        aria-label="全屏"
        @click="fullscreen"
      >
        <ExpandOutline />
      </button>
    </div>
    <div
      ref="stage"
      class="video-stage"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @pointercancel="pointerCancel"
      @lostpointercapture="lostPointerCapture"
      @contextmenu.prevent="contextMenu"
      @wheel.prevent="wheel"
    ></div>
    <div
      v-if="showKeyboard"
      class="keyboard-panel"
    >
      <div class="key-row">
        <button
          v-for="key in specialKeys"
          :key="key.code"
          type="button"
          :title="key.label"
          :aria-label="key.label"
          :disabled="!canControl || imageBusy"
          @click="tapKey(key.code)"
        >
          <component
            :is="key.icon"
            v-if="key.icon"
          /><span v-else>{{ key.label }}</span>
        </button>
      </div>
      <form
        class="composer"
        @submit.prevent="sendText"
      >
        <textarea
          v-model="draft"
          aria-label="发送到电脑的文字"
          placeholder="输入文字"
          rows="2"
          maxlength="4096"
          :disabled="watchOnly"
          @keydown.stop
          @keyup.stop
          @paste="imageAttachment?.paste($event)"
        ></textarea>
        <button
          type="submit"
          title="发送文字"
          aria-label="发送文字"
          :disabled="!canControl || imageBusy || !draft.length"
        >
          <SendOutline />
        </button>
      </form>
      <ImageAttachment
        v-if="imagePasteSession"
        ref="imageAttachment"
        :enabled="canControl"
        :channel="imageChannel"
        :session-id="imagePasteSession"
        :commit-paste="commitImagePaste"
        :reconnect-channel="reconnectImageChannel"
        @busy="setImageBusy"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  ArrowBackOutline,
  ArrowDownOutline,
  ArrowForwardOutline,
  ArrowUpOutline,
  BackspaceOutline,
  ExpandOutline,
  HandLeftOutline,
  KeypadOutline,
  MoveOutline,
  ScanOutline,
  ReturnDownBackOutline,
  SendOutline,
  SwapVerticalOutline,
} from '@vicons/ionicons5';
import { useResizeObserver } from '@vueuse/core';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import ImageAttachment from '@/components/ImageAttachment/index.vue';
import { NUT_KEY_MAP } from '@/constant';
import type { WsBilldDeskBehaviorType } from '@/types/websocket';
import { BilldDeskBehaviorEnum as Behavior } from '@/types/websocket';
import { createPointerController } from '@/utils/controller-input';
import { videoPoint } from '@/utils/remote-input';
import {
  clampViewportZoom,
  createViewportGestures,
} from '@/utils/viewport-gestures';

const props = defineProps<{
  video?: HTMLVideoElement;
  connected: boolean;
  inputBlocked?: boolean;
  imageChannel?: RTCDataChannel;
  imagePasteSession?: string;
  commitImagePaste?: (sessionId: string, id: number) => void;
  reconnectImageChannel?: () => void;
}>();
const emit = defineEmits<{
  behavior: [data: Partial<WsBilldDeskBehaviorType['data']>];
}>();
const stage = ref<HTMLDivElement>();
const touchMode = ref<'tap' | 'scroll' | 'drag' | 'pan'>('tap');
const watchOnly = ref(false);
const zoom = ref(1);
const showKeyboard = ref(true);
const draft = defineModel<string>('draft', { default: '' });
const imageAttachment = ref<InstanceType<typeof ImageAttachment>>();
const imageBusy = ref(false);
const hasFrame = ref(false);
const canControl = computed(
  () =>
    props.connected && hasFrame.value && !watchOnly.value && !props.inputBlocked
);
const modes = [
  { value: 'tap' as const, label: '点击', icon: HandLeftOutline },
  { value: 'scroll' as const, label: '滚动', icon: SwapVerticalOutline },
  { value: 'drag' as const, label: '拖拽', icon: MoveOutline },
  { value: 'pan' as const, label: '移动画面', icon: ScanOutline },
];
const specialKeys = [
  { code: 'Escape', label: 'Esc', icon: null },
  { code: 'Tab', label: 'Tab', icon: null },
  { code: 'ArrowLeft', label: '向左', icon: ArrowBackOutline },
  { code: 'ArrowDown', label: '向下', icon: ArrowDownOutline },
  { code: 'ArrowUp', label: '向上', icon: ArrowUpOutline },
  { code: 'ArrowRight', label: '向右', icon: ArrowForwardOutline },
  { code: 'Backspace', label: '退格', icon: BackspaceOutline },
  { code: 'Enter', label: '回车', icon: ReturnDownBackOutline },
];
function send(data: Partial<WsBilldDeskBehaviorType['data']>) {
  emit('behavior', data);
}
function point(event: { clientX: number; clientY: number }, clamp = false) {
  const rect = props.video?.getBoundingClientRect();
  return rect ? videoPoint(rect, event.clientX, event.clientY, clamp) : null;
}
const pointer = createPointerController({
  send,
  enabled: () =>
    canControl.value &&
    !imageBusy.value &&
    touchMode.value !== 'pan' &&
    !gestures.active(),
  mode: () => (touchMode.value === 'pan' ? 'tap' : touchMode.value),
  point,
});
const gestures = createViewportGestures({
  view: () => {
    const rect = props.video?.getBoundingClientRect();
    return rect ? { zoom: zoom.value, rect } : undefined;
  },
  localPan: () => watchOnly.value || touchMode.value === 'pan',
  cancelInput: () => pointer.cancel(),
  zoomAt,
  panBy: (left, top) => stage.value?.scrollBy({ left, top }),
});
function pointerDown(event: PointerEvent) {
  // Keep local zooming and panning available during host input errors.
  if (!hasFrame.value || !props.connected) return;
  const local = gestures.down(event);
  const remote = !local && pointer.down(event);
  if (local || remote || event.pointerType === 'touch') {
    event.preventDefault();
    stage.value?.setPointerCapture(event.pointerId);
  }
}
function pointerMove(event: PointerEvent) {
  if (!gestures.move(event)) pointer.move(event);
}
function pointerUp(event: PointerEvent) {
  if (!gestures.up(event)) pointer.up(event);
  releaseCapture(event);
}
function releaseCapture(event: PointerEvent) {
  if (stage.value?.hasPointerCapture(event.pointerId))
    stage.value.releasePointerCapture(event.pointerId);
}
function pointerCancel(event: PointerEvent) {
  gestures.cancel(event);
  pointer.cancel();
  releaseCapture(event);
}
function lostPointerCapture(event: PointerEvent) {
  if (!gestures.cancel(event)) pointer.lostCapture();
}
function contextMenu(event: MouseEvent) {
  if (!gestures.active()) pointer.context(event);
}
function wheel(event: WheelEvent) {
  if (watchOnly.value || touchMode.value === 'pan') {
    stage.value?.scrollBy({ left: event.deltaX, top: event.deltaY });
    return;
  }
  if (!canControl.value || imageBusy.value) return;
  const position = point(event);
  if (!position) return;
  if (event.deltaY)
    send({
      type: event.deltaY > 0 ? Behavior.scrollDown : Behavior.scrollUp,
      ...position,
      amount: Math.max(
        1,
        Math.round(Math.abs(event.deltaY) / (event.deltaMode === 0 ? 20 : 1))
      ),
    });
  if (event.deltaX)
    send({
      type: event.deltaX > 0 ? Behavior.scrollRight : Behavior.scrollLeft,
      ...position,
      amount: Math.max(
        1,
        Math.round(Math.abs(event.deltaX) / (event.deltaMode === 0 ? 20 : 1))
      ),
    });
}
function tapKey(code: string) {
  const key = NUT_KEY_MAP[code];
  if (!canControl.value || imageBusy.value || typeof key !== 'number') return;
  send({ type: Behavior.keyboardPressKey, key: [key] });
  send({ type: Behavior.keyboardReleaseKey, key: [key] });
}
function sendText() {
  if (!canControl.value || imageBusy.value || !draft.value.length) return;
  send({ type: Behavior.keyboardType, text: draft.value });
  draft.value = '';
}
const heldKeys = new Set<number>();
function releaseAll() {
  pointer.cancel();
  gestures.reset();
  heldKeys.clear();
  if (props.connected) send({ type: Behavior.releaseAll });
}
function keyboard(event: KeyboardEvent) {
  if (
    !canControl.value ||
    imageBusy.value ||
    event.isComposing ||
    (event.target as HTMLElement)?.closest(
      'input, textarea, select, button, [contenteditable="true"]'
    )
  )
    return;
  const key = NUT_KEY_MAP[event.code] ?? NUT_KEY_MAP[event.key.toUpperCase()];
  if (typeof key !== 'number') return;
  event.preventDefault();
  if (event.type === 'keydown') {
    heldKeys.add(key);
    send({ type: Behavior.keyboardPressKey, key: [key] });
  } else if (heldKeys.has(key)) {
    send({ type: Behavior.keyboardReleaseKey, key: [key] });
    heldKeys.delete(key);
  }
}
function visibility() {
  if (document.hidden) releaseAll();
}
function resizeVideo() {
  const video = props.video;
  if (
    !video ||
    !stage.value?.clientWidth ||
    !stage.value.clientHeight ||
    !video.videoWidth ||
    !video.videoHeight
  )
    return;
  hasFrame.value = true;
  const fit =
    Math.min(
      stage.value.clientWidth / video.videoWidth,
      stage.value.clientHeight / video.videoHeight
    ) * zoom.value;
  video.style.width = `${Math.max(1, Math.round(video.videoWidth * fit))}px`;
  video.style.height = `${Math.max(1, Math.round(video.videoHeight * fit))}px`;
}
function zoomAt(
  value: number,
  anchor: { x: number; y: number },
  center: { clientX: number; clientY: number }
) {
  zoom.value = clampViewportZoom(value);
  // Resize synchronously so each move uses the actual scrolled video bounds.
  resizeVideo();
  const rect = props.video?.getBoundingClientRect();
  if (!rect || !stage.value) return;
  stage.value.scrollLeft += rect.left + anchor.x * rect.width - center.clientX;
  stage.value.scrollTop += rect.top + anchor.y * rect.height - center.clientY;
}
function selectZoom(event: Event) {
  releaseAll();
  const value = Number((event.target as HTMLSelectElement).value);
  const rect = props.video?.getBoundingClientRect();
  const element = stage.value;
  if (!rect?.width || !rect.height || !element) {
    zoom.value = clampViewportZoom(value);
    return;
  }
  const bounds = element.getBoundingClientRect();
  const center = {
    clientX: bounds.left + element.clientWidth / 2,
    clientY: bounds.top + element.clientHeight / 2,
  };
  zoomAt(
    value,
    {
      x: (center.clientX - rect.left) / rect.width,
      y: (center.clientY - rect.top) / rect.height,
    },
    center
  );
}
async function fullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen();
  else if (stage.value?.requestFullscreen)
    await stage.value.requestFullscreen();
  else if (props.video && 'webkitEnterFullscreen' in props.video)
    (props.video as any).webkitEnterFullscreen();
}
watch(
  () => props.video,
  async (video, old) => {
    releaseAll();
    old?.removeEventListener('loadeddata', resizeVideo);
    old?.removeEventListener('resize', resizeVideo);
    old?.remove();
    hasFrame.value = false;
    await nextTick();
    if (video && stage.value) {
      stage.value.appendChild(video);
      video.addEventListener('loadeddata', resizeVideo);
      video.addEventListener('resize', resizeVideo);
      void video.play().catch(() => {});
      resizeVideo();
    }
  },
  { immediate: true }
);
watch(
  [watchOnly, touchMode, () => props.connected, () => props.inputBlocked],
  releaseAll
);
function setImageBusy(busy: boolean) {
  if (busy) {
    // Flush while input is still enabled; releaseAll cancels pending taps.
    pointer.flush();
    releaseAll();
  }
  imageBusy.value = busy;
}
watch(showKeyboard, () => nextTick(resizeVideo));
watch(
  () => props.inputBlocked,
  () => nextTick(resizeVideo)
);
useResizeObserver(stage, () => {
  if (gestures.active()) gestures.reset();
  resizeVideo();
});
onMounted(() => {
  window.addEventListener('keydown', keyboard);
  window.addEventListener('keyup', keyboard);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', visibility);
});
onUnmounted(() => {
  releaseAll();
  props.video?.removeEventListener('loadeddata', resizeVideo);
  props.video?.removeEventListener('resize', resizeVideo);
  window.removeEventListener('keydown', keyboard);
  window.removeEventListener('keyup', keyboard);
  window.removeEventListener('blur', releaseAll);
  document.removeEventListener('visibilitychange', visibility);
});
</script>

<style scoped lang="scss">
.viewport-shell {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  background: var(--pd-bg);
}
button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  padding: 10px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface);
  color: var(--pd-text);
  cursor: pointer;
}
button svg {
  width: 20px;
  height: 20px;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
button.active,
button[aria-pressed='true'] {
  border-color: var(--pd-accent);
  background: var(--pd-accent-soft);
}
.tools {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding: 8px 12px;
  background: var(--pd-surface);
  border-bottom: 1px solid var(--pd-border);
}
.modes {
  display: flex;
  gap: 3px;
}
.watch-toggle,
.zoom-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  white-space: nowrap;
}
.zoom-label {
  margin-left: auto;
}
select {
  height: 36px;
  max-width: 96px;
  padding: 4px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface-soft);
  color: var(--pd-text);
  font-size: 13px;
}
.video-stage {
  flex: 1;
  min-width: 0;
  min-height: 120px;
  overflow: auto;
  display: flex;
  background: #0a0d0c;
  touch-action: none;
  overscroll-behavior: contain;
  overflow-anchor: none;
}
.video-stage :deep(video) {
  display: block;
  flex: 0 0 auto;
  margin: auto;
  object-fit: contain;
  user-select: none;
}
.keyboard-panel {
  padding: 8px 12px max(10px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--pd-border);
  background: var(--pd-surface);
}
.key-row {
  display: flex;
  gap: 5px;
  overflow-x: auto;
  margin-bottom: 8px;
}
.key-row button {
  height: 36px;
  padding: 7px;
}
.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
textarea {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  resize: vertical;
  max-height: 160px;
  padding: 8px;
  border: 1px solid var(--pd-border-strong);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-bg);
  color: var(--pd-text);
  font: 16px/1.4 system-ui;
}
.composer button {
  color: #071108;
  background: var(--pd-accent);
}
@media (max-width: 480px) {
  .viewport-shell {
    position: relative;
    background: #0a0d0c;
  }
  .tools {
    order: 3;
    align-self: center;
    width: calc(100% - 20px);
    box-sizing: border-box;
    justify-content: center;
    gap: 5px;
    margin: 8px 10px 10px;
    padding: 6px 8px;
    border: 1px solid var(--pd-border-strong);
    border-radius: var(--pd-radius);
    background: rgb(255 255 255 / 96%);
    box-shadow: 0 12px 30px rgb(0 0 0 / 34%);
  }
  .video-stage {
    order: 2;
  }
  .keyboard-panel {
    order: 4;
    margin: 0 10px 10px;
    padding: 8px 10px max(10px, env(safe-area-inset-bottom));
    border: 1px solid var(--pd-border);
    border-radius: 24px;
    background: var(--pd-surface);
  }
  .tools button {
    width: 36px;
    height: 38px;
    padding: 8px;
  }
  .zoom-label > span {
    display: none;
  }
  .zoom-label {
    display: none;
  }
  .watch-toggle {
    gap: 2px;
    font-size: 12px;
  }
  .zoom-label {
    margin-left: auto;
  }
  .keyboard-panel {
    padding-left: 8px;
    padding-right: 8px;
  }
  .key-row button {
    flex: 1 0 32px;
    min-width: 32px;
    width: 32px;
  }
}
</style>

<style scoped lang="scss">
@media (max-height: 480px) {
  .video-stage {
    min-height: 80px;
  }
  .keyboard-panel {
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .key-row {
    margin-bottom: 4px;
  }
  .key-row button {
    height: 30px;
  }
  .composer textarea {
    height: 40px;
    min-height: 40px;
    resize: none;
  }
  .composer button {
    height: 38px;
  }
}
</style>
