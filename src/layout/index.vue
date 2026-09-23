<template>
  <div
    class="layout"
    :class="{ browser: !ipcRenderer }"
  >
    <div
      v-if="useCustomBar"
      class="system-bar"
      :class="{ 'no-drag': !appStore.isMac, drag: appStore.isMac }"
      @mousedown="startMove"
      @mouseup="endMove"
      @mousemove="moving"
      @mouseleave="handleMouseleave"
    >
      <div class="top-left">
        <div class="left">
          <div
            class="ico close"
            @click="handleClose"
          >
            <div class="corss"></div>
          </div>
          <div
            class="ico min"
            @click="handleMin"
          >
            <div class="heng"></div>
          </div>
          <div class="ico max"></div>
        </div>
        <div class="right">v{{ appStore.version }}</div>
      </div>
      <div class="top-right"></div>
    </div>
    <nav
      class="sidebar"
      aria-label="主导航"
    >
      <RouterLink
        class="brand"
        :to="{ name: routerName.remote }"
        aria-label="PalmDesk 首页"
      >
        <span class="brand-mark"
          ><PhonePortraitOutline aria-hidden="true"
        /></span>
        <span class="brand-name"
          >PalmDesk<span>AI-native remote control</span></span
        >
      </RouterLink>
      <div class="list">
        <span class="nav-label">工作空间</span>
        <RouterLink
          class="item"
          :class="{ active: route.name === routerName.remote }"
          :to="{ name: routerName.remote }"
        >
          <GridOutline aria-hidden="true" /><span>连接</span
          ><ChevronForwardOutline
            class="nav-arrow"
            aria-hidden="true"
          />
        </RouterLink>
        <RouterLink
          class="item"
          :class="{ active: route.name === routerName.deviceManage }"
          :to="{ name: routerName.deviceManage }"
        >
          <LaptopOutline aria-hidden="true" /><span>设备列表</span
          ><ChevronForwardOutline
            class="nav-arrow"
            aria-hidden="true"
          />
        </RouterLink>
        <RouterLink
          class="item"
          :class="{ active: route.name === routerName.setting }"
          :to="{ name: routerName.setting }"
        >
          <OptionsOutline aria-hidden="true" /><span>高级设置</span
          ><ChevronForwardOutline
            class="nav-arrow"
            aria-hidden="true"
          />
        </RouterLink>
      </div>
      <div class="sidebar-footer">
        <span
          class="footer-symbol"
          aria-hidden="true"
          >✳</span
        >
        <p>桌面工作，<br />掌心继续。</p>
        <div>
          <span>PalmDesk</span><span>v{{ appStore.version }}</span>
        </div>
      </div>
    </nav>
    <div class="view">
      <RouterView></RouterView>
    </div>
    <div
      class="debug-area"
      @click="handleOpenDebug"
    ></div>
    <div
      v-if="appStore.showDebug"
      class="debug-area-wrap"
    >
      <div
        class="item"
        @click="windowReload"
      >
        刷新
      </div>
      <div
        class="item"
        @click="handleOpenDevTools({ windowId: WINDOW_ID_ENUM.remote })"
      >
        控制台
      </div>
    </div>
    <UpdateModal
      v-if="
        appStore.updateModalInfo &&
        appStore.updateModalInfo?.checkUpdate === 1 &&
        appStore.updateModalInfo?.isUpdate === 1
      "
      @close="appStore.updateModalInfo.isUpdate = 2"
    ></UpdateModal>
    <DisableModal
      v-if="
        appStore.updateModalInfo &&
        appStore.updateModalInfo?.disableList.find(
          (v) => v.version === appStore.version
        )
      "
    ></DisableModal>
  </div>
</template>

<script lang="ts" setup>
import {
  ChevronForwardOutline,
  GridOutline,
  LaptopOutline,
  OptionsOutline,
  PhonePortraitOutline,
} from '@vicons/ionicons5';
import { getRandomString, windowReload } from 'billd-utils';
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';

import { WINDOW_ID_ENUM } from '@/constant';
import { IPC_EVENT } from '@/event';
import { useIpcRendererSend } from '@/hooks/use-ipcRendererSend';
import { IIpcRendererData } from '@/interface';
import { routerName } from '@/router';
import { useAppStore } from '@/store/app';
import {
  ipcRenderer,
  ipcRendererInvoke,
  ipcRendererOn,
  ipcRendererSend,
} from '@/utils';

const appStore = useAppStore();
const route = useRoute();

const { handleOpenDevTools } = useIpcRendererSend();

