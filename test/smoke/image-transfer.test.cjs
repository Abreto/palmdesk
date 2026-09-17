const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-source.cjs');
const { ImageTransferClient, ImageTransferHost } = load(
  'src/utils/image-transfer-channel.ts'
);
const { inspectImage, validateImage, MAX_IMAGE_BYTES } = load(
  'src/utils/image-payload.ts'
);
const png = new Uint8Array(
  fs.readFileSync(path.join(__dirname, '../../src/assets/img/logo.png'))
);
const image = (bytes = png) => ({ mime: 'image/png', bytes });
const tick = () => new Promise((resolve) => setImmediate(resolve));

class Channel extends EventTarget {
  readyState = 'open';
  bufferedAmount = 0;
  sent = [];
  send(data) {
    assert.equal(this.readyState, 'open');
    this.sent.push(data);
    if (!this.drop)
      queueMicrotask(() =>
        this.target.dispatchEvent(new MessageEvent('message', { data }))
      );
  }
  close() {
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }
}
function connection(
  t,
  paste,
  allowed = (id) => id === 'selected-session',
  cancel = () => {},
  timeout = 1000,
  commit
) {
  const phone = new Channel();
  const desktop = new Channel();
  phone.target = desktop;
  desktop.target = phone;
  const host = new ImageTransferHost(desktop, allowed, paste, cancel, timeout);
  const client = new ImageTransferClient(
    phone,
    commit || ((sessionId, id) => host.commit(sessionId, id)),
    timeout
  );
  t.after(() => {
    client.dispose();
    host.dispose();
  });
  return { phone, desktop, client, host };
}

test('PNG and JPEG dimensions are detected from bytes, independent of filenames', () => {
  assert.equal(inspectImage(png).mime, 'image/png');
  const jpeg = new Uint8Array(
    fs.readFileSync(path.join(__dirname, '../../src/assets/img/billd.jpg'))
  );
  assert.equal(inspectImage(jpeg).mime, 'image/jpeg');
  assert.throws(
    () => validateImage({ mime: 'image/jpeg', bytes: png }),
    /不符/
  );
  assert.throws(() => inspectImage(new Uint8Array([1, 2, 3])), /PNG/);
  assert.throws(
    () => inspectImage(new Uint8Array([255, 216, 255, 192, 255, 255])),
    /无法读取/
  );
  assert.throws(
    () => inspectImage(new Uint8Array(MAX_IMAGE_BYTES + 1)),
    /10 MB/
  );
  const huge = png.slice();
  new DataView(huge.buffer).setUint32(16, 100000);
  assert.throws(() => inspectImage(huge), /尺寸过大/);
});

test('image transfer reconstructs bytes across bounded binary chunks and waits for paste acknowledgement', async (t) => {
  const bytes = new Uint8Array(200000);
  bytes.set(png);
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  let received;
  const h = connection(t, async (sessionId, id, payload) => {
    assert.equal(sessionId, 'selected-session');
    received = payload;
    await wait;
  });
  const progress = [];
  let completed = false;
  const pending = h.client
    .paste(image(bytes), 'selected-session', (value) => progress.push(value))
    .then(() => {
      completed = true;
    });
  await tick();
  assert.deepEqual(received.bytes, bytes);
  assert.equal(completed, false);
  assert.equal(progress.at(-1), 99);
  const chunks = h.phone.sent.filter((data) => data instanceof ArrayBuffer);
  assert.ok(chunks.length > 10);
  assert.ok(chunks.every((chunk) => chunk.byteLength <= 16384));
  release();
  await pending;
  assert.equal(progress.at(-1), 100);
});

test('a stale or unauthorized session never reaches desktop paste', async (t) => {
  const h = connection(t, () => assert.fail('unauthorized paste'));
  await assert.rejects(
    h.client.paste(image(), 'old-session', () => {}),
    /会话已结束/
  );
  assert.equal(
    h.phone.sent.filter((value) => value instanceof ArrayBuffer).length,
    0
  );
});

test('backpressure pauses binary transmission and cancellation prevents later paste', async (t) => {
  const h = connection(t, () => assert.fail('cancelled paste'));
  h.phone.bufferedAmount = 100000;
  const pending = h.client.paste(image(), 'selected-session', () => {});
  const rejected = assert.rejects(pending, /取消/);
  await tick();
  assert.equal(
    h.phone.sent.filter((value) => value instanceof ArrayBuffer).length,
    0
  );
  h.client.cancel();
  h.phone.bufferedAmount = 0;
  await rejected;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    h.phone.sent.filter((value) => value instanceof ArrayBuffer).length,
    0
  );
});

test('window invalidation during upload rejects remaining data', async (t) => {
  let allowed = true;
  const h = connection(
    t,
    () => assert.fail('stale window'),
    () => allowed
  );
  h.phone.bufferedAmount = 100000;
  const pending = h.client.paste(image(), 'selected-session', () => {});
  const rejected = assert.rejects(pending, /会话已结束/);
  await tick();
  allowed = false;
  h.phone.bufferedAmount = 0;
  await rejected;
});

