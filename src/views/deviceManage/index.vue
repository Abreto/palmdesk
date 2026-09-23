<template>
  <main class="devices-page pd-page">
    <header class="pd-page-heading">
      <span class="pd-eyebrow">设备</span>
      <h1>随时连接设备。</h1>
      <p>选择最近连接的电脑。</p>
    </header>
    <section
      class="devices-card pd-card"
      aria-labelledby="recent-devices-title"
    >
      <div class="list-heading">
        <h2 id="recent-devices-title">最近连接</h2>
        <span>{{ cacheStore.linkDeviceList.length }} 台设备</span>
      </div>
      <div
        v-if="!cacheStore.linkDeviceList.length"
        class="empty-state"
      >
        <span class="empty-icon"><LaptopOutline aria-hidden="true" /></span>
        <h3>开始连接</h3>
        <p>连接记录会显示在这里。</p>
        <RouterLink
          class="pd-button"
          :to="{ name: routerName.remote }"
          >连接电脑<ArrowForwardOutline aria-hidden="true"
        /></RouterLink>
      </div>
      <div
        v-else
        class="link-device-list"
      >
        <div
          v-for="item in cacheStore.linkDeviceList"
          :key="item.remoteDeskUserUuid"
          class="link-device-item"
        >
          <button
            class="left"
            type="button"
            @click="selectDevice(item)"
          >
            <span class="device-icon"
              ><LaptopOutline aria-hidden="true"
            /></span>
            <span class="device-details"
              ><strong>{{ item.remoteDeskUserUuid }}</strong
              ><span>已保存的设备</span></span
            >
            <span class="connect-label"
              >连接<ArrowForwardOutline aria-hidden="true"
            /></span>
          </button>
          <button
            class="del pd-icon-button"
            type="button"
            title="移除记录"
            :aria-label="`移除 ${item.remoteDeskUserUuid}`"
            @click="handleDelLinkDeviceList(item)"
          >
            <TrashOutline />
          </button>
        </div>
      </div>
    </section>
  </main>
</template>

<script lang="ts" setup>
import {
  ArrowForwardOutline,
  LaptopOutline,
  TrashOutline,
} from '@vicons/ionicons5';

import router, { routerName } from '@/router';
import { usePiniaCacheStore } from '@/store/cache';

const cacheStore = usePiniaCacheStore();

function selectDevice(item) {
  cacheStore.remoteDeskUserUuid = item.remoteDeskUserUuid;
  cacheStore.remoteDeskUserPassword = item.remoteDeskUserPassword;
  void router.push({ name: routerName.remote });
}
function handleDelLinkDeviceList(item) {
  cacheStore.linkDeviceList = cacheStore.linkDeviceList.filter(
    (v) => v.remoteDeskUserUuid !== item.remoteDeskUserUuid
  );
}
</script>

<style lang="scss" scoped>
.list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--pd-border);
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  > span {
    padding: 3px 9px;
    border-radius: 20px;
    background: var(--pd-surface-soft);
    color: var(--pd-muted);
    font-size: 11px;
  }
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64px 20px;
  text-align: center;
  h3 {
    margin: 22px 0 8px;
    font-size: 18px;
    font-weight: 550;
  }
  p {
    margin: 0 0 24px;
    color: var(--pd-muted);
    font-size: 13px;
    line-height: 1.9;
  }
}
.empty-icon {
  display: grid;
  place-items: center;
  width: 76px;
  height: 76px;
  border: 1px solid #dce5d6;
  border-radius: 24px;
  background: var(--pd-accent-soft);
  color: var(--pd-accent);
  transform: rotate(-6deg);
  svg {
    width: 34px;
    height: 34px;
    transform: rotate(6deg);
  }
}
.link-device-list {
  padding-top: 8px;
}
.link-device-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  & + & {
    border-top: 1px solid var(--pd-border);
  }
}
.left {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 14px;
  min-width: 0;
  padding: 12px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--pd-text);
  text-align: left;
  cursor: pointer;
  &:hover {
    background: var(--pd-surface-soft);
  }
}
.device-icon {
  display: grid;
  place-items: center;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--pd-surface-soft);
  color: var(--pd-accent);
  svg {
    width: 24px;
    height: 24px;
  }
}
.device-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
  strong {
    font: 550 16px var(--pd-mono);
    letter-spacing: 1px;
    overflow-wrap: anywhere;
  }
  > span {
    color: var(--pd-muted);
    font-size: 11px;
  }
}
.connect-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  color: var(--pd-accent);
  font-size: 12px;
  svg {
    width: 16px;
    height: 16px;
  }
}
.del {
  border-color: transparent;
  &:hover {
    color: var(--pd-danger);
    background: var(--pd-danger-soft);
  }
}
@media (max-width: 700px) {
  .empty-state {
    padding: 48px 8px;
  }
  .connect-label {
    font-size: 0;
    gap: 0;
  }
  .link-device-item {
    gap: 4px;
  }
  .left {
    gap: 10px;
    padding-inline: 0;
  }
}
</style>
