/** Synchronous bounds check keeps JSON/storage validation independent of browser image decoding. */
export function isSmallJpeg(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 128 * 1024) return false;
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match?.[1] || match[1].length % 4 !== 0) return false;
  try {
    const bytes = atob(match[1]);
    if (!bytes.startsWith('\xff\xd8') || !bytes.endsWith('\xff\xd9')) return false;
    const word = (at: number) => bytes.charCodeAt(at) * 256 + bytes.charCodeAt(at + 1);
    for (let at = 2; at < bytes.length - 4;) {
      if (bytes.charCodeAt(at++) !== 255) return false;
      while (bytes.charCodeAt(at) === 255) at++;
      const marker = bytes.charCodeAt(at++), size = word(at);
      if (size < 2 || at + size > bytes.length) return false;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        const height = word(at + 3), width = word(at + 5);
        return size >= 8 && width >= 1 && height >= 1 && width <= 320 && height <= 320;
      }
      if (marker === 0xda || marker === 0xd9) return false;
      at += size;
    }
  } catch { /* Invalid base64. */ }
  return false;
}

/** Call immediately after rendering, before WebGL's drawing buffer is cleared. */
export function captureScanImage(canvas: HTMLCanvasElement): string | null {
  try {
    if (!canvas.width || !canvas.height) return null;
    const small = document.createElement('canvas'), scale = Math.min(1, 320 / Math.max(canvas.width, canvas.height));
    small.width = Math.max(1, Math.round(canvas.width * scale)); small.height = Math.max(1, Math.round(canvas.height * scale));
    const context = small.getContext('2d');
    if (!context) return null;
    context.drawImage(canvas, 0, 0, small.width, small.height);
    const image = small.toDataURL('image/jpeg', 0.72);
    return isSmallJpeg(image) ? image : null;
  } catch { return null; }
}

/** Legacy model files may carry PNG thumbnails; new manual captures are always JPEG. */
export function isSmallScanImage(value: unknown): value is string {
  if (isSmallJpeg(value)) return true;
  if (typeof value !== 'string' || value.length > 128 * 1024) return false;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match?.[1] || match[1].length % 4 !== 0) return false;
  try {
    const bytes = atob(match[1]);
    if (!bytes.startsWith('\x89PNG\r\n\x1a\n') || bytes.slice(12, 16) !== 'IHDR' || bytes.length < 33) return false;
    const word = (at: number) => ((bytes.charCodeAt(at) * 256 + bytes.charCodeAt(at + 1)) * 256 + bytes.charCodeAt(at + 2)) * 256 + bytes.charCodeAt(at + 3);
    const width = word(16), height = word(20);
    return width >= 1 && height >= 1 && width <= 320 && height <= 320;
  } catch { return false; }
}
