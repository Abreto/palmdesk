const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const certificate = require('../../build/macos-signing.json');
const source = fs.readFileSync(
  path.join(__dirname, '../../scripts/prepare-macos-signing.cjs'),
  'utf8'
);

function run(command, env, failCommand) {
  const calls = [];
  const errors = [];
  const process = {
    platform: 'darwin',
    argv: ['node', 'script', command],
    env,
  };
  vm.runInNewContext(source, {
    process,
    console: { log() {}, error: (value) => errors.push(value) },
    require: (name) => {
      if (name === '../build/macos-signing.json') return certificate;
      if (name === 'node:child_process')
        return {
          spawnSync: (binary, args) => {
            calls.push({ binary, args: Array.from(args) });
            return { status: args[0] === failCommand ? 1 : 0, stdout: '' };
          },
        };
      return require(name);
    },
  });
  return { calls, errors, exitCode: process.exitCode };
}

test('self-hosted CI is rejected before importing secrets or changing trust', () => {
  const result = run('prepare', {
    GITHUB_ACTIONS: 'true',
    RUNNER_ENVIRONMENT: 'self-hosted',
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.errors[0], /disposable GitHub-hosted/);
  assert.equal(result.calls.length, 0);
});

for (const failure of [undefined, 'delete-keychain']) {
  test(`hosted cleanup removes private material without GUI trust removal${failure ? ' and reports keychain deletion failure' : ''}`, (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'signing-cleanup-test-')
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    for (const file of ['trusted', 'certificate.pem', 'signing.keychain-db'])
      fs.writeFileSync(path.join(directory, file), 'synthetic fixture');
    const previous = ['/tmp/previous.keychain-db'];
    fs.writeFileSync(
      path.join(directory, 'keychains.json'),
      JSON.stringify(previous)
    );
    const result = run(
      'cleanup',
      {
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'github-hosted',
        PALMDESK_SIGNING_DIR: directory,
      },
      failure
    );
    assert.equal(result.exitCode, failure ? 1 : undefined);
    assert.equal(fs.existsSync(directory), false);
    assert.deepEqual(
      result.calls.map((call) => call.args),
      [
        ['list-keychains', '-d', 'user', '-s', ...previous],
        ['delete-keychain', path.join(directory, 'signing.keychain-db')],
      ]
    );
  });
}
