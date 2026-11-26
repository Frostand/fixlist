/** Independent of scan evidence: request photos have no room/flag identities. */
export const MAX_REQUEST_PHOTOS = 3;
export const MAX_PHOTO_SIDE = 1024;
export const MAX_PHOTO_URL_LENGTH = 500000;

/** Validate canonical base64 and the bounded JPEG frame, rather than trusting its MIME label. */
export function requestPhoto(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_PHOTO_URL_LENGTH || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const encoded = value.slice(23);
    if (encoded.length % 4 !== 0) return false;
    const bytes = atob(encoded);
    if (btoa(bytes) !== encoded || bytes.length < 20 || bytes.charCodeAt(0) !== 255 || bytes.charCodeAt(1) !== 216 || bytes.charCodeAt(bytes.length - 2) !== 255 || bytes.charCodeAt(bytes.length - 1) !== 217) return false;
    const byte = (i: number) => bytes.charCodeAt(i);
    let frame = false;
    for (let offset = 2; offset < bytes.length - 2;) {
      if (byte(offset++) !== 255) return false;
      while (byte(offset) === 255) offset++;
      const marker = byte(offset++), length = byte(offset) * 256 + byte(offset + 1);
      // APP1 carries EXIF/GPS or XMP; canvas output does not need it.
      if (marker === 225 || marker === 216 || marker === 217 || length < 2 || offset + length > bytes.length - 2) return false;
      if (marker === 192 || marker === 193 || marker === 194) {
        const height = byte(offset + 3) * 256 + byte(offset + 4), width = byte(offset + 5) * 256 + byte(offset + 6);
        if (frame || length < 8 || width < 1 || height < 1 || width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE) return false;
        frame = true;
      }
      if (marker === 218) return frame && offset + length < bytes.length - 2;
      offset += length;
    }
  } catch { return false; }
  return false;
}

export function requestPhotos(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_REQUEST_PHOTOS) return false;
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i) || !requestPhoto(value[i])) return false;
  return true;
}
