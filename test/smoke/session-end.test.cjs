/* eslint-disable require-await -- Async doubles match the production contract. */
const assert = require('node:assert/strict');
const test = require('node:test');

const load = require('./load-source.cjs');

const { changeTemporaryPassword, isFinalSessionEnd, sessionEndMessage } = load(
  'src/utils/session-end.ts'
);

test('a password change disconnects every controller connected when it started', async () => {
  const connected = ['phone', 'tablet'];
  const events = [];
  const disconnected = await changeTemporaryPassword({
    connected: () => [...connected],
    update: async () => {
      // The service can end the sessions before it answers the request.
      connected.length = 0;
      events.push('update');
      return true;
    },
    disconnect: (controller, reason) =>
      events.push(['disconnect', controller, reason]),
  });
  assert.equal(disconnected, 2);
  assert.deepEqual(events, [
    'update',
    ['disconnect', 'phone', 'password-changed'],
    ['disconnect', 'tablet', 'password-changed'],
  ]);
});

test('a rejected password change keeps every session', async () => {
  const events = [];
  const options = {
    connected: () => ['phone'],
    disconnect: (controller) => events.push(controller),
  };
  assert.equal(
    await changeTemporaryPassword({ ...options, update: async () => false }),
    undefined
  );
  await assert.rejects(
    changeTemporaryPassword({
      ...options,
      update: async () => {
        throw new Error('network');
      },
    }),
    /network/
  );
  assert.deepEqual(events, []);
  assert.equal(
    await changeTemporaryPassword({
      connected: () => [],
      update: async () => true,
      disconnect: () => assert.fail('nothing to disconnect'),
    }),
    0
  );
});

test('controllers explain why the session ended and do not reconnect', () => {
  assert.equal(isFinalSessionEnd('password-changed'), true);
  assert.equal(isFinalSessionEnd('explicit'), true);
  assert.equal(isFinalSessionEnd('unverified'), true);
  assert.equal(isFinalSessionEnd('disconnect'), false);
  assert.equal(isFinalSessionEnd(undefined), false);
  assert.match(sessionEndMessage('password-changed'), /临时密码/);
  assert.match(sessionEndMessage('explicit'), /电脑已结束/);
  assert.match(sessionEndMessage('unverified'), /未能验证/);
  assert.match(sessionEndMessage(), /电脑已结束/);
});
