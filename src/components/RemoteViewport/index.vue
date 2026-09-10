<template>
  <section class="viewport-shell">
    <div
      class="tools"
      :class="{ 'panel-open': activePanel === 'settings' }"
      aria-label="远控工具栏"
    >
      <div
        class="modes"
        role="group"
        aria-label="触摸模式"
      >
        <button
          v-for="mode in visibleModes"
          :key="mode.value"
          type="button"
          :aria-label="mode.label"
          :title="
            mode.value === 'pan'
              ? watchOnly
                ? '仅观看：滑动移动画面'
                : '移动画面：滑动平移，轻点操作电脑'
              : mode.label
          "
          :aria-pressed="touchMode === mode.value"
          :disabled="watchOnly && mode.value !== 'pan'"
          @click="selectMode(mode.value)"
        >
          <component :is="mode.icon" />
        </button>
      </div>
      <button
        type="button"
        class="watch-toggle"
        aria-label="仅观看"
        :title="watchOnly ? '仅观看已开启' : '开启仅观看'"
        :aria-pressed="watchOnly"
        @click="toggleWatchOnly"
      >
        <EyeOutline /><span>仅观看</span>
      </button>
      <label class="zoom-label"
        ><select
          v-model.number="zoom"
          aria-label="画面缩放"
          title="画面缩放"
          @change="closePanel()"
        >
          <option :value="1">适合</option>
          <option :value="1.5">150%</option>
          <option :value="2">200%</option>
          <option :value="3">300%</option>
        </select></label
      >
      <button
        ref="settingsToggle"
        type="button"
        class="settings-toggle"
        title="画面设置"
        aria-label="画面设置"
        :class="{ active: activePanel === 'settings' }"
        :aria-expanded="activePanel === 'settings'"
        :aria-controls="`${controlsId}-settings`"
        aria-haspopup="dialog"
        @click="togglePanel('settings')"
      >
        <OptionsOutline />
      </button>
      <div
        v-if="activePanel === 'settings'"
        :id="`${controlsId}-settings`"
        ref="settingsPanel"
        class="settings-panel control-popover"
        role="dialog"
        aria-label="画面设置"
        tabindex="-1"
        @keydown.esc.stop.prevent="closePanel(true)"
      >
        <template v-if="taskNavigation">
          <div class="settings-heading">查看区域</div>
          <div
            class="view-buttons"
            role="group"
            aria-label="查看区域"
          >
            <button
              type="button"
              :aria-pressed="view === 'tasks'"
              :disabled="!hasFrame"
              @click="changeView('tasks')"
            >
              任务
            </button>
            <button
              type="button"
              :aria-pressed="view === 'content'"
              :disabled="!hasFrame"
              @click="changeView('content')"
            >
              正文
            </button>
          </div>
        </template>
        <template v-if="view === 'tasks'">
          <label class="sidebar-options">
            列表宽度
            <input
              v-model.number="sidebarWidth"
              type="range"
              aria-label="任务列表宽度"
              min="15"
              max="50"
              step="1"
            />
            <output>{{ sidebarWidth }}%</output>
          </label>
          <p class="task-hint">
            {{
              watchOnly
                ? '仅观看：可缩放查看列表。'
                : inputBlocked
                  ? '控制已暂停，恢复后可切换任务。'
                  : '上下滑动翻阅，轻点选择；点侧栏中的 🔔 查看最近任务。'
            }}
          </p>
        </template>
        <div class="settings-actions">
          <button
            type="button"
            aria-label="文字输入"
            :aria-pressed="showKeyboard"
            @click="toggleKeyboard"
          >
            <KeypadOutline />文字输入
          </button>
          <button
            type="button"
            aria-label="全屏"
            @click="fullscreen"
          >
            <ExpandOutline />全屏
          </button>
        </div>
      </div>
    </div>
    <button
      v-if="activePanel"
      class="popover-dismiss"
      type="button"
      aria-label="关闭浮层"
      tabindex="-1"
      @click="closePanel(true)"
    ></button>
    <div
      ref="stage"
      class="video-stage"
      :class="{ watching: panning }"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @pointercancel="cancelPointers"
      @lostpointercapture="lostPointerCapture"
      @contextmenu.prevent="pointer.context"
      @wheel.prevent="wheel"
      @scroll="stageScroll"
    >
      <div
        ref="surface"
        class="video-surface"
      ></div>
    </div>
    <div
      v-if="showKeyboard"
      class="keyboard-panel"
      :class="{ 'panel-open': activePanel === 'directions' }"
    >
      <div class="key-row">
        <button
          type="button"
          aria-label="Esc"
          :disabled="!canControl"
          @click="tapKey('Escape')"
        >
          Esc
        </button>
        <button
          type="button"
          aria-label="Tab"
          :disabled="!canControl"
          @click="tapKey('Tab')"
        >
          Tab
        </button>
        <div class="direction-control">
          <button
            ref="directionToggle"
            type="button"
            class="direction-toggle"
            title="方向键"
            aria-label="方向键"
            :aria-expanded="activePanel === 'directions'"
            :aria-controls="`${controlsId}-directions`"
            aria-haspopup="dialog"
            :class="{ active: activePanel === 'directions' }"
            :disabled="!canControl"
            @click="togglePanel('directions')"
          >
            <MoveOutline />
          </button>
          <div
            v-if="activePanel === 'directions'"
            :id="`${controlsId}-directions`"
            ref="directionPanel"
            class="direction-pad control-popover"
            role="dialog"
            aria-label="方向键面板"
            tabindex="-1"
            @keydown.esc.stop.prevent="closePanel(true)"
          >
            <button
              v-for="key in directionKeys"
              :key="key.code"
              type="button"
              :class="key.position"
              :aria-label="key.label"
              :disabled="!canControl"
              @click="tapKey(key.code)"
            >
              <component :is="key.icon" />
            </button>
          </div>
        </div>
        <button
          type="button"
          title="退格"
          aria-label="退格"
          :disabled="!canControl"
          @click="tapKey('Backspace')"
        >
          <BackspaceOutline />
        </button>
        <button
          type="button"
          title="回车"
          aria-label="回车"
          :disabled="!canControl"
          @click="tapKey('Enter')"
        >
          <ReturnDownBackOutline />
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
          @focus="closePanel()"
          @keydown.stop
          @keyup.stop
        ></textarea>
        <button
          type="submit"
          title="发送文字"
          aria-label="发送文字"
          :disabled="!canControl || !draft.length"
        >
          <SendOutline />
        </button>
      </form>
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
  EyeOutline,
  HandLeftOutline,
  KeypadOutline,
  MoveOutline,
  OptionsOutline,
  ScanOutline,
  ReturnDownBackOutline,
  SendOutline,
  SwapVerticalOutline,
} from '@vicons/ionicons5';
import { useResizeObserver } from '@vueuse/core';
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useId,
  watch,
} from 'vue';

