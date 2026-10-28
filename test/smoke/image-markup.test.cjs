const assert = require('node:assert/strict');
const test = require('node:test');

const load = require('./load-source.cjs');

const {
  cropHandleAt,
  dragCrop,
  drawMark,
  exportMarkup,
  fullRect,
  replayMarkup,
  snapRect,
} = load('src/utils/image-markup.ts');
const { MAX_IMAGE_BYTES, fitsImageBounds, formatImageBytes } = load(
  'src/utils/image-payload.ts'
);

const size = { width: 400, height: 300 };
const crop = (x, y, width, height) => ({
  type: 'crop',
  rect: { x, y, width, height },
});
const pen = {
  type: 'mark',
  mark: {
    type: 'pen',
    color: '#ff3b30',
    width: 4,
    points: [
      { x: 20, y: 30 },
      { x: 40, y: 30 },
    ],
  },
};

// Records 2D context calls and property writes in order.
function recorder() {
  const calls = [];
  const context = new Proxy(
    {},
    {
      get:
        (_target, key) =>
        (...args) =>
          calls.push([key, ...args]),
      set: (_target, key, value) => {
        calls.push([`${key}=`, value]);
        return true;
      },
    }
  );
  return { calls, context };
}
function pngHeader(width, height, length = 33) {
  const bytes = new Uint8Array(length);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
function fakeCanvas({ blob, context = recorder().context } = {}) {
  const canvas = {
    width: 0,
    height: 0,
    encoded: [],
    getContext: () => context,
    toBlob(callback, type) {
      canvas.encoded.push({ type, width: canvas.width, height: canvas.height });
      setImmediate(() => callback(blob));
    },
  };
  return canvas;
}

test('markup steps replay crops and marks, and undo can restore a reset', () => {
  assert.deepEqual(replayMarkup([], size), {
    crop: fullRect(size),
    marks: [],
    edited: false,
  });
  const steps = [crop(10, 20, 100, 50), pen];
  assert.deepEqual(replayMarkup(steps, size), {
    crop: { x: 10, y: 20, width: 100, height: 50 },
    marks: [pen.mark],
    edited: true,
  });
  const reset = [...steps, { type: 'reset' }];
  assert.deepEqual(replayMarkup(reset, size), replayMarkup([], size));
  assert.deepEqual(
    replayMarkup(reset.slice(0, -1), size),
    replayMarkup(steps, size)
  );
  assert.equal(replayMarkup([pen], size).edited, true);
  // Cropping back to the whole image is not an edit: the original is pasted.
  assert.equal(
    replayMarkup([crop(10, 20, 100, 50), crop(0, 0, 400, 300)], size).edited,
    false
  );
});

test('crop rectangles snap to whole source pixels inside the image in any drag direction', () => {
  assert.deepEqual(
    snapRect({ x: 120.4, y: 80.6, width: -100.2, height: -60.5 }, size),
    { x: 20, y: 20, width: 100, height: 61 }
  );
  assert.deepEqual(
    snapRect({ x: -50, y: -10, width: 1000, height: 1000 }, size),
    fullRect(size)
  );
  assert.deepEqual(snapRect({ x: 399.8, y: 10, width: 0, height: 0 }, size), {
    x: 399,
    y: 10,
    width: 1,
    height: 1,
  });
});

test('crop handles resize or move the box within the image and keep a minimum size', () => {
  const start = { x: 100, y: 100, width: 200, height: 100 };
  assert.deepEqual(dragCrop(start, 'nw', { x: -30, y: -20 }, size, 10), {
    x: 70,
    y: 80,
    width: 230,
    height: 120,
  });
  assert.deepEqual(dragCrop(start, 'se', { x: 500, y: 500 }, size, 10), {
    x: 100,
    y: 100,
    width: 300,
    height: 200,
  });
  assert.deepEqual(dragCrop(start, 'e', { x: -500, y: 9 }, size, 24), {
    x: 100,
    y: 100,
    width: 24,
    height: 100,
  });
  assert.deepEqual(dragCrop(start, 'n', { x: 40, y: 500 }, size, 24), {
    x: 100,
    y: 176,
    width: 200,
    height: 24,
  });
  assert.deepEqual(dragCrop(start, 'move', { x: 500, y: -500 }, size, 24), {
    x: 200,
    y: 0,
    width: 200,
    height: 100,
  });
});

test('touches near the crop box pick corners and edges; its middle moves it', () => {
  const box = { x: 100, y: 100, width: 200, height: 120 };
  assert.equal(cropHandleAt(box, { x: 95, y: 104 }, 22), 'nw');
  assert.equal(cropHandleAt(box, { x: 310, y: 230 }, 22), 'se');
  assert.equal(cropHandleAt(box, { x: 200, y: 98 }, 22), 'n');
  assert.equal(cropHandleAt(box, { x: 299, y: 160 }, 22), 'e');
  assert.equal(cropHandleAt(box, { x: 200, y: 160 }, 22), 'move');
  assert.equal(cropHandleAt(box, { x: 20, y: 20 }, 22), undefined);
  const small = { x: 0, y: 0, width: 30, height: 30 };
  assert.equal(cropHandleAt(small, { x: 15, y: 15 }, 22), 'move');
  assert.equal(cropHandleAt(small, { x: 29, y: 2 }, 22), 'ne');
});

test('marks draw pen dots and strokes, rectangles, and arrows whose tip is the end point', () => {
  const dot = recorder();
  drawMark(dot.context, {
    ...pen.mark,
    points: [{ x: 5, y: 6 }],
  });
  const dotCalls = dot.calls.map(([name]) => name);
  assert.ok(dotCalls.includes('arc') && dotCalls.includes('fill'));
  assert.equal(dotCalls.includes('stroke'), false);

  const line = recorder();
  drawMark(line.context, pen.mark);
  assert.deepEqual(
    line.calls.filter(([name]) => ['moveTo', 'lineTo'].includes(name)),
    [
      ['moveTo', 20, 30],
      ['lineTo', 40, 30],
    ]
  );
  assert.deepEqual(line.calls[0], ['save']);
  assert.deepEqual(line.calls.at(-1), ['restore']);
  assert.ok(
    line.calls.some((call) => call[0] === 'lineWidth=' && call[1] === 4)
  );

  const rect = recorder();
  drawMark(rect.context, {
    type: 'rect',
    color: '#0a84ff',
    width: 3,
    from: { x: 50, y: 40 },
    to: { x: 10, y: 20 },
  });
  assert.deepEqual(
    rect.calls.find(([name]) => name === 'strokeRect'),
    ['strokeRect', 10, 20, 40, 20]
  );

  const arrow = recorder();
  drawMark(arrow.context, {
    type: 'arrow',
    color: '#ffcc00',
    width: 4,
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
  });
  const path = arrow.calls.filter(([name]) =>
    ['moveTo', 'lineTo', 'stroke', 'fill'].includes(name)
  );
  assert.deepEqual(path[0], ['moveTo', 0, 0]);
  // The shaft stops inside the head; the filled head's first point is the tip.
  assert.ok(path[1][1] > 80 && path[1][1] < 100);
  assert.deepEqual(path[2], ['stroke']);
  assert.deepEqual(path[3], ['moveTo', 100, 0]);
  assert.ok(Math.abs(path[4][2] + path[5][2]) < 1e-9);
  assert.deepEqual(path.at(-1), ['fill']);

  const empty = recorder();
  drawMark(empty.context, {
    type: 'arrow',
    color: '#ffcc00',
    width: 4,
    from: { x: 3, y: 3 },
    to: { x: 3, y: 3 },
  });
  assert.equal(
    empty.calls.some(([name]) => name === 'stroke' || name === 'fill'),
    false
  );
});

test('edited images export the crop at source resolution as PNG and release the canvas', async () => {
  const source = { image: 'decoded' };
  const { calls, context } = recorder();
  const canvas = fakeCanvas({ blob: new Blob([pngHeader(100, 50)]), context });
  const result = await exportMarkup(
    source,
    size,
    [crop(10, 20, 100, 50), pen],
    () => canvas
  );
  assert.deepEqual(canvas.encoded, [
    { type: 'image/png', width: 100, height: 50 },
  ]);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  assert.deepEqual(calls.slice(0, 2), [
    ['translate', -10, -20],
    ['drawImage', source, 0, 0],
  ]);
  assert.ok(calls.findIndex(([name]) => name === 'stroke') > 1);
  assert.equal(result.image.mime, 'image/png');
  assert.deepEqual(result.image.bytes, pngHeader(100, 50));
  assert.deepEqual([result.width, result.height], [100, 50]);
});

test('oversized PNG exports are rejected with an actionable message before transfer', async () => {
  const canvas = fakeCanvas({
    blob: new Blob([pngHeader(400, 300, MAX_IMAGE_BYTES + 1)]),
  });
  await assert.rejects(
    exportMarkup({}, size, [pen], () => canvas),
    {
      message:
        '编辑后的 PNG 为 10.1 MB，超过 10 MB；请裁剪更小的区域，或重置后粘贴原图',
    }
  );
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
});

test('canvas limits and unexpected encoder output fail without producing a payload', async () => {
  const cases = [
    fakeCanvas({ context: null, blob: new Blob([pngHeader(400, 300)]) }),
    fakeCanvas({ blob: null }),
    fakeCanvas({ blob: new Blob([]) }),
    fakeCanvas({ blob: new Blob([pngHeader(399, 300)]) }),
  ];
  for (const canvas of cases) {
    await assert.rejects(
      exportMarkup({}, size, [pen], () => canvas),
      /此设备无法生成这么大的图片，请裁剪更小的区域后重试/
    );
    assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  }
});

test('exports beyond the per-side or pixel-count bounds are refused before allocating a canvas', async () => {
  let created = 0;
  const create = () => {
    created += 1;
    return fakeCanvas({ blob: new Blob([pngHeader(1, 1)]) });
  };
  for (const bounds of [
    { width: 16385, height: 10 },
    { width: 8192, height: 4097 },
  ]) {
    await assert.rejects(
      exportMarkup({}, bounds, [pen], create),
      /编辑后的图片尺寸过大，请裁剪更小的区域/
    );
  }
  assert.equal(created, 0);
});

test('payload bounds and displayed sizes match the paste limits', () => {
  assert.equal(fitsImageBounds(16384, 1536), true);
  assert.equal(fitsImageBounds(16384, 1537), false);
  assert.equal(fitsImageBounds(16385, 1), false);
  assert.equal(formatImageBytes(512), '512 B');
  assert.equal(formatImageBytes(1536), '1.5 KB');
  assert.equal(formatImageBytes(MAX_IMAGE_BYTES), '10 MB');
  assert.equal(formatImageBytes(MAX_IMAGE_BYTES + 1), '10.1 MB');
});
