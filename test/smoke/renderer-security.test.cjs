const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const load = require('./load-source.cjs');

const { IPC_EVENT } = load('src/event.ts');
const security = load('electron-main/renderer-security.ts');
const {
  RENDERER_INVOKE_CHANNELS,
  RENDERER_RECEIVE_CHANNELS,
  RENDERER_SEND_CHANNELS,
  externalLinkUrl,
  isAppDocumentUrl,
  isPermissionAllowed,
  parseControllerSession,
} = security;

const root = path.resolve(__dirname, '../..');
const appUrl = pathToFileURL(path.join(root, 'dist/index.html')).href;

test('the renderer allowlist names only defined channels and omits unused privileged ones', () => {
  const defined = new Set(Object.values(IPC_EVENT));
  const all = [
    ...RENDERER_INVOKE_CHANNELS,
    ...RENDERER_SEND_CHANNELS,
    ...RENDERER_RECEIVE_CHANNELS,
  ];
  all.forEach((channel) => assert.ok(defined.has(channel), channel));
  assert.equal(new Set(all).size, all.length);
  [
    'showTargetApplication',
    'powerSaveBlockerStart',
    'windowMaximize',
    'setWindowBounds',
    'handleMoveScreenRightBottom',
    'getWindowTitlebarHeight',
    'getWindowPosition',
  ].forEach((channel) => assert.ok(!all.includes(channel), channel));
});

test('the preload forwards only allowed channels and never exposes the IPC event', async () => {
  let exposed;
  const calls = [];
  const listeners = new Map();
  const ipcRenderer = {
    invoke: (channel, request) => {
      calls.push(['invoke', channel, request]);
      return Promise.resolve({ code: 0 });
    },
    send: (channel, request) => calls.push(['send', channel, request]),
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
  };
  load('electron-main/preload.ts', {
    electron: {
      contextBridge: {
        exposeInMainWorld: (key, api) => {
          assert.equal(key, 'electronAPI');
          exposed = api;
        },
      },
      ipcRenderer,
    },
  });
  const api = exposed.ipcRenderer;
  assert.deepEqual(Object.keys(api).sort(), ['invoke', 'on', 'send']);

  await api.invoke(IPC_EVENT.capturePermissions, { data: {} });
  await assert.rejects(
    api.invoke('showTargetApplication', { data: {} }),
    /not allowed/
  );
  await assert.rejects(api.invoke('anything', {}), /not allowed/);
  api.send(IPC_EVENT.closeWindow, { data: {} });
  // createWindow is a request with a reply; it cannot be sent.
  api.send(IPC_EVENT.createWindow, { data: {} });
  api.send('powerSaveBlockerStart', { data: {} });
  assert.deepEqual(
    calls.map(([kind, channel]) => [kind, channel]),
    [
      ['invoke', IPC_EVENT.capturePermissions],
      ['send', IPC_EVENT.closeWindow],
    ]
  );

  const received = [];
  const off = api.on(IPC_EVENT.response_workAreaSize, (...args) =>
    received.push(args)
  );
  const sender = { invoke: ipcRenderer.invoke };
  listeners.get(IPC_EVENT.response_workAreaSize)({ sender }, { width: 1 });
  assert.deepEqual(received, [[{ width: 1 }]]);
  off();
  assert.equal(listeners.has(IPC_EVENT.response_workAreaSize), false);
  api.on(IPC_EVENT.response_closeWindow, () => {})();
  assert.equal(listeners.has(IPC_EVENT.response_closeWindow), false);
});

