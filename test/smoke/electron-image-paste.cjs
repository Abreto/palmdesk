// Exercise real macOS image decoding and clipboard paste in a disposable,
// hidden Electron window. This does not target Codex or synthesize OS keys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, clipboard, nativeImage } = require('electron');
const load = require('./load-source.cjs');
const { pasteClipboardImage } = load('electron-main/image-paste.ts');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.local/image-paste');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'electron-user-data'));
app.disableHardwareAcceleration();

app
  .whenReady()
  .then(async () => {
    let window;
    let lastWritten;
    const saved = {
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      rtf: clipboard.readRTF(),
      image: clipboard.readImage(),
    };
    try {
      assert.equal(process.platform, 'darwin');
      window = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true },
      });
      await window.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(`
      <div id="prompt" contenteditable="true">existing draft</div>
      <script>
        window.pastes = [];
        document.querySelector('#prompt').focus();
        document.addEventListener('paste', async (event) => {
          event.preventDefault();
          const file = event.clipboardData.files[0];
          if (!file) return;
          const bitmap = await createImageBitmap(file);
          window.pastes.push({ mime: file.type, width: bitmap.width, height: bitmap.height });
          bitmap.close();
        });
      </script>
    `)}`
      );
      const results = [];
      for (const [filename, mime] of [
        ['logo.png', 'image/png'],
        ['billd.jpg', 'image/jpeg'],
      ]) {
        const bytes = new Uint8Array(
          fs.readFileSync(path.join(root, 'src/assets/img', filename))
        );
        const expected = nativeImage
          .createFromBuffer(Buffer.from(bytes))
          .getSize();
        await pasteClipboardImage({ mime, bytes }, () => true, {
          decode: (value) => nativeImage.createFromBuffer(Buffer.from(value)),
          write: (image) => {
            clipboard.writeImage(image);
            lastWritten = clipboard.readImage().toPNG();
          },
          press: async () => {
            window.webContents.paste();
          },
          release: async () => {},
        });
        const deadline = Date.now() + 5000;
        let result;
        do {
          result = await window.webContents.executeJavaScript(
            'window.pastes.shift()'
          );
          if (!result) await delay(25);
        } while (!result && Date.now() < deadline);
        assert.deepEqual(result, { mime: 'image/png', ...expected });
        assert.equal(
          await window.webContents.executeJavaScript(
            'document.querySelector("#prompt").textContent'
          ),
          'existing draft'
        );
        results.push({ input: mime, pasted: result });
      }
      fs.writeFileSync(
        path.join(output, 'electron-result.json'),
        JSON.stringify(
          {
            platform: process.platform,
            electron: process.versions.electron,
            results,
            limitation:
              'Uses webContents.paste in a fixture; actual Codex and system Cmd+V require manual verification.',
          },
          null,
          2
        )
      );
      console.log(
        'PASS real PNG/JPEG decoding, macOS image clipboard and Electron paste events'
      );
    } finally {
      // Restore common clipboard content only if it still contains our test image.
      if (lastWritten && clipboard.readImage().toPNG().equals(lastWritten))
        clipboard.write(saved);
      window?.destroy();
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
