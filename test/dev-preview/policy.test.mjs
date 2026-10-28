import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compressible,
  CookieJar,
  normalizeTargets,
  requestHeaders,
  resolvePath,
  responseHeaders,
  rewriteLocation,
} from './policy.mjs';

const [web, api] = normalizeTargets([
  { id: 'web', port: 5173 },
  { id: 'api', port: 3000, prefix: '/api/' },
]);

test('only explicit, valid loopback ports can be approved', () => {
  assert.equal(web.prefix, '/');
  assert.equal(web.label, 'localhost:5173');
  assert.throws(
    () => normalizeTargets([{ id: 'ssh', port: 22 }]),
    /not allowed/
  );
  assert.throws(
    () => normalizeTargets([{ id: 'x', port: 70000 }]),
    /invalid port/
  );
  assert.throws(() => normalizeTargets([{ id: 'Bad id', port: 5173 }]), /id/);
  assert.throws(
    () =>
      normalizeTargets([
        { id: 'a', port: 1 + 5172 },
        { id: 'a', port: 3000 },
      ]),
    /id/
  );
  ['api', '/api', '/a/../b/', '/%2e%2e/'].forEach((prefix) =>
    assert.throws(
      () => normalizeTargets([{ id: 'p', port: 3000, prefix }]),
      /prefix/
    )
  );
});

test('paths are normalized and must stay under the prefix', () => {
  assert.deepEqual(resolvePath(web, '/src/main.js?t=1'), {
    ok: true,
    path: '/src/main.js?t=1',
  });
  assert.deepEqual(resolvePath(api, '/api'), { ok: true, path: '/api' });
  assert.deepEqual(resolvePath(api, '/api/v1/items'), {
    ok: true,
    path: '/api/v1/items',
  });
  assert.equal(resolvePath(api, '/api/../admin').code, 'outside-prefix');
  assert.equal(resolvePath(api, '/api/%2e%2e/admin').code, 'outside-prefix');
  assert.equal(resolvePath(api, '/apiary').code, 'outside-prefix');
  [
    'http://127.0.0.1:22/',
    '//127.0.0.1:22/',
    '/\\127.0.0.1',
    'relative',
    '/a b',
    '/api/..%2fadmin',
    '/api/%5c..%5cadmin',
    '/#fragment',
    '/\r\nX-Injected: 1',
    '',
  ].forEach((path) =>
    assert.equal(resolvePath(web, path).code, 'bad-path', path)
  );
});

test('redirects are rewritten within the target or refused', () => {
  assert.deepEqual(rewriteLocation(web, '/login', '/home'), {
    ok: true,
    location: '/home',
  });
  assert.deepEqual(rewriteLocation(web, '/a/b', 'c?x=1#top'), {
    ok: true,
    location: '/a/c?x=1#top',
  });
  [
    'http://localhost:5173/home',
    'http://127.0.0.1:5173/home',
    'http://[::1]:5173/home',
  ].forEach((location) =>
    assert.deepEqual(rewriteLocation(web, '/', location), {
      ok: true,
      location: '/home',
    })
  );
  assert.deepEqual(rewriteLocation(web, '/', 'http://localhost:3000/'), {
    ok: false,
    code: 'redirect-blocked',
    destination: 'http://localhost:3000',
  });
  [
    'https://localhost:5173/',
    'http://192.168.1.2:5173/',
    'http://user:pass@localhost:5173/',
    'https://accounts.example.com/login',
    'javascript:alert(1)',
  ].forEach((location) =>
    assert.equal(rewriteLocation(web, '/', location).ok, false, location)
  );
  assert.equal(rewriteLocation(api, '/api/login', '/dashboard').ok, false);
});

test('the host chooses Host, Origin, Referer and Cookie', () => {
  const headers = requestHeaders(
    web,
    [
      ['Accept', 'text/html'],
      ['Host', 'evil.example'],
      ['Origin', 'https://preview.example'],
      ['Cookie', 'palmdesk=secret'],
      ['X-Forwarded-For', '1.2.3.4'],
      ['Sec-Fetch-Site', 'same-origin'],
      ['If-None-Match', '"abc"'],
      ['X-Bad', 'line\r\nInjected: 1'],
      ['Bad Name', 'x'],
    ],
    'session=1'
  );
  assert.deepEqual(headers, {
    accept: 'text/html',
    'if-none-match': '"abc"',
    host: 'localhost:5173',
    origin: 'http://localhost:5173',
    referer: 'http://localhost:5173/',
    'accept-encoding': 'identity',
    cookie: 'session=1',
  });
});

test('response headers drop cookies, framing and origin-wide fields', () => {
  const { headers, cookies } = responseHeaders([
    'Content-Type',
    'text/html',
    'Set-Cookie',
    'a=1; Path=/',
    'X-Frame-Options',
    'DENY',
    'Content-Security-Policy',
    "default-src 'self'; frame-ancestors 'none'",
    'Strict-Transport-Security',
    'max-age=1',
    'Clear-Site-Data',
    '"*"',
    'ETag',
    '"v1"',
  ]);
  assert.deepEqual(cookies, ['a=1; Path=/']);
  assert.deepEqual(headers, [
    ['content-type', 'text/html'],
    ['content-security-policy', "default-src 'self'"],
    ['etag', '"v1"'],
  ]);
  assert.ok(compressible('text/javascript'));
  assert.ok(compressible('application/json; charset=utf-8'));
  assert.ok(!compressible('image/png'));
});

test('the cookie jar keeps host-only cookies by path and expiry', () => {
  let now = 1_000_000;
  const jar = new CookieJar(() => now);
  jar.store(
    [
      'sid=abc; Path=/; HttpOnly',
      'pref=dark; Max-Age=60',
      'scoped=1; Path=/admin',
    ],
    '/login'
  );
  assert.equal(jar.header('/'), 'sid=abc; pref=dark');
  assert.equal(jar.header('/admin/users'), 'sid=abc; pref=dark; scoped=1');
  now += 61_000;
  assert.equal(jar.header('/'), 'sid=abc');
  jar.store(['sid=; Max-Age=0; Path=/'], '/logout');
  assert.equal(jar.header('/'), '');
});
