// Measures the dev-server preview prototype (#26) against a real Vite dev
// server in headless Chromium. Everything listens on loopback; nothing talks
// to a PalmDesk service. The fixed browser-smoke ports are not used, but run it
// under the same lock as the other browser checks:
//
//   lockf -k "$(git rev-parse --git-common-dir)/browser-smoke.lock" \
//     node test/dev-preview/run.mjs
//
// --serve keeps the servers running for manual testing in a desktop browser.
// --https serves both origins over TLS with a throwaway self-signed
// certificate under non-loopback names (palmdesk.test and preview.test, or
// preview.palmdesk.test with --same-site), as a deployment would.
// Results are printed and written to .local/dev-preview/results.json.
import { execFileSync, spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const viteVersion = require('vite/package.json').version;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const serveOnly = process.argv.includes('--serve');
const secure = process.argv.includes('--https');
const sameSite = process.argv.includes('--same-site');
const checks = [];
const metrics = {};

function listen(server, host = '127.0.0.1') {
  return new Promise((resolve) =>
    server.listen(0, host, () => resolve(server.address().port))
  );
}

async function freePort(host) {
  const server = http.createServer();
  const port = await listen(server, host);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function until(fn, { timeout = 15_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline)
      throw new Error(
        `Timed out waiting for ${label}${last ? `: ${last.message}` : ''}`
      );
    await delay(25);
  }
}

async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, ok: true, detail: detail ?? '' });
    console.log(`ok - ${name}${detail ? ` (${detail})` : ''}`);
  } catch (error) {
    checks.push({ name, ok: false, detail: error.message });
    console.log(`not ok - ${name}: ${error.message}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

// --- Servers -------------------------------------------------------------

// The macOS temp folder is a symlink, which Vite's fs.allow check rejects.
const workDir = await realpath(
  await mkdtemp(path.join(os.tmpdir(), 'palmdesk-preview-'))
);
const appDir = path.join(workDir, 'app');
await cp(path.join(here, 'fixture-app'), appDir, { recursive: true });

// Records any request that reaches a port the host never approved.
const canaryHits = [];
const canary = http.createServer((req, res) => {
  canaryHits.push(req.url);
  res.end('canary');
});
canary.on('upgrade', (req, socket) => {
  canaryHits.push(`upgrade ${req.url}`);
  socket.destroy();
});
const canaryPort = await listen(canary);

// A second approved server on another port (IPv4 only), limited to /api/.
const apiHits = [];
const api = http.createServer((req, res) => {
  apiHits.push(req.url);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ pong: true, host: req.headers.host }));
});
const apiPort = await listen(api);
const downPort = await freePort('127.0.0.1');

// Like a real project, Vite runs in its own process, with its default host:
// localhost, which binds ::1 only on this Mac.
const vitePort = await freePort('localhost');
const vite = spawn(
  process.execPath,
  [
    path.join(
      path.dirname(require.resolve('vite/package.json')),
      'bin/vite.js'
    ),
    '--config',
    path.join(appDir, 'vite.config.mjs'),
    '--host',
    'localhost',
    '--port',
    String(vitePort),
    '--strictPort',
  ],
  {
    cwd: appDir,
    env: { ...process.env, PREVIEW_FIXTURE_CANARY_PORT: String(canaryPort) },
    stdio: ['ignore', 'ignore', 'inherit'],
  }
);
const viteUrl = `http://localhost:${vitePort}`;
await until(async () => (await fetch(`${viteUrl}/`)).ok, {
  timeout: 60_000,
  label: 'the Vite dev server',
});

function accepts(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}
const viteAddresses = (
  await Promise.all(
    ['127.0.0.1', '::1'].map(async (host) =>
      (await accepts(host, vitePort)) ? host : ''
    )
  )
).filter(Boolean);

const targets = [
  { id: 'web', label: 'Vite app', port: vitePort },
  { id: 'api', label: 'API server', port: apiPort, prefix: '/api/' },
  { id: 'down', label: 'Stopped server', port: downPort },
];
let origins = { extraParentHosts: ['palmdesk.test'] };
if (secure) {
  const previewHost = sameSite ? 'preview.palmdesk.test' : 'preview.test';
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=palmdesk.test',
      '-addext',
      `subjectAltName=DNS:palmdesk.test,DNS:${previewHost}`,
      '-keyout',
      path.join(workDir, 'key.pem'),
      '-out',
      path.join(workDir, 'cert.pem'),
    ],
    { stdio: 'ignore' }
  );
  origins = {
    palmdeskHost: 'palmdesk.test',
    previewHost,
    tls: {
      key: await readFile(path.join(workDir, 'key.pem'), 'utf8'),
      cert: await readFile(path.join(workDir, 'cert.pem'), 'utf8'),
    },
  };
}
const worker = new Worker(new URL('./prototype-worker.mjs', import.meta.url), {
  workerData: { targets, verified: serveOnly, ...origins },
});
const replies = new Map();
let sequence = 0;
const prototype = await new Promise((resolve, reject) => {
  worker.once('error', reject);
  worker.on('message', (message) => {
    if (message.ready) resolve(message.ready);
    else replies.get(message.id)?.(message.result);
  });
});
function call(command, args) {
  sequence += 1;
  const id = sequence;
  return new Promise((resolve) => {
    replies.set(id, resolve);
    worker.postMessage({ id, command, args });
  });
}

