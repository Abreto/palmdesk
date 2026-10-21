<template>
  <div
    v-if="latest"
    class="release-banner"
    :class="{ security: latest.security }"
    role="status"
  >
    <span class="text">
      <strong>PalmDesk v{{ latest.version }} 已发布</strong>
      <span>{{
        latest.security
          ? '此版本包含安全修复，请尽快更新。'
          : `当前版本 v${appStore.release?.current}。`
      }}</span>
    </span>
    <button
      type="button"
      class="pd-button"
      @click="openRelease"
    >
      查看更新
    </button>
    <button
      type="button"
      class="dismiss"
      title="暂不提醒"
      aria-label="暂不提醒"
      @click="dismiss"
    >
      <CloseOutline aria-hidden="true" />
    </button>
  </div>
</template>

<script lang="ts" setup>
import { CloseOutline } from '@vicons/ionicons5';
import { computed, ref } from 'vue';

import { WINDOW_ID_ENUM } from '@/constant';
import { useIpcRendererSend } from '@/hooks/use-ipcRendererSend';
import { useAppStore } from '@/store/app';

const DISMISSED_KEY = 'palmdesk-release-dismissed';

const appStore = useAppStore();
const { handleOpenExternal } = useIpcRendererSend();

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) || '';
  } catch {
    return '';
  }
}

const dismissed = ref(readDismissed());
const latest = computed(() => {
  const release = appStore.release;
  return release?.available && release.latest?.version !== dismissed.value
    ? release.latest
    : undefined;
});

function openRelease() {
  if (latest.value)
    handleOpenExternal({
      windowId: WINDOW_ID_ENUM.remote,
      url: latest.value.url,
    });
}

// A dismissed release stays hidden after restarts, unless it fixes security issues.
function dismiss() {
  if (!latest.value) return;
  dismissed.value = latest.value.version;
  if (latest.value.security) return;
  try {
    localStorage.setItem(DISMISSED_KEY, latest.value.version);
  } catch {
    // Without storage the banner returns on the next launch.
  }
}
</script>

<style lang="scss" scoped>
.release-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 24px 0;
  padding: 12px 12px 12px 16px;
  border: 1px solid var(--pd-border-strong);
  border-radius: var(--pd-radius);
  background: var(--pd-accent-soft);
  font-size: 13px;
  &.security {
    border-color: var(--pd-danger);
    background: var(--pd-danger-soft);
  }
  .text {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: 4px 10px;
    min-width: 0;
    span {
      color: var(--pd-muted);
    }
  }
  .pd-button {
    min-height: 36px;
    padding: 7px 14px;
  }
  .dismiss {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 6px;
    border: 0;
    border-radius: var(--pd-radius-sm);
    background: transparent;
    color: var(--pd-muted);
    cursor: pointer;
    &:hover {
      background: var(--pd-surface);
    }
    svg {
      width: 18px;
      height: 18px;
    }
  }
}
</style>
