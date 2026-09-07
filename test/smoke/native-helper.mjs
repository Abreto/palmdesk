import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const load = require('./load-source.cjs');
const config = require('../../electron-builder.cjs');
const pkg = require('../../package.json');
assert.equal(process.platform, 'darwin', 'run this smoke test on macOS');
const bundle = path.resolve(
  config.directories.output.replace('${version}', pkg.version),
  `mac-${process.arch}`,
  `${config.productName}.app`
);
const executable = path.resolve(
  process.argv[2] || path.join(bundle, 'Contents/MacOS/codex-window')
);
let child;
const { NativeWindowBridge } = load('electron-main/native-window.ts', {
  'node:child_process': {
    spawn: (...args) => {
      child = spawn(...args);
      return child;
    },
  },
});
const bridge = new NativeWindowBridge(executable);
const application = await _electron.launch({
  executablePath: path.join(bundle, 'Contents/MacOS', config.productName),
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL:
      'data:text/html,<title>PalmDesk helper smoke test</title>',
  },
});

async function verifyBackground() {
  const diagnostics = await bridge.request('diagnostics');
  assert.equal(
    diagnostics.applications.some(
      (application) => application.pid === child.pid
    ),
    false,
    'the native helper must not register as a Dock application'
  );
  assert.deepEqual(
    diagnostics.applications
      .filter((entry) => entry.bundleId === config.appId)
      .map((entry) => entry.pid),
    [application.process().pid],
    'only the main PalmDesk process must appear in the Dock'
  );
}

try {
  await application.firstWindow();
  let previousPid;
  for (const shutdown of ['close', 'eof']) {
    const permissions = await bridge.request('permissions');
    assert.equal(typeof permissions.accessibility, 'boolean');
    assert.equal(typeof permissions.screen, 'boolean');
    assert.equal(
      permissions.screen,
      true,
      'screen recording must already be authorized'
    );
    assert.notEqual(child.pid, previousPid, 'a closed helper can restart');
    previousPid = child.pid;
    await verifyBackground();
    const windows = await bridge.request('list');
    const fixture = windows.find(
      (window) => window.ownerPid === application.process().pid
    );
    assert.ok(fixture, 'the test application window must be available');
    // A real thumbnail initializes AppKit lazily and reproduced the duplicate Dock icon.
    const thumbnails = await bridge.request('thumbnails', {
      windows: [fixture],
    });
    assert.equal(thumbnails.length, 1);
    assert.ok(thumbnails[0].thumbnail.startsWith('data:image/jpeg;base64,'));
    await verifyBackground();
    assert.deepEqual(await bridge.request('thumbnails', { windows: [] }), []);
    await assert.rejects(bridge.request('invalid-smoke-command'), {
      code: 'invalid',
    });
    await delay(500);
    await verifyBackground();
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) });
    if (shutdown === 'close') bridge.close();
    else child.stdin.end();
    const [code, signal] = await exited;
    assert.deepEqual(
      [code, signal],
      shutdown === 'close' ? [null, 'SIGTERM'] : [0, null]
    );
    console.log(
      `PASS background helper: requests, idle, ${shutdown}, PID ${child.pid}`
    );
  }
} finally {
  const exited =
    child && child.exitCode === null && child.signalCode === null
      ? once(child, 'exit', { signal: AbortSignal.timeout(5000) })
      : Promise.resolve();
  bridge.close();
  try {
    await exited;
  } finally {
    await application.close();
  }
}
