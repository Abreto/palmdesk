const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

async function writeMacDisplayNames(bundle, productName) {
  // Keep the executable, bundle ID and data directory independent of locale.
  // Preserve the checkout suffix so local builds remain distinguishable.
  await Promise.all(
    ['en', 'zh_CN', 'zh_TW', 'zh-Hans', 'zh-Hant'].map(async (locale) => {
      const name =
        locale === 'en' ? productName : productName.replace(/^Tenori/, '过目');
      const directory = path.join(
        bundle,
        'Contents/Resources',
        `${locale}.lproj`
      );
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, 'InfoPlist.strings'),
        `"CFBundleName" = ${JSON.stringify(name)};\n"CFBundleDisplayName" = ${JSON.stringify(name)};\n`
      );
    })
  );
}

module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  const { productFilename, productName } = context.packager.appInfo;
  await writeMacDisplayNames(
    path.join(context.appOutDir, `${productFilename}.app`),
    productName
  );
};
module.exports.writeMacDisplayNames = writeMacDisplayNames;
