const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-source.cjs');
const { WindowCatalog } = load('src/utils/window-catalog.ts');
const source = {
  id: 'window:10:0',
  ownerPid: 42,
  bundleId: 'com.apple.Terminal',
  name: 'Same title',
  appName: 'Terminal',
  thumbnail: '',
  appIcon: '',
};

test('duplicate titles retain distinct identities and expose only picker metadata', () => {
  const catalog = new WindowCatalog();
  const windows = catalog.update([source, { ...source, id: 'window:11:0' }]);
  assert.notEqual(windows[0].id, windows[1].id);
  assert.equal(catalog.get(windows[1].id).id, 'window:11:0');
  assert.equal(windows[0].ownerPid, undefined);
  assert.equal(windows[0].bundleId, undefined);
  assert.throws(() => catalog.get('window:10:0'));
});
test('refresh and different peers reject stale or borrowed selection tokens', () => {
  const first = new WindowCatalog();
  const second = new WindowCatalog();
  const [window] = first.update([source]);
  second.update([source]);
  assert.throws(() => second.get(window.id));
  first.update([source]);
  assert.throws(() => first.get(window.id));
});
test('catalog preserves listed identity when enumeration objects change', () => {
  const catalog = new WindowCatalog();
  const current = { ...source };
  const [window] = catalog.update([current]);
  current.ownerPid = 99;
  assert.equal(catalog.get(window.id).ownerPid, 42);
});
test('oversized previews are omitted to keep each result below the message limit', () => {
  const [window] = new WindowCatalog().update([
    {
      ...source,
      thumbnail: 'a'.repeat(40001),
      appIcon: 'b'.repeat(8001),
      name: '长'.repeat(5000),
    },
  ]);
  assert.equal(window.thumbnail, '');
  assert.equal(window.appIcon, '');
  assert.ok(Buffer.byteLength(JSON.stringify(window)) < 65536);
});
