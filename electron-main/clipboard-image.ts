import { clipboard, ClipboardItem, nativeImage } from 'electron';

const PNG = 'image/png';

/** Puts an image on the system clipboard as PNG (Electron's clipboard is MIME based). */
export function writeClipboardImage(image: Electron.NativeImage) {
  return clipboard.write([
    new ClipboardItem({
      [PNG]: new Blob([new Uint8Array(image.toPNG())], { type: PNG }),
    }),
  ]);
}

/** Reads the clipboard's image, or an empty image when it holds none. */
export async function readClipboardImage() {
  const item = (await clipboard.read()).find((entry) =>
    entry.types.includes(PNG)
  );
  if (!item) return nativeImage.createEmpty();
  const blob = await item.getType(PNG);
  return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
}
