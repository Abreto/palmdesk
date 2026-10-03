const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ts = require('typescript');

const load = require('./load-source.cjs');

const { WsMsgTypeEnum: M } = load('src/types/websocket.ts');
const { IPC_EVENT } = load('src/event.ts');
const { WindowCatalog } = load('src/utils/window-catalog.ts');

function host() {
  // Exercise the production request handler with the real window catalog.
  // Replace only Electron IPC and the authenticated peer transport.
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/views/remote/index.vue'),
    'utf8'
  );
  const begin = source.indexOf('async function handleWindowRequest(');
  const end = source.indexOf('\nfunction changeDebugUrl()', begin);
  assert.ok(begin >= 0 && end > begin);
  const handler = ts.transpileModule(source.slice(begin, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let resolveInstalled;
  const installed = new Promise((resolve) => {
    resolveInstalled = resolve;
  });
  const replies = [];
  const calls = [];
  const channel = { readyState: 'open' };
  const peer = {
    receiver: 'phone',
    cbDataChannel: channel,
    dataChannelSend: (message) => replies.push(message),
  };
  const rtcMap = new Map([['phone', peer]]);
  const context = vm.createContext({
    WsMsgTypeEnum: M,
    IPC_EVENT,
    disposed: false,
    stoppedPeers: new WeakSet(),
    appStore: { remoteDesk: new Map([['phone', { isClose: false }]]) },
    networkStore: { rtcMap },
    listingPeers: new Set(),
    windowCatalogs: new Map(),
    captureSources: { value: [] },
    WindowCatalog,
    invokeCapture: (name) => {
      calls.push(name);
      if (name === IPC_EVENT.getInstalledAgents) return installed;
      if (name === IPC_EVENT.getAgentApplications)
        return Promise.resolve({ code: 0, data: { agents: [] } });
      if (name === IPC_EVENT.getCaptureSources)
        return Promise.resolve({
          code: 0,
          data: {
            sources: [
              {
                id: 'window:1:0',
                ownerPid: 2,
                nativeId: 1,
                bundleId: 'com.openai.codex',
                name: 'Codex window',
                appName: 'Codex',
                thumbnail: '',
                appIcon: '',
                isOnScreen: true,
              },
            ],
          },
        });
      assert.fail(`unexpected IPC ${name}`);
    },
  });
  const handle = vm.runInContext(`${handler}\nhandleWindowRequest`, context);
  return {
    peer,
    replies,
    calls,
    rtcMap,
    resolveInstalled,
    handle: (msgType, requestId) =>
      handle(peer, {
        msgType,
        requestId,
        data: { agentDiscovery: true },
      }),
  };
}

test('window results and selection catalog are available while installed discovery is pending', async () => {
  const fixture = host();
  const installed = fixture.handle(M.remoteInstalledAgentsRequest, 'installed');
  await fixture.handle(M.remoteWindowsRequest, 'windows');
  assert.deepEqual(fixture.calls, [
    IPC_EVENT.getInstalledAgents,
    IPC_EVENT.getAgentApplications,
    IPC_EVENT.getCaptureSources,
  ]);
  assert.ok(
    fixture.replies.some(
      (reply) =>
        reply.requestId === 'windows' && reply.data.source?.agentId === 'codex'
    )
  );
  assert.ok(
    fixture.replies.some(
      (reply) => reply.requestId === 'windows' && reply.data.done
    )
  );
  assert.equal(
    fixture.replies.some((reply) => reply.requestId === 'installed'),
    false
  );
  fixture.resolveInstalled({
    code: 0,
    data: { supported: true, agents: [{ id: 'codex' }] },
  });
  await installed;
  assert.equal(fixture.replies.at(-1).msgType, M.remoteInstalledAgentsResult);
});

test('installed discovery failure and a replaced peer do not affect window results', async () => {
  const fixture = host();
  const installed = fixture.handle(M.remoteInstalledAgentsRequest, 'installed');
  await fixture.handle(M.remoteWindowsRequest, 'windows');
  fixture.resolveInstalled({ code: 1 });
  await installed;
  assert.equal(fixture.replies.at(-1).data.supported, false);
  assert.ok(
    fixture.replies.some(
      (reply) =>
        reply.requestId === 'windows' && reply.data.done && !reply.data.error
    )
  );
  const stale = host();
  const pending = stale.handle(M.remoteInstalledAgentsRequest, 'old');
  stale.rtcMap.set('phone', { cbDataChannel: { readyState: 'open' } });
  stale.resolveInstalled({ code: 0, data: { supported: true, agents: [] } });
  await pending;
  assert.equal(stale.replies.length, 0);
});
