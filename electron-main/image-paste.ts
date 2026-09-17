import { validateImage } from '../src/utils/image-payload';

import type { ICaptureSource } from '../src/pure-interface';
import type { ImagePayload } from '../src/utils/image-payload';

export function supportsImagePaste(source: ICaptureSource, platform: string) {
  return platform === 'darwin' && source.bundleId === 'com.openai.codex';
}

export async function pasteClipboardImage(
  payload: ImagePayload,
  current: () => boolean,
  driver: {
    decode: (bytes: Uint8Array) => Electron.NativeImage;
    write: (image: Electron.NativeImage) => void;
    press: () => Promise<unknown>;
    release: () => Promise<unknown>;
  }
) {
  const info = validateImage(payload);
  const image = driver.decode(payload.bytes);
  const size = image.getSize();
  if (image.isEmpty() || size.width * size.height !== info.width * info.height)
    throw new Error('无法解码图片，请重新选择');
  if (!current()) throw new Error('图片粘贴已取消');
  // Leave the image in the clipboard, as a normal copy/paste would. Restoring
  // immediately can race Codex's asynchronous reading of the pasteboard.
  driver.write(image);
  try {
    if (!current()) throw new Error('图片粘贴已取消');
    await driver.press();
  } finally {
    await driver.release();
  }
}
