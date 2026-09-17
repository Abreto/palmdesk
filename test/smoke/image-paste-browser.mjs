import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({
  executablePath:
    process.env.SMOKE_BROWSER_EXECUTABLE ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const artifacts = path.resolve('.local/image-paste');
await mkdir(artifacts, { recursive: true });
const pngPath = path.resolve('src/assets/img/logo.png');
const png = [...(await readFile(pngPath))];
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5196/test/smoke/image-paste.html');
  await page.getByRole('button', { name: '选择图片', exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector('.image-tools button').disabled
  );
  const draft = page.getByLabel('发送到电脑的文字');
  await draft.fill('请分析这张图片，保留我的草稿');
  await page.getByLabel('选择图片文件').setInputFiles(pngPath);
  await page.getByAltText('待粘贴的图片预览').waitFor();
  await page.screenshot({
    path: path.join(artifacts, 'phone-preview.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '粘贴到 Codex', exact: true }).click();
  await page
    .getByText('已执行粘贴，请在 Codex 输入框中确认图片，再发送消息。', {
      exact: true,
    })
    .waitFor();
  assert.deepEqual(await page.evaluate(() => window.__imageSmoke.images[0]), {
    mime: 'image/png',
    bytes: png,
  });
  assert.equal(await draft.inputValue(), '请分析这张图片，保留我的草稿');
  assert.equal(
    await page.evaluate(() =>
      window.__imageSmoke.behaviors.some(
        (value) =>
          value.type === 'keyboardType' || value.type === 'keyboardPressKey'
      )
    ),
    false
  );
  console.log(
    'PASS phone file selection → real WebRTC → exact image bytes; text draft preserved'
  );

  await draft.evaluate((element, bytes) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File([new Uint8Array(bytes)], 'pasted.png', { type: 'image/png' })
    );
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      })
    );
  }, png);
  await page.getByAltText('待粘贴的图片预览').waitFor();
  await page.getByRole('button', { name: '粘贴到 Codex', exact: true }).click();
  await page.waitForFunction(() => window.__imageSmoke.images.length === 2);
  assert.equal(await draft.inputValue(), '请分析这张图片，保留我的草稿');
  console.log('PASS textarea image paste uses the same upload path');

  await page.getByLabel('选择图片文件').setInputFiles({
    name: 'wrong.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await page.getByText('请选择 PNG 或 JPEG 图片', { exact: true }).waitFor();
  assert.equal(await page.getByAltText('待粘贴的图片预览').count(), 0);
  await page
    .getByLabel('选择图片文件')
    .setInputFiles(path.resolve('src/assets/img/billd.jpg'));
  await page.getByAltText('待粘贴的图片预览').waitFor();
  await page.getByRole('button', { name: '粘贴到 Codex', exact: true }).click();
  await page.waitForFunction(() => window.__imageSmoke.images.length === 3);
  assert.equal(
    await page.evaluate(() => window.__imageSmoke.images[2].mime),
    'image/jpeg'
  );
  console.log('PASS rejected image can be replaced with a valid JPEG');

  await page.getByLabel('选择图片文件').setInputFiles(pngPath);
  await page.evaluate(() => {
    window.__imageSmoke.delay = true;
  });
  await page.getByRole('button', { name: '粘贴到 Codex', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).waitFor();
  await page.waitForFunction(() => window.__imageSmoke.pendingPaste);
  await page.getByRole('button', { name: '切到阅读', exact: true }).click();
  await page.getByText(/图片传输已取消/).waitFor();
  await page.waitForFunction(() => window.__imageSmoke.cancelled.size === 1);
  await page.evaluate(() => {
    window.__imageSmoke.release();
    window.__imageSmoke.delay = false;
  });
  await page.getByRole('button', { name: '返回窗口', exact: true }).click();
  await page.getByRole('button', { name: '粘贴到 Codex', exact: true }).click();
  await page.waitForFunction(() => window.__imageSmoke.images.length === 4);
  console.log(
    'PASS switching away cancels pending paste and retains the image for explicit retry'
  );

  await page.getByLabel('仅观看').check();
  assert.equal(
    await page
      .getByRole('button', { name: '选择图片', exact: true })
      .isDisabled(),
    true
  );
  await page.getByLabel('仅观看').uncheck();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  );
  assert.deepEqual(errors, []);
  console.log('PASS watch-only controls and mobile layout');

  // Browser permission prompts are not automated; exercise both results of the
  // async clipboard API without changing the computer's clipboard.
  await page.evaluate((bytes) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: async () => [
          {
            types: ['image/png'],
            getType: async () =>
              new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
          },
        ],
      },
    });
  }, png);
  await page.getByRole('button', { name: '粘贴图片', exact: true }).click();
  await page.getByAltText('待粘贴的图片预览').waitFor();
  await page.getByRole('button', { name: '粘贴到 Codex', exact: true }).click();
  await page.waitForFunction(() => window.__imageSmoke.images.length === 5);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        },
      },
    });
  });
  await page.getByRole('button', { name: '粘贴图片', exact: true }).click();
  await page
    .getByText('未能读取剪贴板，请允许粘贴，或使用「选择图片」', {
      exact: true,
    })
    .waitFor();
  await page.getByLabel('选择图片文件').setInputFiles(pngPath);
  await page.getByAltText('待粘贴的图片预览').waitFor();
  assert.equal(await draft.inputValue(), '请分析这张图片，保留我的草稿');
  assert.deepEqual(errors, []);
  console.log(
    'PASS clipboard button handles successful reads and permission denial with file-picker recovery'
  );

  const reset = async () => {
    await page.reload();
    await page.waitForFunction(
      () =>
        document.querySelector('.image-tools button') &&
        !document.querySelector('.image-tools button').disabled
    );
  };
  await reset();
  await draft.fill('保留草稿');
  await page.getByLabel('选择图片文件').setInputFiles(pngPath);
  await page.getByAltText('待粘贴的图片预览').waitFor();
  await page.evaluate(() => {
    window.__imageSmoke.events.length = 0;
    window.__imageSmoke.holdControls = true;
  });
  const video = await page.locator('video').boundingBox();
  await page.touchscreen.tap(
    video.x + video.width / 2,
    video.y + video.height * 0.85
  );
  await page.getByRole('button', { name: '粘贴到 Codex', exact: true }).tap();
  await page.waitForFunction(() => window.__imageSmoke.receivedUploads === 1);
  assert.equal(await page.evaluate(() => window.__imageSmoke.images.length), 0);
  await page.evaluate(() => window.__imageSmoke.releaseControls());
  await page.waitForFunction(() => window.__imageSmoke.images.length === 1);
  await page.waitForTimeout(300);
  const orderedEvents = await page.evaluate(() => window.__imageSmoke.events);
  assert.equal(
    orderedEvents.filter((value) => value === 'leftClick').length,
    1
  );
  assert.ok(
    orderedEvents.indexOf('leftClick') < orderedEvents.indexOf('paste')
  );
  assert.equal(await draft.inputValue(), '保留草稿');
  console.log(
    'PASS rapid prompt tap survives upload startup; an image arriving first waits for ordered input'
  );

  await reset();
  await draft.fill('收起面板也保留草稿');
  await page.getByLabel('选择图片文件').setInputFiles(pngPath);
  await page.getByAltText('待粘贴的图片预览').waitFor();
  await page.evaluate(() => {
    window.__imageSmoke.delay = true;
  });
  await page.getByRole('button', { name: '粘贴到 Codex', exact: true }).click();
  await page.waitForFunction(() => window.__imageSmoke.pendingPaste);
  const blockedPaste = await draft.evaluate((element, bytes) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '可粘贴的文字');
    clipboardData.items.add(
      new File([new Uint8Array(bytes)], 'extra.png', { type: 'image/png' })
    );
    const event = new ClipboardEvent('paste', {
      clipboardData,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, png);
  assert.equal(blockedPaste, false);
  assert.equal(await page.locator('.image-name').innerText(), 'logo.png');
  await page.getByRole('button', { name: '文字输入', exact: true }).click();
  await page.waitForFunction(() => window.__imageSmoke.cancelled.size === 1);
  await page.evaluate(() => {
    window.__imageSmoke.release();
    window.__imageSmoke.delay = false;
  });
  await page.getByRole('button', { name: '文字输入', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: '发送文字', exact: true })
      .isDisabled(),
    false
  );
  assert.equal(
    await page.getByRole('button', { name: 'Esc', exact: true }).isDisabled(),
    false
  );
  assert.equal(await draft.inputValue(), '收起面板也保留草稿');
  assert.equal(await page.evaluate(() => window.__imageSmoke.images.length), 0);
  console.log(
    'PASS mixed clipboard text keeps its default paste; hiding an active upload unlocks remote input'
  );

  await reset();
  await page.getByLabel('选择图片文件').setInputFiles(pngPath);
  await page.getByAltText('待粘贴的图片预览').waitFor();
  await page.evaluate(() => {
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function () {
      const bytes = await read.call(this);
      if (this.name === 'replacement.jpg') {
        window.__replacementReading = true;
        await new Promise((resolve) => {
          window.__releaseReplacement = resolve;
        });
      }
      return bytes;
    };
  });
  const jpeg = await readFile('src/assets/img/billd.jpg');
  await page.getByLabel('选择图片文件').setInputFiles({
    name: 'replacement.jpg',
    mimeType: 'image/jpeg',
    buffer: jpeg,
  });
  await page.waitForFunction(() => window.__replacementReading);
  await page.getByText('正在读取图片…', { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: '粘贴到 Codex', exact: true })
      .count(),
    0
  );
  assert.equal(await page.getByAltText('待粘贴的图片预览').count(), 0);
  assert.equal(await page.evaluate(() => window.__imageSmoke.images.length), 0);
  await page.evaluate(() => window.__releaseReplacement());
  await page.getByText('replacement.jpg', { exact: true }).waitFor();
  await page.getByRole('button', { name: '粘贴到 Codex', exact: true }).click();
  await page.waitForFunction(() => window.__imageSmoke.images.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__imageSmoke.images[0]), {
    mime: 'image/jpeg',
    bytes: [...jpeg],
  });
  console.log(
    'PASS replacing an image blocks stale sends until the new bytes are ready'
  );

  await reset();
  await page.getByLabel('选择图片文件').setInputFiles(pngPath);
  await page.getByAltText('待粘贴的图片预览').waitFor();
  await page.evaluate(() => window.__imageSmoke.closeImages());
  await page
    .getByRole('button', { name: '重新连接图片', exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: '粘贴到 Codex', exact: true })
      .isDisabled(),
    true
  );
  await page.getByRole('button', { name: '重新连接图片', exact: true }).click();
  await page.waitForFunction(() => window.__imageSmoke.imageConnections === 2);
  await page.getByRole('button', { name: '粘贴到 Codex', exact: true }).click();
  await page.waitForFunction(() => window.__imageSmoke.images.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__imageSmoke.images[0]), {
    mime: 'image/png',
    bytes: png,
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS a closed image channel reconnects without restarting window control or losing the selected image'
  );
} finally {
  await browser.close();
}
