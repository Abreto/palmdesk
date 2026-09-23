<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-message-provider :max="3">
      <n-modal-provider>
        <n-dialog-provider>
          <router-view></router-view>
          <NaiveModal />
          <NaiveMessage />
        </n-dialog-provider>
      </n-modal-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script lang="ts" setup>
import { GlobalThemeOverrides, NConfigProvider } from 'naive-ui';
import { onMounted } from 'vue';

import {
  fetchDeskVersionByVersion,
  fetchDeskVersionCheck,
  fetchDeskVersionLatest,
} from '@/api/deskVersion';
import { APP_BUILD_INFO, WINDOW_ID_ENUM } from '@/constant';
import { useIpcRendererSend } from '@/hooks/use-ipcRendererSend';
import { useAppStore } from '@/store/app';
import { usePiniaCacheStore } from '@/store/cache';
import { ipcRenderer } from '@/utils';

const appStore = useAppStore();
const cacheStore = usePiniaCacheStore();

const { handlesetAlwaysOnTop, handleOpenDevTools } = useIpcRendererSend();
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#25634d',
    primaryColorHover: '#1c503d',
    primaryColorPressed: '#184433',
    primaryColorSuppl: '#25634d',
    textColorBase: '#243a31',
    textColor1: '#243a31',
    textColor2: '#4e6257',
    textColor3: '#66756c',
    borderColor: '#dfe5dc',
    borderRadius: '10px',
    borderRadiusSmall: '6px',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif",
  },
  Dialog: {
    borderRadius: '20px',
  },
  Card: {
    borderRadius: '20px',
  },
};

onMounted(() => {
  appStore.version = APP_BUILD_INFO.pkgVersion;
  appStore.lastBuildDate = APP_BUILD_INFO.lastBuildDate;
  handlesetAlwaysOnTop({
    windowId: WINDOW_ID_ENUM.remote,
    flag: cacheStore.isAlwaysOnTop,
  });
  if (import.meta.env.VITE_ENABLE_UPSTREAM_VERSION_CHECK === 'true') {
    getClient();
    if (ipcRenderer) handleDeskVersionCheck();
  }
  if (ipcRenderer && import.meta.env.VITE_OPEN_DEVTOOLS === 'true') {
    handleOpenDevTools({ windowId: WINDOW_ID_ENUM.remote });
  }
});

async function handleDeskVersionCheck() {
  try {
    const res = await fetchDeskVersionCheck(appStore.version);
    if (res.code === 200 && res.data) {
      appStore.updateModalInfo = res.data;
    }
  } catch (error) {
    console.log(error);
  }
}

async function getClient() {
  try {
    let res;
    if (ipcRenderer) {
      res = await fetchDeskVersionByVersion(appStore.version);
    } else {
      res = await fetchDeskVersionLatest();
    }
    if (res.code === 200 && res.data) {
      appStore.deskVersionInfo = res.data;
    }
  } catch (error) {
    console.log(error);
  }
}
</script>
