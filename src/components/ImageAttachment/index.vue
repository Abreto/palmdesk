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
      v-if="attachment"
      class="image-preview"
    >
      <img
        :src="attachment.url"
        alt="待粘贴的图片预览"
      />
      <div class="image-details">
        <span class="image-name">{{ attachment.name }}</span>
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
          <button
            v-else
            type="button"
            aria-label="移除图片"
            @click="clearAttachment"
          >
            移除
          </button>
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
  </div>
</template>

<script setup lang="ts">
import { ClipboardOutline, ImageOutline } from '@vicons/ionicons5';
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';

import {
  type ImagePayload,
  MAX_IMAGE_BYTES,
  inspectImage,
} from '@/utils/image-payload';
import { ImageTransferClient } from '@/utils/image-transfer-channel';

const props = defineProps<{
  enabled: boolean;
  channel?: RTCDataChannel;
  sessionId: string;
  commitPaste?: (sessionId: string, id: number) => void;
  reconnectChannel?: () => void;
}>();
const emit = defineEmits<{ busy: [value: boolean] }>();
const picker = ref<HTMLInputElement>();
const attachment = shallowRef<{
  image: ImagePayload;
  name: string;
  url: string;
}>();
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
function clearAttachment() {
  selection += 1;
  reading.value = false;
  if (attachment.value) URL.revokeObjectURL(attachment.value.url);
  attachment.value = undefined;
  message.value = '';
}
function beginSelection() {
  clearAttachment();
  reading.value = true;
  return selection;
}
async function loadImage(file: Blob, name: string, version: number) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('图片不能超过 10 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (version !== selection || !props.enabled || busy.value || disposed) return;
  const { mime } = inspectImage(bytes);
  attachment.value = {
    image: { mime, bytes },
    name,
    url: URL.createObjectURL(new Blob([bytes], { type: mime })),
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
  if (!selected || !transfer || !props.enabled || busy.value || reading.value)
    return;
  selection += 1;
  busy.value = true;
  emit('busy', true);
  progress.value = 0;
  failed.value = false;
  message.value = '';
  try {
    await transfer.paste(selected.image, sessionId, (value) => {
      progress.value = value;
    });
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
  padding: 0 8px 8px;
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
  color: #64726a;
}
.image-tools > span {
  color: #64726a;
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
  background: white;
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
img {
  width: 64px;
  height: 64px;
  object-fit: contain;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  background: white;
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
small {
  color: #64726a;
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
</style>
