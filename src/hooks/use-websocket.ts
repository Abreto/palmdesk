import { getRandomString } from 'billd-utils';
import { computed, ref } from 'vue';

import { WEBSOCKET_URL } from '@/constant';
import { useWebRtcRemoteDesk } from '@/hooks/webrtc/remoteDesk';
import { useNetworkStore } from '@/store/network';
import {
  WsAnswerType,
  WsBilldDeskJoinType,
  WsBilldDeskStartRemoteResult,
  WsCandidateType,
  WsConnectStatusEnum,
  WsMsgTypeEnum,
  WsOfferType,
} from '@/types/websocket';
import { createNullVideo } from '@/utils';
import { getWssUrl } from '@/utils/localStorage/app';
import {
  clearRemoteSessions,
  getRemoteSession,
  registerRemoteSession,
  removeRemoteSession,
  REMOTE_SESSION_ENDED_EVENT,
} from '@/utils/network/remote-session';
import {
  WebSocketClass,
  prettierReceiveWsMsg,
} from '@/utils/network/webSocket';

// Signaling for remote desk sessions. The PalmDesk backend accepts only the
// desk events, so the upstream live, PK and meeting handlers are gone.
export const useWebsocket = () => {
  const networkStore = useNetworkStore();

  const { updateWebRtcRemoteDeskConfig, webRtcRemoteDesk } =
    useWebRtcRemoteDesk();

  const connectStatus = ref<WsConnectStatusEnum>();
  const roomId = ref('');
  const remoteDeskUserUuid = ref('');
  const remoteDeskUserPassword = ref('');
  const deskUserUuid = ref('');
  const deskUserPassword = ref('');

  const mySocketId = computed(() => {
    return networkStore.wsMap.get(roomId.value)?.socketIo?.id || '-1';
  });

  function sendJoin() {
    const instance = networkStore.wsMap.get(roomId.value);
    if (!instance) return;
    instance.send<WsBilldDeskJoinType['data']>({
      requestId: getRandomString(8),
      msgType: WsMsgTypeEnum.billdDeskJoin,
      data: {
        deskUserUuid: deskUserUuid.value,
        deskUserPassword: deskUserPassword.value,
        live_room_id: roomId.value,
      },
    });
  }

  function initReceive() {
    const ws = networkStore.wsMap.get(roomId.value);
    if (!ws?.socketIo) return;
    let connectedSocketId = '';
    ws.socketIo.on(
      WsMsgTypeEnum.billdDeskStartRemoteResult,
      (result: WsBilldDeskStartRemoteResult['data']) => {
        const access = result.session;
        if (result.code !== 0 || !access || access.socketId !== ws.socketIo?.id)
          return;
        const previous = networkStore.rtcMap.get(access.peerId);
        if (
          previous &&
          previous.remoteConnection?.session.access.id !== access.id
        )
          previous.close();
        registerRemoteSession(access);
      }
    );
    ws.socketIo.on(
      WsMsgTypeEnum.billdDeskSessionEnded,
      (data: { sessionId: string; peerId: string }) => {
        const session = getRemoteSession(connectedSocketId, data.peerId);
        if (session?.access.id !== data.sessionId) return;
        window.dispatchEvent(
          new CustomEvent(REMOTE_SESSION_ENDED_EVENT, { detail: data })
        );
        networkStore.removeRtc(data.peerId);
        removeRemoteSession(connectedSocketId, data.peerId, data.sessionId);
      }
    );
    ws.socketIo.on(WsMsgTypeEnum.billdDeskSessionError, () => {
      window.$message?.error('远控会话认证失败，请重新连接');
    });
    ws.socketIo.on(
      WsMsgTypeEnum.nativeWebRtcRestart,
      (data: { sender: string; receiver: string; sessionId: string }) => {
        const rtc = networkStore.rtcMap.get(data.sender);
        if (
          data.receiver === connectedSocketId &&
          rtc?.remoteConnection?.session.access.id === data.sessionId
        )
          void rtc.remoteConnection.offer(true);
      }
    );
    // websocket连接成功
    ws.socketIo.on(WsConnectStatusEnum.connect, () => {
      connectedSocketId = ws.socketIo?.id || '';
      prettierReceiveWsMsg(WsConnectStatusEnum.connect, ws.socketIo);
      if (!ws) return;
      connectStatus.value = WsConnectStatusEnum.connect;
      ws.status = WsConnectStatusEnum.connect;
      ws.update();
      sendJoin();
    });

    // websocket连接断开
    ws.socketIo.on(WsConnectStatusEnum.disconnect, (err) => {
      clearRemoteSessions(connectedSocketId);
      networkStore.rtcMap.forEach((rtc) => {
        if (rtc.sender === connectedSocketId) rtc.close();
      });
      prettierReceiveWsMsg(WsConnectStatusEnum.disconnect, ws);
      console.error('websocket连接断开', err);
      if (!ws) return;
      connectStatus.value = WsConnectStatusEnum.disconnect;
      ws.status = WsConnectStatusEnum.disconnect;
      ws.update();
    });

    // 收到nativeWebRtcOffer
    ws.socketIo.on(
      WsMsgTypeEnum.nativeWebRtcOffer,
      async (data: WsOfferType['data']) => {
        console.log('收到nativeWebRtcOffer', data);
        if (!data.isRemoteDesk) return;
        if (data.receiver === mySocketId.value) {
          const session = getRemoteSession(mySocketId.value, data.sender);
          if (data.sessionId && session?.access.id !== data.sessionId) return;
          try {
            console.warn('是发给我的nativeWebRtcOffer-isRemoteDesk');
            updateWebRtcRemoteDeskConfig({
              roomId: roomId.value,
              anchorStream: undefined,
            });
            if (!networkStore.rtcMap.has(data.sender))
              await webRtcRemoteDesk.newWebRtc({
                // 因为这里是收到offer，而offer是房主发的，所以此时的data.data.sender是房主；data.data.receiver是接收者；
                // 但是这里的nativeWebRtc的sender，得是自己，不能是data.data.sender，不要混淆
                sender: mySocketId.value,
                receiver: data.sender,
                videoEl: createNullVideo(),
                deskUserUuid: deskUserUuid.value,
                remoteDeskUserUuid: remoteDeskUserUuid.value,
              });
            await webRtcRemoteDesk.sendAnswer({
              sender: mySocketId.value,
              // data.data.receiver是接收者；我们现在new pc，发送者是自己，接收者肯定是房主，不能是data.data.receiver，因为data.data.receiver是自己
              receiver: data.sender,
              sdp: data.sdp,
              iceRestart: data.iceRestart,
            });
          } catch {
            window.$message?.error('远程连接已结束，请重新连接');
          }
        } else {
          console.error('不是发给我的nativeWebRtcOffer-isRemoteDesk');
        }
      }
    );

    // 收到nativeWebRtcAnswer
    ws.socketIo.on(
      WsMsgTypeEnum.nativeWebRtcAnswer,
      async (data: WsAnswerType['data']) => {
        console.log('收到nativeWebRtcAnswer', data);
        if (data.receiver === mySocketId.value) {
          console.warn('是发给我的nativeWebRtcAnswer');
          const rtc = networkStore.rtcMap.get(data.sender);
          if (rtc) {
            if (rtc.remoteConnection) {
              if (rtc.remoteConnection.session.access.id === data.sessionId)
                await rtc.remoteConnection.acceptAnswer(data.sdp);
            } else await rtc.setRemoteDescription(data.sdp);
          }
        } else {
          console.error('不是发给我的nativeWebRtcAnswer');
        }
      }
    );

    // 收到nativeWebRtcCandidate
    ws.socketIo.on(
      WsMsgTypeEnum.nativeWebRtcCandidate,
      (data: WsCandidateType['data']) => {
        console.log('收到nativeWebRtcCandidate', data);
        if (data.receiver === mySocketId.value) {
          console.warn('是发给我的nativeWebRtcCandidate');
          const session = getRemoteSession(mySocketId.value, data.sender);
          if (data.sessionId && session?.access.id !== data.sessionId) return;
          const rtc = networkStore.rtcMap.get(data.sender);
          if (rtc) void rtc.addIceCandidate(data.candidate);
          else if (
            session &&
            !session.closed &&
            session.candidates.length < 256
          )
            session.candidates.push(data.candidate);
        } else {
          console.error('不是发给我的nativeWebRtcCandidate');
        }
      }
    );
  }

  function initWs(data: {
    isAnchor: boolean;
    roomId: string;
    isRemoteDesk?: boolean;
  }) {
    roomId.value = data.roomId;
    new WebSocketClass({
      roomId: roomId.value,
      url: getWssUrl() || WEBSOCKET_URL,
      isAnchor: data.isAnchor,
    });
    initReceive();
  }

  return {
    initWs,
    deskUserUuid,
    deskUserPassword,
    remoteDeskUserUuid,
    remoteDeskUserPassword,
    connectStatus,
    mySocketId,
  };
};
