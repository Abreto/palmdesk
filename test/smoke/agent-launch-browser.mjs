/* eslint-disable no-underscore-dangle -- Shared browser fixture control. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const browser = await chromium.launch({
  executablePath:
    process.env.SMOKE_BROWSER_EXECUTABLE ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors = [];
const directory = '.local/agent-launch-smoke';
await mkdir(directory, { recursive: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (error) => errors.push(error.message));
const url =
  process.env.SMOKE_CLIENT_URL ||
  'http://127.0.0.1:5197/test/smoke/agent-launch.html';
async function reset(options = {}) {
  await page.goto(url);
  await page.waitForFunction(() => window.__agentSmoke);
  await page.evaluate(
    (values) => Object.assign(window.__agentSmoke, values),
    options
  );
  await page.getByRole('button', { name: '窗口', exact: true }).click();
  await page.getByRole('button', { name: '刷新 Agent 和窗口' }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="刷新 Agent 和窗口"]').disabled
  );
}
async function chooseCodex() {
  await page
    .getByRole('button', { name: '打开 Agent', exact: true })
    .last()
    .click();
  await page.locator('.installed-agent').filter({ hasText: 'Codex' }).click();
}
const messages = (type) =>
  page.evaluate(
    (type) => window.__agentSmoke.sent.filter((item) => item.msgType === type),
    type
  );
try {
  await reset({ afterPolls: 3, launchDelay: 500 });
  await page.getByText('未发现已打开的 Agent', { exact: true }).waitFor();
  await page.screenshot({ path: `${directory}/empty-phone.png` });
  await chooseCodex();
  await page.getByText('正在打开 Codex…', { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: '打开 Agent', exact: true })
      .first()
      .isDisabled(),
    true
  );
  await page.waitForFunction(() =>
    window.__agentSmoke.sent.some(
      (item) => item.msgType === 'remoteWindowSelect'
    )
  );
  assert.equal((await messages('remoteAgentLaunch')).length, 1);
  assert.equal((await messages('remoteWindowSelect'))[0].data.id, 'codex-0');
  console.log(
    'PASS empty state, duplicate guard, delayed window creation and automatic selection'
  );

  await reset({ afterLaunch: 2 });
  await chooseCodex();
  await page
    .getByRole('button', { name: '选择 codex project 1', exact: true })
    .waitFor();
  assert.equal((await messages('remoteWindowSelect')).length, 0);
  await page.screenshot({ path: `${directory}/multiple-phone.png` });
  await page
    .getByRole('button', { name: '选择 codex project 1', exact: true })
    .click();
  assert.equal((await messages('remoteWindowSelect'))[0].data.id, 'codex-1');
  console.log('PASS multiple windows require explicit selection');

  await reset({ running: [{ id: 'codex' }], afterLaunch: 0 });
  await page.getByRole('button', { name: '打开 Codex', exact: true }).click();
  await page
    .getByRole('button', { name: '重试打开 Codex', exact: true })
    .waitFor({ timeout: 26000 });
  assert.equal((await messages('remoteAgentLaunch')).length, 1);
  await page.evaluate(() => {
    window.__agentSmoke.afterLaunch = 1;
  });
  await page
    .getByRole('button', { name: '重试打开 Codex', exact: true })
    .click();
  await page.waitForFunction(() =>
    window.__agentSmoke.sent.some(
      (item) => item.msgType === 'remoteWindowSelect'
    )
  );
  assert.equal((await messages('remoteAgentLaunch')).length, 2);
  console.log(
    'PASS running without windows, bounded timeout and explicit retry'
  );

  await reset({
    running: [{ id: 'codex' }],
    windows: [
      {
        id: 'existing',
        contextId: 'existing',
        agentId: 'codex',
        name: 'Existing Codex',
        appName: 'Codex',
        thumbnail: '',
        appIcon: '',
        isOnScreen: true,
      },
    ],
  });
  await page.getByRole('button', { name: '打开 Agent', exact: true }).click();
  await page.locator('.installed-agent').filter({ hasText: 'Claude' }).click();
  await page.waitForFunction(() =>
    window.__agentSmoke.sent.some(
      (item) => item.msgType === 'remoteWindowSelect'
    )
  );
  assert.equal((await messages('remoteAgentLaunch'))[0].data.id, 'claude');
  assert.equal((await messages('remoteWindowSelect'))[0].data.id, 'claude-0');
  console.log(
    'PASS an existing Agent does not prevent opening another installed Agent'
  );

  const terminalWindow = {
    id: 'terminal',
    contextId: 'terminal',
    name: 'Claude Code in Terminal',
    appName: 'Terminal',
    thumbnail: '',
    appIcon: '',
    isOnScreen: true,
  };
  const nativeWindow = {
    ...terminalWindow,
    id: 'native-claude',
    contextId: 'native-claude',
    agentId: 'claude',
    name: 'Claude Desktop',
    appName: 'Claude',
  };
  async function linkTerminal() {
    await page.getByRole('tab', { name: /其他应用/ }).click();
    await page
      .getByRole('button', { name: '将 Terminal 关联到 Agent', exact: true })
      .click();
    await page
      .getByLabel('选择关联的 Agent', { exact: true })
      .selectOption('claude');
  }
  await reset({ windows: [terminalWindow] });
  await linkTerminal();
  await page.getByRole('button', { name: '打开 Agent', exact: true }).click();
  const installedClaude = page
    .locator('.installed-agent')
    .filter({ hasText: 'Claude' });
  await installedClaude.getByText('未运行', { exact: true }).waitFor();
  await installedClaude.click();
  await page.waitForFunction(() =>
    window.__agentSmoke.sent.some(
      (item) => item.msgType === 'remoteWindowSelect'
    )
  );
  assert.equal((await messages('remoteAgentLaunch'))[0].data.id, 'claude');
  assert.equal((await messages('remoteWindowSelect'))[0].data.id, 'claude-0');
  console.log(
    'PASS manually linked terminal does not block launching the desktop Agent'
  );

  await reset({ windows: [terminalWindow] });
  await linkTerminal();
  await page.getByRole('button', { name: '打开 Claude', exact: true }).click();
  assert.equal((await messages('remoteAgentLaunch')).length, 0);
  assert.equal((await messages('remoteWindowSelect'))[0].data.id, 'terminal');
  console.log(
    'PASS directory navigation to manually linked terminals is preserved'
  );

  await reset({
    windows: [terminalWindow, nativeWindow],
    running: [{ id: 'claude' }],
  });
  await linkTerminal();
  await page.getByRole('button', { name: '打开 Agent', exact: true }).click();
  await installedClaude.getByText('1 个窗口', { exact: true }).waitFor();
  await installedClaude.click();
  assert.equal((await messages('remoteAgentLaunch')).length, 0);
  assert.equal(
    (await messages('remoteWindowSelect'))[0].data.id,
    'native-claude'
  );
  console.log(
    'PASS installed launcher counts and selects only native Agent windows'
  );

  await reset({ windows: [nativeWindow], installedDelay: 5000 });
  assert.equal(
    await page.evaluate(() => window.__agentSmoke.installedReplies),
    0
  );
  await page.getByRole('button', { name: '打开 Agent', exact: true }).click();
  await page.getByText('正在查找已安装的 Agent…', { exact: true }).waitFor();
  await page.getByRole('button', { name: '打开 Claude', exact: true }).click();
  assert.equal(
    (await messages('remoteWindowSelect'))[0].data.id,
    'native-claude'
  );
  assert.equal(
    await page.evaluate(() => window.__agentSmoke.installedReplies),
    0
  );
  console.log(
    'PASS slow installed discovery never blocks selecting an existing window'
  );

  await reset({ launchError: 'Agent 已移除，请刷新后重试' });
  await chooseCodex();
  await page.getByText('Agent 已移除，请刷新后重试', { exact: true }).waitFor();
  assert.equal((await messages('remoteWindowSelect')).length, 0);
  console.log('PASS launch failure leaves the picker usable');

  await reset({ installed: [] });
  await page
    .getByRole('button', { name: '打开 Agent', exact: true })
    .last()
    .click();
  await page.getByText(/未发现可启动的已安装 Agent/).waitFor();
  assert.equal(await page.locator('.installed-agent').count(), 0);
  await page
    .getByLabel('搜索窗口或 Agent', { exact: true })
    .fill('nonexistent');
  await page.getByText('没有匹配的 Agent', { exact: true }).waitFor();
  console.log('PASS no installed apps and search-empty states remain distinct');

  await reset({ supported: false });
  await page
    .getByRole('button', { name: '打开 Agent', exact: true })
    .last()
    .click();
  await page.getByText('此平台不支持打开 Agent', { exact: true }).waitFor();
  assert.equal(await page.locator('.installed-agent').count(), 0);
  await reset({ legacy: true });
  await page
    .getByRole('button', { name: '打开 Agent', exact: true })
    .last()
    .click();
  await page
    .getByText('读取已安装 Agent 超时，请刷新重试或更新电脑端 PalmDesk', {
      exact: true,
    })
    .waitFor();
  console.log(
    'PASS unsupported and older hosts have no ineffective launch action'
  );

  await reset({ launchDelay: 700 });
  await chooseCodex();
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await page.waitForTimeout(1000);
  assert.equal((await messages('remoteWindowSelect')).length, 0);
  await page.getByRole('button', { name: '窗口', exact: true }).click();
  assert.equal((await messages('remoteAgentLaunch')).length, 1);
  console.log('PASS leaving window mode cancels auto-selection without replay');

  await reset({ launchDelay: 500 });
  await chooseCodex();
  await page.evaluate(() =>
    window.__agentSmoke.channel.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ msgType: 'remoteSessionStopped', data: {} }),
      })
    )
  );
  await page.waitForTimeout(800);
  assert.equal((await messages('remoteAgentLaunch')).length, 1);
  assert.equal((await messages('remoteWindowSelect')).length, 0);
  console.log('PASS disconnect ignores late launch result');

  await page.setViewportSize({ width: 844, height: 390 });
  await reset();
  await page
    .getByRole('button', { name: '打开 Agent', exact: true })
    .last()
    .click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true
  );
  await page.screenshot({ path: `${directory}/installed-landscape.png` });
  assert.deepEqual(errors, []);
  console.log('PASS phone portrait/landscape and no browser errors');
} finally {
  await browser.close();
}
