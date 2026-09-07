import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = { darwin: ['--mac'], win32: ['--win', '--x64'] }[
  process.platform
];
if (!target) {
  throw new Error('Desktop builds are supported on macOS and Windows hosts.');
}
const requested = process.argv.slice(2);
if (
  requested.length > 1 ||
  (requested.length === 1 && !['--mac', '--win'].includes(requested[0]))
) {
  throw new Error('Usage: node scripts/build-desktop.mjs [--mac|--win]');
}
if (requested.length && requested[0] !== target[0]) {
  throw new Error(
    'Build the requested desktop app on its matching macOS or Windows host.'
  );
}

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const vite = path.join(
  path.dirname(require.resolve('vite/package.json')),
  'bin/vite.js'
);
const builder = path.join(
  path.dirname(require.resolve('electron-builder/package.json')),
  'cli.js'
);
const options = { cwd: root, stdio: 'inherit', windowsHide: true };

execFileSync(process.execPath, [vite, 'build'], options);
execFileSync(
  process.execPath,
  [builder, ...target, '--dir', '--publish', 'never'],
  options
);
