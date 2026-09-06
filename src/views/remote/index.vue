<template>
  <div
    class="remote-wrap"
    :class="{ 'browser-controller': !ipcRenderer }"
  >
    <div class="container">
      <header class="page-heading">
        <h1>Codex Remote</h1>
        <span class="connection-state">{{
          connectStatus === WsConnectStatusEnum.connect
            ? '服务已连接'
            : '正在连接服务'
        }}</span>
      </header>
      <div
        v-if="ipcRenderer"
        class="local-device"
      >
        <div class="label">此设备</div>
        <div class="info">
          <div class="info-left">
            <div class="txt">设备代码</div>
            <div class="code-info">
              <div class="code">{{ cacheStore.deskUserUuid }}</div>
              <button
                class="ico copy"
                type="button"
                title="复制设备代码"
                aria-label="复制设备代码"
                @click="handleCopy(cacheStore.deskUserUuid)"
              ></button>
              <div
                class="ico refresh"
                @click="handleResetDeskuuid"
              ></div>
            </div>
          </div>
          <div class="info-right">
            <div class="txt">临时密码</div>
            <div class="code-info">
              <div class="code">
                {{
                  cacheStore.hidePwd ? '********' : cacheStore.deskUserPassword
                }}
              </div>
              <button
                class="ico copy"
                type="button"
                title="复制临时密码"
                aria-label="复制临时密码"
                @click="handleCopy(cacheStore.deskUserPassword)"
              ></button>
              <div
                class="ico eye"
                :class="{ hide: cacheStore.hidePwd }"
                @click="cacheStore.hidePwd = !cacheStore.hidePwd"
              ></div>
              <div
                class="ico edit"
                @click="handleUpdatePassword"
              ></div>
            </div>
          </div>
        </div>
      </div>
      <div class="remote-device">
        <div class="label">连接电脑</div>
        <div class="info">
          <div
            v-on-click-outside="handleClickOutside"
            class="ipt-wrap"
          >
            <div
              :ref="arrowDownRef"
              class="ipt-top"
            >
              <input
                v-model="cacheStore.remoteDeskUserUuid"
                type="text"
                class="ipt"
                :placeholder="'请输入远程设备代码'"
                maxlength="8"
                aria-label="远程设备代码"
                inputmode="text"
                autocapitalize="none"
                :spellcheck="false"
                autocomplete="off"
                @keydown.enter="startRemote"
              />
              <div
                class="arrow-down"
                :class="{ active: showLinkDeviceList }"
                @click="showLinkDeviceList = !showLinkDeviceList"
              ></div>
            </div>
            <div class="ipt-bottom">
              <div
                v-if="showLinkDeviceList"
                ref="linkDeviceListRef"
                class="link-device-list"
              >
                <div
                  v-for="(item, index) in cacheStore.linkDeviceList"
                  :key="index"
                  class="link-device-item"
                  @click="changeRemoteDeskUserUuid(item)"
                >
                  <div class="left">{{ item.remoteDeskUserUuid }}</div>
                  <div class="right">
                    <div
                      class="del"
                      @click="handleDelLinkDeviceList(item)"
                    ></div>
                  </div>
                </div>
                <div
                  v-if="!cacheStore.linkDeviceList.length"
                  class="null"
                >
                  暂无记录
                </div>
              </div>
            </div>
          </div>
          <button
            class="btn"
            type="button"
            :class="{ gray: !cacheStore.remoteDeskUserUuid.length, loading }"
            :disabled="
              loading ||
              !cacheStore.deskUserUuid ||
              !cacheStore.remoteDeskUserUuid.length
            "
            @click="startRemote"
          >
            <div v-if="!loading">连接</div>
            <div
              v-else
              class="loading"
            ></div>
          </button>
        </div>
      </div>

      <div
        v-if="ipcRenderer"
        class="codex-target"
      >
        <div class="target-heading">
          <div>
            <div class="label">Codex 控制窗口</div>
          </div>
          <button
            class="refresh-target"
            type="button"
            :disabled="captureLoading || appStore.remoteDesk.size > 0"
            @click="refreshCaptureSources"
          >
            <span
              class="refresh-icon"
              aria-hidden="true"
            ></span>
            {{ captureLoading ? '刷新中' : '刷新窗口' }}
          </button>
        </div>

        <div
          v-if="captureSources.length"
          class="capture-source-list"
        >
          <button
            v-for="source in captureSources"
            :key="source.id"
            class="capture-source"
            :class="{ selected: source.id === selectedCaptureSourceId }"
            type="button"
            :disabled="appStore.remoteDesk.size > 0"
            @click="selectCaptureSource(source)"
          >
            <img
              v-if="source.thumbnail"
              class="capture-thumbnail"
              :src="source.thumbnail"
              :alt="source.name"
            />
            <span class="capture-source-name">{{ source.name }}</span>
            <span class="capture-source-meta">
              {{
                source.boundsSource === 'window'
                  ? '窗口边界已读取'
                  : '窗口边界不可用'
              }}
            </span>
          </button>
        </div>
        <div
          v-else
          class="capture-empty"
        >
          {{
            permissions.targetApps.length
              ? '目标窗口不在当前桌面或已最小化'
              : '未检测到 Codex/ChatGPT Desktop 窗口'
          }}
          <button
            v-if="permissions.targetApps.length"
            class="reveal-target"
            type="button"
            @click="showTargetApplication"
          >
            显示应用窗口
          </button>
        </div>
        <div
          v-if="captureError"
          class="capture-error"
        >
          {{ captureError }}
        </div>
        <div
          v-else-if="selectedCaptureSource"
          class="capture-selected"
        >
          已选择：{{ selectedCaptureSource.name }}
          <span v-if="captureWarning">（{{ captureWarning }}）</span>
        </div>
      </div>

      <div
        v-if="ipcRenderer"
        class="permissions"
      >
        <div>
          <span>屏幕录制</span
          ><span>{{
            permissions.screen === 'granted' ? '已授权' : '未授权'
          }}</span
          ><button
            v-if="permissions.screen !== 'granted'"
            type="button"
            @click="openPermission('screen')"
          >
            打开设置
          </button>
        </div>
        <div>
          <span>辅助功能</span
          ><span>{{ permissions.accessibility ? '已授权' : '未授权' }}</span
          ><button
            v-if="!permissions.accessibility"
            type="button"
            @click="openPermission('accessibility')"
          >
            打开设置
          </button>
        </div>
      </div>

      <template v-if="!appStore.remoteDesk.size">
        <div
          v-if="ipcRenderer"
          class="tip"
        >
          {{ selectedCaptureSource ? '等待手机连接' : '尚未选择窗口' }}
        </div>
        <details class="quality-settings">
          <summary>连接画质</summary>
          <div class="link-config">
            <div class="link-item">
              <n-space>
                <div class="link-label">码率：</div>
                <n-radio-group v-model:value="currentMaxBitrate">
                  <n-radio
                    v-for="item in maxBitrate"
                    :key="item.value"
                    :value="item.value"
                  >
                    {{ item.label }}
                  </n-radio>
                </n-radio-group>
              </n-space>
            </div>
            <div class="link-item">
              <n-space>
                <div class="link-label">帧率：</div>
                <n-radio-group v-model:value="currentMaxFramerate">
                  <n-radio
                    v-for="item in maxFramerate"
                    :key="item.value"
                    :value="item.value"
                  >
                    {{ item.label }}
                  </n-radio>
                </n-radio-group>
              </n-space>
            </div>
            <div class="link-item">
              <n-space>
                <div class="link-label">分辨率：</div>
                <n-radio-group v-model:value="currentResolutionRatio">
                  <n-radio
                    v-for="item in resolutionRatio"
                    :key="item.value"
                    :value="item.value"
                  >
                    {{ item.label }}
                  </n-radio>
                </n-radio-group>
              </n-space>
            </div>
            <div class="link-item">
              <n-space>
                <div class="link-label">视频内容：</div>
                <n-radio-group v-model:value="currentVideoContentHint">
                  <n-radio
                    v-for="item in videoContentHint"
                    :key="item.value"
                    :value="item.value"
                  >
                    {{ item.label }}
                  </n-radio>
                </n-radio-group>
              </n-space>
            </div>
            <div class="link-item">
              <n-space>
                <div class="link-label">音频内容：</div>
                <n-radio-group v-model:value="currentAudioContentHint">
                  <n-radio
                    v-for="item in audioContentHint"
                    :key="item.value"
                    :value="item.value"
                  >
                    {{ item.label }}
                  </n-radio>
                </n-radio-group>
              </n-space>
            </div>
          </div>
        </details>
      </template>

      <div
        v-else
        class="list"
      >
        <div
          v-for="(item, key) in appStore.remoteDesk"
          :key="key"
          class="item"
        >
          <span>正在被{{ item[1].deskUserUuid }}控制</span>
          <span
            class="del"
            @click="handleDel(item[1].sender)"
          >
            断开
          </span>
        </div>
      </div>
    </div>

    <div
      v-if="appStore.showDebug"
      class="debug-info"
    >
      <div>
        <span>窗口Id：</span>
        <span
          class="link"
          @click="handleCopy(WINDOW_ID_ENUM.remote)"
        >
          {{ WINDOW_ID_ENUM.remote }}
        </span>
        <span>，</span>
        <span>roomId：</span>
        <span
          class="link"
          @click="handleCopy(roomId)"
        >
          {{ roomId }}
        </span>
      </div>
      <div>
        <span>socketId：</span>
        <span
          class="link"
          @click="handleCopy(mySocketId)"
        >
          {{ mySocketId }}
        </span>
      </div>

      <div>
        <span>调试地址：</span>
        <input
          v-model="debugUrl"
          type="text"
        />
        <button @click="changeDebugUrl">确定</button>
      </div>
    </div>

    <PwdModalCpt
      v-if="showPwdModalCpt"
      :uuid="cacheStore.remoteDeskUserUuid"
      :pwd="pwd"
      :err-msg="errMsg"
      @close="handleClose"
      @confirm="handleConfirm"
    ></PwdModalCpt>
  </div>
