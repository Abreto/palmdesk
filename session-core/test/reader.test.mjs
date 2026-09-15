import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSessionReader } from '../index.mjs';

const uuid = '22222222-2222-4222-8222-222222222222';
const id = `codex:session-file:${uuid}`;
const record = (payload, type = 'response_item') => JSON.stringify({
  timestamp: '2026-09-15T02:00:00Z', type, payload,
});
const message = (index) => record({ type: 'message', role: index % 2 ? 'assistant' : 'user', content: [{ type: 'output_text', text: `手机阅读消息 ${index}` }] });

test('read facade paginates persisted desktop-style messages and observes appended results', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'palmdesk-reader-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'sessions'));
  const file = path.join(directory, 'sessions', `rollout-${uuid}.jsonl`);
  await writeFile(file, [
    record({ id: uuid, cwd: '/repo/palmdesk' }, 'session_meta'),
    ...Array.from({ length: 85 }, (_, index) => message(index)),
  ].join('\n') + '\n');
  const reader = createSessionReader({ codexHome: directory, claudeConfigDir: path.join(directory, 'no-claude') });
  const list = await reader.list('palmdesk');
  assert.equal(list.sessions.length, 1);
  assert.equal(list.sessions[0].turnState, 'unknown');
  assert.equal(list.sessions[0].recentMessage, '手机阅读消息 84');
  assert.equal(list.sessions[0].title, '手机阅读消息 0');
  const latest = await reader.read(id);
  assert.equal(latest.items.length, 40);
  assert.equal(latest.items.at(-1).text, '手机阅读消息 84');
  const older = await reader.read(id, latest.nextCursor);
  const oldest = await reader.read(id, older.nextCursor);
  const all = [...oldest.items, ...older.items, ...latest.items];
  assert.equal(all.length, 85);
  assert.equal(new Set(all.map((item) => item.id)).size, 85);
  assert.equal(oldest.hasMore, false);
  assert.ok(!JSON.stringify(latest).includes(directory));
  const next = message(85);
  await appendFile(file, next.slice(0, -3));
  assert.equal((await reader.read(id)).items.at(-1).text, '手机阅读消息 84');
  await appendFile(file, next.slice(-3) + '\n' + record({ type: 'task_complete' }, 'event_msg') + '\n');
  const updated = await reader.read(id);
  assert.equal(updated.items.at(-1).text, '手机阅读消息 85');
  assert.equal(updated.session.turnState, 'idle');
  await assert.rejects(reader.read('../../etc/passwd'), /无效/);
  await assert.rejects(reader.read(id, '../0'), /无效/);
  await rm(file);
  await assert.rejects(reader.read(id), /不存在/);
});

test('identical prompts in separate turns remain readable while mirrored records are deduplicated', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'palmdesk-reader-turns-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'sessions'));
  await writeFile(path.join(directory, 'sessions', `rollout-${uuid}.jsonl`), [
    record({ id: uuid }, 'session_meta'),
    record({ type: 'task_started' }, 'event_msg'),
    message(0), message(0),
    record({ type: 'task_complete' }, 'event_msg'),
    record({ type: 'task_started' }, 'event_msg'),
    message(0), message(0),
  ].join('\n'));
  const page = await createSessionReader({ codexHome: directory, claudeConfigDir: path.join(directory, 'no-claude') }).read(id);
  assert.equal(page.items.length, 2);
  assert.equal(new Set(page.items.map((item) => item.id)).size, 2);
});

test('oversized session logs stay discoverable but cannot trigger an unbounded detail read', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'palmdesk-reader-size-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'sessions'));
  const file = path.join(directory, 'sessions', `rollout-${uuid}.jsonl`);
  const contents = record({ id: uuid, cwd: '/repo/large' }, 'session_meta') + '\n' + message(0) + '\n';
  await writeFile(file, contents);
  await truncate(file, 32 * 1024 * 1024 + 1);
  // An index entry must not turn the size error into a misleading empty page.
  await writeFile(path.join(directory, 'session_index.jsonl'), JSON.stringify({ id: uuid, thread_name: 'Large session' }) + '\n');
  const reader = createSessionReader({ codexHome: directory, claudeConfigDir: path.join(directory, 'no-claude') });
  assert.equal((await reader.list()).sessions[0].id, id);
  await assert.rejects(reader.read(id), /32 MiB.*原窗口/);
  await writeFile(file, contents);
  assert.equal((await reader.read(id)).items[0].text, '手机阅读消息 0');
});

test('reading projections explicitly mark long content and search beyond the initial list', async () => {
  const sessions = Array.from({ length: 120 }, (_, index) => ({
    id: `codex:session-file:${String(index).padStart(8, '0')}-2222-4222-8222-222222222222`,
    title: `项目 ${index}`, projectPath: '/repo/example', lastUpdatedAt: '2026-09-15',
  }));
  const reader = createSessionReader({ providers: [{
    id: 'codex',
    listSessions: async () => sessions,
    getSessionTimelinePage: async () => ({ items: [{ id: 'long-message', type: 'message', role: 'assistant', content: '中'.repeat(200000) }], hasMore: false }),
  }] });
  assert.equal((await reader.list()).sessions.length, 100);
  assert.equal((await reader.list()).total, 120);
  assert.equal((await reader.list('项目 119')).sessions[0].title, '项目 119');
  const page = await reader.read(sessions[0].id);
  assert.equal(page.items[0].text.length, 16384);
  assert.equal(page.items[0].truncated, true);
});
