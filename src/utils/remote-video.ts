export type RemoteVideoQuality = {
  resolutionRatio: number;
  maxFramerate: number;
  /** Encoder ceiling in kbit/s, not a constant sending rate. */
  maxBitrate: number;
  videoContentHint: string;
};

export const REMOTE_VIDEO_PROFILES = {
  balanced: {
    // Keep Retina text detail until physical-phone comparisons justify scaling.
    resolutionRatio: 2160,
    maxFramerate: 20,
    maxBitrate: 3000,
    videoContentHint: 'text',
  },
  lowData: {
    resolutionRatio: 1080,
    maxFramerate: 10,
    maxBitrate: 1000,
    videoContentHint: 'text',
  },
  highDetail: {
    resolutionRatio: 2160,
    maxFramerate: 30,
    maxBitrate: 8000,
    videoContentHint: 'text',
  },
} as const;

export type RemoteVideoProfile = keyof typeof REMOTE_VIDEO_PROFILES;

/** One starting policy for desktop and mobile; explicit choices take priority. */
export const REMOTE_VIDEO_DEFAULTS = REMOTE_VIDEO_PROFILES.balanced;

export const REMOTE_VIDEO_OPTIONS = {
  resolutionRatio: [360, 540, 720, 1080, 1440, 2160],
  maxFramerate: [1, 10, 15, 20, 30, 60, 120],
  maxBitrate: [1000, 2000, 3000, 4000, 8000],
  videoContentHint: ['', 'motion', 'text', 'detail'],
};

export function isRemoteVideoQuality(
  value: unknown
): value is RemoteVideoQuality {
  if (!value || typeof value !== 'object') return false;
  const quality = value as RemoteVideoQuality;
  return (
    REMOTE_VIDEO_OPTIONS.resolutionRatio.includes(quality.resolutionRatio) &&
    REMOTE_VIDEO_OPTIONS.maxFramerate.includes(quality.maxFramerate) &&
    REMOTE_VIDEO_OPTIONS.maxBitrate.includes(quality.maxBitrate) &&
    REMOTE_VIDEO_OPTIONS.videoContentHint.includes(quality.videoContentHint)
  );
}

export function remoteVideoProfile(
  quality: RemoteVideoQuality
): RemoteVideoProfile | 'custom' {
  return (
    (Object.keys(REMOTE_VIDEO_PROFILES) as RemoteVideoProfile[]).find((key) =>
      Object.entries(REMOTE_VIDEO_PROFILES[key]).every(
        ([field, value]) => quality[field as keyof RemoteVideoQuality] === value
      )
    ) || 'custom'
  );
}

const MAX_CAPTURE_WIDTH = 3840;
const MAX_CAPTURE_HEIGHT = 2160;
const MAX_CAPTURE_FRAMERATE = 120;

/** Open the native window at full capture quality before adapting its track. */
export function desktopCaptureConstraints(
  sourceId: string
): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      // Electron's window source constraints are not part of the DOM types.
      // @ts-expect-error Electron legacy desktop capture API
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        // Explicit ceilings avoid Chromium's default capture size limiting a
        // Retina window before applyConstraints can select the requested quality.
        // No minimum dimensions: small or portrait windows must not be enlarged.
        maxWidth: MAX_CAPTURE_WIDTH,
        maxHeight: MAX_CAPTURE_HEIGHT,
        maxFrameRate: MAX_CAPTURE_FRAMERATE,
      },
    },
  };
}

export function remoteVideoConstraints(
  height: number,
  frameRate: number
): MediaTrackConstraints {
  if (
    !Number.isFinite(height) ||
    height <= 0 ||
    !Number.isFinite(frameRate) ||
    frameRate <= 0
  )
    throw new Error('窗口分辨率和帧率必须是正数');
  const maxHeight = Math.min(MAX_CAPTURE_HEIGHT, Math.max(1, height));
  const maxWidth = Math.round(
    (maxHeight * MAX_CAPTURE_WIDTH) / MAX_CAPTURE_HEIGHT
  );
  const maxFrameRate = Math.min(MAX_CAPTURE_FRAMERATE, Math.max(1, frameRate));
  // Screen capture preserves the source aspect ratio within these limits.
  // Using maxima also permits a later quality increase or window resize.
  return {
    width: { ideal: maxWidth, max: maxWidth },
    height: { ideal: maxHeight, max: maxHeight },
    frameRate: { ideal: maxFrameRate, max: maxFrameRate },
  };
}

export async function applyRemoteVideoConstraints(
  stream: MediaStream,
  height: number,
  frameRate: number
) {
  await Promise.all(
    stream
      .getVideoTracks()
      .map((track) =>
        track.applyConstraints(remoteVideoConstraints(height, frameRate))
      )
  );
}
