import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function forceRelay(context, transport) {
  assert.ok(
    ['udp', 'tcp', 'tls', 'all'].includes(transport),
    'SMOKE_RELAY_TRANSPORT must be udp, tcp, tls or all'
  );
  await context.addInitScript((mode) => {
    const NativePeerConnection = window.RTCPeerConnection;
    window.__relayPeers = [];
    window.__relayErrors = [];
    const configuration = (config = {}) => ({
      ...config,
      iceTransportPolicy: 'relay',
      iceServers: (config.iceServers || []).flatMap((server) => {
        const urls = (
          Array.isArray(server.urls) ? server.urls : [server.urls]
        ).filter((value) => {
          if (mode === 'all') return true;
          const url = new URL(value.replace(/^(turns?):/, '$1://'));
          return mode !== 'tls'
            ? url.protocol === 'turn:' &&
                url.port === '3478' &&
                url.searchParams.get('transport') === mode
            : url.protocol === 'turns:' &&
                url.hostname === 'turn.cloudflare.com' &&
                url.port === '443';
        });
        return urls.length ? [{ ...server, urls }] : [];
      }),
    });
    // Keep real WebRTC and application negotiation; constrain only the transport.
    window.RTCPeerConnection = class extends NativePeerConnection {
      constructor(config) {
        super(configuration(config));
        window.__relayPeers.push(this);
        this.addEventListener('icecandidateerror', (event) => {
          window.__relayErrors.push({
            url: event.url,
            code: event.errorCode,
            text: event.errorText,
          });
        });
      }
      setConfiguration(config) {
        super.setConfiguration(configuration(config));
      }
    };
  }, transport);
}

async function snapshot(page, baseline = false) {
  return page.evaluate(async (reset) => {
    const { useNetworkStore } = await import('/src/store/network/index.ts');
    const rtc = [...useNetworkStore().rtcMap.values()].find(
      (item) => !item.closed
    );
    const pc = rtc?.peerConnection;
    if (!pc) return { missing: true };
    const config = rtc.remoteConnection.session.config;
    const credential = JSON.stringify(
      pc.getConfiguration().iceServers.map((server) => server.username)
    );
    const ufrag = pc.localDescription?.sdp.match(/^a=ice-ufrag:(.+)$/m)?.[1];
    if (reset)
      window.__turnBaseline = {
        credential,
        ufrag,
        expiresAt: config.expiresAt,
      };
    const stats = await pc.getStats();
    const transport = [...stats.values()].find(
      (item) => item.type === 'transport' && item.selectedCandidatePairId
    );
    const pair = stats.get(transport?.selectedCandidatePairId);
    const candidate = (id) => {
      const value = stats.get(id);
      if (!value) return null;
      return {
        type: value.candidateType,
        protocol: value.protocol,
        relayProtocol: value.relayProtocol,
        url: value.url,
      };
    };
    return {
      sampledAt: Date.now(),
      policy: pc.getConfiguration().iceTransportPolicy,
      iceState: pc.iceConnectionState,
      signalingState: pc.signalingState,
      expiresAt: config.expiresAt,
      refreshAfter: config.refreshAfter,
      credentialsChanged: credential !== window.__turnBaseline?.credential,
      iceRestarted: ufrag !== window.__turnBaseline?.ufrag,
      local: candidate(pair?.localCandidateId),
      remote: candidate(pair?.remoteCandidateId),
      bytesSent: transport?.bytesSent,
      bytesReceived: transport?.bytesReceived,
      framesDecoded: [...stats.values()]
        .filter((item) => item.type === 'inbound-rtp' && item.kind === 'video')
        .reduce((total, item) => total + (item.framesDecoded || 0), 0),
    };
  }, baseline);
}

export async function relayDiagnostics(page) {
  return page.evaluate(async () => ({
    errors: window.__relayErrors || [],
    peers: await Promise.all(
      (window.__relayPeers || []).map(async (pc) => {
        const stats = await pc.getStats();
        return {
          policy: pc.getConfiguration().iceTransportPolicy,
          urls: pc
            .getConfiguration()
            .iceServers.flatMap((server) => server.urls),
          connectionState: pc.connectionState,
          iceState: pc.iceConnectionState,
          signalingState: pc.signalingState,
          candidates: [...stats.values()]
            .filter(
              (item) =>
                item.type === 'local-candidate' ||
                item.type === 'remote-candidate'
            )
            .map((item) => ({
              type: item.type,
              candidateType: item.candidateType,
              protocol: item.protocol,
              relayProtocol: item.relayProtocol,
              url: item.url,
            })),
          pairs: [...stats.values()]
            .filter((item) => item.type === 'candidate-pair')
            .map((item) => ({
              state: item.state,
              nominated: item.nominated,
              bytesSent: item.bytesSent,
              bytesReceived: item.bytesReceived,
            })),
        };
      })
    ),
  }));
}

