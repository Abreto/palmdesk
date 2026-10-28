const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const load = require('./load-source.cjs');

const { KeepAwake } = load('electron-main/keep-awake.ts');

// Mirrors Electron's powerSaveBlocker: ids start at 0 and only `stop`
// releases one.
function fakeBlocker() {
  const state = { next: 0, live: new Set(), starts: [], stops: [], most: 0 };
  state.blocker = {
    start(type) {
      state.starts.push(type);
      if (state.fail) throw state.fail;
      const id = state.next;
      state.next += 1;
      if (!state.refuse) state.live.add(id);
      state.most = Math.max(state.most, state.live.size);
      return id;
    },
    stop(id) {
      state.stops.push(id);
      return state.live.delete(id);
    },
    isStarted: (id) => state.live.has(id),
  };
  return state;
}

function directory(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'palmdesk-awake-'));
  t.after(() => fs.rmSync(value, { recursive: true, force: true }));
  return value;
}

async function host(dir, platform = 'darwin') {
  const state = fakeBlocker();
  state.keepAwake = new KeepAwake(dir, state.blocker, platform);
  await state.keepAwake.restore();
  return state;
}

const off = { enabled: false, active: false, supported: true };
const on = { enabled: true, active: true, supported: true };

test('keeping the computer awake is off by default and starts nothing', async (t) => {
  const h = await host(directory(t));
  assert.deepEqual(await h.keepAwake.status(), off);
  assert.deepEqual(h.starts, []);
});

['darwin', 'win32'].forEach((platform) => {
  test(`${platform}: repeated toggles hold at most one blocker that lets the display sleep`, async (t) => {
    const h = await host(directory(t), platform);
    assert.deepEqual(await h.keepAwake.configure(true), on);
    assert.deepEqual(await h.keepAwake.configure(true), on);
    assert.deepEqual(h.starts, ['prevent-app-suspension']);
    assert.deepEqual([...h.live], [0]);

    assert.deepEqual(await h.keepAwake.configure(false), off);
    assert.deepEqual(await h.keepAwake.configure(false), off);
    assert.deepEqual(h.stops, [0]);
    assert.equal(h.live.size, 0);

    for (let i = 0; i < 5; i += 1) {
      await h.keepAwake.configure(true);
      await h.keepAwake.configure(false);
    }
    // Requests sent together apply in order; the last one wins.
    const results = await Promise.all([
      h.keepAwake.configure(true),
      h.keepAwake.configure(false),
      h.keepAwake.configure(true),
      h.keepAwake.configure(true),
    ]);
    assert.deepEqual(results.at(-1), on);
    assert.equal(h.live.size, 1);
    assert.equal(h.most, 1);
    assert.ok(h.starts.every((type) => type === 'prevent-app-suspension'));
  });
});

test('the choice is saved per installation and restored on launch', async (t) => {
  const dir = directory(t);
  const first = await host(dir);
  await first.keepAwake.configure(true);
  first.keepAwake.close();

  const relaunched = await host(dir);
  assert.deepEqual(await relaunched.keepAwake.status(), on);
  assert.deepEqual(relaunched.starts, ['prevent-app-suspension']);
  await relaunched.keepAwake.configure(false);
  relaunched.keepAwake.close();

  const again = await host(dir);
  assert.deepEqual(await again.keepAwake.status(), off);
  assert.deepEqual(again.starts, []);
  // Another installation keeps its own choice.
  assert.deepEqual(await (await host(directory(t))).keepAwake.status(), off);
});

test('quitting releases the blocker without forgetting the choice', async (t) => {
  const dir = directory(t);
  const h = await host(dir);
  await h.keepAwake.configure(true);
  h.keepAwake.close();
  h.keepAwake.close();
  assert.deepEqual(h.stops, [0]);
  assert.equal(h.live.size, 0);
  assert.deepEqual(await h.keepAwake.status(), { ...on, active: false });
  // Nothing starts again while PalmDesk shuts down.
  await h.keepAwake.configure(true);
  assert.equal(h.live.size, 0);

  // Quitting while the saved choice is still loading starts nothing either.
  const state = fakeBlocker();
  const quitting = new KeepAwake(dir, state.blocker, 'darwin');
  const restoring = quitting.restore();
  quitting.close();
  await restoring;
  assert.deepEqual(state.starts, []);
  assert.deepEqual(await (await host(dir)).keepAwake.status(), on);
});

test('a blocker that fails to start is reported instead of success', async (t) => {
  const dir = directory(t);
  const h = await host(dir);
  h.fail = new Error('IOPMAssertionCreate failed');
  assert.deepEqual(await h.keepAwake.configure(true), {
    ...on,
    active: false,
    error: 'IOPMAssertionCreate failed',
  });
  assert.equal(h.live.size, 0);
  h.fail = undefined;
  // Turning the option off clears the failure; turning it on retries.
  assert.deepEqual(await h.keepAwake.configure(false), off);
  assert.deepEqual(await h.keepAwake.configure(true), on);

  // A start that Electron does not report as running is a failure too.
  const refused = fakeBlocker();
  refused.refuse = true;
  const keepAwake = new KeepAwake(dir, refused.blocker, 'win32');
  assert.deepEqual(await keepAwake.restore().then(() => keepAwake.status()), {
    ...on,
    active: false,
    error: '系统未启用防止睡眠',
  });
  keepAwake.close();
  assert.deepEqual(refused.stops, []);
});

test('invalid values, malformed files and unsupported hosts leave it off', async (t) => {
  const dir = directory(t);
  const h = await host(dir);
  await assert.rejects(h.keepAwake.configure('true'), /无效/);
  await Promise.all(
    ['null', '{', '{"enabled":"true"}', '[]'].map(async (saved) => {
      const malformed = directory(t);
      fs.writeFileSync(path.join(malformed, 'keep-awake.json'), saved);
      const relaunched = await host(malformed);
      assert.deepEqual(await relaunched.keepAwake.status(), off, saved);
      assert.deepEqual(relaunched.starts, [], saved);
    })
  );

  fs.writeFileSync(
    path.join(dir, 'keep-awake.json'),
    JSON.stringify({ enabled: true })
  );
  const linux = await host(dir, 'linux');
  assert.deepEqual(await linux.keepAwake.status(), {
    ...off,
    supported: false,
  });
  await assert.rejects(linux.keepAwake.configure(true), /macOS 和 Windows/);
  assert.deepEqual(linux.starts, []);
});

test('a failed save starts nothing, and turning off releases even if saving fails', async (t) => {
  const dir = directory(t);
  const h = await host(dir);
  // A directory at the temporary-file path makes saving fail on both hosts.
  const temporary = path.join(dir, 'keep-awake.json.tmp');
  fs.mkdirSync(temporary);
  await assert.rejects(h.keepAwake.configure(true));
  assert.deepEqual(h.starts, []);
  assert.deepEqual(await h.keepAwake.status(), off);

  fs.rmSync(temporary, { recursive: true });
  assert.deepEqual(await h.keepAwake.configure(true), on);
  fs.mkdirSync(temporary);
  await assert.rejects(h.keepAwake.configure(false));
  assert.equal(h.live.size, 0);
  assert.deepEqual(await h.keepAwake.status(), off);
  // Later requests still run after a failed one.
  fs.rmSync(temporary, { recursive: true });
  assert.deepEqual(await h.keepAwake.configure(true), on);
});
