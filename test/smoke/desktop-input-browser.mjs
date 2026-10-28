import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const browser = await chromium.launch({
  executablePath:
    process.env.SMOKE_BROWSER_EXECUTABLE ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const url = 'http://127.0.0.1:5196/test/smoke/desktop-input.html';
const errors = [];

async function open(options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await ready(page);
  return { context, page };
}
function ready(page) {
  return page.waitForFunction(
    () => document.querySelector('.video-stage video')?.style.width
  );
}
// Each behavior with its name, e.g. { name: 'pressButtonLeft', x, y }.
const recorded = (page) =>
  page.evaluate(() =>
    window.desktopSmoke.behaviors.map((item, index) => ({
      ...item,
      name: window.desktopSmoke.events[index],
    }))
  );
const names = async (page) =>
  (await recorded(page))
    .map((item) => item.name)
    .filter((name) => name !== 'mouseMove');
const keyEvents = async (page) =>
  (await recorded(page))
    .filter((item) => item.name.startsWith('keyboard') && item.key?.length)
    .map((item) => [
      item.name === 'keyboardPressKey' ? 'down' : 'up',
      item.key[0],
    ]);
const clear = (page) =>
  page.evaluate(() => {
    window.desktopSmoke.events.length = 0;
    window.desktopSmoke.behaviors.length = 0;
  });
const focused = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    return element?.getAttribute('aria-label') || element?.tagName;
  });
function layout(page) {
  return page.evaluate(() => {
    const box = (selector) =>
      document.querySelector(selector)?.getBoundingClientRect().toJSON();
    return {
      profile: document.querySelector('output').textContent,
      tools: box('.tools'),
      stage: box('.video-stage'),
      video: box('.video-stage video'),
      panel: box('.keyboard-panel'),
      modes: Boolean(document.querySelector('.modes')),
      focusRing: Boolean(document.querySelector('.keyboard-focus')),
      zoom: Number(document.querySelector('.zoom-label select').value),
      scrollLeft: document.querySelector('.video-stage').scrollLeft,
      pageWidth: document.documentElement.scrollWidth,
    };
  });
}
// A point inside the synthetic window's prompt field, in page coordinates.
async function promptPoint(page, dx = 0) {
  const { video } = await layout(page);
  return {
    x: video.x + video.width * 0.5 + dx,
    y: video.y + video.height * 0.87,
    expected: {
      x: Math.round(((video.width * 0.5 + dx) / video.width) * 1000),
    },
  };
}

