const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const directory = path.resolve(__dirname, '../../.github/workflows');
const workflows = Object.fromEntries(
  fs
    .readdirSync(directory)
    .filter((name) => /\.ya?ml$/.test(name))
    // Windows checkouts may use CRLF line endings.
    .map((name) => [
      name,
      fs
        .readFileSync(path.join(directory, name), 'utf8')
        .replace(/\r\n/g, '\n'),
    ])
);

// Splits a workflow into its top-level jobs by indentation.
function jobs(source) {
  const lines = source.split('\n');
  const result = {};
  let current;
  lines.slice(lines.indexOf('jobs:') + 1).forEach((line) => {
    const header = line.match(/^ {2}([\w-]+):\s*$/);
    if (header) {
      current = header[1];
      result[current] = '';
    } else if (current) result[current] += `${line}\n`;
  });
  return result;
}

test('every action is pinned to a full commit SHA with its release in a comment', () => {
  Object.entries(workflows).forEach(([name, source]) => {
    const uses = [...source.matchAll(/^\s*(?:-\s+)?uses:\s*(.+)$/gm)].map(
      (match) => match[1].trim()
    );
    assert.ok(uses.length > 0, name);
    uses.forEach((value) =>
      assert.match(
        value,
        /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
        `${name}: ${value}`
      )
    );
  });
});

test('only the environment-gated signing job reads the certificate, and it installs nothing', () => {
  Object.entries(workflows).forEach(([name, source]) => {
    Object.entries(jobs(source)).forEach(([job, body]) =>
      assert.equal(
        /secrets\.PALMDESK_SIGNING_/.test(body),
        name === 'desktop-release.yml' && job === 'sign-macos',
        `${name}: ${job}`
      )
    );
  });
  const sign = jobs(workflows['desktop-release.yml'])['sign-macos'];
  assert.match(sign, /^ {4}environment: release$/m);
  assert.doesNotMatch(sign, /\b(pnpm|npm|npx|yarn|corepack|pip|brew)\b/);
  assert.doesNotMatch(sign, /^ {4}permissions:/m);
});

test('only signed macOS installers can be published', () => {
  const release = jobs(workflows['desktop-release.yml']);
  assert.match(release.build, /dist:mac --release --unsigned/);
  assert.match(release.build, /name: unsigned-mac-arm64/);
  assert.doesNotMatch(release.build, /name: installer-mac/);
  assert.match(release['sign-macos'], /name: installer-mac-arm64/);
  assert.match(release.publish, /needs: \[validate, build, sign-macos, sbom\]/);
  assert.match(release.publish, /pattern: installer-\*/);
});

test('release assets carry provenance and SBOM attestations', () => {
  const { publish } = jobs(workflows['desktop-release.yml']);
  assert.match(publish, /id-token: write/);
  assert.match(publish, /attestations: write/);
  assert.match(
    publish,
    /uses: actions\/attest@\w+ # v[\d.]+\n\s+with:\n\s+subject-checksums: release-assets\/SHA256SUMS\.txt\n/
  );
  assert.match(
    publish,
    /sbom-path: release-assets\/PalmDesk-.+-sbom\.cdx\.json/
  );
});

test('published images get BuildKit provenance, an SBOM and a keyless signature', () => {
  const { images } = jobs(workflows['images.yml']);
  assert.match(images, /id-token: write/);
  assert.match(images, /provenance: .*'mode=max'/);
  assert.match(
    images,
    /sbom: \$\{\{ steps\.image\.outputs\.publish == 'true' \}\}/
  );
  assert.match(images, /cosign sign --yes "\$IMAGE"/);
  assert.match(images, /IMAGE: .+@\$\{\{ steps\.build\.outputs\.digest \}\}/);
  assert.match(images, /Release image tags are never moved/);
});
