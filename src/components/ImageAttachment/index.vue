<template>
  <div class="image-attachment">
    <div class="image-tools">
      <input
        ref="picker"
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        aria-label="选择图片文件"
        hidden
        @change="selectFile"
      />
      <button
        type="button"
        :disabled="!enabled || busy"
        @click="picker?.click()"
      >
        <ImageOutline />选择图片
      </button>
      <button
        type="button"
        :disabled="!enabled || busy"
        @click="readClipboard"
      >
        <ClipboardOutline />粘贴图片
      </button>
      <span>PNG / JPEG · 最大 10 MB</span>
    </div>
    <div
      v-if="!channelReady"
      class="image-connection"
      role="status"
    >
      <span>{{ connecting ? '正在连接图片…' : '图片连接已断开' }}</span>
      <button
        v-if="!connecting"
        type="button"
        :disabled="!enabled"
        @click="reconnect"
      >
        重新连接图片
      </button>
    </div>
    <p
      v-if="reading"
      role="status"
    >
      正在读取图片…
    </p>
    <div
      v-if="attachment && shown"
      class="image-preview"
    >
      <button
        type="button"
        class="image-thumb"
        aria-label="查看待粘贴的图片"
        @click="viewing = true"
      >
        <img
          :src="shown.url"
          alt="待粘贴的图片预览"
        />
      </button>
      <div class="image-details">
        <span class="image-name">{{ attachment.name }}</span>
        <span class="image-meta">{{ describe(attachment) }}</span>
        <small>先点上方 Codex 的输入框，再粘贴图片。</small>
        <div class="image-actions">
          <button
            type="button"
            :disabled="!enabled || busy || reading || !channelReady"
            @click="send"
          >
            {{ busy ? `正在传输 ${progress}%` : '粘贴到 Codex' }}
          </button>
          <button
            v-if="busy"
            type="button"
            @click="client?.cancel()"
          >
            取消
          </button>
          <template v-else>
            <button
              ref="editButton"
              type="button"
              @click="openEditor"
            >
              <CreateOutline />编辑
            </button>
            <button
              type="button"
              aria-label="移除图片"
              @click="clearAttachment"
            >
              移除
            </button>
          </template>
        </div>
        <progress
          v-if="busy"
          :value="progress"
          max="100"
          aria-label="图片传输进度"
        ></progress>
      </div>
    </div>
    <p
      v-if="message"
      class="image-message"
      :class="{ error: failed }"
      role="status"
    >
      {{ message }}
    </p>
    <ImageEditor
      v-if="attachment && editing"
      :src="attachment.original.url"
      :steps="attachment.steps"
      @apply="applyEdit"
      @close="closeEditor"
    />
    <div
      v-if="attachment && shown && viewing"
      ref="viewer"
      class="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="待粘贴的图片"
      tabindex="-1"
      @keydown.stop="viewerKeydown"
      @keyup.stop
    >
      <div class="viewer-image">
        <img
          :src="shown.url"
          alt="将要粘贴的图片"
        />
      </div>
      <p>{{ describe(attachment) }}</p>
      <div class="image-actions">
        <button
          type="button"
          @click="openEditor"
        >
          <CreateOutline />编辑图片
        </button>
        <button
          type="button"
          @click="closeViewer"
        >
          关闭
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ClipboardOutline,
  CreateOutline,
  ImageOutline,
} from '@vicons/ionicons5';
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue';

import ImageEditor from '@/components/ImageEditor/index.vue';
import type { MarkupExport, MarkupStep } from '@/utils/image-markup';
import {
  type ImagePayload,
  MAX_IMAGE_BYTES,
  formatImageBytes,
  inspectImage,
} from '@/utils/image-payload';
import { ImageTransferClient } from '@/utils/image-transfer-channel';

type Version = {
  image: ImagePayload;
  url: string;
  width: number;
  height: number;
};
// Edits are steps over the untouched original, which reset returns to.
type Attachment = {
  name: string;
  original: Version;
  edited?: Version;
  steps: readonly MarkupStep[];
};

const props = defineProps<{
  enabled: boolean;
  channel?: RTCDataChannel;
  sessionId: string;
  commitPaste?: (sessionId: string, id: number) => void;
  reconnectChannel?: () => void;
}>();
const emit = defineEmits<{ busy: [value: boolean] }>();
const picker = ref<HTMLInputElement>();
const editButton = ref<HTMLButtonElement>();
const viewer = ref<HTMLDivElement>();
const attachment = shallowRef<Attachment>();
// Untouched images keep the lossless path: their original bytes are pasted.
const shown = computed(
  () =>
    attachment.value && (attachment.value.edited ?? attachment.value.original)
);
const editing = ref(false);
const viewing = ref(false);
const client = shallowRef<ImageTransferClient>();
const busy = ref(false);
const reading = ref(false);
const progress = ref(0);
const message = ref('');
const failed = ref(false);
let selection = 0;
let disposed = false;
const channelReady = ref(false);
const connecting = ref(false);
function updateChannelReady() {
  channelReady.value = props.channel?.readyState === 'open';
  connecting.value = props.channel?.readyState === 'connecting';
}
function reconnect() {
  if (!props.enabled) return;
  try {
    if (!props.reconnectChannel) throw new Error('请重新连接窗口后重试');
    props.reconnectChannel();
  } catch (error) {
    report(error);
  }
}

