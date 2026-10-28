// The gateway driven directly with frames a hostile or broken phone could
// send, against local upstream servers.
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { binaryFrame, KIND, PreviewGateway } from './gateway.mjs';

async function upstream(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function stop(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

// A verified controller's gateway, recording what it sends back.
function connect(server, options = {}) {
  const sent = { controls: [], bytes: 0 };
  const gateway = new PreviewGateway({
    targets: [{ id: 'up', port: server.address().port }],
    verified: true,
    send: (data) => {
      sent.bytes += data.length;
      if (typeof data === 'string') sent.controls.push(JSON.parse(data));
    },
    ...options,
  });
  gateway.receive(JSON.stringify({ t: 'hello', v: 1, frame: 65536 }));
  return { gateway, sent };
}

const request = (id, extra = {}) =>
  JSON.stringify({
    t: 'req',
    id,
    target: 'up',
    method: 'GET',
    path: '/',
    headers: [],
    body: 0,
    ...extra,
  });

// The message that ended stream `id`, if one arrives in time.
async function ending(sent, id, timeout = 3000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const found = sent.controls.find(
      (message) =>
        message.id === id &&
        ['end', 'fail', 'ws-fail', 'ws-closed'].includes(message.t)
    );
    if (found || Date.now() > deadline) return found;
    await delay(10);
  }
}

test('frames that Node would reject are refused without throwing', async () => {
  const server = await upstream((req, res) => res.end('ok'));
  const { gateway, sent } = connect(server);
  // A previewed page can send these with fetch(); Node's HTTP client throws
  // on all three.
  [1, 0x7f, 0x20ac].forEach((code, index) => {
    const value = `a${String.fromCharCode(code)}b`;
    assert.doesNotThrow(() =>
      gateway.receive(request(index + 1, { headers: [['x-a', value]] }))
    );
  });
  assert.doesNotThrow(() =>
    gateway.receive(
      JSON.stringify({
        t: 'ws-open',
        id: 9,
        target: 'up',
        path: '/',
        protocols: ['vite-hmr', 'vite-hmr'],
      })
    )
  );
  for (const id of [1, 2, 3])
    assert.equal((await ending(sent, id))?.code, 'bad-header');
  assert.deepEqual(await ending(sent, 9), {
    t: 'ws-fail',
    id: 9,
    code: 'bad-protocol',
  });
  assert.equal(gateway.streams.size + gateway.sockets.size, 0);
  gateway.receive(request(10));
  assert.equal((await ending(sent, 10))?.t, 'end');
  gateway.close();
  await stop(server);
});

test('host memory stays bounded when the phone fakes credits', async () => {
  let produced = 0;
  const chunk = Buffer.alloc(64 * 1024, 7);
  const server = await upstream((req, res) => {
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    const pump = () => {
      while (!closed && produced < 1024 * 1024 * 1024) {
        produced += chunk.length;
        if (!res.write(chunk)) {
          res.once('drain', pump);
          return;
        }
      }
      if (!closed) res.end();
    };
    pump();
  });
  const limit = 1024 * 1024;
  // One upstream read past the limit, split into frames, plus small frames.
  const slack = 256 * 1024;
  const { gateway, sent } = connect(server, { hostBufferBytes: limit });
  gateway.receive(request(1));
  const spoof = setInterval(() => {
    gateway.receive(
      JSON.stringify({ t: 'credit', id: 1, bytes: Number.MAX_SAFE_INTEGER })
    );
  }, 1);
  await delay(1000);
  // The host page never moved anything into a DataChannel.
  assert.ok(sent.bytes <= limit + slack, `${sent.bytes} bytes queued`);
  // Each drain lets about one buffer's worth more through, no more.
  for (let round = 0; round < 20; round += 1) {
    gateway.drained(gateway.unsent);
    await delay(20);
    assert.ok(gateway.unsent <= limit + slack, `backlog ${gateway.unsent}`);
  }
  assert.ok(sent.bytes > 4 * limit, `only ${sent.bytes} bytes after draining`);
  clearInterval(spoof);
  gateway.close();
  await stop(server);
});

test('a request body that stops arriving times out and frees its slot', async () => {
  const server = await upstream((req, res) => {
    req.resume();
    req.on('end', () => res.end('ok'));
  });
  const { gateway, sent } = connect(server, {
    timeouts: { bodyIdle: 100, body: 1000 },
  });
  // Every stream slot holds a body one byte short of what it declared.
  for (let id = 1; id <= 64; id += 1) {
    gateway.receive(request(id, { method: 'POST', body: 10 }));
    gateway.receive(binaryFrame(KIND.request, id, Buffer.alloc(9)));
  }
  gateway.receive(request(100));
  assert.equal((await ending(sent, 100))?.code, 'busy');
  for (let id = 1; id <= 64; id += 1)
    assert.equal((await ending(sent, id))?.code, 'timeout');
  assert.equal(gateway.streams.size, 0);
  assert.equal(gateway.pendingBody, 0);
  gateway.receive(request(101));
  assert.equal((await ending(sent, 101))?.t, 'end');
  gateway.close();
  await stop(server);
});

test('incomplete request bodies are capped across streams', async () => {
  const server = await upstream((req, res) => res.end('ok'));
  const { gateway, sent } = connect(server);
  const declared = 8 * 1024 * 1024;
  gateway.receive(request(1, { method: 'POST', body: declared }));
  gateway.receive(request(2, { method: 'POST', body: declared }));
  gateway.receive(request(3, { method: 'POST', body: 1 }));
  assert.equal((await ending(sent, 3))?.code, 'busy');
  gateway.close();
  assert.equal(gateway.pendingBody, 0);
  await stop(server);
});