async function shutdown() {
  await call('close');
  await worker.terminate();
  if (vite.exitCode === null)
    await new Promise((resolve) => {
      vite.once('exit', resolve);
      vite.kill();
    });
  await Promise.all(
    [canary, api].map(
      (server) => new Promise((resolve) => server.close(resolve))
    )
  );
  await rm(workDir, { recursive: true, force: true });
}

if (serveOnly) {
  console.log(
    `Vite fixture:  ${viteUrl}/ (listening on ${viteAddresses.join(', ')})`
  );
  console.log(`1. Host page:  ${prototype.hostUrl}`);
  console.log(`2. Controller: ${prototype.controllerUrl}`);
  console.log('Targets are approved and the controller counts as verified.');
  console.log('Press Ctrl-C to stop.');
  await new Promise((resolve) => process.once('SIGINT', resolve));
  await shutdown();
  process.exit(0);
}

// --- Browser ---------------------------------------------------------------

const browser = await chromium.launch({
  executablePath: process.env.SMOKE_BROWSER_EXECUTABLE || undefined,
  headless: true,
  args: [
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    // Non-loopback names, like a LAN address or a deployment's domains.
    '--host-resolver-rules=MAP *.test 127.0.0.1, MAP palmdesk.test 127.0.0.1',
    // Only the throwaway certificate above is ever presented.
    ...(secure ? ['--ignore-certificate-errors'] : []),
  ],
});
const phoneOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};
const errors = [];

const gatewayStats = () => call('stats');

function diff(after, before) {
  return {
    requests: after.requests - before.requests,
    upstreamBytes: after.upstreamBytes - before.upstreamBytes,
    wireBytes: after.sentFrameBytes - before.sentFrameBytes,
  };
}

function appFrame(page) {
  return until(
    () =>
      page.frames().find((frame) => {
        if (
          frame.isDetached() ||
          !frame.url().startsWith(prototype.previewOrigin)
        )
          return false;
        return !new URL(frame.url()).pathname.startsWith(
          '/__palmdesk_preview/'
        );
      }),
    { label: 'the preview app frame' }
  );
}

const bridgeState = (page) =>
  page.evaluate(() => {
    const { bridge } = window.preview;
    return { state: bridge.state, reason: bridge.reason };
  });

