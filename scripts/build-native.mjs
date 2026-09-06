import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform === 'darwin') {
  const source = path.join(root, 'electron-main/native/codex-window.swift');
  const output = path.join(root, 'native-bin/codex-window');
  const existing = await stat(output).catch(() => null);
  if (!existing || existing.mtimeMs < (await stat(source)).mtimeMs) {
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(path.join(root, '.local/swift-cache'), { recursive: true });
    execFileSync(
      'xcrun',
      [
        'swiftc',
        '-O',
        '-module-cache-path',
        path.join(root, '.local/swift-cache'),
        source,
        '-o',
        output,
      ],
      { stdio: 'inherit' }
    );
  }
}
