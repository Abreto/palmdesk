import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, truncate, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSessionReader } from '../index.mjs';
import { readSessionLines } from '../src/providers/session-file-io.mjs';

const uuid = '33333333-3333-4333-8333-333333333333';
const claudeId = `claude-code:session-file:${uuid}`;
const codexId = `codex:session-file:${uuid}`;
const timestamp = '2026-09-16T00:00:00.000Z';
const record = (value) => JSON.stringify({ sessionId: uuid, cwd: '/repo/claude-project', timestamp, ...value });
const message = (index, text = `Claude 消息 ${index}`) => record({
  type: index % 2 ? 'assistant' : 'user',
  uuid: `message-${index}`,
  parentUuid: index ? `message-${index - 1}` : null,
  message: { content: text, stop_reason: index % 2 ? 'end_turn' : null },
});

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'palmdesk-claude-reader-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const codexHome = path.join(directory, 'codex');
  const claudeConfigDir = path.join(directory, 'claude');
  const codexFile = path.join(codexHome, 'sessions', `rollout-${uuid}.jsonl`);
  const claudeFile = path.join(claudeConfigDir, 'projects', '-repo-claude-project', `${uuid}.jsonl`);
  await mkdir(path.dirname(codexFile), { recursive: true });
  await mkdir(path.dirname(claudeFile), { recursive: true });
  const reader = createSessionReader({ codexHome, claudeConfigDir, claudeDesktopDataDir: '' });
  return { directory, codexHome, claudeConfigDir, codexFile, claudeFile, reader };
}

test('mixed sessions sort and search together while identical UUIDs route to their own provider', async (t) => {
  const { reader, codexFile, claudeFile, directory } = await setup(t);
  await writeFile(codexFile, [
    JSON.stringify({ type: 'session_meta', timestamp, payload: { id: uuid, cwd: '/repo/codex-project' } }),
    JSON.stringify({ type: 'response_item', timestamp, payload: {
      type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Codex reply' }],
    } }),
  ].join('\n'));
  await writeFile(claudeFile, [
    record({ type: 'custom-title', customTitle: '改名后的 Claude 会话' }),
    record({ type: 'agent-name', agentName: 'Generated name' }),
    message(0), message(1, 'Claude reply'),
  ].join('\n'));
  await utimes(codexFile, new Date(timestamp), new Date(timestamp));
  await utimes(claudeFile, new Date(timestamp), new Date('2026-09-16T01:00:00Z'));

  const list = await reader.list();
  assert.deepEqual(list.sessions.map((s) => [s.id, s.providerId]), [[claudeId, 'claude-code'], [codexId, 'codex']]);
  assert.equal(list.total, 2);
  assert.equal(list.sessions[0].title, '改名后的 Claude 会话');
  for (const query of ['改名', 'claude-project', 'CLAUDE REPLY']) {
    assert.deepEqual((await reader.list(query)).sessions.map((s) => s.id), [claudeId]);
  }
  for (const [id, name] of [[claudeId, 'Claude'], [codexId, 'Codex']]) {
    const page = await reader.read(id);
    assert.equal(page.session.id, id);
    assert.equal(page.items.at(-1).text, `${name} reply`);
    assert.ok(!JSON.stringify(page).includes(directory));
    assert.equal(page.session.resumeRef, undefined);
  }
  for (const id of ['../../etc/passwd', `claude-code:session-file:../../${uuid}`, 'claude-code:process:123', `unknown:session-file:${uuid}`]) {
    await assert.rejects(reader.read(id), /无效/);
  }
  await assert.rejects(reader.read(claudeId, '-1'), /无效/);

  await rm(claudeFile);
  assert.deepEqual((await reader.list()).sessions.map((s) => s.id), [codexId]);
  await assert.rejects(reader.read(claudeId), /不存在/);
});

test('Claude pages preserve history and stable IDs while partial records finish writing', async (t) => {
  const { reader, claudeFile } = await setup(t);
  const messages = Array.from({ length: 85 }, (_, i) => message(i));
  await writeFile(claudeFile, [
    ...messages,
    record({ type: 'last-prompt', leafUuid: 'message-84' }),
  ].join('\n') + '\n');
  const latest = await reader.read(claudeId);
  const older = await reader.read(claudeId, latest.nextCursor);
  const oldest = await reader.read(claudeId, older.nextCursor);
  const items = [...oldest.items, ...older.items, ...latest.items];
  assert.deepEqual([latest.items.length, older.items.length, oldest.items.length], [40, 40, 5]);
  assert.equal(oldest.hasMore, false);
  assert.equal(new Set(items.map((item) => item.id)).size, 85);
  assert.deepEqual(items.map((item) => item.text), Array.from({ length: 85 }, (_, i) => `Claude 消息 ${i}`));

  const next = message(85, '# 新回复\n\n**已完成**');
  await appendFile(claudeFile, next.slice(0, -3));
  assert.equal((await reader.read(claudeId)).items.at(-1).text, 'Claude 消息 84');
  await appendFile(claudeFile, next.slice(-3) + '\n');
  const updated = await reader.read(claudeId);
  assert.equal(updated.items.at(-1).text, '# 新回复\n\n**已完成**');
  assert.equal(updated.session.turnState, 'idle');
  assert.equal((await reader.list()).sessions[0].recentMessage, '# 新回复\n\n**已完成**');
  assert.deepEqual(updated.items.slice(0, -1).map((item) => item.id), latest.items.slice(1).map((item) => item.id));
});

