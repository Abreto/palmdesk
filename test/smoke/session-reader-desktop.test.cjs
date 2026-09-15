const assert = require('node:assert/strict');
const { cp, mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-source.cjs');

test('desktop reader is off by default, persists opt-in, rejects writes and revokes in-flight reads', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'palmdesk-reader-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let unblock;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const { DesktopSessionReader } = load('electron-main/session-reader.ts', {
    '../session-core/index.mjs': { createSessionReader: () => ({
      list: () => { started(); return new Promise((resolve) => { unblock = resolve; }); },
    }) },
  });
  const reader = new DesktopSessionReader(directory, 'darwin');
  assert.deepEqual(await reader.request({ method: 'status' }), { enabled: false, supported: true });
  await assert.rejects(reader.request({ method: 'list' }), /开启/);
  await reader.configure(true);
  assert.equal((await new DesktopSessionReader(directory, 'darwin').settings()).enabled, true);
  await assert.rejects(reader.request({ method: 'follow-up', prompt: 'execute' }), /不支持/);
  const pending = reader.request({ method: 'list' });
  const rejected = assert.rejects(pending, /已关闭/);
  await entered;
  await reader.configure(false);
  unblock({ sessions: [{ text: 'should never escape' }] });
  await rejected;
  assert.equal((await new DesktopSessionReader(directory, 'darwin').settings()).enabled, false);
  const windows = new DesktopSessionReader(directory, 'win32');
  assert.deepEqual(await windows.settings(), { enabled: false, supported: false });
  await assert.rejects(windows.configure(true), /macOS/);
});

test('desktop requests read Claude transcripts through the same opt-in boundary', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'palmdesk-desktop-claude-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const claudeConfigDir = path.join(directory, 'claude');
  await cp(path.join(__dirname, '../../session-core/test/fixtures/claude-config'), claudeConfigDir, { recursive: true });
  const { DesktopSessionReader } = load('electron-main/session-reader.ts', {
    '../session-core/index.mjs': await import('../../session-core/index.mjs'),
  });
  const reader = new DesktopSessionReader(directory, 'darwin', path.join(directory, 'no-codex'), claudeConfigDir, '');
  const id = 'claude-code:session-file:33333333-3333-4333-8333-333333333333';
  await assert.rejects(reader.request({ method: 'read', id }), /开启/);
  await reader.configure(true);
  const list = await reader.request({ method: 'list' });
  assert.equal(list.sessions.length, 1);
  assert.equal(list.sessions[0].providerId, 'claude-code');
  const page = await reader.request({ method: 'read', id });
  assert.equal(page.items.at(-1).text, 'Done.');
  assert.ok(page.items.some((item) => item.detail === 'tests passed'));
  await reader.configure(false);
  await assert.rejects(reader.request({ method: 'read', id }), /开启/);
});

test('desktop requests discover Claude Desktop Code records and revoke access with the same setting', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'palmdesk-claude-desktop-opt-in-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const claudeDesktopDataDir = path.join(directory, 'Claude');
  const desktopId = 'local_dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const orgDir = path.join(claudeDesktopDataDir, 'claude-code-sessions', 'aaaaaaaa', 'bbbbbbbb');
  await mkdir(orgDir, { recursive: true });
  await cp(path.join(__dirname, '../../session-core/test/fixtures/claude-config'), path.join(orgDir, desktopId, '.claude'), { recursive: true });
  await writeFile(path.join(orgDir, `${desktopId}.json`), JSON.stringify({
    sessionId: desktopId, cliSessionId: '33333333-3333-4333-8333-333333333333',
    title: 'Desktop Code fixture', createdAt: Date.now(), lastActivityAt: Date.now(),
  }));
  const { DesktopSessionReader } = load('electron-main/session-reader.ts', {
    '../session-core/index.mjs': await import('../../session-core/index.mjs'),
  });
  const reader = new DesktopSessionReader(directory, 'darwin', path.join(directory, 'no-codex'), path.join(directory, 'no-cli'), claudeDesktopDataDir);
  const id = 'claude-code:session-file:33333333-3333-4333-8333-333333333333';
  await assert.rejects(reader.request({ method: 'read', id }), /开启/);
  await reader.configure(true);
  const list = await reader.request({ method: 'list' });
  assert.equal(list.total, 1);
  assert.equal(list.sessions[0].source, 'claude-desktop');
  assert.equal(list.sessions[0].title, 'Desktop Code fixture');
  const page = await reader.request({ method: 'read', id });
  assert.equal(page.items.at(-1).text, 'Done.');
  assert.ok(page.items.some((item) => item.detail === 'tests passed'));
  await reader.configure(false);
  await assert.rejects(reader.request({ method: 'read', id }), /开启/);
});
