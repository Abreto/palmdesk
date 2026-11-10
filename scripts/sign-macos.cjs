const { createRequire } = require('node:module');

const certificate = require('../build/macos-signing.json');

const { helperIdentifiers, signApp } = require('./macos-codesign.cjs');

// Other certificates keep the signer version of the installed electron-builder.
function osxSign(options) {
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const packagerRequire = createRequire(
    builderRequire.resolve('app-builder-lib')
  );
  return packagerRequire('@electron/osx-sign').signAsync(options);
}

function sign(options, packager) {
  const fixedCertificate = options.identity?.toUpperCase() === certificate.sha1;
  if (process.env.PALMDESK_BUILD_CHANNEL === 'release' && !fixedCertificate) {
    throw new Error(
      'Release builds require the fixed PalmDesk signing certificate.'
    );
  }
  const identifiers = helperIdentifiers(packager.appInfo.id);
  if (fixedCertificate) {
    if (options.platform === 'mas')
      throw new Error(
        'The self-signed certificate cannot sign Mac App Store builds.'
      );
    // The release workflow signs with the same code, outside electron-builder.
    console.log('Signing PalmDesk with the fixed self-signed certificate.');
    signApp({
      app: options.app,
      identity: certificate.sha1,
      keychain: options.keychain,
      identifiers,
    });
    return;
  }
  if (options.identity && options.identity !== '-') return osxSign(options);

  const configuredIdentity = packager.platformSpecificBuildOptions.identity;
  if (
    options.platform === 'mas' ||
    packager.forceCodeSigning ||
    (configuredIdentity && configuredIdentity !== '-') ||
    process.env.CSC_NAME ||
    process.env.CSC_LINK
  ) {
    throw new Error('The requested macOS signing certificate is unavailable.');
  }

  console.log('Signing PalmDesk locally (ad-hoc, not for distribution).');
  signApp({ app: options.app, identity: '-', identifiers });
}

// electron-builder awaits the hook, so errors become a rejected promise.
module.exports = (options, packager) =>
  new Promise((resolve) => {
    resolve(sign(options, packager));
  });
