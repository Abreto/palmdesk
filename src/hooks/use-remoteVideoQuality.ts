import { ref } from 'vue';

import {
  REMOTE_VIDEO_DEFAULTS,
  isRemoteVideoQuality,
  type RemoteVideoQuality,
} from '@/utils/remote-video';

const STORAGE_KEY = 'palmdesk-remote-video-quality-v1';

function copyQuality({
  resolutionRatio,
  maxFramerate,
  maxBitrate,
  videoContentHint,
}: RemoteVideoQuality): RemoteVideoQuality {
  return { resolutionRatio, maxFramerate, maxBitrate, videoContentHint };
}

export function useRemoteVideoQuality() {
  const videoQuality = ref<RemoteVideoQuality>({ ...REMOTE_VIDEO_DEFAULTS });
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || 'null'
    );
    if (isRemoteVideoQuality(saved)) videoQuality.value = copyQuality(saved);
  } catch {
    // Unavailable storage or stale preferences must not block a connection.
  }

  // Only explicit controller edits are saved, never incoming host settings.
  function setVideoQuality(value: RemoteVideoQuality) {
    if (!isRemoteVideoQuality(value)) return;
    videoQuality.value = copyQuality(value);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(videoQuality.value));
    } catch {
      // The choice still applies to the current connection in private browsers.
    }
  }

  return { videoQuality, setVideoQuality };
}