// 窗口当前的位置 + 鼠标当前的相对位置 - 鼠标以前的相对位置
const isMoving = ref<boolean>(false);
const lastPoint = reactive({ x: 0, y: 0 });
const useCustomBar = ref(true);
const clickNum = ref(1);

onMounted(() => {
  if (!ipcRenderer) {
    useCustomBar.value = false;
  }
  init();
});

async function init() {
  const res = await ipcRendererInvoke({
    windowId: WINDOW_ID_ENUM.remote,
    channel: IPC_EVENT.getPlatform,
    requestId: getRandomString(8),
    data: {},
  });
  if (res?.code === 0) {
    if (res?.data?.platform === 'darwin') {
      appStore.isMac = true;
    }
  }
}

ipcRendererOn(
  IPC_EVENT.response_open_about,
  (_event, data: IIpcRendererData) => {
    console.log('response_open_about', data);
    ipcRendererSend({
      windowId: 0,
      channel: IPC_EVENT.createWindow,
      requestId: getRandomString(8),
      data: {
        windowId: WINDOW_ID_ENUM.about,
        width: 550,
        height: 380,
        route: routerName.about,
        query: {},
        useWorkAreaSize: false,
        frame: true,
      },
    });
  }
);

ipcRendererOn(
  IPC_EVENT.response_open_version,
  (_event, data: IIpcRendererData) => {
    console.log('response_open_version', data);
    ipcRendererSend({
      windowId: 0,
      channel: IPC_EVENT.createWindow,
      requestId: getRandomString(8),
      data: {
        windowId: WINDOW_ID_ENUM.version,
        width: 300,
        height: 300,
        route: routerName.version,
        query: {},
        useWorkAreaSize: false,
        frame: true,
      },
    });
  }
);

function handleOpenDebug() {
  if (clickNum.value < 5) {
    clickNum.value += 1;
    setTimeout(() => {
      clickNum.value = 1;
    }, 3000);
  } else {
    appStore.showDebug = true;
  }
}

function handleClose() {
  ipcRendererSend({
    windowId: WINDOW_ID_ENUM.remote,
    channel: IPC_EVENT.closeAllWindow,
    requestId: getRandomString(8),
    data: {},
  });
}

function handleMin() {
  ipcRendererSend({
    windowId: WINDOW_ID_ENUM.remote,
    channel: IPC_EVENT.windowMinimize,
    requestId: getRandomString(8),
    data: {},
  });
}

const startMove = (e: MouseEvent) => {
  if (appStore.isMac) {
    return;
  }
  isMoving.value = true;
  lastPoint.x = e.clientX;
  lastPoint.y = e.clientY;
};

const endMove = () => {
  if (appStore.isMac) {
    return;
  }
  isMoving.value = false;
};

const handleMouseleave = () => {
  if (appStore.isMac) {
    return;
  }
  isMoving.value = false;
};

const moving = (e: MouseEvent) => {
  if (appStore.isMac) {
    return;
  }
  if (isMoving.value) {
    ipcRendererInvoke({
      windowId: WINDOW_ID_ENUM.remote,
      channel: IPC_EVENT.setWindowPosition,
      requestId: getRandomString(8),
      data: {
        x: e.screenX - lastPoint.x,
        y: e.screenY - lastPoint.y,
      },
    });
  }
};
</script>

