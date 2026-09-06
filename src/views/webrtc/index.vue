<template>
  <main class="controller-page">
    <header class="controller-header">
      <button
        type="button"
        title="断开并返回"
        aria-label="断开并返回"
        @click="disconnect"
      >
        <ArrowBackOutline />
      </button>
      <div class="heading">
        <h1>PalmDesk</h1>
        <span :title="selectedWindow?.name">{{
          selectedWindow?.name || remoteDeskUserUuid || '未连接电脑'
        }}</span>
      </div>
      <span
        class="status"
        :class="{ online: controlling, ready: connected && !controlling }"
        >{{
          controlling
            ? '已连接'
            : selectedWindow
              ? '正在加载'
              : connected
                ? '选择窗口'
                : error
                  ? '已断开'
                  : '正在连接'
        }}</span
      >
      <button
        v-if="selectedWindow"
        type="button"
        title="断开并重选窗口"
        aria-label="断开并重选窗口"
        @click="connect"
      >
        <BrowsersOutline />
      </button>
      <details class="connection-options">
        <summary
          aria-label="连接设置"
          title="连接设置"
        >
          <OptionsOutline />
        </summary>
        <div class="options-panel">
          <label
            >画质<select
              v-model.number="quality"
              @change="updateQuality"
            >
              <option :value="720">720p</option>
              <option :value="1080">1080p</option>
              <option :value="1440">1440p</option>
            </select></label
          >
          <label
            >帧率<select
              v-model.number="frameRate"
              @change="updateQuality"
            >
              <option :value="15">15 fps</option>
              <option :value="30">30 fps</option>
              <option :value="60">60 fps</option>
            </select></label
          >
          <span v-if="peer"
            >延迟 {{ Math.max(0, Math.round(peer.rtt)) }} ms</span
          >
        </div>
      </details>
    </header>
    <WindowPicker
      v-if="connected && !selectedWindow"
      :sources="windows"
      :loading="windowsLoading"
      :disabled="windowStarting"
      :error="windowError"
      @refresh="requestWindows"
      @select="selectWindow"
    />
    <RemoteViewport
      v-if="selectedWindow"
      :video="peer?.videoEl"
      :connected="controlling"
      @behavior="sendBehavior"
    />
    <div
      v-if="!connected"
      class="connection-message"
      role="status"
    >
      <span>{{ error || '正在连接电脑窗口…' }}</span>
      <button
        v-if="error && hasCredentials"
        type="button"
        @click="connect"
      >
        重新连接
      </button>
      <button
        v-if="error"
        type="button"
        @click="disconnect"
      >
        返回
      </button>
    </div>
  </main>
</template>

<script setup lang="ts">
import {
  ArrowBackOutline,
  BrowsersOutline,
  OptionsOutline,
} from '@vicons/ionicons5';
import { getRandomString } from 'billd-utils';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import RemoteViewport from '@/components/RemoteViewport/index.vue';
import WindowPicker from '@/components/WindowPicker/index.vue';
import { WINDOW_ID_ENUM } from '@/constant';
import { IPC_EVENT } from '@/event';
import { useWebsocket } from '@/hooks/use-websocket';
import type { IRemoteWindow } from '@/pure-interface';
import router, { routerName } from '@/router';
import { useAppStore } from '@/store/app';
import { useNetworkStore } from '@/store/network';
import type {
  WsBilldDeskBehaviorType,
  WsBilldDeskStartRemoteResult,
} from '@/types/websocket';
import {
  BilldDeskBehaviorEnum as Behavior,
  WsConnectStatusEnum,
  WsMsgTypeEnum,
} from '@/types/websocket';
import { ipcRenderer, ipcRendererSend } from '@/utils';