function report(error: unknown) {
  failed.value = true;
  message.value = error instanceof Error ? error.message : '无法读取图片';
}
function imageVersion(
  image: ImagePayload,
  width: number,
  height: number
): Version {
  return {
    image,
    width,
    height,
    url: URL.createObjectURL(new Blob([image.bytes], { type: image.mime })),
  };
}
function describe(value: Attachment) {
  const { image, width, height } = value.edited ?? value.original;
  return [
    value.edited ? '已编辑' : '原图',
    image.mime === 'image/png' ? 'PNG' : 'JPEG',
    `${width}×${height}`,
    formatImageBytes(image.bytes.length),
  ].join(' · ');
}
function clearAttachment() {
  selection += 1;
  reading.value = false;
  editing.value = false;
  viewing.value = false;
  const current = attachment.value;
  if (current) {
    URL.revokeObjectURL(current.original.url);
    if (current.edited) URL.revokeObjectURL(current.edited.url);
  }
  attachment.value = undefined;
  message.value = '';
}
function openEditor() {
  if (!attachment.value || busy.value) return;
  viewing.value = false;
  editing.value = true;
}
function restoreFocus() {
  nextTick(() => editButton.value?.focus());
}
function closeEditor() {
  editing.value = false;
  restoreFocus();
}
function applyEdit(steps: readonly MarkupStep[], result?: MarkupExport) {
  const current = attachment.value;
  editing.value = false;
  if (!current || busy.value) return;
  if (current.edited) URL.revokeObjectURL(current.edited.url);
  attachment.value = {
    ...current,
    steps,
    edited: result && imageVersion(result.image, result.width, result.height),
  };
  failed.value = false;
  message.value = '';
  restoreFocus();
}
function closeViewer() {
  viewing.value = false;
  restoreFocus();
}
function viewerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  closeViewer();
}
// Keep keyboard input inside the dialog, away from the remote window.
watch(viewing, (open) => {
  if (open) nextTick(() => viewer.value?.focus());
});
function beginSelection() {
  clearAttachment();
  reading.value = true;
  return selection;
}
async function loadImage(file: Blob, name: string, version: number) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('图片不能超过 10 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (version !== selection || !props.enabled || busy.value || disposed) return;
  const { mime, width, height } = inspectImage(bytes);
  attachment.value = {
    name,
    original: imageVersion({ mime, bytes }, width, height),
    steps: [],
  };
  failed.value = false;
}
async function acceptImage(file: Blob, name = '剪贴板图片') {
  if (!props.enabled || busy.value) return;
  const version = beginSelection();
  try {
    await loadImage(file, name, version);
  } catch (error) {
    if (version === selection) report(error);
  } finally {
    if (version === selection) reading.value = false;
  }
}
function selectFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void acceptImage(file, file.name);
}
function paste(event: ClipboardEvent) {
  // The textarea remains editable while remote input is paused or uploading.
  // Preserve its normal text paste when we cannot accept the image.
  if (!props.enabled || busy.value) return;
  const items = Array.from(event.clipboardData?.items || []);
  const item = items.find(
    (entry) => entry.kind === 'file' && entry.type.startsWith('image/')
  );
  if (!item) return;
  const file = item.getAsFile();
  if (!file) return;
  event.preventDefault();
  void acceptImage(file, file.name || '剪贴板图片');
}
async function readClipboard() {
  if (!props.enabled || busy.value) return;
  const version = beginSelection();
  try {
    if (!navigator.clipboard?.read)
      throw new Error(
        '当前浏览器无法读取剪贴板，请选择图片，或在文字框中长按粘贴'
      );
    // Call directly from the button gesture; Safari requires user activation.
    const items = await navigator.clipboard.read();
    const item = items.find((entry) =>
      entry.types.some((type) => ['image/png', 'image/jpeg'].includes(type))
    );
    const type = item?.types.find((value) =>
      ['image/png', 'image/jpeg'].includes(value)
    );
    if (!item || !type)
      throw new Error('剪贴板中没有 PNG 或 JPEG 图片，请选择图片');
    const blob = await item.getType(type);
    if (version === selection && props.enabled && !busy.value)
      await loadImage(blob, '剪贴板图片', version);
  } catch (error) {
    if (version !== selection) return;
    report(
      error instanceof DOMException && error.name === 'NotAllowedError'
        ? new Error('未能读取剪贴板，请允许粘贴，或使用「选择图片」')
        : error
    );
  } finally {
    if (version === selection) reading.value = false;
  }
}
async function send() {
  const selected = attachment.value;
  const transfer = client.value;
  const sessionId = props.sessionId;
  if (
    !selected ||
    !transfer ||
    !props.enabled ||
    busy.value ||
    reading.value ||
    editing.value
  )
    return;
  selection += 1;
  busy.value = true;
  emit('busy', true);
  progress.value = 0;
  failed.value = false;
  message.value = '';
  try {
    await transfer.paste(
      (selected.edited ?? selected.original).image,
      sessionId,
      (value) => {
        progress.value = value;
      }
    );
    if (
      disposed ||
      sessionId !== props.sessionId ||
      attachment.value !== selected
    )
      return;
    clearAttachment();
    message.value = '已执行粘贴，请在 Codex 输入框中确认图片，再发送消息。';
  } catch (error) {
    if (
      !disposed &&
      sessionId === props.sessionId &&
      attachment.value === selected
    )
      report(error);
  } finally {
    if (!disposed) {
      busy.value = false;
      emit('busy', false);
    }
  }
}
watch(
  () => props.channel,
  (channel, previous) => {
    previous?.removeEventListener('open', updateChannelReady);
    previous?.removeEventListener('close', updateChannelReady);
    client.value?.dispose();
    client.value = channel
      ? new ImageTransferClient(channel, (sessionId, id) => {
          if (
            !props.enabled ||
            !props.commitPaste ||
            sessionId !== props.sessionId
          )
            throw new Error('窗口控制会话已结束');
          props.commitPaste(sessionId, id);
        })
      : undefined;
    channel?.addEventListener('open', updateChannelReady);
    channel?.addEventListener('close', updateChannelReady);
    updateChannelReady();
  },
  { immediate: true }
);
watch(
  () => props.enabled,
  (enabled) => {
    if (!enabled) {
      selection += 1;
      reading.value = false;
      client.value?.cancel();
    }
  }
);
watch(
  () => props.sessionId,
  () => {
    client.value?.cancel();
    clearAttachment();
  }
);
onBeforeUnmount(() => {
  disposed = true;
  props.channel?.removeEventListener('open', updateChannelReady);
  props.channel?.removeEventListener('close', updateChannelReady);
  client.value?.dispose();
  clearAttachment();
  busy.value = false;
  emit('busy', false);
});
defineExpose({ paste });
</script>

