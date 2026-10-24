import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeskSessions } from '../backend/runtime/desk-sessions.cjs';
import { passwordChanges } from '../backend/runtime/http.cjs';
import { flush, MemoryRedis, TestSocket } from './fixtures.mjs';

async function fixture() {
  const redis = new MemoryRedis();
  const sockets = new Map();
  const users = { login: async ({ uuid, password }) => password === `pw-${uuid}` ? { uuid } : null };
  const sessions = createDeskSessions({ io: { of: () => ({ sockets }) }, redis, users,
    prefixes: { deskUserUuid: 'desk:' } });
  async function socket(id, device) {
    const peer = new TestSocket(id);
    sockets.set(id, peer);
    sessions.attach(peer);
    if (device) await peer.receive('billdDeskJoin', { deskUserUuid: device, deskUserPassword: `pw-${device}`, live_room_id: 'target01' });
    return peer;
  }
  const host = await socket('host-socket', 'target01');
  const phone = await socket('phone-socket', 'phone001');
  const outsider = await socket('outsider-socket', 'stranger');
  const start = {
    deskUserUuid: 'phone001', deskUserPassword: 'pw-phone001', remoteDeskUserUuid: 'target01',
    remoteDeskUserPassword: 'pw-target01', roomId: 'target01', sender: 'forged-sender', receiver: 'outsider-socket',
  };
  return { redis, sessions, socket, host, phone, outsider, start };
}

test('join authenticates devices and heartbeat cannot impersonate another device', async () => {
  const { socket, redis, phone } = await fixture();
  const attacker = await socket('attacker-socket');
  await attacker.receive('billdDeskJoin', { deskUserUuid: 'target01', deskUserPassword: 'wrong', live_room_id: 'target01' });
  assert.ok(attacker.last('billdDeskSessionError'));
  assert.equal(attacker.last('billdDeskJoined'), undefined);
  await phone.receive('billdDeskUpdateUser', { deskUserUuid: 'target01', deskUserPassword: 'fake' });
  assert.equal(JSON.parse(await redis.get('desk:target01')).value.socket_id, 'host-socket');
  assert.ok(!JSON.stringify([...redis.rows.values()]).includes('pw-'));
});

test('successful sessions are private, password-free and bound to actual sockets', async () => {
  const { sessions, host, phone, outsider, start } = await fixture();
  await phone.receive('billdDeskStartRemote', { ...start, remoteDeskUserPassword: 'wrong' });
  assert.equal(phone.last('billdDeskStartRemoteResult').code, 3);
  assert.equal(host.last('billdDeskStartRemoteResult'), undefined);
  await phone.receive('billdDeskStartRemote', start);
  const a = host.last('billdDeskStartRemoteResult');
  const b = phone.last('billdDeskStartRemoteResult');
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  assert.equal(a.data.sender, phone.id);
  assert.equal(a.data.receiver, host.id);
  assert.equal(outsider.last('billdDeskStartRemoteResult'), undefined);
  assert.notEqual(a.session.token, b.session.token);
  assert.equal(a.session.offerer, true);
  assert.equal(b.session.offerer, false);
  assert.ok(!JSON.stringify(a).includes('pw-'));
  assert.equal((await sessions.authorize(a.session.token)).socketId, host.id);
  assert.equal((await sessions.authorize(b.session.token)).socketId, phone.id);
  await assert.rejects(sessions.authorize('unknown-token'), { status: 401 });
  await phone.receive('billdDeskStartRemote', start);
  assert.equal(phone.last('billdDeskStartRemoteResult').session.id, b.session.id);
});

test('signaling cannot cross sessions, spoof senders or start simultaneous offers', async () => {
  const { host, phone, outsider, start } = await fixture();
  await phone.receive('billdDeskStartRemote', start);
  const id = phone.last('billdDeskStartRemoteResult').session.id;
  await outsider.receive('nativeWebRtcOffer', { receiver: phone.id, sessionId: id, sdp: { type: 'offer' } });
  assert.equal(phone.last('nativeWebRtcOffer'), undefined);
  await phone.receive('nativeWebRtcOffer', { receiver: host.id, sessionId: id, sdp: { type: 'offer' } });
  assert.equal(host.last('nativeWebRtcOffer'), undefined);
  await host.receive('nativeWebRtcOffer', { sender: outsider.id, receiver: phone.id, sessionId: id, sdp: { type: 'offer', sdp: 'test' } });
  assert.equal(phone.last('nativeWebRtcOffer').sender, host.id);
  assert.equal(phone.last('nativeWebRtcOffer').sessionId, id);
  await host.receive('nativeWebRtcCandidate', { receiver: phone.id, sessionId: 'old-session', candidate: {} });
  assert.equal(phone.last('nativeWebRtcCandidate'), undefined);
  await phone.receive('nativeWebRtcRestart', { receiver: host.id, sessionId: id });
  assert.equal(host.last('nativeWebRtcRestart').sender, phone.id);
});

