// Carries the unsigned macOS app from the release build job to the signing job
// and creates the DMG with system tools only. The build job keeps the Finder
// layout electron-builder generated; the signing job never mounts its image.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { verify } = require('./verify-macos-signing.cjs');

const LAYOUT = ['.background', '.DS_Store', '.VolumeIcon.icns'];
const MANIFEST = 'dmg.json';
// Finder flags of a folder start at byte 8; 0x0400 marks a custom icon.
const CUSTOM_ICON = `${'00'.repeat(8)}0400${'00'.repeat(22)}`;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function attach(image, { writable = false } = {}) {
  const mountpoint = mkdtempSync(path.join(os.tmpdir(), 'palmdesk-dmg-'));
  run('hdiutil', [
    'attach',
    image,
    '-nobrowse',
    '-noautoopen',
    writable ? '-readwrite' : '-readonly',
    '-mountpoint',
    mountpoint,
  ]);
  return mountpoint;
}

function detach(mountpoint) {
  try {
    run('hdiutil', ['detach', mountpoint]);
  } catch {
    // Spotlight or fseventsd can briefly hold a fresh volume.
    run('hdiutil', ['detach', mountpoint, '-force']);
  }
  rmdirSync(mountpoint);
}

function expectedNames({ productName, version }) {
  return {
    app: `${productName}.app`,
    volumeName: `${productName} ${version}-arm64`,
  };
}

function stage(dmg, app, archive) {
  const staging = mkdtempSync(path.join(os.tmpdir(), 'palmdesk-stage-'));
  try {
    const mountpoint = attach(dmg);
    let volumeName;
    try {
      volumeName = run(
        'plutil',
        ['-extract', 'VolumeName', 'raw', '-o', '-', '-'],
        {
          input: run('diskutil', ['info', '-plist', mountpoint]),
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      ).trim();
      LAYOUT.filter((name) => existsSync(path.join(mountpoint, name))).forEach(
        (name) =>
          run('ditto', [path.join(mountpoint, name), path.join(staging, name)])
      );
    } finally {
      detach(mountpoint);
    }
    run('ditto', [app, path.join(staging, path.basename(app))]);
    writeFileSync(
      path.join(staging, MANIFEST),
      `${JSON.stringify({ app: path.basename(app), volumeName })}\n`
    );
    mkdirSync(path.dirname(archive), { recursive: true });
    run('ditto', ['-c', '-k', staging, archive]);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function checkStage(directory, manifest) {
  const { app, volumeName } = expectedNames(manifest);
  const stage = JSON.parse(
    readFileSync(path.join(directory, MANIFEST), 'utf8')
  );
  assert.deepEqual(stage, { app, volumeName }, 'Unexpected DMG manifest.');
  const allowed = new Set([app, MANIFEST, ...LAYOUT]);
  const root = path.join(directory, app);
  assert.ok(lstatSync(root).isDirectory(), `Missing ${app}.`);
  (function walk(current) {
    readdirSync(current).forEach((name) => {
      const entry = path.join(current, name);
      if (current === directory && !allowed.has(name))
        throw new Error(`Unexpected file in the unsigned app archive: ${name}`);
      const stat = lstatSync(entry);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(entry);
        const resolved = path.resolve(path.dirname(entry), target);
        // Framework links such as Versions/Current stay inside the bundle.
        if (path.isAbsolute(target) || !resolved.startsWith(root + path.sep))
          throw new Error(
            `Symlink leaves the app: ${path.relative(directory, entry)}`
          );
      } else if (stat.isDirectory()) walk(entry);
      else if (!stat.isFile())
        throw new Error(
          `Unexpected file type: ${path.relative(directory, entry)}`
        );
    });
  })(directory);
  return stage;
}

function unpack(archive, directory, manifest) {
  // Never extract over an earlier attempt's files.
  mkdirSync(directory);
  run('ditto', ['-x', '-k', archive, directory]);
  return checkStage(directory, manifest);
}

function createDmg(directory, output, manifest) {
  const { volumeName } = checkStage(directory, manifest);
  rmSync(path.join(directory, MANIFEST));
  symlinkSync('/Applications', path.join(directory, 'Applications'));
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'palmdesk-dmg-build-'));
  const writable = path.join(scratch, 'writable.dmg');
  try {
    // HFS+ images can't be created on Apple Silicon; electron-builder uses
    // APFS there too.
    run('hdiutil', [
      'create',
      '-volname',
      volumeName,
      '-srcfolder',
      directory,
      '-fs',
      'APFS',
      '-format',
      'UDRW',
      '-ov',
      writable,
    ]);
    if (existsSync(path.join(directory, '.VolumeIcon.icns'))) {
      const mountpoint = attach(writable, { writable: true });
      try {
        run('xattr', ['-wx', 'com.apple.FinderInfo', CUSTOM_ICON, mountpoint]);
      } finally {
        detach(mountpoint);
      }
    }
    mkdirSync(path.dirname(output), { recursive: true });
    run('hdiutil', [
      'convert',
      writable,
      '-format',
      'UDZO',
      '-imagekey',
      'zlib-level=9',
      '-ov',
      '-o',
      output,
    ]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function verifyDmg(dmg, manifest, verify) {
  const { app, volumeName } = expectedNames(manifest);
  run('hdiutil', ['verify', dmg]);
  const mountpoint = attach(dmg);
  try {
    assert.equal(
      run('plutil', ['-extract', 'VolumeName', 'raw', '-o', '-', '-'], {
        input: run('diskutil', ['info', '-plist', mountpoint]),
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim(),
      volumeName
    );
    assert.equal(
      readlinkSync(path.join(mountpoint, 'Applications')),
      '/Applications'
    );
    verify(path.join(mountpoint, app));
  } finally {
    detach(mountpoint);
  }
}

if (require.main === module) {
  try {
    if (process.platform !== 'darwin') throw new Error('macOS is required.');
    const manifest = JSON.parse(
      readFileSync(path.join(__dirname, '../package.json'), 'utf8')
    );
    const [command, ...args] = process.argv.slice(2);
    if (command === 'stage' && args.length === 3) stage(...args);
    else if (command === 'unpack' && args.length === 2)
      unpack(...args, manifest);
    else if (command === 'dmg' && args.length === 2)
      createDmg(...args, manifest);
    else if (command === 'verify-dmg' && args.length === 1)
      verifyDmg(args[0], manifest, verify);
    else
      throw new Error(
        'Usage: macos-release.cjs stage <dmg> <app> <zip> | unpack <zip> <directory> | dmg <directory> <dmg> | verify-dmg <dmg>'
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkStage, createDmg, stage, unpack, verifyDmg };
