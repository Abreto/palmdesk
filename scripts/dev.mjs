import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import './build-native.mjs';
import { getDesktopIdentity } from './desktop-identity.cjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
const identity = getDesktopIdentity(root, { development: true });
env.PALMDESK_APP_NAME = identity.productName;
if (process.platform === 'darwin') {
  const electron = require('electron');
  const original = path.resolve(electron, '../../..');
  const runtime = path.join(root, '.local/electron-dev');
  const target = path.join(runtime, 'Electron.app');
  const stamp = path.join(runtime, 'version');
  if (process.env.CSC_LINK && !process.env.CSC_NAME)
    throw new Error(
      'Development signing requires CSC_NAME for a certificate already installed in Keychain.'
    );
  const signer = process.env.CSC_NAME?.trim() || '-';
  const version = JSON.stringify({
    electron: require('electron/package.json').version,
    revision: 3,
    appId: identity.appId,
    productName: identity.productName,
    signer,
  });
  if ((await readFile(stamp, 'utf8').catch(() => '')) !== version) {
    await mkdir(runtime, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await cp(original, target, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
    const plist = path.join(target, 'Contents/Info.plist');
    const originalId = execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleIdentifier', plist],
      { encoding: 'utf8' }
    ).trim();
    function updatePlist(file, values) {
      Object.entries(values).forEach(([key, value]) => {
        try {
          execFileSync(
            '/usr/libexec/PlistBuddy',
            ['-c', `Set :${key} ${value}`, file],
            {
              stdio: 'pipe',
            }
          );
        } catch {
          execFileSync('/usr/libexec/PlistBuddy', [
            '-c',
            `Add :${key} string ${value}`,
            file,
          ]);
        }
      });
    }
    updatePlist(plist, {
      CFBundleIdentifier: identity.appId,
      CFBundleName: identity.productName,
      CFBundleDisplayName: identity.productName,
      NSAppleEventsUsageDescription:
        'Focus the selected application window for remote input.',
      NSScreenCaptureUsageDescription:
        'Share the selected application window with your phone.',
    });
    const frameworks = path.join(target, 'Contents/Frameworks');
    const helpers = await readdir(frameworks, { withFileTypes: true });
    helpers.forEach((entry) => {
      if (!entry.isDirectory() || !entry.name.endsWith('.app')) return;
      const helperPlist = path.join(
        frameworks,
        entry.name,
        'Contents/Info.plist'
      );
      const helperId = execFileSync(
        '/usr/libexec/PlistBuddy',
        ['-c', 'Print :CFBundleIdentifier', helperPlist],
        { encoding: 'utf8' }
      ).trim();
      if (!helperId.startsWith(`${originalId}.`))
        throw new Error(
          `Cannot isolate Electron helper identity: ${entry.name}`
        );
      const helperName = `${identity.productName} ${entry.name.replace(/^Electron /, '').replace(/\.app$/, '')}`;
      updatePlist(helperPlist, {
        CFBundleIdentifier: `${identity.appId}${helperId.slice(originalId.length)}`,
        CFBundleName: helperName,
        CFBundleDisplayName: helperName,
      });
    });
    execFileSync('codesign', ['--force', '--deep', '--sign', signer, target], {
      stdio: 'inherit',
    });
    execFileSync('codesign', ['--verify', '--deep', '--strict', target], {
      stdio: 'inherit',
    });
    await writeFile(stamp, version);
  }
  env.ELECTRON_OVERRIDE_DIST_PATH = runtime;
  console.log(`Desktop identity: ${identity.appId} (${target})`);
}
if (process.argv.includes('--prepare-only')) process.exit(0);
const vite = path.join(
  path.dirname(require.resolve('vite/package.json')),
  'bin/vite.js'
);
const child = spawn(
  process.execPath,
  [vite, ...process.argv.slice(2)],
  { cwd: root, env, stdio: 'inherit' }
);
['SIGINT', 'SIGTERM'].forEach((signal) =>
  process.on(signal, () => child.kill(signal))
);
child.on('exit', (code) => {
  process.exitCode = code || 0;
});
