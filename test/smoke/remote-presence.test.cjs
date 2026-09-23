const assert = require('node:assert/strict');
const { test } = require('node:test');

const load = require('./load-source.cjs');

const { VideoActivityLease, ControllerRecovery, PRESENCE_TIMEOUT } = load(
  'src/utils/remote-presence.ts'
);

test('video pauses on hide/read and lease expiry, resumes on renewal, and ignores malformed messages', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const changes = [];
  const lease = new VideoActivityLease((active) => changes.push(active));
  t.after(() => lease.dispose());
  t.mock.timers.tick(PRESENCE_TIMEOUT * 2);
  assert.equal(lease.active, true, 'old controllers have no lease');
  assert.equal(lease.receive({ visible: 'false', video: true }), false);
  lease.receive({ visible: false, video: true });
  assert.equal(lease.active, false);
  lease.receive({ visible: true, video: false });
  assert.deepEqual(changes, [false]);
  lease.receive({ visible: true, video: true });
  t.mock.timers.tick(PRESENCE_TIMEOUT - 1);
  assert.equal(lease.active, true);
  lease.receive({ visible: true, video: true });
  t.mock.timers.tick(PRESENCE_TIMEOUT - 1);
  assert.equal(lease.active, true);
  t.mock.timers.tick(1);
  assert.equal(
    lease.active,
    false,
    'a suspended phone cannot leave video running'
  );
  lease.receive({ visible: true, video: true });
  lease.dispose();
  t.mock.timers.tick(PRESENCE_TIMEOUT);
  assert.deepEqual(changes, [false, true, false, true]);
  assert.equal(lease.receive({ visible: false, video: false }), false);
});

test('foreground recovery is bounded, waits for probes, and never retries in the background', () => {
  const recovery = new ControllerRecovery();
  recovery.started(0);
  assert.equal(recovery.retry(19000, true, false), false);
  assert.equal(recovery.retry(90000, false, false), false);
  recovery.foreground(90000);
  assert.equal(recovery.retry(90000, true, false), true);
  assert.equal(recovery.retry(90001, true, false), false);
  assert.equal(recovery.retry(110000, true, false), true);
  assert.equal(recovery.retry(130000, true, false), true);
  assert.equal(recovery.retry(150000, true, false), false);
  recovery.foreground(160000);
  recovery.acknowledge(160000);
  assert.equal(recovery.retry(169999, true, true), false);
  assert.equal(
    recovery.retry(170000, true, true),
    true,
    'detect a half-open channel'
  );
  recovery.acknowledge(170001);
  recovery.stop();
  recovery.foreground(300000);
  assert.equal(
    recovery.retry(300000, true, false),
    false,
    'explicit end/authentication failure stops recovery'
  );
  recovery.reset(300001);
  assert.equal(recovery.retry(300001, true, false), true);
});

test('old hosts are not disconnected for missing presence support', () => {
  const recovery = new ControllerRecovery();
  recovery.started(0);
  assert.equal(recovery.retry(90000, true, true), false);
  assert.equal(recovery.retry(90000, true, false), true);
});
