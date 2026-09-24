/* eslint-disable no-restricted-syntax -- Clipboard and native window scenarios must execute in order. */
// Real Windows clipboard + SendInput integration, using only test-owned windows.
// The fixture is named Codex.exe to exercise the production executable identity
// gate. This is not a real Codex attachment or physical-phone acceptance test.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { rm } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const { app, clipboard, nativeImage } = require('electron');

const load = require('./load-source.cjs');

const nativeModule = load('electron-main/native-window.ts');
const { NativeWindowBridge } = nativeModule;
const { pasteWindowsClipboardImage } = load('electron-main/image-paste.ts', {
  './native-window': nativeModule,
});
const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.local/image-paste');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'windows-electron-user-data'));
app.disableHardwareAcceleration();

app
  .whenReady()
  .then(async () => {
    assert.equal(process.platform, 'win32');
    assert.equal(
      process.env.PALMDESK_NATIVE_SMOKE,
      'true',
      'Opt in to disposable window focus with PALMDESK_NATIVE_SMOKE=true'
    );
    const directory = fs.mkdtempSync(path.join(output, 'windows-fixture-'));
    const executable = path.join(directory, 'Codex.exe');
    const windows = process.env.SystemRoot || 'C:\\Windows';
    const compiler = ['Framework64', 'Framework']
      .map((framework) =>
        path.join(windows, 'Microsoft.NET', framework, 'v4.0.30319/csc.exe')
      )
      .find(fs.existsSync);
    const native = new NativeWindowBridge(
      path.join(root, 'native-bin/palmdesk-window.exe')
    );
    const fixture = new NativeWindowBridge(executable);
    const saved = {
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      rtf: clipboard.readRTF(),
      image: clipboard.readImage(),
    };
    const marker = `PalmDesk clipboard smoke ${Date.now()}`;
    let lastImage;
    let writes = 0;
    try {
      assert.ok(compiler, '.NET Framework C# compiler is required');
      execFileSync(
        compiler,
        [
          '/nologo',
          '/target:exe',
          '/platform:anycpu',
          '/reference:System.Windows.Forms.dll',
          '/reference:System.Drawing.dll',
          '/reference:System.Web.Extensions.dll',
          `/out:${executable}`,
          path.join(__dirname, 'fixtures/windows-test-window.cs'),
        ],
        { windowsHide: true }
      );
      const ready = await fixture.request('status');
      const owned = (await native.request('list')).filter(
        (entry) => entry.ownerPid === ready.ownerPid
      );
      assert.equal(owned.length, 2);
      const [target, other] = ready.windows.map((entry) =>
        owned.find((window) => window.nativeId === entry.nativeId)
      );
      assert.ok(target && other);
      const driver = {
        decode: (bytes) => nativeImage.createFromBuffer(Buffer.from(bytes)),
        write: (image) => {
          clipboard.writeImage(image);
          lastImage = clipboard.readImage().toPNG();
          writes += 1;
        },
        request: (command, identity, current) =>
          native.request(command, identity, current),
      };
      const draft = '请分析截图 / Keep this English draft，别发送。';
      await native.request('focus', target);
      await fixture.request('draft', {
        nativeId: target.nativeId,
        text: draft,
      });
      const results = [];
      for (const [filename, mime] of [
        ['logo.png', 'image/png'],
        ['billd.jpg', 'image/jpeg'],
      ]) {
        const bytes = new Uint8Array(
          fs.readFileSync(path.join(root, 'src/assets/img', filename))
        );
        const expected = driver.decode(bytes);
        await pasteWindowsClipboardImage(
          { mime, bytes },
          target,
          () => true,
          driver
        );
        const deadline = Date.now() + 5000;
        let status;
        do {
          status = await fixture.request('status');
          if (status.windows[0].images.length === results.length + 1) break;
          await delay(25);
        } while (Date.now() < deadline);
        const prompt = status.windows[0];
        assert.equal(
          prompt.images.length,
          results.length + 1,
          'Ctrl+V creates exactly one image paste'
        );
        assert.equal(prompt.text, draft);
        assert.equal(
          status.windows[1].images.length,
          0,
          'the other window receives no image'
        );
        assert.equal(status.controlHeld, false);
        assert.equal(status.pasteKeyHeld, false);
        const pasted = nativeImage.createFromBuffer(
          Buffer.from(prompt.images.at(-1), 'base64')
        );
        assert.deepEqual(pasted.getSize(), expected.getSize());
        assert.deepEqual(
          pasted.toBitmap(),
          expected.toBitmap(),
          'clipboard preserves decoded pixels'
        );
        results.push({
          input: mime,
          size: expected.getSize(),
          pixelsEqual: true,
          draftPreserved: true,
        });
      }
      const payload = {
        mime: 'image/png',
        bytes: new Uint8Array(
          fs.readFileSync(path.join(root, 'src/assets/img/logo.png'))
        ),
      };
      clipboard.writeText(marker);
      await assert.rejects(
        pasteWindowsClipboardImage(payload, target, () => false, driver),
        /取消/
      );
      let current = true;
      await assert.rejects(
        pasteWindowsClipboardImage(payload, target, () => current, {
          ...driver,
          request: async (...args) => {
            await native.request(...args);
            current = false;
          },
        }),
        /取消/
      );
      for (const change of [
        { ownerPid: process.pid },
        { bundleId: target.bundleId.replace(/#[^#]+$/, '#1') },
        { bundleId: target.bundleId.replace(/codex\.exe/i, 'other.exe') },
      ]) {
        await assert.rejects(
          pasteWindowsClipboardImage(
            payload,
            { ...target, ...change },
            () => true,
            driver
          )
        );
      }
      await native.request('focus', other);
      await assert.rejects(
        pasteWindowsClipboardImage(payload, target, () => true, driver),
        /前台/
      );
      assert.equal(
        (await fixture.request('status')).foregroundNativeId,
        other.nativeId
      );
      // Losing focus between clipboard verification and SendInput is also rejected.
      await native.request('focus', target);
      await assert.rejects(
        pasteWindowsClipboardImage(payload, target, () => true, {
          ...driver,
          request: async (command, identity, current) => {
            if (command === 'pasteImage') await native.request('focus', other);
            return native.request(command, identity, current);
          },
        }),
        /前台/
      );
      assert.equal(
        writes,
        3,
        'only the two successful pastes and the focus-race case wrote an image'
      );
      await fixture.request('close', { nativeId: target.nativeId });
      await assert.rejects(
        pasteWindowsClipboardImage(payload, target, () => true, driver),
        /关闭|变化/
      );
      const final = await fixture.request('status');
      assert.equal(final.windows[0].images.length, 2);
      assert.equal(final.windows[1].images.length, 0);
      assert.equal(final.controlHeld, false);
      assert.equal(final.pasteKeyHeld, false);
      fs.writeFileSync(
        path.join(output, 'windows-result.json'),
        JSON.stringify(
          {
            platform: process.platform,
            electron: process.versions.electron,
            results,
            rejected: [
              'cancelled',
              'cancelled during verification',
              'stale PID/path/start time',
              'lost foreground',
              'lost foreground after clipboard write',
              'closed target',
            ],
            limitation:
              'Disposable Codex.exe fixture; no real Codex prompt or physical phone. Privilege mismatch still requires a manual elevated-target test.',
          },
          null,
          2
        )
      );
      console.log(
        'PASS real Windows PNG/JPEG clipboard pixels, Ctrl+V, Chinese/English draft, key release, cancellation and stale/focus/closed-target rejection'
      );
    } finally {
      fixture.close();
      native.close();
      if (
        clipboard.readText() === marker ||
        (lastImage && clipboard.readImage().toPNG().equals(lastImage))
      )
        clipboard.write(saved);
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
