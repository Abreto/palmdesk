import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const root = process.cwd();
const packaged = process.env.SMOKE_PACKAGED === 'true';
const artifactName = packaged ? 'packaged-shell' : 'desktop-shell';
const artifacts = path.join(root, 'docs/smoke-artifacts');
await mkdir(artifacts, { recursive: true });
const application = await _electron.launch({
  executablePath:
    process.env.SMOKE_ELECTRON_EXECUTABLE ||
    path.join(root, '.local/electron-dev/Electron.app/Contents/MacOS/Electron'),
  args: packaged ? [] : ['.'],
  cwd: root,
  env: {
    ...process.env,
    ...(packaged
      ? {}
      : {
          VITE_DEV_SERVER_URL:
            process.env.SMOKE_CLIENT_URL || 'http://localhost:5173',
        }),
  },
});
try {
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.page-heading h1').waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('.connection-state')
      ?.textContent.includes('服务已连接')
  );
  const identity = await application.evaluate(({ app }) => ({
    name: app.getName(),
    electron: process.versions.electron,
    executable: process.execPath,
  }));
  assert.equal(identity.name, 'Codex Remote');
  const permissions = await page.evaluate(() =>
    window.electronAPI.ipcRenderer.invoke('capturePermissions', { data: {} })
  );
  assert.equal(permissions.code, 0);
  const deniedInput = await page.evaluate(() =>
    window.electronAPI.ipcRenderer.invoke('remoteInput', {
      data: {
        sessionId: 'invalid-smoke-session',
        input: { action: 'text', text: 'must not be typed' },
      },
    })
  );
  assert.notEqual(deniedInput.code, 0);
  // Exercise the real IPC sender check from a separate renderer; never select or focus Codex.
  const rejected = await application.evaluate(
    async ({ BrowserWindow }, preload) => {
      const other = new BrowserWindow({
        show: false,
        webPreferences: { preload },
      });
      try {
        await other.loadURL('data:text/html,<title>IPC isolation test</title>');
        return await other.webContents.executeJavaScript(
          `window.electronAPI.ipcRenderer.invoke('capturePermissions', {data: {}})`
        );
      } finally {
        other.destroy();
      }
    },
    path.join(root, 'electron-dist/preload.mjs')
  );
  assert.notEqual(rejected.code, 0);
  assert.deepEqual(errors, []);
  const password = page.locator('.local-device .info-right .code');
  if (!(await password.innerText()).includes('*'))
    await page.locator('.local-device .ico.eye').click();
  await page.screenshot({ path: path.join(artifacts, `${artifactName}.png`) });
  const result = {
    scope:
      'Real Codex Remote Electron shell and guarded IPC; no target capture, focus, input, or permission changes',
    identity,
    permissions: permissions.data,
    checks: [
      'cold startup',
      'backend connection',
      'invalid input session denied',
      'secondary renderer IPC denied',
      'no uncaught renderer errors',
    ],
  };
  await writeFile(
    path.join(artifacts, `${artifactName}.json`),
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await application.close();
}
