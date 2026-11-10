// TIP: ctrl+cmd+t,生成函数注释

import { IIpcRendererData } from '@/interface';

export const ipcRenderer = window.electronAPI?.ipcRenderer;

const ipcRendererOnMap = {};

// Payloads carry passwords, typed text and image bytes; log channels only.
function logIpc(kind: string, channel: string) {
  if (import.meta.env.DEV) console.debug(kind, channel);
}

export function ipcRendererSend(data: IIpcRendererData) {
  logIpc('ipcRendererSend', data.channel);
  ipcRenderer?.send(data.channel, {
    requestId: data.requestId,
    data: { windowId: data.windowId, ...data.data },
  });
}
export function ipcRendererInvoke(data: IIpcRendererData) {
  logIpc('ipcRendererInvoke', data.channel);
  return ipcRenderer?.invoke(data.channel, {
    requestId: data.requestId,
    data: { windowId: data.windowId, ...data.data },
  });
}

/** Listeners receive the payload sent by the main process. */
export function ipcRendererOn(
  channel: string,
  cb: (data: IIpcRendererData) => void
) {
  if (ipcRendererOnMap[channel]) return;
  ipcRendererOnMap[channel] = true;
  logIpc('ipcRendererOn', channel);
  ipcRenderer?.on(channel, cb);
}

/**
 * detail，应将曲目视为视频细节格外重要。例如，带有文本内容、绘画或线条艺术的演示文稿或网页。设置该值时 MediaStreamTrack.kind的值必须为"video"。
 * text，轨道应该被视为视频细节特别重要，并且明显的锐利边缘和颜色一致的区域可能经常出现。例如，带有文本内容的演示文稿或网页。设置该值时 MediaStreamTrack.kind的值必须为"video"。
 * motion，应将轨道视为包含运动很重要的视频。例如，网络摄像头视频、电影或视频游戏。设置该值时 MediaStreamTrack.kind的值必须为"video"。
 */
export function setVideoTrackContentHints(
  stream: MediaStream,
  hint: 'detail' | 'text' | 'motion'
) {
  const tracks = stream.getVideoTracks();
  tracks.forEach((track) => {
    track.contentHint = hint;
    console.log('setVideoTrackContentHints', track.id, hint);
  });
}
/**
 * music，该曲目应被视为包含音乐。设置该值时 MediaStreamTrack.kind的值必须为"audio"。
 * speech，该轨道应被视为包含语音数据。设置该值时 MediaStreamTrack.kind的值必须为"audio"。
 * speech-recognition，该轨道应被视为包含用于机器语音识别的数据。设置该值时 MediaStreamTrack.kind的值必须为"audio"。
 */
export function setAudioTrackContentHints(
  stream: MediaStream,
  hint: 'music' | 'speech' | 'speech-recognition'
) {
  const tracks = stream.getAudioTracks();
  tracks.forEach((track) => {
    track.contentHint = hint;
    console.log('setAudioTrackContentHints', track.id, hint);
  });
}

export function createNullVideo() {
  const videoEl = document.createElement('video');
  videoEl.autoplay = true;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.loop = true;
  videoEl.setAttribute('webkit-playsinline', 'true');
  videoEl.setAttribute('x5-video-player-type', 'h5');
  videoEl.setAttribute('x5-video-player-fullscreen', 'true');
  videoEl.setAttribute('x5-video-orientation', 'portraint');
  videoEl.oncontextmenu = (e) => {
    e.preventDefault();
  };
  return videoEl;
}
