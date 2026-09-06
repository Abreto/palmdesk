import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.env.SMOKE_CLIENT_URL || 'http://localhost:5173';
const artifacts = path.resolve(
  process.env.SMOKE_ARTIFACT_DIR || 'docs/smoke-artifacts'
);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.SMOKE_BROWSER_EXECUTABLE ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const results = [];
function pass(message) {
  results.push(message);
  console.log(`PASS ${message}`);
}
try {
  const hostContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  // Only native capture and OS input are substituted. Both real Vue routes,
  // device APIs, signaling, WebRTCClass and DataChannels run unchanged.
  await hostContext.addInitScript(() => {
    const state = {
      sessionId: '',
      streams: [],
      inputs: [],
      sources: true,
      hiddenIds: [],
      listError: '',
      capturedIds: [],
      delayCapture: false,
      captureWaiters: [],
    };
    window.__smoke = state;
    const source = {
      id: 'window:101:0',
      nativeId: 101,
      ownerPid: 4242,
      bundleId: 'com.openai.codex',
      appName: 'Codex',
      name: 'Synthetic window fixture',
      thumbnail: '',
      appIcon: '',
      boundsSource: 'window',
      bounds: { x: 100, y: 100, width: 960, height: 600 },
      inputScale: 1,
      isCodex: true,
    };
    const sources = [
      source,
      {
        ...source,
        id: 'window:102:0',
        nativeId: 102,
        bundleId: 'com.apple.Terminal',
        appName: 'Terminal',
        name: 'Agent CLI - workspace',
        isCodex: false,
      },
      {
        ...source,
        id: 'window:103:0',
        nativeId: 103,
        bundleId: 'com.anthropic.claudefordesktop',
        appName: 'Claude',
        name: 'Project planning - a long window title for responsive layout verification',
        isCodex: false,
      },
    ];
    for (const [index, item] of sources.entries()) {
      const preview = document.createElement('canvas');
      preview.width = 320;
      preview.height = 180;
      const ctx = preview.getContext('2d');
      ctx.fillStyle = index === 1 ? '#252a28' : '#f0f4f2';
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = ['#147e67', '#b34b63', '#466ea5'][index];
      ctx.fillRect(0, 0, 320, 30);
      ctx.fillStyle = index === 1 ? '#eeeeee' : '#243e33';
      ctx.font = '18px sans-serif';
      ctx.fillText(item.appName, 16, 66);
      for (let row = 0; row < 4; row++)
        ctx.fillRect(16, 90 + row * 16, 140 + row * 25, 4);
      item.thumbnail = preview.toDataURL('image/jpeg', 0.6);
    }
    window.electronAPI = {
      ipcRenderer: {
        send() {},
        on() {},
        removeListener() {},
        async invoke(channel, { data }) {
          let result = {};
          if (channel === 'capturePermissions')
            result = {
              screen: 'granted',
              accessibility: true,
              targetApps: ['com.openai.codex'],
            };
          if (channel === 'getCaptureSources') {
            if (state.listError) return { code: 1, msg: state.listError };
            if (!state.sources) state.sessionId = '';
            result = {
              sources: state.sources
                ? sources.filter((item) => !state.hiddenIds.includes(item.id))
                : [],
              sessionId: state.sessionId,
            };
          }
          if (channel === 'beginCapture') {
            const selected = sources.find(
              (item) =>
                item.id === data.sourceId && !state.hiddenIds.includes(item.id)
            );
            if (!state.sources || !selected)
              return { code: 1, msg: 'Fixture window unavailable' };
            state.sessionId = crypto.randomUUID();
            state.capturedIds.push(selected.id);
            result = {
              source: selected,
              sessionId: state.sessionId,
              stream: { id: source.id },
            };
          }
          if (
            channel === 'stopCapture' &&
            (!data.sessionId || data.sessionId === state.sessionId)
          )
            state.sessionId = '';
          if (channel === 'remoteInput') {
            if (!state.sessionId || data.sessionId !== state.sessionId)
              return { code: 1, msg: 'Stale capture session' };
            state.inputs.push(data.input);
          }
          if (channel === 'getPlatform') result = { platform: 'darwin' };
          if (channel === 'getPrimaryDisplaySize')
            result = { width: 1280, height: 900 };
          if (channel === 'scaleFactor')
            result = { scaleFactor: 1, platform: 'darwin' };
          return { code: 0, data: result };
        },
      },
    };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (state.delayCapture)
        await new Promise((resolve) => state.captureWaiters.push(resolve));
      const selected = sources.find(
        (item) => item.id === constraints.video.mandatory.chromeMediaSourceId
      );
      if (!selected) throw new Error('Unexpected capture source');
      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 600;
      const context = canvas.getContext('2d');
      let frame = 0;
      const draw = () => {
        context.fillStyle = '#f0f4f2';
        context.fillRect(0, 0, 960, 600);
        context.fillStyle = selected.id === source.id ? '#147e67' : '#b34b63';
        context.fillRect(0, 0, 960, 70);
        context.fillStyle = '#ffffff';
        context.font = '24px sans-serif';
        context.fillText('Window fixture / synthetic video', 28, 45);
        context.fillStyle = '#243e33';
        context.font = '30px sans-serif';
        context.fillText(`Live frame ${frame++}`, 40, 155);
        context.fillStyle = '#bd4456';
        context.fillRect(40, 220, 300, 130);
        context.fillStyle = '#147e67';
        context.fillRect(370, 220, 550, 130);
        context.fillStyle = '#d4ded7';
        context.fillRect(40, 395, 880, 135);
        const text =
          state.inputs.filter((input) => input.action === 'text').at(-1)
            ?.text || 'Mobile input fixture';
        context.fillStyle = '#263b32';
        context.font = '22px sans-serif';
        context.fillText(text.split('\n')[0], 60, 445);
      };
      draw();
      const timer = setInterval(draw, 100);
      const stream = canvas.captureStream(10);
      state.streams.push(stream);
      const track = stream.getVideoTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => {
        clearInterval(timer);
        stop();
      };
      return stream;
    };
  });
  const host = await hostContext.newPage();
  host.on('pageerror', (error) => errors.push(`host: ${error.message}`));
  const registration = host.waitForResponse((response) =>
    response.url().endsWith('/desk_user/create')
  );
  registration.catch(() => {});
  await host.goto(base);
  const device = (await (await registration).json()).data;
  assert.ok(device.uuid && device.password);
  await host.locator('.capture-source').first().waitFor();
  assert.equal(await host.locator('.capture-source.selected').count(), 0);
  await host.waitForFunction(async (uuid) => {
    const response = await fetch(
      `/api/desk_user/find_receiver_by_uuid?uuid=${encodeURIComponent(uuid)}`
    );
    return (await response.json()).data.receiver;
  }, device.uuid);
  pass(
    'real host registers a device and lists app windows without auto-selecting'
  );

  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const phone = await phoneContext.newPage();
  phone.on('pageerror', (error) => errors.push(`phone: ${error.message}`));
  await phone.goto(base);
  await phone.getByText('高级设置', { exact: true }).click();
  await phone.getByLabel('修改连接服务', { exact: true }).click();
  await phone.getByLabel('服务地址', { exact: true }).fill('invalid-address');
  await phone.getByRole('button', { name: '保存并重新连接' }).click();
  await phone.getByRole('alert').waitFor();
  await phone.getByLabel('服务地址', { exact: true }).fill('/api');
  await phone.screenshot({ path: path.join(artifacts, 'mobile-settings.png') });
  await Promise.all([
    phone.waitForNavigation(),
    phone.getByRole('button', { name: '保存并重新连接' }).click(),
  ]);
  await phone.locator('.sidebar').getByText('连接', { exact: true }).click();
  pass(
    'mobile service settings reject invalid URLs and apply saved configuration after reload'
  );
  await phone.getByLabel('远程设备代码').fill(device.uuid);
  assert.equal(await phone.locator('.codex-target').count(), 0);
  assert.equal(await phone.locator('.local-device').count(), 0);
  await phone.screenshot({ path: path.join(artifacts, 'mobile-connect.png') });
  pass(
    'phone landing view presents connection controls without native host controls'
  );

  async function connectPhone(select = true) {
    await phone.getByLabel('远程设备代码').fill(device.uuid);
    await phone.locator('.remote-device .btn').click();
    await Promise.race([
      phone
        .getByLabel('连接密码')
        .waitFor()
        .then(async () => {
          await phone.getByLabel('连接密码').fill(device.password);
          await phone.locator('.pwd-wrap .btn').click();
        }),
      phone.waitForURL('**/webrtc'),
    ]);
    await phone.waitForURL('**/webrtc');
    await phone
      .getByRole('button', {
        name: `选择 ${'Synthetic window fixture'}`,
        exact: true,
      })
      .waitFor({ timeout: 25000 });
    assert.equal(await host.evaluate(() => !!window.__smoke.sessionId), false);
    assert.equal(
      await host.evaluate(() =>
        window.__smoke.streams.some((stream) =>
          stream.getTracks().some((track) => track.readyState === 'live')
        )
      ),
      false
    );
    if (!select) return;
    await phone
      .getByRole('button', {
        name: '选择 Synthetic window fixture',
        exact: true,
      })
      .click();
    await waitForVideo();
  }
  async function waitForVideo() {
    await phone.waitForFunction(
      () =>
        document.querySelector('video')?.readyState >= 2 &&
        document.querySelector('.status.online'),
      undefined,
      { timeout: 25000 }
    );
    await phone.getByLabel('发送文字', { exact: true }).waitFor();
  }
  await connectPhone(false);
  assert.equal(await phone.locator('.window-item').count(), 3);
  assert.equal(await phone.locator('video').count(), 0);
  pass(
    'authenticated phone sees all app windows before any video capture starts'
  );
  await phone.getByLabel('搜索应用或窗口').fill('no-matching-window');
  await phone.getByText('没有匹配的窗口', { exact: true }).waitFor();
  await phone.getByLabel('搜索应用或窗口').fill('terminal');
  assert.equal(await phone.locator('.window-item').count(), 1);
  await phone.getByLabel('搜索应用或窗口').fill('');
  for (const [name, viewport] of [
    ['mobile-window-picker', { width: 390, height: 844 }],
    ['narrow-window-picker', { width: 320, height: 568 }],
    ['landscape-window-picker', { width: 844, height: 390 }],
    ['desktop-window-picker', { width: 1440, height: 900 }],
  ]) {
    await phone.setViewportSize(viewport);
    assert.ok(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    );
    assert.equal(
      await phone
        .locator('.window-preview img')
        .evaluateAll((images) =>
          images.every((img) => img.complete && img.naturalWidth > 0)
        ),
      true
    );
    await phone.screenshot({ path: path.join(artifacts, `${name}.png`) });
  }
  await phone.setViewportSize({ width: 390, height: 844 });
  pass(
    'window search and actual thumbnails render in portrait, narrow, landscape and desktop layouts'
  );
  await host.evaluate(() => {
    window.__smoke.hiddenIds = ['window:103:0'];
  });
  await phone
    .getByRole('button', { name: '选择 Project planning', exact: false })
    .click();
  await phone
    .getByRole('alert')
    .filter({ hasText: 'Fixture window unavailable' })
    .waitFor();
  assert.equal(await host.evaluate(() => window.__smoke.capturedIds.length), 0);
  await phone.getByLabel('刷新窗口列表', { exact: true }).click();
  await phone.waitForFunction(
    () => document.querySelectorAll('.window-item').length === 2
  );
  pass(
    'a window closed after listing cannot start capture and refresh removes it'
  );
  await host.evaluate(() => {
    window.__smoke.listError = '屏幕录制权限不可用';
  });
  await phone.getByLabel('刷新窗口列表', { exact: true }).click();
  await phone
    .getByRole('alert')
    .filter({ hasText: '屏幕录制权限不可用' })
    .waitFor();
  await host.evaluate(() => {
    window.__smoke.listError = '';
    window.__smoke.sources = false;
  });
  await phone.getByLabel('刷新窗口列表', { exact: true }).click();
  await phone
    .getByText('当前桌面没有可用窗口，窗口可能已最小化', { exact: true })
    .waitFor();
  await host.evaluate(() => {
    window.__smoke.sources = true;
    window.__smoke.hiddenIds = [];
  });
  await phone.getByLabel('刷新窗口列表', { exact: true }).click();
  await phone
    .getByRole('button', { name: '选择 Synthetic window fixture', exact: true })
    .click();
  await waitForVideo();
  pass(
    'permission errors and empty lists recover by refreshing, then explicit selection starts video'
  );
  assert.ok(!phone.url().includes('Password'));
  const decoded = await phone.locator('video').evaluate((video) => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0);
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      pixel: [...context.getImageData(20, 20, 1, 1).data],
    };
  });
  assert.ok(decoded.width > 0 && decoded.pixel[1] > decoded.pixel[0]);
  pass(
    `real business WebRTC video decoded (${decoded.width}x${decoded.height})`
  );

  await phone.getByLabel('发送到电脑的文字').fill('你好 Codex\n通过手机发送');
  assert.equal(
    await host.evaluate(
      () =>
        window.__smoke.inputs.filter((input) => input.action === 'text').length
    ),
    0
  );
  await phone.getByLabel('发送文字', { exact: true }).click();
  await host.waitForFunction(() =>
    window.__smoke.inputs.some(
      (input) =>
        input.action === 'text' && input.text === '你好 Codex\n通过手机发送'
    )
  );
  await phone.getByLabel('回车', { exact: true }).click();
  await host.waitForFunction(() =>
    window.__smoke.inputs.some((input) => input.action === 'keysUp')
  );
  pass(
    'Chinese text and Enter travel through the business DataChannel and IPC bridge'
  );

  const videoBox = await phone.locator('video').boundingBox();
  const center = {
    x: videoBox.x + videoBox.width / 2,
    y: videoBox.y + videoBox.height / 2,
  };
  await phone.touchscreen.tap(center.x, center.y);
  await host.waitForFunction(() =>
    window.__smoke.inputs.some((input) => input.action === 'click')
  );
  const cdp = await phoneContext.newCDPSession(phone);
  await phone.getByLabel('拖拽', { exact: true }).click();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...center }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: center.x + 25, y: center.y + 15 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await host.waitForFunction(() =>
    window.__smoke.inputs.some((input) => input.action === 'up')
  );
  await phone.getByLabel('滚动', { exact: true }).click();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...center }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: center.x, y: center.y - 25 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await host.waitForFunction(() =>
    window.__smoke.inputs.some((input) => input.action === 'scroll')
  );
  pass(
    'real touch click, drag, release and scrolling produce window-relative input'
  );

  await phone.getByLabel('点击', { exact: true }).click();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...center }],
  });
  await phone.waitForTimeout(600);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await host.waitForFunction(() =>
    window.__smoke.inputs.some((input) => input.action === 'rightClick')
  );
  pass('long touch sends a right click through the business input channel');

  await phone.getByLabel('画面缩放').selectOption('3');
  await phone.getByLabel('移动画面', { exact: true }).click();
  await phone.waitForTimeout(300);
  const beforePan = await host.evaluate(
    () =>
      window.__smoke.inputs.filter((input) => input.action !== 'releaseAll')
        .length
  );
  const stageBox = await phone.locator('.video-stage').boundingBox();
  const panStart = {
    x: stageBox.x + stageBox.width * 0.7,
    y: stageBox.y + stageBox.height * 0.5,
  };
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [panStart],
  });
  for (let step = 1; step <= 5; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: panStart.x - step * 20, y: panStart.y }],
    });
    await phone.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await phone.waitForFunction(
    () => document.querySelector('.video-stage').scrollLeft > 0
  );
  assert.equal(
    await host.evaluate(
      () =>
        window.__smoke.inputs.filter((input) => input.action !== 'releaseAll')
          .length
    ),
    beforePan
  );
  await phone.getByLabel('画面缩放').selectOption('1');
  await phone.getByLabel('点击', { exact: true }).click();
  pass(
    'zoomed touch panning moves only the local viewport, without host input'
  );

  await phone.getByLabel('仅观看').check();
  await host.waitForFunction(
    () => window.__smoke.inputs.at(-1)?.action === 'releaseAll'
  );
  const before = await host.evaluate(
    () =>
      window.__smoke.inputs.filter((input) => input.action !== 'releaseAll')
        .length
  );
  await phone.touchscreen.tap(center.x, center.y);
  await phone.waitForTimeout(300);
  assert.equal(
    await host.evaluate(
      () =>
        window.__smoke.inputs.filter((input) => input.action !== 'releaseAll')
          .length
    ),
    before
  );
  assert.equal(
    await phone.getByLabel('发送文字', { exact: true }).isDisabled(),
    true
  );
  await phone.getByLabel('仅观看').uncheck();
  await phone.getByLabel('点击', { exact: true }).click();
  pass('watch-only mode blocks pointer and text input and releases held state');

  for (const [name, viewport] of [
    ['mobile-controller', { width: 390, height: 844 }],
    ['mobile-landscape', { width: 844, height: 390 }],
    ['desktop-controller', { width: 1440, height: 900 }],
  ]) {
    await phone.setViewportSize(viewport);
    await phone.waitForTimeout(100);
    const layout = await phone.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    }));
    assert.ok(
      layout.width <= layout.viewportWidth + 1,
      `${name} horizontal overflow`
    );
    assert.ok(
      layout.height <= layout.viewportHeight + 1,
      `${name} vertical overflow`
    );
    await phone.screenshot({ path: path.join(artifacts, `${name}.png`) });
  }
  pass('portrait phone, landscape phone and desktop fit their viewports');

  await phone.getByLabel('断开并重选窗口', { exact: true }).click();
  await phone
    .getByRole('button', { name: '选择 Agent CLI - workspace', exact: true })
    .waitFor();
  await host.waitForFunction(
    () =>
      !window.__smoke.sessionId &&
      window.__smoke.streams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === 'ended')
      )
  );
  await phone
    .getByRole('button', { name: '选择 Agent CLI - workspace', exact: true })
    .click();
  await waitForVideo();
  assert.equal(
    await host.evaluate(() => window.__smoke.capturedIds.at(-1)),
    'window:102:0'
  );
  const terminalPixel = await phone.locator('video').evaluate((video) => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 960, 600);
    return [...ctx.getImageData(20, 20, 1, 1).data];
  });
  assert.ok(terminalPixel[0] > terminalPixel[1]);
  pass(
    'disconnect-and-reselect stops the previous stream and opens the selected terminal window'
  );

  await phone.getByLabel('断开并重选窗口', { exact: true }).click();
  await phone
    .getByRole('button', { name: '选择 Synthetic window fixture', exact: true })
    .waitFor();
  await host.evaluate(() => {
    window.__smoke.delayCapture = true;
  });
  await phone
    .getByRole('button', { name: '选择 Synthetic window fixture', exact: true })
    .click();
  await host.waitForFunction(() => window.__smoke.captureWaiters.length === 1);
  await phone.getByLabel('断开并返回').click();
  await host.waitForFunction(() => !window.__smoke.sessionId);
  await host.evaluate(() => {
    window.__smoke.delayCapture = false;
  });
  await connectPhone();
  const activeSession = await host.evaluate(() => window.__smoke.sessionId);
  await host.evaluate(() => {
    window.__smoke.captureWaiters.splice(0).forEach((resolve) => resolve());
  });
  await host.waitForFunction(
    () =>
      window.__smoke.streams.at(-1).getVideoTracks()[0].readyState === 'ended'
  );
  assert.equal(
    await host.evaluate(() => window.__smoke.sessionId),
    activeSession
  );
  assert.equal(
    await host.evaluate(
      () =>
        window.__smoke.streams.filter(
          (stream) => stream.getVideoTracks()[0].readyState === 'live'
        ).length
    ),
    1
  );
  pass(
    'disconnect during pending capture stops the late stream without disturbing the new session'
  );

  const firstTrack = await host.evaluate(
    () => window.__smoke.streams[0].getVideoTracks()[0].id
  );
  await phone.getByLabel('断开并返回').click();
  await host.waitForFunction(
    () =>
      window.__smoke.streams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === 'ended')
      ),
    undefined,
    { timeout: 15000 }
  );
  await phone.setViewportSize({ width: 390, height: 844 });
  await connectPhone();
  const secondTrack = await host.evaluate(
    () => window.__smoke.streams.at(-1).getVideoTracks()[0].id
  );
  assert.notEqual(firstTrack, secondTrack);
  pass('disconnect stops host tracks and reconnect captures a fresh stream');
  await host.evaluate(() => {
    window.__smoke.sources = false;
  });
  await host.waitForFunction(() =>
    window.__smoke.streams.every((stream) =>
      stream.getTracks().every((track) => track.readyState === 'ended')
    )
  );
  await phone.getByRole('button', { name: '重新连接', exact: true }).waitFor();
  pass(
    'source disappearance closes the business connection and stops captured tracks'
  );
  await phone.getByLabel('断开并返回').click();
  await phone.getByText('设备列表', { exact: true }).click();
  await phone.getByRole('button', { name: device.uuid, exact: true }).click();
  assert.equal(
    await phone.getByLabel('远程设备代码').inputValue(),
    device.uuid
  );
  pass(
    'recent devices return to the connection form with the selected computer'
  );
  assert.deepEqual(errors, []);
  pass('no uncaught page errors');
  await writeFile(
    path.join(artifacts, 'business-flow.json'),
    JSON.stringify(
      {
        scope:
          'Real Vue business workflow, official local backend, synthetic native capture and IPC driver',
        results,
        decoded,
        errors,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error);
  console.error('Page errors:', errors);
  for (const context of browser.contexts()) {
    const page = context.pages()[0];
    if (page)
      await page
        .screenshot({
          path: path.join(
            artifacts,
            `business-failure-${browser.contexts().indexOf(context)}.png`
          ),
        })
        .catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