try {
  // A laptop browser: fine pointer, hover and a physical keyboard.
  const { context, page } = await open({
    viewport: { width: 1440, height: 900 },
  });
  const keys = await page.evaluate(() => window.desktopSmoke.keys);
  const stageLabel = await page
    .locator('.video-stage')
    .getAttribute('aria-label');
  const desktop = await layout(page);
  assert.equal(desktop.profile, 'desktop');
  assert.equal(desktop.modes, false, 'no touch-mode buttons');
  assert.equal(desktop.panel, undefined, 'composer starts collapsed');
  assert.ok(
    desktop.tools.height <= 42,
    `compact toolbar ${desktop.tools.height}`
  );
  assert.equal(
    Math.round(desktop.video.height),
    Math.round(desktop.stage.height)
  );
  assert.ok(Math.abs(desktop.video.width / desktop.video.height - 1.6) < 0.01);
  const composerToggle = page.getByRole('button', {
    name: '文字输入',
    exact: true,
  });
  await composerToggle.click();
  const draft = page.getByLabel('发送到电脑的文字');
  await draft.fill('多行草稿\n第二行');
  const expanded = await layout(page);
  assert.ok(expanded.panel.height > 60);
  assert.ok(expanded.video.height < desktop.video.height);
  await composerToggle.click();
  assert.equal((await layout(page)).panel, undefined);
  await composerToggle.click();
  assert.equal(await draft.inputValue(), '多行草稿\n第二行');
  await composerToggle.click();
  assert.deepEqual((await layout(page)).video, desktop.video);
  console.log(
    'PASS desktop profile: compact toolbar, collapsed composer one click away with its draft, remote window keeps its aspect ratio'
  );

  // Ordinary mouse input reaches the host directly, without touch modes.
  const prompt = await promptPoint(page);
  await page.mouse.move(prompt.x - 50, prompt.y - 50);
  await clear(page);
  await page.mouse.move(prompt.x, prompt.y, { steps: 3 });
  assert.ok((await recorded(page)).every((item) => item.name === 'mouseMove'));
  assert.ok(
    (await recorded(page)).length >= 1,
    'hover moves the remote cursor'
  );
  await clear(page);
  await page.mouse.down();
  await page.mouse.move(prompt.x + 2, prompt.y + 1);
  await page.mouse.up();
  await page.waitForTimeout(30);
  let sent = await recorded(page);
  assert.deepEqual(await names(page), ['pressButtonLeft', 'releaseButtonLeft']);
  assert.deepEqual(
    [sent[0].x, sent[0].y],
    [sent.at(-1).x, sent.at(-1).y],
    'small jitter still releases where the click started'
  );
  assert.ok(Math.abs(sent[0].x - prompt.expected.x) <= 1);
  await page.waitForTimeout(300);
  assert.deepEqual(await names(page), ['pressButtonLeft', 'releaseButtonLeft']);
  console.log('PASS a click is sent at once, with no delayed duplicate');

  const presses = async () =>
    (await recorded(page))
      .filter((item) => item.name !== 'mouseMove')
      .map((item) => `${item.name} ${item.x},${item.y}`);
  await page.waitForTimeout(550);
  await clear(page);
  await page.mouse.dblclick(prompt.x, prompt.y);
  assert.deepEqual(await names(page), [
    'pressButtonLeft',
    'releaseButtonLeft',
    'pressButtonLeft',
    'releaseButtonLeft',
  ]);
  const position = (await presses())[0].split(' ')[1];
  assert.ok((await presses()).every((item) => item.endsWith(position)));
  // A trackpad can shift a pixel or two between the clicks of a double click.
  await page.waitForTimeout(550);
  await clear(page);
  await page.mouse.click(prompt.x, prompt.y);
  await page.mouse.click(prompt.x + 3, prompt.y + 1);
  assert.ok((await presses()).every((item) => item.endsWith(position)));
  await page.waitForTimeout(550);
  await clear(page);
  await page.mouse.click(prompt.x + 30, prompt.y);
  const later = (await recorded(page)).find(
    (item) => item.name === 'pressButtonLeft'
  );
  assert.ok(Math.abs(later.x - (await promptPoint(page, 30)).expected.x) <= 1);
  console.log(
    'PASS double click repeats one position despite small movement; later clicks use their own'
  );

  await clear(page);
  await page.mouse.click(prompt.x, prompt.y, { button: 'right' });
  assert.deepEqual(await names(page), ['rightClick']);
  await clear(page);
  await page.mouse.click(prompt.x, prompt.y, { button: 'middle' });
  assert.deepEqual(await names(page), []);
  // Control pressed outside the window view is not sent, so on a Mac
  // controller Control-click becomes the right click it is locally.
  await page.getByLabel('本地搜索').focus();
  const stageBox = await page.locator('.video-stage').boundingBox();
  await page.waitForTimeout(550);
  await clear(page);
  await page.locator('.video-stage').click({
    modifiers: ['Control'],
    position: { x: prompt.x - stageBox.x, y: prompt.y - stageBox.y },
  });
  const mac = await page.evaluate(() => navigator.userAgent.includes('Mac'));
  assert.deepEqual(
    await names(page),
    mac ? ['rightClick'] : ['pressButtonLeft', 'releaseButtonLeft']
  );
  await clear(page);
  await page.mouse.move(prompt.x - 200, prompt.y);
  await page.mouse.down();
  await page.mouse.move(prompt.x, prompt.y, { steps: 4 });
  await page.mouse.move(desktop.stage.x + desktop.stage.width - 4, prompt.y);
  await page.mouse.up();
  sent = await recorded(page);
  assert.deepEqual(
    sent.map((item) => item.name).filter((name) => name !== 'mouseMove'),
    ['pressButtonLeft', 'releaseButtonLeft']
  );
  assert.ok(sent.filter((item) => item.name === 'mouseMove').length >= 4);
  assert.equal(sent.at(-1).x, 1000, 'drag release is clamped to the window');
  await clear(page);
  await page.mouse.move(prompt.x, prompt.y);
  await clear(page);
  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(-80, 0);
  await page.waitForTimeout(50);
  sent = await recorded(page);
  assert.deepEqual(
    sent.map((item) => [item.name, item.amount]),
    [
      ['scrollDown', 6],
      ['scrollLeft', 4],
    ]
  );
  console.log(
    'PASS right click, Control-click, ignored middle button, clamped drag, vertical and horizontal wheel'
  );

  // Pinching a trackpad (Ctrl+wheel) zooms locally around the pointer.
  await clear(page);
  const beforeZoom = await layout(page);
  await page.evaluate(
    ({ x, y }) =>
      document.querySelector('.video-stage').dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -100,
          ctrlKey: true,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        })
      ),
    prompt
  );
  const zoomed = await layout(page);
  assert.ok(zoomed.zoom > 1.3 && zoomed.zoom < 1.5, `zoom ${zoomed.zoom}`);
  const anchor = (video) => (prompt.x - video.x) / video.width;
  assert.ok(Math.abs(anchor(beforeZoom.video) - anchor(zoomed.video)) < 0.01);
  await page.getByRole('button', { name: '移动画面', exact: true }).click();
  await page.mouse.move(prompt.x, prompt.y - 300);
  await page.mouse.down();
  await page.mouse.move(prompt.x - 120, prompt.y - 300, { steps: 3 });
  await page.mouse.up();
  assert.ok((await layout(page)).scrollLeft > zoomed.scrollLeft + 100);
  await page.mouse.wheel(0, 100);
  assert.deepEqual(
    (await names(page)).filter((name) => name !== 'releaseAll'),
    [],
    'pinch zoom, pan and pan-mode wheel stay local'
  );
  await page.getByRole('button', { name: '移动画面', exact: true }).click();
  await page.getByLabel('画面缩放').selectOption('1');
  console.log('PASS trackpad pinch zoom and distinct pan control stay local');

  // Keyboard input is forwarded only while the window view has focus.
  await page.getByLabel('本地搜索').focus();
  await clear(page);
  await page.keyboard.type('local text');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByLabel('本地搜索').inputValue(), 'local text');
  assert.deepEqual(await names(page), []);
  const remoteKeyboard = page.getByRole('button', { name: /^远程键盘/ });
  assert.equal(await remoteKeyboard.getAttribute('aria-pressed'), 'false');
  await page.mouse.click(prompt.x, prompt.y);
  assert.equal(await focused(page), stageLabel);
  assert.equal((await layout(page)).focusRing, true);
  assert.equal(await remoteKeyboard.getAttribute('aria-pressed'), 'true');
  await clear(page);
  await page.keyboard.type('a,');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Comma');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  assert.deepEqual(await keyEvents(page), [
    ['down', keys.A],
    ['up', keys.A],
    ['down', keys[',']],
    ['up', keys[',']],
    ['down', keys.ShiftLeft],
    ['down', keys['1']],
    ['up', keys['1']],
    ['down', keys[',']],
    ['up', keys[',']],
    ['up', keys.ShiftLeft],
    ['down', keys.Home],
    ['up', keys.Home],
    ['down', keys.Tab],
    ['up', keys.Tab],
  ]);
  assert.equal(
    await focused(page),
    stageLabel,
    'Tab is sent to the computer and keeps remote focus'
  );
  await clear(page);
  await page.keyboard.press('Escape');
  assert.deepEqual(await keyEvents(page), [
    ['down', keys.Escape],
    ['up', keys.Escape],
  ]);
  await clear(page);
  await page.keyboard.down('Escape');
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains('keyboard-toggle')
  );
  await page.keyboard.up('Escape');
  assert.deepEqual(await keyEvents(page), [], 'held Escape is not sent');
  assert.ok((await names(page)).includes('releaseAll'));
  assert.match(await focused(page), /^BUTTON$/);
  assert.equal(await remoteKeyboard.getAttribute('aria-pressed'), 'false');
  assert.equal((await layout(page)).focusRing, false);
  await clear(page);
  await page.keyboard.type('x');
  assert.deepEqual(await keyEvents(page), []);
  console.log(
    'PASS local fields keep their keys; clicking the window forwards typing, shifted keys, Home and Tab; Esc taps are sent and a held Esc leaves'
  );

  await page.getByRole('button', { name: '全屏', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await focused(page), stageLabel);
  assert.equal((await layout(page)).focusRing, true);
  await clear(page);
  await page.keyboard.press('KeyB');
  assert.deepEqual(await keyEvents(page), [
    ['down', keys.B],
    ['up', keys.B],
  ]);
  await remoteKeyboard.click();
  assert.equal(await remoteKeyboard.getAttribute('aria-pressed'), 'false');
  await remoteKeyboard.click();
  assert.equal(await remoteKeyboard.getAttribute('aria-pressed'), 'true');
  console.log(
    'PASS keyboard focus enters remote input; the toolbar toggle leaves and re-enters it'
  );

  // The controller's close and quit shortcuts are never sent to the computer.
  await page.mouse.click(prompt.x, prompt.y);
  await clear(page);
  const modifier = mac ? keys.MetaLeft : keys.ControlLeft;
  await page.keyboard.press(mac ? 'Meta+KeyW' : 'Control+KeyW');
  await page.keyboard.press(mac ? 'Meta+KeyQ' : 'Control+KeyQ');
  if (!mac) await page.keyboard.press('Alt+F4');
  assert.deepEqual(await keyEvents(page), [
    ['down', modifier],
    ['up', modifier],
    ['down', modifier],
    ['up', modifier],
    ...(mac
      ? []
      : [
          ['down', keys.AltLeft],
          ['up', keys.AltLeft],
        ]),
  ]);
  if (mac) {
    // Control+W deletes a word in a terminal; only Command+W is local.
    await clear(page);
    await page.keyboard.press('Control+KeyW');
    assert.deepEqual(await keyEvents(page), [
      ['down', keys.ControlLeft],
      ['down', keys.W],
      ['up', keys.W],
      ['up', keys.ControlLeft],
    ]);
  }
  // macOS sends no keyup for V released before Command; a held Esc still
  // leaves afterwards.
  await clear(page);
  await page.evaluate(() => {
    const stage = document.querySelector('.video-stage');
    const fire = (type, code, key, metaKey) =>
      stage.dispatchEvent(
        new KeyboardEvent(type, {
          code,
          key,
          metaKey,
          bubbles: true,
          cancelable: true,
        })
      );
    fire('keydown', 'MetaLeft', 'Meta', true);
    fire('keydown', 'KeyV', 'v', true);
    fire('keyup', 'MetaLeft', 'Meta', false);
  });
  assert.deepEqual(await keyEvents(page), [
    ['down', keys.MetaLeft],
    ['down', keys.V],
    ['up', keys.V],
    ['up', keys.MetaLeft],
  ]);
  await clear(page);
  await page.keyboard.down('Escape');
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains('keyboard-toggle')
  );
  await page.keyboard.up('Escape');
  assert.deepEqual(await keyEvents(page), []);
  console.log(
    'PASS close and quit shortcuts stay local; keys pressed with Command are released with it'
  );

  // Held keys and buttons are released when remote input stops.
  const holdKey = async () => {
    await page.mouse.click(prompt.x, prompt.y);
    await page.keyboard.down('KeyC');
    await clear(page);
  };
  const afterRelease = async (label) => {
    assert.ok((await names(page)).includes('releaseAll'), label);
    await clear(page);
    await page.keyboard.up('KeyC');
    assert.deepEqual(
      await keyEvents(page),
      [],
      `${label}: no stale key release`
    );
  };
  await holdKey();
  await page.getByLabel('画面缩放').focus();
  await afterRelease('focus moved to a local control');
  await holdKey();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal((await layout(page)).focusRing, false);
  await afterRelease('window blurred');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.mouse.click(prompt.x, prompt.y);
  await page.mouse.down();
  await clear(page);
  await page.getByLabel('仅观看').evaluate((input) => input.click());
  await page.mouse.up();
  const released = await names(page);
  assert.ok(released.length && released.every((name) => name === 'releaseAll'));
  await page.getByLabel('仅观看').uncheck();
  // A cancelled press releases everything on the host, so a still-held Shift
  // must not send a second release later.
  await page.mouse.click(prompt.x, prompt.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await clear(page);
  await page.evaluate(() =>
    document.querySelector('.video-stage').dispatchEvent(
      new PointerEvent('pointercancel', {
        pointerId: 1,
        pointerType: 'mouse',
        bubbles: true,
      })
    )
  );
  assert.deepEqual(await names(page), ['releaseAll']);
  await clear(page);
  await page.keyboard.up('Shift');
  await page.mouse.up();
  assert.deepEqual(await names(page), [], 'cancel also forgot the held key');
  await holdKey();
  await page
    .getByRole('button', { name: '切到阅读', exact: true })
    .evaluate((button) => button.click());
  await afterRelease('Read selected');
  await page.keyboard.press('KeyD');
  await page.mouse.click(prompt.x, prompt.y);
  assert.deepEqual(await names(page), [], 'blocked input sends nothing');
  await page.getByRole('button', { name: '返回窗口', exact: true }).click();
  await holdKey();
  await page.evaluate(() => window.desktopSmoke.connect(false));
  await clear(page);
  await page.keyboard.up('KeyC');
  assert.deepEqual(
    await keyEvents(page),
    [],
    'connection end forgets held keys'
  );
  await page.evaluate(() => window.desktopSmoke.connect(true));
  await ready(page);
  await page.mouse.click(prompt.x, prompt.y);
  await clear(page);
  await page.keyboard.press('KeyE');
  assert.deepEqual(await keyEvents(page), [
    ['down', keys.E],
    ['up', keys.E],
  ]);
  console.log(
    'PASS held keys and buttons release on focus loss, window blur, watch-only, pointer cancel, Read and connection end'
  );

  // The composer keeps IME/multiline typing local and sends it as text.
  await composerToggle.click();
  await draft.focus();
  await clear(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('next');
  assert.deepEqual(await keyEvents(page), []);
  await page.getByRole('button', { name: '发送文字', exact: true }).click();
  sent = await recorded(page);
  assert.deepEqual(
    sent
      .filter((item) => item.name === 'keyboardType')
      .map((item) => item.text),
    ['多行草稿\n第二行\nnext']
  );
  console.log('PASS the composer types locally and sends multiline text');

  // An explicit override switches layouts at once and is saved locally.
  await draft.fill('切换布局也保留');
  const mode = page.getByLabel('交互方式');
  await mode.selectOption('touch');
  let touch = await layout(page);
  assert.equal(touch.profile, 'touch');
  assert.equal(touch.modes, true);
  assert.ok(touch.panel, 'touch layout opens the composer');
  assert.equal(await draft.inputValue(), '切换布局也保留');
  await clear(page);
  const touchPrompt = await promptPoint(page);
  await page.mouse.click(touchPrompt.x, touchPrompt.y);
  await page.waitForFunction(() =>
    window.desktopSmoke.events.includes('leftClick')
  );
  assert.deepEqual(
    await names(page),
    ['leftClick'],
    'touch modes keep their delayed tap instead of direct presses'
  );
  await page.reload();
  await ready(page);
  assert.equal((await layout(page)).profile, 'touch', 'override persists');
  await mode.selectOption('auto');
  assert.equal((await layout(page)).profile, 'desktop');
  assert.equal((await layout(page)).panel, undefined);
  await page.reload();
  await ready(page);
  assert.equal((await layout(page)).profile, 'desktop');
  await page.setViewportSize({ width: 420, height: 760 });
  await page.waitForTimeout(100);
  const narrow = await layout(page);
  assert.equal(narrow.profile, 'desktop', 'width alone never selects touch');
  assert.ok(narrow.tools.y < narrow.stage.y, 'toolbar stays above the window');
  assert.ok(narrow.pageWidth <= 420);
  assert.equal(Math.round(narrow.video.width), Math.round(narrow.stage.width));
  console.log(
    'PASS override switches immediately, persists across reloads, and narrow desktop windows keep desktop input'
  );
  await context.close();

  // Scrollbars of the zoomed view scroll it locally and never click the app.
  const scrollbars = await chromium.launch({
    executablePath:
      process.env.SMOKE_BROWSER_EXECUTABLE ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  try {
    const classic = await scrollbars.newPage({
      viewport: { width: 1440, height: 900 },
    });
    classic.on('pageerror', (error) => errors.push(error.message));
    await classic.goto(url);
    await ready(classic);
    await classic.addStyleTag({
      content:
        '.video-stage::-webkit-scrollbar{width:16px;height:16px;background:#ddd}.video-stage::-webkit-scrollbar-thumb{background:#888}',
    });
    await classic.getByLabel('画面缩放').selectOption('2');
    const bar = await classic.evaluate(() => {
      const stage = document.querySelector('.video-stage');
      const rect = stage.getBoundingClientRect();
      return {
        width: stage.offsetWidth - stage.clientWidth,
        right: rect.right,
        bottom: rect.bottom,
        top: rect.top,
        left: rect.left,
        scrollTop: stage.scrollTop,
      };
    });
    assert.ok(bar.width >= 10, `classic scrollbar ${bar.width}`);
    await clear(classic);
    await classic.mouse.move(bar.right - 8, bar.top + 30);
    await classic.mouse.down();
    await classic.mouse.move(bar.right - 8, bar.top + 150, { steps: 5 });
    await classic.mouse.up();
    await classic.mouse.click(bar.right - 8, bar.bottom - 60);
    await classic.waitForTimeout(300);
    await classic.mouse.click(bar.right - 8, bar.bottom - 60);
    await classic.mouse.click(bar.left + 200, bar.bottom - 8);
    assert.deepEqual(await names(classic), []);
    assert.ok(
      (await classic.evaluate(
        () => document.querySelector('.video-stage').scrollTop
      )) >
        bar.scrollTop + 50,
      'the scrollbar still scrolls the view'
    );
    console.log(
      'PASS scrollbar drags and track clicks scroll the zoomed view without clicking the app'
    );
  } finally {
    await scrollbars.close();
  }

  // Phones keep the touch workflow in portrait and landscape.
  const phone = await open({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  touch = await layout(phone.page);
  assert.equal(touch.profile, 'touch');
  assert.equal(touch.modes, true);
  assert.ok(touch.panel, 'phone composer starts open');
  assert.ok(touch.tools.y > touch.stage.y + touch.stage.height - 1);
  const phoneDraft = phone.page.getByLabel('发送到电脑的文字');
  await phoneDraft.fill('手机草稿');
  await phoneDraft.focus();
  const phonePrompt = await promptPoint(phone.page);
  await clear(phone.page);
  await phone.page.touchscreen.tap(phonePrompt.x, phonePrompt.y);
  await phone.page.waitForFunction(() =>
    window.desktopSmoke.events.includes('leftClick')
  );
  assert.equal(
    await focused(phone.page),
    '发送到电脑的文字',
    'tapping the window keeps the open composer focused'
  );
  await phone.page.evaluate(() => document.activeElement.blur());
  await phone.page.touchscreen.tap(phonePrompt.x, phonePrompt.y);
  await clear(phone.page);
  await phone.page.keyboard.press('KeyF');
  assert.deepEqual(
    (await keyEvents(phone.page)).map(([direction]) => direction),
    ['down', 'up'],
    'a tablet keyboard types into the tapped window'
  );
  assert.equal((await layout(phone.page)).focusRing, true);
  await phone.page.setViewportSize({ width: 844, height: 390 });
  await phone.page.waitForTimeout(100);
  const landscape = await layout(phone.page);
  assert.equal(landscape.profile, 'touch');
  assert.equal(landscape.pageWidth, 844);
  assert.ok(landscape.video.height > 60);
  await phone.page.getByLabel('交互方式').selectOption('desktop');
  const forced = await layout(phone.page);
  assert.equal(forced.modes, false);
  assert.equal(forced.panel, undefined);
  await phone.page.setViewportSize({ width: 390, height: 844 });
  await phone.page.waitForTimeout(100);
  const forcedPortrait = await layout(phone.page);
  assert.ok(forcedPortrait.tools.y < forcedPortrait.stage.y);
  await clear(phone.page);
  await phone.page.touchscreen.tap(phonePrompt.x, forcedPortrait.video.y + 20);
  await phone.page.waitForFunction(() =>
    window.desktopSmoke.events.includes('leftClick')
  );
  await phone.page.getByLabel('交互方式').selectOption('auto');
  assert.equal((await layout(phone.page)).profile, 'touch');
  assert.equal(await phoneDraft.inputValue(), '手机草稿');
  assert.deepEqual(errors, []);
  console.log(
    'PASS phone portrait/landscape keep touch controls and the open composer; a forced desktop layout still accepts touch taps'
  );
} finally {
  await browser.close();
}
