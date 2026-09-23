/* eslint-disable no-restricted-syntax, require-await */
// Run after pnpm build:prod. Uses real Vue pages, Socket.IO session auth and
// WebRTC; only native capture/input, device persistence and transcripts are fake.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const redis = new MemoryRedis();
const accounts = new Map([['fixture-phone', 'fixture-password']]);
let devices = 0;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let text = '';
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
    login: async ({ uuid, password }) => accounts.get(uuid) === password,
  },
});
const signaling = [];
io.on('connection', (socket) => {
  sessions.attach(socket);
  socket.onAny((event) => {
    if (event.startsWith('nativeWebRtc')) signaling.push(event);
  });
});
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
const diagnostics = [];
let host;
let phone;
try {
  const hostContext = await browser.newContext();
  await hostContext.addInitScript(() => {
    const peers = [];
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(...args) {
        super(...args);
        peers.push(this);
      }
    };
    const source = {
      id: 'window:101:0',
      captureId: 'window:101:0',
      nativeId: 101,
      ownerPid: 4242,
      bundleId: 'com.openai.codex',
      appName: 'Codex',
      name: 'Synthetic task window',
      thumbnail: '',
      appIcon: '',
      isOnScreen: true,
      isAiTarget: true,
      boundsSource: 'window',
      bounds: { x: 0, y: 0, width: 960, height: 600 },
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
    const state = {
      peers,
      captures: 0,
      inputs: [],
      sessionId: '',
      sources: true,
      enabled: true,
      dropReplies: false,
      dropStop: false,
    };
    window.resumeFixture = state;
    const send = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (value) {
      if (
        (state.dropReplies || state.dropStop) &&
        typeof value === 'string' &&
        (value.includes('remoteControllerStateResult') ||
          value.includes('remoteSessionStopped'))
      )
        return;
      return send.call(this, value);
    };
    window.electronAPI = {
      ipcRenderer: {
        send() {},
        on() {},
        removeListener() {},
        async invoke(channel, { data }) {
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
            result = {
              sources: state.sources ? [source] : [],
              sessionId: state.sessionId,
            };
          if (channel === 'beginCapture') {
            if (!state.sources || data.sourceId !== source.id)
              return { code: 1, msg: 'Window closed' };
            state.captures += 1;
            state.sessionId = `capture-${state.captures}`;
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
            result = { width: 1280, height: 900 };
          if (channel === 'scaleFactor')
            result = { scaleFactor: 1, platform: 'darwin' };
          if (channel === 'sessionReaderConfigure')
            state.enabled = data.enabled;
          if (
            channel === 'sessionReaderSettings' ||
            channel === 'sessionReaderConfigure'
          )
            result = { enabled: state.enabled, supported: true };
          if (channel === 'sessionReaderRequest') {
            if (data.method === 'status')
              result = { enabled: state.enabled, supported: true };
            else if (!state.enabled)
              return { code: 1, msg: 'Reading disabled' };
            else if (data.method === 'list')
              result = { sessions: [session], total: 1 };
            else
              result = {
                session,
                hasMore: false,
                items: Array.from({ length: 30 }, (_, i) => ({
                  id: `message-${i}`,
                  type: 'message',
                  role: 'assistant',
                  text: `Synthetic reply ${i}\n\nText for testing reading position.`,
                })),
              };
          }
          return { code: 0, data: result };
        },
      },
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 600;
      const ctx = canvas.getContext('2d');
      let count = 0;
      const draw = () => {
        ctx.fillStyle = '#174d39';
        ctx.fillRect(0, 0, 960, 600);
        ctx.fillStyle = 'white';
        ctx.font = '32px sans-serif';
        count += 1;
        ctx.fillText(`Synthetic frame ${count}`, 40, 80);
      };
      draw();
      const timer = setInterval(draw, 100);
      const stream = canvas.captureStream(10);
      const track = stream.getVideoTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => {
        clearInterval(timer);
        stop();
      };
      return stream;
    };
  });
  host = await hostContext.newPage();
  host.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(message.text());
  });
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

  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await phoneContext.addInitScript(() => {
    const peers = [];
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(...args) {
        super(...args);
        peers.push(this);
      }
    };
    const state = { hidden: false, dropPresence: false, peers };
    window.resumeFixture = state;
    Object.defineProperty(document, 'hidden', { get: () => state.hidden });
    const send = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (value) {
      if (
        state.dropPresence &&
        typeof value === 'string' &&
        value.includes('remoteControllerState')
      )
        return;
      return send.call(this, value);
    };
  });
  phone = await phoneContext.newPage();
  phone.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(message.text());
  });
  phone.on('pageerror', (error) => errors.push(`phone: ${error.message}`));
  const query = new URLSearchParams({
    deskUserUuid: 'fixture-phone',
    deskUserPassword: 'fixture-password',
    remoteDeskUserUuid: device.uuid,
    remoteDeskUserPassword: device.password,
  });
  await phone.goto(`${base}/#/webrtc?${query}`);
  await phone.getByRole('button', { name: /Synthetic reading task/ }).click();
  const timeline = phone.locator('.timeline');
  await timeline.locator('.message-card').last().waitFor();
  await timeline.evaluate((element) => {
    element.scrollTop = 150;
  });
  const position = await timeline.evaluate((element) => element.scrollTop);
  const active = async (value) =>
    host.waitForFunction((expected) => {
      const sender = window.resumeFixture.peers
        .filter((pc) => pc.connectionState === 'connected')
        .flatMap((pc) => pc.getSenders())
        .find((sender) => sender.track?.kind === 'video');
      return (
        sender &&
        sender
          .getParameters()
          .encodings.every((encoding) => encoding.active === expected)
      );
    }, value);
  const visibility = (hidden) =>
    phone.evaluate((value) => {
      window.resumeFixture.hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await visibility(true);
  await phone.getByRole('button', { name: '窗口', exact: true }).click();
  await visibility(false);
  await phone.getByRole('button', { name: '打开 Codex', exact: true }).click();
  await phone.waitForFunction(
    () => document.querySelector('video')?.readyState >= 2
  );
  const draft = phone.getByLabel('发送到电脑的文字');
  await draft.fill('Keep this unsent draft');

  await active(true);
  await visibility(true);
  await active(false);
  await visibility(false);
  await active(true);
  assert.equal(await draft.inputValue(), 'Keep this unsent draft');
  assert.equal(await host.evaluate(() => window.resumeFixture.captures), 1);
  console.log(
    'PASS background pauses sender; foreground resumes the same capture and draft'
  );

  await phone.getByRole('button', { name: '阅读', exact: true }).click();
  await active(false);
  assert.equal(
    await timeline.evaluate((element) => element.scrollTop),
    position
  );
  await visibility(true);
  const phoneSocket = [...io.sockets.sockets.values()].find(
    (socket) => socket.data.desk?.device === 'fixture-phone'
  );
  phoneSocket.disconnect(true);
  await host.waitForFunction(() =>
    window.resumeFixture.peers.every(
      (peer) => peer.connectionState === 'closed'
    )
  );
  await visibility(false);
  await phone.getByRole('button', { name: '窗口', exact: true }).waitFor();
  assert.equal(await timeline.locator('.message-card').count(), 30);
  assert.equal(
    await timeline.evaluate((element) => element.scrollTop),
    position
  );
  assert.equal(
    await host.evaluate(() => window.resumeFixture.captures),
    1,
    'reading reconnect does not restart video'
  );
  await phone.getByRole('button', { name: '窗口', exact: true }).click();
  await host.waitForFunction(() => window.resumeFixture.captures === 2);
  await active(true);
  assert.equal(await draft.inputValue(), 'Keep this unsent draft');
  console.log(
    'PASS fresh authenticated session restores reading position and revalidates the selected window'
  );

  await phone.evaluate(() => {
    window.resumeFixture.dropPresence = true;
  });
  await visibility(true);
  await active(false);
  await phone.evaluate(() => {
    window.resumeFixture.dropPresence = false;
  });
  await visibility(false);
  await active(true);
  console.log(
    'PASS host lease pauses video when the phone cannot deliver visibility changes'
  );

  await host.evaluate(() => {
    window.resumeFixture.dropReplies = true;
  });
  await host.waitForFunction(() => window.resumeFixture.captures === 3);
  await host.evaluate(() => {
    window.resumeFixture.dropReplies = false;
  });
  await active(true);
  assert.equal(await draft.inputValue(), 'Keep this unsent draft');
  console.log(
    'PASS an unresponsive channel is replaced even when WebRTC still reports connected'
  );

  // Lose the native window during suspension. Matching by title must not occur.
  await visibility(true);
  [...io.sockets.sockets.values()]
    .find((socket) => socket.data.desk?.device === 'fixture-phone')
    .disconnect(true);
  await host.waitForFunction(() =>
    window.resumeFixture.peers.every(
      (peer) => peer.connectionState === 'closed'
    )
  );
  await host.evaluate(() => {
    window.resumeFixture.sources = false;
  });
  await visibility(false);
  await phone
    .getByText('原窗口已关闭或身份已变化，请重新选择窗口', { exact: true })
    .waitFor();
  assert.equal(await host.evaluate(() => window.resumeFixture.captures), 3);
  assert.equal(
    await host.evaluate(() =>
      window.resumeFixture.inputs.some((input) => input.action === 'text')
    ),
    false
  );
  console.log(
    'PASS closed windows are not restored and drafts are never replayed as input'
  );

  await phone.getByRole('button', { name: '阅读', exact: true }).click();
  assert.equal(await timeline.locator('.message-card').count(), 30);
  await visibility(true);
  [...io.sockets.sockets.values()]
    .find((socket) => socket.data.desk?.device === 'fixture-phone')
    .disconnect(true);
  await host.locator('.reader-settings input').uncheck();
  await visibility(false);
  await phone.getByText('开启会话阅读', { exact: true }).waitFor();
  assert.equal(await timeline.locator('.message-card').count(), 0);
  console.log(
    'PASS revoking reading while disconnected clears cached transcript on reconnection'
  );

  await host.evaluate(() => {
    window.resumeFixture.dropStop = true;
  });
  await host.getByText('断开', { exact: true }).click();
  await phone
    .getByText('电脑已结束本次连接，请手动重新连接', { exact: true })
    .waitFor();
  await visibility(true);
  await visibility(false);
  await phone.waitForTimeout(2500);
  assert.equal(
    [...io.sockets.sockets.values()].some(
      (socket) => socket.data.desk?.device === 'fixture-phone'
    ),
    false
  );
  console.log(
    'PASS explicit desktop disconnect is not undone by foreground recovery'
  );
  assert.deepEqual(errors, []);
} catch (error) {
  console.error('Browser errors:', errors);
  console.error('Diagnostics:', diagnostics, signaling);
  console.error('Phone state:', await phone?.locator('body').innerText());
  console.error('Host state:', await host?.locator('body').innerText());
  for (const page of [host, phone])
    console.error(
      'Peers:',
      await page?.evaluate(() =>
        window.resumeFixture?.peers.map((pc) => ({
          connection: pc.connectionState,
          ice: pc.iceConnectionState,
          signaling: pc.signalingState,
          local: pc.localDescription?.type,
          remote: pc.remoteDescription?.type,
        }))
      )
    );
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => io.close(resolve));
  server.close();
}
