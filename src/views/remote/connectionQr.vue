<template>
  <section
    class="connection-qr"
    aria-label="手机扫码连接"
  >
    <div
      class="qr-image"
      role="img"
      :aria-label="qrVisible ? '连接二维码' : '连接二维码已隐藏'"
    >
      <NQrCode
        v-if="inviteUrl && qrVisible"
        :value="inviteUrl"
        :size="184"
        :padding="16"
        color="#111111"
        background-color="#ffffff"
      />
      <QrCodeOutline
        v-else
        class="qr-placeholder"
        :class="{ 'qr-concealed': !!inviteUrl }"
        aria-hidden="true"
      />
    </div>
    <div class="qr-details">
      <span class="pd-eyebrow">桌面 → 掌心</span>
      <h2>手机扫码连接</h2>
      <p
        v-if="unavailable"
        class="qr-status"
        role="status"
      >
        {{ unavailable }}
      </p>
      <p
        v-else
        class="qr-status"
      >
        手机扫码连接此设备。
      </p>
      <div class="qr-address">{{ clientUrl || '未设置手机网页地址' }}</div>
      <div class="qr-actions">
        <button
          class="qr-toggle"
          type="button"
          :aria-label="qrVisible ? '隐藏二维码' : '显示二维码'"
          :aria-pressed="qrVisible"
          :disabled="!inviteUrl"
          @click="qrVisible = !qrVisible"
        >
          <EyeOffOutline v-if="qrVisible" /><EyeOutline v-else />
          <span>{{ qrVisible ? '隐藏二维码' : '显示二维码' }}</span>
        </button>
        <button
          type="button"
          title="设置手机网页地址"
          aria-label="设置手机网页地址"
          @click="emit('settings')"
        >
          <SettingsOutline />
        </button>
        <button
          type="button"
          title="复制连接链接"
          aria-label="复制连接链接"
          :disabled="!inviteUrl"
          @click="copyInvite"
        >
          <CopyOutline />
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  CopyOutline,
  EyeOffOutline,
  EyeOutline,
  QrCodeOutline,
  SettingsOutline,
} from '@vicons/ionicons5';
import { copyToClipBoard } from 'billd-utils';
import { NQrCode } from 'naive-ui';
import { computed, ref, watch } from 'vue';

import { createConnectionInvite } from '@/utils/connection-invite';
import { getClientUrl } from '@/utils/localStorage/app';

const props = defineProps<{
  device: string;
  password: string;
  ready: boolean;
}>();
const emit = defineEmits<{ settings: [] }>();
const clientUrl = getClientUrl();
const invitation = computed(() => {
  if (!clientUrl) return { url: '', error: '等待设置访问地址' };
  if (!props.ready) return { url: '', error: '等待连接服务' };
  try {
    return {
      url: createConnectionInvite(clientUrl, props.device, props.password),
      error: '',
    };
  } catch (cause) {
    return { url: '', error: (cause as Error).message };
  }
});
const inviteUrl = computed(() => invitation.value.url);
const unavailable = computed(() => invitation.value.error);
const qrVisible = ref(false);

// Conceal credentials again when the invitation changes or becomes unavailable.
watch(
  inviteUrl,
  () => {
    qrVisible.value = false;
  },
  { flush: 'sync' }
);

function copyInvite() {
  if (!inviteUrl.value) return;
  copyToClipBoard(inviteUrl.value);
  window.$message.success('已复制连接链接');
}
</script>

<style scoped lang="scss">
.connection-qr {
  display: grid;
  grid-template-columns: 216px minmax(0, 1fr);
  align-items: center;
  gap: 20px;
  padding: 16px;
  margin-top: 16px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-lg);
  background: var(--pd-surface-soft);
}
.qr-image {
  display: grid;
  place-items: center;
  width: 216px;
  height: 216px;
  background: white;
  overflow: hidden;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius);
  box-shadow: var(--pd-shadow);
}
.qr-placeholder {
  width: 72px;
  height: 72px;
  color: var(--pd-border-strong);
}
// The concealed image contains no invitation data, even if its blur is removed.
.qr-concealed {
  width: 184px;
  height: 184px;
  filter: blur(6px);
}
h2 {
  margin: 12px 0 10px;
  font-size: 20px;
  font-weight: 600;
  color: var(--pd-text);
}
.qr-status,
.qr-address {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--pd-muted);
  overflow-wrap: anywhere;
}
.qr-address {
  user-select: text;
  font-family: var(--pd-mono);
  font-size: 11px;
}
.qr-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
button {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 8px;
  border: 1px solid var(--pd-border-strong);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface);
  color: var(--pd-accent);
  cursor: pointer;
  &:hover:not(:disabled) {
    background: var(--pd-accent-soft);
  }
}
button svg {
  width: 20px;
  height: 20px;
}
.qr-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: auto;
  padding: 8px 12px;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
@media (max-height: 650px) {
  .connection-qr {
    padding: 12px;
    margin-top: 12px;
  }
}
@media (max-width: 760px) {
  .connection-qr {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
    justify-items: center;
    text-align: center;
  }
  .qr-actions {
    justify-content: center;
  }
}
</style>
