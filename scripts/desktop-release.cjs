const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  appendFileSync,
  createReadStream,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');

function validateRelease(root, tag, expectedCommit) {
  const { version } = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  assert.equal(
    tag,
    `v${version}`,
    'Release tag must match package.json version.'
  );
  const options = {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const git = (...args) => execFileSync('git', args, options).trim();
  git('check-ref-format', `refs/tags/${tag}`);
  const commit = git('rev-parse', 'HEAD');
  assert.equal(
    commit,
    expectedCommit,
    'Checkout must match the workflow commit.'
  );
  const existing = spawnSync(
    'git',
    ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`],
    options
  );
  if (existing.error) throw existing.error;
  if (existing.status === 0) {
    assert.equal(
      git('rev-parse', `refs/tags/${tag}^{commit}`),
      commit,
      'Existing release tag points to a different commit.'
    );
  } else {
    assert.equal(existing.status, 1, 'Cannot check the existing release tag.');
  }
  return { version, tag, commit };
}

async function prepareReleaseAssets(directory, { version, productName }) {
  const expected = [
    `${productName}-${version}-mac-arm64.dmg`,
    `${productName}-${version}-mac-x64.dmg`,
    `${productName}-${version}-windows-x64.exe`,
  ];
  const installers = readdirSync(directory)
    .filter((name) => /\.(dmg|exe)$/i.test(name))
    .sort();
  assert.deepEqual(
    installers,
    expected,
    'Release requires exactly the three installers for this version.'
  );
  const checksums = [];
  for (const name of expected) {
    const filename = path.join(directory, name);
    const stat = lstatSync(filename);
    assert.ok(stat.isFile() && stat.size > 0, `Invalid installer: ${name}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    checksums.push(`${hash.digest('hex')}  ${name}\n`);
  }
  writeFileSync(path.join(directory, 'SHA256SUMS.txt'), checksums.join(''));
  return expected;
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const [command, directory] = process.argv.slice(2);
  if (command === 'validate' && !directory) {
    assert.equal(
      process.env.GITHUB_REF,
      'refs/heads/main',
      'Run Desktop Prerelease from the main branch.'
    );
    const metadata = validateRelease(
      root,
      process.env.RELEASE_TAG,
      process.env.GITHUB_SHA
    );
    for (const [key, value] of Object.entries(metadata)) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
    console.log(`Validated ${metadata.tag} at ${metadata.commit}.`);
  } else if (command === 'assets' && directory) {
    const manifest = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8')
    );
    const assets = await prepareReleaseAssets(directory, manifest);
    console.log(`Prepared ${assets.length} installers and SHA256SUMS.txt.`);
  } else {
    throw new Error(
      'Usage: node scripts/desktop-release.cjs validate|assets <directory>'
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { validateRelease, prepareReleaseAssets };
