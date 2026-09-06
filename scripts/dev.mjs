import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import './build-native.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
if (process.platform === 'darwin') {
  const electron = require('electron');
  const original = path.resolve(electron, '../../..');
  const runtime = path.join(root, '.local/electron-dev');
  const target = path.join(runtime, 'Electron.app');
  const stamp = path.join(runtime, 'version');
  const version = `${require('electron/package.json').version}:codex-remote-dev-2`;
  if ((await readFile(stamp, 'utf8').catch(() => '')) !== version) {
    await mkdir(runtime, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await cp(original, target, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
    const plist = path.join(target, 'Contents/Info.plist');
    for (const [key, value] of Object.entries({
      CFBundleIdentifier: 'com.codexremote.desktop.dev',
      CFBundleName: 'Codex Remote Dev',
      CFBundleDisplayName: 'Codex Remote Dev',
      NSAppleEventsUsageDescription:
        'Focus the selected application window for remote input.',
      NSScreenCaptureUsageDescription:
        'Share the selected application window with your phone.',
    })) {
      try {
        execFileSync(
          '/usr/libexec/PlistBuddy',
          ['-c', `Set :${key} ${value}`, plist],
          { stdio: 'pipe' }
        );
      } catch {
        execFileSync('/usr/libexec/PlistBuddy', [
          '-c',
          `Add :${key} string ${value}`,
          plist,
        ]);
      }
    }
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', target], {
      stdio: 'inherit',
    });
    await writeFile(stamp, version);
  }
  env.ELECTRON_OVERRIDE_DIST_PATH = runtime;
  console.log(`Desktop identity: com.codexremote.desktop.dev (${target})`);
}
const vite = path.join(
  path.dirname(require.resolve('vite/package.json')),
  'bin/vite.js'
);
const child = spawn(
  process.execPath,
  [vite, '--host', '127.0.0.1', ...process.argv.slice(2)],
  { cwd: root, env, stdio: 'inherit' }
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code || 0;
});