</template>

<script lang="ts" setup>
import { vOnClickOutside } from '@vueuse/components';
import { copyToClipBoard, getRandomString, windowReload } from 'billd-utils';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import {
  fetchDeskUserCreate,
  fetchDeskUserLinkVerify,
  fetchDeskUserLogin,
  fetchDeskUserUpdateByUuid,
  fetchFindReceiverByUuid,
} from '@/api/deskUser';
import { WINDOW_ID_ENUM } from '@/constant';
import { IPC_EVENT } from '@/event';
import { useIpcRendererSend } from '@/hooks/use-ipcRendererSend';
import { useRTCParams } from '@/hooks/use-rtcParams';
import { useTip } from '@/hooks/use-tip';
import { useWebsocket } from '@/hooks/use-websocket';
import { useWebRtcRemoteDesk } from '@/hooks/webrtc/remoteDesk';
import { IIpcRendererData } from '@/interface';
import type { ICaptureSource } from '@/pure-interface';
import router, { routerName } from '@/router';
import { useAppStore } from '@/store/app';
import { usePiniaCacheStore } from '@/store/cache';
import { useNetworkStore } from '@/store/network';
import {
  WsBilldDeskBehaviorType,
  WsBilldDeskStartRemote,
  WsBilldDeskStartRemoteResult,
  WsChangeAudioContentHintType,
  WsChangeMaxBitrateType,
  WsChangeMaxFramerateType,
  WsChangeResolutionRatioType,
  WsChangeVideoContentHintType,
  WsConnectStatusEnum,
  WsMsgTypeEnum,
} from '@/types/websocket';
import {
  createNullVideo,
  handlConstraints,
  ipcRenderer,
  ipcRendererInvoke,
  ipcRendererOn,
  ipcRendererSend,
  setAudioTrackContentHints,
  setVideoTrackContentHints,
} from '@/utils';
import { CaptureLifecycle } from '@/utils/capture-lifecycle';
import { WebRTCClass } from '@/utils/network/webRTC';
import PwdModalCpt from '@/views/remote/pwdModal.vue';

