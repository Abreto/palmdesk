import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const timeoutMs = 20000;

async function bounded(promise, label, milliseconds = timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out: ${label}`)),
          milliseconds
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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

function startFixture(executable) {
  const child = spawn(executable, [], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const pending = new Map();
  let sequence = 0;
  let failure;
  function fail() {
    failure ||= new Error('Windows fixture process or JSON protocol failed');
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  }
  function response(requestId) {
    if (failure) return Promise.reject(failure);
    return bounded(
      new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
      }),
      'fixture response'
    ).finally(() => pending.delete(requestId));
  }
  const ready = response(0);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.requestId);
      if (!request || message.error || !Object.hasOwn(message, 'data')) {
        fail();
        return;
      }
      pending.delete(message.requestId);
      request.resolve(message.data);
    } catch {
      fail();
    }
  });
  child.on('error', fail);
  child.stdin.on('error', fail);
  const exited = new Promise((resolve) =>
    child.once('close', () => {
      lines.close();
      fail();
      resolve();
    })
  );
  return {
    child,
    ready,
    request(command, target = {}) {
      const requestId = ++sequence;
      const reply = response(requestId);
      if (!failure)
        child.stdin.write(
          `${JSON.stringify({ ...target, requestId, command })}\n`
        );
      return reply;
    },
    kill() {
      if (child.pid && child.exitCode === null && child.signalCode === null)
        child.kill();
    },
    async close() {
      child.stdin.end();
      try {
        await bounded(exited, 'fixture graceful exit', 2000);
      } catch {
        this.kill();
        await bounded(exited, 'fixture forced exit', 5000);
      }
    },
  };
}

function verifyBounds(actual, expected, label) {
  assert.ok(actual && expected, `${label}: frame bounds exist`);
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(
      Number.isFinite(actual[key]) &&
        Math.abs(actual[key] - expected[key]) <= 1,
      `${label}: physical ${key} matches DWM within one pixel`
    );
  }
}

async function run() {
  if (process.platform !== 'win32') {
    console.log('SKIP packaged Windows capture smoke: Windows only');
    return;
  }
  if (process.env.PALMDESK_NATIVE_SMOKE !== 'true') {
    console.log(
      'SKIP packaged Windows capture smoke: set PALMDESK_NATIVE_SMOKE=true on an interactive desktop'
    );
    return;
  }

  const development = process.env.SMOKE_DESKTOP_DEV === 'true';
  const mode = development ? 'development' : 'packaged';
  const config = require('../../electron-builder.cjs');
  const pkg = require('../../package.json');
  const executable = path.resolve(
    process.env.SMOKE_ELECTRON_EXECUTABLE ||
      (development
        ? require('electron')
        : path.join(
            root,
            config.directories.output.replace('${version}', pkg.version),
            'win-unpacked',
            `${config.productName}.exe`
          ))
  );
  assert.ok(
    existsSync(executable),
    `${mode} Windows executable is missing; set SMOKE_ELECTRON_EXECUTABLE or finish the build`
  );
  assert.ok(
    existsSync(
      development
        ? path.join(root, 'native-bin/palmdesk-window.exe')
        : path.join(
            path.dirname(executable),
            'resources/native/palmdesk-window.exe'
          )
    ),
    `${mode} Windows native helper is missing; finish building before running this smoke`
  );
  if (development) {
    assert.ok(
      existsSync(path.join(root, 'electron-dist/index.cjs')),
      'Build electron-dist before the development smoke'
    );
    assert.ok(
      existsSync(path.join(root, 'dist/index.html')),
      'Build dist/index.html before the development smoke'
    );
  }
  // Debug protocol logging can include desktop source metadata.
  delete process.env.DEBUG;
  delete process.env.PWDEBUG;
  const { _electron } = require('playwright');
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), 'palmdesk-electron-smoke-')
  );
  let fixture;
  let application;
  let page;
  let sessionId;
  let stage = 'fixture compilation';
  const killChildren = () => {
    fixture?.kill();
    const child = application?.process();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 5000,
      });
    }
  };
  process.once('exit', killChildren);
  const reports = [];
  const cleanupErrors = [];
  let failed;

  try {
    const compiler = ['Framework64', 'Framework']
      .map((framework) =>
        path.join(
          process.env.SystemRoot || 'C:\\Windows',
          'Microsoft.NET',
          framework,
          'v4.0.30319',
          'csc.exe'
        )
      )
      .find(existsSync);
    assert.ok(compiler, 'Windows .NET Framework v4 csc.exe is required');
    const fixtureExecutable = path.join(
      temporary,
      'palmdesk-electron-fixture.exe'
    );
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
        path.join(root, 'test/smoke/fixtures/windows-test-window.cs'),
      ],
      { windowsHide: true, encoding: 'utf8', timeout: 30000 }
    );
    assert.equal(
      compilation.status,
      0,
      'Windows input fixture compilation failed'
    );
    fixture = startFixture(fixtureExecutable);
    const initial = await fixture.ready;
    assert.equal(initial.ownerPid, fixture.child.pid);
    assert.equal(initial.windows.length, 2);
    const handles = initial.windows.map((window) => window.nativeId);
    assert.equal(new Set(handles).size, 2);
    for (const window of initial.windows) {
      assert.ok(Number.isSafeInteger(window.nativeId) && window.nativeId > 0);
      assert.ok(window.inputBounds?.width > 0 && window.inputBounds.height > 0);
      assert.equal(window.text, '');
      assert.equal(window.clickCount, 0);
    }

    stage = `${mode} Electron launch`;
    const appData = path.join(temporary, 'appdata');
    const localAppData = path.join(temporary, 'local-appdata');
    await mkdir(appData);
    await mkdir(localAppData);
    const env = {
      ...process.env,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      ...(development
        ? { PALMDESK_APP_NAME: `PalmDesk Smoke ${process.pid}-${Date.now()}` }
        : {}),
    };
    delete env.VITE_DEV_SERVER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.DEBUG;
    delete env.PWDEBUG;
    application = await _electron.launch({
      executablePath: executable,
      args: development ? ['.'] : [],
      cwd: root,
      env,
      timeout: 60000,
    });
    page = await application.firstWindow({ timeout: timeoutMs });
    await page.waitForFunction(
      () => typeof window.electronAPI?.ipcRenderer?.invoke === 'function',
      null,
      { timeout: timeoutMs }
    );

    async function ipc(channel, data = {}) {
      return bounded(
        page.evaluate(
          async ({ channel, data, handles, ownerPid }) => {
            const result = await window.electronAPI.ipcRenderer.invoke(
              channel,
              { data }
            );
            if (result?.code !== 0)
              return {
                ok: false,
                inputBlocked: result?.data?.inputBlocked === true,
              };
            const select = (source) => {
              if (
                !source ||
                source.ownerPid !== ownerPid ||
                !handles.includes(source.nativeId)
              )
                return null;
              const {
                id,
                nativeId,
                bundleId,
                captureId,
                isOnScreen,
                bounds,
                boundsSource,
              } = source;
              return {
                id,
                nativeId,
                ownerPid,
                bundleId,
                captureId,
                isOnScreen,
                bounds,
                boundsSource,
              };
            };
            // Discard user titles, thumbnails and unrelated identities inside the renderer.
            if (channel === 'getCaptureSources')
              return {
                ok: true,
                sources: Array.isArray(result.data?.sources)
                  ? result.data.sources.map(select).filter(Boolean)
                  : null,
              };
            if (channel === 'capturePermissions') {
              const { platform, screen, accessibility, packaged } = result.data;
              return { ok: true, platform, screen, accessibility, packaged };
            }
            if (channel === 'beginCapture')
              return {
                ok: true,
                source: select(result.data?.source),
                sessionId: result.data?.sessionId,
                streamId: result.data?.stream?.id,
              };
            return { ok: true };
          },
          { channel, data, handles, ownerPid: fixture.child.pid }
        ),
        `${channel} IPC`
      );
    }

    stage = `${mode} Windows permissions`;
    const permissions = await ipc('capturePermissions');
    assert.equal(permissions.ok, true, stage);
    assert.equal(permissions.platform, 'win32');
    assert.equal(permissions.packaged, !development);
    assert.equal(permissions.screen, 'granted');
    assert.equal(permissions.accessibility, true);
    console.log(`PASS ${mode} win32 capture permissions`);

    stage = 'fixture capture source catalog';
    const sources = await until(async () => {
      const result = await ipc('getCaptureSources');
      assert.equal(result.ok, true, stage);
      assert.ok(Array.isArray(result.sources));
      return (
        result.sources.length === 2 &&
        result.sources.every(
          (source) => source.captureId && source.isOnScreen
        ) &&
        result.sources
      );
    }, stage);
    for (const source of sources) {
      assert.equal(source.captureId, `window:${source.nativeId}:0`);
      assert.equal(source.boundsSource, 'window');
      verifyBounds(
        source.bounds,
        initial.windows.find((window) => window.nativeId === source.nativeId)
          .bounds,
        'source catalog'
      );
    }
    console.log('PASS real Electron capture IDs match both fixture HWNDs');

    for (const nativeId of handles)
      await fixture.request('minimize', { nativeId });
    for (const [index, nativeId] of handles.entries()) {
      const source = sources.find((entry) => entry.nativeId === nativeId);
      stage = `fixture ${index + 1} capture session`;
      const capture = await ipc('beginCapture', {
        sourceId: source.id,
        expectedSource: {
          ownerPid: source.ownerPid,
          bundleId: source.bundleId,
        },
      });
      if (typeof capture.sessionId === 'string') sessionId = capture.sessionId;
      assert.equal(capture.ok, true, stage);
      assert.ok(sessionId && capture.source);
      assert.equal(capture.source.nativeId, nativeId);
      assert.equal(capture.source.bundleId, source.bundleId);
      assert.equal(capture.streamId, source.captureId);
      let status = await fixture.request('status');
      const selected = status.windows.find(
        (window) => window.nativeId === nativeId
      );
      assert.equal(
        status.foregroundNativeId,
        nativeId,
        'beginCapture restores and focuses only the owned HWND'
      );
      verifyBounds(capture.source.bounds, selected.bounds, 'beginCapture');

      stage = `fixture ${index + 1} renderer video`;
      await bounded(
        page.evaluate(async (streamId) => {
          const state = { tracks: [], video: document.createElement('video') };
          window.__palmdeskWindowsSmoke = state;
          state.video.muted = true;
          state.video.autoplay = true;
          state.video.playsInline = true;
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: streamId,
              },
            },
          });
          state.tracks = stream.getTracks();
          state.video.srcObject = stream;
          await state.video.play();
        }, capture.streamId),
        stage
      );
      const frame = await until(
        () =>
          page.evaluate(() => {
            const video = window.__palmdeskWindowsSmoke.video;
            if (video.readyState < 2 || !video.videoWidth || !video.videoHeight)
              return null;
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d', {
              willReadFrequently: true,
            });
            context.drawImage(video, 0, 0);
            // The lower interior is solid fixture color, away from the TextBox and frame.
            const points = [
              [0.35, 0.65],
              [0.5, 0.7],
              [0.7, 0.8],
            ];
            const pixels = points.map(([x, y]) =>
              Array.from(
                context.getImageData(
                  Math.round(canvas.width * x),
                  Math.round(canvas.height * y),
                  1,
                  1
                ).data
              )
            );
            return { width: canvas.width, height: canvas.height, pixels };
          }),
        'decoded fixture video frame'
      );
      const expectedColor = index === 0 ? [46, 139, 87] : [205, 92, 92];
      assert.ok(
        frame.pixels.every(
          (pixel) =>
            pixel[3] > 240 &&
            expectedColor.every(
              (value, channel) => Math.abs(pixel[channel] - value) <= 24
            )
        ),
        'decoded pixels match the selected fixture color'
      );
      const dimensions = {
        fixture: index + 1,
        decoded: { width: frame.width, height: frame.height },
        dwm: { width: selected.bounds.width, height: selected.bounds.height },
        difference: {
          width: frame.width - selected.bounds.width,
          height: frame.height - selected.bounds.height,
        },
      };
      console.log(`Fixture frame dimensions: ${JSON.stringify(dimensions)}`);
      assert.ok(
        Math.abs(dimensions.difference.width) <= 2 &&
          Math.abs(dimensions.difference.height) <= 2,
        'decoded frame must match physical DWM dimensions within two pixels'
      );

      stage = `fixture ${index + 1} real mouse and text input`;
      const input = selected.inputBounds;
      const point = {
        x:
          ((input.x + input.width / 2 - selected.bounds.x) /
            (selected.bounds.width - 1)) *
          1000,
        y:
          ((input.y + input.height / 2 - selected.bounds.y) /
            (selected.bounds.height - 1)) *
          1000,
      };
      assert.ok(
        point.x > 0 && point.x < 1000 && point.y > 0 && point.y < 1000,
        'TextBox click stays inside the fixture frame'
      );
      assert.equal(
        (
          await ipc('remoteInput', {
            sessionId,
            input: { action: 'click', ...point },
          })
        ).ok,
        true,
        'real mouse input succeeds'
      );
      await until(async () => {
        status = await fixture.request('status');
        return (
          status.windows.find((window) => window.nativeId === nativeId)
            .inputClickCount > selected.inputClickCount &&
          status.windows.find((window) => window.nativeId === nativeId)
            .inputFocused
        );
      }, 'fixture TextBox receives the mouse click');
      const text = `PalmDesk smoke ${index + 1} \u4f60\u597d`;
      assert.equal(
        (
          await ipc('remoteInput', {
            sessionId,
            input: { action: 'text', text },
          })
        ).ok,
        true,
        'real text input succeeds'
      );
      await until(async () => {
        status = await fixture.request('status');
        return (
          status.windows.find((window) => window.nativeId === nativeId).text ===
          text
        );
      }, 'fixture TextBox receives the exact test text');
      const beforeDenied = status.windows.map((window) => ({
        nativeId: window.nativeId,
        text: window.text,
        clickCount: window.clickCount,
      }));
      assert.equal(
        (
          await ipc('remoteInput', {
            sessionId: 'invalid-smoke-session',
            input: { action: 'text', text: 'rejected-smoke-text' },
          })
        ).ok,
        false,
        'invalid input session is rejected'
      );
      status = await fixture.request('status');
      assert.deepEqual(
        status.windows.map((window) => ({
          nativeId: window.nativeId,
          text: window.text,
          clickCount: window.clickCount,
        })),
        beforeDenied,
        'rejected input changes neither fixture window'
      );
      const sibling = status.windows.find(
        (window) => window.nativeId !== nativeId
      );
      assert.equal(
        sibling.text,
        index === 0 ? '' : 'PalmDesk smoke 1 \u4f60\u597d'
      );
      console.log(
        `PASS fixture ${index + 1}: decoded color, dimensions, mouse, text and invalid-session rejection`
      );
      reports.push(dimensions);

      const tracksStopped = await page.evaluate(() => {
        const state = window.__palmdeskWindowsSmoke;
        state.tracks.forEach((track) => track.stop());
        state.video.pause();
        state.video.srcObject = null;
        delete window.__palmdeskWindowsSmoke;
        return state.tracks.every((track) => track.readyState === 'ended');
      });
      assert.equal(
        tracksStopped,
        true,
        'all fixture capture tracks are stopped'
      );
      assert.equal((await ipc('stopCapture', { sessionId })).ok, true);
      sessionId = undefined;
    }
  } catch (error) {
    if (fixture) {
      const status = await fixture.request('status').catch(() => null);
      if (status)
        console.log(
          `Fixture-only input diagnostics: ${JSON.stringify({
            foregroundOwned: status.windows.some(
              (window) => window.nativeId === status.foregroundNativeId
            ),
            windows: status.windows.map((window) => ({
              text: window.text,
              inputFocused: window.inputFocused,
              clickCount: window.clickCount,
              inputClickCount: window.inputClickCount,
              cursorInInput:
                window.inputBounds &&
                status.cursor &&
                status.cursor.x >= window.inputBounds.x &&
                status.cursor.x <
                  window.inputBounds.x + window.inputBounds.width &&
                status.cursor.y >= window.inputBounds.y &&
                status.cursor.y <
                  window.inputBounds.y + window.inputBounds.height,
            })),
          })}`
        );
    }
    // Playwright exceptions can embed console output; keep failures scoped to a stage.
    failed = `${stage}: ${error instanceof assert.AssertionError ? error.message : error instanceof Error && error.message.startsWith('Timed out:') ? error.message : 'operation failed (raw application output omitted)'}`;
  } finally {
    if (page && !page.isClosed()) {
      await bounded(
        page.evaluate(async (sessionId) => {
          const state = window.__palmdeskWindowsSmoke;
          state?.tracks.forEach((track) => track.stop());
          if (state) {
            state.video.pause();
            state.video.srcObject = null;
            delete window.__palmdeskWindowsSmoke;
          }
          if (sessionId)
            await window.electronAPI.ipcRenderer.invoke('stopCapture', {
              data: { sessionId },
            });
        }, sessionId),
        'capture cleanup',
        5000
      ).catch(() => cleanupErrors.push('capture cleanup failed'));
    }
    if (application) {
      const child = application.process();
      const exited =
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise((resolve) => child.once('close', resolve));
      await bounded(application.close(), 'Electron shutdown', 10000).catch(
        async () => {
          // Playwright launches a cmd.exe wrapper on Windows; kill only its owned tree.
          killChildren();
          await bounded(exited, 'Electron forced shutdown', 5000).catch(() =>
            cleanupErrors.push('Electron process tree did not exit')
          );
          cleanupErrors.push('Electron required forced termination');
        }
      );
    }
    if (fixture)
      await fixture.close().catch(() => {
        fixture.kill();
        cleanupErrors.push('fixture cleanup failed');
      });
    await rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    }).catch(() => cleanupErrors.push('temporary directory cleanup failed'));
    process.off('exit', killChildren);
  }
  if (failed) throw new Error([failed, ...cleanupErrors].join('; '));
  assert.equal(cleanupErrors.length, 0, cleanupErrors.join('; '));
  assert.equal(reports.length, 2);
  console.log(
    `PASS ${mode} Windows Electron capture and input smoke; fixture, tracks and app cleaned up`
  );
}

await run();
