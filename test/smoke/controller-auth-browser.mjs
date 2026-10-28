// Run after pnpm build:prod. The signaling server here admits every
// controller, whatever password it sends, as a compromised or malicious one
// would. The real host and controller pages run over real WebRTC; only native
// capture, input and transcripts are fake. The host must refuse input, windows,
// Agents and transcripts to any controller that cannot prove the password.
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

const HOST = { uuid: 'fixture-host', password: 'Ab3dE6gH' };
const redis = new MemoryRedis();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let text = '';
      for await (const part of req) text += part;
      const body = text ? JSON.parse(text) : {};
      let data = {};
      if (url.pathname.endsWith('/desk_user/create')) data = HOST;
      else if (url.pathname.endsWith('/desk_user/login')) data = body;
      else if (url.pathname.endsWith('/desk_user/find_receiver_by_uuid')) {
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
  // Admits any device and any remote password.
  users: { login: async () => true },
});
const admitted = [];
io.on('connection', (socket) => {
  sessions.attach(socket);
  socket.onAny((event, packet) => {
    if (event === 'billdDeskStartRemote')
      admitted.push(packet.data.remoteDeskUserPassword);
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
let host;
let phone;
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
    const state = { calls: [], inputs: [], sessionId: '' };
    window.authFixture = state;
    window.electronAPI = {
      ipcRenderer: {
        send() {},
        on() {},
        removeListener() {},
        async invoke(channel, { data }) {
          state.calls.push(
            channel === 'sessionReaderRequest'
              ? `${channel}:${data.method}`
              : channel
          );
          let result = {};
          if (channel === 'capturePermissions')
            result = {
              platform: 'darwin',
              screen: 'granted',
              accessibility: true,
              targetApps: [],
            };
          if (channel === 'getCaptureSources')
            result = { sources: [source], sessionId: state.sessionId };
          if (channel === 'getAgentApplications')
            result = { agents: [{ id: 'codex', name: 'Codex' }] };
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
          if (channel === 'getPrimaryDisplaySize')
            result = { width: 1280, height: 900 };
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
                    text: 'Synthetic transcript',
                  },
                ],
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
      const draw = () => {
        ctx.fillStyle = '#174d39';
        ctx.fillRect(0, 0, 960, 600);
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
  host.on('pageerror', (error) => errors.push(`host: ${error.message}`));
  await host.goto(base);
  await host.waitForFunction(
    async (uuid) =>
      (
        await (
          await fetch(`/api/desk_user/find_receiver_by_uuid?uuid=${uuid}`)
        ).json()
      ).data.receiver,
    HOST.uuid
  );
  // Native work only a controller's request starts. The host still stops
  // capture on its own when its last controller leaves.
  const privileged =
    /^(sessionReaderRequest|remoteInput|beginCapture|getCaptureSources|getAgentApplications|getInstalledAgents|launchAgent|cancelAgentLaunch|pasteImage|cancelImagePaste)/;
  const own = await host.evaluate(() => window.authFixture.calls.length);
  const requested = async () =>
    (
      await host.evaluate((from) => window.authFixture.calls.slice(from), own)
    ).filter((call) => privileged.test(call));

  // A controller page that also sends every privileged request on its own,
  // as modified code would, until the host closes its channels.
  const controller = async (device, password, { hello = true } = {}) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await context.addInitScript(
      ({ session, hello }) => {
        sessionStorage.setItem('codex-remote-session', session);
        const state = { replies: [], requests: 0 };
        window.attackFixture = state;
        const send = RTCDataChannel.prototype.send;
        if (!hello)
          RTCDataChannel.prototype.send = function (value) {
            if (typeof value === 'string' && value.includes('remoteAuthHello'))
              return;
            return send.call(this, value);
          };
        const requests = {
          MessageChannel: [
            { msgType: 'remoteInstalledAgentsRequest', data: {} },
            {
              msgType: 'remoteWindowsRequest',
              data: { agentDiscovery: true, previews: true },
            },
            { msgType: 'remoteWindowSelect', data: { id: 'window:101:0' } },
            { msgType: 'remoteAgentLaunch', data: { id: 'codex' } },
            {
              msgType: 'billdDeskBehavior',
              data: { type: 14, text: 'attacker input' },
            },
            {
              msgType: 'remoteImagePaste',
              data: { sessionId: 'capture-1', id: 1 },
            },
          ],
          SessionReader: [
            { type: 'request', id: '1', request: { method: 'status' } },
            { type: 'request', id: '2', request: { method: 'list' } },
            {
              type: 'request',
              id: '3',
              request: { method: 'read', id: 'synthetic-session' },
            },
          ],
        };
        const create = RTCPeerConnection.prototype.createDataChannel;
        RTCPeerConnection.prototype.createDataChannel = function (...args) {
          const channel = create.apply(this, args);
          const flood = requests[args[0]];
          if (flood)
            channel.addEventListener('open', () => {
              const timer = setInterval(() => {
                if (channel.readyState !== 'open') {
                  clearInterval(timer);
                  return;
                }
                flood.forEach((request) => {
                  state.requests += 1;
                  send.call(
                    channel,
                    JSON.stringify({
                      requestId: `attack-${state.requests}`,
                      ...request,
                    })
                  );
                });
                // The first round follows the page's hello, sent on open.
              }, 20);
            });
          return channel;
        };
        const peer = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends peer {
          constructor(...args) {
            super(...args);
            this.addEventListener('datachannel', ({ channel }) =>
              channel.addEventListener('message', ({ data }) => {
                if (typeof data === 'string') state.replies.push(data);
              })
            );
          }
        };
      },
      {
        hello,
        session: JSON.stringify({
          deskUserUuid: device,
          deskUserPassword: 'controller-password',
          remoteDeskUserUuid: HOST.uuid,
          remoteDeskUserPassword: password,
        }),
      }
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${device}: ${error.message}`));
    await page.goto(`${base}/#/webrtc`);
    return page;
  };
  const refused = async (page, notice) => {
    await page
      .locator('.connection-message')
      .getByText(/验证/)
      .waitFor({ timeout: 20000 });
    await host.getByText(notice).waitFor();
    // Give queued requests time to reach the host after the refusal.
    await page.waitForTimeout(500);
    const replies = await page.evaluate(() => window.attackFixture.replies);
    const answered = replies.filter(
      (reply) =>
        !reply.includes('remoteSessionStopped') && !reply.includes('"start"')
    );
    assert.deepEqual(answered, [], 'the host answered an unverified request');
    assert.ok(
      (await page.evaluate(() => window.attackFixture.requests)) > 0,
      'the controller sent requests before it was refused'
    );
  };

  phone = await controller('fixture-attacker', 'wrong-password');
  await refused(phone, '已断开未通过密码验证的控制端');
  assert.equal(admitted.at(-1), 'wrong-password');
  assert.deepEqual(await requested(), []);
  console.log(
    'PASS a controller admitted with a wrong password cannot send input, open windows or Agents, or read sessions'
  );
  await phone.context().close();

  phone = await controller('fixture-legacy', HOST.password, { hello: false });
  await refused(phone, '已断开旧版控制端');
  assert.deepEqual(await requested(), []);
  console.log(
    'PASS a controller that skips verification is refused, even with the right password'
  );
  await phone.context().close();

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    (session) => sessionStorage.setItem('codex-remote-session', session),
    JSON.stringify({
      deskUserUuid: 'fixture-phone',
      deskUserPassword: 'controller-password',
      remoteDeskUserUuid: HOST.uuid,
      remoteDeskUserPassword: HOST.password,
    })
  );
  phone = await context.newPage();
  phone.on('pageerror', (error) => errors.push(`phone: ${error.message}`));
  await phone.goto(`${base}/#/webrtc`);
  await phone.getByRole('button', { name: /Synthetic reading task/ }).waitFor();
  await host.getByText('正在被fixture-phone控制').waitFor();
  await phone.getByRole('button', { name: '窗口', exact: true }).click();
  await phone.getByRole('button', { name: '打开 Codex', exact: true }).click();
  await phone.waitForFunction(
    () => document.querySelector('video')?.readyState >= 2
  );
  await phone.getByLabel('发送到电脑的文字').fill('verified input');
  await phone.getByRole('button', { name: '发送文字', exact: true }).click();
  await host.waitForFunction(() =>
    window.authFixture.inputs.some((input) => input.text === 'verified input')
  );
  const calls = await requested();
  assert.ok(calls.includes('sessionReaderRequest:list'));
  assert.ok(calls.includes('beginCapture'));
  assert.equal(
    (
      await host.evaluate(() => window.authFixture.inputs.map((i) => i.text))
    ).includes('attacker input'),
    false
  );
  console.log(
    'PASS a controller that proves the password reads sessions and controls the window'
  );
  assert.deepEqual(errors, []);
} catch (error) {
  console.error('Browser errors:', errors);
  console.error('Phone state:', await phone?.locator('body').innerText());
  console.error('Host state:', await host?.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => io.close(resolve));
  server.close();
}
