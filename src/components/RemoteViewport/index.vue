<template>
  <section
    class="viewport-shell"
    :class="profile"
  >
    <div
      class="tools"
      aria-label="远控工具栏"
    >
      <div
        v-if="!desktop"
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
      <button
        v-else
        type="button"
        title="移动画面：拖动平移放大的画面，不控制电脑"
        aria-label="移动画面"
        :aria-pressed="touchMode === 'pan'"
        @click="touchMode = touchMode === 'pan' ? 'tap' : 'pan'"
      >
        <ScanOutline />
      </button>
      <label class="watch-toggle"
        ><input
          v-model="watchOnly"
          type="checkbox"
        />仅观看</label
      >
      <button
        v-if="desktop"
        ref="keyboardToggle"
        type="button"
        class="keyboard-toggle"
        :aria-pressed="keyboardActive"
        :disabled="!canControl"
        title="点击画面或按 Tab 聚焦画面后，键盘输入发送到电脑；长按 Esc 或点击画面外退出"
        @mousedown.prevent
        @click="toggleRemoteKeyboard"
      >
        远程键盘<span>{{ keyboardHint }}</span>
      </button>
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
        :title="imagePasteSession ? '文字输入、按键与图片' : '文字输入与按键'"
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
      ref="frame"
      class="stage-frame"
    >
      <div
        ref="stage"
        class="video-stage"
        :class="{ pan: desktop && localPan(), dragging: panning }"
        tabindex="0"
        aria-label="远程窗口。点击或聚焦后，键盘输入发送到电脑；长按 Esc 退出"
        @pointerdown="pointerDown"
        @pointermove="pointerMove"
        @pointerup="pointerUp"
        @pointercancel="pointerCancel"
        @lostpointercapture="lostPointerCapture"
        @contextmenu.prevent="contextMenu"
        @wheel.prevent="wheel"
        @keydown="keyDown"
        @keyup="keyUp"
        @focus="stageFocused = true"
        @blur="stageBlurred"
      ></div>
      <div
        v-if="keyboardIndicator"
        class="keyboard-focus"
        aria-hidden="true"
      ></div>
    </div>
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
import { useInteractionProfile } from '@/hooks/use-interaction-profile';
import type { WsBilldDeskBehaviorType } from '@/types/websocket';
import { BilldDeskBehaviorEnum as Behavior } from '@/types/websocket';
import {
  createKeyboardController,
  createMouseController,
  createPointerController,
  localShortcut,
  remoteKey,
} from '@/utils/controller-input';
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
const { profile } = useInteractionProfile();
const desktop = computed(() => profile.value === 'desktop');
const frame = ref<HTMLDivElement>();
const stage = ref<HTMLDivElement>();
const keyboardToggle = ref<HTMLButtonElement>();
const touchMode = ref<'tap' | 'scroll' | 'drag' | 'pan'>('tap');
const watchOnly = ref(false);
const zoom = ref(1);
// A physical keyboard types into the window directly; the composer is optional.
const showKeyboard = ref(!desktop.value);
const draft = defineModel<string>('draft', { default: '' });
const imageAttachment = ref<InstanceType<typeof ImageAttachment>>();
const imageBusy = ref(false);
const hasFrame = ref(false);
const canControl = computed(
  () =>
    props.connected && hasFrame.value && !watchOnly.value && !props.inputBlocked
);
const stageFocused = ref(false);
const windowFocused = ref(document.hasFocus());
const keyboardUsed = ref(false);
const panning = ref(false);
const keyboardActive = computed(
  () =>
    stageFocused.value &&
    windowFocused.value &&
    canControl.value &&
    !imageBusy.value
);
// Phones show it only once a hardware keyboard has typed into the window.
const keyboardIndicator = computed(
  () => keyboardActive.value && (desktop.value || keyboardUsed.value)
);
const keyboardHint = computed(() => {
  if (!canControl.value) return watchOnly.value ? '仅观看' : '暂不可用';
  return keyboardActive.value ? '长按 Esc 退出' : '点击画面开始';
});
const macController = navigator.userAgent.includes('Mac');
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
// A cancelled press releases everything on the host, keys included.
function sendPointer(data: Partial<WsBilldDeskBehaviorType['data']>) {
  if (data.type === Behavior.releaseAll) keyboard.reset();
  send(data);
}
const pointer = createPointerController({
  send: sendPointer,
  enabled: () =>
    canControl.value &&
    !imageBusy.value &&
    touchMode.value !== 'pan' &&
    !gestures.active(),
  mode: () => (touchMode.value === 'pan' ? 'tap' : touchMode.value),
  point,
});
const mouse = createMouseController({
  send: sendPointer,
  enabled: () => canControl.value && !imageBusy.value && !localPan(),
  point,
});
const keyboard = createKeyboardController({
  send,
  enabled: () => canControl.value && !imageBusy.value,
  key: (event) => remoteKey(event, NUT_KEY_MAP),
  escape: NUT_KEY_MAP.Escape,
  exit: leaveRemoteKeyboard,
  local: (event) => localShortcut(event, macController),
  locksToggleOnKeyup: macController,
});
const gestures = createViewportGestures({
  view: () => {
    const rect = props.video?.getBoundingClientRect();
    return rect ? { zoom: zoom.value, rect } : undefined;
  },
  localPan,
  cancelInput: () => pointer.cancel(),
  zoomAt,
  panBy: (left, top) => stage.value?.scrollBy({ left, top }),
});
let panDrag: { id: number; x: number; y: number } | undefined;
function localPan() {
  return watchOnly.value || touchMode.value === 'pan';
}
// Touch keeps the existing modes; a mouse or pen on desktop acts directly.
function directPointer(event: PointerEvent) {
  return desktop.value && event.pointerType !== 'touch';
}
function takeKeyboard(event: PointerEvent) {
  const element = stage.value;
  if (!element || document.activeElement === element) return;
  // Tapping the window keeps an open composer and its on-screen keyboard.
  if (
    !desktop.value &&
    event.pointerType === 'touch' &&
    document.activeElement?.matches(
      'textarea, input:not([type="checkbox"]), [contenteditable="true"]'
    )
  )
    return;
  element.focus({ preventScroll: true });
}
// Presses on the zoomed view's own scrollbars scroll it locally.
function onScrollbar(event: PointerEvent) {
  const element = stage.value;
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return (
    event.clientX - rect.left - element.clientLeft >= element.clientWidth ||
    event.clientY - rect.top - element.clientTop >= element.clientHeight
  );
}
function pointerDown(event: PointerEvent) {
  if (onScrollbar(event)) return;
  takeKeyboard(event);
  // Keep local zooming and panning available during host input errors.
  if (!hasFrame.value || !props.connected) return;
  if (directPointer(event)) {
    mouseDown(event);
    return;
  }
  const local = gestures.down(event);
  const remote = !local && pointer.down(event);
  if (local || remote || event.pointerType === 'touch') {
    event.preventDefault();
    stage.value?.setPointerCapture(event.pointerId);
  }
}
function mouseDown(event: PointerEvent) {
  // Focus is taken explicitly; never select text or drag the video element.
  event.preventDefault();
  if (localPan()) {
    if (event.button !== 0) return;
    panDrag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    panning.value = true;
    stage.value?.setPointerCapture(event.pointerId);
    return;
  }
  // Control-click is the macOS right click unless Control goes to the host.
  const contextClick =
    macController &&
    event.button === 0 &&
    event.ctrlKey &&
    !keyboard.holds(NUT_KEY_MAP.ControlLeft) &&
    !keyboard.holds(NUT_KEY_MAP.ControlRight);
  if (mouse.down(event, contextClick ? 2 : event.button))
    stage.value?.setPointerCapture(event.pointerId);
}
function endPan(event: PointerEvent) {
  if (panDrag?.id !== event.pointerId) return false;
  panDrag = undefined;
  panning.value = false;
  return true;
}
function pointerMove(event: PointerEvent) {
  if (panDrag?.id === event.pointerId) {
    stage.value?.scrollBy({
      left: panDrag.x - event.clientX,
      top: panDrag.y - event.clientY,
    });
    panDrag.x = event.clientX;
    panDrag.y = event.clientY;
  } else if (directPointer(event)) mouse.move(event);
  else if (!gestures.move(event)) pointer.move(event);
}
function pointerUp(event: PointerEvent) {
  if (!endPan(event)) {
    if (directPointer(event)) mouse.up(event);
    else if (!gestures.up(event)) pointer.up(event);
  }
  releaseCapture(event);
}
function releaseCapture(event: PointerEvent) {
  if (stage.value?.hasPointerCapture(event.pointerId))
    stage.value.releasePointerCapture(event.pointerId);
}
function pointerCancel(event: PointerEvent) {
  if (!endPan(event)) {
    if (directPointer(event)) mouse.cancel();
    else {
      gestures.cancel(event);
      pointer.cancel();
    }
  }
  releaseCapture(event);
}
function lostPointerCapture(event: PointerEvent) {
  if (endPan(event)) return;
  if (directPointer(event)) {
    // Capture also ends after every release; keep the double-click position.
    if (mouse.pressed()) mouse.cancel();
  } else if (!gestures.cancel(event)) pointer.lostCapture();
}
function contextMenu(event: MouseEvent) {
  // Desktop right clicks are sent on press and touch long presses by timer.
  if (!desktop.value && !gestures.active()) pointer.context(event);
}
function wheel(event: WheelEvent) {
  // Trackpad pinches arrive as Ctrl+wheel. Zoom the local view unless the
  // computer is receiving a held Control key.
  if (
    desktop.value &&
    event.ctrlKey &&
    !keyboard.holds(NUT_KEY_MAP.ControlLeft) &&
    !keyboard.holds(NUT_KEY_MAP.ControlRight)
  ) {
    zoomWheel(event);
    return;
  }
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
function zoomWheel(event: WheelEvent) {
  const rect = props.video?.getBoundingClientRect();
  if (!rect?.width || !rect.height) return;
  const delta = event.deltaMode === 0 ? event.deltaY : event.deltaY * 16;
  zoomAt(
    zoom.value * 2 ** (-delta / 200),
    {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    },
    event
  );
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
function releaseAll() {
  pointer.cancel();
  mouse.cancel();
  keyboard.reset();
  gestures.reset();
  panDrag = undefined;
  panning.value = false;
  if (props.connected) send({ type: Behavior.releaseAll });
}
// Keys reach the host only while the window view itself has focus, so local
// controls, the composer and the reader keep their own keyboard behavior.
function keyDown(event: KeyboardEvent) {
  windowFocused.value = true;
  if (!keyboard.down(event)) return;
  event.preventDefault();
  keyboardUsed.value = true;
}
function keyUp(event: KeyboardEvent) {
  if (keyboard.up(event)) event.preventDefault();
}
function stageBlurred() {
  stageFocused.value = false;
  // Send a tap that is still waiting for a double tap; releasing cancels it.
  pointer.flush();
  releaseAll();
}
function leaveRemoteKeyboard() {
  releaseAll();
  if (keyboardToggle.value) keyboardToggle.value.focus();
  else stage.value?.blur();
}
function toggleRemoteKeyboard() {
  if (keyboardActive.value) leaveRemoteKeyboard();
  else stage.value?.focus({ preventScroll: true });
}
function windowBlurred() {
  windowFocused.value = false;
  releaseAll();
}
function windowFocusChanged() {
  windowFocused.value = document.hasFocus();
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
  // The frame keeps the keyboard focus indicator visible in fullscreen.
  else if (frame.value?.requestFullscreen)
    await frame.value.requestFullscreen();
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
// Switching between touch and desktop resets to that profile's controls; the
// draft is kept by the controller page.
watch(desktop, (value) => {
  releaseAll();
  touchMode.value = 'tap';
  showKeyboard.value = !value;
});
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
  window.addEventListener('blur', windowBlurred);
  window.addEventListener('focus', windowFocusChanged);
  document.addEventListener('visibilitychange', visibility);
});
onUnmounted(() => {
  releaseAll();
  props.video?.removeEventListener('loadeddata', resizeVideo);
  props.video?.removeEventListener('resize', resizeVideo);
  window.removeEventListener('blur', windowBlurred);
  window.removeEventListener('focus', windowFocusChanged);
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
// An explicit minimum lets the frame shrink like the scrolling stage inside it.
.stage-frame {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 120px;
  background: #0a0d0c;
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
  outline: none;
}
.video-stage:focus-visible {
  outline: 2px solid var(--pd-accent);
  outline-offset: -2px;
}
.video-stage.pan {
  cursor: grab;
}
.video-stage.pan.dragging {
  cursor: grabbing;
}
// Drawn above the video, which can be composited over the stage's outline.
.keyboard-focus {
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 0 2px var(--pd-accent);
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
  color: var(--pd-on-accent);
  background: var(--pd-accent);
}
.keyboard-toggle {
  gap: 6px;
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
}
.keyboard-toggle span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--pd-muted);
}
.keyboard-toggle[aria-pressed='true'] span {
  color: var(--pd-accent);
}
.desktop {
  .tools {
    gap: 6px;
    padding: 4px 8px;
  }
  .tools button {
    width: 32px;
    height: 32px;
    padding: 6px;
  }
  .tools button svg {
    width: 18px;
    height: 18px;
  }
  .tools .keyboard-toggle {
    width: auto;
    padding: 0 10px;
  }
  select {
    height: 30px;
  }
}
// Phone layouts float the toolbar below the window. :where() keeps their
// specificity, so only the touch profile changes.
@media (max-width: 480px) {
  .viewport-shell:where(.touch) {
    position: relative;
    background: #0a0d0c;
  }
  :where(.touch) .tools {
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
  :where(.touch) .stage-frame {
    order: 2;
  }
  :where(.touch) .keyboard-panel {
    order: 4;
    margin: 0 10px 10px;
    padding: 8px 10px max(10px, env(safe-area-inset-bottom));
    border: 1px solid var(--pd-border);
    border-radius: var(--pd-radius);
    background: var(--pd-surface);
  }
  :where(.touch) .tools button {
    width: 36px;
    height: 38px;
    padding: 8px;
  }
  :where(.touch) .zoom-label > span {
    display: none;
  }
  :where(.touch) .zoom-label {
    display: none;
  }
  :where(.touch) .watch-toggle {
    gap: 2px;
    font-size: 12px;
  }
  :where(.touch) .zoom-label {
    margin-left: auto;
  }
  :where(.touch) .keyboard-panel {
    padding-left: 8px;
    padding-right: 8px;
  }
  :where(.touch) .key-row button {
    flex: 1 0 32px;
    min-width: 32px;
    width: 32px;
  }
}
</style>

<style scoped lang="scss">
@media (max-height: 480px) {
  .stage-frame,
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
