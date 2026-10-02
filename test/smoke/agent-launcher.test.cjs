/* eslint-disable require-await, no-restricted-syntax, no-plusplus, global-require */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const load = require('./load-source.cjs');

const { AgentLauncher, windowsAgentTargets } = load(
  'electron-main/agent-launcher.ts'
);
const { runAgentLaunch } = load('src/utils/agent-launch-request.ts');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('macOS catalog exposes only known installed identities, and launch resolves again', async () => {
  let installed = ['com.openai.codex', 'com.apple.Terminal'];
  const calls = [];
  const native = {
    async request(command, target, current) {
      calls.push({ command, target });
      if (command === 'installedAgents') return installed;
      assert.equal(current(), true);
    },
  };
  const launcher = new AgentLauncher(native, 'darwin');
  assert.deepEqual(await launcher.list(), {
    supported: true,
    agents: [{ id: 'codex', name: 'Codex' }],
    message: '',
  });
  await launcher.launch('codex', 'op-1');
  assert.deepEqual(calls.at(-1), {
    command: 'launchAgent',
    target: { bundleId: 'com.openai.codex' },
  });
  installed = [];
  await assert.rejects(launcher.launch('codex', 'op-2'), /未找到/);
  assert.equal(
    calls.filter((item) => item.command === 'launchAgent').length,
    1
  );
});

test('rejects arbitrary IDs, paths and malformed operations before native work', async () => {
  const launcher = new AgentLauncher(
    {
      request() {
        throw new Error('must not run');
      },
    },
    'darwin'
  );
  for (const id of [
    'com.apple.Terminal',
    '/Applications/Codex.app',
    { id: 'codex' },
    'cmd.exe',
  ]) {
    await assert.rejects(launcher.launch(id, 'valid'), /无效/);
  }
  await assert.rejects(launcher.launch('codex', '../bad'), /无效/);
});

test('duplicate launches are blocked and disconnect during discovery prevents dispatch', async () => {
  const discovery = deferred();
  let starts = 0;
  const launcher = new AgentLauncher(
    {
      request(command) {
        if (command === 'installedAgents') return discovery.promise;
        starts += 1;
      },
    },
    'darwin'
  );
  const first = launcher.launch('codex', 'first');
  await assert.rejects(launcher.launch('claude', 'second'), /正在打开/);
  launcher.cancel('unrelated');
  launcher.cancel('first');
  discovery.resolve(['com.openai.codex']);
  await assert.rejects(first, /取消/);
  assert.equal(starts, 0);
});

test('a queued native launch rechecks cancellation immediately before OS dispatch', async () => {
  const queued = deferred();
  const reached = deferred();
  let starts = 0;
  const launcher = new AgentLauncher(
    {
      async request(command, _target, current) {
        if (command === 'installedAgents') return ['com.openai.codex'];
        reached.resolve();
        await queued.promise;
        if (!current()) throw new Error('cancelled');
        starts += 1;
      },
    },
    'darwin'
  );
  const result = launcher.launch('codex', 'queued');
  await reached.promise;
  launcher.cancel('queued');
  queued.resolve();
  await assert.rejects(result, /cancelled/);
  assert.equal(starts, 0);
});

test('Windows catalog accepts registered executable identities and packaged app IDs only', () => {
  assert.deepEqual(
    windowsAgentTargets([
      {
        executable: 'C:\\Program Files\\Codex\\Codex.exe',
        appId: 'OpenAI.Codex_123!App',
      },
      { executable: 'C:\\Apps\\Claude.exe' },
      { executable: 'C:\\Apps\\not-chatgpt.exe', name: 'ChatGPT' },
      { executable: 'C:\\Apps\\kimi.exe', appId: 'unsafe!app & cmd.exe' },
      { executable: '\\\\server\\share\\zcode.exe' },
      { executable: 'zcode.exe' },
    ]),
    [
      {
        id: 'codex',
        executable: 'C:\\Program Files\\Codex\\Codex.exe',
        appId: 'OpenAI.Codex_123!App',
      },
      { id: 'claude', executable: 'C:\\Apps\\Claude.exe', appId: undefined },
    ]
  );
});

test('Windows re-resolves local paths, never exposes them, and resets after launch failure', async () => {
  const target = { executable: 'C:\\Apps\\Codex.exe' };
  let reads = 0;
  let attempts = 0;
  const launcher = new AgentLauncher(
    {},
    'win32',
    async () => {
      reads += 1;
      return [target];
    },
    async (resolved, current) => {
      assert.equal(resolved.executable, target.executable);
      assert.equal(current(), true);
      if (++attempts === 1) throw new Error('OS launch failed');
    }
  );
  assert.deepEqual((await launcher.list()).agents, [
    { id: 'codex', name: 'Codex' },
  ]);
  target.executable = 'C:\\New Location\\Codex.exe';
  await assert.rejects(launcher.launch('codex', 'one'), /OS launch failed/);
  await launcher.launch('codex', 'two');
  assert.equal(reads, 3);
});