<style scoped lang="scss">
.image-attachment {
  padding: 8px;
  font-size: 12px;
}
.image-tools,
.image-actions,
.image-connection {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.image-connection {
  margin-top: 8px;
  color: var(--pd-muted);
}
.image-tools > span {
  color: var(--pd-muted);
  font-size: 11px;
}
button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface);
  color: var(--pd-text);
  cursor: pointer;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
button svg {
  width: 18px;
  height: 18px;
}
.image-preview {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
.image-thumb {
  flex: 0 0 auto;
  align-self: flex-start;
  min-height: 0;
  padding: 0;
  border: 0;
  background: none;
}
.image-thumb img {
  display: block;
  width: 64px;
  height: 64px;
  object-fit: contain;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface-soft);
}
.image-details {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}
.image-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image-meta {
  color: var(--pd-muted);
  font-variant-numeric: tabular-nums;
}
small {
  color: var(--pd-muted);
}
progress {
  width: 100%;
  height: 6px;
  accent-color: var(--pd-accent);
}
.image-message {
  margin: 8px 0 0;
  color: var(--pd-accent);
}
.image-message.error {
  color: var(--pd-danger);
}
.image-viewer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-sizing: border-box;
  padding: max(12px, env(safe-area-inset-top))
    max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom))
    max(12px, env(safe-area-inset-left));
  background: #101412;
  color: #f2f5f3;
  font-size: 13px;
  outline: none;
}
.viewer-image {
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
}
// Shown at its exported size or smaller, over a checkerboard for transparency.
.viewer-image img {
  max-width: 100%;
  max-height: 100%;
  background-color: #fff;
  background-image: conic-gradient(
    #d3dad6 25%,
    transparent 0 50%,
    #d3dad6 0 75%,
    transparent 0
  );
  background-size: 16px 16px;
}
.image-viewer p {
  margin: 0;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.image-viewer .image-actions {
  justify-content: center;
}
.image-viewer button {
  border-color: #3a4540;
  background: #1b221f;
  color: inherit;
}
</style>
