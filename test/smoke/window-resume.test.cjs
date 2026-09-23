const assert = require('node:assert/strict');
const { test } = require('node:test');

const { WindowResumeStore } = require('./load-source.cjs')(
  'src/utils/window-resume.ts'
);

const source = {
  id: 'window:10:0',
  nativeId: 10,
  ownerPid: 42,
  bundleId: 'app',
  name: 'Task',
};

test('window resume requires the same authenticated device and a fresh matching native identity', () => {
  const store = new WindowResumeStore();
  const token = store.remember('phone-a', source, 0);
  assert.equal(store.resolve(token, 'phone-a', [source], 1000), source);
  assert.throws(() => store.resolve(token, 'phone-b', [source], 1000));
  assert.throws(() => store.resolve(source.id, 'phone-a', [source], 1000));
  assert.throws(() => store.resolve(token, 'phone-a', [], 1000));
  [
    { id: 'new' },
    { nativeId: 11 },
    { ownerPid: 43 },
    { bundleId: 'other' },
  ].forEach((change) => {
    assert.throws(() =>
      store.resolve(token, 'phone-a', [{ ...source, ...change }], 1000)
    );
  });
  assert.equal(
    store.resolve(token, 'phone-a', [{ ...source, name: 'New title' }], 1000)
      .name,
    'New title'
  );
});

test('active captures renew references; disconnected references expire and new selection rotates them', () => {
  const store = new WindowResumeStore();
  const original = { ...source };
  const token = store.remember('phone', original, 0);
  original.ownerPid = 99;
  store.touch(token, 299999);
  assert.equal(store.resolve(token, 'phone', [source], 300000), source);
  assert.throws(() => store.resolve(token, 'phone', [source], 599999));
  const replacement = store.remember('phone', source, 600000);
  assert.notEqual(token, replacement);
  assert.throws(() => store.resolve(token, 'phone', [source], 600001));
  assert.equal(store.resolve(replacement, 'phone', [source], 600001), source);
});
