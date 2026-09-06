<template>
  <NModal
    :show="true"
    :mask-closable="false"
    @update:show="close"
  >
    <section
      class="scan-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scan-title"
    >
      <header>
        <h2 id="scan-title">扫码连接</h2>
        <button
          type="button"
          title="关闭扫码"
          aria-label="关闭扫码"
          @click="close"
        >
          <CloseOutline />
        </button>
      </header>
      <div
        class="camera-preview"
        :aria-busy="starting"
      >
        <video
          ref="video"
          muted
          playsinline
          aria-label="扫码相机画面"
        />
        <span
          v-if="!cameraRunning"
          class="camera-status"
          >{{ starting ? '正在打开相机' : '相机未开启' }}</span
        >
      </div>
      <p
        v-if="error"
        class="scan-error"
        role="alert"
      >
        {{ error }}
      </p>
      <div class="scan-actions">
        <button
          type="button"
          :disabled="starting || readingImage || !cameraAvailable"
          title="重新打开相机"
          aria-label="重新打开相机"
          @click="startCamera"
        >
          <CameraOutline />
        </button>
        <button
          type="button"
          :disabled="readingImage"
          @click="fileInput?.click()"
        >
          <ImageOutline />{{ readingImage ? '识别中' : '选择二维码图片' }}
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          aria-label="二维码图片"
          class="file-input"
          @change="scanFile"
        />
      </div>
    </section>
  </NModal>
</template>

<script setup lang="ts">
import { CameraOutline, CloseOutline, ImageOutline } from '@vicons/ionicons5';
import { NModal } from 'naive-ui';
import QrScanner from 'qr-scanner';
import { onBeforeUnmount, onMounted, ref } from 'vue';

import {
  type ConnectionInvite,
  parseConnectionInvite,
} from '@/utils/connection-invite';

const emit = defineEmits<{ close: []; connect: [invite: ConnectionInvite] }>();
const video = ref<HTMLVideoElement>();
const fileInput = ref<HTMLInputElement>();
const starting = ref(false);
const readingImage = ref(false);
const cameraRunning = ref(false);
const error = ref('');
const cameraAvailable =
  window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
let scanner: QrScanner | undefined;
let disposed = false;
let finished = false;

function stopCamera() {
  scanner?.destroy();
  scanner = undefined;
  cameraRunning.value = false;
}

function close() {
  disposed = true;
  stopCamera();
  emit('close');
}

onBeforeUnmount(() => {
  disposed = true;
  stopCamera();
});
onMounted(startCamera);

function acceptResult(value: string) {
  if (disposed || finished) return;
  try {
    const invite = parseConnectionInvite(value);
    finished = true;
    stopCamera();
    emit('connect', invite);
  } catch (cause) {
    error.value = (cause as Error).message;
  }
}

async function startCamera() {
  if (starting.value || disposed || !video.value) return;
  if (!cameraAvailable) {
    error.value = window.isSecureContext
      ? '当前浏览器不支持相机扫码，可选择二维码图片'
      : '相机扫码需要 HTTPS，可选择二维码图片';
    return;
  }
  starting.value = true;
  error.value = '';
  stopCamera();
  const instance = new QrScanner(
    video.value,
    (result) => acceptResult(result.data),
    {
      preferredCamera: 'environment',
      maxScansPerSecond: 8,
      returnDetailedScanResult: true,
      onDecodeError: () => undefined,
    }
  );
  scanner = instance;
  try {
    await instance.start();
    if (disposed || finished) {
      instance.destroy();
      return;
    }
    cameraRunning.value = true;
  } catch {
    if (disposed || finished) return;
    stopCamera();
    error.value = '无法打开相机，请检查相机权限或选择二维码图片';
  } finally {
    starting.value = false;
  }
}

async function scanFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || readingImage.value) return;
  readingImage.value = true;
  error.value = '';
  try {
    const result = await QrScanner.scanImage(file, {
      returnDetailedScanResult: true,
    });
    acceptResult(result.data);
  } catch {
    if (!disposed && !finished)
      error.value = '未识别到二维码，请选择清晰的二维码图片';
  } finally {
    readingImage.value = false;
  }
}
</script>

<style scoped lang="scss">
.scan-dialog {
  box-sizing: border-box;
  width: min(420px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  margin: 16px auto;
  overflow-y: auto;
  padding: 18px;
  border-radius: 6px;
  background: white;
  color: #263b32;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
h2 {
  margin: 0;
  font-size: 18px;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px;
  border: 1px solid #d7ddda;
  border-radius: 4px;
  background: white;
  color: #167c65;
  font-size: 14px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
header button,
.scan-actions button:first-child {
  width: 40px;
  flex-shrink: 0;
}
svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.camera-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  background: #202724;
}
video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.camera-status {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: white;
  font-size: 14px;
}
.scan-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.file-input {
  display: none;
}
.scan-error {
  margin: 14px 0 0;
  color: #b43e4e;
  font-size: 13px;
  overflow-wrap: anywhere;
}

@media (max-height: 560px) and (orientation: landscape) {
  .scan-dialog {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(180px, 1fr);
    column-gap: 16px;
    width: min(620px, calc(100vw - 32px));
  }
  header {
    grid-column: 1 / -1;
  }
  .camera-preview {
    grid-column: 1;
    grid-row: 2 / 4;
    width: min(100%, calc(100dvh - 124px));
  }
  .scan-error {
    grid-column: 2;
    grid-row: 2;
    margin: 0;
  }
  .scan-actions {
    grid-column: 2;
    grid-row: 3;
    flex-wrap: wrap;
    align-self: end;
    margin-top: 12px;
  }
}
</style>