const route = useRoute();
const appStore = useAppStore();
const networkStore = useNetworkStore();
const cacheStore = usePiniaCacheStore();

const { updateWebRtcRemoteDeskConfig, webRtcRemoteDesk } =
  useWebRtcRemoteDesk();
const { initWs, connectStatus, deskUserUuid, deskUserPassword } =
  useWebsocket();
const {
  maxBitrate,
  maxFramerate,
  resolutionRatio,
  audioContentHint,
  videoContentHint,
} = useRTCParams();
const { handleRtcBilldDeskBehavior } = useIpcRendererSend();

const currentMaxBitrate = ref(maxBitrate.value[3].value);
const currentMaxFramerate = ref(30);
const currentResolutionRatio = ref(resolutionRatio.value[3].value);
const currentVideoContentHint = ref(videoContentHint.value[3].value);
const currentAudioContentHint = ref(audioContentHint.value[0].value);
const rtc = ref<WebRTCClass>();
const roomId = ref('');
const receiverId = ref('');
const anchorStream = ref<MediaStream>();
/** 是否控制别人 */
const isControlOther = ref(false);
const loading = ref(false);
const showPwdModalCpt = ref(false);
const showLinkDeviceList = ref(false);
const arrowDownRef = ref();
const linkDeviceListRef = ref();
const pwd = ref('');
const errMsg = ref('');
const captureSessionId = ref('');
const captureLifecycle = new CaptureLifecycle();
let captureGeneration = 0;
const permissions = ref({
  screen: 'unknown',
  accessibility: false,
  targetApps: [] as string[],
});
const captureSources = ref<ICaptureSource[]>([]);
const selectedCaptureSourceId = ref('');
const captureLoading = ref(false);
const captureError = ref('');
const captureWarning = ref('');
const captureRefreshTimer = ref<ReturnType<typeof setInterval>>();
const originalPassword = ref('');
const loopBilldDeskUpdateUserTimer = ref();
const suspend = ref('');
const resume = ref('');
const debugUrl = ref('');
const position = ref({ x: 0, y: 0 });
const mySocketId = computed(() => {
  return networkStore.wsMap.get(roomId.value)?.socketIo?.id || '';
});
const selectedCaptureSource = computed(() => {
  return captureSources.value.find(
    (source) => source.id === selectedCaptureSourceId.value
  );
});

onUnmounted(() => {
  clearInterval(loopBilldDeskUpdateUserTimer.value);
  clearInterval(captureRefreshTimer.value);
  stopCaptureStream();
});

onMounted(() => {
  console.log('home页面');
  console.log('route.query', route.query);
  handleInit();
});

const handleClickOutside: any = [
  () => {
    if (showLinkDeviceList.value) {
      showLinkDeviceList.value = false;
    }
  },
  { ignore: [arrowDownRef] },
];

watch(
  () => networkStore.rtcMap,
  (newval) => {
    newval.forEach((item) => {
      if (!item.cbDataChannel) return;
      // const setting = anchorStream.value?.getVideoTracks()[0].getSettings();
      item.cbDataChannel.onmessage = async (event) => {
        if (
          !appStore.remoteDesk.has(item.receiver) ||
          networkStore.rtcMap.get(item.receiver)?.cbDataChannel !==
            item.cbDataChannel
        )
          return;
        if (typeof event.data !== 'string' || event.data.length > 32768) return;
        const jsondata: {
          msgType: WsMsgTypeEnum;
          requestId: string;
          data: any;
        } = (() => {
          try {
            return JSON.parse(event.data);
          } catch {
            return null;
          }
        })();
        if (!jsondata || !jsondata.data || typeof jsondata.data !== 'object')
          return;
        const { msgType } = jsondata;
        if (msgType === WsMsgTypeEnum.changeMaxBitrate) {
          const { data }: { data: WsChangeMaxBitrateType['data'] } = jsondata;
          currentMaxBitrate.value = data.val;
          rtc.value?.setMaxBitrate(data.val);
        } else if (msgType === WsMsgTypeEnum.changeMaxFramerate) {
          const { data }: { data: WsChangeMaxFramerateType['data'] } = jsondata;
          if (anchorStream.value) {
            currentMaxFramerate.value = data.val;
            handlConstraints({
              frameRate: data.val,
              height: currentResolutionRatio.value,
              stream: anchorStream.value,
            });
          }
        } else if (msgType === WsMsgTypeEnum.changeResolutionRatio) {
          const { data }: { data: WsChangeResolutionRatioType['data'] } =
            jsondata;
          if (anchorStream.value) {
            currentResolutionRatio.value = data.val;
            handlConstraints({
              frameRate: currentMaxFramerate.value,
              height: data.val,
              stream: anchorStream.value,
            });
          }
        } else if (msgType === WsMsgTypeEnum.changeVideoContentHint) {
          const { data }: { data: WsChangeVideoContentHintType['data'] } =
            jsondata;
          if (anchorStream.value) {
            currentVideoContentHint.value = data.val;
            // @ts-ignore
            setVideoTrackContentHints(anchorStream.value, data.val);
          }
        } else if (msgType === WsMsgTypeEnum.changeAudioContentHint) {
          const { data }: { data: WsChangeAudioContentHintType['data'] } =
            jsondata;
          if (anchorStream.value) {
            currentAudioContentHint.value = data.val;
            // @ts-ignore
            setAudioTrackContentHints(anchorStream.value, data.val);
          }
        } else if (msgType === WsMsgTypeEnum.billdDeskBehavior) {
          const { data }: { data: WsBilldDeskBehaviorType['data'] } = jsondata;
          if (anchorStream.value && captureSessionId.value) {
            const sessionId = captureSessionId.value;
            const result = await handleRtcBilldDeskBehavior(
              WINDOW_ID_ENUM.remote,
              data,
              sessionId
            );
            if (
              captureSessionId.value === sessionId &&
              result?.code !== 0 &&
              result?.msg
            ) {
              captureError.value = result.msg;
              handleCloseAll();
            }
          }
        }
      };
    });
  },
  {
    immediate: true,
    deep: true,
  }
);

