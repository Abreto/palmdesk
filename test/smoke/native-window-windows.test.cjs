const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createInterface } = require('node:readline');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '../..');
const executable = path.join(root, 'native-bin/palmdesk-window.exe');
const fixtureSource = path.join(__dirname, 'fixtures/windows-test-window.cs');
const interactive = process.env.PALMDESK_NATIVE_SMOKE === 'true';
const focusSkip = interactive
  ? false
  : 'Set PALMDESK_NATIVE_SMOKE=true on an unlocked Windows desktop to test focus';
const timeoutMs = 12000;

function startJsonProcess(file, args = [], expectsReady = false) {
  const child = spawn(file, args, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const pending = new Map();
  let sequence = 0;
  let failure;

  function fail(error) {
    failure ||= error;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(failure);
    }
    pending.clear();
  }

  function waitForResponse(requestId) {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => fail(new Error('Timed out waiting for a native smoke response')),
        timeoutMs
      );
      pending.set(requestId, { resolve, reject, timer });
    });
  }

  const ready = expectsReady ? waitForResponse(0) : undefined;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail(new Error('Native smoke process returned invalid JSON'));
      return;
    }
    const request = message && pending.get(message.requestId);
    if (!request) {
      fail(new Error('Native smoke response has an unexpected requestId'));
      return;
    }
    clearTimeout(request.timer);
    pending.delete(message.requestId);
    // Never print raw replies or stderr: list/diagnostics can contain user titles.
    if (Object.hasOwn(message, 'error')) {
      if (typeof message.error !== 'string' || message.error.length === 0) {
        request.reject(
          new Error('Native smoke error response is missing its message')
        );
        return;
      }
      const code = ['gone', 'invalid', 'permission', 'focus'].includes(
        message.errorCode
      )
        ? message.errorCode
        : 'unknown';
      const error = new Error(`Native smoke request rejected (${code})`);
      error.code = code;
      request.reject(error);
    } else if (Object.hasOwn(message, 'data')) {
      request.resolve(message.data);
    } else {
      request.reject(new Error('Native smoke response is missing data'));
    }
  });
  child.on('error', () => fail(new Error('Cannot start native smoke process')));
  child.stdin.on('error', () => fail(new Error('Native smoke stdin closed')));
  const exited = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      lines.close();
      fail(new Error('Native smoke process exited before replying'));
      resolve({ code, signal });
    });
  });

  async function waitForExit(milliseconds) {
    let timer;
    try {
      return await Promise.race([
        exited.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    child,
    ready,
    request(command, target = {}) {
      const requestId = ++sequence;
      const response = waitForResponse(requestId);
      if (!failure) {
        child.stdin.write(
          `${JSON.stringify({ ...target, requestId, command })}\n`,
          (error) => {
            if (error) fail(new Error('Cannot write native smoke request'));
          }
        );
      }
      return response;
    },
    kill() {
      if (child.pid && child.exitCode === null && child.signalCode === null)
        child.kill();
    },
    async close() {
      child.stdin.end();
      if (!(await waitForExit(2000))) this.kill();
      assert.ok(await waitForExit(5000), 'test-owned child process must exit');
      child.stdin.destroy();
      child.stdout.destroy();
    },
  };
}

async function until(check, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

function identity(window) {
  return {
    nativeId: window.nativeId,
    ownerPid: window.ownerPid,
    bundleId: window.bundleId,
  };
}

function boundsMatch(actual, expected) {
  return (
    actual &&
    expected &&
    ['x', 'y', 'width', 'height'].every(
      (key) =>
        Number.isFinite(actual[key]) &&
        Number.isFinite(expected[key]) &&
        Math.abs(actual[key] - expected[key]) <= 1
    )
  );
}

test(
  'Windows native window integration',
  {
    skip:
      process.platform !== 'win32'
        ? 'Windows only'
        : !interactive &&
          'Set PALMDESK_NATIVE_SMOKE=true after building the helper',
    timeout: 150000,
  },
  async (t) => {
    assert.ok(
      existsSync(executable),
      'PALMDESK_NATIVE_SMOKE=true requires native-bin/palmdesk-window.exe; run node scripts/build-native.mjs first'
    );

    const windows = process.env.SystemRoot || 'C:\\Windows';
    const compiler = ['Framework64', 'Framework']
      .map((framework) =>
        path.join(windows, 'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe')
      )
      .find(existsSync);
    assert.ok(compiler, 'Windows .NET Framework v4 csc.exe is required');

    const temporary = await mkdtemp(path.join(os.tmpdir(), 'palmdesk-native-'));
    const clients = [];
    const killChildren = () => clients.forEach((client) => client.kill());
    process.once('exit', killChildren);
    t.signal.addEventListener('abort', killChildren, { once: true });
    t.after(async () => {
      try {
        const results = await Promise.allSettled(
          clients.map((client) => client.close())
        );
        assert.ok(
          results.every((result) => result.status === 'fulfilled'),
          'all test-owned child processes must be cleaned up'
        );
      } finally {
        killChildren();
        await rm(temporary, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100,
        });
        process.off('exit', killChildren);
        t.signal.removeEventListener('abort', killChildren);
      }
    });

    const fixtureExecutable = path.join(temporary, 'palmdesk-smoke-window.exe');
    const compilation = spawnSync(
      compiler,
      [
        '/nologo',
        '/target:exe',
        '/platform:anycpu',
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll',
        '/reference:System.Web.Extensions.dll',
        `/out:${fixtureExecutable}`,
        fixtureSource,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 }
    );
    assert.equal(
      compilation.status,
      0,
      `Windows fixture compilation failed:\n${compilation.stdout || ''}${compilation.stderr || ''}`
    );

    const fixture = startJsonProcess(fixtureExecutable, [], true);
    clients.push(fixture);
    const initial = await fixture.ready;
    assert.equal(initial.ownerPid, fixture.child.pid);
    assert.equal(initial.windows.length, 2);
    const handles = new Set(initial.windows.map((window) => window.nativeId));
    assert.equal(handles.size, 2, 'fixture creates two separate HWNDs');
    for (const nativeId of handles) {
      assert.ok(Number.isSafeInteger(nativeId) && nativeId > 0);
    }

    const native = startJsonProcess(executable);
    clients.push(native);
    async function listOwned() {
      const entries = await native.request('list');
      assert.ok(Array.isArray(entries), 'list returns an array');
      return entries.filter(
        (entry) =>
          entry &&
          entry.ownerPid === fixture.child.pid &&
          handles.has(entry.nativeId)
      );
    }
    const owned = await until(async () => {
      const entries = await listOwned();
      return entries.length === 2 && entries;
    }, 'both fixture HWNDs are listed');
    const [first, second] = initial.windows.map((window) =>
      owned.find((entry) => entry.nativeId === window.nativeId)
    );
    assert.ok(first && second, 'both fixture identities are present');

    async function focus(window, overrides = {}) {
      assert.ok(interactive, 'foreground changes require explicit opt-in');
      const target = { ...identity(window), ...overrides };
      assert.ok(handles.has(target.nativeId), 'focus only a test-owned HWND');
      try {
        return await native.request('focus', target);
      } catch (error) {
        if (error.code === 'focus') {
          const status = await fixture.request('status');
          error.message +=
            `; desktop has foreground HWND: ${status.foregroundNativeId !== 0}` +
            `; foreground belongs to fixture: ${handles.has(status.foregroundNativeId)}`;
        }
        throw error;
      }
    }

    function verifyWindow(window, expected) {
      assert.ok(
        window && typeof window === 'object',
        'window data is returned'
      );
      assert.equal(window.nativeId, expected.nativeId);
      assert.equal(window.ownerPid, fixture.child.pid);
      assert.ok(
        window.name === expected.name,
        'listed title matches the test-owned fixture title'
      );
      assert.ok(
        typeof window.bundleId === 'string' && window.bundleId.length > 0
      );
      assert.ok(
        window.bundleId.startsWith(
          `win32:${fixtureExecutable.toLowerCase()}#`
        ) && /#[0-9a-f]+$/i.test(window.bundleId),
        'identity includes the lowercase executable path and creation FILETIME'
      );
      assert.ok(
        typeof window.appName === 'string' && window.appName.length > 0
      );
      assert.equal(typeof window.isOnScreen, 'boolean');
    }

    await t.test(
      'same-title windows retain distinct HWND identities and physical bounds',
      async () => {
        const status = await fixture.request('status');
        assert.ok(
          first.name === second.name,
          'fixture window titles are identical'
        );
        assert.ok(
          first.bundleId === second.bundleId,
          'one process has one identity'
        );
        for (const window of [first, second]) {
          const expected = status.windows.find(
            (entry) => entry.nativeId === window.nativeId
          );
          verifyWindow(window, expected);
          assert.equal(window.isOnScreen, true);
          assert.ok(
            boundsMatch(window.bounds, expected.bounds),
            'list bounds match physical DWM extended frame bounds within one pixel'
          );
        }

        const bounds = {
          x: status.windows[0].bounds.x + 31,
          y: status.windows[0].bounds.y + 23,
          width: 438,
          height: 314,
        };
        for (const window of [first, second])
          await fixture.request('move', { nativeId: window.nativeId, bounds });
        const moved = await fixture.request('status');
        assert.ok(
          boundsMatch(moved.windows[0].bounds, moved.windows[1].bounds),
          'fixture windows also have identical physical bounds'
        );
        assert.ok(
          !boundsMatch(status.windows[0].bounds, moved.windows[0].bounds),
          'fixture move changed its physical frame'
        );
        await until(async () => {
          const entries = await listOwned();
          return (
            entries.length === 2 &&
            moved.windows.every((expected) =>
              entries.some(
                (entry) =>
                  entry.nativeId === expected.nativeId &&
                  entry.bundleId === first.bundleId &&
                  boundsMatch(entry.bounds, expected.bounds)
              )
            )
          );
        }, 'list refreshes the moved physical frame of each owned HWND');
      }
    );

    await t.test(
      'permissions, diagnostics and thumbnails satisfy the Windows protocol',
      async () => {
        const permissions = await native.request('permissions');
        assert.equal(permissions.accessibility, true);
        assert.equal(permissions.captureSupported, true);
        const diagnostics = await native.request('diagnostics');
        assert.ok(Array.isArray(diagnostics.applications));
        assert.ok(
          diagnostics.applications.some(
            (application) => application?.bundleId === first.bundleId
          ),
          'diagnostics includes the fixture executable identity'
        );
        for (const windows of [[], [identity(first), identity(second)]]) {
          const thumbnails = await native.request('thumbnails', { windows });
          assert.ok(Array.isArray(thumbnails));
          assert.equal(
            thumbnails.length,
            0,
            'Electron supplies Windows thumbnails'
          );
        }
      }
    );

    await t.test(
      'an invalid command preserves request correlation and later requests',
      async () => {
        const [, permissions] = await Promise.all([
          assert.rejects(native.request('invalid-smoke-command'), {
            code: 'invalid',
          }),
          native.request('permissions'),
        ]);
        assert.equal(permissions.accessibility, true);
        assert.equal((await listOwned()).length, 2);
      }
    );

    await t.test(
      'focus selects the exact same-title HWND',
      { skip: focusSkip },
      async () => {
        for (const window of [second, first, second]) {
          const refreshed = await focus(window);
          verifyWindow(refreshed, window);
          assert.ok(refreshed.bundleId === window.bundleId);
          assert.equal(refreshed.isOnScreen, true);
          const status = await until(async () => {
            const state = await fixture.request('status');
            return state.foregroundNativeId === window.nativeId && state;
          }, 'selected fixture HWND is the foreground window');
          assert.ok(
            boundsMatch(
              refreshed.bounds,
              status.windows.find((entry) => entry.nativeId === window.nativeId)
                .bounds
            ),
            'focus returns refreshed physical bounds'
          );
        }
      }
    );

    await t.test(
      'restoring one minimized HWND leaves its sibling minimized',
      { skip: focusSkip },
      async () => {
        for (const window of [first, second])
          await fixture.request('minimize', { nativeId: window.nativeId });
        await until(async () => {
          const status = await fixture.request('status');
          const entries = await listOwned();
          return (
            status.windows.every((window) => window.isMinimized) &&
            entries.length === 2 &&
            entries.every((window) => window.isOnScreen === false)
          );
        }, 'both minimized fixture HWNDs remain listed offscreen');
        const refreshed = await focus(first);
        verifyWindow(refreshed, first);
        assert.equal(refreshed.isOnScreen, true);
        const status = await until(async () => {
          const state = await fixture.request('status');
          const selected = state.windows.find(
            (window) => window.nativeId === first.nativeId
          );
          return (
            !selected.isMinimized &&
            state.foregroundNativeId === first.nativeId &&
            state
          );
        }, 'only the selected fixture HWND is restored and focused');
        assert.equal(
          status.windows.find((window) => window.nativeId === second.nativeId)
            .isMinimized,
          true
        );
        assert.ok(boundsMatch(refreshed.bounds, status.windows[0].bounds));
        const sibling = (await listOwned()).find(
          (window) => window.nativeId === second.nativeId
        );
        assert.ok(sibling, 'minimized sibling remains listed');
        assert.equal(sibling.isOnScreen, false);
      }
    );

    await t.test(
      'mismatched PID, executable identity and invalid targets cannot activate a window',
      { skip: focusSkip },
      async () => {
        await fixture.request('minimize', { nativeId: second.nativeId });
        const before = await fixture.request('status');
        const creation = second.bundleId.slice(
          second.bundleId.lastIndexOf('#')
        );
        for (const [overrides, code, label] of [
          [{ ownerPid: native.child.pid }, 'gone', 'mismatched test-owned PID'],
          [
            {
              bundleId: `win32:${path.join(temporary, 'different.exe').toLowerCase()}${creation}`,
            },
            'gone',
            'mismatched executable path',
          ],
          [
            { bundleId: `win32:${fixtureExecutable.toLowerCase()}#1` },
            'gone',
            'stale process creation time',
          ],
          [{ ownerPid: 'not-a-pid' }, 'invalid', 'nonnumeric PID'],
          [{ bundleId: '' }, 'invalid', 'empty executable identity'],
        ]) {
          await assert.rejects(focus(second, overrides), { code }, label);
          const after = await fixture.request('status');
          assert.equal(after.foregroundNativeId, before.foregroundNativeId);
          assert.equal(
            after.windows.find((window) => window.nativeId === second.nativeId)
              .isMinimized,
            true,
            'a rejected target must not restore the fixture window'
          );
        }
        assert.equal((await native.request('permissions')).accessibility, true);
      }
    );

    await t.test(
      'text validates content and target identity before native input',
      async () => {
        const before = await fixture.request('status');
        for (const [change, code] of [
          [{ ownerPid: native.child.pid }, 'gone'],
          [{ bundleId: `${second.bundleId}changed` }, 'gone'],
          [{ text: '' }, 'invalid'],
          [{ text: 'x'.repeat(4097) }, 'invalid'],
        ]) {
          await assert.rejects(
            native.request('text', {
              ...identity(second),
              text: 'must not be typed',
              ...change,
            }),
            { code }
          );
        }
        const after = await fixture.request('status');
        assert.equal(after.foregroundNativeId, before.foregroundNativeId);
        assert.deepEqual(
          after.windows.map((window) => window.text),
          before.windows.map((window) => window.text)
        );
      }
    );

    await t.test(
      'closed fixture HWNDs disappear from the catalog',
      async (closedTest) => {
        await fixture.request('close', { nativeId: second.nativeId });
        await until(async () => {
          const entries = await listOwned();
          return entries.length === 1 && entries[0].nativeId === first.nativeId;
        }, 'closed fixture HWND is removed');
        await closedTest.test(
          'a closed target is rejected as gone',
          { skip: focusSkip },
          async () => {
            await assert.rejects(focus(second), { code: 'gone' });
            assert.equal(
              (await native.request('permissions')).accessibility,
              true
            );
          }
        );
        await fixture.request('close', { nativeId: first.nativeId });
        await until(
          async () => (await listOwned()).length === 0,
          'all fixture HWNDs are removed'
        );
      }
    );
  }
);
