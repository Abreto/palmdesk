/** Shared by the desktop and mobile controllers. Bitrate is always in kbit/s. */
export const REMOTE_VIDEO_DEFAULTS = {
  resolutionRatio: 2160,
  maxFramerate: 30,
  maxBitrate: 8000,
  videoContentHint: 'text',
} as const;

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