const route = useRoute();
const networkStore = useNetworkStore();
const appStore = useAppStore();
const {
  initWs,
  deskUserUuid,
  deskUserPassword,
  remoteDeskUserUuid,
  remoteDeskUserPassword,
  connectStatus,
} = useWebsocket();
const roomId = ref('');
const receiverId = ref('');
const quality = ref(1080);
const frameRate = ref(30);
const error = ref('');
const hasCredentials = ref(false);
const windows = ref<IRemoteWindow[]>([]);
const windowsLoading = ref(false);
const windowStarting = ref(false);
const windowError = ref('');
const selectedWindow = ref<{ id: string; name: string }>();
const videoReady = ref(false);
let listRequest = '';
let selectRequest = '';
let requestTimer: ReturnType<typeof setTimeout>;
let timeout: ReturnType<typeof setTimeout>;
let heartbeat: ReturnType<typeof setInterval>;
let hadPeer = false;
let leaving = false;
const peer = computed(() => networkStore.rtcMap.get(receiverId.value));
const mySocketId = computed(
  () => networkStore.wsMap.get(roomId.value)?.socketIo?.id || ''
);
const connected = computed(
  () =>
    peer.value?.peerConnection?.connectionState === 'connected' &&
    peer.value?.dataChannel?.readyState === 'open'
);
const controlling = computed(
  () => connected.value && !!selectedWindow.value && videoReady.value
);

function requestWindows() {
  if (!connected.value || windowStarting.value) return;
  clearTimeout(requestTimer);
  listRequest = getRandomString(16);
  windows.value = [];
  windowsLoading.value = true;
  windowError.value = '';
  peer.value?.dataChannelSend({
    msgType: WsMsgTypeEnum.remoteWindowsRequest,
    requestId: listRequest,
    data: {},
  });
  requestTimer = setTimeout(() => {
    listRequest = '';
    windowsLoading.value = false;
    windowError.value = '读取窗口列表超时，请刷新重试';
  }, 15000);
}
function selectWindow(source: IRemoteWindow) {
  if (!connected.value || windowsLoading.value || windowStarting.value) return;
  clearTimeout(requestTimer);
  selectRequest = getRandomString(16);
  windowStarting.value = true;
  windowError.value = '';
  peer.value?.dataChannelSend({
    msgType: WsMsgTypeEnum.remoteWindowSelect,
    requestId: selectRequest,
    data: { id: source.id },
  });
  requestTimer = setTimeout(() => {
    endConnection('打开窗口超时，请重新连接');
  }, 20000);
}
function receiveWindowMessage(event: MessageEvent) {
  if (typeof event.data !== 'string' || event.data.length > 65536) return;
  let message: any;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if (!message?.data || typeof message.data !== 'object') return;
  const { data } = message;
  if (
    message.msgType === WsMsgTypeEnum.remoteWindowsResult &&
    listRequest &&
    message.requestId === listRequest
  ) {
    const source = data.source;
    if (
      source &&
      ['id', 'name', 'appName', 'thumbnail', 'appIcon'].every(
        (key) => typeof source[key] === 'string'
      )
    )
      windows.value.push(source);
    if (data.done) {
      clearTimeout(requestTimer);
      listRequest = '';
      windowsLoading.value = false;
      windowError.value = typeof data.error === 'string' ? data.error : '';
    }
  } else if (
    message.msgType === WsMsgTypeEnum.remoteWindowSelected &&
    selectRequest &&
    message.requestId === selectRequest
  ) {
    clearTimeout(requestTimer);
    selectRequest = '';
    windowStarting.value = false;
    if (typeof data.error === 'string') windowError.value = data.error;
    else if (typeof data.id === 'string' && typeof data.name === 'string') {
      selectedWindow.value = { id: data.id, name: data.name };
      requestTimer = setTimeout(() => {
        if (!controlling.value) endConnection('窗口视频加载超时，请重新连接');
      }, 20000);
    }
  }
}

watch(
  () => peer.value?.cbDataChannel,
  (channel, previous) => {
    previous?.removeEventListener('message', receiveWindowMessage);
    channel?.addEventListener('message', receiveWindowMessage);
  }
);
watch(
  () => peer.value?.videoEl,
  (video, previous) => {
    previous?.removeEventListener('loadeddata', markVideoReady);
    videoReady.value = !!video && video.readyState >= 2;
    video?.addEventListener('loadeddata', markVideoReady);
  }
);
function markVideoReady() {
  videoReady.value = true;
}
watch(controlling, (value) => {
  if (value) clearTimeout(requestTimer);
});
watch([connected, () => peer.value?.cbDataChannel], ([ready, channel]) => {
  if (
    ready &&
    channel &&
    !listRequest &&
    !selectedWindow.value &&
    !windowStarting.value &&
    !windows.value.length
  )
    requestWindows();
});

function endConnection(message: string) {
  clearTimeout(timeout);
  clearTimeout(requestTimer);
  releaseInput();
  hadPeer = false;
  networkStore.removeAllWsAndRtc();
  appStore.remoteDesk.clear();
  selectedWindow.value = undefined;
  error.value = message;
}

