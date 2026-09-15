// Opt-in real signing check: node --test test/smoke/macos-signing-upgrade.cjs
// Requires the fixed certificate and an unlocked CSC_KEYCHAIN (CI prepares both).
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sign = require('../../scripts/sign-macos.cjs');
const certificate = require('../../build/macos-signing.json');

test('different app and native helper builds satisfy the previous signed identity', async (t) => {
  assert.equal(process.platform, 'darwin');
  assert.ok(process.env.CSC_KEYCHAIN, 'Prepare the signing keychain first.');
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'palmdesk-signing-upgrade-')
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const id = 'io.github.abreto.palmdesk.signing-test';
  const entitlements = path.join(directory, 'entitlements.plist');
  writeFileSync(
    entitlements,
    '<?xml version="1.0"?><plist version="1.0"><dict/></plist>'
  );
  const source = path.join(directory, 'probe.c');
  writeFileSync(source, 'int main(void) { return REVISION; }\n');
  const builds = [];
  for (const revision of [1, 2]) {
    const app = path.join(directory, String(revision), 'Signing Probe.app');
    const macOS = path.join(app, 'Contents/MacOS');
    mkdirSync(macOS, { recursive: true });
    writeFileSync(
      path.join(app, 'Contents/Info.plist'),
      `<?xml version="1.0"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleExecutable</key><string>probe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${revision}</string>
</dict></plist>`
    );
    for (const binary of ['probe', 'codex-window'])
      execFileSync(
        'xcrun',
        [
          'clang',
          `-DREVISION=${revision}`,
          source,
          '-o',
          path.join(macOS, binary),
        ],
        { stdio: 'pipe' }
      );
    await sign(
      {
        app,
        platform: 'darwin',
        identity: certificate.sha1,
        keychain: process.env.CSC_KEYCHAIN,
        optionsForFile: () => ({ entitlements }),
      },
      { appInfo: { id }, platformSpecificBuildOptions: {} }
    );
    builds.push([app, path.join(macOS, 'codex-window')]);
  }
  function signature(target) {
    const result = spawnSync(
      'codesign',
      ['--display', '--verbose=4', '-r-', target],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0);
    const output = result.stdout + result.stderr;
    const requirement = output.match(/designated => (.+)/)?.[1];
    const hash = output.match(/^CDHash=(.+)$/m)?.[1];
    assert.ok(requirement && hash, 'Expected a signed code identity and hash.');
    assert.doesNotMatch(requirement, /\bcdhash\b/);
    return { requirement, hash };
  }
  for (let component = 0; component < 2; component++) {
    const before = signature(builds[0][component]);
    const after = signature(builds[1][component]);
    assert.notEqual(
      before.hash,
      after.hash,
      'The test must change the signed code.'
    );
    assert.equal(
      before.requirement,
      after.requirement,
      'Updates must preserve the designated requirement.'
    );
    execFileSync(
      'codesign',
      [
        '--verify',
        '--strict',
        '-R',
        `=${before.requirement}`,
        builds[1][component],
      ],
      { stdio: 'pipe' }
    );
  }
});
