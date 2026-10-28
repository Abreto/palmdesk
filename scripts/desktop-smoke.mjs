// Launches the unpacked app from pnpm build:desktop with --smoke-exit. It
// loads the main window with a throwaway profile, cancels every network
// request and refuses capture and input, then quits with code 0.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const config = require('../electron-builder.cjs');
const { version } = require('../package.json');

const output = path.join(
  root,
  config.directories.output.replace('${version}', version)
);
const name = config.productName;
const executable = {
  darwin: path.join(
    output,
    process.arch === 'arm64' ? 'mac-arm64' : 'mac',
    `${name}.app/Contents/MacOS/${name}`
  ),
  win32: path.join(output, 'win-unpacked', `${name}.exe`),
}[process.platform];
if (!executable)
  throw new Error('Desktop builds are supported on macOS and Windows hosts.');

// Only the bundled app may load, and Electron must start as itself.
const env = { ...process.env };
['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'VITE_DEV_SERVER_URL'].forEach(
  (key) => delete env[key]
);

const TIMEOUT_MS = 120_000;
let log = '';
const child = spawn(executable, ['--smoke-exit'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => {
  log += chunk;
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => {
  log += chunk;
  process.stderr.write(chunk);
});
const timer = setTimeout(() => {
  console.error(`No result after ${TIMEOUT_MS} ms; stopping the app.`);
  child.kill();
}, TIMEOUT_MS);
const [code, signal] = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (...result) => resolve(result));
});
clearTimeout(timer);

// The app reports its throwaway profile; remove it once the app has exited.
const profile = /^\[PalmDesk smoke\] profile: (.+)$/m.exec(log)?.[1]?.trim();
if (
  profile &&
  path.dirname(profile) === path.resolve(tmpdir()) &&
  path.basename(profile).startsWith('palmdesk-smoke-')
) {
  try {
    rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 500,
    });
  } catch (error) {
    console.warn(`Could not remove the smoke profile: ${error.message}`);
  }
}

if (code !== 0 || !log.includes('[PalmDesk smoke] passed')) {
  console.error(
    `Desktop smoke run failed (exit code ${code}${signal ? `, ${signal}` : ''}).`
  );
  process.exitCode = 1;
} else console.log('Desktop smoke run passed.');
