import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import iconGen from 'icon-gen';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(
  path.join(root, 'build/source/palmdesk-mark.svg'),
  'utf8'
);
const artwork = source.match(/<g\b[\s\S]*<\/g>/)?.[0];
if (!artwork)
  throw new Error('PalmDesk source must contain one artwork group.');
const reversed = artwork.replaceAll('#167C65', '#F6F7F2');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const output = path.join(root, 'build/icons');
const temporary = await mkdtemp(path.join(tmpdir(), 'palmdesk-icons-'));

function tile(desktop) {
  // Desktop icons need outer transparent space. Browser icons use the full tile.
  const inset = desktop ? 8 : 0;
  const width = 128 - inset * 2;
  const radius = desktop ? 25 : 29;
  const transform = desktop
    ? 'translate(19.2 17.6) scale(.7)'
    : 'translate(12.8 11.2) scale(.8)';
  const fill = desktop ? 'url(#forest)' : '#167C65';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <title>PalmDesk</title>
  <desc>A desktop window resting in an open palm</desc>
  ${desktop ? '<defs><linearGradient id="forest" x1="0" y1="0" x2="0.8" y2="1"><stop stop-color="#218D73"/><stop offset=".55" stop-color="#167C65"/><stop offset="1" stop-color="#116B57"/></linearGradient></defs>' : ''}<rect x="${inset}" y="${inset}" width="${width}" height="${width}" rx="${radius}" fill="${fill}"/>
  <g transform="${transform}">${reversed}</g>
</svg>
`;
}

function png(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } })
    .render()
    .asPng();
}

try {
  const app = tile(true);
  const favicon = tile(false);
  await mkdir(output, { recursive: true });
  await copyFile(
    path.join(root, 'build/source/palmdesk-mark.svg'),
    path.join(root, 'src/assets/img/palmdesk-mark.svg')
  );
  await writeFile(path.join(root, 'build/source/palmdesk.svg'), app);
  await writeFile(path.join(root, 'build/source/palmdesk.png'), png(app, 1024));
  await writeFile(path.join(root, 'public/favicon.svg'), favicon);
  // Render each size from vectors, without resampling a large bitmap.
  await Promise.all(
    sizes.map(async (size) => {
      const data = png(app, size);
      await writeFile(path.join(output, `${size}x${size}.png`), data);
      await writeFile(path.join(temporary, `${size}.png`), data);
    })
  );
  await iconGen(temporary, output, {
    ico: { name: 'icon', sizes: [16, 24, 32, 48, 64, 128, 256] },
    icns: { name: 'icon', sizes: [16, 32, 64, 128, 256, 512, 1024] },
  });
  await Promise.all(
    [16, 24, 32, 48, 64].map((size) =>
      writeFile(path.join(temporary, `${size}.png`), png(favicon, size))
    )
  );
  await iconGen(temporary, path.join(root, 'public'), {
    ico: { name: 'favicon', sizes: [16, 24, 32, 48, 64] },
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
