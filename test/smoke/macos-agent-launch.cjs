// Launches only a disposable app with a unique test identity, never a real Agent.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { mkdir, mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');

(async () => {
  if (process.platform !== 'darwin') throw new Error('macOS required');
  await mkdir(path.resolve('.local'), { recursive: true });
  const root = await mkdtemp(path.resolve('.local/agent-launch-fixture-'));
  const bundleId = `io.github.abreto.palmdesk.launch-test-${process.pid}`;
  const application = path.join(root, 'Launch Fixture.app');
  const contents = path.join(application, 'Contents');
  const marker = path.join(root, 'state.json');
  const command = path.join(root, 'command');
  const lsregister =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  let fixturePid;
  let helper;
  const pending = new Map();
  let sequence = 0;
  const request = (command, data = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Native helper timed out'));
      }, 15000);
      pending.set(requestId, { resolve, reject, timer });
      helper.stdin.write(
        JSON.stringify({ requestId, command, ...data }) + '\n'
      );
    });
  async function stateWhen(predicate) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const state = await readFile(marker, 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      if (state && predicate(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Fixture state timed out');
  }
  try {
    await mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await writeFile(
      path.join(contents, 'Info.plist'),
      `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleName</key><string>PalmDesk Launch Fixture</string><key>CFBundleVersion</key><string>1</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
    );
    const swift = `import AppKit
let marker = ${JSON.stringify(marker)}
let command = ${JSON.stringify(command)}
class Delegate: NSObject, NSApplicationDelegate {
  var window: NSWindow?
  var opens = 0
  func save() {
    let data = try! JSONSerialization.data(withJSONObject: ["pid": ProcessInfo.processInfo.processIdentifier, "opens": opens, "visible": window?.isVisible ?? false])
    try! data.write(to: URL(fileURLWithPath: marker), options: .atomic)
  }
  func show() {
    if window == nil {
      window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 420, height: 220), styleMask: [.titled, .closable], backing: .buffered, defer: false)
      window!.title = "PalmDesk disposable launch fixture"
      window!.isReleasedWhenClosed = false
    }
    opens += 1
    window!.makeKeyAndOrderFront(nil)
    save()
  }
  func applicationDidFinishLaunching(_ notification: Notification) {
    show()
    Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
      if FileManager.default.fileExists(atPath: command) {
        try? FileManager.default.removeItem(atPath: command)
        self.window?.close()
        self.save()
      }
    }
  }
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { show(); return true }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { return false }
}
let application = NSApplication.shared
let delegate = Delegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
`;
    await writeFile(path.join(root, 'fixture.swift'), swift);
    execFileSync('xcrun', [
      'swiftc',
      '-module-cache-path',
      path.resolve('.local/swift-cache'),
      path.join(root, 'fixture.swift'),
      '-o',
      path.join(contents, 'MacOS/fixture'),
    ]);
    execFileSync('codesign', ['--force', '--sign', '-', application]);
    execFileSync(lsregister, ['-f', application]);
    helper = spawn(path.resolve('native-bin/codex-window'), [], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    readline.createInterface({ input: helper.stdout }).on('line', (line) => {
      const response = JSON.parse(line);
      const task = pending.get(response.requestId);
      if (!task) return;
      pending.delete(response.requestId);
      clearTimeout(task.timer);
      if (response.error) task.reject(new Error(response.error));
      else task.resolve(response.data);
    });
    assert.deepEqual(
      await request('installedAgents', {
        bundles: [bundleId, `${bundleId}.missing`],
      }),
      [bundleId]
    );
    await assert.rejects(
      request('launchAgent', { bundleId: `${bundleId}.missing` }),
      /安装|移除/
    );
    await request('launchAgent', { bundleId });
    const first = await stateWhen((state) => state.visible);
    fixturePid = first.pid;
    await writeFile(command, 'close');
    await stateWhen((state) => !state.visible);
    await request('launchAgent', { bundleId });
    const reopened = await stateWhen(
      (state) => state.visible && state.opens > first.opens
    );
    assert.equal(reopened.pid, fixturePid);
    console.log(
      'PASS real macOS installed discovery, missing app rejection, cold launch and reopening the same running process after its last window closes'
    );
  } finally {
    helper?.kill();
    for (const task of pending.values()) clearTimeout(task.timer);
    if (!fixturePid)
      fixturePid = await readFile(marker, 'utf8')
        .then(JSON.parse)
        .then((state) => state.pid)
        .catch(() => null);
    if (fixturePid) {
      try {
        process.kill(fixturePid, 'SIGTERM');
      } catch {}
    }
    try {
      execFileSync(lsregister, ['-u', application]);
    } catch {}
    await rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
