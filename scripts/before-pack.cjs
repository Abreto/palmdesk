const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async (context) => {
  const target = context.electronPlatformName;
  const platformName = { darwin: 'macOS', win32: 'Windows' }[target];
  if (platformName) {
    if (process.platform !== target)
      throw new Error(
        `Build the ${platformName} native window helper on ${platformName}.`
      );
    execFileSync(process.execPath, [path.join(__dirname, 'build-native.mjs')], {
      stdio: 'inherit',
      windowsHide: true,
    });
  }
};
