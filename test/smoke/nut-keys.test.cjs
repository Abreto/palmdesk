const assert = require('node:assert/strict');
const test = require('node:test');

const { Key } = require('@nut-tree-fork/shared');

const load = require('./load-source.cjs');

// Type checking ensures NUT_KEY_MAP only names keys present in the mirror.
test('the renderer key codes match the nut-js Key enum used by the host', () => {
  const mirror = load('src/utils/nut-keys.ts').Key;
  assert.ok(Object.keys(mirror).length > 80);
  Object.entries(mirror).forEach(([name, value]) =>
    assert.equal(value, Key[name], name)
  );
});
