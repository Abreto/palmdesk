const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async (context) => {
  if (context.electronPlatformName === 'darwin') {
    if (process.platform !== 'darwin')
      throw new Error('Build the macOS native window helper on macOS.');
    execFileSync(process.execPath, [path.join(__dirname, 'build-native.mjs')], {
      stdio: 'inherit',
    });
  }
};
