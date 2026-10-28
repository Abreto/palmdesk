// Run after pnpm build:prod. Real host and controller pages over Socket.IO
// session auth and WebRTC; only native capture, input and transcripts are fake.
// Screenshots of the Window view are written to .local/desktop-input/.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

import { MemoryRedis } from '../../containers/test/fixtures.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { Server } = require('socket.io');

const {
  createDeskSessions,
} = require('../../containers/backend/runtime/desk-sessions.cjs');

const artifacts = path.resolve('.local/desktop-input');
await mkdir(artifacts, { recursive: true });
const redis = new MemoryRedis();
const accounts = new Map([['fixture-desktop', 'fixture-password']]);
let devices = 0;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let text = '';
      // eslint-disable-next-line no-restricted-syntax
      for await (const part of req) text += part;
      const body = text ? JSON.parse(text) : {};
      let data = {};
      if (url.pathname.endsWith('/desk_user/create')) {
        devices += 1;
        data = {
          uuid: `fixture-host-${devices}`,
          password: 'fixture-password',
        };
        accounts.set(data.uuid, data.password);
      } else if (url.pathname.endsWith('/desk_user/login')) {
        assert.equal(accounts.get(body.uuid), body.password);
        data = body;
      } else if (url.pathname.endsWith('/desk_user/find_receiver_by_uuid')) {
        const row = await redis.get(`desk:${url.searchParams.get('uuid')}`);
        data = { receiver: row ? JSON.parse(row).value.socket_id : '' };
      } else if (url.pathname.endsWith('/webrtc/ice-servers')) {
        await sessions.authorize(req.headers.authorization?.slice(7));
        data = {
          iceServers: [],
          expiresAt: Date.now() + 3600000,
          refreshAfter: Date.now() + 3000000,
        };
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ code: 200, data }));
      return;
    }
    const relative =
      url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve('dist', relative);
    if (!file.startsWith(`${path.resolve('dist')}${path.sep}`))
      throw new Error('Invalid path');
    const types = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.svg': 'image/svg+xml',
    };
    res.setHeader(
      'Content-Type',
      types[path.extname(file)] || 'application/octet-stream'
    );
    res.end(await readFile(file));
  } catch (error) {
    res.statusCode = 400;
    res.end(JSON.stringify({ code: 400, message: error.message }));
  }
});
const io = new Server(server);
const sessions = createDeskSessions({
  io,
  redis,
  prefixes: { deskUserUuid: 'desk:' },
  users: {
    login: ({ uuid, password }) =>
      Promise.resolve(accounts.get(uuid) === password),
  },
});
io.on('connection', (socket) => sessions.attach(socket));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath:
    process.env.SMOKE_BROWSER_EXECUTABLE ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
  ],
});
const errors = [];
let host;
let controller;
try {
  const hostContext = await browser.newContext();
  await hostContext.addInitScript(() => {
    const source = {
      id: 'window:101:0',
      captureId: 'window:101:0',
      nativeId: 101,
      ownerPid: 4242,
      bundleId: 'com.openai.codex',
      appName: 'Codex',
      name: 'Codex — synthetic task',
      thumbnail: '',
      appIcon: '',
      isOnScreen: true,
      isAiTarget: true,
      boundsSource: 'window',
      bounds: { x: 0, y: 0, width: 1280, height: 800 },
      inputScale: 1,
    };
    const session = {
      id: 'synthetic-session',
      title: 'Synthetic reading task',
      source: 'codex',
      projectPath: '/synthetic/project',
      turnState: 'idle',
      quality: 'complete',
      lastUpdatedAt: new Date().toISOString(),
    };
    const state = { inputs: [], sessionId: '' };
    window.desktopFixture = state;
    window.electronAPI = {
      ipcRenderer: {
        send() {},
        on() {},
        removeListener() {},
        invoke(channel, { data }) {
          let result = {};
          if (channel === 'getAgentApplications')
            result = { agents: [{ id: 'codex', name: 'Codex' }] };
          if (channel === 'capturePermissions')
            result = {
              platform: 'darwin',
              screen: 'granted',
              accessibility: true,
              targetApps: [],
            };
          if (channel === 'getCaptureSources')
            result = { sources: [source], sessionId: state.sessionId };
          if (channel === 'beginCapture') {
            state.sessionId = 'capture-1';
            result = {
              source,
              sessionId: state.sessionId,
              stream: { id: source.captureId },
            };
          }
          if (channel === 'stopCapture') state.sessionId = '';
          if (channel === 'remoteInput') state.inputs.push(data.input);
          if (channel === 'getPlatform') result = { platform: 'darwin' };
          if (channel === 'getPrimaryDisplaySize')
            result = { width: 1440, height: 900 };
          if (channel === 'scaleFactor')
            result = { scaleFactor: 1, platform: 'darwin' };
          if (
            channel === 'sessionReaderSettings' ||
            channel === 'sessionReaderConfigure'
          )
            result = { enabled: true, supported: true };
          if (channel === 'sessionReaderRequest') {
            if (data.method === 'status')
              result = { enabled: true, supported: true };
            else if (data.method === 'list')
              result = { sessions: [session], total: 1 };
            else
              result = {
                session,
                hasMore: false,
                items: [
                  {
                    id: 'message-1',
                    type: 'message',
                    role: 'assistant',
                    text: 'Synthetic reply',
                  },
                ],
              };
          }
          return Promise.resolve({ code: 0, data: result });
        },
      },
    };
    navigator.mediaDevices.getUserMedia = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 800;
      const ctx = canvas.getContext('2d');
      const draw = () => {
        ctx.fillStyle = '#f7f7f5';
        ctx.fillRect(0, 0, 1280, 800);
        ctx.fillStyle = '#ececea';
        ctx.fillRect(0, 0, 250, 800);
        ctx.fillStyle = '#2f3a33';
        ctx.font = '600 22px sans-serif';
        ctx.fillText('Synthetic agent window', 290, 60);
        ctx.font = '17px sans-serif';
        ['New task', 'Refactor input', 'Review tests'].forEach((item, i) =>
          ctx.fillText(item, 28, 70 + i * 44)
        );
        [
          'Agent: I read the project notes and drafted a plan.',
          '  • Step 1: collect the requirements',
          '  • Step 2: prepare a short summary',
          'You: Please continue with step 1.',
          'Agent: Working on it. I will report back here.',
        ].forEach((line, i) => ctx.fillText(line, 290, 130 + i * 48));
        ctx.strokeStyle = '#9aa59d';
        ctx.lineWidth = 2;
        ctx.strokeRect(290, 660, 950, 96);
        ctx.fillStyle = '#7b857e';
        ctx.fillText('Ask the agent… (prompt field)', 312, 716);
      };
      draw();
      const timer = setInterval(draw, 200);
      const stream = canvas.captureStream(5);
      const track = stream.getVideoTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => {
        clearInterval(timer);
        stop();
      };
      return Promise.resolve(stream);
    };
  });
  host = await hostContext.newPage();
  host.on('pageerror', (error) => errors.push(`host: ${error.message}`));
  const registration = host.waitForResponse((response) =>
    response.url().endsWith('/desk_user/create')
  );
  await host.goto(base);
  const device = (await (await registration).json()).data;
  await host.waitForFunction(
    async (uuid) =>
      (
        await (
          await fetch(`/api/desk_user/find_receiver_by_uuid?uuid=${uuid}`)
        ).json()
      ).data.receiver,
    device.uuid
  );
  const inputs = () => host.evaluate(() => window.desktopFixture.inputs);
  const clearInputs = () =>
    host.evaluate(() => {
      window.desktopFixture.inputs.length = 0;
    });

  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  controller = await desktopContext.newPage();
  controller.on('pageerror', (error) =>
    errors.push(`controller: ${error.message}`)
  );
  await controller.goto(base);
  // The web connection form hands the controller its credentials this way.
  await controller.evaluate(
    (value) => sessionStorage.setItem('codex-remote-session', value),
    JSON.stringify({
      deskUserUuid: 'fixture-desktop',
      deskUserPassword: 'fixture-password',
      remoteDeskUserUuid: device.uuid,
      remoteDeskUserPassword: device.password,
    })
  );
  await controller.goto(`${base}/#/webrtc`);
  await controller
    .getByRole('button', { name: /Synthetic reading task/ })
    .waitFor();
  await controller.getByRole('button', { name: '窗口', exact: true }).click();
  await controller
    .getByRole('button', { name: '打开 Codex', exact: true })
    .click();
  await controller.waitForFunction(
    () =>
      document.querySelector('video')?.readyState >= 2 &&
      document.querySelector('video').style.width
  );
  const layout = () =>
    controller.evaluate(() => {
      const box = (selector) =>
        document.querySelector(selector)?.getBoundingClientRect().toJSON();
      return {
        header: box('.controller-header'),
        tabs: box('.view-tabs'),
        tools: box('.tools'),
        video: box('.video-stage video'),
        panel: box('.keyboard-panel'),
        modes: Boolean(document.querySelector('.modes')),
        focusRing: Boolean(document.querySelector('.keyboard-focus')),
      };
    });
  const view = await layout();
  assert.equal(view.modes, false);
  assert.equal(view.panel, undefined);
  assert.ok(view.header.height <= 48, `header ${view.header.height}`);
  assert.ok(view.tabs.height <= 40, `tabs ${view.tabs.height}`);
  assert.ok(view.tools.height <= 42, `toolbar ${view.tools.height}`);
  assert.ok(view.video.height >= 740, `video ${view.video.height}`);
  // Let the transient relay notice disappear before the screenshot.
  await controller.waitForFunction(() => !document.querySelector('.n-message'));
  await controller.mouse.move(1435, 450);
  await controller.screenshot({ path: path.join(artifacts, 'window.png') });
  console.log(
    `PASS desktop Window view: compact rows, collapsed composer, ${Math.round(view.video.width)}×${Math.round(view.video.height)} remote window`
  );

  // Clicking the prompt field takes keyboard focus; typing reaches the host.
  const prompt = {
    x: view.video.x + view.video.width * 0.6,
    y: view.video.y + view.video.height * 0.885,
  };
  await controller.mouse.click(prompt.x, prompt.y);
  assert.equal((await layout()).focusRing, true);
  await controller.screenshot({
    path: path.join(artifacts, 'window-keyboard.png'),
  });
  await controller.keyboard.down('Shift');
  await controller.keyboard.press('KeyH');
  await controller.keyboard.up('Shift');
  await controller.keyboard.press('KeyI');
  await controller.keyboard.down('Shift');
  await controller.keyboard.press('Digit1');
  await controller.keyboard.up('Shift');
  await controller.keyboard.press('Backspace');
  await host.waitForFunction(
    () =>
      window.desktopFixture.inputs.filter((input) => input.action === 'keysUp')
        .length >= 6
  );
  const delivered = await inputs();
  const clickInputs = delivered.filter((input) =>
    ['down', 'up'].includes(input.action)
  );
  assert.deepEqual(
    clickInputs.map((input) => input.action),
    ['down', 'up']
  );
  assert.equal(clickInputs[0].x, clickInputs[1].x);
  assert.ok(Math.abs(clickInputs[0].x - 600) <= 1);
  // @nut-tree-fork/shared Key values: LeftShift, H, I, Num1, Backspace.
  assert.deepEqual(
    delivered
      .filter((input) => input.action === 'keysDown')
      .map((input) => input.keys[0]),
    [86, 76, 57, 86, 29, 41]
  );
  assert.equal(
    delivered.some((input) => input.action === 'click'),
    false,
    'no delayed tap click'
  );
  console.log(
    'PASS a click and typed text reach the host as direct presses and keys'
  );

  // Local reading and settings never forward keys to the host.
  await controller.getByRole('button', { name: '阅读', exact: true }).click();
  await clearInputs();
  const search = controller.getByLabel('搜索会话');
  await search.fill('reader query');
  await search.press('Enter');
  await controller.keyboard.press('Tab');
  await controller.keyboard.press('ArrowDown');
  await controller.keyboard.press('Escape');
  await controller.waitForTimeout(300);
  assert.deepEqual(
    (await inputs()).filter((input) => input.action !== 'releaseAll'),
    []
  );
  await controller.getByRole('button', { name: '窗口', exact: true }).click();
  await controller.getByLabel('连接设置', { exact: true }).click();
  const mode = controller.getByLabel('交互方式', { exact: true });
  assert.equal(await mode.inputValue(), 'auto');
  await mode.selectOption('touch');
  let touch = await layout();
  assert.equal(touch.modes, true);
  assert.ok(touch.panel, 'the touch layout opens the composer');
  await controller.getByLabel('发送到电脑的文字').fill('Keep this draft');
  await mode.selectOption('desktop');
  assert.equal((await layout()).panel, undefined);
  await controller.reload();
  await controller.getByLabel('连接设置', { exact: true }).click();
  assert.equal(await mode.inputValue(), 'desktop', 'the override is saved');
  await mode.selectOption('auto');
  assert.equal(
    await controller.evaluate(() =>
      localStorage.getItem('palmdesk-interaction-mode-v1')
    ),
    null
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS the reader keeps its keys; the settings override switches layouts and is saved'
  );
  await desktopContext.close();
  await host.waitForFunction(() => !window.desktopFixture.sessionId);

  // A phone opening the same page keeps the touch workflow.
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await phoneContext.newPage();
  await phone.goto(base);
  await phone.evaluate(
    (value) => sessionStorage.setItem('codex-remote-session', value),
    JSON.stringify({
      deskUserUuid: 'fixture-desktop',
      deskUserPassword: 'fixture-password',
      remoteDeskUserUuid: device.uuid,
      remoteDeskUserPassword: device.password,
    })
  );
  await phone.goto(`${base}/#/webrtc`);
  await phone.getByRole('button', { name: '窗口', exact: true }).click();
  await phone.getByRole('button', { name: '打开 Codex', exact: true }).click();
  await phone.waitForFunction(
    () => document.querySelector('video')?.readyState >= 2
  );
  touch = await phone.evaluate(() => ({
    modes: Boolean(document.querySelector('.modes')),
    panel: Boolean(document.querySelector('.keyboard-panel')),
    width: document.documentElement.scrollWidth,
  }));
  assert.deepEqual(touch, { modes: true, panel: true, width: 390 });
  await phone.waitForFunction(() => !document.querySelector('.n-message'));
  await phone.screenshot({ path: path.join(artifacts, 'phone-window.png') });
  assert.deepEqual(errors, []);
  console.log('PASS phones keep touch modes and the open composer');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error(
    'Controller state:',
    await controller?.locator('body').innerText()
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => io.close(resolve));
  server.close();
}
