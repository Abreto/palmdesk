const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const { app, BrowserWindow } = require('electron');

const load = require('./load-source.cjs');

const { NativeWindowBridge } = load('electron-main/native-window.ts');

const root = path.resolve(__dirname, '../..');
app.setPath('userData', path.join(root, '.local/native-window-focus-profile'));
const native = new NativeWindowBridge(
  path.join(root, 'native-bin/codex-window')
);
const fixtures = [];
async function until(check, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(25);
  }
  throw new Error(`Timed out: ${label}`);
}
async function ownWindows() {
  return (await native.request('list')).filter(
    (item) => item.ownerPid === process.pid
  );
}
async function fixture(title, bounds = {}) {
  const window = new BrowserWindow({
    width: 700,
    height: 500,
    ...bounds,
    title,
  });
  fixtures.push(window);
  await window.loadURL(
    `data:text/html,<title>${title}</title><p>PalmDesk temporary focus fixture</p>`
  );
  const source = await until(
    async () =>
      (await ownWindows()).find(
        (item) => item.name === title && item.isOnScreen
      ),
    title
  );
  return { window, source };
}

app.whenReady().then(async () => {
  let failed = false;
  try {
    assert.equal((await native.request('permissions')).accessibility, true);
    const first = await fixture('PalmDesk focus fixture A');
    const second = await fixture(
      'PalmDesk focus fixture B',
      first.window.getBounds()
    );
    await second.window.webContents.executeJavaScript(
      'document.title = "PalmDesk focus fixture A"'
    );
    // eslint-disable-next-line no-restricted-syntax -- Focus requests must run in order.
    for (const selected of [first, second, first]) {
      // The first request can activate; the second exercises live focus verification.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const focused = await native.request('focus', selected.source);
        assert.equal(focused.nativeId, selected.source.nativeId);
        assert.equal(selected.window.isFocused(), true);
      }
    }
    console.log('PASS identical titles and frames retain exact native focus');

    // eslint-disable-next-line no-restricted-syntax -- Keep native requests sequential.
    for (const mismatch of [
      { nativeId: 0 },
      { ownerPid: 0 },
      { bundleId: 'invalid.focus.fixture' },
    ]) {
      await assert.rejects(
        native.request('focus', { ...first.source, ...mismatch }),
        { code: 'unavailable' }
      );
    }
    console.log('PASS live focus rejects mismatched window identities');

    const bounds = first.window.getBounds();
    first.window.setBounds({
      ...bounds,
      x: bounds.x + 20,
      y: bounds.y + 20,
      width: bounds.width + 40,
    });
    const expected = first.window.getBounds();
    // WindowServer publishes resize notifications asynchronously.
    await until(async () => {
      const current = (await ownWindows()).find(
        (item) => item.nativeId === first.source.nativeId
      );
      return (
        current &&
        ['x', 'y', 'width', 'height'].every(
          (key) => current.bounds[key] === expected[key]
        )
      );
    }, 'resized window bounds');
    assert.deepEqual(
      (await native.request('focus', first.source)).bounds,
      expected
    );
    console.log('PASS already-focused windows return fresh bounds');

    second.window.minimize();
    first.window.minimize();
    await until(
      async () =>
        (await ownWindows()).filter((item) => !item.isOnScreen).length === 2,
      'minimized fixtures'
    );
    await native.request('focus', first.source);
    assert.equal(first.window.isMinimized(), false);
    assert.equal(second.window.isMinimized(), true);
    console.log('PASS only the selected minimized window is restored');

    second.window.destroy();
    await assert.rejects(native.request('focus', second.source));
    console.log('PASS closed windows reject input focus');
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    native.close();
    fixtures.forEach((window) => {
      if (!window.isDestroyed()) window.destroy();
    });
    app.exit(failed ? 1 : 0);
  }
});
