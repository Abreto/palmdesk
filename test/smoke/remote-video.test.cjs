const assert = require('node:assert/strict');
const { test } = require('node:test');
const loadSource = require('./load-source.cjs');
const {
  REMOTE_VIDEO_DEFAULTS,
  desktopCaptureConstraints,
  remoteVideoConstraints,
  applyRemoteVideoConstraints,
} = loadSource('src/utils/remote-video.ts');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function sender(kind = 'video', encodings = [{}]) {
  return {
    track: { kind, contentHint: 'text' },
    parameters: {
      encodings,
      transactionId: 'preserved',
      codecs: [],
      headerExtensions: [],
      rtcp: {},
    },
    writes: [],
    getParameters() {
      return structuredClone(this.parameters);
    },
    async setParameters(parameters) {
      this.writes.push(structuredClone(parameters));
      this.parameters = structuredClone(parameters);
    },
  };
}

function connection(t) {
  const network = { rtcMap: new Map() };
  const app = { setLiveLine() {}, remoteDesk: new Map() };
  class Connection extends EventTarget {
    senders = [];
    signalingState = 'stable';
    connectionState = 'connected';
    getSenders() {
      return this.senders;
    }
    createDataChannel() {
      return { readyState: 'open', close() {} };
    }
    close() {}
  }
  const originalWindow = global.window;
  const originalConnection = global.RTCPeerConnection;
  global.window = { RTCPeerConnection: Connection };
  global.RTCPeerConnection = Connection;
  t.after(() => {
    global.window = originalWindow;
    global.RTCPeerConnection = originalConnection;
  });
  for (const method of ['log', 'warn', 'error'])
    t.mock.method(console, method, () => {});
  const { WebRTCClass } = loadSource('src/utils/network/webRTC.ts', {
    '@/interface': { LiveLineEnum: { rtc: 'rtc' } },
    '@/store/app': { useAppStore: () => app },
    '@/store/network': { useNetworkStore: () => network },
    './iceServers': { getIceServers: () => [] },
  });
  const rtc = new WebRTCClass({
    ...REMOTE_VIDEO_DEFAULTS,
    roomId: 'room',
    sender: 'host',
    receiver: 'phone',
    isSRS: false,
    videoEl: { remove() {} },
  });
  t.after(() => rtc.close());
  return rtc;
}

test('Retina capture has enough headroom for 4K without forcing small windows to upscale', () => {
  const constraints = desktopCaptureConstraints('window:42:0');
  assert.equal(constraints.audio, false);
  assert.equal(constraints.video.mandatory.chromeMediaSourceId, 'window:42:0');
  assert.ok(constraints.video.mandatory.maxWidth >= 3024);
  assert.ok(constraints.video.mandatory.maxHeight >= 1964);
  assert.equal(constraints.video.mandatory.minWidth, undefined);
  assert.equal(constraints.video.mandatory.minHeight, undefined);
  const defaults = remoteVideoConstraints(
    REMOTE_VIDEO_DEFAULTS.resolutionRatio,
    REMOTE_VIDEO_DEFAULTS.maxFramerate
  );
  assert.ok(
    defaults.height.max >= 1964,
    'a Retina desktop must not be reduced to 1080p by default'
  );
  assert.equal(defaults.height.min, undefined);
  assert.equal(defaults.frameRate.max, 30);
});

test('changing quality replaces both dimension limits and can recover from 720p to 2160p', async () => {
  let constraints;
  const track = {
    async applyConstraints(value) {
      constraints = value;
    },
  };
  const stream = { getVideoTracks: () => [track] };
  await applyRemoteVideoConstraints(stream, 720, 15);
  assert.equal(constraints.height.max, 720);
  assert.equal(constraints.width.max, 1280);
  await applyRemoteVideoConstraints(stream, 2160, 60);
  assert.equal(constraints.height.max, 2160);
  assert.equal(constraints.width.max, 3840);
  assert.equal(constraints.frameRate.max, 60);
  for (const value of [NaN, Infinity, 0, -1]) {
    assert.throws(() => remoteVideoConstraints(value, 30));
    assert.throws(() => remoteVideoConstraints(1080, value));
  }
});

