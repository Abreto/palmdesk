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

import { WINDOW_ID_ENUM } from '@/constant';
import { useIpcRendererSend } from '@/hooks/use-ipcRendererSend';
import { useReleaseBanner } from '@/hooks/use-release-banner';
import { useAppStore } from '@/store/app';

const appStore = useAppStore();
const { handleOpenExternal } = useIpcRendererSend();
const { latest, dismiss } = useReleaseBanner(() => appStore.release);

function openRelease() {
  if (latest.value)
    handleOpenExternal({
      windowId: WINDOW_ID_ENUM.remote,
      url: latest.value.url,
    });
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