function assertRelay(state, transport) {
  assert.equal(state.missing, undefined, 'Business peer must remain present');
  assert.equal(state.policy, 'relay');
  assert.ok(
    ['connected', 'completed'].includes(state.iceState),
    `ICE state: ${state.iceState}`
  );
  assert.equal(state.local?.type, 'relay');
  assert.equal(state.remote?.type, 'relay');
  if (transport === 'all') {
    assert.ok(['udp', 'tcp', 'tls'].includes(state.local.relayProtocol));
    return;
  }
  assert.equal(state.local.relayProtocol, transport);
  if (transport === 'tls')
    assert.equal(
      state.local.url,
      'turns:turn.cloudflare.com:443?transport=tcp'
    );
  else {
    const url = new URL(state.local.url.replace(/^turn:/, 'turn://'));
    assert.equal(url.protocol, 'turn:');
    assert.equal(url.port, '3478');
    assert.equal(url.searchParams.get('transport'), transport);
  }
}

export async function exerciseRelay({
  host,
  phone,
  transport,
  artifacts,
  pass,
  soak,
}) {
  const samples = [];
  const record = async (baseline = false) => {
    const hostState = await snapshot(host, baseline);
    const phoneState = await snapshot(phone, baseline);
    assertRelay(hostState, transport);
    assertRelay(phoneState, transport);
    const sample = { host: hostState, phone: phoneState };
    samples.push(sample);
    await writeFile(
      path.join(artifacts, 'turn-relay.json'),
      JSON.stringify({ transport, soak, samples }, null, 2)
    );
    return sample;
  };
  const unauthorized = await phone.evaluate(
    async () =>
      (await fetch('/api/webrtc/ice-servers', { method: 'POST' })).status
  );
  assert.equal(unauthorized, 401);
  const initial = await record(true);
  await phone.waitForTimeout(2000);
  const flowing = await record();
  assert.ok(flowing.phone.framesDecoded > initial.phone.framesDecoded);
  assert.ok(flowing.phone.bytesReceived > initial.phone.bytesReceived);
  pass(
    `forced ${transport} TURN uses relay candidates at both ends and decodes advancing video`
  );
  if (soak) {
    const finishAt =
      Math.max(initial.host.expiresAt, initial.phone.expiresAt) + 15000;
    assert.ok(
      finishAt - Date.now() < 720000,
      'Use SMOKE_TURN_TTL=600 for the renewal soak'
    );
    let previous = flowing;
    while (Date.now() < finishAt) {
      await phone.waitForTimeout(Math.min(15000, finishAt - Date.now()));
      const current = await record();
      assert.ok(
        current.phone.framesDecoded > previous.phone.framesDecoded,
        'Video must keep decoding during renewal'
      );
      assert.ok(
        current.phone.bytesReceived > previous.phone.bytesReceived,
        'Relay traffic must keep flowing during renewal'
      );
      previous = current;
      console.log(
        `TURN ${transport} soak: ${Math.max(0, Math.ceil((finishAt - Date.now()) / 1000))}s remaining, frames=${current.phone.framesDecoded}, renewed=${current.host.credentialsChanged && current.phone.credentialsChanged}`
      );
    }
    for (const side of ['host', 'phone']) {
      assert.ok(previous[side].expiresAt > initial[side].expiresAt);
      assert.equal(previous[side].credentialsChanged, true);
      assert.equal(previous[side].iceRestarted, true);
    }
    pass(
      `automatic ${transport} credential renewal and ICE restart keep video flowing beyond both original expirations`
    );
  }
  const text = `TURN ${transport} ${soak ? 'renewed' : 'connected'}`;
  await phone.getByLabel('发送到电脑的文字').fill(text);
  await phone.getByLabel('发送文字', { exact: true }).click();
  await host.waitForFunction(
    (value) =>
      window.__smoke.inputs.some(
        (input) => input.action === 'text' && input.text === value
      ),
    text
  );
  pass(
    `real business input crosses the ${transport} relay${soak ? ' after the original credentials expired' : ''}`
  );
  // Leave the existing business input assertions with their original baseline.
  await host.evaluate(() => {
    window.__smoke.inputs = [];
  });
}