test('duplicate finish and start messages cannot paste an image twice', async (t) => {
  let calls = 0;
  const h = connection(t, async () => {
    calls += 1;
  });
  await h.client.paste(image(), 'selected-session', () => {});
  h.phone.sent
    .slice()
    .forEach((frame) =>
      h.desktop.dispatchEvent(new MessageEvent('message', { data: frame }))
    );
  await tick();
  assert.equal(calls, 1);
});

test('truncated images and oversized declarations fail before invoking desktop paste', async (t) => {
  const h = connection(t, () => assert.fail('invalid data'));
  const frame = (data) =>
    h.desktop.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(data) })
    );
  frame({
    type: 'start',
    id: 1,
    sessionId: 'selected-session',
    mime: 'image/png',
    size: MAX_IMAGE_BYTES + 1,
  });
  assert.match(JSON.parse(h.desktop.sent.at(-1)).message, /10 MB/);
  frame({
    type: 'start',
    id: 2,
    sessionId: 'selected-session',
    mime: 'image/png',
    size: png.length,
  });
  frame({ type: 'finish', id: 2 });
  assert.match(JSON.parse(h.desktop.sent.at(-1)).message, /不完整/);
});

test('closing the channel cancels queued desktop work and reports an unconfirmed paste', async (t) => {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  let cancelled = 0;
  const h = connection(
    t,
    () => wait,
    () => true,
    () => {
      cancelled += 1;
    }
  );
  const pending = h.client.paste(image(), 'selected-session', () => {});
  const rejected = assert.rejects(pending, /结果未确认/);
  await tick();
  h.phone.close();
  h.desktop.close();
  release();
  await rejected;
  assert.equal(cancelled, 1);
});

test('lost acknowledgement times out without automatically repeating the paste', async (t) => {
  let calls = 0;
  const h = connection(
    t,
    async () => {
      calls += 1;
      h.desktop.drop = true;
    },
    () => true,
    () => {},
    30
  );
  await assert.rejects(
    h.client.paste(image(), 'selected-session', () => {}),
    /结果未确认/
  );
  assert.equal(calls, 1);
});

test('a completed upload waits for an input-channel commit and ignores stale or duplicate commits', async (t) => {
  let commit;
  let calls = 0;
  const h = connection(
    t,
    async () => {
      calls += 1;
    },
    undefined,
    undefined,
    undefined,
    (sessionId, id) => {
      commit = { sessionId, id };
    }
  );
  const pending = h.client.paste(image(), 'selected-session', () => {});
  await tick();
  assert.ok(commit);
  assert.equal(calls, 0, 'finish on the image channel must never paste');
  h.host.commit('old-session', commit.id);
  h.host.commit(commit.sessionId, commit.id + 1);
  assert.equal(calls, 0);
  h.host.commit(commit.sessionId, commit.id);
  h.host.commit(commit.sessionId, commit.id);
  await pending;
  h.host.commit(commit.sessionId, commit.id);
  assert.equal(calls, 1);
});

test('cancellation and session invalidation discard an upload before a delayed commit arrives', async (t) => {
  for (const invalidate of [false, true]) {
    let commit;
    let allowed = true;
    const h = connection(
      t,
      () => assert.fail('stale commit pasted'),
      () => allowed,
      undefined,
      undefined,
      (sessionId, id) => {
        commit = { sessionId, id };
      }
    );
    const pending = h.client.paste(image(), 'selected-session', () => {});
    const rejected = assert.rejects(pending, /取消|会话已结束/);
    await tick();
    if (invalidate) allowed = false;
    else h.client.cancel();
    await tick();
    h.host.commit(commit.sessionId, commit.id);
    await rejected;
  }
});

test('a paste commit queues behind a delayed click even when the image has already arrived', async (t) => {
  const { CaptureSession } = load('electron-main/capture-session.ts');
  const source = {
    id: 'window:10:0',
    captureId: 'window:10:0',
    nativeId: 10,
    ownerPid: 42,
    bundleId: 'com.openai.codex',
    isOnScreen: true,
    boundsSource: 'window',
    bounds: { x: 0, y: 0, width: 500, height: 500 },
  };
  const events = [];
  let releaseClick;
  const clickWait = new Promise((resolve) => {
    releaseClick = resolve;
  });
  const session = new CaptureSession(
    {
      position: async () => {},
      click: async () => {
        await clickWait;
        events.push('click');
      },
      canPasteImage: () => true,
      pasteImage: async () => {
        events.push('image');
      },
    },
    async () => [source],
    async (value) => value
  );
  const { sessionId } = await session.begin(source.id);
  let commit;
  const h = connection(
    t,
    (sid, id, payload) => session.pasteImage(sid, id, payload),
    (sid) => sid === sessionId,
    (sid, id) => session.cancelImagePaste(sid, id),
    undefined,
    (sid, id) => {
      commit = { sid, id };
    }
  );
  const pending = h.client.paste(image(), sessionId, () => {});
  await tick();
  assert.deepEqual(events, []);
  // Deliver the held input channel in order: the earlier click, then commit.
  const click = session.input(sessionId, { action: 'click', x: 500, y: 900 });
  h.host.commit(commit.sid, commit.id);
  await tick();
  assert.deepEqual(events, []);
  releaseClick();
  await Promise.all([click, pending]);
  assert.deepEqual(events, ['click', 'image']);
});