test('only the bundled document or the dev server counts as the app', () => {
  assert.equal(isAppDocumentUrl(`${appUrl}#/remote`, appUrl), true);
  assert.equal(isAppDocumentUrl(`${appUrl}?x=1#/webrtc`, appUrl), true);
  [
    pathToFileURL(path.join(root, 'dist/other.html')).href,
    pathToFileURL(path.join(root, 'dist/index.html/../../README.md')).href,
    'file:///etc/passwd',
    'file://evil.example/index.html',
    'https://palmdesk.abreto.icu/',
    'data:text/html,<p>x</p>',
    'about:blank',
    'not a url',
  ].forEach((url) => assert.equal(isAppDocumentUrl(url, appUrl), false, url));

  const windows =
    'file:///C:/Program%20Files/PalmDesk/resources/app.asar/dist/index.html';
  const loaded =
    'file:///c:/program%20files/palmdesk/resources/app.asar/dist/index.html#/remote';
  assert.equal(isAppDocumentUrl(loaded, windows, true), true);
  assert.equal(isAppDocumentUrl(loaded, windows, false), false);

  const dev = 'http://localhost:5173/';
  assert.equal(isAppDocumentUrl('http://localhost:5173/#/remote', dev), true);
  assert.equal(isAppDocumentUrl('http://localhost:5174/', dev), false);
  assert.equal(isAppDocumentUrl('https://localhost:5173/', dev), false);
});

test('openExternal accepts only credential-free https links to allowed hosts', () => {
  assert.equal(
    externalLinkUrl('https://github.com/Abreto/palmdesk'),
    'https://github.com/Abreto/palmdesk'
  );
  assert.equal(
    externalLinkUrl('https://github.com/Abreto/palmdesk/releases?x=1#y'),
    'https://github.com/Abreto/palmdesk/releases?x=1#y'
  );
  [
    'http://github.com/Abreto/palmdesk',
    'file:///Applications/Calculator.app',
    'smb://github.com/share',
    'x-apple.systempreferences:com.apple.preference.security',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'https://user:pass@github.com/',
    'https://github.com:8443/',
    'https://github.com.evil.example/',
    'https://evil.example/github.com',
    'https://palmdesk.abreto.icu/',
    '//github.com/Abreto',
    'github.com/Abreto',
    `https://github.com/${'a'.repeat(2048)}`,
    undefined,
    42,
    { href: 'https://github.com/' },
  ].forEach((value) =>
    assert.equal(externalLinkUrl(value), undefined, String(value))
  );
  assert.equal(
    externalLinkUrl('https://docs.example/', ['docs.example']),
    'https://docs.example/'
  );
});

test('permissions are denied unless a trusted PalmDesk page needs them', () => {
  const host = { trusted: true, mainWindow: true };
  const controller = { trusted: true, mainWindow: false };
  const foreign = { trusted: false, mainWindow: true };
  assert.equal(isPermissionAllowed('media', { ...host, mediaTypes: [] }), true);
  assert.equal(isPermissionAllowed('media', host), true);
  assert.equal(
    isPermissionAllowed('media', { ...host, mediaTypes: ['video'] }),
    false
  );
  assert.equal(
    isPermissionAllowed('media', { ...host, mediaTypes: ['audio'] }),
    false
  );
  assert.equal(isPermissionAllowed('media', controller), false);
  assert.equal(
    isPermissionAllowed('display-capture', { ...host, mediaTypes: ['video'] }),
    true
  );
  assert.equal(
    isPermissionAllowed('display-capture', {
      ...host,
      mediaTypes: ['video', 'audio'],
    }),
    false
  );
  assert.equal(
    isPermissionAllowed('display-capture', {
      ...controller,
      mediaTypes: ['video'],
    }),
    false
  );
  ['clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].forEach(
    (permission) => {
      assert.equal(isPermissionAllowed(permission, controller), true);
      assert.equal(isPermissionAllowed(permission, foreign), false);
    }
  );
  [
    'geolocation',
    'notifications',
    'openExternal',
    'pointerLock',
    'midiSysex',
    'unknown',
  ].forEach((permission) =>
    assert.equal(isPermissionAllowed(permission, host), false, permission)
  );
  assert.equal(isPermissionAllowed('media', foreign), false);
});