import { NUT_KEY_MAP } from '@/constant';
import type { WsBilldDeskBehaviorType } from '@/types/websocket';
import { BilldDeskBehaviorEnum as Behavior } from '@/types/websocket';
import {
  createPanController,
  createPointerController,
} from '@/utils/controller-input';
import { viewportLayout, viewportPoint } from '@/utils/viewport-layout';

const props = defineProps<{
  video?: HTMLVideoElement;
  connected: boolean;
  inputBlocked?: boolean;
  taskNavigation?: boolean;
}>();
const emit = defineEmits<{
  behavior: [data: Partial<WsBilldDeskBehaviorType['data']>];
}>();
const stage = ref<HTMLDivElement>();
const surface = ref<HTMLDivElement>();
const controlsId = useId();
type Panel = 'settings' | 'directions';
const activePanel = ref<Panel | null>(null);
const settingsToggle = ref<HTMLButtonElement>();
const directionToggle = ref<HTMLButtonElement>();
const settingsPanel = ref<HTMLDivElement>();
const directionPanel = ref<HTMLDivElement>();
type View = 'content' | 'tasks';
type TouchMode = 'tap' | 'scroll' | 'drag' | 'pan';
const view = ref<View>('content');
const sidebarWidth = ref(28);
const touchMode = ref<'tap' | 'scroll' | 'drag' | 'pan'>('tap');
const watchOnly = ref(false);
const zoom = ref(1);
const showKeyboard = ref(true);
const draft = ref('');
const hasFrame = ref(false);
type ViewState = {
  zoom: number;
  x: number;
  y: number;
  touchMode: TouchMode;
  keyboard: boolean;
};
const views: Record<View, ViewState> = {
  content: { zoom: 1, x: 0, y: 0, touchMode: 'tap', keyboard: true },
  tasks: { zoom: 1, x: 0, y: 0, touchMode: 'scroll', keyboard: false },
};
let changingView = false;
let layout: ReturnType<typeof viewportLayout>;
const canControl = computed(
  () =>
    props.connected && hasFrame.value && !watchOnly.value && !props.inputBlocked
);
const panning = computed(() => watchOnly.value || touchMode.value === 'pan');
const modes = [
  { value: 'tap' as const, label: '点击', icon: HandLeftOutline },
  { value: 'scroll' as const, label: '滚动', icon: SwapVerticalOutline },
  { value: 'drag' as const, label: '拖拽', icon: MoveOutline },
  { value: 'pan' as const, label: '移动画面', icon: ScanOutline },
];
const visibleModes = computed(() =>
  view.value === 'tasks'
    ? modes.filter((mode) => mode.value === 'scroll' || mode.value === 'pan')
    : modes
);
const directionKeys = [
  { code: 'ArrowUp', label: '向上', icon: ArrowUpOutline, position: 'up' },
  {
    code: 'ArrowLeft',
    label: '向左',
    icon: ArrowBackOutline,
    position: 'left',
  },
  {
    code: 'ArrowRight',
    label: '向右',
    icon: ArrowForwardOutline,
    position: 'right',
  },
  {
    code: 'ArrowDown',
    label: '向下',
    icon: ArrowDownOutline,
    position: 'down',
  },
];
function closePanel(restoreFocus = false) {
  const trigger =
    activePanel.value === 'settings' ? settingsToggle : directionToggle;
  activePanel.value = null;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
function selectMode(mode: TouchMode) {
  closePanel();
  touchMode.value = mode;
}
function toggleWatchOnly() {
  closePanel();
  watchOnly.value = !watchOnly.value;
}
function toggleKeyboard() {
  closePanel(true);
  showKeyboard.value = !showKeyboard.value;
}
async function togglePanel(panel: Panel) {
  if (activePanel.value === panel) {
    closePanel(true);
    return;
  }
  releaseAll();
  activePanel.value = panel;
  await nextTick();
  const target = panel === 'settings' ? settingsPanel : directionPanel;
  target.value?.focus({ preventScroll: true });
}
function send(data: Partial<WsBilldDeskBehaviorType['data']>) {
  emit('behavior', data);
}
function point(event: { clientX: number; clientY: number }, clamp = false) {
  const rect = props.video?.getBoundingClientRect();
  const surfaceRect = surface.value?.getBoundingClientRect();
  const stageRect = stage.value?.getBoundingClientRect();
  return rect && surfaceRect && stageRect
    ? viewportPoint(
        rect,
        surfaceRect,
        stageRect,
        event.clientX,
        event.clientY,
        clamp
      )
    : null;
}
const pointer = createPointerController({
  send,
  enabled: () => canControl.value && touchMode.value !== 'pan',
  mode: () => (touchMode.value === 'pan' ? 'tap' : touchMode.value),
  singleClick: () => view.value === 'tasks',
  verticalScroll: () => view.value === 'tasks',
  point,
});
const panPointer = createPanController({
  send,
  enabled: () => canControl.value && touchMode.value === 'pan',
  point,
  pan: (left, top) => stage.value?.scrollBy({ left, top }),
});
function pointerDown(event: PointerEvent) {
  const capture = panning.value ? panPointer.down(event) : pointer.down(event);
  if (capture) {
    event.preventDefault();
    stage.value?.setPointerCapture(event.pointerId);
  }
}
function pointerMove(event: PointerEvent) {
  if (panning.value) panPointer.move(event);
  else pointer.move(event);
}
function pointerUp(event: PointerEvent) {
  if (panning.value) panPointer.up(event);
  else pointer.up(event);
  if (stage.value?.hasPointerCapture(event.pointerId))
    stage.value.releasePointerCapture(event.pointerId);
}
function cancelPointers() {
  pointer.cancel();
  panPointer.cancel();
}
function lostPointerCapture() {
  pointer.lostCapture();
  panPointer.lostCapture();
}
function stageScroll() {
  panPointer.scrolled();
  rememberView();
}
function wheel(event: WheelEvent) {
  if (panning.value) {
    stage.value?.scrollBy({ left: event.deltaX, top: event.deltaY });
    return;
  }
  if (!canControl.value) return;
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
  if (!canControl.value || typeof key !== 'number') return;
  send({ type: Behavior.keyboardPressKey, key: [key] });
  send({ type: Behavior.keyboardReleaseKey, key: [key] });
}
function sendText() {
  if (!canControl.value || !draft.value.length) return;
  send({ type: Behavior.keyboardType, text: draft.value });
  draft.value = '';
}
const heldKeys = new Set<number>();
function releaseAll() {
  cancelPointers();
  heldKeys.clear();
  if (props.connected) send({ type: Behavior.releaseAll });
}
function keyboard(event: KeyboardEvent) {
  if (activePanel.value) {
    if (event.code === 'Escape') {
      event.preventDefault();
      if (event.type === 'keydown') closePanel(true);
    }
    return;
  }
  if (
    !canControl.value ||
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
function rememberView() {
  if (changingView || !layout || !stage.value) return;
  views[view.value] = {
    zoom: zoom.value,
    x: stage.value.scrollLeft / Math.max(1, layout.width),
    y: stage.value.scrollTop / Math.max(1, layout.height),
    touchMode: touchMode.value,
    keyboard: showKeyboard.value,
  };
}
async function changeView(next: View) {
  closePanel(true);
  if (view.value === next || changingView) return;
  rememberView();
  releaseAll();
  changingView = true;
  view.value = next;
  const saved = views[next];
  zoom.value = saved.zoom;
  touchMode.value = saved.touchMode;
  showKeyboard.value = saved.keyboard;
  await nextTick();
  resizeVideo();
  changingView = false;
}
function resizeVideo() {
  const video = props.video;
  if (
    !video ||
    !stage.value ||
    !surface.value ||
    !video.videoWidth ||
    !video.videoHeight
  )
    return;
  cancelPointers();
  hasFrame.value = true;
  layout = viewportLayout(
    { width: video.videoWidth, height: video.videoHeight },
    { width: stage.value.clientWidth, height: stage.value.clientHeight },
    zoom.value,
    view.value === 'tasks' ? sidebarWidth.value / 100 : 1
  );
  if (!layout) return;
  video.style.width = `${layout.videoWidth}px`;
  video.style.height = `${layout.videoHeight}px`;
  surface.value.style.width = `${layout.width}px`;
  surface.value.style.height = `${layout.height}px`;
  const saved = views[view.value];
  stage.value.scrollLeft = saved.x * layout.width;
  stage.value.scrollTop = saved.y * layout.height;
}
async function fullscreen() {
  closePanel();
  if (document.fullscreenElement) await document.exitFullscreen();
  else if (stage.value?.requestFullscreen)
    await stage.value.requestFullscreen();
  else if (props.video && 'webkitEnterFullscreen' in props.video)
    (props.video as any).webkitEnterFullscreen();
}
watch(
  () => props.video,
  async (video, old) => {
    cancelPointers();
    old?.removeEventListener('loadeddata', resizeVideo);
    old?.removeEventListener('resize', resizeVideo);
    old?.remove();
    hasFrame.value = false;
    await nextTick();
    if (video && surface.value) {
      surface.value.appendChild(video);
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
watch([zoom, showKeyboard, sidebarWidth], () => nextTick(resizeVideo));
watch([showKeyboard, canControl], ([visible, enabled]) => {
  if ((!visible || !enabled) && activePanel.value === 'directions')
    closePanel();
});
watch(
  () => props.taskNavigation,
  (enabled) => {
    if (!enabled) void changeView('content');
  }
);
useResizeObserver(stage, resizeVideo);
onMounted(() => {
  if (window.matchMedia('(pointer: coarse)').matches)
    touchMode.value = 'scroll';
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
  position: relative;
  isolation: isolate;
  container-type: inline-size;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: #f2f4f3;
}
button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  padding: 10px;
  border: 1px solid #d7ddda;
  border-radius: 4px;
  background: white;
  color: #304b41;
  cursor: pointer;
  touch-action: manipulation;
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
  border-color: #167c65;
  background: #def0e9;
}
button:focus-visible,
select:focus-visible,
input:focus-visible {
  outline: 2px solid #167c65;
  outline-offset: 2px;
}
.tools {
  position: relative;
  z-index: 3;
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  align-items: center;
  padding: 6px;
  background: white;
  border-bottom: 1px solid #d7ddda;
}
.control-popover {
  position: absolute;
  padding: 12px;
  box-sizing: border-box;
  border: 1px solid #d7ddda;
  border-radius: 10px;
  background: white;
  box-shadow: 0 8px 28px #10271d33;
  outline: none;
}
.settings-panel {
  top: calc(100% + 6px);
  right: 8px;
  width: min(320px, calc(100% - 16px));
  max-height: min(360px, calc(100dvh - 120px));
  overflow-y: auto;
  overscroll-behavior: contain;
}
.settings-heading {
  margin-bottom: 8px;
  font-size: 13px;
  color: #596c63;
}
.modes {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
}
.watch-toggle {
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
  font: 10px/12px system-ui;
  white-space: nowrap;
  svg {
    width: 16px;
    height: 16px;
  }
}
.zoom-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  font-size: 13px;
  white-space: nowrap;
}
.zoom-label {
  margin-left: auto;
}
select {
  height: 44px;
  width: 64px;
  padding: 4px;
  border: 1px solid #d7ddda;
  border-radius: 4px;
  background: white;
  font-size: 13px;
}
.popover-dismiss {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  cursor: default;
  touch-action: none;
}
.video-stage {
  flex: 1;
  min-width: 0;
  min-height: 120px;
  overflow: auto;
  display: flex;
  background: #252a28;
  touch-action: none;
  overscroll-behavior: contain;
}
.video-stage.watching {
  touch-action: pan-x pan-y;
}
.video-surface {
  position: relative;
  flex: 0 0 auto;
  margin: auto;
  overflow: hidden;
}
.video-stage :deep(video) {
  display: block;
  position: absolute;
  left: 0;
  top: 0;
  max-width: none;
  object-fit: contain;
  user-select: none;
}
.view-buttons,
.settings-actions {
  display: flex;
  gap: 6px;
  button {
    flex: 1;
    width: auto;
    gap: 6px;
    padding: 8px;
    font-size: 14px;
  }
  button[aria-pressed='true'] {
    color: #12664f;
    background: #def0e9;
    border-color: #167c65;
  }
}
.settings-actions {
  margin-top: 8px;
}
.sidebar-options {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 13px;
  white-space: nowrap;
  input {
    flex: 1;
    width: 0;
    min-width: 0;
    min-height: 44px;
  }
}
.task-hint {
  margin: 8px 0 0;
  color: #596c63;
  font-size: 12px;
  line-height: 1.5;
}
.keyboard-panel {
  position: relative;
  z-index: 3;
  flex: 0 0 auto;
  padding: 8px 12px max(10px, env(safe-area-inset-bottom));
  border-top: 1px solid #d7ddda;
  background: white;
}
.tools.panel-open,
.keyboard-panel.panel-open {
  z-index: 4;
}
.key-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.key-row > button,
.direction-control {
  flex: 1;
  min-width: 0;
}
.key-row > button {
  padding: 7px;
}
.direction-control {
  position: relative;
}
.direction-toggle {
  width: 100%;
}
.direction-pad {
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  grid-template-columns: repeat(3, 44px);
  grid-template-rows: repeat(3, 44px);
  grid-template-areas: '. up .' 'left . right' '. down .';
  gap: 4px;
  padding: 8px;
  touch-action: manipulation;
  .up {
    grid-area: up;
  }
  .left {
    grid-area: left;
  }
  .right {
    grid-area: right;
  }
  .down {
    grid-area: down;
  }
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
  border: 1px solid #c7d1cc;
  border-radius: 4px;
  font: 16px/1.4 system-ui;
}
.composer button {
  color: white;
  background: #167c65;
}
@media (max-width: 480px) {
  .keyboard-panel {
    padding-left: 8px;
    padding-right: 8px;
  }
}
@container (max-width: 358px) {
  .modes button,
  .watch-toggle,
  .settings-toggle {
    width: 40px;
  }
}
@container (max-width: 334px) {
  .modes button,
  .watch-toggle,
  .settings-toggle {
    width: 36px;
  }
  .modes button,
  .settings-toggle {
    padding: 8px;
  }
}
@container (max-width: 310px) {
  .tools {
    gap: 2px;
    padding-left: 3px;
    padding-right: 3px;
  }
  .modes button,
  .watch-toggle,
  .settings-toggle {
    width: 32px;
  }
  .modes button,
  .settings-toggle {
    padding: 5px;
  }
  select {
    width: 60px;
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
