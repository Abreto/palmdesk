import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const { getDesktopIdentity } = require('../../scripts/desktop-identity.cjs');
const config = require('../../electron-builder.cjs');
const pkg = require('../../package.json');
const root = process.cwd();

function plist(appPath) {
  return JSON.parse(
    execFileSync(
      '/usr/bin/plutil',
      [
        '-convert',
        'json',
        '-o',
        '-',
        path.join(appPath, 'Contents/Info.plist'),
      ],
      { encoding: 'utf8' }
    )
  );
}

for (const development of [true, false]) {
  const identity = getDesktopIdentity(root, { development });
  assert.ok(
    identity.worktreeId,
    'run this identity-isolation smoke test in a linked worktree'
  );
  const bundle = development
    ? path.join(root, '.local/electron-dev/Electron.app')
    : path.join(
        root,
        config.directories.output.replace('${version}', pkg.version),
        `mac-${process.arch}`,
        `${identity.productName}.app`
      );
  const info = plist(bundle);
  assert.equal(info.CFBundleIdentifier, identity.appId);
  assert.equal(info.CFBundleDisplayName, identity.productName);
  const frameworks = path.join(bundle, 'Contents/Frameworks');
  for (const entry of await readdir(frameworks)) {
    if (entry.endsWith('.app'))
      assert.ok(
        plist(path.join(frameworks, entry)).CFBundleIdentifier.startsWith(
          `${identity.appId}.`
        )
      );
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', bundle]);
  const application = await _electron.launch({
    executablePath: path.join(
      bundle,
      'Contents/MacOS',
      info.CFBundleExecutable
    ),
    args: development ? ['.'] : [],
    cwd: root,
    env: {
      ...process.env,
      PALMDESK_APP_NAME: identity.productName,
      // Load an inert page so identity verification never requests capture or input permission.
      VITE_DEV_SERVER_URL:
        'data:text/html,<title>Desktop identity verification</title>',
    },
  });
  try {
    await application.firstWindow();
    const actual = await application.evaluate(({ app }) => ({
      name: app.getName(),
      packaged: app.isPackaged,
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
      appData: app.getPath('appData'),
    }));
    assert.equal(actual.name, identity.productName);
    assert.equal(actual.packaged, !development);
    assert.equal(
      actual.userData,
      path.join(actual.appData, identity.productName)
    );
    assert.equal(actual.sessionData, actual.userData);
    console.log(
      `PASS ${identity.appId}: bundle, helpers, signature, runtime name and data isolation`
    );
  } finally {
    await application.close();
  }
}