watch(
  () => anchorStream.value,
  (newval) => {
    if (newval) {
      appStore.remoteDesk.forEach((item) => {
        if (!item.isClose) {
          handleRTC(item.sender);
        }
      });
    }
  }
);

watch(
  () => appStore.remoteDesk.size,
  async (newval) => {
    if (newval) {
      startCaptureBoundsRefresh();
      if (!anchorStream.value) {
        if (!selectedCaptureSourceId.value) {
          await refreshCaptureSources();
        }
        if (!appStore.remoteDesk.size) return;
        if (selectedCaptureSourceId.value) {
          await beginSelectedCapture();
        } else {
          captureError.value = '没有可用的 Codex 窗口，远程连接未启动';
          handleCloseAll();
        }
      }
    } else {
      clearInterval(captureRefreshTimer.value);
      handleCloseAll();
    }
  },
  {
    immediate: true,
  }
);

watch(
  () => appStore.remoteDesk,
  (newval) => {
    newval.forEach((item) => {
      if (item.isClose) {
        // window.$notification.warning({
        //   content: `${item.sender}远程连接断开`,
        //   duration: 2000,
        // });
        appStore.remoteDesk.delete(item.sender);
        return;
      }
      currentMaxBitrate.value = item.maxBitrate;
      currentMaxFramerate.value = item.maxFramerate;
      currentResolutionRatio.value = item.resolutionRatio;
      currentVideoContentHint.value = item.videoContentHint;
      currentAudioContentHint.value = item.audioContentHint;
    });
  },
  {
    deep: true,
  }
);

function handleLoopBilldDeskUpdateUserTimer() {
  clearInterval(loopBilldDeskUpdateUserTimer.value);
  loopBilldDeskUpdateUserTimer.value = setInterval(() => {
    networkStore.wsMap.get(roomId.value)?.send<WsBilldDeskStartRemote['data']>({
      requestId: getRandomString(8),
      msgType: WsMsgTypeEnum.billdDeskUpdateUser,
      data: {
        roomId: roomId.value,
        sender: mySocketId.value,
        receiver: receiverId.value,
        maxBitrate: currentMaxBitrate.value,
        maxFramerate: currentMaxFramerate.value,
        resolutionRatio: currentResolutionRatio.value,
        videoContentHint: currentVideoContentHint.value,
        audioContentHint: currentAudioContentHint.value,
        deskUserUuid: cacheStore.deskUserUuid,
        deskUserPassword: cacheStore.deskUserPassword,
        remoteDeskUserUuid: cacheStore.remoteDeskUserUuid,
        remoteDeskUserPassword: cacheStore.remoteDeskUserPassword,
      },
    });
  }, 1000 * 2);
}

async function handleInit() {
  handleInitIpcRendererOn();
  await handleInitIpcRendererSend();
  await refreshCaptureSources();
  await initDeskUser();
  deskUserUuid.value = cacheStore.deskUserUuid;
  deskUserPassword.value = cacheStore.deskUserPassword;
  handleLoopBilldDeskUpdateUserTimer();
  initWs({
    roomId: roomId.value,
    isAnchor: false,
    isRemoteDesk: true,
  });
}

async function handleInitIpcRendererSend() {
  ipcRendererSend({
    windowId: WINDOW_ID_ENUM.remote,
    channel: IPC_EVENT.workAreaSize,
    requestId: getRandomString(8),
    data: {},
  });

  const res = await ipcRendererInvoke({
    windowId: WINDOW_ID_ENUM.remote,
    channel: IPC_EVENT.getPrimaryDisplaySize,
    requestId: getRandomString(8),
    data: {},
  });
  if (res?.code === 0) {
    appStore.primaryDisplaySize.width = res.data.width;
    appStore.primaryDisplaySize.height = res.data.height;
  }

  const res1 = await ipcRendererInvoke({
    windowId: WINDOW_ID_ENUM.remote,
    channel: IPC_EVENT.scaleFactor,
    requestId: getRandomString(8),
    data: {},
  });
  if (res1?.code === 0) {
    if (res1?.data?.platform !== 'darwin') {
      appStore.scaleFactor = res1.data.scaleFactor;
    }
  }
}

function responsePowerMonitorSuspend(_event, data: IIpcRendererData) {
  console.log('response_powerMonitorSuspend', data);
  suspend.value = `${new Date().toLocaleString()}-powerMonitorSuspend`;
}
function responsePowerMonitorResume(_event, data: IIpcRendererData) {
  console.log('response_powerMonitorResume', data);
  resume.value = `${new Date().toLocaleString()}-powerMonitorResume`;
  handleCloseAll();
}
function responseGetWindowPosition(_event, data: IIpcRendererData) {
  position.value = data.data.position;
}
function responseWorkAreaSize(_event, data: IIpcRendererData) {
  appStore.workAreaSize = {
    width: data.data.width,
    height: data.data.height,
  };
}

function invokeCapture(channel: string, data: Record<string, unknown> = {}) {
  return ipcRendererInvoke({
    windowId: WINDOW_ID_ENUM.remote,
    channel,
    requestId: getRandomString(8),
    data,
  });
}

function getCaptureBoundsWarning(source?: ICaptureSource) {
  return source && source.boundsSource !== 'window'
    ? '无法读取精确边界，控制已停用'
    : '';
}

async function openPermission(kind: 'screen' | 'accessibility') {
  await invokeCapture(IPC_EVENT.openCapturePermission, { kind });
  await refreshCaptureSources();
}

async function showTargetApplication() {
  await invokeCapture(IPC_EVENT.showTargetApplication, {
    bundleId: permissions.value.targetApps[0],
  });
  await refreshCaptureSources();
}

function selectCaptureSource(source: ICaptureSource) {
  if (appStore.remoteDesk.size > 0) return;
  selectedCaptureSourceId.value = source.id;
  captureError.value = '';
  captureWarning.value = getCaptureBoundsWarning(source);
}

