// Loads a development server that is already running on this machine through
// the preview prototype and directly, then reports requests, bytes and the
// time until the page stops requesting modules. Local servers only:
//
//   lockf -k "$(git rev-parse --git-common-dir)/browser-smoke.lock" \
//     node test/dev-preview/measure.mjs <port> [path]
//
// Requests whose path matches --ignore (default: /api/ and /socket.io/, which
// keep retrying without a backend) do not count towards settling.
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [portArgument, startPath = '/'] = process.argv
  .slice(2)
  .filter(
    (item, index, list) =>
      !item.startsWith('--') && list[index - 1] !== '--ignore'
  );
const port = Number(portArgument);
if (!Number.isInteger(port)) {
  console.error('Usage: node test/dev-preview/measure.mjs <port> [path]');
  process.exit(2);
}
const ignoreIndex = process.argv.indexOf('--ignore');
const ignore = new RegExp(
  ignoreIndex > 0 ? process.argv[ignoreIndex + 1] : '^/(api|socket\\.io)/'
);
const QUIET_MS = 2000;

const worker = new Worker(new URL('./prototype-worker.mjs', import.meta.url), {
  workerData: { targets: [{ id: 'app', label: 'App', port }], verified: true },
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

// Waits until no counted request has started for QUIET_MS; returns the time
// of the last one.
async function settled(lastRequestAt) {
  for (;;) {
    const last = await lastRequestAt();
    if (last && Date.now() - last > QUIET_MS) return last;
    await delay(100);
  }
}

const browser = await chromium.launch({
  executablePath: process.env.SMOKE_BROWSER_EXECUTABLE || undefined,
  headless: true,
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});
const results = {};
try {
  const host = await (await browser.newContext()).newPage();
  await host.goto(prototype.hostUrl);
  const options = {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  };
  const phone = await (await browser.newContext(options)).newPage();
  await phone.goto(prototype.controllerUrl);
  await phone.waitForFunction(() => window.preview?.bridge.state === 'ready');
  // Undefined while any counted request is still waiting for its answer.
  const previewLast = () =>
    phone.evaluate((pattern) => {
      const { bridge } = window.preview;
      if (bridge.snapshot().inFlight) return undefined;
      return bridge.log
        .filter(({ path }) => !new RegExp(pattern).test(path))
        .at(-1)?.at;
    }, ignore.source);

  for (const phase of ['cold', 'reload']) {
    const before = await call('stats');
    const logged = await phone.evaluate(() => window.preview.bridge.log.length);
    const started = Date.now();
    if (phase === 'cold')
      await phone.evaluate(
        (path) => window.preview.bridge.open('app', path),
        startPath
      );
    else
      await phone.evaluate(() =>
        window.preview.bridge.command({ type: 'reload' })
      );
    await delay(500);
    const last = await settled(previewLast);
    const after = await call('stats');
    const paths = await phone.evaluate(
      (from) => window.preview.bridge.log.slice(from).map(({ path }) => path),
      logged
    );
    results[`preview ${phase}`] = {
      ms: last - started,
      requests: after.requests - before.requests,
      counted: paths.filter((path) => !ignore.test(path)).length,
      fromServer: after.upstreamBytes - before.upstreamBytes,
      overChannel: after.sentFrameBytes - before.sentFrameBytes,
    };
  }

  const direct = await (await browser.newContext(options)).newPage();
  let lastDirect = 0;
  let directRequests = 0;
  direct.on('request', (request) => {
    if (ignore.test(new URL(request.url()).pathname)) return;
    directRequests += 1;
    lastDirect = Date.now();
  });
  for (const phase of ['cold', 'reload']) {
    directRequests = 0;
    const started = Date.now();
    if (phase === 'cold')
      await direct.goto(`http://localhost:${port}${startPath}`);
    else await direct.reload();
    const last = await settled(() => lastDirect);
    results[`direct ${phase}`] = {
      ms: last - started,
      requests: directRequests,
      counted: directRequests,
    };
  }
} finally {
  await browser.close();
  await call('close');
  await worker.terminate();
}

const mib = (bytes) =>
  bytes === undefined ? '' : `${(bytes / 1048576).toFixed(2)} MiB`;
console.table(
  Object.fromEntries(
    Object.entries(results).map(([name, row]) => [
      name,
      {
        'until settled': `${row.ms} ms`,
        requests: row.requests,
        'counted requests': row.counted,
        'body bytes': mib(row.fromServer),
        'DataChannel bytes': mib(row.overChannel),
      },
    ])
  )
);
console.log(JSON.stringify(results));
