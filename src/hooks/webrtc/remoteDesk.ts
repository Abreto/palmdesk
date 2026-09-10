import { getRandomString } from 'billd-utils';
import { markRaw, ref } from 'vue';

import { useAppStore } from '@/store/app';
import { useNetworkStore } from '@/store/network';
import { WsAnswerType, WsMsgTypeEnum, WsOfferType } from '@/types/websocket';
import { getIceServers } from '@/utils/network/iceServers';
import {
  DIRECT_ICE_SERVERS,
  RemoteConnection,
} from '@/utils/network/remote-connection';
import { getRemoteSession } from '@/utils/network/remote-session';
import { WebRTCClass } from '@/utils/network/webRTC';

const creating = new Map<string, Promise<WebRTCClass>>();

export const useWebRtcRemoteDesk = () => {
  const appStore = useAppStore();
  const networkStore = useNetworkStore();

  const roomId = ref('');
  const anchorStream = ref<MediaStream>();
  const userStream = ref<MediaStream>();

  function updateWebRtcRemoteDeskConfig(data: {
    roomId;
    anchorStream;
    userStream?;
  }) {
    roomId.value = data.roomId;
    anchorStream.value = data.anchorStream;
    userStream.value = data.userStream;
  }

  const webRtcRemoteDesk = {
    newWebRtc: async (data: {
      sender: string;
      receiver: string;
      videoEl: HTMLVideoElement;
      deskUserUuid: string;
      remoteDeskUserUuid: string;
      maxBitrate?: number;
      maxFramerate?: number;
    }) => {
      const existing = networkStore.rtcMap.get(data.receiver);
      if (existing && !existing.closed) return existing;
      const key = `${data.sender}:${data.receiver}`;
      const pending = creating.get(key);
      if (pending) return pending;
      const ws = networkStore.wsMap.get(roomId.value);
      const session = getRemoteSession(data.sender, data.receiver);
      const report = (message: string) => window.$message?.warning(message);
      const job = (async () => {
        const manualServers = getIceServers();
        let iceServers = manualServers;
        if (session && !manualServers.length) {
          try {
            iceServers = (await session.getConfig()).iceServers;
            if (
              !iceServers.some((server) =>
                (Array.isArray(server.urls) ? server.urls : [server.urls]).some(
                  (url) => url.startsWith('turn')
                )
              )
            )
              report('当前服务未配置中继，正在尝试直连');
          } catch {
            iceServers = DIRECT_ICE_SERVERS;
            if (!session.closed) report('中继服务暂不可用，正在尝试直连');
          }
        }
        if (
          session?.closed ||
          !ws?.socketIo?.connected ||
          ws.socketIo.id !== data.sender
        )
          throw new Error('连接已结束');
        const rtc = new WebRTCClass({
          ...data,
          isSRS: false,
          roomId: roomId.value,
          iceServers,
        });
        if (session) {
          rtc.pendingCandidates.push(...session.candidates.splice(0));
          rtc.remoteConnection = markRaw(
            new RemoteConnection(
              rtc,
              session,
              (msgType, payload) => {
                ws.send({
                  requestId: getRandomString(8),
                  msgType,
                  data: {
                    ...payload,
                    sender: data.sender,
                    receiver: data.receiver,
                    live_room_id: rtc.roomId,
                    sessionId: session.access.id,
                    isRemoteDesk: true,
                  },
                });
              },
              report,
              manualServers
            )
          );
          rtc.update();
        }
        return rtc;
      })();
      creating.set(key, job);
      try {
        return await job;
      } finally {
        creating.delete(key);
      }
    },
    /**
     * 主播发offer给观众
     */
    sendOffer: async ({
      sender,
      receiver,
    }: {
      sender: string;
      receiver: string;
    }) => {
      console.log('remoteDesk的sendOffer', {
        sender,
        receiver,
      });
      try {
        const ws = networkStore.wsMap.get(roomId.value);
        if (!ws) return;
        const rtc = networkStore.rtcMap.get(receiver);
        if (rtc) {
          if (rtc.remoteConnection) {
            const pc = rtc.peerConnection!;
            const existingTracks = new Set(
              pc.getSenders().map((item) => item.track)
            );
            anchorStream.value?.getTracks().forEach((track) => {
              if (!existingTracks.has(track))
                pc.addTrack(track, anchorStream.value!);
            });
            await rtc.remoteConnection.offer();
            return;
          }
          anchorStream.value?.getTracks().forEach((track) => {
            if (anchorStream.value) {
              console.log('remoteDesk的sendOffer插入track', track.kind, track);
              rtc.peerConnection?.addTrack(track, anchorStream.value);
            }
          });
          const offerSdp = await rtc.createOffer();
          if (!offerSdp) {
            console.error('remoteDesk的offerSdp为空');
            return;
          }
          await rtc.setLocalDescription(offerSdp!);
          networkStore.wsMap.get(roomId.value)?.send<WsOfferType['data']>({
            requestId: getRandomString(8),
            msgType: WsMsgTypeEnum.nativeWebRtcOffer,
            data: {
              isRemoteDesk: true,
              live_room: appStore.liveRoomInfo!,
              live_room_id: roomId.value,
              sender,
              receiver,
              sdp: offerSdp,
            },
          });
        } else {
          console.error('rtc不存在');
        }
      } catch (error) {
        console.error('remoteDesk的sendOffer错误');
        console.log(error);
      }
    },
    /**
     * 观众收到主播的offer，观众回复主播answer
     */
    sendAnswer: async ({
      sdp,
      sender,
      receiver,
      iceRestart = false,
    }: {
      sdp: RTCSessionDescriptionInit;
      sender: string;
      receiver: string;
      iceRestart?: boolean;
    }) => {
      console.log('remoteDesk的sendAnswer', {
        sender,
        receiver,
      });
      try {
        const ws = networkStore.wsMap.get(roomId.value);
        if (!ws) return;
        const rtc = networkStore.rtcMap.get(receiver);
        if (rtc) {
          if (rtc.remoteConnection) {
            await rtc.remoteConnection.answer(sdp, iceRestart);
            return;
          }
          await rtc.setRemoteDescription(sdp);
          userStream.value?.getTracks().forEach((track) => {
            if (userStream.value) {
              console.log('remoteDesk的sendAnswer插入track');
              rtc.peerConnection?.addTrack(track, userStream.value);
            }
          });
          const answerSdp = await rtc.createAnswer();
          if (!answerSdp) {
            console.error('remoteDesk的answerSdp为空');
            return;
          }
          await rtc.setLocalDescription(answerSdp);
          networkStore.wsMap.get(roomId.value)?.send<WsAnswerType['data']>({
            requestId: getRandomString(8),
            msgType: WsMsgTypeEnum.nativeWebRtcAnswer,
            data: {
              live_room_id: roomId.value,
              sender,
              receiver,
              sdp: answerSdp,
            },
          });
        } else {
          console.error('rtc不存在');
        }
      } catch (error) {
        console.error('remoteDesk的sendAnswer错误');
        console.log(error);
      }
    },
  };

  return { updateWebRtcRemoteDeskConfig, webRtcRemoteDesk };
};
