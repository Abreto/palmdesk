// Checks, in a real Electron runtime, the behaviour the renderer guards in
// electron-main/index.ts rely on: sandboxed preload API, sender frame URLs,
// navigation and window.open interception, the CSP and the permission
// request that desktop capture makes. It loads the built app with stub IPC
// handlers, blocks all network access and denies every permission, so it
// needs no backend and never shows an OS permission prompt.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { app, BrowserWindow, ipcMain, session } = require('electron');

const root = path.resolve(__dirname, '../..');
const load = require('./load-source.cjs');

const security = load('electron-main/renderer-security.ts');
const { IPC_EVENT } = load('src/event.ts');
const entry = pathToFileURL(path.join(root, 'dist/index.html')).href;
const preload = path.join(root, 'electron-dist/preload.mjs');
const artifacts = path.join(root, '.local/renderer-guards');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', path.join(artifacts, 'profile'));

const navigations = [];
const windowOpen = [];
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    windowOpen.push(url);
    return { action: 'deny' };
  });
  contents.on('will-frame-navigate', (event) => {
    const allowed = security.isAppDocumentUrl(event.url, entry);
    navigations.push({ url: event.url, allowed });
    if (!allowed) event.preventDefault();
  });
});

const timeout = setTimeout(() => {
  console.error('TIMEOUT');
  app.exit(1);
}, 60000);

function stubIpc(senders) {
  const reply = (channel, data) =>
    ipcMain.handle(channel, (event, request) => {
      const frame = event.senderFrame;
      senders.push({
        channel,
        topLevel: !!frame && !frame.parent,
        trusted: !!frame && security.isAppDocumentUrl(frame.url, entry),
      });
      return { code: 0, requestId: request?.requestId, data };
    });
  reply(IPC_EVENT.getPlatform, { platform: process.platform });
  reply(IPC_EVENT.scaleFactor, { scaleFactor: 1, platform: process.platform });
  reply(IPC_EVENT.getPrimaryDisplaySize, { width: 1440, height: 900 });
  reply(IPC_EVENT.capturePermissions, {
    screen: 'denied',
    accessibility: false,
    platform: process.platform,
    appName: 'PalmDesk guard smoke',
    packaged: false,
    targetApps: [],
  });
  reply(IPC_EVENT.getCaptureSources, { sources: [] });
  reply(IPC_EVENT.stopCapture, {});
  reply(IPC_EVENT.sessionReaderSettings, { enabled: false, supported: true });
  ipcMain.on(IPC_EVENT.workAreaSize, (event) =>
    event.sender.send(IPC_EVENT.response_workAreaSize, {
      data: { width: 1440, height: 900 },
    })
  );
  ipcMain.on(IPC_EVENT.setAlwaysOnTop, () => {});
}

app
  .whenReady()
  .then(async () => {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => callback({ cancel: true })
    );
    const permissions = [];
    session.defaultSession.setPermissionRequestHandler(
      (_contents, permission, callback, details) => {
        permissions.push({
          permission,
          mediaTypes: details.mediaTypes,
          trusted: security.isAppDocumentUrl(details.requestingUrl, entry),
        });
        callback(false);
      }
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    const senders = [];
    stubIpc(senders);

    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const violations = [];
    win.webContents.on('console-message', (_event, _level, message) => {
      if (message.includes('Content Security Policy')) violations.push(message);
    });
    await win.loadFile(path.join(root, 'dist/index.html'), { hash: 'remote' });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const page = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      out.csp = !!document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      out.api = Object.keys(window.electronAPI.ipcRenderer).sort();
      out.rendered = !!document.querySelector('.page-heading h1');
      try {
        await window.electronAPI.ipcRenderer.invoke('showTargetApplication', {});
        out.blockedInvoke = 'allowed';
      } catch (error) {
        out.blockedInvoke = error.message;
      }
      out.windowOpen = window.open('https://example.com/');
      out.inlineScript = await new Promise((resolve) => {
        document.addEventListener('securitypolicyviolation',
          (event) => resolve(event.violatedDirective), { once: true });
        const script = document.createElement('script');
        script.textContent = 'window.inlineRan = true';
        document.head.appendChild(script);
        setTimeout(() => resolve(window.inlineRan ? 'executed' : 'no event'), 1000);
      });
      try { new Function('return 1')(); out.eval = 'allowed'; }
      catch (error) { out.eval = error.name; }
      try {
        await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'window:1:0' } },
        });
        out.desktopCapture = 'granted';
      } catch (error) {
        out.desktopCapture = error.name;
      }
      return out;
    })()`);
    await win.webContents.executeJavaScript(
      `location.href = 'https://example.com/'; 0`
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const urlAfterNavigation = win.webContents.getURL();

    const foreign = new BrowserWindow({
      show: false,
      webPreferences: { preload, sandbox: true, contextIsolation: true },
    });
    await foreign.loadURL('data:text/html,<title>foreign</title>');
    await foreign.webContents.executeJavaScript(
      `window.electronAPI.ipcRenderer.invoke('getPlatform', {})`
    );

    const result = {
      electron: process.versions.electron,
      page,
      navigations,
      windowOpen,
      urlAfterNavigation,
      senders,
      permissions,
      violations,
    };
    fs.writeFileSync(
      path.join(artifacts, 'result.json'),
      JSON.stringify(result, null, 2)
    );
    assert.equal(page.csp, true);
    assert.equal(page.rendered, true);
    assert.deepEqual(page.api, ['invoke', 'on', 'send']);
    assert.match(page.blockedInvoke, /not allowed/);
    assert.equal(page.windowOpen, null);
    assert.deepEqual(windowOpen, ['https://example.com/']);
    assert.equal(page.inlineScript, 'script-src-elem');
    assert.equal(page.eval, 'EvalError');
    assert.equal(page.desktopCapture, 'NotAllowedError');
    // The policy must allow the request desktop capture actually makes (its
    // name changed in Electron 45), and only for the host window.
    assert.equal(permissions.length, 1);
    const [capture] = permissions;
    assert.equal(capture.trusted, true);
    const request = { trusted: true, mediaTypes: capture.mediaTypes };
    assert.equal(
      security.isPermissionAllowed(capture.permission, {
        ...request,
        mainWindow: true,
      }),
      true
    );
    assert.equal(
      security.isPermissionAllowed(capture.permission, {
        ...request,
        mainWindow: false,
      }),
      false
    );
    assert.deepEqual(navigations, [
      { url: 'https://example.com/', allowed: false },
    ]);
    assert.ok(security.isAppDocumentUrl(urlAfterNavigation, entry));
    assert.ok(senders.length > 1);
    assert.deepEqual(senders.at(-1), {
      channel: IPC_EVENT.getPlatform,
      topLevel: true,
      trusted: false,
    });
    senders
      .slice(0, -1)
      .forEach((sender) =>
        assert.deepEqual([sender.topLevel, sender.trusted], [true, true])
      );
    // Only the deliberately injected inline script may violate the CSP.
    assert.equal(violations.length, 1);
    console.log(JSON.stringify(result, null, 2));
    clearTimeout(timeout);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
