const { createRequire } = require('node:module');
const path = require('node:path');
const certificate = require('../build/macos-signing.json');

// Use the same signer version as the installed electron-builder.
const builderRequire = createRequire(require.resolve('electron-builder'));
const packagerRequire = createRequire(
  builderRequire.resolve('app-builder-lib')
);
const { signAsync } = packagerRequire('@electron/osx-sign');

module.exports = async (options, packager) => {
  const fixedCertificate = options.identity?.toUpperCase() === certificate.sha1;
  if (process.env.PALMDESK_BUILD_CHANNEL === 'release' && !fixedCertificate) {
    throw new Error(
      'Release builds require the fixed PalmDesk signing certificate.'
    );
  }
  if (fixedCertificate) {
    if (options.platform === 'mas')
      throw new Error(
        'The self-signed certificate cannot sign Mac App Store builds.'
      );
    const helper = path.join(options.app, 'Contents/MacOS/codex-window');
    const helperId = `${packager.appInfo.id}.window-helper`;
    console.log('Signing PalmDesk with the fixed self-signed certificate.');
    return signAsync({
      ...options,
      identityValidation: false,
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      optionsForFile: (file) => {
        const original = options.optionsForFile?.(file) || {};
        return {
          ...original,
          hardenedRuntime: false,
          timestamp: 'none',
          ...(file === helper
            ? {
                additionalArguments: [
                  ...(original.additionalArguments || []),
                  '--identifier',
                  helperId,
                ],
              }
            : {}),
        };
      },
    });
  }
  if (options.identity && options.identity !== '-') return signAsync(options);

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
  await signAsync({
    ...options,
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    optionsForFile: (file) => ({
      ...options.optionsForFile?.(file),
      hardenedRuntime: false,
      timestamp: 'none',
    }),
  });
};
