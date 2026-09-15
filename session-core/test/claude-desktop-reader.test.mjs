import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, symlink, truncate, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSessionReader } from '../index.mjs';
import { createClaudeDesktopSessionDiscovery, resolveClaudeDesktopDataDirs } from '../src/providers/claude-desktop-sessions.mjs';

const uuid = '33333333-3333-4333-8333-333333333333';
const desktopUuid = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const desktopId = `local_${desktopUuid}`;
const id = `claude-code:session-file:${uuid}`;
const now = Date.parse('2026-09-16T01:00:00Z');
const metadata = (extra = {}) => ({
  sessionId: desktopId, cliSessionId: uuid, cwd: '/repo/desktop-code',
  title: 'Desktop 会话标题', createdAt: now - 1000, lastActivityAt: now,
  // These app-only fields must never reach the controller.
  remoteMcpServersConfig: { secret: 'synthetic-private-setting' }, ...extra,
});
const message = (index, text = `Desktop 消息 ${index}`) => JSON.stringify({
  sessionId: uuid, cwd: '/repo/desktop-code', type: index % 2 ? 'assistant' : 'user',
  uuid: `message-${index}`, parentUuid: index ? `message-${index - 1}` : null,
  timestamp: new Date(now + index).toISOString(),
  message: { content: text, stop_reason: index % 2 ? 'end_turn' : null },
});
async function put(file, contents) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}
async function setup(t, { shortDirectory = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'palmdesk-claude-desktop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const claudeDesktopDataDir = path.join(directory, 'Claude');
  const claudeConfigDir = path.join(directory, '.claude');
  const orgDir = path.join(claudeDesktopDataDir, 'claude-code-sessions', 'aaaaaaaa', 'bbbbbbbb');
  const indexFile = path.join(orgDir, `${desktopId}.json`);
  const storageDir = path.join(orgDir, shortDirectory ? desktopUuid.slice(0, 8) : desktopId);
  const localFile = path.join(storageDir, '.claude', 'projects', '-repo-desktop-code', `${uuid}.jsonl`);
  const globalFile = path.join(claudeConfigDir, 'projects', '-repo-desktop-code', `${uuid}.jsonl`);
  const reader = createSessionReader({ codexHome: path.join(directory, 'no-codex'), claudeConfigDir, claudeDesktopDataDir });
  await put(indexFile, JSON.stringify(metadata()));
  return { directory, claudeDesktopDataDir, orgDir, indexFile, storageDir, localFile, globalFile, reader };
}

test('Desktop index labels a global Code transcript without duplicating it, and renames invalidate only metadata', async (t) => {
  const { reader, globalFile, indexFile, directory } = await setup(t);
  await put(globalFile, message(0) + '\n' + message(1) + '\n');
  const first = await reader.read(id);
  assert.equal(first.session.source, 'claude-desktop');
  assert.equal(first.session.providerId, 'claude-code');
  assert.equal(first.session.title, 'Desktop 会话标题');
  assert.equal(first.items.at(-1).text, 'Desktop 消息 1');
  assert.deepEqual((await reader.list()).sessions.map((s) => s.id), [id]);
  assert.equal((await reader.list('Desktop 会话标题')).total, 1);
  assert.ok(!JSON.stringify(first).includes(directory));
  assert.ok(!JSON.stringify(first).includes('synthetic-private-setting'));
  assert.ok(!JSON.stringify(first).includes(desktopId));

  await writeFile(indexFile, JSON.stringify(metadata({ title: '仅修改 Desktop 标题', lastActivityAt: now + 60000 })));
  const renamed = await reader.read(id);
  assert.equal(renamed.session.title, '仅修改 Desktop 标题');
  assert.deepEqual(renamed.items, first.items);
  assert.equal((await reader.list('仅修改')).total, 1);

  await rm(indexFile);
  const cli = await reader.read(id);
  assert.equal(cli.session.source, 'claude-code');
  assert.equal(cli.session.title, 'Desktop 消息 0');
  assert.deepEqual(cli.items, first.items);
});

for (const shortDirectory of [false, true]) {
  test(`Desktop reads indexed per-session transcripts with ${shortDirectory ? 'short' : 'full'} storage names, including history and appended results`, async (t) => {
    const { reader, localFile } = await setup(t, { shortDirectory });
    await put(localFile, Array.from({ length: 85 }, (_, i) => message(i)).join('\n') + '\n');
    const latest = await reader.read(id);
    const older = await reader.read(id, latest.nextCursor);
    const oldest = await reader.read(id, older.nextCursor);
    const all = [...oldest.items, ...older.items, ...latest.items];
    assert.equal(latest.session.source, 'claude-desktop');
    assert.deepEqual([latest.items.length, older.items.length, oldest.items.length], [40, 40, 5]);
    assert.deepEqual(all.map((item) => item.text), Array.from({ length: 85 }, (_, i) => `Desktop 消息 ${i}`));
    assert.equal(new Set(all.map((item) => item.id)).size, 85);
    await appendFile(localFile, message(85, '# Desktop 新回复') + '\n');
    const updated = await reader.read(id);
    assert.equal(updated.items.at(-1).text, '# Desktop 新回复');
    assert.equal(updated.session.recentMessage, '# Desktop 新回复');
    assert.equal(updated.session.turnState, 'idle');
    assert.deepEqual(updated.items.slice(0, -1), latest.items.slice(1));
    await rm(localFile);
    assert.equal((await reader.list()).total, 0);
    await assert.rejects(reader.read(id), /不存在/);
  });
}

test('duplicate global and Desktop copies resolve to the newest transcript for both summaries and detail', async (t) => {
  const { reader, localFile, globalFile } = await setup(t);
  await put(localFile, message(1, 'Desktop copy') + '\n');
  await put(globalFile, message(1, 'Global copy') + '\n');
  await utimes(localFile, new Date(now), new Date(now + 1000));
  await utimes(globalFile, new Date(now), new Date(now + 2000));
  const list = await reader.list();
  assert.equal(list.total, 1);
  assert.equal(list.sessions[0].recentMessage, 'Global copy');
  assert.equal((await reader.read(id)).items[0].text, 'Global copy');
  await utimes(localFile, new Date(now), new Date(now + 3000));
  assert.equal((await reader.read(id)).items[0].text, 'Desktop copy');
  assert.equal((await reader.list()).sessions[0].recentMessage, 'Desktop copy');
});

test('missing, partial, oversized and invalid Desktop indexes do not hide CLI sessions and recover on refresh', async (t) => {
  const { reader, globalFile, localFile, indexFile } = await setup(t);
  await put(globalFile, message(0));
  await put(localFile, message(1));
  const invalid = [
    'null', '{"sessionId":', JSON.stringify(metadata({ sessionId: 'local_../../elsewhere' })),
    JSON.stringify(metadata({ cliSessionId: '../transcript' })),
    JSON.stringify(metadata({ lastActivityAt: '2026-09-16' })),
    JSON.stringify(metadata({ sshConfig: { host: 'example.invalid' } })),
    JSON.stringify(metadata({ wslConfig: { distro: 'test' } })),
  ];
  for (const value of invalid) {
    await writeFile(indexFile, value);
    const list = await reader.list();
    assert.equal(list.total, 1);
    assert.equal(list.sessions[0].source, 'claude-code');
    assert.equal((await reader.read(id)).items[0].text, 'Desktop 消息 0');
  }
  await truncate(indexFile, 10 * 1024 * 1024 + 1);
  assert.equal((await reader.list()).sessions[0].source, 'claude-code');
  await writeFile(indexFile, JSON.stringify(metadata()));
  assert.equal((await reader.list()).sessions[0].source, 'claude-desktop');
});

test('Desktop indexes never select metadata paths, unrelated transcripts, subagents or Chat/Cowork data', async (t) => {
  const { reader, indexFile, localFile, orgDir, claudeDesktopDataDir } = await setup(t);
  const other = path.join(orgDir, 'arbitrary.jsonl');
  await put(other, message(1, 'Not a discovered transcript'));
  await writeFile(indexFile, JSON.stringify(metadata({ stagedTranscriptPath: other, transcriptPath: other })));
  await put(path.join(path.dirname(localFile), 'other.jsonl'), message(1));
  await put(path.join(path.dirname(localFile), uuid, 'subagents', `${uuid}.jsonl`), message(1));
  const cowork = path.join(claudeDesktopDataDir, 'local-agent-mode-sessions', 'aaaaaaaa', 'bbbbbbbb');
  await put(path.join(cowork, `${desktopId}.json`), JSON.stringify(metadata({ sessionType: 'chat' })));
  await put(path.join(cowork, desktopId, '.claude', 'projects', '-repo', `${uuid}.jsonl`), message(1));
  assert.equal((await reader.list()).total, 0);
  await put(localFile, message(1).replaceAll(uuid, '44444444-4444-4444-8444-444444444444'));
  await utimes(localFile, new Date(now), new Date(now + 1000));
  assert.equal((await reader.list()).total, 0);
  await writeFile(localFile, message(1));
  // Same-size rewrites can share Windows filesystem timestamps in fast tests.
  await utimes(localFile, new Date(now), new Date(now + 2000));
  assert.equal((await reader.read(id)).items[0].text, 'Desktop 消息 1');
});

test('Desktop transcripts keep the shared size limit and malformed-file recovery', async (t) => {
  const { reader, localFile } = await setup(t);
  await put(localFile, 'not-json\n');
  assert.equal((await reader.list()).sessions[0].quality, 'stale');
  assert.equal((await reader.read(id)).session.source, 'claude-desktop');
  await truncate(localFile, 32 * 1024 * 1024 + 1);
  await assert.rejects(reader.read(id), /32 MiB/);
  await writeFile(localFile, message(1));
  assert.equal((await reader.read(id)).items[0].text, 'Desktop 消息 1');
});

test('Desktop discovery skips symlinked index files, transcript files and storage directories', { skip: process.platform === 'win32' }, async (t) => {
  const { reader, indexFile, localFile, storageDir, directory } = await setup(t);
  const outsideIndex = path.join(directory, 'index.json');
  const outsideTranscript = path.join(directory, 'outside.jsonl');
  await put(outsideIndex, JSON.stringify(metadata()));
  await put(outsideTranscript, message(1));
  await rm(indexFile);
  await symlink(outsideIndex, indexFile);
  await put(localFile, message(1));
  assert.equal((await reader.list()).total, 0);
  await rm(indexFile);
  await put(indexFile, JSON.stringify(metadata()));
  await rm(localFile);
  await symlink(outsideTranscript, localFile);
  assert.equal((await reader.list()).total, 0);
  await rm(storageDir, { recursive: true });
  const outsideStorage = path.join(directory, 'outside-storage');
  await put(path.join(outsideStorage, '.claude', 'projects', '-repo', `${uuid}.jsonl`), message(1));
  await symlink(outsideStorage, storageDir);
  assert.equal((await reader.list()).total, 0);
});

test('Desktop discovery covers first-party and third-party profiles or an explicit environment override', async (t) => {
  assert.deepEqual(resolveClaudeDesktopDataDirs({}, 'darwin'), ['Claude', 'Claude-3p'].map((name) => path.join(os.homedir(), 'Library', 'Application Support', name)));
  assert.deepEqual(resolveClaudeDesktopDataDirs({ CLAUDE_USER_DATA_DIR: '/custom/Claude' }, 'darwin'), ['/custom/Claude']);
  assert.deepEqual(resolveClaudeDesktopDataDirs({}, 'linux'), []);
  const { directory, claudeDesktopDataDir } = await setup(t);
  const thirdPartyDir = path.join(directory, 'Claude-3p');
  const otherUuid = '44444444-4444-4444-8444-444444444444';
  await put(path.join(thirdPartyDir, 'claude-code-sessions', 'aaaaaaaa', 'bbbbbbbb', `${desktopId}.json`), JSON.stringify(metadata({ cliSessionId: otherUuid })));
  const discover = createClaudeDesktopSessionDiscovery({ claudeDesktopDataDirs: [claudeDesktopDataDir, thirdPartyDir] });
  assert.deepEqual([...((await discover()).byUuid.keys())].sort(), [uuid, otherUuid]);
});
