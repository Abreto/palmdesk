<template>
  <main class="settings-page">
    <h1>高级设置</h1>
    <section>
      <header>
        <h2>连接服务</h2>
        <button
          type="button"
          title="修改连接服务"
          aria-label="修改连接服务"
          @click="showUrlModal = true"
        >
          <SettingsOutline />
        </button>
      </header>
      <dl>
        <dt>服务地址</dt>
        <dd>{{ getAxiosBaseUrl() || AXIOS_BASEURL }}</dd>
        <dt>信令地址</dt>
        <dd>{{ getWssUrl() || WEBSOCKET_URL }}</dd>
        <dt>中继地址</dt>
        <dd>{{ getCoturnUrl() || COTURN_URL || '未配置' }}</dd>
      </dl>
    </section>
    <section v-if="ipcRenderer">
      <h2>电脑客户端</h2>
      <label class="toggle"
        ><input
          v-model="cacheStore.isAlwaysOnTop"
          type="checkbox"
        />窗口置顶</label
      >
    </section>
    <section>
      <h2>{{ PRODUCT_NAME }}</h2>
      <p>v{{ appStore.version }}</p>
      <a
        :href="PROJECT_GITHUB"
        target="_blank"
        rel="noopener"
        @click.prevent="openProject(PROJECT_GITHUB)"
        >PalmDesk <OpenOutline
      /></a>
      <p>
        <a
          :href="UPSTREAM_GITHUB"
          target="_blank"
          rel="noopener"
          @click.prevent="openProject(UPSTREAM_GITHUB)"
          >BilldDesk (MIT) <OpenOutline
        /></a>
      </p>
    </section>
    <UrlModal
      v-if="showUrlModal"
      @close="showUrlModal = false"
    />
  </main>
</template>

<script setup lang="ts">
import { OpenOutline, SettingsOutline } from '@vicons/ionicons5';
import { ref, watch } from 'vue';

import {
  AXIOS_BASEURL,
  COTURN_URL,
  PRODUCT_NAME,
  PROJECT_GITHUB,
  UPSTREAM_GITHUB,
  WEBSOCKET_URL,
  WINDOW_ID_ENUM,
} from '@/constant';
import { useIpcRendererSend } from '@/hooks/use-ipcRendererSend';
import { useAppStore } from '@/store/app';
import { usePiniaCacheStore } from '@/store/cache';
import { ipcRenderer } from '@/utils';
import {
  getAxiosBaseUrl,
  getCoturnUrl,
  getWssUrl,
} from '@/utils/localStorage/app';

import UrlModal from './urlModal.vue';

const appStore = useAppStore();
const cacheStore = usePiniaCacheStore();
const showUrlModal = ref(false);
const { handleOpenExternal, handlesetAlwaysOnTop } = useIpcRendererSend();
function openProject(url: string) {
  handleOpenExternal({
    windowId: WINDOW_ID_ENUM.remote,
    url,
  });
}
watch(
  () => cacheStore.isAlwaysOnTop,
  (flag) => {
    if (ipcRenderer)
      handlesetAlwaysOnTop({ windowId: WINDOW_ID_ENUM.remote, flag });
  }
);
</script>

<style scoped lang="scss">
.settings-page {
  box-sizing: border-box;
  padding: 64px 40px 32px;
  color: #263b32;
}
h1 {
  margin: 0 0 24px;
  font-size: 24px;
}
section {
  padding: 20px 0;
  border-top: 1px solid #d7ddda;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
h2 {
  margin: 0 0 16px;
  font-size: 16px;
}
header h2 {
  margin: 0;
}
button {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid #d7ddda;
  border-radius: 4px;
  background: white;
  color: #167c65;
  cursor: pointer;
}
svg {
  width: 20px;
  height: 20px;
}
dl {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 16px;
  font-size: 14px;
}
dt {
  color: #60726a;
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
  user-select: text;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}
a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #167c65;
}
p {
  font-size: 14px;
}
@media (max-width: 640px) {
  .settings-page {
    padding: 30px 18px;
  }
  dl {
    grid-template-columns: 78px minmax(0, 1fr);
    gap: 14px;
  }
}
</style>
