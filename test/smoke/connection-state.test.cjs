const assert = require('node:assert/strict');
const { test } = require('node:test');
const { computed, markRaw, reactive } = require('vue');
const loadSource = require('./load-source.cjs');

test('controller becomes connected when the native connection event follows DataChannel open', async (t) => {
  const network = { rtcMap: reactive(new Map()) };
  const app = { setLiveLine() {}, remoteDesk: new Map() };
  class Connection extends EventTarget {
    connectionState = 'connecting';
    createDataChannel() {
      return markRaw({ readyState: 'connecting', close() {} });
    }
    close() {}
    constructor() {
      super();
      return markRaw(this);
    }
  }
  const originalWindow = global.window;
  const originalConnection = global.RTCPeerConnection;
  global.window = { RTCPeerConnection: Connection };
  global.RTCPeerConnection = Connection;
  t.after(() => {
    global.window = originalWindow;
    global.RTCPeerConnection = originalConnection;
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const { WebRTCClass } = loadSource('src/utils/network/webRTC.ts', {
    '@/interface': { LiveLineEnum: { rtc: 'rtc' } },
    '@/store/app': { useAppStore: () => app },
    '@/store/network': { useNetworkStore: () => network },
    './iceServers': { getIceServers: () => [] },
  });
  const rtc = new WebRTCClass({
    roomId: 'room',
    sender: 'phone',
    receiver: 'host',
    isSRS: false,
    videoEl: { remove() {} },
  });
  const connected = computed(() => {
    const peer = network.rtcMap.get('host');
    return (
      peer?.peerConnection?.connectionState === 'connected' &&
      peer?.dataChannel?.readyState === 'open'
    );
  });
  rtc.dataChannel.readyState = 'open';
  rtc.dataChannel.onopen();
  assert.equal(connected.value, false);
  rtc.peerConnection.connectionState = 'connected';
  rtc.peerConnection.dispatchEvent(new Event('connectionstatechange'));
  assert.equal(connected.value, true);
  rtc.peerConnection.remoteDescription = { type: 'answer', sdp: 'previous-generation' };
  rtc.peerConnection.addIceCandidate = () => assert.fail('must queue while a new remote description is pending');
  rtc.awaitingRemoteDescription = true;
  await rtc.addIceCandidate({ candidate: 'new-generation-candidate' });
  assert.equal(rtc.pendingCandidates.length, 1);
  const native = rtc.peerConnection;
  rtc.close();
  native.dispatchEvent(new Event('connectionstatechange'));
  assert.equal(
    network.rtcMap.size,
    0,
    'late events must not restore a closed connection'
  );
});
