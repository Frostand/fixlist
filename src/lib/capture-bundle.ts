import type { CaptureManifest } from './capture-types';
import { CaptureError, captureFail, jpegDimensions, plainRecord, sha256Bytes, validateCaptureManifest, type CaptureResult } from './capture-model';

export const MAX_CAPTURE_BUNDLE_BYTES = 48 * 1024 * 1024;
export interface CaptureBundleData { manifest: CaptureManifest; photos: ReadonlyMap<string, Blob> }
export function captureBundleName(capture: CaptureManifest): string { return `${capture.captureId}.fixlist-capture.json`; }
export function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export async function buildCaptureBundle(capture: CaptureManifest, photos: ReadonlyMap<string, Blob>): Promise<{ fileName: string; text: string }> {
  const valid = validateCaptureManifest(capture);
  if (!valid.ok) throw new CaptureError(valid.code, valid.error);
  if (photos.size !== capture.photos.length) throw new CaptureError('INVALID_CAPTURE', 'The room photos are incomplete.');
  if ([...photos.values()].reduce((s, p) => s + 4 * Math.ceil(p.size / 3), 0) > MAX_CAPTURE_BUNDLE_BYTES) throw new CaptureError('CAPACITY', 'This capture is too large to export (48 MiB limit).');
  const encoded = [];
  for (const photo of capture.photos) {
    const blob = photos.get(photo.photoId);
    if (!blob) throw new CaptureError('INVALID_CAPTURE', 'A room photo is missing.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const dimensions = jpegDimensions(bytes);
    if (!dimensions || dimensions.width !== photo.width || dimensions.height !== photo.height || await sha256Bytes(bytes) !== photo.sha256) throw new CaptureError('INVALID_CAPTURE', 'A room photo does not match its saved hash or dimensions.');
    encoded.push({ ...photo, jpeg: bytesToBase64(bytes) });
  }
  const text = JSON.stringify({ ...capture, photos: encoded });
  if (new Blob([text]).size > MAX_CAPTURE_BUNDLE_BYTES) throw new CaptureError('CAPACITY', 'This capture is too large to export (48 MiB limit).');
  return { fileName: captureBundleName(capture), text };
}
export async function parseCaptureBundle(text: string): Promise<CaptureResult<CaptureBundleData>> {
  if (new Blob([text]).size > MAX_CAPTURE_BUNDLE_BYTES) return captureFail('Capture bundle exceeds 48 MiB.', 'CAPACITY');
  let value: unknown;
  try { value = JSON.parse(text); } catch { return captureFail('Capture bundle is not valid JSON.'); }
  if (!plainRecord(value) || !Array.isArray(value.photos) || value.photos.length > 40) return captureFail('Capture bundle photos are missing.');
  const photos = new Map<string, Blob>(), manifestPhotos = [];
  for (const p of value.photos) {
    if (!plainRecord(p) || typeof p.jpeg !== 'string' || p.jpeg.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(p.jpeg)) return captureFail('Invalid JPEG base64.');
    const { jpeg, ...photo } = p;
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = Uint8Array.from(atob(jpeg), (c) => c.charCodeAt(0)); } catch { return captureFail('Invalid JPEG base64.'); }
    const dimensions = jpegDimensions(bytes);
    if (!dimensions || dimensions.width !== photo.width || dimensions.height !== photo.height || bytesToBase64(bytes) !== jpeg || await sha256Bytes(bytes) !== photo.sha256) return captureFail('Capture photo JPEG, dimensions or SHA-256 does not match.');
    photos.set(photo.photoId as string, new Blob([bytes], { type: 'image/jpeg' })); manifestPhotos.push(photo);
  }
  const valid = validateCaptureManifest({ ...value, photos: manifestPhotos });
  return valid.ok ? { ok: true, value: { manifest: valid.value, photos } } : valid;
}
