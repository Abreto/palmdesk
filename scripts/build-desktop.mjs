import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const target = { darwin: ['--mac'], win32: ['--win', '--x64'] }[
  process.platform
];
if (!target) {
  throw new Error('Desktop builds are supported on macOS and Windows hosts.');
}
const usage =
  'Usage: node scripts/build-desktop.mjs [--mac|--win] [--installer] [--release]';
let flags;
try {
  ({ values: flags } = parseArgs({
    options: {
      mac: { type: 'boolean' },
      win: { type: 'boolean' },
      installer: { type: 'boolean' },
      release: { type: 'boolean' },
    },
  }));
} catch (error) {
  throw new Error(usage, { cause: error });
}
if (flags.mac && flags.win) throw new Error(usage);
const requested = flags.mac ? '--mac' : '--win';
if ((flags.mac || flags.win) && requested !== target[0]) {
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
const options = {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    VITE_APP_RELEASE_PROJECT_ISWEB: 'false',
    PALMDESK_BUILD_CHANNEL: flags.release ? 'release' : 'local',
  },
};

execFileSync(process.execPath, [vite, 'build'], options);
execFileSync(
  process.execPath,
  [
    builder,
    ...target,
    ...(flags.installer ? [] : ['--dir']),
    '--publish',
    'never',
  ],
  options
);
