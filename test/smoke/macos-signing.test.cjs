const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const filename = path.resolve(__dirname, '../../scripts/sign-macos.cjs');
const source = fs.readFileSync(filename, 'utf8');

function harness(env = {}) {
  const calls = [];
  const bundledRequire = Object.assign(
    () => ({ signAsync: async (options) => calls.push(options) }),
    { resolve: (name) => name }
  );
  const context = {
    module: { exports: {} },
    require: Object.assign(() => ({ createRequire: () => bundledRequire }), {
      resolve: (name) => name,
    }),
    process: { env },
    console: { log() {} },
  };
  vm.runInNewContext(source, context, { filename });
  return { sign: context.module.exports, calls };
}

const packager = (options = {}) => ({
  platformSpecificBuildOptions: {},
  ...options,
});

test('local signing covers the bundle while preserving per-file entitlements', async () => {
  const { sign, calls } = harness();
  await sign(
    {
      app: '/tmp/PalmDesk.app',
      platform: 'darwin',
      optionsForFile: (file) => ({
        entitlements: `${file}.plist`,
        hardenedRuntime: true,
      }),
    },
    packager()
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].app, '/tmp/PalmDesk.app');
  assert.equal(calls[0].identity, '-');
  const fileOptions = calls[0].optionsForFile('helper');
  assert.equal(fileOptions.entitlements, 'helper.plist');
  assert.equal(fileOptions.hardenedRuntime, false);
  assert.equal(fileOptions.timestamp, 'none');
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
    const { sign, calls } = harness(env);
    await assert.rejects(
      sign(options, packager(config)),
      /certificate is unavailable/
    );
    assert.equal(calls.length, 0);
  }
});