<style lang="scss" scoped>
$sidebar-width: 224px;
.layout {
  display: flex;
  width: 100%;
  height: 100dvh;
  background: var(--pd-bg);
}
.system-bar {
  position: fixed;
  inset: 0 0 auto;
  z-index: 999;
  display: flex;
  height: $top-system-bar-height;
  background: var(--pd-bg);
  user-select: none;
  &.drag {
    -webkit-app-region: drag;
  }
  &.no-drag {
    -webkit-app-region: no-drag;
  }
  .top-left {
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-sizing: border-box;
    width: $sidebar-width;
    padding: 0 18px;
    background: var(--pd-sidebar);
    border-right: 1px solid var(--pd-border);
  }
  .left {
    display: flex;
    gap: 8px;
  }
  .ico {
    display: grid;
    place-items: center;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    cursor: pointer;
    -webkit-app-region: no-drag;
    .corss {
      width: 7px;
      height: 7px;
      @include cross(#71332d, 1px);
    }
    .heng {
      width: 7px;
      height: 1px;
      background: #79581e;
    }
    &.close {
      background: #f5786d;
    }
    &.min {
      background: #e9c369;
    }
    &.max {
      background: #d4dbd0;
      cursor: default;
    }
  }
  .right {
    color: var(--pd-muted);
    font-size: 10px;
  }
  .top-right {
    flex: 1;
  }
}
.sidebar {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  flex: 0 0 $sidebar-width;
  width: $sidebar-width;
  padding: 70px 18px 22px;
  background: var(--pd-sidebar);
  border-right: 1px solid var(--pd-border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px;
  text-decoration: none;
  color: var(--pd-text);
}
.brand-mark {
  display: grid;
  place-items: center;
  flex: 0 0 38px;
  width: 38px;
  height: 42px;
  border-radius: 12px;
  background: var(--pd-accent);
  color: #f1f5e9;
  box-shadow: 0 3px 8px #25634d18;
  svg {
    width: 24px;
    height: 24px;
  }
}
.brand-name {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.7px;
  line-height: 1.3;
  span {
    display: block;
    margin-top: 4px;
    color: var(--pd-muted);
    font-size: 9px;
    font-weight: 450;
    letter-spacing: 0;
  }
}
.list {
  margin-top: 44px;
}
.nav-label {
  display: block;
  margin: 0 14px 12px;
  color: var(--pd-muted);
  font-size: 10px;
  letter-spacing: 2px;
}
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  box-sizing: border-box;
  margin: 6px 0;
  padding: 10px 14px;
  border: 1px solid transparent;
  border-radius: 12px;
  color: var(--pd-muted);
  font-size: 13px;
  font-weight: 550;
  text-decoration: none;
  transition:
    background-color 160ms ease,
    color 160ms ease;
  svg {
    width: 19px;
    height: 19px;
    flex-shrink: 0;
  }
  .nav-arrow {
    width: 14px;
    height: 14px;
    margin-left: auto;
    opacity: 0;
  }
  &:hover {
    background: #e3e9df;
    color: var(--pd-text);
  }
  &.active {
    background: var(--pd-accent);
    color: white;
    box-shadow: 0 4px 10px #25634d12;
    .nav-arrow {
      opacity: 0.65;
    }
  }
}
.sidebar-footer {
  margin-top: auto;
  padding: 40px 12px 0;
  color: var(--pd-muted);
  .footer-symbol {
    font-size: 32px;
    color: #6f8861;
  }
  p {
    margin: 10px 0 28px;
    font-size: 12px;
    line-height: 1.9;
  }
  > div {
    display: flex;
    justify-content: space-between;
    padding-top: 14px;
    border-top: 1px solid var(--pd-border-strong);
    font-size: 10px;
  }
}
.view {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding-top: $top-system-bar-height;
}
.browser {
  .sidebar {
    padding-top: 32px;
  }
  .view {
    padding-top: 0;
  }
}
.debug-area {
  position: fixed;
  bottom: 0;
  left: 0;
  z-index: 300;
  width: 20px;
  height: 20px;
}
.debug-area-wrap {
  position: fixed;
  bottom: 24px;
  left: 10px;
  z-index: 300;
  display: flex;
  gap: 10px;
  color: var(--pd-danger);
  font-size: 13px;
  cursor: pointer;
}
@media (max-width: 900px) and (min-width: 701px) {
  .sidebar {
    flex-basis: 192px;
    width: 192px;
    padding-inline: 12px;
  }
  .system-bar .top-left {
    width: 192px;
  }
  .brand-name {
    font-size: 18px;
    span {
      font-size: 8px;
    }
  }
}
@media (max-width: 700px) {
  .layout {
    flex-direction: column;
    height: auto;
    min-height: 100dvh;
  }
  .sidebar,
  .browser .sidebar {
    flex: 0 0 auto;
    width: 100%;
    padding: max(18px, env(safe-area-inset-top)) 20px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--pd-border);
  }
  .layout:not(.browser) .sidebar {
    padding-top: 60px;
  }
  .brand {
    padding: 0;
    gap: 9px;
  }
  .brand-mark {
    flex-basis: 30px;
    width: 30px;
    height: 32px;
    border-radius: 9px;
    svg {
      width: 20px;
      height: 20px;
    }
  }
  .brand-name {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: 18px;
    span {
      font-size: 9px;
    }
  }
  .list {
    display: flex;
    gap: 6px;
    margin-top: 16px;
  }
  .nav-label,
  .nav-arrow,
  .sidebar-footer {
    display: none;
  }
  .item {
    flex: 1;
    justify-content: center;
    gap: 7px;
    min-height: 42px;
    margin: 0;
    padding: 8px;
    font-size: 12px;
    border-radius: 10px;
    svg {
      width: 17px;
      height: 17px;
    }
  }
  .item .nav-arrow {
    display: none;
  }
  .view {
    overflow: visible;
    padding-top: 0;
  }
}
</style>
