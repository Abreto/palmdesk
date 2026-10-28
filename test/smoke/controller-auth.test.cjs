const assert = require('node:assert/strict');
const test = require('node:test');

const load = require('./load-source.cjs');

const {
  CONTROLLER_AUTH_CHANNEL,
  ControllerHandshake,
  HostHandshake,
  calculateGenerator,
  dtlsFingerprints,
  generatorString,
  intermediateKey,
  lvCat,
  parseHello,
  prependLen,
  scalarMultVfy,
} = load('src/utils/controller-auth.ts');
const {
  GuessLimiter,
  HostAuthentication,
  controllerVerified,
  verifyController,
} = load('src/utils/controller-auth-channel.ts');

const hex = (value) => Buffer.from(value).toString('hex');
const bytes = (value) => new Uint8Array(Buffer.from(value, 'hex'));
const text = (value) => new Uint8Array(Buffer.from(value));
const littleEndian = (value) =>
  BigInt(`0x${Buffer.from(value, 'hex').reverse().toString('hex')}`);
const fingerprint = (byte) => Array(32).fill(byte).join(':');
const HOST = fingerprint('AA');
const CONTROLLER = fingerprint('CC');
const ATTACKER = fingerprint('EE');
const fingerprints = {
  host: `sha-256 ${HOST}`,
  controller: `sha-256 ${CONTROLLER}`,
};
const sdp = (value) =>
  [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    `a=fingerprint:sha-256 ${value}`,
    '',
  ].join('\r\n');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('CPace primitives reproduce the draft-irtf-cfrg-cpace-21 ristretto255 vectors', () => {
  assert.equal(hex(prependLen(new Uint8Array())), '00');
  assert.equal(hex(prependLen(text('1234'))), '0431323334');
  assert.equal(hex(prependLen(new Uint8Array(127))).slice(0, 2), '7f');
  assert.equal(hex(prependLen(new Uint8Array(128))).slice(0, 4), '8001');
  assert.equal(
    hex(lvCat(text('1234'), text('5'), new Uint8Array(), text('678'))),
    '043132333401350003363738'
  );
  const prs = text('Password');
  const ci = bytes('0b415f696e69746961746f720b425f726573706f6e646572');
  const sid = bytes('7e4b4791d6a8ef019b936c79fb7f2c57');
  assert.equal(generatorString(prs, ci, sid).length, 170);
  const g = calculateGenerator(prs, ci, sid);
  assert.equal(
    hex(g.toBytes()),
    '222b6b195fe84b1652badb6f6a3ae3d24341e7306967f0b8115b40d5698c7e56'
  );
  const ya = littleEndian(
    'da3d23700a9e5699258aef94dc060dfda5ebb61f02a5ea77fad53f4ff0976d08'
  );
  const yb = littleEndian(
    'd2316b454718c35362d83d69df6320f38578ed5984651435e2949762d900b80d'
  );
  const Ya = g.multiply(ya).toBytes();
  const Yb = g.multiply(yb).toBytes();
  assert.equal(
    hex(Ya),
    'd6bac480f2c386c394efc7c47adb9925dcd2630b64f240c50f8d0eec482b9157'
  );
  assert.equal(
    hex(Yb),
    '3ea7e0b19560d7c0b0f5734f63b955286dfa8232b5ebe63324e2d9e7433f7258'
  );
  const K = scalarMultVfy(ya, Yb);
  assert.deepEqual(K, scalarMultVfy(yb, Ya));
  assert.equal(
    hex(K),
    '80b69a8a76457ab6a4d7f887a4bf6b55a2f80ac19c333f917a05fc9887c8b40f'
  );
  assert.equal(
    hex(intermediateKey(sid, K, Ya, text('ADa'), Yb, text('ADb'))),
    'b69effbf61b51d56401c0f65601abe428de8206feaaf0e32198896dcae7b35cd' +
      '2b38950a39dfd5d4a79164614c2984f7daa460b588c1e80c3fa2068af7900447'
  );
  const s = littleEndian(
    '7cd0e075fa7955ba52c02759a6c90dbbfc10e6d40aea8d283e407d88cf538a05'
  );
  assert.equal(
    hex(
      scalarMultVfy(
        s,
        bytes(
          '2c3c6b8c4f3800e7aef6864025b4ed79bd599117e427c41bd47d93d654b4a51c'
        )
      )
    ),
    '7c13645fe790a468f62c39beb7388e541d8405d1ade69d1778c5fe3e7f6b600e'
  );
  // Invalid encodings and the neutral element abort the exchange.
  assert.throws(() =>
    scalarMultVfy(
      s,
      bytes('2b3c6b8c4f3800e7aef6864025b4ed79bd599117e427c41bd47d93d654b4a51c')
    )
  );
  assert.throws(() => scalarMultVfy(s, new Uint8Array(32)));
});

