const { execFileSync, spawnSync } = require('node:child_process');
const { X509Certificate } = require('node:crypto');
const { mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const certificate = require('../build/macos-signing.json');

function verify(app) {
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], {
    stdio: 'pipe',
  });
  const appId = execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleIdentifier', path.join(app, 'Contents/Info.plist')],
    { encoding: 'utf8' }
  ).trim();
  const frameworks = path.join(app, 'Contents/Frameworks');
  const targets = [
    [app, appId],
    [path.join(app, 'Contents/MacOS/codex-window'), `${appId}.window-helper`],
    ...readdirSync(frameworks)
      .filter((name) => name.endsWith('.app'))
      .map((name) => {
        const helper = path.join(frameworks, name);
        const id = execFileSync(
          '/usr/libexec/PlistBuddy',
          [
            '-c',
            'Print :CFBundleIdentifier',
            path.join(helper, 'Contents/Info.plist'),
          ],
          { encoding: 'utf8' }
        ).trim();
        if (!id.startsWith(`${appId}.`))
          throw new Error(`Unexpected helper identity: ${id}`);
        return [helper, id];
      }),
  ];
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'palmdesk-signature-'));
  try {
    for (const [target, id] of targets) {
      execFileSync(
        'codesign',
        [
          '--verify',
          '--strict',
          '-R',
          `=identifier "${id}" and certificate leaf = H"${certificate.sha1}"`,
          target,
        ],
        { stdio: 'pipe' }
      );
      const prefix = path.join(temporary, 'certificate');
      execFileSync(
        'codesign',
        ['--display', `--extract-certificates=${prefix}`, target],
        { stdio: 'pipe' }
      );
      const leaf = new X509Certificate(readFileSync(`${prefix}0`));
      if (leaf.fingerprint256.replaceAll(':', '') !== certificate.sha256)
        throw new Error(`Unexpected signing certificate: ${target}`);
      const requirement = spawnSync('codesign', ['--display', '-r-', target], {
        encoding: 'utf8',
      });
      const output = requirement.stdout + requirement.stderr;
      if (
        requirement.status !== 0 ||
        /\bcdhash\b/.test(output) ||
        !/designated =>/.test(output)
      )
        throw new Error(
          `Signature does not have a stable designated requirement: ${target}`
        );
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  console.log(
    `Verified fixed certificate and stable identities for ${targets.length} application processes.`
  );
}

if (require.main === module) {
  try {
    if (process.platform !== 'darwin' || !process.argv[2])
      throw new Error('Usage on macOS: verify-macos-signing.cjs <app>');
    verify(path.resolve(process.argv[2]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { verify };
