// A window owned by a separate application process, which
// native-window-focus.cjs brings in front of its own fixtures.
const path = require('node:path');

const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '../../..');
app.setPath(
  'userData',
  path.join(root, '.local/native-window-focus-other-profile')
);

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 500, height: 360, show: false });
  await window.loadURL(
    'data:text/html,<title>PalmDesk other application fixture</title><p>PalmDesk temporary focus fixture</p>'
  );
  // The test activates this window through the native helper.
  window.showInactive();
});
