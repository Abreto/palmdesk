import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig, isAllowedOrigin } from '../backend/runtime/config.cjs';
import { initializeDatabase } from '../backend/runtime/init.cjs';
import { cors, errors, engineCors, deskPackets } from '../backend/runtime/http.cjs';

const valid = () => ({
  PUBLIC_ORIGIN: 'https://remote.example.com',
  MYSQL_DATABASE: 'palmdesk', MYSQL_USER: 'palmdesk',
  MYSQL_PASSWORD: 'a'.repeat(64), REDIS_PASSWORD: 'b'.repeat(64), JWT_SECRET: 'c'.repeat(64),
});

test('configuration rejects missing secrets, non-HTTPS public origins and unsafe database users', () => {
  for (const patch of [
    { MYSQL_PASSWORD: '' }, { REDIS_PASSWORD: 'change-me' }, { JWT_SECRET: '$'.repeat(64) },
    { PUBLIC_ORIGIN: 'http://remote.example.com' }, { PUBLIC_ORIGIN: 'https://remote.example.com/api' },
    { PUBLIC_ORIGIN: 'https://user:password@remote.example.com' }, { MYSQL_USER: 'root' },
    { ALLOW_ELECTRON_ORIGIN: 'yes' }, { MYSQL_PORT: '0' },
  ]) assert.throws(() => readConfig({ ...valid(), ...patch }));
});

test('origin policy permits the configured web and Electron, and rejects suffix spoofing', () => {
  const config = readConfig({ ...valid(), EXTRA_ALLOWED_ORIGINS: 'http://localhost:5173' });
  for (const origin of ['https://remote.example.com', 'null', undefined, '', 'http://localhost:5173']) assert.equal(isAllowedOrigin(origin, config), true);
  for (const origin of ['https://remote.example.com.evil.test', 'https://evil.test', 'http://remote.example.com']) assert.equal(isAllowedOrigin(origin, config), false);
  assert.equal(isAllowedOrigin('null', readConfig({ ...valid(), ALLOW_ELECTRON_ORIGIN: 'false' })), false);
});

test('repeated initialization preserves existing tables and customized configuration', async () => {
  const rows = new Map([['frontend_live_home_bg', { key: 'frontend_live_home_bg', value: 'custom.jpg' }]]);
  let connections = 0;
  let syncs = 0;
  const dependencies = {
    connectMysql: async (...args) => { assert.deepEqual(args, []); connections++; },
    sequelize: { sync: async (...args) => { assert.deepEqual(args, []); syncs++; } },
    liveConfig: { findOrCreate: async ({ where, defaults, paranoid }) => {
      assert.equal(paranoid, false);
      if (!rows.has(where.key)) rows.set(where.key, { ...defaults });
    } },
  };
  await initializeDatabase(dependencies);
  await initializeDatabase(dependencies);
  assert.equal(connections, 2);
  assert.equal(syncs, 2);
  assert.equal(rows.size, 2);
  assert.equal(rows.get('frontend_live_home_bg').value, 'custom.jpg');
});

test('failed initialization propagates without continuing to seed data', async () => {
  await assert.rejects(initializeDatabase({
    connectMysql: async () => {},
    sequelize: { sync: async () => { throw new Error('database unavailable'); } },
    liveConfig: { findOrCreate: () => assert.fail('must not seed after a failed sync') },
  }), /database unavailable/);
});

test('API preflight handles Electron without allowing arbitrary browser origins', async () => {
  for (const [origin, status] of [['null', 204], ['https://evil.test', 403]]) {
    const headers = {};
    const ctx = { method: 'OPTIONS', get: () => origin, vary: () => {}, set: (key, value) => { headers[key] = value; } };
    await cors(readConfig(valid()))(ctx, () => assert.fail('preflight must not reach routes'));
    assert.equal(ctx.status, status);
    assert.equal(headers['Access-Control-Allow-Origin'], status === 204 ? origin : undefined);
  }
});

test('WebSocket upgrade applies the same origin policy', () => {
  const response = { setHeader: () => {} };
  let calls = 0;
  engineCors(readConfig(valid()))({ headers: { origin: 'null' }, method: 'GET' }, response, (error) => { assert.equal(error, undefined); calls++; });
  engineCors(readConfig(valid()))({ headers: { origin: 'https://evil.test' }, method: 'GET' }, response, (error) => { assert.ok(error); calls++; });
  assert.equal(calls, 2);
});

test('deployment excludes legacy live events while preserving desk signaling', () => {
  let middleware;
  let disconnected = false;
  deskPackets({ use: (callback) => { middleware = callback; }, disconnect: () => { disconnected = true; } }, () => {});
  let delivered = false;
  middleware(['nativeWebRtcOffer', { data: { sdp: 'offer' } }], () => { delivered = true; });
  assert.equal(delivered, true);
  middleware(['msrBlob', { data: {} }], () => assert.fail('legacy event must be blocked'));
  assert.equal(disconnected, true);
});

test('API retains application errors and does not expose internal error details', async () => {
  const ctx = { set: () => {}, method: 'POST', path: '/desk_user/login' };
  await errors(ctx, async () => { throw Object.assign(new Error('Incorrect password'), { httpStatusCode: 400, errorCode: 400 }); });
  assert.equal(ctx.status, 400);
  assert.equal(ctx.body.message, 'Incorrect password');
  await errors(ctx, async () => { throw new Error('sensitive SQL content'); });
  assert.equal(ctx.status, 500);
  assert.equal(ctx.body.message, 'Internal server error');
});