test('controller credentials are validated and stripped to the expected fields', () => {
  const session = {
    deskUserUuid: '12345678',
    deskUserPassword: 'local-secret',
    remoteDeskUserUuid: '87654321',
    remoteDeskUserPassword: 'remote-secret',
  };
  assert.deepEqual(
    parseControllerSession({ ...session, route: 'remote', windowId: 1 }),
    session
  );
  [
    undefined,
    'string',
    { ...session, deskUserPassword: '' },
    { ...session, remoteDeskUserPassword: 1 },
    { ...session, remoteDeskUserUuid: 'x'.repeat(257) },
  ].forEach((value) =>
    assert.throws(() => parseControllerSession(value), /连接信息无效/)
  );
});

function desktop({ packaged = false } = {}) {
  const events = new Map();
  const handlers = new Map();
  const listeners = new Map();
  const opened = [];
  const windows = [];
  const permission = {};
  class WebContents {
    constructor() {
      this.events = new Map();
      this.sent = [];
      this.devTools = false;
    }
    on(event, listener) {
      this.events.set(event, listener);
    }
    send(channel, payload) {
      this.sent.push([channel, payload]);
    }
    openDevTools() {
      this.devTools = true;
    }
  }
  class BrowserWindow {
    static fromWebContents(contents) {
      return windows.find((win) => win.webContents === contents) || null;
    }
    constructor(options) {
      this.options = options;
      this.webContents = new WebContents();
      this.events = new Map();
      this.destroyed = false;
      windows.push(this);
    }
    loadFile(file, options) {
      this.loaded = { file, options };
      return Promise.resolve();
    }
    loadURL(url) {
      this.loaded = { url };
      return Promise.resolve();
    }
    on(event, listener) {
      this.events.set(event, listener);
    }
    isDestroyed() {
      return this.destroyed;
    }
    close() {
      this.destroyed = true;
      this.events.get('closed')?.();
    }
    focus() {
      this.focused = true;
    }
    minimize() {
      this.minimized = true;
    }
    getBounds() {
      return { x: 0, y: 0, width: 960, height: 720 };
    }
    setBounds() {}
    setPosition(x, y) {
      this.position = [x, y];
    }
    setAlwaysOnTop(flag) {
      this.alwaysOnTop = flag;
    }
  }
  const display = {
    workAreaSize: { width: 1440, height: 900 },
    size: { width: 1440, height: 900 },
    scaleFactor: 2,
  };
  const previousDevServer = process.env.VITE_DEV_SERVER_URL;
  delete process.env.VITE_DEV_SERVER_URL;
  try {
    load('electron-main/index.ts', {
      process: { platform: 'darwin' },
      'node:fs': { mkdirSync() {} },
      electron: {
        app: {
          isPackaged: packaged,
          commandLine: {},
          getName: () => 'PalmDesk Test',
          setName() {},
          getPath: () => '/tmp',
          setPath() {},
          on: (event, listener) => events.set(event, listener),
          requestSingleInstanceLock: () => true,
          quit() {},
          exit() {},
        },
        BrowserWindow,
        ipcMain: {
          handle: (channel, handler) => handlers.set(channel, handler),
          on: (channel, listener) => listeners.set(channel, listener),
        },
        Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
        screen: { getPrimaryDisplay: () => display },
        session: {
          defaultSession: {
            setPermissionRequestHandler: (handler) => {
              permission.request = handler;
            },
            setPermissionCheckHandler: (handler) => {
              permission.check = handler;
            },
          },
        },
        shell: {
          openExternal: (url) => {
            opened.push(url);
            return Promise.resolve();
          },
        },
        powerMonitor: { on() {} },
        dialog: { showErrorBox() {} },
        systemPreferences: {},
        desktopCapturer: {},
        clipboard: {},
        nativeImage: {},
      },
      '@nut-tree-fork/nut-js': { mouse: { config: {} } },
      './capture-session': {
        CaptureSession: class {
          end() {
            return Promise.resolve();
          }
        },
        InputUnavailableError: class extends Error {},
      },
      './app-identity': { assertUniqueApplicationIdentity() {} },
      './agent-launcher': { AgentLauncher: class {} },
      './session-reader': { DesktopSessionReader: class {} },
      './image-paste': {},
      './native-window': {
        nativeHelperPath: () => '/unused-native-helper',
        NativeWindowBridge: class {
          request() {
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
  const frame = (url = `${appUrl}#/remote`, parent = null) => ({ url, parent });
  const event = (win, url, parent) => ({
    sender: win.webContents,
    senderFrame: frame(url, parent),
  });
  return {
    events,
    windows,
    opened,
    permission,
    event,
    ready: () => events.get('ready')(),
    invoke: (channel, from, data = {}) =>
      handlers.get(channel)(from, { requestId: 'r', data }),
    send: (channel, from, data = {}) =>
      listeners.get(channel)(from, { requestId: 'r', data }),
  };
}

test('main-process IPC accepts only the app document of a PalmDesk window', async () => {
  const app = desktop();
  await app.ready();
  const [main] = app.windows;
  assert.equal(main.options.webPreferences.sandbox, true);
  assert.equal(main.options.webPreferences.contextIsolation, true);
  assert.equal(main.options.webPreferences.nodeIntegration, false);

  const trusted = app.event(main);
  assert.equal(
    (await app.invoke(IPC_EVENT.getPlatform, trusted)).data.platform,
    'darwin'
  );
  const untrusted = [
    app.event(main, 'https://evil.example/'),
    app.event(main, 'data:text/html,x'),
    app.event(main, `${appUrl}#/remote`, { url: appUrl }),
    { sender: main.webContents, senderFrame: null },
    { sender: {}, senderFrame: { url: `${appUrl}#/remote`, parent: null } },
  ];
  const denied = await Promise.all(
    untrusted.flatMap((from) => [
      app.invoke(IPC_EVENT.getPlatform, from),
      app.invoke(IPC_EVENT.remoteInput, from),
    ])
  );
  denied.forEach((result) => assert.equal(result.code, 1));

  const external = await app.invoke(IPC_EVENT.shellOpenExternal, trusted, {
    url: 'file:///Applications/Calculator.app',
  });
  assert.equal(external.code, 1);
  await app.invoke(IPC_EVENT.shellOpenExternal, trusted, {
    url: 'https://github.com/Abreto/palmdesk',
  });
  assert.deepEqual(app.opened, ['https://github.com/Abreto/palmdesk']);

  // The renderer names a kind; it cannot replace or reuse window identities.
  assert.equal(
    (await app.invoke(IPC_EVENT.createWindow, trusted, { kind: 'remote' }))
      .code,
    1
  );
  assert.equal(
    (await app.invoke(IPC_EVENT.createWindow, trusted, { kind: 'webrtc' }))
      .code,
    1
  );
  await app.invoke(IPC_EVENT.createWindow, trusted, { kind: 'about' });
  await app.invoke(IPC_EVENT.createWindow, trusted, { kind: 'about' });
  assert.equal(app.windows.length, 2);
  const about = app.windows[1];
  assert.equal(about.focused, true);
  assert.equal(about.loaded.options.hash, 'about');

  const session = {
    deskUserUuid: '12345678',
    deskUserPassword: 'local-secret',
    remoteDeskUserUuid: '87654321',
    remoteDeskUserPassword: 'remote-secret',
  };
  await app.invoke(IPC_EVENT.createWindow, trusted, {
    kind: 'webrtc',
    session,
  });
  const controller = app.windows[2];
  assert.equal(controller.loaded.options.hash, 'webrtc');
  assert.doesNotMatch(JSON.stringify(controller.loaded), /secret/);
  const fromController = app.event(controller, `${appUrl}#/webrtc`);
  assert.equal(
    (await app.invoke(IPC_EVENT.takeWindowSession, app.event(about))).data
      .deskUserPassword,
    undefined
  );
  assert.deepEqual(
    (await app.invoke(IPC_EVENT.takeWindowSession, fromController)).data,
    session
  );
  assert.deepEqual(
    (await app.invoke(IPC_EVENT.takeWindowSession, fromController)).data,
    {}
  );

  // Child windows reach only window-local helpers, never capture or input.
  assert.equal(
    (await app.invoke(IPC_EVENT.remoteInput, fromController)).code,
    1
  );
  assert.equal(
    (
      await app.invoke(IPC_EVENT.createWindow, fromController, {
        kind: 'about',
      })
    ).code,
    1
  );
  app.send(IPC_EVENT.setAlwaysOnTop, fromController, { flag: true });
  assert.equal(controller.alwaysOnTop, undefined);
  app.send(IPC_EVENT.closeWindow, fromController);
  assert.equal(controller.destroyed, true);
  assert.equal(main.destroyed, false);

  app.send(IPC_EVENT.handleOpenDevTools, trusted);
  assert.equal(main.webContents.devTools, true);
});

test('packaged builds cannot open DevTools', async () => {
  const app = desktop({ packaged: true });
  await app.ready();
  const [main] = app.windows;
  assert.equal(main.options.webPreferences.devTools, false);
  app.send(IPC_EVENT.handleOpenDevTools, app.event(main));
  assert.equal(main.webContents.devTools, false);
});

test('pages cannot open windows, leave the app, or embed webviews', async () => {
  const app = desktop();
  await app.ready();
  const contents = {
    events: new Map(),
    setWindowOpenHandler(handler) {
      this.openHandler = handler;
    },
    on(event, listener) {
      this.events.set(event, listener);
    },
  };
  app.events.get('web-contents-created')({}, contents);
  assert.deepEqual(contents.openHandler({ url: 'https://evil.example/' }), {
    action: 'deny',
  });
  assert.deepEqual(
    contents.openHandler({ url: 'https://github.com/Abreto/palmdesk' }),
    { action: 'deny' }
  );
  await Promise.resolve();
  assert.deepEqual(app.opened, ['https://github.com/Abreto/palmdesk']);

  const navigate = (url) => {
    let prevented = false;
    contents.events.get('will-frame-navigate')({
      url,
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  };
  assert.equal(navigate('https://evil.example/'), true);
  assert.equal(navigate('file:///etc/passwd'), true);
  assert.equal(navigate(`${appUrl}#/setting`), false);
  assert.equal(
    navigate('devtools://devtools/bundled/devtools_app.html'),
    false
  );
  let webview = false;
  contents.events.get('will-attach-webview')({
    preventDefault: () => {
      webview = true;
    },
  });
  assert.equal(webview, true);
});

test('Chromium permission prompts follow the renderer policy', async () => {
  const app = desktop();
  await app.ready();
  const [main] = app.windows;
  const decide = (contents, permission, details) =>
    new Promise((resolve) =>
      app.permission.request(contents, permission, resolve, details)
    );
  const requestingUrl = `${appUrl}#/remote`;
  assert.equal(
    await decide(main.webContents, 'media', { requestingUrl, mediaTypes: [] }),
    true
  );
  assert.equal(
    await decide(main.webContents, 'media', {
      requestingUrl,
      mediaTypes: ['video'],
    }),
    false
  );
  assert.equal(
    await decide(main.webContents, 'media', {
      requestingUrl: 'https://evil.example/',
      mediaTypes: [],
    }),
    false
  );
  assert.equal(await decide({}, 'clipboard-read', { requestingUrl }), false);
  assert.equal(
    await decide(main.webContents, 'geolocation', { requestingUrl }),
    false
  );
  assert.equal(
    app.permission.check(
      main.webContents,
      'clipboard-sanitized-write',
      'file:///',
      {
        requestingUrl,
      }
    ),
    true
  );
  assert.equal(
    app.permission.check(main.webContents, 'notifications', 'file:///', {
      requestingUrl,
    }),
    false
  );
});