test('Claude tool results are paired and bounded, and sidechains stay out of the reading view without leaf metadata', async (t) => {
  const { reader, claudeFile } = await setup(t);
  await writeFile(claudeFile, [
    message(0),
    record({ type: 'assistant', uuid: 'tools', message: { content: [
      { type: 'thinking', thinking: 'hidden reasoning' },
      { type: 'tool_use', id: 'bash-call', name: 'Bash', input: { command: 'pnpm test:smoke' } },
      { type: 'tool_use', id: 'read-call', name: 'Read', input: { file_path: '/repo/example.txt' } },
    ], stop_reason: 'tool_use' } }),
    record({ type: 'user', uuid: 'results', message: { content: [
      { type: 'tool_result', tool_use_id: 'read-call', content: [{ type: 'text', text: 'File contents' }] },
      { type: 'tool_result', tool_use_id: 'bash-call', content: '测试通过\n'.repeat(5000) },
    ] } }),
    message(1, '答案'.repeat(10000)),
    record({ type: 'assistant', uuid: 'sidechain', isSidechain: true, message: { content: 'Sidechain answer' } }),
    record({ type: 'user', uuid: 'internal', isMeta: true, message: { content: 'Internal metadata' } }),
    record({ type: 'user', uuid: 'wrapper', message: { content: '<command-name>/help</command-name>' } }),
  ].join('\n'));
  const page = await reader.read(claudeId);
  assert.equal(page.items.length, 4);
  const command = page.items.find((item) => item.type === 'command');
  assert.equal(command.text, 'pnpm test:smoke');
  assert.equal(command.detail.length, 16384);
  assert.equal(command.truncated, true);
  const tool = page.items.find((item) => item.type === 'tool_call');
  assert.equal(tool.title, '工具 · Read');
  assert.equal(tool.detail, 'File contents');
  assert.equal(page.items.at(-1).text.length, 16384);
  assert.equal(page.items.at(-1).truncated, true);
  assert.equal(page.session.recentMessage, '答案'.repeat(150));
  assert.equal(page.session.turnState, 'idle');
});

test('oversized and malformed Claude files stay discoverable and recover on the next read', async (t) => {
  const { reader, claudeFile } = await setup(t);
  await writeFile(claudeFile, 'null\nnot json\n');
  assert.equal((await reader.list()).sessions[0].quality, 'stale');
  assert.equal((await reader.read(claudeId)).items[0].type, 'status');

  await truncate(claudeFile, 32 * 1024 * 1024 + 1);
  assert.equal((await reader.list()).sessions[0].id, claudeId);
  await assert.rejects(reader.read(claudeId), /32 MiB.*原窗口/);
  await writeFile(claudeFile, message(0));
  assert.equal((await reader.read(claudeId)).items[0].text, 'Claude 消息 0');
  assert.equal((await reader.list()).sessions[0].quality, 'partial');
});

test('either provider remains usable when the other application has no data directory', async (t) => {
  const { codexHome, claudeConfigDir, claudeFile, reader } = await setup(t);
  await rm(codexHome, { recursive: true });
  await writeFile(claudeFile, message(1));
  assert.equal((await reader.list()).total, 1);
  assert.equal((await reader.read(claudeId)).items[0].text, 'Claude 消息 1');
  await rm(claudeConfigDir, { recursive: true });
  assert.deepEqual(await reader.list(), { sessions: [], total: 0 });
});

test('streaming summaries preserve UTF-8 across chunks and reject logs growing past the limit', async (t) => {
  const { claudeFile } = await setup(t);
  const text = '中🙂'.repeat(12000);
  await writeFile(claudeFile, text + '\r\nlast line');
  const lines = [];
  for await (const line of readSessionLines(claudeFile)) lines.push(line);
  assert.deepEqual(lines, [text + '\r', 'last line']);

  await writeFile(claudeFile, 'first line\n' + 'x\n'.repeat(70000));
  const growing = readSessionLines(claudeFile);
  assert.equal((await growing.next()).value, 'first line');
  await truncate(claudeFile, 32 * 1024 * 1024 + 1);
  await assert.rejects(async () => {
    for await (const _line of growing) { /* drain to the size bound */ }
  }, /32 MiB/);
});
