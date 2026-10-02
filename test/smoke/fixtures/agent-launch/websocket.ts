/* eslint-disable no-underscore-dangle -- Shared browser fixture control. */
import { markRaw, ref } from 'vue';

import { useNetworkStore } from '../../../../src/store/network';
import {
  WsConnectStatusEnum,
  WsMsgTypeEnum as M,
} from '../../../../src/types/websocket';

// Replace the remote host/signaling only. The actual controller page, its
// protocol handling, timers and AgentPicker remain under test.
const state = {
  installed: [
    { id: 'codex', name: 'Codex' },
    { id: 'claude', name: 'Claude' },
  ],
  installedDelay: 20,
  installedReplies: 0,
  supported: true,
  legacy: false,
  running: [] as object[],
  windows: [] as any[],
  afterLaunch: 1,
  afterPolls: 1,
  polls: 0,
  launchDelay: 20,
  launchError: '',
  listError: '',
  launched: '',
  sent: [] as any[],
  channel: undefined as EventTarget | undefined,
};
(window as any).__agentSmoke = state;
const source = (id: string, index: number) => ({
  id: `${id}-${index}`,
  contextId: `${id}-${index}`,
  agentId: id,
  name: `${id} project ${index}`,
  appName: id,
  thumbnail: '',
  appIcon: '',
  isOnScreen: true,
});
export function useWebsocket() {
  const network = useNetworkStore();
  const connectStatus = ref(WsConnectStatusEnum.disconnect);
  return {
    deskUserUuid: ref(''),
    deskUserPassword: ref(''),
    remoteDeskUserUuid: ref(''),
    remoteDeskUserPassword: ref(''),
    connectStatus,
    initWs({ roomId }: { roomId: string }) {
      connectStatus.value = WsConnectStatusEnum.disconnect;
      const handlers = new Map();
      const channel = markRaw(
        Object.assign(new EventTarget(), { readyState: 'open' })
      );
      state.channel = channel;
      const reply = (request: any, msgType: M, data: any) =>
        channel.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({
              msgType,
              requestId: request.requestId,
              data,
            }),
          })
        );
      const peer = {
        receiver: 'fixture-host',
        rtt: 0,
        dataChannel: channel,
        cbDataChannel: channel,
        peerConnection: { connectionState: 'connected' },
        videoEl: markRaw(document.createElement('video')),
        close() {
          channel.readyState = 'closed';
          channel.dispatchEvent(new Event('close'));
        },
        dataChannelSend(request: any) {
          state.sent.push(request);
          setTimeout(() => {
            if (channel.readyState !== 'open') return;
            if (request.msgType === M.remoteControllerState) {
              reply(request, M.remoteControllerStateResult, {
                supported: true,
              });
            } else if (request.msgType === M.remoteWindowsRequest) {
              if (state.launched) state.polls += 1;
              if (state.launched && state.polls >= state.afterPolls) {
                state.running = [{ id: state.launched }];
                state.windows = Array.from(
                  { length: state.afterLaunch },
                  (_, i) => source(state.launched, i)
                );
              }
              state.running.forEach((agent) =>
                reply(request, M.remoteWindowsResult, { agent })
              );
              state.windows.forEach((source) =>
                reply(request, M.remoteWindowsResult, { source })
              );
              reply(request, M.remoteWindowsResult, {
                done: true,
                error: state.listError || undefined,
              });
            } else if (request.msgType === M.remoteInstalledAgentsRequest) {
              if (!state.legacy)
                setTimeout(() => {
                  state.installedReplies += 1;
                  reply(request, M.remoteInstalledAgentsResult, {
                    supported: state.supported,
                    agents: state.installed,
                    message: '此平台不支持打开 Agent',
                  });
                }, state.installedDelay);
            } else if (request.msgType === M.remoteAgentLaunch) {
              setTimeout(() => {
                if (!state.launchError) {
                  state.launched = request.data.id;
                  state.polls = 0;
                }
                reply(request, M.remoteAgentLaunchResult, {
                  id: request.data.id,
                  error: state.launchError || undefined,
                });
              }, state.launchDelay);
            } else if (request.msgType === M.remoteWindowSelect) {
              reply(request, M.remoteWindowSelected, {
                id: request.data.id,
                name: request.data.id,
              });
            }
          }, 10);
        },
      };
      network.wsMap.set(roomId, {
        socketIo: {
          id: 'fixture-phone',
          on: (key: string, fn: any) => handlers.set(key, fn),
          off: (key: string) => handlers.delete(key),
        },
        send(request: any) {
          if (request.msgType !== M.billdDeskStartRemote) return;
          handlers.get(M.billdDeskStartRemoteResult)?.({
            code: 0,
            data: { receiver: 'fixture-host', sender: 'fixture-phone' },
          });
          network.rtcMap.set('fixture-host', peer as any);
        },
        close() {},
      } as any);
      setTimeout(() => {
        connectStatus.value = WsConnectStatusEnum.connect;
      }, 10);
    },
  };
}
