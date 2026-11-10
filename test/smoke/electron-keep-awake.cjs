// Checks electron-main/keep-awake.ts against Electron's real powerSaveBlocker.
// It opens no window, needs no backend and never changes power settings. On
// macOS it reads `pmset -g assertions`: while the option is on, this process
// must hold exactly one idle system sleep assertion and no display sleep
// assertion, and none after turning it off, quitting or relaunching. Other
// hosts check Electron's own state only. Set SMOKE_KEEP_AWAKE_HOLD to keep
// the option on for that many seconds, e.g. to run `powercfg /requests` from
// an elevated Windows prompt.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Read before `ready`, as electron-main/index.ts does.
const { app, powerSaveBlocker } = require('electron');

const load = require('./load-source.cjs');

const { KeepAwake } = load('electron-main/keep-awake.ts');

const root = path.resolve(__dirname, '../..');
const artifacts = path.join(root, '.local/keep-awake');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', path.join(artifacts, 'profile'));
app.dock?.hide();

const hold = Math.max(0, Number(process.env.SMOKE_KEEP_AWAKE_HOLD) || 0);
const timeout = setTimeout(
  () => {
    console.error('TIMEOUT');
    app.exit(1);
  },
  60000 + hold * 1000
);

const SYSTEM = /PreventUserIdleSystemSleep|NoIdleSleepAssertion/;
const DISPLAY = /PreventUserIdleDisplaySleep|NoDisplaySleepAssertion/;
const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** This process's power assertions on macOS; `undefined` elsewhere. */
function assertions() {
  if (process.platform !== 'darwin') return undefined;
  return execFileSync('/usr/bin/pmset', ['-g', 'assertions'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((line) => line.includes(`pid ${process.pid}(`))
    .map((line) => line.trim());
}

/** Waits for the system to apply a change; Electron requests it asynchronously. */
async function expectAssertion(held) {
  if (!assertions()) return undefined;
  for (let i = 0; i < 50; i += 1) {
    const lines = assertions();
    if (lines.some((line) => SYSTEM.test(line)) === held) {
      assert.equal(lines.filter((line) => SYSTEM.test(line)).length, +held);
      assert.ok(!lines.some((line) => DISPLAY.test(line)), lines.join('\n'));
      return lines;
    }
    await wait(100);
  }
  throw new Error(
    `expected the assertion to be ${held ? 'held' : 'released'}: ${assertions().join(' | ')}`
  );
}

app
  .whenReady()
  .then(async () => {
    const result = {
      platform: process.platform,
      electron: process.versions.electron,
    };
    const settings = fs.mkdtempSync(path.join(os.tmpdir(), 'palmdesk-awake-'));
    try {
      const on = { enabled: true, active: true, supported: true };
      const first = new KeepAwake(settings, powerSaveBlocker);
      await first.restore();
      result.launch = await first.status();
      if (!result.launch.supported) {
        console.log('SKIP', JSON.stringify(result));
        return;
      }
      assert.equal(result.launch.enabled, false);
      await expectAssertion(false);

      await first.configure(true);
      assert.deepEqual(await first.configure(true), on);
      result.enabled = await expectAssertion(true);
      if (hold) {
        console.log(`Keeping the computer awake for ${hold} s`);
        await wait(hold * 1000);
      }

      assert.equal((await first.configure(false)).active, false);
      result.disabled = await expectAssertion(false);

      await first.configure(true);
      await expectAssertion(true);
      first.close();
      result.quit = await expectAssertion(false);

      const relaunched = new KeepAwake(settings, powerSaveBlocker);
      await relaunched.restore();
      assert.deepEqual(await relaunched.status(), on);
      result.relaunched = await expectAssertion(true);
      relaunched.close();
      await expectAssertion(false);

      fs.writeFileSync(
        path.join(artifacts, 'result.json'),
        `${JSON.stringify(result, null, 2)}\n`
      );
      console.log('PASS', JSON.stringify(result));
    } finally {
      fs.rmSync(settings, { recursive: true, force: true });
    }
  })
  .then(() => {
    clearTimeout(timeout);
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  });