test('DTLS fingerprints are read the same way from either side of the SDP', () => {
  const description = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    `a=fingerprint:SHA-256 ${HOST.toLowerCase()}`,
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    `a=fingerprint:sha-256   ${HOST}`,
    '',
  ].join('\r\n');
  assert.equal(dtlsFingerprints(description), `sha-256 ${HOST}`);
  assert.equal(
    dtlsFingerprints(`${sdp(HOST)}a=fingerprint:sha-1 ${fingerprint('01')}\n`),
    `sha-1 ${fingerprint('01')},sha-256 ${HOST}`
  );
  assert.throws(() => dtlsFingerprints('v=0\r\nm=application 9\r\n'));
  assert.throws(() => dtlsFingerprints(undefined));
});

function exchange(options = {}) {
  const controller = new ControllerHandshake(
    options.controllerPassword ?? 'Ab3dE6gH',
    options.controllerDevice ?? 'host-code'
  );
  const host = new HostHandshake(
    options.hostPassword ?? 'Ab3dE6gH',
    options.hostDevice ?? 'host-code',
    parseHello(controller.hello())
  );
  const start = JSON.stringify(host.start(options.hostView ?? fingerprints));
  const response = JSON.stringify(
    controller.respond(start, options.controllerView ?? fingerprints)
  );
  return { host, controller, start, response };
}

test('the same password over the same connection verifies both sides', () => {
  const { host, controller, response } = exchange();
  const confirm = JSON.stringify(host.finish(response));
  assert.doesNotThrow(() => controller.confirm(confirm));
});

test('a controller that does not know the password is refused', () => {
  const { host } = exchange();
  const wrong = exchange({ controllerPassword: 'Ab3dE6gh' });
  assert.throws(() => wrong.host.finish(wrong.response), /prove the password/);
  // Nothing about the password is learned from a fresh refusal either.
  assert.throws(() => host.finish(wrong.response), /prove the password/);
});

test('a host that does not know the password cannot confirm itself', () => {
  const { controller, host, response } = exchange({ hostPassword: 'other' });
  assert.throws(() => host.finish(response));
  const genuine = exchange();
  const confirm = JSON.stringify(genuine.host.finish(genuine.response));
  // A confirmation from another session does not verify this one.
  assert.throws(() => controller.confirm(confirm), /prove the password/);
});

test('substituted DTLS fingerprints make the exchange fail', () => {
  // The signaling server answered each side with its own certificate.
  const relay = exchange({
    hostView: { host: `sha-256 ${HOST}`, controller: `sha-256 ${ATTACKER}` },
    controllerView: {
      host: `sha-256 ${ATTACKER}`,
      controller: `sha-256 ${CONTROLLER}`,
    },
  });
  assert.throws(() => relay.host.finish(relay.response), /prove the password/);
  const swapped = exchange({
    controllerView: {
      host: fingerprints.controller,
      controller: fingerprints.host,
    },
  });
  assert.throws(() => swapped.host.finish(swapped.response));
  const device = exchange({ controllerDevice: 'other-code' });
  assert.throws(() => device.host.finish(device.response));
});

