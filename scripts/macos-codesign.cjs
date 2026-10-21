// Signs a macOS app with codesign alone, so release signing needs no npm
// packages. Uses the options PalmDesk previously passed to @electron/osx-sign:
// no hardened runtime, no timestamp and the same entitlements for every item.
const { execFileSync } = require('node:child_process');
const { closeSync, openSync, readSync, readdirSync } = require('node:fs');
const path = require('node:path');

const certificate = require('../build/macos-signing.json');

const ENTITLEMENTS = path.join(__dirname, '../build/entitlements.mac.plist');
const BUNDLES = new Set(['.app', '.framework']);
const THIN = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe]);
const FAT = new Set([0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca]);

function isMachO(file) {
  const header = Buffer.alloc(8);
  const fd = openSync(file, 'r');
  try {
    if (readSync(fd, header, 0, 8, 0) < 8) return false;
  } finally {
    closeSync(fd);
  }
  const magic = header.readUInt32BE(0);
  if (THIN.has(magic)) return true;
  if (!FAT.has(magic)) return false;
  // Java class files share the fat magic but store a class version (45+)
  // where fat binaries store a small architecture count.
  const count =
    magic >>> 24 === 0xca ? header.readUInt32BE(4) : header.readUInt32LE(4);
  return count > 0 && count < 20;
}

function signingTargets(app) {
  const targets = [];
  (function walk(directory) {
    readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const target = path.join(directory, entry.name);
      // Symlinks such as Versions/Current reach code signed at its real path.
      if (entry.isSymbolicLink()) return;
      if (entry.isDirectory()) {
        walk(target);
        if (BUNDLES.has(path.extname(entry.name))) targets.push(target);
      } else if (entry.isFile() && isMachO(target)) targets.push(target);
    });
  })(path.join(app, 'Contents'));
  const depth = (target) => target.split(path.sep).length;
  // Each signature seals the code inside it, so the deepest items go first.
  return [...targets.sort((a, b) => depth(b) - depth(a)), app];
}

function helperIdentifiers(appId) {
  // Compiler-generated identifiers change between builds; keep the helper's
  // designated requirement stable instead.
  return { 'Contents/MacOS/codex-window': `${appId}.window-helper` };
}

function signApp({
  app,
  identity,
  keychain,
  identifiers = {},
  entitlements = ENTITLEMENTS,
  run = execFileSync,
}) {
  const targets = signingTargets(app);
  targets.forEach((target) => {
    const relative = path.relative(app, target).split(path.sep).join('/');
    const identifier = identifiers[relative];
    run(
      'codesign',
      [
        '--sign',
        identity,
        '--force',
        ...(keychain ? ['--keychain', keychain] : []),
        '--timestamp=none',
        '--entitlements',
        entitlements,
        ...(identifier ? ['--identifier', identifier] : []),
        target,
      ],
      { stdio: 'pipe' }
    );
  });
  return targets;
}

if (require.main === module) {
  try {
    const app = process.argv[2];
    if (process.platform !== 'darwin' || !app)
      throw new Error('Usage on macOS: macos-codesign.cjs <app>');
    if (!process.env.CSC_KEYCHAIN)
      throw new Error('Prepare the signing keychain first.');
    const appId = execFileSync(
      '/usr/libexec/PlistBuddy',
      [
        '-c',
        'Print :CFBundleIdentifier',
        path.join(app, 'Contents/Info.plist'),
      ],
      { encoding: 'utf8' }
    ).trim();
    const targets = signApp({
      app: path.resolve(app),
      identity: certificate.sha1,
      keychain: process.env.CSC_KEYCHAIN,
      identifiers: helperIdentifiers(appId),
    });
    console.log(
      `Signed ${targets.length} code items with the fixed certificate.`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { helperIdentifiers, isMachO, signApp, signingTargets };
