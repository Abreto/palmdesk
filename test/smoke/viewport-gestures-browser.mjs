import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Reuse the isolated RemoteViewport fixture and its real input DataChannel.
  await page.goto('http://127.0.0.1:5196/test/smoke/image-paste.html');
  await page.getByRole('button', { name: '选择图片', exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector('.image-tools button')?.disabled
  );
  await page.getByLabel('发送到电脑的文字').fill('保留缩放前的草稿');
  const cdp = await context.newCDPSession(page);
  async function touch(type, touchPoints) {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  async function layout() {
    return page.evaluate(() => {
      const stage = document.querySelector('.video-stage');
      const video = stage.querySelector('video');
      return {
        stage: stage.getBoundingClientRect().toJSON(),
        video: video.getBoundingClientRect().toJSON(),
        tools: document
          .querySelector('.tools')
          .getBoundingClientRect()
          .toJSON(),
        keyboard: document
          .querySelector('.keyboard-panel')
          .getBoundingClientRect()
          .toJSON(),
        zoom: Number(document.querySelector('.zoom-label select').value),
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
        pageScale: visualViewport.scale,
        pageWidth: document.documentElement.scrollWidth,
      };
    });
  }
  async function clearInputs() {
    await page.evaluate(() => {
      window.__imageSmoke.events.length = 0;
      window.__imageSmoke.behaviors.length = 0;
    });
  }
  async function noRemoteInput() {
    await page.waitForTimeout(550);
    assert.deepEqual(
      await page.evaluate(() =>
        window.__imageSmoke.events.filter((name) => name !== 'releaseAll')
      ),
      []
    );
  }
  const before = await layout();
  const center = {
    x: before.stage.left + before.stage.width * 0.4,
    y: before.stage.top + before.stage.height / 2,
  };
  const pair = (spread, dx = 0, dy = 0) => [
    { id: 1, x: center.x + dx - spread, y: center.y + dy },
    { id: 2, x: center.x + dx + spread, y: center.y + dy },
  ];
  await clearInputs();
  await touch('touchStart', pair(40));
  await touch('touchMove', pair(80));
  const zoomed = await layout();
  assert.ok(Math.abs(zoomed.zoom - 2) < 0.01);
  const anchor = (box) => ({
    x: (center.x - box.left) / box.width,
    y: (center.y - box.top) / box.height,
  });
  assert.ok(Math.abs(anchor(before.video).x - anchor(zoomed.video).x) < 0.005);
  assert.ok(Math.abs(anchor(before.video).y - anchor(zoomed.video).y) < 0.005);
  assert.deepEqual(zoomed.tools, before.tools);
  assert.deepEqual(zoomed.keyboard, before.keyboard);
  assert.equal(zoomed.pageScale, 1);
  assert.equal(zoomed.pageWidth, 390);
  await touch('touchMove', pair(80, -35));
  assert.ok((await layout()).scrollLeft > zoomed.scrollLeft + 30);
  await touch('touchEnd', [pair(80, -35)[0]]);
  const beforeRemaining = await layout();
  await touch('touchMove', [{ ...pair(80, -55)[1] }]);
  assert.ok((await layout()).scrollLeft > beforeRemaining.scrollLeft + 15);
  await touch('touchEnd', []);
  await noRemoteInput();
  console.log(
    'PASS anchored pinch, two-finger pan and remaining-finger pan stay local'
  );

  // A new touch after the pinch uses the transformed video coordinates.
  const current = await layout();
  const target = {
    x: current.stage.left + current.stage.width * 0.6,
    y: current.stage.top + current.stage.height / 2,
  };
  await page.touchscreen.tap(target.x, target.y);
  await page.waitForFunction(() =>
    window.__imageSmoke.events.includes('leftClick')
  );
  const click = await page.evaluate(() => window.__imageSmoke.behaviors.at(-1));
  assert.equal(
    click.x,
    Math.round(((target.x - current.video.left) / current.video.width) * 1000)
  );
  assert.equal(
    click.y,
    Math.round(((target.y - current.video.top) / current.video.height) * 1000)
  );
  console.log('PASS click coordinates after zoom and pan');

  await clearInputs();
  await touch('touchStart', pair(40));
  await touch('touchMove', pair(51));
  const continuous = await layout();
  assert.ok(continuous.zoom > 2.5 && continuous.zoom < 2.6);
  assert.match(await page.getByLabel('画面缩放').textContent(), /255%/);
  await touch('touchMove', pair(120));
  assert.equal((await layout()).zoom, 3);
  await touch('touchMove', pair(5));
  assert.equal((await layout()).zoom, 1);
  await touch('touchEnd', []);
  await noRemoteInput();
  const fit = await layout();
  assert.equal(fit.scrollLeft, 0);
  assert.equal(fit.scrollTop, 0);
  assert.deepEqual(fit.video, before.video);
  console.log(
    'PASS continuous zoom label, upper/lower bounds and return to fit'
  );

  await page.getByLabel('仅观看').check();
  await clearInputs();
  await touch('touchStart', pair(40));
  await touch('touchMove', pair(100));
  await touch('touchEnd', []);
  const watchZoom = await layout();
  assert.equal(watchZoom.zoom, 2.5);
  await touch('touchStart', [{ id: 1, ...center }]);
  await touch('touchMove', [{ id: 1, x: center.x - 30, y: center.y }]);
  await touch('touchEnd', []);
  assert.ok((await layout()).scrollLeft > watchZoom.scrollLeft + 25);
  await noRemoteInput();
  await page.getByLabel('仅观看').uncheck();
  await page.getByLabel('移动画面', { exact: true }).click();
  await clearInputs();
  const panStart = await layout();
  await touch('touchStart', [{ id: 1, ...center }]);
  await touch('touchMove', [{ id: 1, x: center.x - 20, y: center.y }]);
  await touch('touchEnd', []);
  assert.ok((await layout()).scrollLeft > panStart.scrollLeft + 15);
  await noRemoteInput();
  console.log('PASS watch-only pinch and one-finger pan in both local modes');

  await page.getByLabel('画面缩放').selectOption('1');
  await page.getByLabel('点击', { exact: true }).click();
  await clearInputs();
  await touch('touchStart', pair(40));
  await touch('touchMove', pair(60));
  await touch('touchCancel', []);
  await noRemoteInput();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(100);
  const landscape = await layout();
  assert.equal(landscape.pageWidth, 844);
  assert.equal(landscape.pageScale, 1);
  assert.equal(
    await page.getByLabel('发送到电脑的文字').inputValue(),
    '保留缩放前的草稿'
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS cancellation, landscape layout, draft preservation and no browser errors'
  );
} finally {
  await browser.close();
}