test('replayed and repeated messages are refused', () => {
  const first = exchange();
  first.host.finish(first.response);
  // One response per attempt, even the correct one.
  assert.throws(() => first.host.finish(first.response));
  // A response recorded from another session does not open a new one.
  const second = exchange();
  assert.throws(() => second.host.finish(first.response), /prove the password/);
  // A controller answers one start only.
  assert.throws(() => first.controller.respond(first.start, fingerprints));
  // The host's own share reflected back is refused.
  const third = exchange();
  const reflected = {
    ...JSON.parse(third.response),
    share: JSON.parse(third.start).share,
  };
  assert.throws(
    () => third.host.finish(JSON.stringify(reflected)),
    /Reflected/
  );
});

test('malformed messages and unsupported versions are refused', () => {
  const hello = new ControllerHandshake('pw', 'host').hello();
  assert.deepEqual(parseHello(hello), hello);
  [
    undefined,
    {},
    { ...hello, versions: [2] },
    { ...hello, versions: [] },
    { ...hello, versions: '1' },
    { ...hello, nonce: 'abc' },
    { ...hello, nonce: hello.nonce.toUpperCase() },
  ].forEach((bad) => assert.throws(() => parseHello(bad)));
  const response = exchange().response;
  [
    (value) => ({ ...value, type: 'confirm' }),
    (value) => ({ ...value, share: value.share.slice(2) }),
    (value) => ({ ...value, share: '00'.repeat(32) }),
    (value) => ({ ...value, confirm: value.confirm.toUpperCase() }),
    (value) => ({ ...value, padding: 'x'.repeat(2048) }),
  ].forEach((mutate) => {
    const { host } = exchange();
    assert.throws(() =>
      host.finish(JSON.stringify(mutate(JSON.parse(response))))
    );
  });
  const { host } = exchange();
  assert.throws(() => host.finish('not json'));
  const controller = new ControllerHandshake('pw', 'host');
  assert.throws(() =>
    controller.respond(
      JSON.stringify({
        type: 'start',
        version: 2,
        nonce: '00'.repeat(16),
        share: '00'.repeat(32),
      }),
      fingerprints
    )
  );
});

// In-memory WebRTC: each side sees the other's certificate in its SDP, unless
// a test makes the signaling server substitute one.
class FakeChannel extends EventTarget {
  constructor(label) {
    super();
    this.label = label;
    this.readyState = 'connecting';
    this.sent = [];
  }

  send(data) {
    if (this.readyState !== 'open') throw new Error('closed');
    this.sent.push(data);
    const { peer } = this;
    setImmediate(() => {
      if (peer.readyState === 'open')
        peer.dispatchEvent(new MessageEvent('message', { data }));
    });
  }

  close() {
    [this, this.peer].forEach((channel) => {
      if (channel.readyState === 'closed') return;
      channel.readyState = 'closed';
      setImmediate(() => channel.dispatchEvent(new Event('close')));
    });
  }
}

class FakeConnection extends EventTarget {
  signalingState = 'stable';

  createDataChannel(label) {
    const local = new FakeChannel(label);
    const remote = new FakeChannel(label);
    local.peer = remote;
    remote.peer = local;
    setImmediate(() => {
      local.readyState = 'open';
      remote.readyState = 'open';
      this.remote.dispatchEvent(
        Object.assign(new Event('datachannel'), { channel: remote })
      );
      local.dispatchEvent(new Event('open'));
    });
    return local;
  }
}

function pair({ hostSees = CONTROLLER, controllerSees = HOST } = {}) {
  const host = new FakeConnection();
  const controller = new FakeConnection();
  host.remote = controller;
  controller.remote = host;
  host.currentLocalDescription = { sdp: sdp(HOST) };
  host.currentRemoteDescription = { sdp: sdp(hostSees) };
  controller.currentLocalDescription = { sdp: sdp(CONTROLLER) };
  controller.currentRemoteDescription = { sdp: sdp(controllerSees) };
  return { host, controller };
}

