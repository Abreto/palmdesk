const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const load = require('./load-source.cjs');

const {
  CHECK_INTERVAL_MS,
  RELEASES_PAGE,
  ReleaseChecker,
  compareVersions,
  newestRelease,
  parseVersion,
} = load('electron-main/release-check.ts');

const release = (tag, extra = {}) => ({
  tag_name: tag,
  html_url: `https://evil.example/${tag}`,
  draft: false,
  prerelease: true,
  body: 'Experimental PalmDesk desktop installers for testing.',
  ...extra,
});

function checker(t, releases, { enabled } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'palmdesk-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  if (enabled !== undefined)
    fs.writeFileSync(
      path.join(directory, 'release-check.json'),
      JSON.stringify({ enabled })
    );
  const state = { requests: 0, statuses: [] };
  state.checker = new ReleaseChecker({
    directory,
    current: '0.0.7',
    now: () => 1000,
    fetchReleases: async () => {
      state.requests += 1;
      if (releases instanceof Error) throw releases;
      return releases;
    },
    onChange: (status) => state.statuses.push(status),
  });
  return state;
}

test('version tags compare numerically and other tags are ignored', () => {
  assert.deepEqual(parseVersion('v0.0.10'), [0, 0, 10]);
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  ['v1.2', 'v1.2.3-beta.1', 'latest', '', undefined, 7].forEach((value) =>
    assert.equal(parseVersion(value), undefined, String(value))
  );
  assert.ok(compareVersions([0, 0, 10], [0, 0, 9]) > 0);
  assert.ok(compareVersions([0, 1, 0], [0, 0, 99]) > 0);
  assert.equal(compareVersions([1, 2, 3], [1, 2, 3]), 0);
});

test('the newest non-draft release wins and links to the project release page', () => {
  const newest = newestRelease([
    release('v0.0.8'),
    release('v0.0.10', { draft: true }),
    release('v0.0.9', { body: 'Notes\nSecurity: fixes GHSA-xxxx\n' }),
    release('nightly'),
    null,
  ]);
  assert.deepEqual(newest, {
    version: '0.0.9',
    url: `${RELEASES_PAGE}/tag/v0.0.9`,
    security: true,
  });
  assert.equal(newestRelease([release('v0.0.8')]).security, false);
  assert.equal(newestRelease({ message: 'rate limited' }), undefined);
  assert.equal(newestRelease([]), undefined);
});

test('a newer release is reported once checked, an equal or older one is not', async (t) => {
  const newer = checker(t, [release('v0.0.7'), release('v0.0.8')]);
  const status = await newer.checker.check();
  assert.equal(status.available, true);
  assert.equal(status.latest.version, '0.0.8');
  assert.equal(status.checkedAt, 1000);
  assert.equal(newer.statuses.at(-1).available, true);
  const same = checker(t, [release('v0.0.7'), release('v0.0.6')]);
  assert.equal((await same.checker.check()).available, false);
});

test('a disabled automatic check makes no request, but a manual check still runs', async (t) => {
  const state = checker(t, [release('v0.0.8')], { enabled: false });
  assert.equal((await state.checker.settings()).enabled, false);
  assert.equal((await state.checker.check()).available, false);
  state.checker.start();
  state.checker.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.requests, 0);
  const manual = await state.checker.check(true);
  assert.equal(state.requests, 1);
  assert.equal(manual.available, true);
  assert.equal(manual.manual, true);
});

test('the setting persists and failed checks report an error without a banner', async (t) => {
  const state = checker(t, new Error('offline'));
  assert.equal((await state.checker.settings()).enabled, true);
  await assert.rejects(state.checker.configure('no'), /无效/);
  assert.equal((await state.checker.configure(false)).enabled, false);
  const reloaded = new ReleaseChecker({
    directory: state.checker.options.directory,
    current: '0.0.7',
    fetchReleases: async () => assert.fail('disabled checks must not fetch'),
    onChange() {},
  });
  assert.equal((await reloaded.settings()).enabled, false);
  const failed = await state.checker.check(true);
  assert.equal(failed.error, 'offline');
  assert.equal(failed.available, false);
  assert.equal(failed.checking, false);
});

test('automatic checks run on launch and then once a day', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const state = checker(t, [release('v0.0.8')]);
  state.checker.start();
  await state.checker.settings();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.requests, 1);
  t.mock.timers.tick(CHECK_INTERVAL_MS);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.requests, 2);
  state.checker.stop();
  t.mock.timers.tick(CHECK_INTERVAL_MS);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.requests, 2);
});
