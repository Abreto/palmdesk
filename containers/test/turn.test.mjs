import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createTurnService, iceRoute, readTurnConfig, rateLimit } from '../backend/runtime/turn.cjs';
import { MemoryRedis } from './fixtures.mjs';

const cloudflare = () => readTurnConfig({
  TURN_PROVIDER: 'cloudflare', CLOUDFLARE_TURN_KEY_ID: 'key-id',
  CLOUDFLARE_TURN_API_TOKEN: 'server-only-secret', TURN_HOSTNAME: 'turn.abreto.icu',
});
const upstream = () => ({ iceServers: [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
  { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp',
    'turn:turn.cloudflare.com:3478?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp'],
  username: 'temporary-user', credential: 'temporary-password' },
] });
const member = { id: 'session', socketId: 'socket', device: 'device' };

test('TURN configuration validates providers, secrets, hostnames, TTL and coturn URLs', () => {
  assert.equal(readTurnConfig({}).provider, 'none');
  for (const values of [
    { TURN_PROVIDER: 'invalid' }, { TURN_PROVIDER: 'cloudflare' }, { TURN_CREDENTIAL_TTL: '599' },
    { TURN_CREDENTIAL_TTL: '172801' }, { TURN_CREDENTIAL_TTL: 'NaN' }, { TURN_HOSTNAME: 'a/b' },
    { TURN_PROVIDER: 'coturn', COTURN_AUTH_SECRET: 'x'.repeat(32), COTURN_URLS: 'https://turn.test' },
    { TURN_PROVIDER: 'coturn', COTURN_AUTH_SECRET: 'x'.repeat(32), COTURN_URLS: 'turn:user:pass@turn.test:3478' },
  ]) assert.throws(() => readTurnConfig(values));
});

test('Cloudflare issuance is server-side, filters port 53 and keeps the TLS hostname', async () => {
  const redis = new MemoryRedis();
  const service = createTurnService({ config: cloudflare(), redis, now: () => 1000000,
    fetch: async (url, options) => {
      assert.equal(url, 'https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer server-only-secret');
      assert.deepEqual(JSON.parse(options.body), { ttl: 3600 });
      assert.ok(options.signal instanceof AbortSignal);
      return { status: 201, json: async () => upstream() };
    },
  });
  const result = await service.get(member);
  assert.equal(result.expiresAt, 4600000);
  assert.equal(result.refreshAfter, 4300000);
  assert.deepEqual(result.iceServers[1].urls, [
    'turn:turn.abreto.icu:3478?transport=udp', 'turn:turn.abreto.icu:3478?transport=tcp',
    'turns:turn.cloudflare.com:443?transport=tcp',
  ]);
  assert.deepEqual(result.iceServers[0].urls, ['stun:turn.abreto.icu:3478']);
  assert.ok(!JSON.stringify(result).includes('server-only-secret'));
});

test('concurrent requests coalesce per participant and cached expiry never slides', async () => {
  let calls = 0;
  let now = 1000000;
  const service = createTurnService({ config: cloudflare(), redis: new MemoryRedis(), now: () => now,
    fetch: async () => { calls++; return { status: 201, json: async () => upstream() }; },
  });
  const results = await Promise.all(Array.from({ length: 10 }, () => service.get(member)));
  assert.equal(calls, 1);
  now += 1000000;
  assert.equal((await service.get(member)).expiresAt, results[0].expiresAt);
  await service.get({ ...member, socketId: 'other-socket' });
  assert.equal(calls, 2);
  now = results[0].refreshAfter;
  assert.ok((await service.get(member)).expiresAt > results[0].expiresAt);
  assert.equal(calls, 3);
});

test('upstream failures retain only unexpired credentials and never expose upstream details', async () => {
  let now = 1000000;
  let broken = false;
  const service = createTurnService({ config: cloudflare(), redis: new MemoryRedis(), now: () => now,
    fetch: async () => {
      if (broken) throw new Error('Authorization: Bearer sensitive-token');
      return { status: 201, json: async () => upstream() };
    },
  });
  const original = await service.get(member);
  broken = true;
  now = original.refreshAfter;
  const retained = await service.get(member);
  assert.equal(retained.expiresAt, original.expiresAt);
  assert.equal(retained.refreshAfter, now + 15000);
  now = original.expiresAt;
  await assert.rejects(service.get(member), (error) => error.status === 503 && !error.message.includes('sensitive-token'));
});

test('non-201, malformed and unexpected-host Cloudflare responses fail closed', async () => {
  for (const response of [
    { status: 403 },
    { status: 201, json: async () => ({ iceServers: [] }) },
    { status: 201, json: async () => ({ iceServers: [{ urls: ['turn:evil.test:3478'], username: 'u', credential: 'p' }] }) },
    { status: 201, json: async () => ({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'] }] }) },
  ]) {
    const service = createTurnService({ config: cloudflare(), redis: new MemoryRedis(), fetch: async () => response });
    await assert.rejects(service.get(member), { status: 503 });
  }
});

test('coturn uses expiring HMAC credentials with a distinct username per participant', async () => {
  const secret = 'x'.repeat(32);
  const config = readTurnConfig({ TURN_PROVIDER: 'coturn', COTURN_AUTH_SECRET: secret,
    COTURN_URLS: 'turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp' });
  const service = createTurnService({ config, redis: new MemoryRedis(), now: () => 1000000 });
  const a = (await service.get(member)).iceServers[0];
  const b = (await service.get({ ...member, socketId: 'b' })).iceServers[0];
  assert.ok(a.username.startsWith('4600:'));
  assert.notEqual(a.username, b.username);
  assert.equal(a.credential, createHmac('sha1', secret).update(a.username).digest('base64'));
});

test('rate limits expire and cannot be extended by a client-supplied TTL', async () => {
  const redis = new MemoryRedis();
  await rateLimit(redis, 'test', 'device', 1);
  await assert.rejects(rateLimit(redis, 'test', 'device', 1), { status: 429 });
  redis.clock = 61000;
  await rateLimit(redis, 'test', 'device', 1);
});

test('credential HTTP route requires a live bearer session before and after issuance', async () => {
  const redis = new MemoryRedis();
  let live = true;
  let calls = 0;
  const token = 'a'.repeat(43);
  const ctx = (auth) => ({ path: '/webrtc/ice-servers', method: 'POST', ip: 'client-ip',
    request: { body: { ttl: 99999999 } }, set() {}, get: () => auth });
  const route = iceRoute({ redis, sessions: { authorize: async (value) => {
    assert.equal(value, token);
    if (!live) throw Object.assign(new Error('ended'), { status: 401 });
    return member;
  } }, turn: { get: async () => { calls++; live = false; return {}; } } });
  await assert.rejects(route(ctx(''), () => {}), { status: 401 });
  assert.equal(calls, 0);
  const request = ctx(`Bearer ${token}`);
  await assert.rejects(route(request, () => {}), { status: 401 });
  assert.equal(calls, 1);
  assert.equal(request.body, undefined);
});
