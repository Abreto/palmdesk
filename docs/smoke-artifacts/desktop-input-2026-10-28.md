# Desktop mouse and keyboard controller — 2026-10-28, updated after review the same day

Scope: first increment for issue #38. Built on `9420464`. Local machine: macOS 26.6 (Apple Silicon), Node 26.5.0, Playwright 1.64.1 with headless Chromium 156.0.8078.4. This Mac has no Accessibility permission for PalmDesk, so native focus and input on a real host were not exercised, and no packaged build was launched.

## Behavior

**Interaction profile.** `auto` (the default) uses the desktop profile when the primary pointer is fine and can hover (`(pointer: fine)` and `(hover: hover)`), otherwise the touch profile. Viewport width is not used, so a narrow desktop window keeps mouse input and a phone in landscape keeps touch controls. Browsers do not report whether a physical keyboard is attached, so keyboards do not affect the choice; they work in both profiles once the window view has focus. **交互方式** (Interaction mode) under **连接设置** (Connection settings) forces `touch` or `desktop` and is saved in `localStorage`.

**Desktop layout.** The header, Read/Window tabs and viewport toolbar are compact, the four touch-mode buttons become one **移动画面** (Pan) toggle, and the key row, composer and image actions start collapsed behind **文字输入** (Text input). The draft is kept by the controller page while collapsed. Phone layouts are unchanged; the floating phone toolbar now applies only to the touch profile.

**Mouse and trackpad.** A mouse or pen in the desktop profile bypasses the touch modes:

| Controller | Sent to the host |
| --- | --- |
| Left press and release | `down` and `up` immediately, both at the pressed point unless the pointer moved 4 px or more |
| Drag | `down`, then `move` events (clamped to the window), then `up` at the end point |
| Double click | two press/release pairs; a second press within 500 ms and 4 px reuses the first position, so the host's own double-click detection sees one point |
| Right button, or Control-click on a Mac controller while Control is not being sent | one `rightClick` on press; the browser menu stays closed |
| Wheel, vertical or horizontal | `scroll` with the existing amount mapping (pixel delta ÷ 20) |
| Trackpad pinch (Ctrl+wheel without a sent Control key) | local zoom around the pointer |
| Drag with Pan or Watch only selected | local pan of the zoomed view |
| Middle, back and forward buttons | nothing; the host supports left and right buttons only |
| Press or drag on the zoomed view's scrollbar | nothing; the scrollbar scrolls the view locally |

Touch input on the same device still uses the touch path, including taps on a desktop layout.

