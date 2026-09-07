const assert = require('node:assert/strict');
const { test } = require('node:test');
const loadSource = require('./load-source.cjs');

const events = Object.fromEntries(['nativeWebRtcOffer', 'nativeWebRtcAnswer', 'nativeWebRtcRestart', 'billdDeskEndRemote'].map((name) => [name, name]));
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t, offerer = true) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = global.window;
  global.window = new EventTarget();
  let fetches = 0;
  const sent = [];
  const notices = [];
  let removed = 0;
  const { RemoteConnection } = loadSource('src/utils/network/remote-connection.ts', {
    '@/types/websocket': { WsMsgTypeEnum: events },
    './remote-session': { removeRemoteSession() { removed++; } },
  });
  const pc = new EventTarget();
  Object.assign(pc, {
    signalingState: 'stable', iceConnectionState: 'connected', offers: [], configurations: [], candidates: [],
    setConfiguration(config) { this.configurations.push(config); },
    async createOffer(options) { this.offers.push(options); return { type: 'offer', sdp: 'offer' }; },
    async createAnswer() { return { type: 'answer', sdp: 'answer' }; },
    async setLocalDescription(sdp) { this.localDescription = sdp; this.signalingState = sdp.type === 'offer' ? 'have-local-offer' : 'stable'; },
    async setRemoteDescription(sdp) { this.signalingState = sdp.type === 'offer' ? 'have-remote-offer' : 'stable'; },
    async addIceCandidate(candidate) { this.candidates.push(candidate); },
  });
  const config = { iceServers: [{ urls: 'turn:relay.test', credential: 'old' }], expiresAt: Date.now() + 3600000, refreshAfter: Date.now() + 3300000 };
  const session = { access: { id: 'session', socketId: 'a', peerId: 'b', offerer }, config,
    getConfig: async () => { fetches++; return { ...config, expiresAt: config.expiresAt + 3600000, refreshAfter: config.refreshAfter + 3600000,
      iceServers: [{ urls: 'turn:relay.test', credential: 'new' }] }; } };
  const rtc = { peerConnection: pc, pendingCandidates: [], closed: false, close() { this.closed = true; manager.close(); } };
  const manager = new RemoteConnection(rtc, session, (event, data) => sent.push({ event, data }), (message) => notices.push(message), []);
  t.after(() => { manager.close(); global.window = original; });
  return { manager, pc, rtc, session, sent, notices, fetches: () => fetches, removed: () => removed };
}

test('offerer updates credentials before restarting ICE and queues a restart until the previous answer', async (t) => {
  const { manager, pc, sent, fetches } = fixture(t);
  await manager.offer();
  await manager.offer(true);
  assert.equal(pc.offers.length, 1);
  await manager.acceptAnswer({ type: 'answer', sdp: 'answer' });
  pc.dispatchEvent(new Event('signalingstatechange'));
  await flush();
  assert.equal(pc.offers.length, 2);
  assert.equal(pc.offers[1].iceRestart, true);
  assert.equal(fetches(), 1);
  assert.equal(pc.configurations.at(-1).iceServers[0].credential, 'new');
  assert.equal(sent.at(-1).data.iceRestart, true);
});

test('answerer refreshes before an ICE restart answer and requests recovery through the offerer', async (t) => {
  const { manager, pc, sent, fetches } = fixture(t, false);
  await manager.offer(true);
  assert.equal(pc.offers.length, 0);
  await manager.answer({ type: 'offer', sdp: 'restart' }, true);
  assert.equal(fetches(), 1);
  assert.equal(sent.at(-1).event, 'nativeWebRtcAnswer');
  pc.iceConnectionState = 'failed';
  manager.recover(true);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(sent.at(-1).event, 'nativeWebRtcRestart');
  assert.equal(pc.offers.length, 0);
});

test('a transient disconnect can recover without closing; repeated failure eventually closes', async (t) => {
  const { manager, pc, rtc, removed } = fixture(t, false);
  pc.iceConnectionState = 'disconnected';
  manager.recover();
  t.mock.timers.tick(1000);
  pc.iceConnectionState = 'connected';
  manager.connected();
  t.mock.timers.tick(10000);
  assert.equal(rtc.closed, false);
  pc.iceConnectionState = 'failed';
  manager.recover(true);
  for (let attempt = 0; attempt < 4; attempt++) {
    t.mock.timers.tick(1);
    await flush();
    t.mock.timers.tick(15000);
    await flush();
  }
  assert.equal(rtc.closed, true);
  assert.equal(removed(), 1);
});

test('closing during credential renewal cannot reconfigure or restart the old connection', async (t) => {
  const { manager, session, pc, sent } = fixture(t);
  let complete;
  session.getConfig = () => new Promise((resolve) => { complete = resolve; });
  const refreshing = manager.refresh();
  manager.close();
  complete(session.config);
  await refreshing;
  t.mock.timers.tick(4000000);
  await flush();
  assert.equal(pc.configurations.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event, 'billdDeskEndRemote');
});

test('a delayed restart refresh keeps new candidates queued until the new remote description', async (t) => {
  const { manager, session, rtc, pc } = fixture(t, false);
  let complete;
  session.getConfig = () => new Promise((resolve) => { complete = resolve; });
  const answer = manager.answer({ type: 'offer', sdp: 'new-generation' }, true);
  await flush();
  assert.equal(rtc.awaitingRemoteDescription, true);
  const candidate = { candidate: 'new-generation-candidate' };
  rtc.pendingCandidates.push(candidate);
  complete(session.config);
  await answer;
  assert.equal(rtc.awaitingRemoteDescription, false);
  assert.deepEqual(pc.candidates, [candidate]);
  assert.equal(rtc.pendingCandidates.length, 0);
});
