const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-source.cjs');
const { identifyAgent } = load('src/utils/agent-registry.ts');
const { discoverAgents } = load('electron-main/native-window.ts');
const { buildAgentDirectory } = load('src/utils/agent-directory.ts');
const { WindowCatalog } = load('src/utils/window-catalog.ts');

const source = (extra = {}) => ({
  id: 'window:10:0',
  nativeId: 10,
  ownerPid: 42,
  bundleId: 'com.apple.Terminal',
  appName: 'Terminal',
  name: 'Codex',
  thumbnail: '',
  appIcon: '',
  isOnScreen: true,
  ...extra,
});

test('application discovery groups running instances and admits applications without windows', () => {
  assert.deepEqual(
    discoverAgents([
      { bundleId: 'com.openai.codex', ownerPid: 10 },
      { bundleId: 'com.openai.codex', ownerPid: 11 },
      { bundleId: 'com.apple.Terminal', appName: 'Claude', ownerPid: 12 },
      { bundleId: 'win32:c:\\apps\\KIMI.EXE#1a2', ownerPid: 13 },
    ]),
    [
      { id: 'codex', name: 'Codex' },
      { id: 'kimi', name: 'Kimi' },
    ]
  );
  assert.equal(identifyAgent('win32:c:\\apps\\not-codex.exe#123'), undefined);
  assert.equal(identifyAgent('win32:c:\\apps\\codex.exe'), undefined);
});

test('directory preserves multiple windows and never treats a title as an agent identity', () => {
  const catalog = new WindowCatalog();
  const windows = catalog.update([
    source(),
    source({ id: 'window:11:0', nativeId: 11, bundleId: 'com.openai.codex' }),
    source({ id: 'window:12:0', nativeId: 12, bundleId: 'com.openai.codex' }),
  ]);
  const directory = buildAgentDirectory(
    [{ id: 'kimi', name: 'Kimi' }],
    windows,
    {}
  );
  assert.deepEqual(
    directory.agents.map(({ id, windows }) => [id, windows.length]),
    [
      ['codex', 2],
      ['kimi', 0],
    ]
  );
  assert.equal(directory.otherWindows[0].id, windows[0].id);
  assert.equal(directory.agents[1].discovered, true);
});

test('manual terminal association survives refresh but does not transfer to replacement windows', () => {
  const catalog = new WindowCatalog();
  const [first] = catalog.update([source()]);
  const bindings = { [first.contextId]: 'claude' };
  const [refreshed] = catalog.update([
    source({ name: 'A changed terminal title' }),
  ]);
  assert.equal(refreshed.contextId, first.contextId);
  assert.notEqual(refreshed.id, first.id);
  assert.throws(() => catalog.get(first.id));
  assert.equal(
    buildAgentDirectory([], [refreshed], bindings).agents[0].discovered,
    false
  );
  const [replacement] = catalog.update([source({ ownerPid: 43 })]);
  assert.notEqual(replacement.contextId, first.contextId);
  assert.equal(
    buildAgentDirectory([], [replacement], bindings).agents.length,
    0
  );
  catalog.update([]);
  const [reopened] = catalog.update([source()]);
  assert.notEqual(reopened.contextId, first.contextId);
});

test('native classification takes precedence over a manual association and contexts are peer scoped', () => {
  const first = new WindowCatalog();
  const second = new WindowCatalog();
  const [window] = first.update([source({ bundleId: 'com.openai.codex' })]);
  const [other] = second.update([source({ bundleId: 'com.openai.codex' })]);
  assert.notEqual(window.contextId, other.contextId);
  const result = buildAgentDirectory([], [window], {
    [window.contextId]: 'claude',
  });
  assert.equal(result.agents[0].id, 'codex');
  assert.equal(result.agents.length, 1);
  assert.throws(() => second.get(window.id));
});
