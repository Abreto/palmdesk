import { getCurrentScope, onScopeDispose, ref } from 'vue';

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

function parseQuality(raw: string | null): RemoteVideoQuality {
  try {
    const saved: unknown = JSON.parse(raw || 'null');
    if (isRemoteVideoQuality(saved)) return copyQuality(saved);
  } catch {
    // A stale preference falls back to the shared starting policy.
  }
  return { ...REMOTE_VIDEO_DEFAULTS };
}

export function useRemoteVideoQuality({ followSavedPreference = false } = {}) {
  const videoQuality = ref<RemoteVideoQuality>({ ...REMOTE_VIDEO_DEFAULTS });
  let preferenceStorage: Storage | undefined;
  try {
    preferenceStorage = localStorage;
    videoQuality.value = parseQuality(preferenceStorage.getItem(STORAGE_KEY));
  } catch {
    // Unavailable storage or stale preferences must not block a connection.
  }

  // Connection forms follow edits in other windows. Active controllers retain
  // their own choice so another window cannot silently change a live stream.
  if (
    followSavedPreference &&
    preferenceStorage &&
    typeof window !== 'undefined' &&
    getCurrentScope()
  ) {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== preferenceStorage) return;
      if (event.key === STORAGE_KEY || event.key === null)
        videoQuality.value = parseQuality(event.newValue);
    };
    window.addEventListener('storage', onStorage);
    onScopeDispose(() => window.removeEventListener('storage', onStorage));
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
