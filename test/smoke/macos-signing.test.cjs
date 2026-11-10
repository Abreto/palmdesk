const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const certificate = require('../../build/macos-signing.json');
const codesign = require('../../scripts/macos-codesign.cjs');

const filename = path.resolve(__dirname, '../../scripts/sign-macos.cjs');
const source = fs.readFileSync(filename, 'utf8');

function harness(env = {}) {
  const calls = [];
  const signed = [];
  const bundledRequire = Object.assign(
    () => ({ signAsync: async (options) => calls.push(options) }),
    { resolve: (name) => name }
  );
  const context = {
    module: { exports: {} },
    require: Object.assign(
      (name) => {
        if (name === '../build/macos-signing.json') return certificate;
        if (name === './macos-codesign.cjs')
          return { ...codesign, signApp: (options) => signed.push(options) };
        return { createRequire: () => bundledRequire };
      },
      {
        resolve: (name) => name,
      }
    ),
    process: { env },
    console: { log() {} },
  };
  vm.runInNewContext(source, context, { filename });
  return { sign: context.module.exports, calls, signed };
}

const packager = (options = {}) => ({
  platformSpecificBuildOptions: {},
  appInfo: { id: 'io.github.abreto.palmdesk' },
  ...options,
});

test('fixed self-signing uses the release signer and gives rebuilt native helpers a stable identifier', async () => {
  const { sign, calls, signed } = harness({
    PALMDESK_BUILD_CHANNEL: 'release',
  });
  const app = path.resolve('/tmp/PalmDesk.app');
  await sign(
    {
      app,
      identity: certificate.sha1.toLowerCase(),
      keychain: '/tmp/signing.keychain-db',
      platform: 'darwin',
    },
    packager()
  );
  assert.equal(calls.length, 0);
  assert.equal(signed.length, 1);
  assert.equal(signed[0].app, app);
  assert.equal(signed[0].identity, certificate.sha1);
  assert.equal(signed[0].keychain, '/tmp/signing.keychain-db');
  assert.deepEqual(
    { ...signed[0].identifiers },
    {
      'Contents/MacOS/codex-window': 'io.github.abreto.palmdesk.window-helper',
    }
  );
});

test('release refuses absent, ad-hoc, or different signing identities', async () => {
  for (const identity of [undefined, '-', 'another-certificate']) {
    const { sign, calls, signed } = harness({
      PALMDESK_BUILD_CHANNEL: 'release',
    });
    await assert.rejects(
      sign({ identity, platform: 'darwin' }, packager()),
      /require the fixed/
    );
    assert.equal(calls.length + signed.length, 0);
  }
});

test('fixed self-signing cannot silently sign a Mac App Store build', async () => {
  const { sign, calls, signed } = harness();
  await assert.rejects(
    sign({ identity: certificate.sha1, platform: 'mas' }, packager()),
    /cannot sign Mac App Store/
  );
  assert.equal(calls.length + signed.length, 0);
});

test('local builds are signed ad hoc with the release signer', async () => {
  const { sign, calls, signed } = harness();
  await sign(
    { app: '/tmp/PalmDesk.app', keychain: '/tmp/ignored', platform: 'darwin' },
    packager()
  );
  assert.equal(calls.length, 0);
  assert.equal(signed.length, 1);
  assert.equal(signed[0].app, '/tmp/PalmDesk.app');
  assert.equal(signed[0].identity, '-');
  assert.equal(signed[0].keychain, undefined);
  assert.equal(
    signed[0].identifiers['Contents/MacOS/codex-window'],
    'io.github.abreto.palmdesk.window-helper'
  );
});

test('a valid certificate retains the requested signing options', async () => {
  const { sign, calls } = harness();
  const options = { identity: 'certificate-fingerprint', platform: 'darwin' };
  await sign(options, packager({ forceCodeSigning: true }));
  assert.equal(calls[0], options);
});

test('missing requested certificates and MAS builds fail before any local signing', async () => {
  for (const [env, options, config] of [
    [{}, {}, { forceCodeSigning: true }],
    [{}, {}, { platformSpecificBuildOptions: { identity: 'Developer ID' } }],
    [{ CSC_NAME: 'Developer ID' }, {}, {}],
    [{ CSC_LINK: '/tmp/requested-signing-certificate.p12' }, {}, {}],
    [{}, { platform: 'mas' }, {}],
  ]) {
    const { sign, calls, signed } = harness(env);
    await assert.rejects(
      sign(options, packager(config)),
      /certificate is unavailable/
    );
    assert.equal(calls.length + signed.length, 0);
  }
});
