const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const test = require('node:test');

const load = require('./load-source.cjs');

const { createWorkerSessionReader } = load('electron-main/session-worker.ts');
const worker = path.join(__dirname, '../../session-core/worker.mjs');
const id = 'codex:session-file:44444444-4444-4444-8444-444444444444';

function directory(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'palmdesk session worker '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// A structurally realistic Codex log of about `megabytes` MiB.
function codexHome(root, megabytes) {
  const home = path.join(root, 'codex');
  const uuid = id.split(':').at(-1);
  const sessions = path.join(home, 'sessions/2026/10/21');
  mkdirSync(sessions, { recursive: true });
  const lines = [
    JSON.stringify({
      timestamp: '2026-10-21T08:00:00.000Z',
      type: 'session_meta',
      payload: { id: uuid, cwd: '/synthetic/project', source: 'codex-cli' },
    }),
  ];
  let bytes = lines[0].length;
  for (let turn = 0; bytes < megabytes * 1024 * 1024; turn += 1) {
    const timestamp = new Date(
      Date.UTC(2026, 9, 21, 8, 0, 0, turn)
    ).toISOString();
    const output = Array.from(
      { length: 12 },
      (_, line) => `src/module-${turn}.ts:${line}: "quoted" \\ 合成输出 ${line}`
    ).join('\n');
    [
      {
        type: 'event_msg',
        payload: { type: 'user_message', message: `检查第 ${turn} 个模块` },
      },
      {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell',
          arguments: JSON.stringify({
            command: ['bash', '-lc', `rg -n pattern_${turn} src`],
          }),
          call_id: `call_${turn}`,
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: `call_${turn}`,
          output,
        },
      },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: turn, output_tokens: 50 },
          },
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: `第 ${turn} 个模块测试通过。` },
          ],
        },
      },
    ].forEach((record) => {
      const line = JSON.stringify({ timestamp, ...record });
      lines.push(line);
      bytes += Buffer.byteLength(line) + 1;
    });
  }
  writeFileSync(
    path.join(sessions, `rollout-2026-10-21T08-00-00-${uuid}.jsonl`),
    `${lines.join('\n')}\n`
  );
  return home;
}

function fakeWorker(root, source) {
  const file = path.join(root, 'fake-worker.mjs');
  writeFileSync(
    file,
    `import { parentPort, workerData } from 'node:worker_threads';\n${source}`
  );
  return file;
}

test('a page from a 32 MiB log keeps the main thread responsive', async (t) => {
  const root = directory(t);
  const reader = createWorkerSessionReader(
    {
      codexHome: codexHome(root, 31),
      claudeConfigDir: path.join(root, 'none'),
      claudeDesktopDataDir: '',
    },
    worker
  );
  t.after(() => reader.close());
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  const page = await reader.read(id);
  delay.disable();
  assert.equal(page.items.length, 40);
  assert.equal(page.hasMore, true);
  assert.ok(delay.max / 1e6 < 50, `main thread blocked ${delay.max / 1e6} ms`);
  // Older pages and unchanged polls reuse the parsed log.
  const older = await reader.read(id, page.nextCursor);
  assert.equal(older.items.length, 40);
  assert.notEqual(older.items[0].id, page.items[0].id);
  assert.deepEqual(await reader.read(id), page);
});

test('requests reach the worker one at a time and keep their error messages', async (t) => {
  const root = directory(t);
  const file = fakeWorker(
    root,
    `let active = 0;
parentPort.on('message', ({ id, method, args }) => {
  active += 1;
  const overlap = active > 1;
  setTimeout(() => {
    active -= 1;
    if (method === 'list') parentPort.postMessage({ id, error: '会话已不存在，请刷新列表' });
    else parentPort.postMessage({ id, result: { overlap, args, options: workerData } });
  }, 20);
});`
  );
  const reader = createWorkerSessionReader({ codexHome: '/codex' }, file);
  t.after(() => reader.close());
  const pages = await Promise.all(
    ['a', 'b', 'c'].map((name) => reader.read(name))
  );
  pages.forEach((page, index) => {
    assert.equal(page.overlap, false);
    assert.deepEqual(page.args, [['a', 'b', 'c'][index], undefined]);
    assert.equal(page.options.codexHome, '/codex');
  });
  await assert.rejects(reader.list(), /会话已不存在，请刷新列表/);
});

test('a stuck request times out, close rejects waiting work, and a crash recovers', async (t) => {
  const root = directory(t);
  const file = fakeWorker(
    root,
    `parentPort.on('message', ({ id, args }) => {
  if (args[0] === 'crash') process.exit(1);
  if (args[0] !== 'hang') parentPort.postMessage({ id, result: { ok: args[0] } });
});`
  );
  const reader = createWorkerSessionReader({}, file, {
    request: 100,
    idle: 60_000,
  });
  await assert.rejects(reader.read('hang'), /超时/);
  assert.deepEqual(await reader.read('after timeout'), { ok: 'after timeout' });
  await assert.rejects(reader.read('crash'), /中断/);
  assert.deepEqual(await reader.read('after crash'), { ok: 'after crash' });
  const waiting = reader.read('hang');
  const queued = reader.read('queued');
  setTimeout(() => reader.close(), 20);
  await assert.rejects(waiting, /已关闭/);
  // Work queued behind a closed request starts a fresh worker.
  assert.deepEqual(await queued, { ok: 'queued' });
  reader.close();
});
