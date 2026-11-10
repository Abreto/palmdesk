const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const load = require('./load-source.cjs');

const { IPC_EVENT } = load('src/event.ts');
const { SMOKE_RUN_PASSED, SmokeRun, isSmokeRun } = load(
  'electron-main/smoke-run.ts'
);

const root = path.resolve(__dirname, '../..');
const appUrl = pathToFileURL(path.join(root, 'dist/index.html')).href;
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs a real SmokeRun against a fake app, then removes its profile, timer
// and process listeners.
async function withSmokeRun(timeoutMs, check) {
  const before = {
    uncaughtException: process.listeners('uncaughtException'),
    unhandledRejection: process.listeners('unhandledRejection'),
  };
  const calls = [];
  const logged = [];
  const { log, error } = console;
  console.log = (line) => logged.push(line);
  console.error = (line) => logged.push(line);
  let run;
  try {
    run = new SmokeRun(
      {
        exit: (code) => calls.push(`exit:${code}`),
        quit: () => calls.push('quit'),
      },
      timeoutMs,
      1
    );
    await check({ run, calls, logged });
  } finally {
    run?.fail('test finished');
    console.log = log;
    console.error = error;
    if (run) fs.rmSync(run.profile, { recursive: true, force: true });
    Object.entries(before).forEach(([event, listeners]) =>
      process
        .listeners(event)
        .filter((listener) => !listeners.includes(listener))
        .forEach((listener) => process.off(event, listener))
    );
  }
}

function fakeWindow(rendered = () => false) {
  const webContents = new EventEmitter();
  webContents.scripts = [];
  webContents.executeJavaScript = (script) => {
    webContents.scripts.push(script);
    return Promise.resolve(rendered());
  };
  return { webContents };
}

test('only the bare --smoke-exit switch starts a smoke run', () => {
  assert.equal(isSmokeRun(['PalmDesk', '--smoke-exit']), true);
  [
    ['PalmDesk'],
    ['PalmDesk', '--smoke-exit=https://example.com'],
    ['PalmDesk', '--smoke-exits'],
    ['PalmDesk', 'smoke-exit'],
  ].forEach((argv) => assert.equal(isSmokeRun(argv), false, argv.join(' ')));
});

test('a smoke run uses a new profile and cancels every HTTP and WebSocket request', () =>
  withSmokeRun(60_000, ({ run, logged }) => {
    assert.ok(path.basename(run.profile).startsWith('palmdesk-smoke-'));
    assert.deepEqual(fs.readdirSync(run.profile), []);
    assert.ok(logged.includes(`[PalmDesk smoke] profile: ${run.profile}`));
    let filter;
    run.blockNetwork({
      webRequest: {
        onBeforeRequest: (listener) => {
          filter = listener;
        },
      },
    });
    const cancelled = (url) => {
      let result;
      filter({ url }, (response) => {
        result = response;
      });
      return result.cancel;
    };
    [
      'https://palmdesk.abreto.icu/api/desk_user/create',
      'https://palmdesk.abreto.icu/socket.io/?EIO=4',
      'wss://palmdesk.abreto.icu/socket.io/?EIO=4&transport=websocket',
      'http://127.0.0.1:4300/',
      'ws://localhost:5173/',
      'HTTPS://API.GITHUB.COM/repos/Abreto/palmdesk/releases',
    ].forEach((url) => assert.equal(cancelled(url), true, url));
    [
      `${appUrl}#/remote`,
      'data:image/png;base64,AAAA',
      'blob:file:///0b6c3f1e',
    ].forEach((url) => assert.equal(cancelled(url), false, url));
    // Each origin is reported once, without its path or query.
    assert.deepEqual(
      logged.filter((line) => line.includes('blocked')),
      [
        'https://palmdesk.abreto.icu',
        'wss://palmdesk.abreto.icu',
        'http://127.0.0.1:4300',
        'ws://localhost:5173',
        'https://api.github.com',
      ].map((origin) => `[PalmDesk smoke] blocked requests to ${origin}`)
    );
  }));

