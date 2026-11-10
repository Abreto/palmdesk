// Runs the browser smoke tests that need neither a real backend nor native
// capture, starting the Vite fixture servers some of them use. Build the web
// client first with pnpm build:prod.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const suites = [
  // These serve dist/ from their own HTTP and Socket.IO servers.
  {
    scripts: [
      'credential-visibility.mjs',
      'mobile-resume.mjs',
      'controller-auth-browser.mjs',
    ],
  },
  {
    config: 'test/smoke/image-paste.vite.mjs',
    page: 'http://127.0.0.1:5196/test/smoke/image-paste.html',
    scripts: ['image-paste-browser.mjs', 'viewport-gestures-browser.mjs'],
  },
  {
    config: 'test/smoke/agent-launch.vite.mjs',
    page: 'http://127.0.0.1:5197/test/smoke/agent-launch.html',
    scripts: ['agent-launch-browser.mjs'],
  },
];

function browserExecutable() {
  const candidates = [
    process.env.SMOKE_BROWSER_EXECUTABLE,
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = candidates.find((file) => file && existsSync(file));
  if (!found)
    throw new Error(
      'No browser found. Run pnpm exec playwright install chromium, or set SMOKE_BROWSER_EXECUTABLE.'
    );
  return found;
}

function run(script, env) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(root, 'test/smoke', script)],
      { cwd: root, env, stdio: 'inherit' }
    );
    child.on('exit', (code) => resolve(code === 0));
  });
}

async function serve(config, page) {
  const vite = path.join(
    path.dirname(require.resolve('vite/package.json')),
    'bin/vite.js'
  );
  const server = spawn(process.execPath, [vite, '--config', config], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (server.exitCode !== null)
      throw new Error(`The Vite server for ${config} exited.`);
    try {
      // Loading the fixture page also prepares its modules.
      if ((await fetch(page)).ok) return server;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      server.kill();
      throw new Error(`The Vite server for ${config} did not start.`);
    }
    await delay(250);
  }
}

function stop(server) {
  if (server.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    server.once('exit', resolve);
    server.kill();
  });
}

if (!existsSync(path.join(root, 'dist/index.html')))
  throw new Error('Build the web client first: pnpm build:prod');
const env = { ...process.env, SMOKE_BROWSER_EXECUTABLE: browserExecutable() };
const failed = [];
for (const suite of suites) {
  const server = suite.config && (await serve(suite.config, suite.page));
  try {
    for (const script of suite.scripts) {
      console.log(`\n# ${script}`);
      if (!(await run(script, env))) failed.push(script);
    }
  } finally {
    if (server) await stop(server);
  }
}
if (failed.length) {
  console.error(`\nFailed: ${failed.join(', ')}`);
  process.exitCode = 1;
} else console.log('\nAll browser smoke tests passed.');
