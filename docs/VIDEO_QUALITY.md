# Connection quality validation

Issue: [#42](https://github.com/Abreto/palmdesk/issues/42).

Both controller entry points share one policy. Explicit settings are saved locally; incoming host settings are not saved as controller preferences.

| Profile                                 | Capture ceiling | Frame ceiling | Bitrate ceiling | Content hint |
| --------------------------------------- | --------------- | ------------- | --------------- | ------------ |
| Balanced / 均衡 (default)               | 3840×2160       | 20 fps        | 3000 kbit/s     | text         |
| Low data / 省流量                       | 1920×1080       | 10 fps        | 1000 kbit/s     | text         |
| High detail / 高细节 (previous default) | 3840×2160       | 30 fps        | 8000 kbit/s     | text         |

Balanced retains the resolution ceiling from the Retina fix (#9) while reducing the bitrate and frame rate ceilings. The proposed 1440p / 20 fps / 3000 kbit/s alternative remains selectable manually for comparison. None of these values is a measured mobile optimum. A bitrate ceiling is neither a constant sending rate nor a hard data budget. All profiles retain source aspect ratio without upscaling; Low data may blur small fonts and zoomed text. Returning to High detail restores both dimension limits.

## Automated checks

`pnpm test:smoke` covers shared defaults, explicit preference persistence, invalid/unavailable storage, encoder bitrate units, late video negotiation, low-to-high quality changes, and suspension remaining active through quality changes. `pnpm typecheck` and `pnpm build:prod` check integration in both Vue pages.

After building, run `NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/mobile-resume.mjs` using the [browser smoke dependencies](LOCAL_DEVELOPMENT.md). This exercises both real Vue pages, authenticated signaling, and WebRTC in Chrome with synthetic capture. It checks presets selected before capture, live High detail restoration, all four manual overrides, reconnect/navigation/reload persistence, independence from incoming host settings, and inactive-video suspension. Phone-size layout screenshots are written to `.local/video-quality/`.

Validation on 2026-10-04: source smoke tests, type checking, linting of changed source files, production build, and the Chrome browser/WebRTC smoke passed. The 390×844 and 844×390 settings screenshots were inspected. These browser checks use synthetic 960×600 video and do not measure native Retina capture, Windows capture, physical-phone readability, or network performance. The Electron native test was updated for Balanced and High detail but was not run in this validation.

The opt-in [Electron video smoke test](LOCAL_DEVELOPMENT.md) checks actual capture and loopback decoding, aspect ratio, no upscaling, the Balanced encoder settings, and resolution restoration with High detail. Loopback decoding does not stand in for phone/network measurements.

## Physical-phone acceptance (pending)

No physical-phone, cellular, battery, or traffic results have been collected for these presets. Before closing #42, compare High detail, Balanced, the manual 1440p candidate, and Low data on a physical phone with a macOS Retina host and a Windows host where available. Record unavailable devices explicitly.

For each host/phone pair, use a good connection and a constrained host uplink (record the actual shaping rate, latency, loss, and whether TURN is used). Keep the window, font size, codec, and test duration constant. After warm-up, measure at least 60 seconds each of static code, repeatable scrolling, and window interaction. Repeat with a small window and a portrait window. Test pinch zoom at fit, 200%, and 300%, then return from Low data to High detail and verify restored detail.

Use consecutive WebRTC stats samples: video payload kbit/s = `8 × ΔbytesReceived / Δtimestamp_ms` from the same inbound video report. Record decoded frame width/height and fps (`framesPerSecond`, or `1000 × ΔframesDecoded / Δtimestamp_ms`), dropped frames, RTT, host outbound quality limitation reason, and the sampling interval. Video payload excludes transport overhead. Record interaction responsiveness separately from network RTT, with observed tap-to-result latency and missed/delayed input. Note legibility of small code, punctuation, and CJK text both at rest and after scrolling; screenshots alone cannot measure responsiveness.

| Host / display scale | Phone / browser | Network / TURN | Profile / workload | Actual video kbit/s | Decoded size / fps | Interaction latency | Text / pinch zoom |
| -------------------- | --------------- | -------------- | ------------------ | ------------------- | ------------------ | ------------------- | ----------------- |
| Pending              |                 |                |                    |                     |                    |                     |                   |

Also verify saved High detail and custom settings after reconnect, reload, and changing windows. Change quality before selecting a window and confirm it is applied when capture starts. Switch to session reading and background the controller: window video must remain suspended, session/data channels must remain available, and returning to the window must restore the selected quality.