function session(t, options = {}) {
  const { host, controller } = pair(options);
  const events = { host: [], controller: [], sent: [] };
  let password = options.hostPassword ?? 'Ab3dE6gH';
  const verifier = verifyController({
    connection: host,
    device: 'host-code',
    password: () => password,
    limiter: options.limiter ?? new GuessLimiter(),
    verifyTimeout: options.verifyTimeout ?? 1000,
    onVerified: () => events.host.push('verified'),
    onRejected: (reason) => events.host.push(reason),
  });
  const outgoing = controller.createDataChannel('MessageChannel');
  const reader = controller.createDataChannel('SessionReader');
  const send = (message) => {
    events.sent.push(message.msgType);
    outgoing.send(JSON.stringify(message));
  };
  const client =
    options.client === false
      ? undefined
      : new HostAuthentication({
          connection: controller,
          outgoing,
          device: options.device ?? 'host-code',
          password: options.controllerPassword ?? 'Ab3dE6gH',
          send: options.send ?? send,
          probe: options.probe,
          legacyTimeout: options.legacyTimeout ?? 1000,
          onChange: (state) => events.controller.push(state),
        });
  t.after(() => {
    verifier.dispose();
    client?.dispose();
  });
  return {
    host,
    controller,
    verifier,
    client,
    outgoing,
    reader,
    events,
    setPassword: (value) => {
      password = value;
    },
  };
}

async function until(condition, ms = 2000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await delay(5);
  }
}

test('a controller with the password is verified over its own connection', async (t) => {
  const s = session(t);
  await until(() => s.events.host.length && s.events.controller.length);
  assert.deepEqual(s.events.host, ['verified']);
  assert.deepEqual(s.events.controller, ['verified']);
  assert.equal(controllerVerified(s.host), true);
  assert.equal(controllerVerified(s.controller), false);
  assert.equal(s.events.sent[0], 'remoteAuthHello');
  assert.equal(verifyController({ connection: s.host }), s.verifier);
});

test('a controller admitted without the password stays unverified and is refused', async (t) => {
  const limiter = new GuessLimiter(2, 60000);
  const s = session(t, { controllerPassword: 'wrong-password', limiter });
  // It asks for input and transcripts while the exchange is running.
  s.outgoing.addEventListener('open', () =>
    setImmediate(() =>
      s.outgoing.send(
        JSON.stringify({ msgType: 'billdDeskBehavior', data: {} })
      )
    )
  );
  await until(() => s.events.host.length && s.events.controller.length);
  assert.deepEqual(s.events.host, ['failed']);
  assert.deepEqual(s.events.controller, ['failed']);
  assert.equal(controllerVerified(s.host), false);
  assert.equal(limiter.locked, false);
  limiter.fail();
  // The next attempt is refused before any exchange while the host is locked.
  const next = session(t, { limiter });
  await until(() => next.events.host.length);
  assert.deepEqual(next.events.host, ['limited']);
  assert.equal(controllerVerified(next.host), false);
});

test('a signaling server that substitutes certificates cannot relay a verification', async (t) => {
  const s = session(t, { hostSees: ATTACKER, controllerSees: ATTACKER });
  await until(() => s.events.host.length && s.events.controller.length);
  assert.deepEqual(s.events.host, ['failed']);
  assert.equal(controllerVerified(s.host), false);
});

