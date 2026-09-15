// Only for disposable CI keychains. Never print command arguments containing secrets.
const { spawnSync } = require('node:child_process');
const { randomBytes, X509Certificate } = require('node:crypto');
const {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');
const certificate = require('../build/macos-signing.json');
const hostedRunner =
  process.env.GITHUB_ACTIONS === 'true' &&
  process.env.RUNNER_ENVIRONMENT === 'github-hosted';

function security(args) {
  // User-domain trust can wait for a GUI authorization dialog on hosted runners.
  // Use their disposable admin trust domain non-interactively instead.
  const adminTrust =
    hostedRunner &&
    ['add-trusted-cert', 'remove-trusted-cert'].includes(args[0]);
  const result = spawnSync(
    adminTrust ? '/usr/bin/sudo' : '/usr/bin/security',
    adminTrust
      ? ['-n', '/usr/bin/security', args[0], '-d', ...args.slice(1)]
      : args,
    { encoding: 'utf8', timeout: 60_000 }
  );
  if (result.error || result.status !== 0)
    throw new Error(`macOS signing setup failed at security ${args[0]}.`);
  return result.stdout;
}

function cleanup(directory) {
  const keychain = path.join(directory, 'signing.keychain-db');
  const cert = path.join(directory, 'certificate.pem');
  const previous = path.join(directory, 'keychains.json');
  const failures = [];
  function attempt(action) {
    try {
      action();
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (existsSync(path.join(directory, 'trusted'))) {
    // macOS 15 may require GUI authorization to remove admin trust even with
    // sudo. The public certificate trust dies with this disposable VM; remove
    // the private key below without depending on that interactive operation.
    if (hostedRunner)
      console.log(
        'Public certificate trust will be discarded with the hosted runner.'
      );
    else attempt(() => security(['remove-trusted-cert', cert]));
  }
  if (existsSync(previous))
    attempt(() =>
      security([
        'list-keychains',
        '-d',
        'user',
        '-s',
        ...JSON.parse(readFileSync(previous, 'utf8')),
      ])
    );
  if (existsSync(keychain))
    attempt(() => security(['delete-keychain', keychain]));
  rmSync(directory, { recursive: true, force: true });
  if (failures.length) throw new Error(failures.join('\n'));
}

function prepare() {
  if (process.env.GITHUB_ACTIONS === 'true' && !hostedRunner)
    throw new Error(
      'CI signing setup requires a disposable GitHub-hosted runner.'
    );
  const {
    RUNNER_TEMP,
    GITHUB_ENV,
    PALMDESK_SIGNING_P12,
    PALMDESK_SIGNING_PASSWORD,
  } = process.env;
  if (
    !RUNNER_TEMP ||
    !GITHUB_ENV ||
    !PALMDESK_SIGNING_P12 ||
    !PALMDESK_SIGNING_PASSWORD
  )
    throw new Error(
      'Signing requires the certificate and password secrets, RUNNER_TEMP and GITHUB_ENV.'
    );
  const directory = mkdtempSync(path.join(RUNNER_TEMP, 'palmdesk-signing-'));
  const keychain = path.join(directory, 'signing.keychain-db');
  const p12 = path.join(directory, 'certificate.p12');
  const pem = path.join(directory, 'certificate.pem');
  const keychainPassword = randomBytes(32).toString('hex');
  // Make the always-run cleanup step available even if setup is interrupted.
  appendFileSync(
    GITHUB_ENV,
    `CSC_KEYCHAIN=${keychain}\nPALMDESK_SIGNING_DIR=${directory}\n`
  );
  try {
    console.log('Importing the fixed certificate into a temporary keychain.');
    writeFileSync(p12, Buffer.from(PALMDESK_SIGNING_P12, 'base64'), {
      mode: 0o600,
    });
    security(['create-keychain', '-p', keychainPassword, keychain]);
    security(['set-keychain-settings', '-lut', '7200', keychain]);
    security(['unlock-keychain', '-p', keychainPassword, keychain]);
    security([
      'import',
      p12,
      '-k',
      keychain,
      '-P',
      PALMDESK_SIGNING_PASSWORD,
      '-T',
      '/usr/bin/codesign',
    ]);
    rmSync(p12);
    const certificates =
      security(['find-certificate', '-a', '-p', keychain]).match(
        /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g
      ) || [];
    const selected = certificates.find(
      (value) =>
        new X509Certificate(value).fingerprint256.replaceAll(':', '') ===
        certificate.sha256
    );
    if (!selected)
      throw new Error(
        'Imported certificate does not match build/macos-signing.json.'
      );
    const parsed = new X509Certificate(selected);
    if (
      Date.now() < Date.parse(parsed.validFrom) ||
      Date.now() >= Date.parse(parsed.validTo)
    )
      throw new Error('The signing certificate is not currently valid.');
    writeFileSync(pem, selected);
    console.log('Configuring temporary code-signing trust.');
    security([
      'add-trusted-cert',
      '-r',
      'trustRoot',
      '-p',
      'codeSign',
      '-k',
      keychain,
      pem,
    ]);
    writeFileSync(path.join(directory, 'trusted'), '');
    security([
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      keychainPassword,
      keychain,
    ]);
    const previous = security(['list-keychains', '-d', 'user'])
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line.trim()));
    writeFileSync(
      path.join(directory, 'keychains.json'),
      JSON.stringify(previous)
    );
    security(['list-keychains', '-d', 'user', '-s', keychain, ...previous]);
    if (
      !security([
        'find-identity',
        '-v',
        '-p',
        'codesigning',
        keychain,
      ]).includes(certificate.sha1)
    )
      throw new Error(
        'The fixed certificate and private key are not usable for code signing.'
      );
    console.log(
      'Fixed PalmDesk signing identity is ready in a temporary keychain.'
    );
  } catch (error) {
    try {
      cleanup(directory);
    } catch (cleanupError) {
      console.error(cleanupError.message);
    }
    throw error;
  }
}

try {
  if (process.platform !== 'darwin') throw new Error('macOS is required.');
  if (process.argv[2] === 'prepare') prepare();
  else if (process.argv[2] === 'cleanup' && process.env.PALMDESK_SIGNING_DIR)
    cleanup(process.env.PALMDESK_SIGNING_DIR);
  else throw new Error('Usage: prepare-macos-signing.cjs prepare|cleanup');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
