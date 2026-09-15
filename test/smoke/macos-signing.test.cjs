const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const certificate = require('../../build/macos-signing.json');

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
    require: Object.assign(
      (name) => {
        if (name === 'node:path') return path;
        if (name === '../build/macos-signing.json') return certificate;
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
  return { sign: context.module.exports, calls };
}

const packager = (options = {}) => ({
  platformSpecificBuildOptions: {},
  appInfo: { id: 'io.github.abreto.palmdesk' },
  ...options,
});

test('fixed self-signing preserves entitlements and gives rebuilt native helpers a stable identifier', async () => {
  const { sign, calls } = harness({ PALMDESK_BUILD_CHANNEL: 'release' });
  const app = path.resolve('/tmp/PalmDesk.app');
  await sign(
    {
      app,
      identity: certificate.sha1,
      platform: 'darwin',
      optionsForFile: () => ({
        entitlements: '/tmp/entitlements.plist',
        hardenedRuntime: true,
        additionalArguments: ['--verbose'],
      }),
    },
    packager()
  );
  const options = calls[0];
  assert.equal(options.identity, certificate.sha1);
  assert.equal(options.preAutoEntitlements, false);
  assert.equal(options.preEmbedProvisioningProfile, false);
  const helper = options.optionsForFile(
    path.join(app, 'Contents/MacOS/codex-window')
  );
  assert.equal(helper.entitlements, '/tmp/entitlements.plist');
  assert.equal(helper.hardenedRuntime, false);
  assert.equal(helper.timestamp, 'none');
  assert.deepEqual(Array.from(helper.additionalArguments), [
    '--verbose',
    '--identifier',
    'io.github.abreto.palmdesk.window-helper',
  ]);
  assert.deepEqual(
    Array.from(options.optionsForFile(app).additionalArguments),
    ['--verbose']
  );
});

test('release refuses absent, ad-hoc, or different signing identities', async () => {
  for (const identity of [undefined, '-', 'another-certificate']) {
    const { sign, calls } = harness({ PALMDESK_BUILD_CHANNEL: 'release' });
    await assert.rejects(
      sign({ identity, platform: 'darwin' }, packager()),
      /require the fixed/
    );
    assert.equal(calls.length, 0);
  }
});

test('fixed self-signing cannot silently sign a Mac App Store build', async () => {
  const { sign, calls } = harness();
  await assert.rejects(
    sign({ identity: certificate.sha1, platform: 'mas' }, packager()),
    /cannot sign Mac App Store/
  );
  assert.equal(calls.length, 0);
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
