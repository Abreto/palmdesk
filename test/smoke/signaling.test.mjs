import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { io } from 'socket.io-client';

const endpoint = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:4300';

async function api(path, body) {
  const response = await fetch(`${endpoint}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, ...(await response.json()) };
}

function next(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, receive);
      reject(new Error(`Timed out waiting for ${event}`));
    }, 5000);
    function receive(value) {
      clearTimeout(timer);
      resolve(value);
    }
    socket.once(event, receive);
  });
}

function send(socket, event, data) {
  socket.emit(event, {
    request_id: randomUUID(),
    socket_id: socket.id,
    user_info: {},
    user_token: '',
    time: Date.now(),
    data,
  });
}

test('local backend registers devices, authenticates and relays WebRTC signaling', async (t) => {
  const target = (await api('/desk_user/create', {})).data;
  const controller = (await api('/desk_user/create', {})).data;
  assert.ok(target.uuid && target.password && controller.uuid);
  assert.notEqual(target.uuid, controller.uuid);
  assert.equal((await api('/desk_user/login', target)).code, 200);
  assert.equal(
    (await api('/desk_user/login', { ...target, password: 'wrong' })).status,
    400
  );
  assert.equal((await api('/desk_user/link_verify', target)).data.code, 1);
  assert.equal(
    (await api('/desk_user/link_verify', { ...target, password: 'wrong' })).data
      .code,
    2
  );

  const a = io(endpoint, {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
  });
  const b = io(endpoint, {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
  });
  t.after(() => {
    a.close();
    b.close();
  });
  const connected = Promise.all([next(a, 'connect'), next(b, 'connect')]);
  a.connect();
  b.connect();
  await connected;
  for (const [socket, device] of [
    [a, target],
    [b, controller],
  ]) {
    const joined = next(socket, 'billdDeskJoined');
    send(socket, 'billdDeskJoin', {
      live_room_id: target.uuid,
      deskUserUuid: device.uuid,
      deskUserPassword: device.password,
    });
    await joined;
  }
  assert.equal(
    (await api(`/desk_user/find_receiver_by_uuid?uuid=${target.uuid}`)).data
      .receiver,
    a.id
  );
  const connection = {
    roomId: target.uuid,
    sender: b.id,
    receiver: a.id,
    deskUserUuid: controller.uuid,
    deskUserPassword: controller.password,
    remoteDeskUserUuid: target.uuid,
    remoteDeskUserPassword: target.password,
    maxBitrate: 2000,
    maxFramerate: 30,
    resolutionRatio: 720,
    audioContentHint: '',
    videoContentHint: 'detail',
  };
  const denied = next(b, 'billdDeskStartRemoteResult');
  send(b, 'billdDeskStartRemote', {
    ...connection,
    remoteDeskUserPassword: 'wrong',
  });
  assert.equal((await denied).code, 3);
  const accepted = Promise.all([
    next(a, 'billdDeskStartRemoteResult'),
    next(b, 'billdDeskStartRemoteResult'),
  ]);
  send(b, 'billdDeskStartRemote', connection);
  for (const result of await accepted) assert.equal(result.code, 0);
  for (const [sender, receiver, event, value] of [
    [a, b, 'srsOffer', { sdp: { type: 'offer', sdp: 'smoke-offer' } }],
    [b, a, 'srsAnswer', { sdp: { type: 'answer', sdp: 'smoke-answer' } }],
    [a, b, 'srsCandidate', { candidate: { candidate: 'smoke-candidate' } }],
  ]) {
    const received = next(receiver, event);
    send(sender, event, {
      live_room_id: target.uuid,
      sender: sender.id,
      receiver: receiver.id,
      ...value,
    });
    const result = await received;
    assert.equal(result.sender, sender.id);
    assert.deepEqual(
      result.sdp || result.candidate,
      value.sdp || value.candidate
    );
  }
});
