import { getRandomString, openToTarget } from 'billd-utils';

import { IPC_EVENT } from '@/event';
import type { WsBilldDeskBehaviorType } from '@/types/websocket';
import { ipcRenderer, ipcRendererInvoke, ipcRendererSend } from '@/utils';
import { remoteInput } from '@/utils/remote-input';

export const useIpcRendererSend = () => {
  function handlesetAlwaysOnTop({ windowId, flag }) {
    ipcRendererSend({
      windowId,
      channel: IPC_EVENT.setAlwaysOnTop,
      requestId: getRandomString(8),
      data: { flag },
    });
  }

  function handleMoveScreenRightBottom({ windowId }) {
    ipcRendererSend({
      windowId,
      channel: IPC_EVENT.handleMoveScreenRightBottom,
      requestId: getRandomString(8),
      data: {},
    });
  }

  function handleOpenDevTools({ windowId }) {
    ipcRendererSend({
      windowId,
      channel: IPC_EVENT.handleOpenDevTools,
      requestId: getRandomString(8),
      data: {},
    });
  }

  function handleOpenExternal({ windowId, url }) {
    if (!ipcRenderer) openToTarget(url);
    else
      ipcRendererInvoke({
        windowId,
        channel: IPC_EVENT.shellOpenExternal,
        requestId: getRandomString(8),
        data: { url },
      });
  }

  function handleRtcBilldDeskBehavior(
    windowId: number,
    data: WsBilldDeskBehaviorType['data'],
    sessionId: string
  ) {
    const input = remoteInput(data);
    if (!input) return;
    return ipcRendererInvoke({
      windowId,
      channel: IPC_EVENT.remoteInput,
      requestId: getRandomString(8),
      data: { sessionId, input },
    });
  }

  return {
    handlesetAlwaysOnTop,
    handleMoveScreenRightBottom,
    handleOpenDevTools,
    handleOpenExternal,
    handleRtcBilldDeskBehavior,
  };
};