function startCaptureBoundsRefresh() {
  clearInterval(captureRefreshTimer.value);
  captureRefreshTimer.value = setInterval(() => {
    void refreshCaptureSources();
  }, 2000);
}

async function refreshCaptureSources() {
  if (!ipcRenderer || captureLoading.value) return;
  const generation = captureGeneration;
  captureLoading.value = true;
  captureError.value = '';
  try {
    const permissionResult = await invokeCapture(IPC_EVENT.capturePermissions);
    if (permissionResult?.code === 0) permissions.value = permissionResult.data;
    const res = await invokeCapture(IPC_EVENT.getCaptureSources);
    if (generation !== captureGeneration) return;
    if (res?.code !== 0) throw new Error(res?.msg || '读取 Codex 窗口失败');
    captureSources.value = Array.isArray(res.data.sources)
      ? res.data.sources
      : [];
    if (
      captureSessionId.value &&
      res.data.sessionId !== captureSessionId.value
    ) {
      captureError.value = '目标窗口已关闭或不可见，远程控制已结束';
      handleCloseAll();
    }
    const retained = captureSources.value.some(
      (source) => source.id === selectedCaptureSourceId.value
    );
    if (!retained)
      selectedCaptureSourceId.value = captureSources.value[0]?.id || '';
    captureWarning.value = getCaptureBoundsWarning(selectedCaptureSource.value);
    if (!captureSources.value.length && !permissions.value.targetApps.length)
      captureError.value ||= '未检测到 Codex/ChatGPT Desktop 窗口';
  } catch (error) {
    if (generation !== captureGeneration) return;
    captureSources.value = [];
    captureError.value = error instanceof Error ? error.message : String(error);
    handleCloseAll();
  } finally {
    captureLoading.value = false;
  }
}

function handleInitIpcRendererOn() {
  ipcRendererOn(
    IPC_EVENT.response_powerMonitorSuspend,
    responsePowerMonitorSuspend
  );

  ipcRendererOn(
    IPC_EVENT.response_powerMonitorResume,
    responsePowerMonitorResume
  );

  ipcRendererOn(
    IPC_EVENT.response_getWindowPosition,
    responseGetWindowPosition
  );

  ipcRendererOn(IPC_EVENT.response_workAreaSize, responseWorkAreaSize);
}

async function initDeskUser() {
  try {
    if (!cacheStore.deskUserUuid || !cacheStore.deskUserPassword) {
      const res = await fetchDeskUserCreate();
      if (res.code === 200) {
        cacheStore.deskUserUuid = res.data.uuid!;
        cacheStore.deskUserPassword = res.data.password!;
        originalPassword.value = res.data.password!;
        roomId.value = cacheStore.deskUserUuid;
      }
    } else {
      const res = await fetchDeskUserLogin({
        uuid: cacheStore.deskUserUuid,
        password: cacheStore.deskUserPassword,
      });
      if (res.code === 200) {
        originalPassword.value = cacheStore.deskUserPassword;
        roomId.value = cacheStore.deskUserUuid;
      }
    }
  } catch (error) {
    console.log(error);
  }
}

async function handleUpdatePassword() {
  try {
    cacheStore.deskUserPassword = getRandomString(8);
    // if (cacheStore.deskUserPassword === originalPassword.value) return;
    if (
      cacheStore.deskUserPassword &&
      cacheStore.deskUserPassword.length > 6 &&
      cacheStore.deskUserPassword.length < 12
    ) {
      await fetchDeskUserUpdateByUuid({
        uuid: cacheStore.deskUserUuid!,
        password: originalPassword.value,
        new_password: cacheStore.deskUserPassword!,
      });
      originalPassword.value = cacheStore.deskUserPassword;
      window.$message.success('更新临时密码成功！');
    } else {
      window.$message.warning('临时密码长度要求6-12位！');
    }
  } catch (error) {
    console.log(error);
  }
}

watch(
  () => connectStatus.value,
  (newval) => {
    console.log('connectStatus', newval);
    if (newval === WsConnectStatusEnum.connect) {
      handleWsMsg();
    }
  }
);

function handleWsMsg() {
  const ws = networkStore.wsMap.get(roomId.value);
  // 收到billdDeskStartRemoteResult
  ws?.socketIo?.on(
    WsMsgTypeEnum.billdDeskStartRemoteResult,
    (data: WsBilldDeskStartRemoteResult['data']) => {
      console.log('收到billdDeskStartRemoteResult', data);
      if (data.code !== 0) {
        useTip({
          content: data.msg,
          hiddenCancel: true,
          hiddenClose: true,
        });
      } else {
        if (data.data) {
          receiverId.value = data.data.receiver;
          if (data.data.receiver === mySocketId.value) {
            appStore.remoteDesk.set(data.data.sender, {
              sender: data.data.sender,
              isClose: false,
              maxBitrate: data.data.maxBitrate,
              maxFramerate: data.data.maxFramerate,
              resolutionRatio: data.data.resolutionRatio,
              videoContentHint: data.data.videoContentHint,
              audioContentHint: data.data.audioContentHint,
              deskUserUuid: data.data.deskUserUuid,
              remoteDeskUserUuid: data.data.remoteDeskUserUuid,
            });
            handleRTC(data.data.sender);
          }
        }
      }
    }
  );
}

function stopCaptureStream() {
  captureGeneration += 1;
  captureLifecycle.stop();
  anchorStream.value = undefined;
  const sessionId = captureSessionId.value;
  captureSessionId.value = '';
  if (ipcRenderer) void invokeCapture(IPC_EVENT.stopCapture, { sessionId });
}

