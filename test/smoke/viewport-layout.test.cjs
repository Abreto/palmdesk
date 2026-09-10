const assert = require('node:assert/strict');
const test = require('node:test');

const load = require('./load-source.cjs');

const { viewportLayout, viewportPoint } = load('src/utils/viewport-layout.ts');

test('task view enlarges the sidebar while keeping its full height visible', () => {
  const video = { width: 1440, height: 900 };
  const phone = { width: 390, height: 650 };
  const whole = viewportLayout(video, phone, 1);
  const tasks = viewportLayout(video, phone, 1, 0.28);
  assert.ok(tasks.videoWidth > whole.videoWidth * 2);
  assert.ok(tasks.width <= phone.width && tasks.height <= phone.height);
  assert.equal(tasks.videoHeight, 650);
  assert.equal(tasks.width, tasks.videoWidth * 0.28);
});
test('zoom preserves the remote aspect ratio and an empty source has no layout', () => {
  const layout = viewportLayout(
    { width: 1440, height: 900 },
    { width: 844, height: 230 },
    2,
    0.2
  );
  const fitted = viewportLayout(
    { width: 1440, height: 900 },
    { width: 844, height: 230 },
    1,
    0.2
  );
  assert.ok(Math.abs(layout.height - fitted.height * 2) < 0.001);
  assert.ok(Math.abs(layout.videoWidth / layout.videoHeight - 1.6) < 0.001);
  assert.equal(
    viewportLayout({ width: 0, height: 0 }, { width: 390, height: 650 }, 1),
    undefined
  );
});
test('landscape task navigation retains readable width instead of shrinking to a strip', () => {
  const layout = viewportLayout(
    { width: 1280, height: 900 },
    { width: 844, height: 184 },
    1,
    0.25
  );
  assert.equal(layout.width, 240);
  assert.equal(layout.height, 675);
});
test('a cropped sidebar still maps clicks to the original full window', () => {
  const video = { left: 50, top: 40, width: 1000, height: 600 };
  const sidebar = { left: 50, top: 40, width: 280, height: 600 };
  const stage = { left: 0, top: 20, width: 390, height: 650 };
  assert.deepEqual(viewportPoint(video, sidebar, stage, 190, 340), {
    x: 140,
    y: 500,
  });
  assert.equal(viewportPoint(video, sidebar, stage, 350, 340), null);
  assert.equal(viewportPoint(video, sidebar, stage, 20, 340), null);
});
test('pan and clipping keep drag coordinates within the visible source', () => {
  const video = { left: -120, top: -80, width: 1440, height: 900 };
  const surface = { ...video, width: 403.2 };
  const stage = { left: 0, top: 40, width: 390, height: 600 };
  assert.deepEqual(viewportPoint(video, surface, stage, 0, 40), {
    x: 83,
    y: 133,
  });
  assert.deepEqual(viewportPoint(video, surface, stage, 500, 900, true), {
    x: 280,
    y: 800,
  });
  assert.equal(viewportPoint(video, surface, stage, 20, 20), null);
  assert.equal(
    viewportPoint(video, { ...surface, width: 0 }, stage, 20, 80, true),
    null
  );
});
