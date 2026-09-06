const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const {
  app,
  BrowserWindow,
  desktopCapturer,
  systemPreferences,
} = require('electron');
const load = require('./load-source.cjs');
const { NativeWindowBridge, matchCaptureSources } = load(
  'electron-main/native-window.ts'
);
const { CaptureSession } = load('electron-main/capture-session.ts');

const root = path.resolve(__dirname, '../..');
app.setPath('userData', path.join(root, '.local/native-window-spaces-profile'));
const native = new NativeWindowBridge(
  path.join(root, 'native-bin/codex-window')
);
const ownWindows = [];
async function list() {
  const available = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 64, height: 64 },
  });
  const owners = await native.request('list');
  // These disposable windows are owned by the test runner, not a production host.
  return matchCaptureSources(
    available,
    owners.filter((w) => w.ownerPid === process.pid)
  );
}
const capture = new CaptureSession({}, list, async (source) => ({
  ...source,
  ...(await native.request('focus', {
    nativeId: source.nativeId,
    ownerPid: source.ownerPid,
    bundleId: source.bundleId,
  })),
}));
async function until(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(150);
  }
  throw new Error(`Timed out: ${label}`);
}
async function fixture(title, color) {
  const window = new BrowserWindow({
    width: 700,
    height: 500,
    title,
    webPreferences: { backgroundThrottling: false },
  });
  ownWindows.push(window);
  await window.loadURL(
    `data:text/html,<title>${title}</title><body style="background:${encodeURIComponent(color)}"><h1>PalmDesk temporary test window</h1></body>`
  );
  const source = await until(
    async () =>
      (await list()).find(
        (w) => w.name === title && w.isOnScreen && w.captureId
      ),
    title
  );
  return { window, source };
}
async function verifyCapture(source, colorChannel) {
  const result = await capture.begin(source.id, source);
  assert.equal(result.source.nativeId, source.nativeId);
  assert.equal(result.source.isOnScreen, true);
  const available = await until(
    async () =>
      (
        await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width: 64, height: 64 },
        })
      ).find((w) => w.id === result.stream.id),
    'capture source after activation'
  );
  assert.equal(available.thumbnail.isEmpty(), false);
  const size = available.thumbnail.getSize();
  const pixels = available.thumbnail.toBitmap();
  const offset =
    (Math.floor(size.height * 0.7) * size.width + Math.floor(size.width / 2)) *
    4;
  assert.ok(
    pixels[offset + colorChannel] > 80,
    'selected window thumbnail is nonblank'
  );
  assert.ok(
    pixels[offset + colorChannel] >
      pixels[offset + (colorChannel === 1 ? 2 : 1)],
    'selected window color matches its identity'
  );
  await capture.end(result.sessionId);
}

app.whenReady().then(async () => {
  let failed = false;
  try {
    assert.equal(
      systemPreferences.getMediaAccessStatus('screen'),
      'granted',
      'grant screen recording to the test Electron app first'
    );
    assert.equal(
      (await native.request('permissions')).accessibility,
      true,
      'grant accessibility to the test Electron app first'
    );
    const normal = await fixture('PalmDesk normal test', '#147e67');
    const fullscreen = await fixture('PalmDesk fullscreen test', '#b34b63');
    fullscreen.window.setFullScreen(true);
    const offscreen = await until(
      async () =>
        (await list()).find((w) => w.id === normal.source.id && !w.isOnScreen),
      'normal window on another Space'
    );
    assert.equal(offscreen.captureId, undefined);
    await verifyCapture(offscreen, 1);
    console.log(
      'PASS all-Spaces listing, switch to exact normal window, and capture pixels'
    );

    const fullscreenSource = await until(
      async () =>
        (await list()).find(
          (w) => w.id === fullscreen.source.id && !w.isOnScreen
        ),
      'fullscreen window on another Space'
    );
    await verifyCapture(fullscreenSource, 2);
    console.log(
      'PASS switch back to exact fullscreen window and capture pixels'
    );

    fullscreen.window.destroy();
    await until(
      async () =>
        (await list()).some((w) => w.id === normal.source.id && w.isOnScreen),
      'return to normal desktop'
    );
    const sibling = await fixture('PalmDesk minimized sibling', '#b34b63');
    sibling.window.minimize();
    normal.window.minimize();
    const minimized = await until(
      async () =>
        (await list()).find((w) => w.id === normal.source.id && !w.isOnScreen),
      'minimized window remains listed'
    );
    await verifyCapture(minimized, 1);
    assert.equal(normal.window.isMinimized(), false);
    assert.equal(sibling.window.isMinimized(), true);
    console.log(
      'PASS restore only the selected minimized window and capture pixels'
    );

    sibling.window.restore();
    sibling.window.setBounds(normal.window.getBounds());
    await sibling.window.webContents.executeJavaScript(
      'document.title = "PalmDesk normal test"'
    );
    sibling.window.setTitle('PalmDesk normal test');
    const identical = await until(async () => {
      const sources = (await list()).filter(
        (w) => w.name === 'PalmDesk normal test' && w.isOnScreen
      );
      return sources.length === 2 ? sources : undefined;
    }, 'identical title and frame windows');
    for (const selected of identical) {
      const focused = await native.request('focus', {
        nativeId: selected.nativeId,
        ownerPid: selected.ownerPid,
        bundleId: selected.bundleId,
      });
      assert.equal(focused.nativeId, selected.nativeId);
      const expected =
        selected.nativeId === normal.source.nativeId
          ? normal.window
          : sibling.window;
      assert.equal(expected.isFocused(), true);
    }
    console.log(
      'PASS same-application windows with identical titles and bounds retain exact focus'
    );
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    await capture.end();
    native.close();
    for (const window of ownWindows)
      if (!window.isDestroyed()) window.destroy();
    app.exit(failed ? 1 : 0);
  }
});
