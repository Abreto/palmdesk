const { app, BrowserWindow, screen, systemPreferences } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const artifacts = path.join(root, '.local/video-quality');
fs.mkdirSync(artifacts, { recursive: true });
const compile = (file) =>
  ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
app.setPath('userData', path.join(artifacts, 'profile'));
app.commandLine.appendSwitch('enable-features', 'AllowWgcWindowCapturer');
const timeout = setTimeout(() => {
  console.error('TIMEOUT');
  app.exit(1);
}, 55000);
app
  .whenReady()
  .then(async () => {
    const display =
      screen.getAllDisplays().find((d) => d.scaleFactor > 1) ||
      screen.getPrimaryDisplay();
    console.log(
      'DISPLAY',
      JSON.stringify({
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
        screenPermission:
          process.platform === 'darwin'
            ? systemPreferences.getMediaAccessStatus('screen')
            : 'n/a',
      })
    );
    const fixture = new BrowserWindow({
      title: 'PalmDesk video quality fixture',
      x: display.bounds.x + 20,
      y: display.bounds.y + 20,
      width: Math.min(1800, display.bounds.width - 40),
      height: Math.min(1200, display.bounds.height - 60),
      show: false,
      frame: false,
      webPreferences: { backgroundThrottling: false },
    });
    await fixture.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          `<!doctype html><style>body { background:#fff;color:#171717;font:16px monospace;margin:20px;} .lines {height:40px;background:repeating-linear-gradient(90deg,#000 0px,#000 1px,#fff 1px,#fff 2px)}</style><h2>PalmDesk — Retina text capture</h2><div class="lines"></div>${'<p>const message = "清晰文字 ABCDEFG abcdefg 0123456789";</p>'.repeat(14)}<span id="clock"></span><script>setInterval(() => document.querySelector('#clock').textContent = Date.now(), 50)</script>`
        )
    );
    fixture.showInactive();
    const runner = new BrowserWindow({
      show: false,
      webPreferences: { backgroundThrottling: false },
    });
    const runnerFile = path.join(artifacts, 'runner.html');
    fs.writeFileSync(
      runnerFile,
      '<video id="video" muted autoplay playsinline></video>'
    );
    await runner.loadFile(runnerFile);
    await runner.webContents.executeJavaScript(`{
    const exports = {};
    ${compile('src/utils/remote-video.ts')}
    window.quality = exports;
    undefined;
  }`);
    await runner.webContents.executeJavaScript(`{
    const exports = {};
    const network = { rtcMap: new Map(), wsMap: new Map() };
    const app = { remoteDesk: new Map(), setLiveLine() {} };
    const require = (name) => ({
      'billd-utils': { getRandomString: () => crypto.randomUUID() },
      '@/interface': { LiveLineEnum: {rtc: 'rtc'} },
      '@/store/app': { useAppStore: () => app },
      '@/store/network': { useNetworkStore: () => network },
      '@/types/websocket': { WsMsgTypeEnum: {} },
      './iceServers': { getIceServers: () => [] }
    })[name];
    ${compile('src/utils/network/webRTC.ts')}
    window.WebRTCClass = exports.WebRTCClass;
    undefined;
  }`);
    await runner.webContents.executeJavaScript(
      `window.sourceId = ${JSON.stringify(fixture.getMediaSourceId())};`
    );
    const result = await runner.webContents.executeJavaScript(`(async () => {
    const waitFor = async (predicate) => {
      const end = performance.now() + 10000;
      while (!predicate()) { if (performance.now() > end) throw new Error('Condition timed out'); await new Promise(r => setTimeout(r, 50)); }
    };
    const old = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } } });
    const oldTrack = old.getVideoTracks()[0];
    const oldVideo = document.createElement('video');
    oldVideo.muted = true;
    oldVideo.srcObject = old;
    await oldVideo.play();
    await new Promise(r => oldVideo.requestVideoFrameCallback(r));
    const before = { initial: oldTrack.getSettings() };
    await oldTrack.applyConstraints({ height: { ideal: 1080 }, frameRate: { ideal: 30 } });
    await waitFor(() => oldVideo.videoHeight <= 1080);
    await new Promise(r => oldVideo.requestVideoFrameCallback(r));
    before.adapted = oldTrack.getSettings();
    before.decoded = { width: oldVideo.videoWidth, height: oldVideo.videoHeight };
    oldTrack.stop();
    const stream = await navigator.mediaDevices.getUserMedia(quality.desktopCaptureConstraints(sourceId));
    const track = stream.getVideoTracks()[0];
    const after = { initial: track.getSettings(), capabilities: track.getCapabilities() };
    const defaults = quality.REMOTE_VIDEO_DEFAULTS;
    await quality.applyRemoteVideoConstraints(stream, defaults.resolutionRatio, defaults.maxFramerate);
    track.contentHint = defaults.videoContentHint;
    after.adapted = track.getSettings();
    const video = document.querySelector('video');
    const rtc = new WebRTCClass({ ...defaults, roomId: 'test', sender: 'host', receiver: 'phone', isSRS: false, videoEl: document.createElement('video') });
    const host = rtc.peerConnection;
    const phone = new RTCPeerConnection({ iceServers: [] });
    host.addEventListener('icecandidate', e => { if (e.candidate) phone.addIceCandidate(e.candidate); });
    phone.addEventListener('icecandidate', e => { if (e.candidate) host.addIceCandidate(e.candidate); });
    phone.ontrack = e => { video.srcObject = e.streams[0]; video.play(); };
    const negotiate = async () => {
      await host.setLocalDescription(await host.createOffer());
      await phone.setRemoteDescription(host.localDescription);
      await phone.setLocalDescription(await phone.createAnswer());
      await host.setRemoteDescription(phone.localDescription);
    };
    await negotiate();
    await waitFor(() => rtc.dataChannel.readyState === 'open');
    const sender = host.addTrack(track, stream);
    await negotiate();
    await waitFor(() => video.videoWidth > 0 && sender.getParameters().encodings[0]?.maxBitrate === 8000000);
    after.sender = sender.getParameters();
    after.decoded = { width: video.videoWidth, height: video.videoHeight };
    after.adapted = track.getSettings();
    await quality.applyRemoteVideoConstraints(stream, 720, 15);
    await rtc.setMaxFramerate(15);
    await waitFor(() => video.videoHeight <= 720);
    after.lowered = { track: track.getSettings(), width: video.videoWidth, height: video.videoHeight };
    await quality.applyRemoteVideoConstraints(stream, 2160, 30);
    await rtc.setMaxFramerate(30);
    await waitFor(() => video.videoHeight === after.decoded.height && video.videoWidth === after.decoded.width);
    after.restored = { track: track.getSettings(), width: video.videoWidth, height: video.videoHeight };
    after.stats = [...(await sender.getStats()).values()].filter(s => s.type === 'outbound-rtp').map(s => ({ width: s.frameWidth, height: s.frameHeight, fps: s.framesPerSecond, qualityLimitationReason: s.qualityLimitationReason }));
    track.stop(); rtc.close(); phone.close();
    return { before, after };
  })()`);
    fs.writeFileSync(
      path.join(artifacts, 'result.json'),
      JSON.stringify(
        {
          display: { bounds: display.bounds, scaleFactor: display.scaleFactor },
          ...result,
        },
        null,
        2
      )
    );
    const { before, after } = result;
    assert.ok(before.decoded.height <= 1080);
    assert.ok(after.decoded.height >= before.decoded.height);
    assert.ok(
      Math.abs(
        after.decoded.width / after.decoded.height -
          fixture.getBounds().width / fixture.getBounds().height
      ) < 0.01,
      'capture must preserve the window aspect ratio'
    );
    assert.ok(
      after.decoded.width <= fixture.getBounds().width * display.scaleFactor,
      'do not enlarge the source'
    );
    assert.ok(
      after.decoded.height <= fixture.getBounds().height * display.scaleFactor,
      'do not enlarge the source'
    );
    assert.equal(
      after.sender.encodings[0].maxBitrate,
      8000000,
      'apply bitrate after data-only negotiation'
    );
    assert.equal(after.sender.encodings[0].maxFramerate, 30);
    assert.equal(after.sender.degradationPreference, 'maintain-resolution');
    assert.ok(after.lowered.height <= 720);
    assert.equal(after.restored.width, after.decoded.width);
    assert.equal(after.restored.height, after.decoded.height);
    console.log(
      'PASS',
      JSON.stringify({
        before: before.decoded,
        after: after.decoded,
        lowered: { width: after.lowered.width, height: after.lowered.height },
        restored: {
          width: after.restored.width,
          height: after.restored.height,
        },
      })
    );
    runner.destroy();
    fixture.destroy();
    clearTimeout(timeout);
    app.exit(0);
  })
  .catch((e) => {
    console.error(e);
    clearTimeout(timeout);
    app.exit(1);
  });