async function openController(context, url = prototype.controllerUrl) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${url}: ${error.message}`));
  await page.goto(url);
  await page.waitForFunction(
    () => window.preview?.channel.readyState === 'open'
  );
  return page;
}

try {
  metrics.environment = {
    origins: `${new URL(prototype.controllerUrl).origin} embeds ${prototype.previewOrigin}`,
    node: process.version,
    chromium: browser.version(),
    vite: viteVersion,
    viteListensOn: viteAddresses.join(', '),
  };
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  await hostPage.goto(prototype.hostUrl);

  const phoneContext = await browser.newContext(phoneOptions);
  let phone = await openController(phoneContext);

  await check(
    'an unverified controller is denied and cannot send requests',
    async () => {
      await until(async () => (await bridgeState(phone)).state === 'denied', {
        label: 'denied',
      });
      expect(
        (await bridgeState(phone)).reason === 'unverified',
        'wrong reason'
      );
      await phone.evaluate(() =>
        window.preview.channel.send(
          JSON.stringify({
            t: 'req',
            id: 4242,
            target: 'web',
            method: 'GET',
            path: '/',
            headers: [],
            body: 0,
          })
        )
      );
      await until(async () => (await gatewayStats()).refused.unverified >= 1, {
        label: 'refusal',
      });
      return 'host answered denied/unverified';
    }
  );

  await call('setVerified', true);
  await check(
    'a verified controller receives the host-approved list',
    async () => {
      await until(async () => (await bridgeState(phone)).state === 'ready', {
        label: 'grant',
      });
      const ids = await phone.evaluate(() =>
        window.preview.bridge.grant.targets.map(
          ({ id, port, prefix }) => `${id}:${port}${prefix}`
        )
      );
      expect(ids.length === 3, `got ${ids.join(', ')}`);
      const sizes = await phone.evaluate(() => ({
        sctp: window.preview.peer.sctp.maxMessageSize,
        frame: window.preview.bridge.grant.limits.frame,
      }));
      metrics.frameBytes = sizes.frame;
      metrics.sctpMaxMessageSize = sizes.sctp;
      return `${ids.join(', ')}; frames of ${sizes.frame} bytes (SCTP max-message-size ${sizes.sctp})`;
    }
  );

  // Reference: the same app loaded directly from the Vite server.
  const directContext = await browser.newContext(phoneOptions);
  const direct = await directContext.newPage();
  let directRequests = 0;
  direct.on('request', () => {
    directRequests += 1;
  });
  let started = Date.now();
  await direct.goto(`http://localhost:${vitePort}/`);
  await direct.waitForFunction(() => window.fixture?.ready);
  metrics.directFirstLoadMs =
    (await direct.evaluate(() => window.fixture.readyAt)) - started;

  let app;
  await check('cold preview load (worker install + first load)', async () => {
    const before = await gatewayStats();
    started = Date.now();
    await phone.evaluate(() => window.preview.bridge.open('web'));
    app = await appFrame(phone);
    await until(() => app.evaluate(() => window.fixture?.ready), {
      timeout: 30_000,
      label: 'fixture ready',
    });
    metrics.previewColdLoadMs =
      (await app.evaluate(() => window.fixture.readyAt)) - started;
    metrics.previewWorkerReadyMs =
      (await phone.evaluate(() => window.preview.bridge.stateAt)) - started;
    metrics.previewColdTransfer = diff(await gatewayStats(), before);
    return `${metrics.previewColdLoadMs} ms (worker ready after ${metrics.previewWorkerReadyMs} ms), ${metrics.previewColdTransfer.requests} requests, ${kib(metrics.previewColdTransfer.upstreamBytes)} from Vite, ${kib(metrics.previewColdTransfer.wireBytes)} over the DataChannel`;
  });

  directRequests = 0;
  started = Date.now();
  await direct.reload();
  await direct.waitForFunction(() => window.fixture?.ready);
  metrics.directReloadMs =
    (await direct.evaluate(() => window.fixture.readyAt)) - started;
  metrics.directReloadRequests = directRequests;

  await check('static assets, imported assets and CSS', async () => {
    const result = await app.evaluate(async () => {
      const favicon = await fetch('/favicon.svg');
      const logo = document.querySelector('#logo');
      await logo.decode().catch(() => {});
      return {
        favicon: favicon.status,
        type: favicon.headers.get('content-type'),
        logo: logo.naturalWidth,
        color: getComputedStyle(document.body).color,
      };
    });
    expect(
      result.favicon === 200 && result.type.includes('svg'),
      JSON.stringify(result)
    );
    expect(result.logo === 48, `logo width ${result.logo}`);
    expect(result.color === 'rgb(20, 120, 90)', `color ${result.color}`);
    return `favicon ${result.type}, logo ${result.logo}px, CSS applied`;
  });

  await check(
    'client-side routing, then refresh on the deep route',
    async () => {
      await app.click('a[href="/about"]');
      await until(() => app.evaluate(() => window.fixture.route === '/about'), {
        label: 'route',
      });
      const loadedAt = await app.evaluate(() => window.fixture.loadedAt);
      const before = await gatewayStats();
      started = Date.now();
      await app.evaluate(() => setTimeout(() => location.reload()));
      await until(
        () =>
          app.evaluate(
            (previous) =>
              window.fixture?.ready && window.fixture.loadedAt !== previous,
            loadedAt
          ),
        { label: 'reload' }
      );
      const after = await app.evaluate(() => ({
        route: location.pathname,
        title: document.querySelector('#route').textContent,
        readyAt: window.fixture.readyAt,
      }));
      metrics.previewReloadMs = after.readyAt - started;
      metrics.previewReloadTransfer = diff(await gatewayStats(), before);
      metrics.previewReloadNotModified = await phone.evaluate(
        () => window.preview.bridge.snapshot().statuses['304'] || 0
      );
      expect(
        after.route === '/about' && after.title === 'About',
        JSON.stringify(after)
      );
      return `reload ${metrics.previewReloadMs} ms, ${metrics.previewReloadTransfer.requests} requests (${metrics.previewReloadNotModified} answered 304 from the worker cache), ${kib(metrics.previewReloadTransfer.wireBytes)} over the DataChannel`;
    }
  );

  await check(
    'a navigation redirect inside the target is followed',
    async () => {
      const loadedAt = await app.evaluate(() => window.fixture.loadedAt);
      await app.evaluate(() =>
        setTimeout(() => location.assign('/api/redirect/same'))
      );
      await until(
        () =>
          app.evaluate(
            (previous) =>
              window.fixture?.ready &&
              window.fixture.loadedAt !== previous &&
              location.pathname === '/about',
            loadedAt
          ),
        { label: 'redirected navigation' }
      );
    }
  );

  await check('same-origin fetch: GET and POST with a JSON body', async () => {
    const result = await app.evaluate(async () => {
      const hello = await (await fetch('/api/hello')).json();
      const echo = await (
        await fetch('/api/echo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'hi from preview' }),
        })
      ).json();
      return { hello, echo };
    });
    expect(
      result.hello.host === `localhost:${vitePort}`,
      `Host ${result.hello.host}`
    );
    expect(result.echo.body === '{"text":"hi from preview"}', result.echo.body);
    expect(
      result.echo.contentType === 'application/json',
      result.echo.contentType
    );
    return `upstream saw Host ${result.hello.host}, Origin ${result.hello.origin}`;
  });

  await check(
    'per-request overhead (20 sequential small requests)',
    async () => {
      const median = (list) =>
        [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
      const preview = await app.evaluate(async () => {
        const rows = [];
        for (let index = 0; index < 20; index += 1) {
          const start = performance.now();
          const response = await fetch('/api/hello');
          await response.arrayBuffer();
          const parts = Object.fromEntries(
            (response.headers.get('x-palmdesk-preview-timing') || '')
              .split(';')
              .map((part) => part.split('='))
              .map(([key, value]) => [key, Number(value)])
          );
          rows.push({ total: performance.now() - start, ...parts });
        }
        return rows;
      });
      const directTimes = await direct.evaluate(async () => {
        const rows = [];
        for (let index = 0; index < 20; index += 1) {
          const start = performance.now();
          await (await fetch('/api/hello')).arrayBuffer();
          rows.push(performance.now() - start);
        }
        return rows;
      });
      metrics.requestOverheadMs = Object.fromEntries(
        ['total', 'relay', 'cache', 'head', 'upstream'].map((key) => [
          key,
          Number(median(preview.map((row) => row[key])).toFixed(1)),
        ])
      );
      metrics.requestOverheadMs.direct = Number(median(directTimes).toFixed(1));
      const { total, relay, cache, head, upstream } = metrics.requestOverheadMs;
      return `median ${total} ms (direct ${metrics.requestOverheadMs.direct} ms): worker relay lookup ${relay}, cache lookup ${cache}, until headers ${head} (dev server ${upstream})`;
    }
  );

  await check('streamed responses arrive incrementally', async () => {
    const result = await app.evaluate(async () => {
      const start = performance.now();
      const reader = (await fetch('/api/stream')).body.getReader();
      const decoder = new TextDecoder();
      const times = [];
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        times.push(Math.round(performance.now() - start));
      }
      return { text, first: times[0], last: times.at(-1) };
    });
    expect(
      result.text === 'chunk-0\nchunk-1\nchunk-2\n',
      JSON.stringify(result.text)
    );
    expect(result.first < 300 && result.last >= 700, JSON.stringify(result));
    return `first chunk after ${result.first} ms, last after ${result.last} ms`;
  });

  await check('EventSource (server-sent events)', async () => {
    const events = await app.evaluate(
      () =>
        new Promise((resolve) => {
          const list = [];
          const source = new EventSource('/api/events');
          source.onmessage = ({ data }) => {
            list.push(data);
            if (list.length === 3) {
              source.close();
              resolve(list);
            }
          };
          setTimeout(() => {
            source.close();
            resolve(list);
          }, 5000);
        })
    );
    expect(events.join() === 'event-0,event-1,event-2', events.join());
  });

  await check(
    'cookies stay in the host jar, invisible to scripts',
    async () => {
      const result = await app.evaluate(async () => {
        await fetch('/api/login');
        const who = await (await fetch('/api/whoami')).json();
        return { upstream: who.cookie, documentCookie: document.cookie };
      });
      expect(
        result.upstream === 'fixture_session=abc123',
        `upstream ${result.upstream}`
      );
      expect(
        !result.documentCookie.includes('fixture_session'),
        result.documentCookie
      );
      return `upstream Cookie: ${result.upstream}; document.cookie: "${result.documentCookie}"`;
    }
  );

  await check('redirects cannot leave the approved target', async () => {
    const result = await app.evaluate(async () => {
      const outcome = {};
      await Promise.all(
        ['same', 'absolute', 'other-port', 'external'].map(async (name) => {
          const response = await fetch(`/api/redirect/${name}`);
          outcome[name] = {
            status: response.status,
            path: new URL(response.url).pathname,
            error: response.headers.get('x-palmdesk-preview-error'),
          };
        })
      );
      return outcome;
    });
    expect(
      result.same.status === 200 && result.same.path === '/about',
      JSON.stringify(result.same)
    );
    expect(
      result.absolute.status === 200 && result.absolute.path === '/about',
      JSON.stringify(result.absolute)
    );
    expect(
      result['other-port'].error === 'redirect-blocked',
      JSON.stringify(result['other-port'])
    );
    expect(
      result.external.error === 'redirect-blocked',
      JSON.stringify(result.external)
    );
    expect(canaryHits.length === 0, `canary saw ${canaryHits.join(', ')}`);
    return 'relative and http://localhost:<port> redirects rewritten; other port and external blocked';
  });

  await check(
    'a navigation redirect to another site shows a blocked page',
    async () => {
      await app.evaluate(() =>
        setTimeout(() => location.assign('/api/redirect/external'))
      );
      const code = await until(
        () =>
          app.evaluate(
            () =>
              document.querySelector('#palmdesk-preview-error')?.dataset.code
          ),
        { label: 'error page' }
      );
      expect(code === 'redirect-blocked', code);
      await app.evaluate(() => setTimeout(() => location.assign('/')));
      await until(
        () =>
          app.evaluate(
            () => window.fixture?.ready && location.pathname === '/'
          ),
        {
          label: 'back home',
        }
      );
    }
  );

  await check(
    'absolute localhost URLs reach only approved ports and paths',
    async () => {
      const result = await app.evaluate(
        async ({ apiPort: port, canaryPort: other }) => {
          const read = async (url) => {
            try {
              const response = await fetch(url);
              return {
                status: response.status,
                error: response.headers.get('x-palmdesk-preview-error'),
                body: response.ok ? await response.json() : undefined,
              };
            } catch (error) {
              return { error: String(error) };
            }
          };
          return {
            ping: await read(`http://localhost:${port}/api/ping`),
            admin: await read(`http://localhost:${port}/admin`),
            canary: await read(`http://127.0.0.1:${other}/secret`),
          };
        },
        { apiPort, canaryPort }
      );
      expect(
        result.ping.status === 200 && result.ping.body.pong,
        JSON.stringify(result.ping)
      );
      expect(result.admin.error === 'not-routed', JSON.stringify(result.admin));
      expect(
        result.canary.error === 'not-routed',
        JSON.stringify(result.canary)
      );
      expect(!apiHits.some((hit) => !hit.startsWith('/api/')), apiHits.join());
      expect(canaryHits.length === 0, canaryHits.join());
      return `cross-port API ${result.ping.status} (IPv4-only server, upstream Host ${result.ping.body.host}); /admin and the canary refused`;
    }
  );

  await check(
    'the host rejects crafted frames that try to leave the list',
    async () => {
      const replies = await phone.evaluate(
        async ({ canary: other }) => {
          const { channel, dataChannels } = window.preview;
          const cases = [
            { id: 9001, target: 'web', path: `http://127.0.0.1:${other}/` },
            { id: 9002, target: 'web', path: `//127.0.0.1:${other}/` },
            { id: 9003, target: 'api', path: '/api/%2e%2e/admin' },
            { id: 9004, target: 'api', path: '/api/..%2fadmin' },
            { id: 9005, target: 'canary', path: '/' },
            {
              id: 9006,
              t: 'ws-open',
              target: 'canary',
              path: '/',
              protocols: [],
            },
            { id: 9007, target: 'api', path: '/api/../../admin' },
            {
              id: 9008,
              target: 'web',
              path: '/api/hello',
              headers: [
                ['host', `127.0.0.1:${other}`],
                ['x-forwarded-host', 'example.com'],
              ],
            },
          ];
          const seen = {};
          const listener = ({ data }) => {
            if (typeof data !== 'string') return;
            const message = JSON.parse(data);
            if (message.id > 9000 && message.id < 9100 && message.t !== 'end')
              seen[message.id] = message.code ?? message.status;
          };
          // Replies come back on whichever data channel the host picked.
          [channel, ...dataChannels].forEach((item) =>
            item.addEventListener('message', listener)
          );
          cases.forEach((item) =>
            channel.send(
              JSON.stringify({
                t: 'req',
                method: 'GET',
                headers: [],
                body: 0,
                ...item,
              })
            )
          );
          await new Promise((resolve) => setTimeout(resolve, 1500));
          [channel, ...dataChannels].forEach((item) =>
            item.removeEventListener('message', listener)
          );
          return seen;
        },
        { canary: canaryPort }
      );
      const expected = {
        9001: 'bad-path',
        9002: 'bad-path',
        9003: 'outside-prefix',
        9004: 'bad-path',
        9005: 'not-approved',
        9006: 'not-approved',
        9007: 'outside-prefix',
        9008: 200,
      };
      Object.entries(expected).forEach(([id, value]) =>
        expect(
          replies[id] === value,
          `${id}: ${replies[id]} instead of ${value}`
        )
      );
      expect(canaryHits.length === 0, canaryHits.join());
      expect(!apiHits.includes('/admin'), apiHits.join());
      return Object.entries(replies)
        .map(([id, value]) => `${id}=${value}`)
        .join(' ');
    }
  );

  await check(
    'HMR over the tunneled WebSocket updates without a reload',
    async () => {
      const sockets = (await gatewayStats()).socketProtocols;
      expect(sockets.includes('vite-hmr'), `sockets: ${sockets.join(' ')}`);
      const loadedAt = await app.evaluate(() => {
        const target = document.querySelector('#message');
        new MutationObserver(() => {
          window.fixture.messageChangedAt = Date.now();
        }).observe(target, {
          childList: true,
          characterData: true,
          subtree: true,
        });
        return window.fixture.loadedAt;
      });
      await direct.evaluate(() => {
        new MutationObserver(() => {
          window.fixture.messageChangedAt = Date.now();
        }).observe(document.querySelector('#message'), {
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
      const before = await gatewayStats();
      started = Date.now();
      await writeFile(
        path.join(appDir, 'src/message.js'),
        "export const message = 'Updated through HMR';\n"
      );
      await until(
        () =>
          app.evaluate(
            () =>
              document.querySelector('#message').textContent ===
              'Updated through HMR'
          ),
        { label: 'HMR update' }
      );
      const after = await app.evaluate(() => window.fixture);
      metrics.hmrModuleMs = after.messageChangedAt - started;
      metrics.hmrModuleDirectMs =
        (await until(
          () => direct.evaluate(() => window.fixture.messageChangedAt),
          {
            label: 'direct HMR',
          }
        )) - started;
      metrics.hmrTransfer = diff(await gatewayStats(), before);
      expect(
        after.loadedAt === loadedAt && after.hmrUpdates === 1,
        'the page reloaded'
      );
      started = Date.now();
      await writeFile(
        path.join(appDir, 'src/style.css'),
        'body { margin: 16px; color: rgb(200, 30, 30); font-family: system-ui, sans-serif; }\n'
      );
      await until(
        () =>
          app.evaluate(
            () => getComputedStyle(document.body).color === 'rgb(200, 30, 30)'
          ),
        { label: 'CSS update' }
      );
      metrics.hmrCssMs = Date.now() - started;
      expect(
        (await app.evaluate(() => window.fixture.loadedAt)) === loadedAt,
        'CSS update reloaded'
      );
      return `module update ${metrics.hmrModuleMs} ms (direct ${metrics.hmrModuleDirectMs} ms; ${metrics.hmrTransfer.requests} request, ${kib(metrics.hmrTransfer.wireBytes)}), CSS update ~${metrics.hmrCssMs} ms`;
    }
  );

  await check('preview content is isolated from PalmDesk', async () => {
    const ignoredBefore = await phone.evaluate(
      () => window.preview.bridge.snapshot().ignoredMessages
    );
    const result = await app.evaluate(async () => {
      const outcome = {};
      try {
        outcome.topStorage = window.top.localStorage.getItem('palmdesk-secret');
      } catch (error) {
        outcome.topStorage = error.name;
      }
      try {
        window.top.location.href = 'https://example.com/';
        outcome.topNavigation = 'no exception';
      } catch (error) {
        outcome.topNavigation = error.name;
      }
      window.top.postMessage(
        { msgType: 'remoteInput', data: { x: 1, y: 1 } },
        '*'
      );
      window.top.postMessage({ type: 'relay-hello', nonce: 'guess' }, '*');
      outcome.ownStorage = localStorage.getItem('palmdesk-secret');
      outcome.cookie = document.cookie;
      try {
        await navigator.serviceWorker.register('/evil-sw.js');
        outcome.serviceWorker = 'registered';
      } catch (error) {
        outcome.serviceWorker = error.name;
      }
      outcome.camera = document.featurePolicy?.allowsFeature('camera');
      outcome.clipboard =
        document.featurePolicy?.allowsFeature('clipboard-read');
      localStorage.setItem('app-state', 'kept until teardown');
      return outcome;
    });
    await delay(300);
    const page = await phone.evaluate(() => ({
      url: location.href,
      ignored: window.preview.bridge.snapshot().ignoredMessages,
      sandbox: document
        .querySelector('#preview iframe')
        .getAttribute('sandbox'),
    }));
    expect(
      result.topStorage === 'SecurityError',
      `top storage: ${result.topStorage}`
    );
    expect(result.ownStorage === null, 'PalmDesk storage visible');
    expect(!result.cookie.includes('palmdesk_cookie'), result.cookie);
    expect(result.serviceWorker === 'SecurityError', result.serviceWorker);
    expect(
      page.url === prototype.controllerUrl,
      `PalmDesk navigated to ${page.url}`
    );
    expect(
      page.ignored - ignoredBefore >= 2,
      'bridge accepted foreign messages'
    );
    expect(
      result.camera === false && result.clipboard === false,
      JSON.stringify(result)
    );
    return `top storage ${result.topStorage}, top navigation ${result.topNavigation}, app service worker ${result.serviceWorker}, foreign messages ignored`;
  });

  await check('throughput and head-of-line blocking (loopback)', async () => {
    let before = await gatewayStats();
    const binary = await app.evaluate(async () => {
      const start = performance.now();
      const buffer = await (
        await fetch('/api/binary?bytes=8388608')
      ).arrayBuffer();
      return {
        bytes: buffer.byteLength,
        ms: Math.round(performance.now() - start),
      };
    });
    const binaryWire = diff(await gatewayStats(), before).wireBytes;
    before = await gatewayStats();
    const text = await app.evaluate(async () => {
      const start = performance.now();
      const buffer = await (
        await fetch('/api/text?bytes=8388608')
      ).arrayBuffer();
      return {
        bytes: buffer.byteLength,
        ms: Math.round(performance.now() - start),
      };
    });
    const textWire = diff(await gatewayStats(), before).wireBytes;
    const busy = await app.evaluate(async () => {
      const time = async (url) => {
        const start = performance.now();
        const response = await fetch(url);
        const headersAt = performance.now() - start;
        await response.arrayBuffer();
        return {
          ms: Math.round(performance.now() - start),
          headersAt: Math.round(headersAt),
          timing: response.headers.get('x-palmdesk-preview-timing'),
        };
      };
      const idle = await time('/api/hello');
      const [big, small] = await Promise.all([
        time('/api/binary?bytes=8388608'),
        new Promise((resolve) => setTimeout(resolve, 100)).then(() =>
          time('/api/hello')
        ),
      ]);
      return {
        idle: idle.ms,
        big: big.ms,
        small: small.ms,
        smallDetail: small,
      };
    });
    // Split the small request's wait: the host page saw it arrive and saw
    // its head leave again; the rest was spent in the DataChannel legs and
    // the phone (bridge and worker).
    const stream = await phone.evaluate(
      () =>
        window.preview.bridge.log
          .filter(({ path }) => path === '/api/hello')
          .at(-1).id
    );
    const host = await hostPage.evaluate(
      (id) => window.hostDebug.timings.get(id),
      stream
    );
    metrics.smallRequestDuringDownload = {
      ...busy.smallDetail,
      atHostMs: host.out - host.in,
    };
    const directBinary = await direct.evaluate(async () => {
      const start = performance.now();
      await (await fetch('/api/binary?bytes=8388608')).arrayBuffer();
      return Math.round(performance.now() - start);
    });
    expect(binary.bytes === 8388608 && text.bytes === 8388608, 'short body');
    const rate = (bytes, ms) => ((bytes * 8) / (ms / 1000) / 1e6).toFixed(0);
    metrics.throughput = {
      binaryMbps: Number(rate(binary.bytes, binary.ms)),
      textMbps: Number(rate(text.bytes, text.ms)),
      directBinaryMbps: Number(rate(8388608, directBinary)),
      binaryWireRatio: Number((binaryWire / binary.bytes).toFixed(3)),
      textWireRatio: Number((textWire / text.bytes).toFixed(3)),
      smallRequestIdleMs: busy.idle,
      smallRequestDuringDownloadMs: busy.small,
    };
    return `8 MiB random ${metrics.throughput.binaryMbps} Mbit/s (direct ${metrics.throughput.directBinaryMbps}), 8 MiB text ${metrics.throughput.textMbps} Mbit/s at ${(metrics.throughput.textWireRatio * 100).toFixed(1)}% on the wire, small request ${busy.idle} ms idle / ${busy.small} ms during a download`;
  });

  await check(
    'host revocation closes HMR and refuses new requests',
    async () => {
      await call(
        'setTargets',
        targets.filter(({ id }) => id !== 'web')
      );
      await until(async () => (await bridgeState(phone)).state === 'revoked', {
        label: 'revoked state',
      });
      const { open } = await gatewayStats();
      const response = await app.evaluate(async () => {
        const result = await fetch('/api/hello');
        return {
          status: result.status,
          error: result.headers.get('x-palmdesk-preview-error'),
        };
      });
      expect(open === 0, `${open} upstream connections still open`);
      expect(
        response.status === 403 && response.error === 'revoked',
        JSON.stringify(response)
      );
      return 'HMR socket closed, requests answered 403 revoked';
    }
  );

  await check('approving the port again resumes the same preview', async () => {
    const loadedAt = await app.evaluate(() => window.fixture.loadedAt);
    await call('setTargets', targets);
    await until(async () => (await bridgeState(phone)).state === 'open', {
      label: 'open state',
    });
    // Vite's client keeps pinging while disconnected, then reloads the page.
    await until(
      () =>
        app.evaluate(
          (previous) =>
            window.fixture?.ready && window.fixture.loadedAt !== previous,
          loadedAt
        ),
      { timeout: 20_000, label: "Vite's reconnect reload" }
    );
    return "Vite's HMR client reconnected and reloaded the page";
  });

  await check(
    'a stopped development server shows an actionable error',
    async () => {
      await phone.evaluate(() => window.preview.bridge.open('down'));
      const frame = await appFrame(phone);
      const code = await until(
        () =>
          frame.evaluate(
            () =>
              document.querySelector('#palmdesk-preview-error')?.dataset.code
          ),
        { label: 'error page' }
      );
      const text = await frame.evaluate(
        () => document.querySelector('#palmdesk-preview-error').textContent
      );
      expect(code === 'upstream-unavailable', code);
      return text;
    }
  );

  await check(
    'a dropped connection aborts upstream work and clears the preview',
    async () => {
      await phone.evaluate(() => window.preview.bridge.open('web'));
      app = await appFrame(phone);
      await until(() => app.evaluate(() => window.fixture?.ready), {
        label: 'ready',
      });
      await app.evaluate(() => {
        localStorage.setItem('app-state', 'kept until teardown');
        fetch('/api/slow?ms=10000').catch(() => {});
      });
      await delay(300);
      started = Date.now();
      await phone.evaluate(() => window.preview.peer.close());
      await until(
        async () => (await bridgeState(phone)).state === 'disconnected',
        { label: 'disconnected' }
      );
      metrics.controllerTeardownMs = Date.now() - started;
      const aborted = await until(
        async () =>
          (await (await fetch(`${viteUrl}/__fixture/events`)).json()).find(
            ({ type, at }) => type === 'slow-aborted' && at >= started
          ),
        { label: 'the host aborting the upstream request' }
      );
      metrics.hostAbortAfterDropMs = aborted.at - started;
      const frames = await phone.evaluate(
        () => document.querySelectorAll('#preview iframe').length
      );
      const left = await phone.evaluate(() => window.preview.bridge.inspect());
      expect(frames === 0, `${frames} preview frames left`);
      expect(
        left.registrations === 0 &&
          left.localStorage === 0 &&
          left.caches === 0,
        JSON.stringify(left)
      );
      return `phone torn down in ${metrics.controllerTeardownMs} ms; host aborted the dev-server request after ${metrics.hostAbortAfterDropMs} ms; worker, storage and cache cleared`;
    }
  );

  await check(
    'the host ending the session tears the preview down',
    async () => {
      await phone.close();
      phone = await openController(phoneContext);
      await until(async () => (await bridgeState(phone)).state === 'ready', {
        label: 'ready',
      });
      await phone.evaluate(() => window.preview.bridge.open('web'));
      app = await appFrame(phone);
      await until(() => app.evaluate(() => window.fixture?.ready), {
        label: 'ready',
      });
      started = Date.now();
      await call('disconnectAll');
      await until(
        async () => (await bridgeState(phone)).state === 'disconnected',
        { label: 'disconnected' }
      );
      metrics.hostTeardownMs = Date.now() - started;
      const frames = await phone.evaluate(
        () => document.querySelectorAll('#preview iframe').length
      );
      expect(frames === 0, `${frames} preview frames left`);
      return `teardown ${metrics.hostTeardownMs} ms after the host closed the connection`;
    }
  );

  if (!secure)
    await check(
      'a controller served over LAN HTTP reports preview as unsupported',
      async () => {
        const lan = await openController(
          phoneContext,
          `http://palmdesk.test:${prototype.palmdeskPort}/controller.html`
        );
        await until(async () => (await bridgeState(lan)).state === 'ready', {
          label: 'ready',
        });
        await lan.evaluate(() => window.preview.bridge.open('web'));
        await until(
          async () => (await bridgeState(lan)).state === 'unsupported',
          { label: 'unsupported' }
        );
        const { reason } = await bridgeState(lan);
        expect(reason === 'insecure-context', reason);
        return 'the HTTPS-capable preview frame is not a secure context under an HTTP page';
      }
    );

  await check('no page errors', async () => {
    expect(errors.length === 0, errors.join('\n'));
  });
} finally {
  await browser.close();
  await shutdown();
}

const failed = checks.filter(({ ok }) => !ok);
const output = path.join(root, '.local/dev-preview/results.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  `${JSON.stringify({ date: new Date().toISOString(), metrics, checks }, null, 2)}\n`
);
console.log(
  `\n${checks.length - failed.length}/${checks.length} checks passed; results in ${path.relative(root, output)}`
);
console.log(JSON.stringify(metrics, null, 2));
if (failed.length) process.exitCode = 1;