async function beginSelectedCapture() {
  captureGeneration += 1;
  const generation = captureGeneration;
  try {
    const result = await invokeCapture(IPC_EVENT.beginCapture, {
      sourceId: selectedCaptureSourceId.value,
    });
    if (result?.code !== 0) throw new Error(result?.msg || '无法启动窗口捕获');
    const { sessionId, source } = result.data;
    if (generation !== captureGeneration || !appStore.remoteDesk.size) {
      await invokeCapture(IPC_EVENT.stopCapture, { sessionId });
      return;
    }
    captureSessionId.value = sessionId;
    captureWarning.value = getCaptureBoundsWarning(source);
    const stream = await captureLifecycle.start(() =>
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // Electron binds the stream to the native window ID approved by the main process.
          // @ts-ignore
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: source.id,
          },
        },
      })
    );
    if (
      !stream ||
      generation !== captureGeneration ||
      !appStore.remoteDesk.size
    )
      return;
    stream.getVideoTracks().forEach((track) =>
      track.addEventListener(
        'ended',
        () => {
          if (captureSessionId.value !== sessionId) return;
          captureError.value = '窗口视频已结束';
          handleCloseAll();
        },
        { once: true }
      )
    );
    anchorStream.value = stream;
  } catch (error) {
    if (generation !== captureGeneration) return;
    captureError.value =
      error instanceof Error ? error.message : '无法捕获 Codex 窗口';
    handleCloseAll();
  }
}

async function handleRTC(receiver) {
  if (!anchorStream.value || networkStore.rtcMap.has(receiver)) return;
  try {
    await handlConstraints({
      frameRate: currentMaxFramerate.value,
      height: currentResolutionRatio.value,
      stream: anchorStream.value,
    });
    setVideoTrackContentHints(
      anchorStream.value,
      // @ts-ignore
      currentVideoContentHint.value
    );
    setAudioTrackContentHints(
      anchorStream.value,
      // @ts-ignore
      currentAudioContentHint.value
    );
    updateWebRtcRemoteDeskConfig({
      roomId: roomId.value,
      anchorStream: anchorStream.value,
    });
    rtc.value = webRtcRemoteDesk.newWebRtc({
      // 因为这里是收到offer，而offer是房主发的，所以此时的data.data.sender是房主；data.data.receiver是接收者；
      // 但是这里的nativeWebRtc的sender，得是自己，不能是data.data.sender，不要混淆
      sender: mySocketId.value,
      receiver,
      videoEl: createNullVideo(),
      deskUserUuid: cacheStore.deskUserUuid,
      remoteDeskUserUuid: cacheStore.remoteDeskUserUuid,
    });
    webRtcRemoteDesk.sendOffer({
      sender: mySocketId.value,
      receiver,
    });
  } catch (error) {
    console.log(error);
  }
}

function changeDebugUrl() {
  window.location.href = debugUrl.value;
}

async function handleResetDeskuuid() {
  cacheStore.deskUserUuid = '';
  cacheStore.deskUserPassword = '';
  await initDeskUser();
  windowReload();
}

function handleCopy(str) {
  copyToClipBoard(str);
  window.$message.success('复制成功！');
}

function handleClose() {
  showPwdModalCpt.value = false;
  loading.value = false;
}

async function handleConfirm(pwd: string) {
  errMsg.value = '';
  try {
    const res = await fetchDeskUserLinkVerify({
      uuid: cacheStore.remoteDeskUserUuid,
      password: pwd,
    });
    if (res.code == 200) {
      if (res.data.code === 1) {
        isControlOther.value = true;
        showPwdModalCpt.value = false;
        cacheStore.linkDeviceList = cacheStore.linkDeviceList.filter(
          (v) => v.remoteDeskUserUuid !== cacheStore.remoteDeskUserUuid
        );
        cacheStore.linkDeviceList.push({
          remoteDeskUserUuid: cacheStore.remoteDeskUserUuid,
          remoteDeskUserPassword: pwd,
        });
        setTimeout(() => {
          loading.value = false;
        }, 300);
        if (ipcRenderer) {
          ipcRendererSend({
            windowId: 0,
            channel: IPC_EVENT.createWindow,
            requestId: getRandomString(8),
            data: {
              route: routerName.webrtc,
              query: {
                roomId: cacheStore.remoteDeskUserUuid,
                deskUserUuid: cacheStore.deskUserUuid,
                deskUserPassword: cacheStore.deskUserPassword,
                remoteDeskUserUuid: cacheStore.remoteDeskUserUuid,
                remoteDeskUserPassword: pwd,
                receiverId: receiverId.value,
                maxBitrate: currentMaxBitrate.value,
                maxFramerate: currentMaxFramerate.value,
                resolutionRatio: currentResolutionRatio.value,
                audioContentHint: currentAudioContentHint.value,
                videoContentHint: currentVideoContentHint.value,
              },
              windowId: WINDOW_ID_ENUM.webrtc,
              minWidth: 300,
              minHeight: 300,
              useWorkAreaSize: true,
              frame: true,
            },
          });
        } else {
          networkStore.removeAllWsAndRtc();
          sessionStorage.setItem(
            'codex-remote-session',
            JSON.stringify({
              roomId: cacheStore.remoteDeskUserUuid,
              deskUserUuid: cacheStore.deskUserUuid,
              deskUserPassword: cacheStore.deskUserPassword,
              remoteDeskUserUuid: cacheStore.remoteDeskUserUuid,
              remoteDeskUserPassword: pwd,
              receiverId: receiverId.value,
              maxBitrate: currentMaxBitrate.value,
              maxFramerate: currentMaxFramerate.value,
              resolutionRatio: currentResolutionRatio.value,
              audioContentHint: currentAudioContentHint.value,
              videoContentHint: currentVideoContentHint.value,
            })
          );
          await router.push({ name: routerName.webrtc });
        }

        const flag = cacheStore.linkDeviceList.find(
          (v) => v.remoteDeskUserUuid === cacheStore.remoteDeskUserUuid
        );
        if (!flag) {
          cacheStore.linkDeviceList.push({
            remoteDeskUserUuid: cacheStore.remoteDeskUserUuid,
            remoteDeskUserPassword: pwd,
          });
        }
      } else {
        showPwdModalCpt.value = true;
        errMsg.value = '密码错误，请重新输入';
      }
    } else {
      window.$message.error(res.message);
    }
  } catch (error) {
    console.log(error);
  }
}