function connectionData() {
  return {
    roomId: roomId.value,
    sender: mySocketId.value,
    receiver: receiverId.value,
    deskUserUuid: deskUserUuid.value,
    deskUserPassword: deskUserPassword.value,
    remoteDeskUserUuid: remoteDeskUserUuid.value,
    remoteDeskUserPassword: remoteDeskUserPassword.value,
    maxBitrate: 2500,
    maxFramerate: frameRate.value,
    resolutionRatio: quality.value,
    videoContentHint: 'detail',
    audioContentHint: '',
  };
}
function onConnectionResult(result: WsBilldDeskStartRemoteResult['data']) {
  if (result.code !== 0) {
    error.value = result.msg || '连接被拒绝';
    clearTimeout(timeout);
    return;
  }
  if (!result.data) return;
  receiverId.value = result.data.receiver;
  appStore.remoteDesk.set(result.data.receiver, {
    ...result.data,
    sender: result.data.sender,
    isClose: false,
  });
}
function requestConnection() {
  const ws = networkStore.wsMap.get(roomId.value);
  ws?.socketIo?.off(
    WsMsgTypeEnum.billdDeskStartRemoteResult,
    onConnectionResult
  );
  ws?.socketIo?.on(
    WsMsgTypeEnum.billdDeskStartRemoteResult,
    onConnectionResult
  );
  ws?.send({
    requestId: getRandomString(8),
    msgType: WsMsgTypeEnum.billdDeskStartRemote,
    data: connectionData(),
  });
}
function connect() {
  if (!hasCredentials.value) return;
  clearTimeout(timeout);
  clearTimeout(requestTimer);
  releaseInput();
  networkStore.removeAllWsAndRtc();
  appStore.remoteDesk.clear();
  hadPeer = false;
  error.value = '';
  receiverId.value = '';
  selectedWindow.value = undefined;
  windows.value = [];
  windowsLoading.value = false;
  windowStarting.value = false;
  windowError.value = '';
  listRequest = '';
  selectRequest = '';
  videoReady.value = false;
  initWs({ roomId: roomId.value, isAnchor: false, isRemoteDesk: true });
  timeout = setTimeout(() => {
    if (!connected.value)
      error.value = '连接超时，请检查电脑窗口、服务地址和网络';
  }, 20000);
}
function sendBehavior(data: Partial<WsBilldDeskBehaviorType['data']>) {
  if (!controlling.value && data.type !== Behavior.releaseAll) return;
  peer.value?.dataChannelSend<WsBilldDeskBehaviorType['data']>({
    requestId: getRandomString(8),
    msgType: WsMsgTypeEnum.billdDeskBehavior,
    data: {
      roomId: roomId.value,
      sender: mySocketId.value,
      receiver: receiverId.value,
      x: 500,
      y: 500,
      amount: 0,
      key: [],
      ...data,
    } as WsBilldDeskBehaviorType['data'],
  });
}
function releaseInput() {
  sendBehavior({ type: Behavior.releaseAll });
}
function updateQuality() {
  (
    [
      [WsMsgTypeEnum.changeResolutionRatio, quality.value],
      [WsMsgTypeEnum.changeMaxFramerate, frameRate.value],
    ] as const
  ).forEach(([msgType, val]) => {
    peer.value?.dataChannelSend({
      requestId: getRandomString(8),
      msgType,
      data: { val },
    });
  });
}
function disconnect() {
  leaving = true;
  clearTimeout(requestTimer);
  releaseInput();
  networkStore.removeAllWsAndRtc();
  appStore.remoteDesk.clear();
  sessionStorage.removeItem('codex-remote-session');
  if (ipcRenderer)
    ipcRendererSend({
      windowId: WINDOW_ID_ENUM.webrtc,
      channel: IPC_EVENT.closeWindow,
      requestId: getRandomString(8),
      data: {},
    });
  else void router.replace({ name: routerName.remote });
}
watch(connectStatus, (status) => {
  if (status === WsConnectStatusEnum.connect && !leaving) requestConnection();
});
watch(connected, (value) => {
  if (value) {
    clearTimeout(timeout);
    error.value = '';
    hadPeer = true;
  }
});
watch(
  () => networkStore.rtcMap.size,
  (size) => {
    if (!size && hadPeer && !leaving)
      error.value = '连接已结束，目标窗口可能已关闭或不可用';
  }
);
onMounted(() => {
  let saved: Record<string, any> = {};
  try {
    saved = JSON.parse(sessionStorage.getItem('codex-remote-session') || '{}');
  } catch {
    /* A stale tab starts at the connection form. */
  }
  const params = { ...saved, ...route.query };
  deskUserUuid.value = String(params.deskUserUuid || '');
  deskUserPassword.value = String(params.deskUserPassword || '');
  remoteDeskUserUuid.value = String(params.remoteDeskUserUuid || '');
  remoteDeskUserPassword.value = String(params.remoteDeskUserPassword || '');
  roomId.value = remoteDeskUserUuid.value;
  hasCredentials.value = Boolean(
    deskUserUuid.value &&
      deskUserPassword.value &&
      remoteDeskUserUuid.value &&
      remoteDeskUserPassword.value
  );
  if (!hasCredentials.value) {
    error.value = '连接信息已失效，请返回重新连接';
    return;
  }
  sessionStorage.setItem(
    'codex-remote-session',
    JSON.stringify({
      deskUserUuid: deskUserUuid.value,
      deskUserPassword: deskUserPassword.value,
      remoteDeskUserUuid: remoteDeskUserUuid.value,
      remoteDeskUserPassword: remoteDeskUserPassword.value,
    })
  );
  if (Object.keys(route.query).length)
    void router.replace({ name: routerName.webrtc });
  connect();
  heartbeat = setInterval(() => {
    networkStore.wsMap.get(roomId.value)?.send({
      requestId: getRandomString(8),
      msgType: WsMsgTypeEnum.billdDeskUpdateUser,
      data: connectionData(),
    });
  }, 2000);
});
onUnmounted(() => {
  leaving = true;
  clearTimeout(timeout);
  clearTimeout(requestTimer);
  clearInterval(heartbeat);
  releaseInput();
  networkStore.removeAllWsAndRtc();
  appStore.remoteDesk.clear();
});
</script>

