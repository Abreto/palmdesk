const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
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
