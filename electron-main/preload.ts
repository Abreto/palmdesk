import { contextBridge, ipcRenderer } from 'electron';

import {
  RENDERER_INVOKE_CHANNELS,
  RENDERER_RECEIVE_CHANNELS,
  RENDERER_SEND_CHANNELS,
} from './renderer-security';

import type { IpcRendererEvent } from 'electron';

const invokeChannels = new Set(RENDERER_INVOKE_CHANNELS);
const sendChannels = new Set(RENDERER_SEND_CHANNELS);
const receiveChannels = new Set(RENDERER_RECEIVE_CHANNELS);

// Expose only the channels the app uses. Listeners never receive the
// IpcRendererEvent, whose `sender` is the unrestricted ipcRenderer.
contextBridge.exposeInMainWorld('electronAPI', {
  ipcRenderer: {
    invoke: (channel: string, request: unknown) =>
      invokeChannels.has(channel)
        ? ipcRenderer.invoke(channel, request)
        : Promise.reject(new Error(`IPC channel is not allowed: ${channel}`)),
    send: (channel: string, request: unknown) => {
      if (sendChannels.has(channel)) ipcRenderer.send(channel, request);
    },
    on: (channel: string, listener: (payload: unknown) => void) => {
      if (!receiveChannels.has(channel)) return () => {};
      const forward = (_event: IpcRendererEvent, payload: unknown) =>
        listener(payload);
      ipcRenderer.on(channel, forward);
      return () => {
        ipcRenderer.removeListener(channel, forward);
      };
    },
  },
});