**Keyboard ownership.** The window view is focusable. Clicking it or reaching it with Tab gives it keyboard focus; keys are forwarded only from that element, so PalmDesk fields, the composer and the reader keep their own keys. A 2 px accent outline and the pressed **远程键盘** (Remote keyboard) button show active remote input. Tab and Shift+Tab are sent to the computer. To leave, click outside the window view, or hold Esc for 0.8 s without modifiers or press **远程键盘**; the last two move focus to that button. A shorter Esc press is sent on release. Holding Esc leaves even if an earlier keyup never arrived. macOS sends no keyup for a key released while Command is down (Cmd+V), so keys pressed with Command are released together with it. Lock keys are sent as a press and release each time they toggle (on a Mac controller, Caps Lock's keyup is its unlock), never as held keys. The controller's own close and quit shortcuts are never sent: Cmd+W and Cmd+Q on a Mac, Ctrl+W, Ctrl+Q and Alt+F4 elsewhere (AltGr combinations still type). In a browser these are the browser's own shortcuts. The Electron controller has no Close menu item, so there Cmd/Ctrl+W does nothing, and Cmd+Q reaches the Quit menu item. Control+W on a Mac is still sent, for example to delete a word in a terminal. On a phone, tapping the window keeps an open composer focused so its on-screen keyboard stays up, and the outline appears only after a hardware key was typed.

Keys map by `KeyboardEvent.code` for special keys, then by character, then by physical position. New coverage: Home, End, Page Up/Down, Insert, punctuation, shifted characters such as `!` and `<`, numpad Enter and operators, and letters on non-Latin layouts. Backquote now sends the grave key instead of the quote key. All new names were checked against the host's libnut key table on macOS and Windows; single characters are resolved by the host's own keyboard layout.

**Release.** Held keys, a held mouse button and local gestures are released when the window view loses focus, the controller window blurs or is hidden, Watch only or Read is selected, input is blocked, image upload starts, the profile changes, a press is cancelled, or the connection ends. The host's release frees keys as well as buttons, so a cancelled press also clears the controller's held keys. A key still physically held afterwards does not send a stale release.

## Screenshots

The same synthetic 1280×800 window, opened through the real host and controller pages at 1440×900 with a fine pointer:

| Build | Header + tabs + toolbar + composer | Remote window |
| --- | --- | --- |
| [Before](desktop-input-before.png) (`9420464`) | 68 + 61 + 59 + 126 px | 939×587 |
| [After](desktop-input-after.png) | 45 + 37 + 41 px, composer collapsed | 1243×777 (1.75× the area) |

[Remote keyboard active](desktop-input-keyboard.png) shows the focus outline and the pressed **远程键盘** button. Phone portrait (390×844) and landscape (844×390) screenshots of the same flow matched the previous build pixel for pixel, apart from video compression noise.

## Verification

| Check | Result |
| --- | --- |
| `pnpm test:smoke` | 394 passed, 5 existing Windows-only tests skipped. 21 new tests cover profile choice, the mouse path, key mapping, Esc handling, Command and lock keys, local shortcuts and release. |
| `pnpm typecheck` | Passed. |
| ESLint on changed source files and new tests | Passed. |
| `pnpm build:prod` | Passed; the existing large-chunk warning remains. |
| `pnpm test:browser` | All 7 scripts passed. New: `desktop-input-browser.mjs` (13 checks on an isolated viewport fixture at 1440×900 fine pointer, 420×760 desktop, and 390×844 / 844×390 touch, plus classic scrollbars in a browser that shows them) and `desktop-controller.mjs` (4 checks with real host and controller pages: layout, a click and typed keys arriving at the host input IPC, the reader keeping its keys, and the saved override). |
| `pnpm build:native` | Passed on macOS. |

## Limitations found

- Besides the close and quit shortcuts PalmDesk keeps local, browsers keep Cmd/Ctrl+T, Cmd/Ctrl+N and their other reserved shortcuts, and the system keeps Cmd+Tab, Alt+Tab, Cmd+Space, Ctrl+Alt+Delete and Windows-key combinations. In fullscreen, Esc exits fullscreen first. Other Electron menu shortcuts (Edit menu and forced reload) were not checked in the desktop app.
- Directly typed keys are sent as keys; Chinese text is composed by the computer's input method. To compose on the controller (IME, multiline, pasted text), use the composer.
- A modifier pressed before the window view had focus is not sent, so the first click into the view is a plain click.
- Characters missing from the computer's keyboard layout may not type. Shifted characters rely on the forwarded Shift key.
- Double clicks depend on both presses reaching the host within its double-click time; network delay can split them. On macOS hosts, the input library marks repeated presses as double clicks at most, so a triple click may act as a double click.
- Wheel and trackpad scroll speed uses the previous mapping and was not checked against real hosts.

## Review fixes — 2026-10-28

An independent review of `b354c51` found four issues, now fixed and covered by tests:

- On a Mac controller a lost keyup (Cmd+V, or Caps Lock left locked) made a held Esc send Escape instead of leaving. Keys pressed with Command are now released with it, lock keys toggle instead of staying held, and holding Esc leaves regardless of earlier presses. Unit tests replay both sequences; the browser test replays Cmd+V with synthetic events, because headless Chromium delivers every keyup.
- Pressing or dragging the zoomed view's classic scrollbar clicked the remote app at the point under it, and two track clicks read as a double click. Presses outside the stage's client area are now ignored. The browser test fails without this.
- A cancelled mouse press sent the host's release-all without clearing held keys, so a still-held Shift later sent a second release. The keyboard state is now cleared with it. The browser test fails without this.
- The documentation said Cmd/Ctrl+W and Cmd+Q stay on the controller, which was not true in the Electron controller, where they could reach the computer. They are now kept local in every controller, as described above.

## Not validated

- Physical macOS and Windows desktop controllers, including the Electron controller window (its handling of Cmd/Ctrl+W and Cmd+Q above follows from its menu and was not run), and desktop Safari, Firefox and Edge.
- Real trackpad pinch and scroll deltas, mouse wheels and pens.
- Real IME on the controller and host, and double-click timing through a real host over a network.
- Touch laptops and tablets with keyboards or trackpads (the auto choice there depends on what the browser reports as the primary pointer; the override covers it).
- Physical phones; the phone checks above are headless emulation.