<style scoped lang="scss">
.controller-page {
  position: relative;
  display: flex;
  height: 100dvh;
  min-height: 280px;
  flex-direction: column;
  color: #263b32;
  background: #f2f4f3;
}
.controller-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
  padding: max(8px, env(safe-area-inset-top)) 12px 8px;
  border-bottom: 1px solid #d7ddda;
  background: #fff;
}
.controller-header > button {
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  padding: 8px;
  border: 0;
  background: transparent;
  color: #304b41;
  cursor: pointer;
}
.controller-header svg {
  width: 22px;
  height: 22px;
}
.heading {
  min-width: 0;
}
.heading h1 {
  margin: 0;
  font-size: 17px;
  line-height: 1.3;
}
.heading span {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  color: #6b7871;
}
.status {
  margin-left: auto;
  font-size: 12px;
  color: #a13e3e;
  white-space: nowrap;
}
.status.online {
  color: #167c65;
}
.status.ready {
  color: #66736c;
}
.connection-options {
  position: relative;
}
.connection-options summary {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  cursor: pointer;
  list-style: none;
}
.connection-options summary::-webkit-details-marker {
  display: none;
}
.options-panel {
  position: absolute;
  right: 0;
  top: 46px;
  z-index: 5;
  width: 220px;
  max-width: calc(100vw - 32px);
  padding: 16px;
  box-sizing: border-box;
  border: 1px solid #cbd6cf;
  border-radius: 4px;
  background: white;
  box-shadow: 0 6px 18px #0002;
}
.options-panel label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 14px;
}
.options-panel select {
  min-width: 100px;
  height: 36px;
  font-size: 14px;
}
.options-panel > span {
  font-size: 12px;
  color: #64776b;
}
.connection-message {
  position: absolute;
  top: 43%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 16px;
  width: max-content;
  max-width: calc(100% - 40px);
  box-sizing: border-box;
  border: 1px solid #cbd6cf;
  border-radius: 4px;
  background: #fff;
  font-size: 14px;
}
.connection-message > span {
  flex-basis: 100%;
  text-align: center;
  line-height: 1.6;
}
.connection-message button {
  padding: 8px 12px;
  border: 1px solid #167c65;
  border-radius: 4px;
  color: #167c65;
  background: white;
  cursor: pointer;
}
</style>