test('ending or disconnecting a session invalidates both access tokens immediately', async () => {
  for (const disconnect of [false, true]) {
    const { sessions, host, phone, outsider, start } = await fixture();
    await phone.receive('billdDeskStartRemote', start);
    const a = host.last('billdDeskStartRemoteResult').session;
    const b = phone.last('billdDeskStartRemoteResult').session;
    await outsider.receive('billdDeskEndRemote', { receiver: host.id, sessionId: a.id });
    await sessions.authorize(a.token);
    if (disconnect) await phone.disconnect();
    else await phone.receive('billdDeskEndRemote', { receiver: host.id, sessionId: a.id });
    for (const token of [a.token, b.token]) await assert.rejects(sessions.authorize(token), { status: 401 });
    assert.equal(host.last('billdDeskSessionEnded').sessionId, a.id);
    assert.equal(
      host.last('billdDeskSessionEnded').reason,
      disconnect ? 'disconnect' : 'explicit'
    );
  }
});

test('a password change ends every session of that device and invalidates its tokens', async () => {
  const { sessions, socket, host, phone, start } = await fixture();
  const tablet = await socket('tablet-socket', 'tablet01');
  const other = await socket('other-socket', 'other001');
  const laptop = await socket('laptop-socket');
  await phone.receive('billdDeskStartRemote', start);
  await tablet.receive('billdDeskStartRemote', {
    ...start, deskUserUuid: 'tablet01', deskUserPassword: 'pw-tablet01',
  });
  await laptop.receive('billdDeskJoin', { deskUserUuid: 'laptop01', deskUserPassword: 'pw-laptop01', live_room_id: 'other001' });
  await laptop.receive('billdDeskStartRemote', {
    deskUserUuid: 'laptop01', deskUserPassword: 'pw-laptop01', remoteDeskUserUuid: 'other001',
    remoteDeskUserPassword: 'pw-other001', roomId: 'other001',
  });
  const tokens = [phone, tablet].map((peer) => peer.last('billdDeskStartRemoteResult').session.token);
  const unrelated = laptop.last('billdDeskStartRemoteResult').session.token;
  assert.equal(await sessions.endDevice('target01', 'password-changed'), 2);
  for (const peer of [phone, tablet]) assert.equal(peer.last('billdDeskSessionEnded').reason, 'password-changed');
  assert.equal(host.sent.filter((message) => message.event === 'billdDeskSessionEnded').length, 2);
  for (const token of tokens) await assert.rejects(sessions.authorize(token), { status: 401 });
  assert.equal((await sessions.authorize(unrelated)).device, 'laptop01');
  assert.equal(other.last('billdDeskSessionEnded'), undefined);
});

test('a password change also rejects a session that was still being published', async () => {
  for (const [device, code] of [['target01', 3], ['phone001', 1]]) {
    const { redis, sessions, host, phone, start } = await fixture();
    // Hold the token writes: both passwords are checked, the session is not yet active.
    let release;
    let reached = false;
    const held = new Promise((resolve) => { release = resolve; });
    const set = redis.set.bind(redis);
    redis.set = async (key, ...rest) => {
      if (key.startsWith('palmdesk:session:')) {
        reached = true;
        await held;
      }
      return set(key, ...rest);
    };
    await phone.receive('billdDeskStartRemote', start);
    assert.equal(reached, true);
    const ctx = { method: 'PUT', path: '/desk_user/update_by_uuid', request: { body: { uuid: device, new_password: 'new' } } };
    await passwordChanges(sessions)(ctx, async () => {
      ctx.status = 200;
      ctx.body = { code: 200 };
    });
    release();
    await flush();
    const result = phone.last('billdDeskStartRemoteResult');
    assert.equal(result.code, code, device);
    assert.equal(result.session, undefined);
    assert.equal(host.last('billdDeskStartRemoteResult'), undefined);
    assert.ok(![...redis.rows.keys()].some((key) => key.startsWith('palmdesk:session:')));
    // A request checked after the change still connects.
    redis.set = set;
    await phone.receive('billdDeskStartRemote', start);
    const fresh = phone.last('billdDeskStartRemoteResult');
    assert.equal(fresh.code, 0);
    assert.equal((await sessions.authorize(fresh.session.token)).device, 'phone001');
  }
});

test('only a successful password update ends sessions', async () => {
  const ended = [];
  const middleware = passwordChanges({ endDevice: async (device, reason) => ended.push([device, reason]) });
  const request = (overrides = {}, body = { uuid: 'target01', password: 'old', new_password: 'new' }) => ({
    method: 'PUT', path: '/desk_user/update_by_uuid', request: { body }, status: 404, body: undefined, ...overrides,
  });
  const succeed = (ctx) => async () => {
    ctx.status = 200;
    ctx.body = { code: 200 };
  };
  for (const ctx of [request(), request({ path: '/DESK_USER/update_by_uuid/' })]) {
    await middleware(ctx, succeed(ctx));
  }
  assert.deepEqual(ended, [['target01', 'password-changed'], ['target01', 'password-changed']]);
  ended.length = 0;
  await assert.rejects(middleware(request(), async () => { throw new Error('旧密码错误！'); }), /旧密码/);
  for (const ctx of [
    request({ method: 'POST' }),
    request({ path: '/desk_user/login' }),
    request({}, { uuid: 'target01', status: 2 }),
  ]) {
    await middleware(ctx, succeed(ctx));
  }
  const failed = request();
  await middleware(failed, async () => {
    failed.status = 400;
    failed.body = { code: 400 };
  });
  assert.deepEqual(ended, []);
});
