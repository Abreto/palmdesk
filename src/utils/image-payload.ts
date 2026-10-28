export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 24 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 16384;

export type ImageMime = 'image/png' | 'image/jpeg';
export type ImagePayload = { mime: ImageMime; bytes: Uint8Array };

export function fitsImageBounds(width: number, height: number) {
  return (
    width <= MAX_IMAGE_SIDE &&
    height <= MAX_IMAGE_SIDE &&
    width * height <= MAX_IMAGE_PIXELS
  );
}

// Round up so a size just over the limit never reads as the limit itself.
export function formatImageBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil((bytes / 1024) * 10) / 10} KB`;
  return `${Math.ceil((bytes / 1024 / 1024) * 10) / 10} MB`;
}

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
  if (!fitsImageBounds(width, height))
    throw new Error('图片尺寸过大，请缩小后重试');
  return { mime, width, height };
}

// The EXIF orientation of a JPEG, 1 when absent or unreadable. Orientations
// 5–8 display the stored frame turned by 90°. Only for display: transfers and
// validation use the stored frame.
export function exifOrientation(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
    const end = offset + length;
    if (length < 2 || end > bytes.length) break;
    const tiff = offset + 8;
    if (
      marker === 0xe1 &&
      tiff + 8 <= end &&
      [0x45, 0x78, 0x69, 0x66, 0, 0].every(
        (byte, index) => bytes[offset + 2 + index] === byte
      )
    ) {
      const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      if (!little && (bytes[tiff] !== 0x4d || bytes[tiff + 1] !== 0x4d))
        return 1;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > end) return 1;
      const count = view.getUint16(ifd, little);
      for (let index = 0; index < count; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (entry + 12 > end) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset = end;
  }
  return 1;
}

export function validateImage(payload: ImagePayload) {
  const info = inspectImage(payload?.bytes);
  if (info.mime !== payload.mime) throw new Error('图片格式与内容不符');
  return info;
}
