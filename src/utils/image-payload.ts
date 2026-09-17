export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 24 * 1024 * 1024;

export type ImageMime = 'image/png' | 'image/jpeg';
export type ImagePayload = { mime: ImageMime; bytes: Uint8Array };

// Inspect dimensions before native decoding so compressed images cannot allocate
// an unbounded bitmap. The desktop decoder still validates the complete image.
export function inspectImage(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || !bytes.length)
    throw new Error('图片内容为空或无效');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('图片不能超过 10 MB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let mime: ImageMime;
  let width = 0;
  let height = 0;
  if (
    bytes.length >= 33 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte) &&
    view.getUint32(8) === 13 &&
    view.getUint32(12) === 0x49484452
  ) {
    mime = 'image/png';
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = 'image/jpeg';
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      offset += 1;
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        length >= 8 &&
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  } else throw new Error('请选择 PNG 或 JPEG 图片');
  if (!width || !height) throw new Error('无法读取图片，请重新选择');
  if (width > 16384 || height > 16384 || width * height > MAX_IMAGE_PIXELS)
    throw new Error('图片尺寸过大，请缩小后重试');
  return { mime, width, height };
}

export function validateImage(payload: ImagePayload) {
  const info = inspectImage(payload?.bytes);
  if (info.mime !== payload.mime) throw new Error('图片格式与内容不符');
  return info;
}
