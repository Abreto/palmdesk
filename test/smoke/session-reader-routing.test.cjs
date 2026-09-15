const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-source.cjs');

test('reader channels never replace the input channel and all channels close with the peer', (t) => {
  const previousWindow = global.window;
  const previousPeer = global.RTCPeerConnection;
  const network = { rtcMap: new Map(), wsMap: new Map() };
  const app = { remoteDesk: new Map(), allTrack: [] };
  const channel = (label) => ({ label, readyState: 'open', close() { this.readyState = 'closed'; } });
  class Peer extends EventTarget {
    channels = [];
    createDataChannel(label) { const value = channel(label); this.channels.push(value); return value; }
    close() {}
  }
  global.window = { RTCPeerConnection: Peer };
  global.RTCPeerConnection = Peer;
  t.after(() => { global.window = previousWindow; global.RTCPeerConnection = previousPeer; });
  const { WebRTCClass } = load('src/utils/network/webRTC.ts', {
    'billd-utils': { getRandomString: () => 'test' },
    '@/interface': { LiveLineEnum: {}, MediaTypeEnum: {} },
    '@/store/app': { useAppStore: () => app },
    '@/store/network': { useNetworkStore: () => network },
    '@/types/websocket': { WsMsgTypeEnum: {} },
    './iceServers': { getIceServers: () => [] },
  });
  const rtc = new WebRTCClass({ roomId: 'test', sender: 'host', receiver: 'phone', isSRS: false, videoEl: { srcObject: null, remove() {} } });
  const input = channel('MessageChannel');
  const reader = channel('SessionReader');
  rtc.peerConnection.ondatachannel({ channel: input });
  rtc.peerConnection.ondatachannel({ channel: reader });
  assert.equal(rtc.cbDataChannel, input);
  assert.equal(rtc.cbReaderChannel, reader);
  assert.deepEqual(rtc.peerConnection.channels.map((item) => item.label), ['MessageChannel', 'SessionReader']);
  const outgoing = rtc.readerChannel;
  reader.onclose();
  assert.equal(rtc.closed, false);
  assert.equal(rtc.cbDataChannel, input);
  rtc.close();
  assert.equal(outgoing.readyState, 'closed');
  assert.equal(input.readyState, 'closed');
  assert.equal(reader.readyState, 'closed');
  assert.equal(network.rtcMap.size, 0);
});