test('a controller that never speaks the protocol is refused', async (t) => {
  // Older controllers ask for content straight away.
  const legacy = session(t, { client: false });
  legacy.reader.addEventListener('open', () =>
    legacy.reader.send(
      JSON.stringify({ type: 'request', id: '1', request: { method: 'list' } })
    )
  );
  await until(() => legacy.events.host.length);
  assert.deepEqual(legacy.events.host, ['legacy']);
  // A silent controller times out without being verified.
  const silent = session(t, { client: false, verifyTimeout: 30 });
  silent.outgoing.addEventListener('open', () =>
    silent.outgoing.send(
      JSON.stringify({ msgType: 'remoteControllerState', data: {} })
    )
  );
  await delay(80);
  assert.deepEqual(silent.events.host, ['aborted']);
  assert.equal(controllerVerified(silent.host), false);
});

test('a password changed during the exchange does not admit the controller', async (t) => {
  const s = session(t);
  s.controller.addEventListener('datachannel', ({ channel }) =>
    channel.addEventListener('message', () => s.setPassword('Zz9yX8wV'), {
      once: true,
    })
  );
  await until(() => s.events.host.length && s.events.controller.length);
  assert.deepEqual(s.events.host, ['aborted']);
  assert.deepEqual(s.events.controller, ['failed']);
  assert.equal(controllerVerified(s.host), false);
});

test('renegotiating to another certificate revokes a verified controller', async (t) => {
  const s = session(t);
  await until(() => controllerVerified(s.host));
  s.host.dispatchEvent(new Event('signalingstatechange'));
  assert.equal(controllerVerified(s.host), true);
  s.host.currentRemoteDescription = { sdp: sdp(ATTACKER) };
  s.host.dispatchEvent(new Event('signalingstatechange'));
  assert.equal(controllerVerified(s.host), false);
  assert.deepEqual(s.events.host, ['verified', 'failed']);
});

test('a controller takes a host without verification as legacy', async (t) => {
  const { controller } = pair();
  const outgoing = controller.createDataChannel('MessageChannel');
  const states = [];
  const sent = [];
  const client = new HostAuthentication({
    connection: controller,
    outgoing,
    device: 'host-code',
    password: 'Ab3dE6gH',
    send: (message) => sent.push(message.msgType),
    // An older host answers the presence probe instead of verifying.
    probe: () => setImmediate(() => client.hostAnswered()),
    onChange: (state) => states.push(state),
  });
  t.after(() => client.dispose());
  await until(() => states.length);
  assert.deepEqual(states, ['legacy']);
  assert.deepEqual(sent, ['remoteAuthHello']);
  // A host that does not answer at all is also taken as legacy, after a while.
  const quiet = pair();
  const later = [];
  const silent = new HostAuthentication({
    connection: quiet.controller,
    outgoing: quiet.controller.createDataChannel('MessageChannel'),
    device: 'host-code',
    password: 'Ab3dE6gH',
    send() {},
    legacyTimeout: 20,
    onChange: (state) => later.push(state),
  });
  t.after(() => silent.dispose());
  await until(() => later.length);
  assert.deepEqual(later, ['legacy']);
});

test('the host stops accepting proofs after repeated failures', async (t) => {
  let now = 0;
  const limiter = new GuessLimiter(3, 1000, () => now);
  limiter.fail();
  limiter.fail();
  assert.equal(limiter.locked, false);
  limiter.fail();
  assert.equal(limiter.locked, true);
  now = 1001;
  assert.equal(limiter.locked, false);
  const s = session(t, { limiter });
  await until(() => s.events.host.length);
  assert.deepEqual(s.events.host, ['verified']);
});

test('the verification channel is opened by the host only', async (t) => {
  const s = session(t, { client: false });
  await tick();
  await tick();
  // Without a hello the host opens nothing a legacy controller could misread.
  assert.equal(s.verifier.verified, false);
  const labels = [];
  s.controller.addEventListener('datachannel', ({ channel }) =>
    labels.push(channel.label)
  );
  s.outgoing.send(
    JSON.stringify({
      msgType: 'remoteAuthHello',
      data: new ControllerHandshake('pw', 'host-code').hello(),
    })
  );
  await until(() => labels.length);
  assert.deepEqual(labels, [CONTROLLER_AUTH_CHANNEL]);
});
