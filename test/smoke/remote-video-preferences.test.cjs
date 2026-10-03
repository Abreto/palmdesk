const assert = require('node:assert/strict');
const { test } = require('node:test');
const { effectScope } = require('vue');
const loadSource = require('./load-source.cjs');
const { REMOTE_VIDEO_DEFAULTS, REMOTE_VIDEO_PROFILES, remoteVideoProfile } =
  loadSource('src/utils/remote-video.ts');
const { useRemoteVideoQuality } = loadSource(
  'src/hooks/use-remoteVideoQuality.ts'
);

function storage(t, initial = null) {
  let saved = initial;
  const previous = Object.getOwnPropertyDescriptor(global, 'localStorage');
  const value = {
    getItem: () => saved,
    setItem: (_key, data) => {
      saved = data;
    },
  };
  Object.defineProperty(global, 'localStorage', { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(global, 'localStorage', previous);
    else delete global.localStorage;
  });
  return value;
}

test('fresh controllers share Balanced and merely connecting does not save a preference', (t) => {
  const local = storage(t);
  const first = useRemoteVideoQuality();
  const second = useRemoteVideoQuality();
  assert.deepEqual(first.videoQuality.value, REMOTE_VIDEO_DEFAULTS);
  assert.deepEqual(second.videoQuality.value, REMOTE_VIDEO_DEFAULTS);
  first.videoQuality.value.maxBitrate = 1000;
  assert.equal(second.videoQuality.value.maxBitrate, 3000);
  assert.equal(local.getItem(), null);
});

test('explicit profiles and every manual override survive controller remount and reconnect', (t) => {
  storage(t);
  const first = useRemoteVideoQuality();
  first.setVideoQuality(REMOTE_VIDEO_PROFILES.highDetail);
  const reconnected = useRemoteVideoQuality();
  assert.deepEqual(
    reconnected.videoQuality.value,
    REMOTE_VIDEO_PROFILES.highDetail
  );
  const custom = {
    resolutionRatio: 1440,
    maxFramerate: 15,
    maxBitrate: 2000,
    videoContentHint: 'motion',
  };
  reconnected.setVideoQuality(custom);
  custom.maxBitrate = 1000;
  const next = useRemoteVideoQuality();
  assert.equal(remoteVideoProfile(next.videoQuality.value), 'custom');
  assert.deepEqual(next.videoQuality.value, { ...custom, maxBitrate: 2000 });
  next.setVideoQuality(REMOTE_VIDEO_PROFILES.balanced);
  assert.deepEqual(
    useRemoteVideoQuality().videoQuality.value,
    REMOTE_VIDEO_DEFAULTS
  );
});

test('corrupt, partial, and unsupported saved preferences fall back to Balanced', (t) => {
  const local = storage(t);
  for (const saved of [
    '{',
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...REMOTE_VIDEO_DEFAULTS, maxBitrate: '3000' }),
    JSON.stringify({ ...REMOTE_VIDEO_DEFAULTS, resolutionRatio: 99999 }),
  ]) {
    local.setItem('', saved);
    assert.deepEqual(
      useRemoteVideoQuality().videoQuality.value,
      REMOTE_VIDEO_DEFAULTS
    );
    assert.equal(
      local.getItem(),
      saved,
      'reading storage must not overwrite it'
    );
  }
});

test('blocked storage does not prevent starting or changing the active quality', (t) => {
  const local = storage(t);
  local.getItem = () => {
    throw new Error('storage denied');
  };
  local.setItem = () => {
    throw new Error('storage denied');
  };
  const controller = useRemoteVideoQuality();
  assert.deepEqual(controller.videoQuality.value, REMOTE_VIDEO_DEFAULTS);
  controller.setVideoQuality(REMOTE_VIDEO_PROFILES.lowData);
  assert.deepEqual(
    controller.videoQuality.value,
    REMOTE_VIDEO_PROFILES.lowData
  );
});

test('saved settings cannot inject unrelated connection fields', (t) => {
  storage(
    t,
    JSON.stringify({
      ...REMOTE_VIDEO_DEFAULTS,
      receiver: 'stale-peer',
      roomId: 'stale-room',
    })
  );
  assert.deepEqual(
    useRemoteVideoQuality().videoQuality.value,
    REMOTE_VIDEO_DEFAULTS
  );
});

test('connection forms follow cross-window preferences while active controllers keep their choice', (t) => {
  const local = storage(t);
  const originalWindow = global.window;
  global.window = new EventTarget();
  t.after(() => {
    global.window = originalWindow;
  });
  const scope = effectScope();
  t.after(() => scope.stop());
  const form = scope.run(() =>
    useRemoteVideoQuality({ followSavedPreference: true })
  );
  const controller = useRemoteVideoQuality();
  const dispatch = (
    newValue,
    storageArea = local,
    key = 'palmdesk-remote-video-quality-v1'
  ) => {
    const event = Object.assign(new Event('storage'), {
      key,
      newValue,
      storageArea,
    });
    global.window.dispatchEvent(event);
  };
  controller.setVideoQuality(REMOTE_VIDEO_PROFILES.lowData);
  dispatch(local.getItem());
  assert.deepEqual(form.videoQuality.value, REMOTE_VIDEO_PROFILES.lowData);
  form.setVideoQuality({ ...form.videoQuality.value, maxBitrate: 2000 });
  assert.deepEqual(JSON.parse(local.getItem()), {
    ...REMOTE_VIDEO_PROFILES.lowData,
    maxBitrate: 2000,
  });
  assert.deepEqual(
    controller.videoQuality.value,
    REMOTE_VIDEO_PROFILES.lowData
  );
  dispatch(JSON.stringify(REMOTE_VIDEO_PROFILES.highDetail), {});
  assert.equal(
    form.videoQuality.value.maxBitrate,
    2000,
    'ignore sessionStorage events'
  );
  dispatch(null, local, 'another-preference');
  assert.equal(form.videoQuality.value.maxBitrate, 2000);
  dispatch(null, local, null);
  assert.deepEqual(
    form.videoQuality.value,
    REMOTE_VIDEO_DEFAULTS,
    'clearing storage restores Balanced'
  );
  scope.stop();
  dispatch(JSON.stringify(REMOTE_VIDEO_PROFILES.highDetail));
  assert.deepEqual(
    form.videoQuality.value,
    REMOTE_VIDEO_DEFAULTS,
    'disposed forms stop listening'
  );
});

test('legacy debug bitrate preferences fall back to Balanced', (t) => {
  const local = storage(t);
  for (const maxBitrate of [1, 10]) {
    local.setItem('', JSON.stringify({ ...REMOTE_VIDEO_DEFAULTS, maxBitrate }));
    assert.deepEqual(
      useRemoteVideoQuality().videoQuality.value,
      REMOTE_VIDEO_DEFAULTS
    );
  }
});
