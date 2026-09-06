const { createRequire } = require('node:module');

// Use the same signer version as the installed electron-builder.
const builderRequire = createRequire(require.resolve('electron-builder'));
const packagerRequire = createRequire(
  builderRequire.resolve('app-builder-lib')
);
const { signAsync } = packagerRequire('@electron/osx-sign');

module.exports = async (options, packager) => {
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