function changeRemoteDeskUserUuid(item) {
  const res = cacheStore.linkDeviceList.find(
    (v) => v.remoteDeskUserUuid === item.remoteDeskUserUuid
  );
  if (res) {
    cacheStore.remoteDeskUserUuid = res.remoteDeskUserUuid;
    cacheStore.remoteDeskUserPassword = res.remoteDeskUserPassword;
  }
}

function handleDelLinkDeviceList(item) {
  cacheStore.linkDeviceList = cacheStore.linkDeviceList.filter(
    (v) => v.remoteDeskUserUuid !== item.remoteDeskUserUuid
  );
}

async function startRemote() {
  if (loading.value || !cacheStore.deskUserUuid) return;
  cacheStore.remoteDeskUserUuid = cacheStore.remoteDeskUserUuid.trim();
  if (cacheStore.remoteDeskUserUuid === '') {
    window.$message.warning('请输入远程设备代码！');
    return;
  }
  if (cacheStore.remoteDeskUserUuid === cacheStore.deskUserUuid) {
    window.$message.warning('不能连接自己！');
    return;
  }
  try {
    loading.value = true;
    const res = await fetchFindReceiverByUuid(cacheStore.remoteDeskUserUuid);
    if (res.code === 200) {
      if (res.data.receiver !== '') {
        const old = cacheStore.linkDeviceList.find(
          (v) => v.remoteDeskUserUuid === cacheStore.remoteDeskUserUuid
        );
        if (old) {
          pwd.value = old.remoteDeskUserPassword;
          handleConfirm(pwd.value);
        } else {
          pwd.value = '';
          showPwdModalCpt.value = true;
        }
      } else {
        window.$message.info('该设备不在线');
        setTimeout(() => {
          loading.value = false;
        }, 300);
      }
    } else {
      setTimeout(() => {
        loading.value = false;
      }, 300);
      window.$message.error(res.message);
    }
  } catch (error) {
    setTimeout(() => {
      loading.value = false;
    }, 300);
    console.log(error);
  }
}

function handleCloseAll() {
  stopCaptureStream();
  [...appStore.remoteDesk.values()].forEach((item) =>
    networkStore.removeRtc(item.sender)
  );
  appStore.remoteDesk.clear();
}

function handleDel(sender) {
  networkStore.removeRtc(sender);
}
</script>