test('Windows launch uses a fixed argument array without a shell, and cancels after file validation', async () => {
  const calls = [];
  const checking = deferred();
  const { AgentLauncher: FakeLauncher } = load(
    'electron-main/agent-launcher.ts',
    {
      'node:fs/promises': {
        stat: async () => {
          await checking.promise;
          return { isFile: () => true };
        },
      },
      'node:child_process': {
        execFile: require('node:child_process').execFile,
        spawn: (...args) => {
          calls.push(args);
          const child = new EventEmitter();
          child.unref = () => {};
          queueMicrotask(() => child.emit('spawn'));
          return child;
        },
      },
    }
  );
  const target = {
    executable: 'C:\\Program Files\\Codex\\Codex.exe',
    appId: 'OpenAI.Codex_123!App',
  };
  const launcher = new FakeLauncher({}, 'win32', async () => [target]);
  const cancelled = launcher.launch('codex', 'cancelled');
  await new Promise((resolve) => setImmediate(resolve));
  launcher.cancel('cancelled');
  checking.resolve();
  await assert.rejects(cancelled, /取消/);
  assert.equal(calls.length, 0);
  await launcher.launch('codex', 'package');
  assert.match(calls[0][0], /\\explorer\.exe$/i);
  assert.deepEqual(calls[0][1], ['shell:AppsFolder\\OpenAI.Codex_123!App']);
  assert.equal(calls[0][2].shell, false);
  delete target.appId;
  await launcher.launch('codex', 'desktop');
  assert.equal(calls[1][0], target.executable);
  assert.deepEqual(calls[1][1], []);
});

test('unsupported platforms expose a reason and cannot launch', async () => {
  const launcher = new AgentLauncher({}, 'linux');
  const result = await launcher.list();
  assert.equal(result.supported, false);
  assert.equal(result.agents.length, 0);
  assert.match(result.message, /不支持/);
  await assert.rejects(launcher.launch('codex', 'one'), /未找到/);
});

test('launch request rejects unauthenticated or replaced peers and cancels pending work', async () => {
  let active = false;
  let started = 0;
  let cancelled = 0;
  const pending = deferred();
  const launch = async () => {
    started += 1;
    await pending.promise;
  };
  await assert.rejects(
    runAgentLaunch(
      'codex',
      'one',
      () => active,
      launch,
      () => cancelled++
    ),
    /连接/
  );
  assert.equal(started, 0);
  active = true;
  const result = runAgentLaunch(
    'codex',
    'two',
    () => active,
    launch,
    () => {
      cancelled += 1;
      pending.resolve();
    }
  );
  active = false;
  await assert.rejects(result, /连接/);
  assert.equal(started, 1);
  assert.ok(cancelled >= 1);
});

test('catalog reads share one scan across peers and refresh after expiry', async () => {
  let now = 1000;
  let reads = 0;
  const pending = deferred();
  const launcher = new AgentLauncher(
    {},
    'win32',
    async () => {
      reads += 1;
      return pending.promise;
    },
    undefined,
    () => now
  );
  const first = launcher.list();
  const second = launcher.list();
  assert.equal(reads, 1);
  pending.resolve([{ executable: 'C:\\Apps\\Codex.exe' }]);
  assert.deepEqual(await first, await second);
  await launcher.list();
  assert.equal(reads, 1);
  now += 30001;
  await launcher.list();
  assert.equal(reads, 2);
});

test('cached catalog never authorizes a removed launch target and failed scans can retry', async () => {
  let reads = 0;
  let installed = [{ executable: 'C:\\Apps\\Codex.exe' }];
  const launcher = new AgentLauncher(
    {},
    'win32',
    async () => {
      reads += 1;
      if (reads === 1) throw new Error('temporary discovery failure');
      return installed;
    },
    () => assert.fail('must not launch a removed app')
  );
  await assert.rejects(launcher.list(), /temporary discovery failure/);
  assert.equal((await launcher.list()).agents[0].id, 'codex');
  installed = [];
  assert.equal((await launcher.list()).agents[0].id, 'codex');
  await assert.rejects(launcher.launch('codex', 'removed'), /未找到/);
  assert.equal(reads, 3);
});
