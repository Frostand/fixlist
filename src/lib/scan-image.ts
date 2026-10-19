import type { ScanPin } from './scan-model';

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

export interface ScanImagePoint { x: number; y: number }
/** A square around the chosen point limits room disclosure; normalized point comes from projection/picking. */
export function scanImageAnnotation(width: number, height: number, point: ScanImagePoint) {
  if (![width, height, point.x, point.y].every(Number.isFinite) || width < 1 || height < 1 || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
  const size = Math.min(width, height) * 0.5, output = Math.max(64, Math.min(320, Math.round(size) + 32)), inset = 16, content = output - inset * 2;
  const x = Math.min(width - size, Math.max(0, point.x * width - size / 2));
  const y = Math.min(height - size, Math.max(0, point.y * height - size / 2));
  return { x, y, size, output, inset, content, markerX: inset + (point.x * width - x) / size * content, markerY: inset + (point.y * height - y) / size * content, radius: 10 };
}
const annotationTag = 'FixList marked location crop v1';
/** A JPEG comment identifies app-produced marked crops, so legacy whole-room images require a fresh preview. */
function tagAnnotatedImage(image: string): string | null {
  if (!isSmallJpeg(image)) return null;
  const bytes = atob(image.split(',')[1]!), size = annotationTag.length + 2;
  const tagged = 'data:image/jpeg;base64,' + btoa(bytes.slice(0, 2) + '\xff\xfe' + String.fromCharCode(size >> 8, size & 255) + annotationTag + bytes.slice(2));
  return isSmallJpeg(tagged) ? tagged : null;
}
export function isAnnotatedScanImage(image: unknown): image is string {
  if (!isSmallJpeg(image)) return false;
  try { return atob(image.split(',')[1]!).slice(2, 6 + annotationTag.length) === '\xff\xfe' + String.fromCharCode(0, annotationTag.length + 2) + annotationTag; }
  catch { return false; }
}
/** Keep old private bytes in storage; only reviewed marked crops enter print/share projections. */
export function shareableScanPins(pins: readonly ScanPin[]): readonly ScanPin[] {
  return pins.map((pin) => ({ ...pin, image: isAnnotatedScanImage(pin.image) ? pin.image : null }));
}

/** Call immediately after rendering, before WebGL's drawing buffer is cleared. Pass a point for all new pins. */
export function captureScanImage(canvas: HTMLCanvasElement, point?: ScanImagePoint): string | null {
  try {
    if (!canvas.width || !canvas.height) return null;
    const small = document.createElement('canvas'), scale = Math.min(1, 320 / Math.max(canvas.width, canvas.height));
    const annotation = point ? scanImageAnnotation(canvas.width, canvas.height, point) : null;
    if (point && !annotation) return null;
    small.width = Math.max(1, Math.round(canvas.width * scale)); small.height = Math.max(1, Math.round(canvas.height * scale));
    if (annotation) small.width = small.height = annotation.output;
    const context = small.getContext('2d');
    if (!context) return null;
    if (annotation) {
      context.fillStyle = 'white'; context.fillRect(0, 0, small.width, small.height);
      context.drawImage(canvas, annotation.x, annotation.y, annotation.size, annotation.size, annotation.inset, annotation.inset, annotation.content, annotation.content);
      const { markerX: x, markerY: y, radius } = annotation;
      // White outline and dark cross stay visible over both dark and light surfaces.
      for (const [color, lineWidth] of [['white', 6], ['#172721', 3]] as const) {
        context.strokeStyle = color; context.lineWidth = lineWidth;
        context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2);
        context.moveTo(x - radius - 5, y); context.lineTo(x + radius + 5, y);
        context.moveTo(x, y - radius - 5); context.lineTo(x, y + radius + 5); context.stroke();
      }
    } else context.drawImage(canvas, 0, 0, small.width, small.height);
    const image = small.toDataURL('image/jpeg', 0.72);
    return annotation ? tagAnnotatedImage(image) : isSmallJpeg(image) ? image : null;
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