<style lang="scss" scoped>
.remote-wrap {
  .page-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 0 20px;
    border-bottom: 1px solid #e0e6e2;
  }
  .page-heading h1 {
    margin: 0;
    font-size: 24px;
    color: #213d31;
  }
  .connection-state {
    color: #648074;
    font-size: 12px;
  }
  .permissions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 24px;
    margin: 18px 0;
    padding: 14px 0;
    border-top: 1px solid #e0e6e2;
    border-bottom: 1px solid #e0e6e2;
  }
  .permissions > div {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .permissions button {
    padding: 6px 10px;
    border: 1px solid #bdcec4;
    border-radius: 4px;
    background: white;
    color: #167c65;
    cursor: pointer;
  }
  .quality-settings {
    margin-top: 20px;
  }
  .quality-settings summary {
    width: fit-content;
    padding: 8px 0;
    color: #52665b;
    font-size: 14px;
    cursor: pointer;
  }
  position: relative;
  overflow-y: auto;
  box-sizing: border-box;
  height: 100vh;

  .container {
    padding: 50px 40px 0;
    padding-bottom: 24px;

    .local-device {
      padding-top: 20px;
      .label {
        margin-bottom: 10px;
        font-weight: 500;
        font-size: 24px;
      }
      .info {
        display: flex;
        justify-content: space-between;
        button.copy {
          flex-shrink: 0;
          padding: 0;
          border: 0;
          background-color: transparent;
          @include setBackground('@/assets/img/copy.png');

          &:focus-visible {
            outline: 2px solid $theme-color-gold;
            outline-offset: 2px;
          }
        }
        .info-left {
          .txt {
            margin-bottom: 6px;
            color: #999;
          }
          .code-info {
            display: flex;
            align-items: flex-end;
            .code {
              width: 180px;
              height: 40px;
              color: $theme-color-gold;
              font-size: 30px;

              user-select: text;
            }
            .ico {
              margin-right: 10px;
              width: 20px;
              height: 20px;
              cursor: pointer;

              &.refresh {
                @include setBackground('@/assets/img/refresh.png');
              }
            }
          }
        }
        .info-right {
          .txt {
            margin-bottom: 6px;
            color: #999;
          }
          .code-info {
            display: flex;
            align-items: flex-end;
            .code {
              width: 180px;
              height: 40px;
              color: $theme-color-gold;
              font-size: 30px;

              user-select: text;
            }
            .ico {
              margin-right: 10px;
              width: 20px;
              height: 20px;
              cursor: pointer;

              &.eye {
                @include setBackground('@/assets/img/view.png');
              }
              &.hide {
                @include setBackground('@/assets/img/view_off.png');
              }
              &.edit {
                @include setBackground('@/assets/img/edit.png');
              }
            }
          }
        }
      }
    }
    .remote-device {
      position: relative;
      z-index: 10;
      padding-top: 20px;
      .label {
        font-weight: 500;
        font-size: 24px;
      }
      .info {
        display: flex;
        justify-content: space-between;
        margin-top: 5px;
        .ipt-wrap {
          flex: 1;
          .ipt-top {
            position: relative;
            .ipt {
              box-sizing: border-box;
              padding: 0 15px;
              width: 100%;
              height: 40px;
              outline: none;
              border: 1px solid rgba(153, 153, 153, 0.2);
              border-radius: 4px;
              color: #666;
              font-size: 16px;
              &::placeholder {
                color: #c2c2c2;
                font-size: 15px;
              }
              &:focus {
                border: 1px solid $theme-color-gold;
              }
            }
            .arrow-down {
              position: absolute;
              top: 50%;
              right: 1px;
              width: 24px;
              height: 24px;
              cursor: pointer;
              transition: all 0.3s ease;
              transform: translate(-50%, -50%);

              @include setBackground('@/assets/img/arrow_down.png');
              &.active {
                transform: translate(-50%, -50%) rotate(180deg);
              }
            }
          }
          .ipt-bottom {
            position: relative;

            .link-device-list {
              position: absolute;
              top: 0;
              left: 0;
              overflow: scroll;
              box-sizing: border-box;
              max-height: 200px;
              width: 100%;
              border: 1px solid rgba(153, 153, 153, 0.2);
              border-radius: 2px;
              background-color: #fff;

              @extend %hideScrollbar;
              .link-device-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                box-sizing: border-box;
                padding: 0 15px;
                width: 100%;
                height: 40px;
                &:hover {
                  background-color: #f8f8fb;
                }
                .left {
                  font-size: 16px;
                }
                .right {
                  .del {
                    width: 15px;
                    height: 15px;
                    cursor: pointer;

                    @include cross(#666, 1px);
                  }
                }
              }
            }
            .null {
              height: 40px;
              color: #999;
              text-align: center;
              font-size: 16px;
              line-height: 40px;
            }
          }
        }

        .btn {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-left: 10px;
          width: 110px;
          height: 40px;
          border-radius: 4px;
          background-color: $theme-color-gold;
          color: white;
          font-size: 16px;
          cursor: pointer;
          &:hover {
            opacity: 0.8;
          }
          &.gray {
            opacity: 0.5;
            cursor: no-drop;
          }
          &.loading {
            cursor: no-drop;
          }
          @keyframes rotate {
            0% {
              transform: rotate(0);
            }
            50% {
              transform: rotate(180deg);
            }
            100% {
              transform: rotate(360deg);
            }
          }
          .loading {
            width: 20px;
            height: 20px;
            animation: rotate 1s infinite linear;

            @include setBackground('@/assets/img/sync.png');
          }
        }
      }
    }
    .codex-target {
      margin-top: 18px;
      padding: 18px 0;
      border-top: 1px solid #e0e6e2;

      .target-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;

        .label {
          font-weight: 500;
          font-size: 17px;
        }
        .target-hint {
          margin-top: 3px;
          color: #999;
          font-size: 12px;
        }
      }

      .refresh-target {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: 0 0 auto;
        padding: 4px 10px;
        border: 1px solid $theme-color-gold;
        border-radius: 4px;
        background: white;
        color: $theme-color-gold;
        cursor: pointer;
        .refresh-icon {
          width: 14px;
          height: 14px;
          @include setBackground('@/assets/img/refresh.png');
        }
        &:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
      }

      .capture-source-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
        gap: 8px;
        margin-top: 10px;
        max-height: 150px;
        overflow-y: auto;
      }

      .capture-source {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        grid-template-rows: auto auto;
        column-gap: 8px;
        align-items: center;
        padding: 6px;
        min-width: 0;
        border: 1px solid rgba(153, 153, 153, 0.2);
        border-radius: 4px;
        background: white;
        text-align: left;
        cursor: pointer;
        &:hover {
          border-color: $theme-color-gold;
        }
        &.selected {
          border-color: $theme-color-gold;
          box-shadow: 0 0 0 1px rgba($theme-color-gold, 0.2);
        }
        &:disabled {
          cursor: not-allowed;
        }
        .capture-thumbnail {
          grid-row: 1 / 3;
          width: 72px;
          height: 42px;
          object-fit: cover;
          background: #eee;
        }
        .capture-source-name,
        .capture-source-meta {
          overflow: hidden;
          min-width: 0;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .capture-source-name {
          color: #333;
          font-size: 13px;
        }
        .capture-source-meta {
          margin-top: 3px;
          color: #999;
          font-size: 11px;
        }
      }

      .capture-empty,
      .capture-error,
      .capture-selected {
        margin-top: 8px;
        font-size: 12px;
      }
      .capture-empty,
      .capture-selected {
        color: #777;
      }
      .capture-error {
        color: #c0392b;
      }
    }
    .tip {
      margin-top: 10px;
      color: #666;
      font-size: 12px;
    }
    .link-config {
      position: relative;
      z-index: 9;
      margin-top: 10px;
      .link-item {
        margin-bottom: 4px;
        .link-label {
          width: 80px;
          text-align: right;
        }
      }
    }
  }
  .invite-info {
    visibility: hidden;
    width: 0;
    height: 0;
  }
  .debug-info {
    position: fixed;
    right: 0;
    bottom: 0;
    padding-right: 5px;
    font-size: 12px;
    .link {
      color: red;
      cursor: pointer;
    }
  }

  .list {
    overflow: scroll;
    margin-top: 10px;
    height: 170px;

    @extend %customScrollbarHide;
    &:hover {
      @extend %customScrollbar;
    }
    .item {
      display: flex;
      align-items: center;
      margin-bottom: 4px;
      .del {
        margin-left: 10px;
        padding: 1px 8px;
        border-radius: 3px;
        background-color: #ffe9e5;
        color: red;
        font-size: 12px;
        cursor: pointer;
        &:hover {
          background-color: red;
          color: white;
        }
      }
    }
  }
}
</style>

<style scoped lang="scss">
.browser-controller .container {
  max-width: 850px;
  margin: 0 auto;
  padding-top: 28px;
}
.browser-controller .remote-device {
  padding-top: 28px;
}
.reveal-target {
  display: block;
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px solid #167c65;
  border-radius: 4px;
  background: white;
  color: #167c65;
  cursor: pointer;
}
@media (max-width: 700px) {
  .remote-wrap {
    height: auto;
    min-height: calc(100dvh - 70px);
    overflow: visible;
  }
  .remote-wrap .container {
    padding: 20px 18px;
  }
  .remote-wrap .container .local-device .info {
    flex-wrap: wrap;
    gap: 18px;
  }
  .remote-wrap .container .remote-device .label {
    font-size: 18px;
    margin-bottom: 14px;
  }
  .remote-wrap .container .remote-device .info .ipt-wrap {
    min-width: 0;
  }
  .remote-wrap .container .remote-device .info .btn {
    width: 76px;
    height: 46px;
  }
  .remote-wrap .container .remote-device .info .ipt-wrap .ipt-top .ipt {
    height: 46px;
    padding-right: 38px;
  }
  .remote-wrap .container .codex-target .capture-source-list {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
