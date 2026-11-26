import { MAX_PHOTO_SIDE, requestPhoto } from '../community/request-photos';

export function photoDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Invalid image dimensions');
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Remove APP1–APP15 and comment segments from a canvas JPEG. iOS WebKit encodes canvas JPEGs with ImageIO,
 * which always adds an Exif block (pixel dimensions only); stored request photos carry no metadata at all.
 * Returns the input unchanged when it is not a parseable baseline/progressive JPEG data URL.
 */
export function stripJpegMetadata(dataUrl: string): string {
  const prefix = 'data:image/jpeg;base64,';
  if (!dataUrl.startsWith(prefix)) return dataUrl;
  let bytes: string;
  try { bytes = atob(dataUrl.slice(prefix.length)); } catch { return dataUrl; }
  if (bytes.charCodeAt(0) !== 0xff || bytes.charCodeAt(1) !== 0xd8) return dataUrl;
  let out = bytes.slice(0, 2), offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes.charCodeAt(offset) !== 0xff) return dataUrl;
    const marker = bytes.charCodeAt(offset + 1);
    if (marker === 0xda) return prefix + btoa(out + bytes.slice(offset)); // start of scan: copy the image data as is
    const length = bytes.charCodeAt(offset + 2) * 256 + bytes.charCodeAt(offset + 3);
    if (length < 2 || offset + 2 + length > bytes.length) return dataUrl;
    if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) out += bytes.slice(offset, offset + 2 + length);
    offset += 2 + length;
  }
  return dataUrl;
}

/** Store only canvas pixels. The original file, filename and EXIF/GPS are discarded. */
export async function prepareRequestPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Image could not be opened'));
      image.src = url;
    });
    const size = photoDimensions(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing unavailable');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    // Very detailed images can exceed the storage bound at 1024px. Reduce pixels,
    // keeping the requested JPEG quality, until the same validator accepts it.
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = stripJpegMetadata(canvas.toDataURL('image/jpeg', 0.8));
      if (requestPhoto(result)) return result;
      canvas.width = Math.max(1, Math.floor(canvas.width * 0.75));
      canvas.height = Math.max(1, Math.floor(canvas.height * 0.75));
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
    throw new Error('Image could not be prepared');
  } finally {
    image.onload = null; image.onerror = null;
    URL.revokeObjectURL(url);
  }
}