test('video added after DataChannel connection gets the saved bitrate after negotiation', async (t) => {
  const rtc = connection(t);
  assert.equal(
    await rtc.setMaxBitrate(8000),
    1,
    'a data-only connection must not leave a pending promise'
  );
  const video = sender('video', []);
  rtc.peerConnection.senders.push(video);
  await rtc.updateVideoSenderParameters();
  assert.equal(
    video.writes.length,
    0,
    'do not create an unnegotiated encoding'
  );
  video.parameters.encodings = [{ active: true }];
  rtc.peerConnection.dispatchEvent(new Event('signalingstatechange'));
  await flush();
  assert.equal(video.parameters.encodings[0].maxBitrate, 8_000_000);
  assert.equal(video.parameters.encodings[0].maxFramerate, 30);
  assert.equal(video.parameters.degradationPreference, 'maintain-resolution');
  assert.equal(video.parameters.transactionId, 'preserved');
  assert.equal(video.parameters.encodings[0].active, true);
});

test('reconnecting never multiplies the bitrate by 1000 again and audio remains untouched', async (t) => {
  const rtc = connection(t);
  const video = sender();
  const audio = sender('audio');
  rtc.peerConnection.senders.push(video, audio);
  await rtc.setMaxBitrate(4000);
  for (let count = 0; count < 3; count++) {
    rtc.peerConnection.dispatchEvent(new Event('connectionstatechange'));
    await flush();
  }
  assert.equal(rtc.maxBitrate, 4000);
  assert.equal(video.parameters.encodings[0].maxBitrate, 4_000_000);
  assert.equal(video.writes.length, 1);
  assert.equal(audio.writes.length, 0);
});

test('all negotiated video encodings receive live frame rate and content preferences', async (t) => {
  const rtc = connection(t);
  const first = sender('video', [{ rid: 'high' }, { rid: 'low' }]);
  const second = sender();
  rtc.peerConnection.senders.push(first, second);
  await rtc.updateVideoSenderParameters();
  first.track.contentHint = 'motion';
  second.track.contentHint = '';
  // The store exposes a shallow snapshot; setters must update the live instance.
  await { ...rtc }.setMaxFramerate(15);
  assert.equal(rtc.maxFramerate, 15);
  assert.equal(first.parameters.degradationPreference, 'maintain-framerate');
  assert.equal(second.parameters.degradationPreference, undefined);
  for (const entry of [first, second]) {
    for (const encoding of entry.parameters.encodings) {
      assert.equal(encoding.maxFramerate, 15);
      assert.equal(encoding.maxBitrate, 8_000_000);
    }
  }
});

test('overlapping quality updates serialize sender transactions and survive encoder rejection', async (t) => {
  const rtc = connection(t);
  const video = sender();
  rtc.peerConnection.senders.push(video);
  let release;
  let active = 0;
  const set = video.setParameters.bind(video);
  video.setParameters = async (parameters) => {
    assert.equal(active++, 0, 'setParameters calls must not overlap');
    await new Promise((resolve) => {
      release = resolve;
    });
    active--;
    await set(parameters);
  };
  const first = rtc.setMaxBitrate(2000);
  await flush();
  const second = rtc.setMaxBitrate(8000);
  release();
  await first;
  await flush();
  release();
  await second;
  assert.equal(video.parameters.encodings[0].maxBitrate, 8_000_000);
  video.setParameters = async () => {
    throw new Error('encoder not ready');
  };
  assert.equal(await rtc.setMaxBitrate(4000), 0);
  video.setParameters = set;
  assert.equal(await rtc.updateVideoSenderParameters(), 1);
  assert.equal(video.parameters.encodings[0].maxBitrate, 4_000_000);
});