test('a smoke run quits normally once the host page has rendered', () =>
  withSmokeRun(60_000, async ({ run, calls, logged }) => {
    let rendered = false;
    const win = fakeWindow(() => rendered);
    run.watch(win);
    win.webContents.emit('did-finish-load');
    await wait(5);
    assert.deepEqual(calls, []);
    rendered = true;
    await wait(20);
    assert.deepEqual(calls, ['quit']);
    assert.ok(logged.includes(SMOKE_RUN_PASSED));
    // It waits for the host route with the preload bridge in place.
    assert.match(win.webContents.scripts[0], /#\/remote/);
    assert.match(win.webContents.scripts[0], /electronAPI/);
  }));

test('load failures, renderer crashes and timeouts fail a smoke run', async () => {
  const failures = [
    ['preload-error', {}, '/app/preload.mjs', new Error('preload broke')],
    ['did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', appUrl, true],
    ['render-process-gone', {}, { reason: 'crashed', exitCode: 1 }],
    ['unresponsive'],
  ];
  for (const [event, ...args] of failures) {
    await withSmokeRun(60_000, ({ run, calls }) => {
      const win = fakeWindow();
      run.watch(win);
      win.webContents.emit(event, ...args);
      assert.deepEqual(calls, ['exit:1'], event);
    });
  }
  await withSmokeRun(60_000, ({ run, calls }) => {
    const win = fakeWindow();
    run.watch(win);
    // A frame inside the page may fail without failing the app.
    win.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', appUrl, false);
    assert.deepEqual(calls, []);
  });
  await withSmokeRun(5, async ({ calls, logged }) => {
    await wait(30);
    assert.deepEqual(calls, ['exit:1']);
    assert.ok(logged.some((line) => /did not render within 5 ms/.test(line)));
  });
});

// Loads the main process in a smoke run with fakes that fail on any network,
// capture, input, native helper or permission call.
function smokeDesktop({ platform = 'win32', identityError } = {}) {
  const events = new Map();
  const handlers = new Map();
  const calls = [];
  const windows = [];
  const forbidden = (name) => () => {
    calls.push(name);
    throw new Error(`${name} must not run in a smoke run`);
  };
  class BrowserWindow {
    static fromWebContents(contents) {
      return windows.find((win) => win.webContents === contents) || null;
    }
    constructor() {
      calls.push('window');
      this.webContents = { on() {}, send() {} };
      windows.push(this);
    }
    loadFile() {
      return Promise.resolve();
    }
    on() {}
    isDestroyed() {
      return false;
    }
    getBounds() {
      return { x: 0, y: 0, width: 960, height: 720 };
    }
  }
  const defaultSession = {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
  };
  const smokeRun = {
    profile: '/tmp/palmdesk-smoke-test',
    blockNetwork(session) {
      assert.equal(session, defaultSession);
      calls.push('blockNetwork');
    },
    watch(win) {
      assert.equal(win, windows[0]);
      calls.push('watch');
    },
    fail: (error) => calls.push(`fail:${error.message}`),
  };
  const display = {
    workAreaSize: { width: 1440, height: 900 },
    size: { width: 1440, height: 900 },
    scaleFactor: 2,
  };
  const previousDevServer = process.env.VITE_DEV_SERVER_URL;
  delete process.env.VITE_DEV_SERVER_URL;
  try {
    load('electron-main/index.ts', {
      process: { platform },
      'node:fs': { mkdirSync() {} },
      // Settles the release checker's settings without file I/O, so an
      // update check would reach net.fetch before the assertions.
      'node:fs/promises': {
        readFile: () => Promise.reject(new Error('No saved settings')),
      },
      electron: {
        app: {
          isPackaged: true,
          commandLine: { getSwitchValue: () => '', appendSwitch() {} },
          getName: () => 'PalmDesk Test',
          getVersion: () => '0.0.8',
          setName() {},
          getPath: () => '/tmp/palmdesk-real-app-data',
          setPath: (name, value) => calls.push(`${name}:${value}`),
          on: (event, listener) => events.set(event, listener),
          requestSingleInstanceLock: () => true,
          quit() {},
          exit: (code) => calls.push(`exit:${code}`),
        },
        BrowserWindow,
        ipcMain: {
          handle: (channel, handler) => handlers.set(channel, handler),
          on() {},
        },
        Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
        screen: { getPrimaryDisplay: () => display },
        session: { defaultSession },
        shell: { openExternal: forbidden('openExternal') },
        powerMonitor: { on() {} },
        net: { fetch: forbidden('fetch') },
        dialog: { showErrorBox: forbidden('dialog') },
        systemPreferences: {
          getMediaAccessStatus: forbidden('getMediaAccessStatus'),
          isTrustedAccessibilityClient: forbidden('accessibilityClient'),
        },
        desktopCapturer: { getSources: forbidden('getSources') },
        nativeImage: {},
      },
      '@nut-tree-fork/nut-js': {
        mouse: { config: {} },
        keyboard: { config: {} },
      },
      './smoke-run': {
        isSmokeRun: () => true,
        SmokeRun: class {
          constructor() {
            return smokeRun;
          }
        },
      },
      './capture-session': {
        CaptureSession: class {
          refresh = forbidden('refresh');
          begin = forbidden('begin');
          input = forbidden('input');
          pasteImage = forbidden('pasteImage');
          end() {
            return Promise.resolve();
          }
        },
        InputUnavailableError: class extends Error {},
      },
      './app-identity': {
        assertUniqueApplicationIdentity() {
          if (identityError) throw new Error(identityError);
        },
      },
      './agent-launcher': {
        AgentLauncher: class {
          list = forbidden('listAgents');
          launch = forbidden('launchAgent');
        },
      },
      './session-reader': {
        DesktopSessionReader: class {
          settings = forbidden('sessionReader');
        },
      },
      './image-paste': {},
      './native-window': {
        nativeHelperPath: () => '/unused-native-helper',
        enableWindowsCapture: () => true,
        NativeWindowBridge: class {
          request(command) {
            calls.push(`native:${command}`);
            return Promise.resolve({});
          }
          close() {}
        },
      },
    });
  } finally {
    if (previousDevServer === undefined) delete process.env.VITE_DEV_SERVER_URL;
    else process.env.VITE_DEV_SERVER_URL = previousDevServer;
  }
  return {
    calls,
    ready: () => events.get('ready')(),
    invoke: (channel) =>
      handlers.get(channel)(
        {
          sender: windows[0].webContents,
          senderFrame: { url: `${appUrl}#/remote`, parent: null },
        },
        { requestId: 'r', data: {} }
      ),
  };
}

test('a smoke run keeps the main process offline and away from capture, input and permission prompts', async () => {
  const desktop = smokeDesktop();
  await desktop.ready();
  const { warn } = console;
  console.warn = () => {};
  try {
    for (const channel of [
      'capturePermissions',
      'openCapturePermission',
      'getCaptureSources',
      'beginCapture',
      'remoteInput',
      'pasteImage',
      'getAgentApplications',
      'getInstalledAgents',
      'launchAgent',
      'sessionReaderSettings',
    ]) {
      const result = await desktop.invoke(IPC_EVENT[channel]);
      assert.equal(result.code, 1, channel);
      assert.equal(result.msg, 'Smoke runs never capture or control', channel);
    }
  } finally {
    console.warn = warn;
  }
  assert.equal((await desktop.invoke(IPC_EVENT.getPlatform)).code, 0);
  // The throwaway profile replaces the app data directory, and requests are
  // cancelled before the window exists. No update check, native helper,
  // capture, input or permission API runs.
  assert.deepEqual(desktop.calls, [
    'userData:/tmp/palmdesk-smoke-test',
    'sessionData:/tmp/palmdesk-smoke-test',
    'blockNetwork',
    'window',
    'watch',
  ]);
});

test('a smoke run reports an app identity conflict without a blocking dialog', async () => {
  const desktop = smokeDesktop({
    platform: 'darwin',
    identityError: 'Duplicate application',
  });
  await desktop.ready();
  assert.deepEqual(desktop.calls.slice(2), [
    'blockNetwork',
    'native:appIdentity',
    'fail:Duplicate application',
    'exit:1',
  ]);
});
