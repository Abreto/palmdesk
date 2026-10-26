const assert = require('node:assert/strict');
const test = require('node:test');

const { reactive } = require('vue');

const load = require('./load-source.cjs');

const { useReleaseBanner } = load('src/hooks/use-release-banner.ts');

function storage(t, { broken = false } = {}) {
  const values = new Map();
  const writes = [];
  globalThis.localStorage = {
    getItem: (key) => {
      if (broken) throw new Error('Storage is unavailable');
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (broken) throw new Error('Storage is unavailable');
      writes.push([key, value]);
      values.set(key, String(value));
    },
  };
  t.after(() => delete globalThis.localStorage);
  return writes;
}

const status = (version, security = false) =>
  reactive({
    release: {
      enabled: true,
      current: '0.0.7',
      checking: false,
      available: true,
      latest: {
        version,
        url: `https://github.com/Abreto/palmdesk/releases/tag/v${version}`,
        security,
      },
    },
  });

test('a dismissed ordinary update stays hidden when the banner mounts again', (t) => {
  const writes = storage(t);
  const app = status('0.0.8');
  const banner = useReleaseBanner(() => app.release);
  assert.equal(banner.latest.value.version, '0.0.8');
  banner.dismiss();
  assert.equal(banner.latest.value, undefined);
  assert.deepEqual(writes, [['palmdesk-release-dismissed', '0.0.8']]);
  assert.equal(useReleaseBanner(() => app.release).latest.value, undefined);
  // A newer release is shown again.
  app.release.latest = { ...app.release.latest, version: '0.0.9' };
  assert.equal(
    useReleaseBanner(() => app.release).latest.value.version,
    '0.0.9'
  );
});

test('a dismissed security release returns on the next launch', (t) => {
  const writes = storage(t);
  const app = status('0.0.8', true);
  const banner = useReleaseBanner(() => app.release);
  banner.dismiss();
  assert.equal(banner.latest.value, undefined);
  assert.deepEqual(writes, []);
  assert.equal(
    useReleaseBanner(() => app.release).latest.value.version,
    '0.0.8'
  );
});

test('without storage, dismissing hides the banner until the next launch', (t) => {
  storage(t, { broken: true });
  const app = status('0.0.8');
  const banner = useReleaseBanner(() => app.release);
  assert.doesNotThrow(() => banner.dismiss());
  assert.equal(banner.latest.value, undefined);
  assert.equal(
    useReleaseBanner(() => app.release).latest.value.version,
    '0.0.8'
  );
});
