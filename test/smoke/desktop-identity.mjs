import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const load = require('./load-source.cjs');
const { assertUniqueApplicationIdentity } = load(
  'electron-main/app-identity.ts'
);
const { getDesktopIdentity } = require('../../scripts/desktop-identity.cjs');
const config = require('../../electron-builder.cjs');
const pkg = require('../../package.json');
const root = process.cwd();
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

async function runtimeIdentity(application, helper) {
  return application.evaluate((_electron, executable) => {
    const { execFileSync } = process.getBuiltinModule('node:child_process');
    const response = JSON.parse(
      execFileSync(executable, [], {
        encoding: 'utf8',
        input: JSON.stringify({ requestId: 1, command: 'appIdentity' }) + '\n',
        timeout: 10000,
      })
    );
    if (response.error) throw new Error(response.error);
    return response.data;
  }, helper);
}

async function verifyDuplicateDetection(
  application,
  bundle,
  identity,
  helper,
  executable
) {
  const temporary = await mkdtemp(
    path.join(root, '.local/identity-duplicate-')
  );
  const duplicate = path.join(temporary, 'Duplicate.app');
  const renamed = `${duplicate}.disabled`;
  try {
    await mkdir(path.join(duplicate, 'Contents/MacOS'), { recursive: true });
    await copyFile(
      '/usr/bin/true',
      path.join(duplicate, 'Contents/MacOS/probe')
    );
    const info = path.join(duplicate, 'Contents/Info.plist');
    await writeFile(
      info,
      JSON.stringify({
        CFBundleIdentifier: identity.appId,
        CFBundleName: 'PalmDesk Duplicate Test',
        CFBundleExecutable: 'probe',
        CFBundlePackageType: 'APPL',
        CFBundleVersion: '1',
      })
    );
    execFileSync('/usr/bin/plutil', ['-convert', 'xml1', info]);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', duplicate]);
    const registration = execFileSync(lsregister, ['-f', '-v', duplicate], {
      encoding: 'utf8',
    });
    const actual = await runtimeIdentity(application, helper);
    assert.ok(
      actual.registeredPaths.includes(realpathSync(duplicate)),
      JSON.stringify({ actual, registration })
    );
    assert.throws(
      () => assertUniqueApplicationIdentity(actual, executable, false),
      /注册了多个应用副本/
    );
    await rename(duplicate, renamed);
    const afterRename = await runtimeIdentity(application, helper);
    assert.ok(
      afterRename.registeredPaths.includes(realpathSync(renamed)),
      JSON.stringify(afterRename)
    );
    assert.throws(
      () => assertUniqueApplicationIdentity(afterRename, executable, false),
      /注册了多个应用副本/
    );
    console.log(
      'PASS native duplicate detection: registered and renamed .app.disabled bundles are rejected'
    );
  } finally {
    try {
      // lsregister can resolve a moved record yet refuse to scan its non-.app suffix.
      if (existsSync(renamed)) await rename(renamed, duplicate);
      execFileSync(lsregister, ['-f', duplicate]);
      execFileSync(lsregister, ['-u', duplicate]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
      execFileSync(lsregister, ['-f', bundle]);
    }
  }
}

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
    const helper = development
      ? path.join(root, 'native-bin/codex-window')
      : path.join(bundle, 'Contents/MacOS/codex-window');
    const executable = path.join(
      bundle,
      'Contents/MacOS',
      info.CFBundleExecutable
    );
    const nativeIdentity = await runtimeIdentity(application, helper);
    assert.equal(nativeIdentity.bundleId, identity.appId);
    assert.equal(nativeIdentity.bundlePath, realpathSync(bundle));
    assertUniqueApplicationIdentity(nativeIdentity, executable, !development);
    if (development) {
      await verifyDuplicateDetection(
        application,
        bundle,
        identity,
        helper,
        executable
      );
      assertUniqueApplicationIdentity(
        await runtimeIdentity(application, helper),
        executable,
        false
      );
    }
    console.log(
      `PASS ${identity.appId}: bundle, helpers, signature, runtime name and data isolation`
    );
  } finally {
    await application.close();
  }
}
