import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('./', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = process.argv[2];
if (!destination || process.argv.length !== 3) throw new Error('Usage: node containers/prepare.mjs <new-build-directory>');
const context = path.resolve(destination);
const backend = JSON.parse(readFileSync(new URL('backend.lock.json', import.meta.url), 'utf8'));
if (!/^[0-9a-f]{40}$/.test(backend.commit) || new URL(backend.repository).protocol !== 'https:') {
  throw new Error('Invalid backend source pin');
}

mkdirSync(context);
for (const name of ['.dockerignore', 'web', 'nginx', 'backend']) {
  cpSync(path.join(assets, name), path.join(context, name), { recursive: true });
}
const frontendDirectory = path.join(context, '.sources', 'frontend');
const backendDirectory = path.join(context, '.sources', 'backend');
mkdirSync(frontendDirectory, { recursive: true });
mkdirSync(backendDirectory);

// Archive only committed frontend files, excluding local credentials and dependencies.
const frontend = execFileSync('git', ['archive', '--format=tar', 'HEAD'], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
execFileSync('tar', ['-xf', '-', '-C', frontendDirectory], { input: frontend });
for (const args of [
  ['init', '--quiet'],
  ['remote', 'add', 'origin', backend.repository],
  ['fetch', '--depth=1', 'origin', backend.commit],
  ['checkout', '--detach', '--quiet', backend.commit],
]) execFileSync('git', args, { cwd: backendDirectory, stdio: 'inherit' });
console.log(`Image build context ready: ${context}`);
