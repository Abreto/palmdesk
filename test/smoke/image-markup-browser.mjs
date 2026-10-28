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
  // The fixture's peers are local; do not depend on multicast DNS resolution.
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});
const artifacts = path.resolve('.local/image-markup');
await mkdir(artifacts, { recursive: true });
const pngPath = path.resolve('src/assets/img/logo.png');
const png = [...(await readFile(pngPath))];
const portrait = { width: 390, height: 844 };
const landscape = { width: 844, height: 390 };
const errors = [];

async function openFixture(viewport) {
  const context = await browser.newContext({
    viewport,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5196/test/smoke/image-paste.html');
  await page.waitForFunction(
    () =>
      document.querySelector('.image-tools button') &&
      !document.querySelector('.image-tools button').disabled
  );
  const cdp = await context.newCDPSession(page);
  // CDP touch input produces the same touch pointer events as a phone.
  async function touch(type, touchPoints) {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  async function drag(points) {
    await touch('touchStart', [{ ...points[0], id: 1 }]);
    for (const point of points.slice(1))
      await touch('touchMove', [{ ...point, id: 1 }]);
    await touch('touchEnd', []);
  }
  return { context, page, drag };
}

function line(from, to, steps = 8) {
  return Array.from({ length: steps + 1 }, (_, index) => ({
    x: from.x + ((to.x - from.x) * index) / steps,
    y: from.y + ((to.y - from.y) * index) / steps,
  }));
}
// The canvas shows exactly `view`, in source pixels of the oriented image.
async function mapper(page, view) {
  const box = await page.locator('.editor-surface canvas').boundingBox();
  return (x, y) => ({
    x: box.x + ((x - view.x) * box.width) / view.width,
    y: box.y + ((y - view.y) * box.height) / view.height,
  });
}
function cropRect(page, imageWidth) {
  return page.evaluate((width) => {
    const scale =
      document.querySelector('.editor-surface canvas').getBoundingClientRect()
        .width / width;
    const style = document.querySelector('.crop-box').style;
    const value = (name) => Math.round(parseFloat(style[name]) / scale);
    return {
      x: value('left'),
      y: value('top'),
      width: value('width'),
      height: value('height'),
    };
  }, imageWidth);
}
function near(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) <= 1,
    `${label}: ${actual} is not ${expected}`
  );
}
async function generate(page, recipe) {
  return Buffer.from(
    await page.evaluate(async ({ width, height, type, quality, shapes }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (shapes === 'noise') {
        const data = context.createImageData(width, height);
        let seed = 1;
        for (let index = 0; index < data.data.length; index += 1) {
          seed = (seed * 1103515245 + 12345) >>> 0;
          data.data[index] = index % 4 === 3 ? 255 : seed >>> 24;
        }
        context.putImageData(data, 0, 0);
      } else
        shapes.forEach(([color, x, y, w, h]) => {
          context.fillStyle = color;
          context.fillRect(x, y, w, h);
        });
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, type, quality)
      );
      return [...new Uint8Array(await blob.arrayBuffer())];
    }, recipe)
  );
}
// Adds an EXIF APP1 segment with the given orientation after SOI.
function withOrientation(jpeg, orientation) {
  const exif = Buffer.from([
    0xff,
    0xe1,
    0x00,
    0x22,
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00,
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
}
// Pixels in a (2r+1)² window around each point of the decoded PNG.
function decode(page, bytes, points, radius = 2) {
  return page.evaluate(
    async ({ bytes, points, radius }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const area = ([x, y]) => {
        const left = Math.max(0, Math.round(x) - radius);
        const top = Math.max(0, Math.round(y) - radius);
        const { data } = context.getImageData(
          left,
          top,
          Math.min(radius * 2 + 1, bitmap.width - left),
          Math.min(radius * 2 + 1, bitmap.height - top)
        );
        return Array.from({ length: data.length / 4 }, (_, index) => [
          ...data.slice(index * 4, index * 4 + 4),
        ]);
      };
      return {
        width: bitmap.width,
        height: bitmap.height,
        samples: points.map(area),
      };
    },
    { bytes, points, radius }
  );
}
const is =
  ([red, green, blue], tolerance = 40) =>
  ([r, g, b, a]) =>
    a > 200 &&
    Math.abs(r - red) <= tolerance &&
    Math.abs(g - green) <= tolerance &&
    Math.abs(b - blue) <= tolerance;
const transparent = ([, , , alpha]) => alpha === 0;

async function checkLayout(page, orientation) {
  const layout = await page.evaluate(() => {
    const rect = (element) => element.getBoundingClientRect().toJSON();
    const one = (selector) => rect(document.querySelector(selector));
    return {
      dialog: one('.image-editor'),
      header: one('.editor-header'),
      stage: one('.editor-stage'),
      surface: one('.editor-surface'),
      tools: one('.editor-tools'),
      buttons: [...document.querySelectorAll('.image-editor button')].map(rect),
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  assert.deepEqual(
    [layout.dialog.width, layout.dialog.height],
    [layout.width, layout.height]
  );
  assert.ok(layout.scrollWidth <= layout.width);
  for (const button of layout.buttons) {
    assert.ok(
      button.left >= 0 &&
        button.top >= 0 &&
        button.right <= layout.width &&
        button.bottom <= layout.height,
      'every control stays on screen'
    );
    assert.ok(button.width >= 32 && button.height >= 32, 'touch-sized');
  }
  const { stage, surface } = layout;
  assert.ok(
    surface.left >= stage.left &&
      surface.top >= stage.top &&
      surface.right <= stage.right &&
      surface.bottom <= stage.bottom,
    'the image fits inside its stage'
  );
  if (orientation === 'portrait') {
    assert.ok(stage.top >= layout.header.bottom - 1);
    assert.ok(layout.tools.top >= stage.bottom - 1);
  } else {
    // Phones in landscape keep the whole height for the image.
    assert.ok(layout.header.left >= stage.right - 1);
    assert.ok(layout.tools.left >= stage.right - 1);
    assert.equal(stage.height, layout.height);
  }
}
const editButton = (page) =>
  page.getByRole('button', { name: '编辑', exact: true });
const editor = (page) => page.getByRole('dialog', { name: '编辑图片' });
const meta = (page) => page.locator('.image-meta').innerText();
async function openEditor(page) {
  await editButton(page).click();
  await editor(page).waitFor();
  await page.locator('.editor-surface canvas').waitFor();
}
async function finish(page) {
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await editor(page).waitFor({ state: 'detached' });
}
async function tool(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

try {
  {
    const { context, page, drag } = await openFixture(portrait);
    const draft = page.getByLabel('发送到电脑的文字');
    await draft.fill('请看标出的区域，保留草稿');
    await page.getByLabel('选择图片文件').setInputFiles({
      name: 'transparent.png',
      mimeType: 'image/png',
      buffer: await generate(page, {
        width: 320,
        height: 200,
        type: 'image/png',
        shapes: [['#2f8f5b', 80, 50, 160, 100]],
      }),
    });
    await page.getByAltText('待粘贴的图片预览').waitFor();
    assert.match(await meta(page), /^原图 · PNG · 320×200 · /);
    await openEditor(page);
    assert.equal(
      await page
        .getByRole('button', { name: '裁剪', exact: true })
        .getAttribute('aria-pressed'),
      'true'
    );
    await checkLayout(page, 'portrait');
    let at = await mapper(page, { x: 0, y: 0, width: 320, height: 200 });
    await drag(line(at(48, 32), at(272, 168)));
    const crop = await cropRect(page, 320);
    near(crop.x, 48, 'crop x');
    near(crop.y, 32, 'crop y');
    near(crop.x + crop.width, 272, 'crop right');
    near(crop.y + crop.height, 168, 'crop bottom');
    assert.equal(
      await page.locator('.editor-title span').innerText(),
      `${crop.width} × ${crop.height}`
    );
    await page.screenshot({ path: path.join(artifacts, 'portrait-crop.png') });
    await tool(page, '画笔');
    at = await mapper(page, crop);
    await drag(line(at(70, 42), at(150, 42)));
    await page.getByRole('radio', { name: '黄色' }).click();
    await tool(page, '箭头');
    await drag(line(at(250, 160), at(205, 125)));
    await tool(page, '矩形');
    await drag(line(at(60, 60), at(200, 140)));
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await page.screenshot({
      path: path.join(artifacts, 'portrait-markup.png'),
    });
    await finish(page);
    const description = await meta(page);
    assert.match(
      description,
      new RegExp(`^已编辑 · PNG · ${crop.width}×${crop.height} · `)
    );
    await page.getByRole('button', { name: '查看待粘贴的图片' }).click();
    const viewer = page.getByRole('dialog', { name: '待粘贴的图片' });
    await viewer.getByText(description, { exact: true }).waitFor();
    const preview = await page.evaluate(async () => {
      const image = document.querySelector('.image-viewer img');
      await image.decode();
      const response = await fetch(image.src);
      return {
        size: [image.naturalWidth, image.naturalHeight],
        bytes: [...new Uint8Array(await response.arrayBuffer())],
      };
    });
    assert.deepEqual(preview.size, [crop.width, crop.height]);
    await page.screenshot({
      path: path.join(artifacts, 'portrait-preview.png'),
    });
    await viewer.getByRole('button', { name: '关闭', exact: true }).click();
    await page
      .getByRole('button', { name: '粘贴到 Codex', exact: true })
      .click();
    await page.waitForFunction(() => window.__imageSmoke.images.length === 1);
    const pasted = await page.evaluate(() => window.__imageSmoke.images[0]);
    assert.equal(pasted.mime, 'image/png');
    // The host receives exactly the previewed image.
    assert.deepEqual(pasted.bytes, preview.bytes);
    const local = (x, y) => [x - crop.x, y - crop.y];
    const { width, height, samples } = await decode(page, pasted.bytes, [
      [2, 2],
      local(110, 42),
      local(227.5, 142.5),
      local(160, 100),
      local(60, 100),
    ]);
    assert.deepEqual([width, height], [crop.width, crop.height]);
    assert.ok(samples[0].every(transparent), 'transparency is kept');
    assert.ok(samples[1].some(is([255, 59, 48])), 'red pen stroke');
    assert.ok(samples[2].some(is([255, 204, 0])), 'yellow arrow');
    assert.ok(samples[3].every(is([47, 143, 91], 2)), 'image pixels kept');
    assert.ok(samples[4].every(transparent), 'undone rectangle is gone');
    assert.equal(await draft.inputValue(), '请看标出的区域，保留草稿');
    assert.deepEqual(errors, []);
    console.log(
      'PASS phone portrait: touch crop, pen, color, arrow and undo; the transparent PNG preview is exactly what is pasted'
    );
    await context.close();
  }

  {
    const { context, page, drag } = await openFixture(portrait);
    await page.getByLabel('选择图片文件').setInputFiles(pngPath);
    await page.getByAltText('待粘贴的图片预览').waitFor();
    assert.match(await meta(page), /^原图 · PNG · 238×48 · /);
    const stroke = async () => {
      await tool(page, '画笔');
      const box = await page.locator('.editor-surface canvas').boundingBox();
      await drag(
        line(
          { x: box.x + 10, y: box.y + box.height / 2 },
          { x: box.x + box.width - 10, y: box.y + box.height / 2 }
        )
      );
    };
    await openEditor(page);
    await stroke();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page
      .getByText('再点一次「放弃修改」将丢弃本次编辑', { exact: true })
      .waitFor();
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await editor(page).waitFor({ state: 'detached' });
    assert.match(await meta(page), /^原图 /);
    await openEditor(page);
    await stroke();
    await finish(page);
    assert.match(await meta(page), /^已编辑 · PNG · 238×48 · /);
    await openEditor(page);
    const undo = page.getByRole('button', { name: '撤销', exact: true });
    const reset = page.getByRole('button', { name: '重置', exact: true });
    await reset.click();
    assert.equal(await reset.isDisabled(), true);
    // Reset is a step too: undo brings the marks back.
    await undo.click();
    assert.equal(await reset.isDisabled(), false);
    await reset.click();
    await finish(page);
    assert.match(await meta(page), /^原图 · PNG · 238×48 · /);
    await page
      .getByRole('button', { name: '粘贴到 Codex', exact: true })
      .click();
    await page.waitForFunction(() => window.__imageSmoke.images.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__imageSmoke.images[0]), {
      mime: 'image/png',
      bytes: png,
    });
    assert.deepEqual(errors, []);
    console.log(
      'PASS cancel asks before discarding; reset (undoable) returns to the untouched original and pastes its exact bytes'
    );
    await context.close();
  }

  {
    const { context, page, drag } = await openFixture(portrait);
    const jpeg = await generate(page, {
      width: 120,
      height: 80,
      type: 'image/jpeg',
      quality: 0.95,
      shapes: [
        ['#ff0000', 0, 0, 60, 40],
        ['#00ff00', 60, 0, 60, 40],
        ['#0000ff', 0, 40, 60, 40],
        ['#ffffff', 60, 40, 60, 40],
      ],
    });
    // Orientation 6 displays the stored image rotated 90° clockwise.
    await page.getByLabel('选择图片文件').setInputFiles({
      name: 'rotated.jpg',
      mimeType: 'image/jpeg',
      buffer: withOrientation(jpeg, 6),
    });
    await page.getByAltText('待粘贴的图片预览').waitFor();
    assert.match(await meta(page), /^原图 · JPEG · 120×80 · /);
    // Some Safari versions reject decode() for images that still load.
    await page.evaluate(() => {
      HTMLImageElement.prototype.decode = () =>
        Promise.reject(new DOMException('decode failed', 'EncodingError'));
    });
    await openEditor(page);
    assert.equal(
      await page.locator('.editor-title span').innerText(),
      '80 × 120'
    );
    await tool(page, '画笔');
    const at = await mapper(page, { x: 0, y: 0, width: 80, height: 120 });
    await drag(line(at(30, 60), at(50, 60)));
    await finish(page);
    assert.match(await meta(page), /^已编辑 · PNG · 80×120 · /);
    await page
      .getByRole('button', { name: '粘贴到 Codex', exact: true })
      .click();
    await page.waitForFunction(() => window.__imageSmoke.images.length === 1);
    const pasted = await page.evaluate(() => window.__imageSmoke.images[0]);
    const { width, height, samples } = await decode(
      page,
      pasted.bytes,
      [
        [59, 30],
        [59, 90],
        [19, 30],
        [19, 90],
        [40, 60],
      ],
      1
    );
    assert.deepEqual([width, height], [80, 120]);
    assert.ok(samples[0].every(is([255, 0, 0])), 'top right was top left');
    assert.ok(samples[1].every(is([0, 255, 0])), 'bottom right');
    assert.ok(samples[2].every(is([0, 0, 255])), 'top left');
    assert.ok(samples[3].every(is([255, 255, 255])), 'bottom left');
    assert.ok(samples[4].some(is([255, 59, 48])), 'mark where it was drawn');
    assert.deepEqual(errors, []);
    console.log(
      'PASS an EXIF-rotated JPEG is edited and exported in its displayed orientation, even when decode() rejects'
    );
    await context.close();
  }

  {
    const { context, page, drag } = await openFixture(portrait);
    const noise = await generate(page, {
      width: 2400,
      height: 2000,
      type: 'image/jpeg',
      quality: 0.6,
      shapes: 'noise',
    });
    assert.ok(noise.length < 10 * 1024 * 1024);
    await page.getByLabel('选择图片文件').setInputFiles({
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      buffer: noise,
    });
    await page.getByAltText('待粘贴的图片预览').waitFor();
    assert.match(await meta(page), /^原图 · JPEG · 2400×2000 · /);
    await openEditor(page);
    await tool(page, '画笔');
    const full = { x: 0, y: 0, width: 2400, height: 2000 };
    let at = await mapper(page, full);
    await drag(line(at(600, 1000), at(1000, 700)));
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page
      .getByRole('alert')
      .filter({
        hasText:
          /编辑后的 PNG 为 [\d.]+ MB，超过 10 MB；请裁剪更小的区域，或重置后粘贴原图/,
      })
      .waitFor();
    assert.equal(await editor(page).isVisible(), true);
    await page.screenshot({
      path: path.join(artifacts, 'oversized-export.png'),
    });
    await tool(page, '裁剪');
    at = await mapper(page, full);
    await drag(line(at(400, 300), at(1200, 900)));
    // One CSS pixel covers several source pixels in this scaled preview.
    const crop = await cropRect(page, 2400);
    assert.ok(
      Math.abs(crop.width - 800) <= 12 && Math.abs(crop.height - 600) <= 12
    );
    await finish(page);
    assert.match(
      await meta(page),
      new RegExp(`^已编辑 · PNG · ${crop.width}×${crop.height} · `)
    );
    assert.equal(
      await page.evaluate(() => window.__imageSmoke.images.length),
      0
    );
    await page
      .getByRole('button', { name: '粘贴到 Codex', exact: true })
      .click();
    await page.waitForFunction(() => window.__imageSmoke.images.length === 1);
    const pasted = Buffer.from(
      await page.evaluate(() => window.__imageSmoke.images[0].bytes)
    );
    assert.deepEqual(
      [pasted.readUInt32BE(16), pasted.readUInt32BE(20)],
      [crop.width, crop.height]
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS an oversized edited PNG is refused before transfer; cropping the scaled preview makes it fit'
    );
    await context.close();
  }

  {
    const { context, page, drag } = await openFixture(portrait);
    await page.getByLabel('选择图片文件').setInputFiles({
      name: 'window.png',
      mimeType: 'image/png',
      buffer: await generate(page, {
        width: 600,
        height: 300,
        type: 'image/png',
        shapes: [['#d9dee2', 0, 0, 600, 300]],
      }),
    });
    await page.getByAltText('待粘贴的图片预览').waitFor();
    await openEditor(page);
    await tool(page, '画笔');
    const full = { x: 0, y: 0, width: 600, height: 300 };
    let at = await mapper(page, full);
    await drag(line(at(60, 150), at(200, 150)));
    await page.setViewportSize(landscape);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    await checkLayout(page, 'landscape');
    await tool(page, '箭头');
    at = await mapper(page, full);
    await drag(line(at(550, 60), at(400, 150)));
    await page.screenshot({ path: path.join(artifacts, 'landscape.png') });
    await tool(page, '裁剪');
    await checkLayout(page, 'landscape');
    await page.setViewportSize(portrait);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    await checkLayout(page, 'portrait');
    // The smallest common phone size, in both orientations.
    for (const [viewport, orientation] of [
      [{ width: 568, height: 320 }, 'landscape'],
      [{ width: 320, height: 568 }, 'portrait'],
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      );
      await checkLayout(page, orientation);
    }
    await finish(page);
    assert.match(await meta(page), /^已编辑 · PNG · 600×300 · /);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    );
    await page
      .getByRole('button', { name: '粘贴到 Codex', exact: true })
      .click();
    await page.waitForFunction(() => window.__imageSmoke.images.length === 1);
    const pasted = await page.evaluate(() => window.__imageSmoke.images[0]);
    const { samples } = await decode(page, pasted.bytes, [
      [130, 150],
      [475, 105],
      [300, 250],
    ]);
    assert.ok(samples[0].some(is([255, 59, 48])), 'portrait stroke');
    assert.ok(samples[1].some(is([255, 59, 48])), 'landscape arrow');
    assert.ok(samples[2].every(is([217, 222, 226], 2)), 'untouched pixels');
    assert.deepEqual(errors, []);
    console.log(
      'PASS edits survive rotation; landscape keeps the image full height beside the tools'
    );
    await context.close();
  }

  {
    const { context, page, drag } = await openFixture(portrait);
    const draft = page.getByLabel('发送到电脑的文字');
    await draft.fill('取消后保留草稿');
    const prepare = async () => {
      await page.getByLabel('选择图片文件').setInputFiles(pngPath);
      await page.getByAltText('待粘贴的图片预览').waitFor();
      await openEditor(page);
      await tool(page, '矩形');
      const box = await page.locator('.editor-surface canvas').boundingBox();
      await drag(
        line(
          { x: box.x + 20, y: box.y + 10 },
          { x: box.x + box.width - 20, y: box.y + box.height - 10 }
        )
      );
      await finish(page);
      return page.evaluate(async () => {
        const response = await fetch(
          document.querySelector('.image-thumb img').src
        );
        return [...new Uint8Array(await response.arrayBuffer())];
      });
    };
    const paste = () =>
      page.getByRole('button', { name: '粘贴到 Codex', exact: true }).click();
    const images = () => page.evaluate(() => window.__imageSmoke.images.length);

    let edited = await prepare();
    await page.evaluate(() => {
      window.__imageSmoke.delay = true;
    });
    await paste();
    await page.waitForFunction(() => window.__imageSmoke.pendingPaste);
    await page.getByRole('button', { name: '切到阅读', exact: true }).click();
    await page.getByText(/图片传输已取消/).waitFor();
    await page.waitForFunction(() => window.__imageSmoke.cancelled.size === 1);
    await page.evaluate(() => {
      window.__imageSmoke.release();
      window.__imageSmoke.delay = false;
    });
    await page.getByRole('button', { name: '返回窗口', exact: true }).click();
    await page.waitForTimeout(500);
    assert.equal(await images(), 0);
    assert.match(await meta(page), /^已编辑 /);
    await paste();
    await page.waitForFunction(() => window.__imageSmoke.images.length === 1);
    assert.deepEqual(
      await page.evaluate(() => window.__imageSmoke.images[0].bytes),
      edited
    );

    await prepare();
    await page.evaluate(() => {
      window.__imageSmoke.delay = true;
    });
    await paste();
    await page.waitForFunction(() => window.__imageSmoke.pendingPaste);
    await page.evaluate(() => window.__imageSmoke.closeTarget());
    await page.waitForFunction(() => window.__imageSmoke.cancelled.size === 2);
    await page.evaluate(() => {
      window.__imageSmoke.release();
      window.__imageSmoke.delay = false;
      window.__imageSmoke.reopenTarget();
    });
    await page.getByRole('button', { name: '选择图片', exact: true }).waitFor();
    await page.waitForTimeout(500);
    assert.equal(await images(), 1);
    assert.equal(await page.getByAltText('待粘贴的图片预览').count(), 0);

    edited = await prepare();
    await page.evaluate(() => window.__imageSmoke.closeImages());
    await page
      .getByRole('button', { name: '重新连接图片', exact: true })
      .click();
    await page.waitForFunction(
      () => window.__imageSmoke.imageConnections === 2
    );
    await page.waitForTimeout(300);
    assert.equal(await images(), 1);
    await paste();
    await page.waitForFunction(() => window.__imageSmoke.images.length === 2);
    assert.deepEqual(
      await page.evaluate(() => window.__imageSmoke.images[1].bytes),
      edited
    );
    assert.equal(await draft.inputValue(), '取消后保留草稿');
    assert.deepEqual(errors, []);
    console.log(
      'PASS reading mode, a closed target and a dropped image channel cancel edited pastes; nothing is resent without a tap'
    );
    await context.close();
  }
} finally {
  await browser.close();
}
