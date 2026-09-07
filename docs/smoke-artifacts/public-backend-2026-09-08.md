# Public Backend Verification (2026-09-08)

Endpoint: https://palmdesk.abreto.icu/

## Passed

- HTTPS homepage and Engine.IO polling handshake return HTTP 200.
- API under `/api`: independent device registration, correct-password login and incorrect-password rejection.
- Socket.IO: authenticated device join, remote-session acceptance/rejection, native WebRTC offer/answer/candidate forwarding.
- Deployed Vue business flow in two isolated Edge contexts: window listing/selection, 960x600 synthetic video decoding, Chinese text and Enter over the real DataChannel, touch click/drag/scroll/right-click, watch-only input suppression, and input-error recovery.
- Windows packaged PalmDesk settings saved: API `https://palmdesk.abreto.icu/api`, signaling `https://palmdesk.abreto.icu`, phone client `https://palmdesk.abreto.icu/`. After the backend fix, API login and the real `file://` WebSocket handshake succeed; the desktop UI shows `服务已连接` with no uncaught renderer errors.
- Retest after the backend fix: a public HTTPS Edge controller authenticates to the real packaged Windows host, selects a fixture-owned window and decodes its WGC video at 388x274. Sampled RGBA `[45, 142, 91, 255]` matches the green test window.
- A controller touch click reaches the native fixture's input, and literal `PalmDesk public 你好` arrives unchanged through the actual WebRTC DataChannel and Win32 input driver. Desktop and mobile viewport screenshots render without horizontal overflow.
- Disconnect clears the native capture session. The test browser, packaged test instance and fixture windows close successfully, with no uncaught renderer errors. The user's configured packaged application is then reopened for manual testing.
- The user subsequently confirmed successful testing from a physical phone and sent a message through the remote session. This is user-reported device verification; the phone's network path was not recorded.

## Remaining Issues

- The local development WebSocket origin `http://127.0.0.1:5173` is still rejected in the retest. The earlier run also rejected API preflights for that origin and `http://192.168.2.113:5173`; those preflights were not repeated after the fix.
- The initial full browser regression stopped after 15 passed checkpoints because the deployed window-state label was `当前不可见`, while the local test expects `未在当前桌面显示`. Later checkpoints were not run; the targeted native retest does not establish that the full browser regression passes.

The initial browser flow used synthetic video and a substituted native input bridge. The follow-up automated native flow uses the real Windows executable, real WGC capture and real Win32 input through the public signaling service, with a separate Edge process on the same computer and mobile viewport emulation. Physical phone testing was subsequently confirmed by the user. Cross-network TURN behavior remains unverified.

Local follow-up artifacts are stored under the Git-ignored `.local/public-backend/`: `windows-client.json`, `windows-public-flow.json`, `windows-public-mobile.png` and `windows-public-desktop.png`. Screenshots contain only the test window, with no device password or unrelated desktop content.

## Repeat The Signaling Check

```powershell
$env:SMOKE_BACKEND_URL = 'https://palmdesk.abreto.icu'
$env:SMOKE_API_BASE_URL = 'https://palmdesk.abreto.icu/api'
node --test test/smoke/signaling.test.mjs
```
