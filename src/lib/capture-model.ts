import { demoScenario } from '../data/demo-scenario';
import type { DemoScenario } from '../domain/types';
import type { CaptureCamera, CaptureManifest, NativeCaptureResult, Vec2 } from './capture-types';

export type CaptureErrorCode = 'INVALID_CAPTURE' | 'CAPTURE_MISMATCH' | 'CAPACITY' | 'CANCELLED' | 'STORAGE';
export type CaptureResult<T> = { ok: true; value: T } | { ok: false; error: string; code: CaptureErrorCode };
export class CaptureError extends Error {
  constructor(public readonly code: CaptureErrorCode, message: string) { super(message); this.name = 'CaptureError'; }
}
export const captureFail = (error: string, code: CaptureErrorCode = 'INVALID_CAPTURE'): { ok: false; error: string; code: CaptureErrorCode } => ({ ok: false, error, code });
export function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).every((key) => typeof key === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
}
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
export const finiteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const unitProbability = (v: unknown): v is number => finiteNumber(v) && v >= 0 && v <= 1;
export const sha256String = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
export function captureDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(v)) return false;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 19) === v.slice(0, 19);
}
function denseArray(v: unknown): v is unknown[] { return Array.isArray(v) && Object.keys(v).length === v.length && [...v.keys()].every((i) => Object.hasOwn(v, i)); }
const point = (v: unknown): v is Vec2 => denseArray(v) && v.length === 2 && v.every((n) => finiteNumber(n) && Math.abs(n) <= 50);
function camera(value: unknown, width: number, height: number): value is CaptureCamera | null {
  if (value === null) return true;
  if (!plainRecord(value) || !exactKeys(value, ['transform', 'intrinsics', 'tracking']) || !['normal', 'limited'].includes(value.tracking as string)
    || !denseArray(value.transform) || value.transform.length !== 16 || !value.transform.every(finiteNumber)
    || !denseArray(value.intrinsics) || value.intrinsics.length !== 4 || !value.intrinsics.every((n) => finiteNumber(n) && n > 0)) return false;
  const m = value.transform as number[], k = value.intrinsics as number[];
  if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1 || k[2]! >= width || k[3]! >= height) return false;
  const dot = (a: number, b: number) => [0, 1, 2].reduce((sum, i) => sum + m[a * 4 + i]! * m[b * 4 + i]!, 0);
  for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) if (Math.abs(dot(a, b) - (a === b ? 1 : 0)) > 1e-3) return false;
  const det = m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
  return Math.abs(det - 1) <= 1e-3;
}
/** Exact, data-only manifest validation. Catalog IDs are checked even for extra photos. */
export function validateCaptureManifest(value: unknown, catalog: Pick<DemoScenario, 'rooms' | 'checklist'> = demoScenario): CaptureResult<CaptureManifest> {
  if (!plainRecord(value) || !exactKeys(value, ['format', 'version', 'captureId', 'roomId', 'createdAt', 'mode', 'floorY', 'outline', 'doors', 'photos'])
    || value.format !== 'fixlist-room-capture' || value.version !== 1 || typeof value.captureId !== 'string' || !/^cap-[a-z0-9-]{8,40}$/.test(value.captureId)
    || !catalog.rooms.some((r) => r.id === value.roomId) || !captureDate(value.createdAt) || !['arkit', 'photos'].includes(value.mode as string)
    || !(value.floorY === null || finiteNumber(value.floorY)) || !denseArray(value.doors) || value.doors.length > 8 || !value.doors.every(point)
    || !denseArray(value.photos) || value.photos.length < 1 || value.photos.length > 40) return captureFail('Invalid room capture fields, room, date or photo count.');
  const outline = value.outline;
  if (outline !== null && (!plainRecord(outline) || !exactKeys(outline, ['closed', 'points']) || typeof outline.closed !== 'boolean'
    || !denseArray(outline.points) || outline.points.length < 3 || outline.points.length > 32 || !outline.points.every(point)
    || outline.points.some((p, i, points) => i > 0 && p[0] === points[i - 1]![0] && p[1] === points[i - 1]![1]))) return captureFail('Invalid room outline.');
  const ids = new Set<string>();
  for (const p of value.photos) {
    if (!plainRecord(p) || !exactKeys(p, ['photoId', 'checklistItemId', 'takenAt', 'width', 'height', 'sha256', 'camera'])
      || typeof p.photoId !== 'string' || !/^p[0-9]{2,3}$/.test(p.photoId) || ids.has(p.photoId)
      || !(p.checklistItemId === null || catalog.checklist.some((q) => q.id === p.checklistItemId)) || !captureDate(p.takenAt)
      || ![p.width, p.height].every((n) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 1600)
      || !sha256String(p.sha256) || !camera(p.camera, p.width as number, p.height as number)) return captureFail('Invalid capture photo, hash or camera.');
    ids.add(p.photoId);
  }
  if (value.mode === 'photos' && (value.floorY !== null || outline !== null || value.doors.length !== 0 || value.photos.some((p) => !plainRecord(p) || p.camera !== null))) return captureFail('Photos-only captures cannot contain AR geometry.');
  if (value.mode === 'arkit' && value.floorY === null && (outline !== null || value.doors.length > 0)) return captureFail('A room outline or doors require a floor plane.');
  return { ok: true, value: structuredClone(value) as unknown as CaptureManifest };
}
export function validateNativeCaptureResult(value: unknown): CaptureResult<NativeCaptureResult> {
  if (!plainRecord(value) || !Object.hasOwn(value, 'files')) return captureFail('Native capture files are missing.');
  const { files, ...manifest } = value;
  const parsed = validateCaptureManifest({ ...manifest, roomId: manifest.roomId === '' ? demoScenario.rooms[0]!.id : manifest.roomId });
  if (!parsed.ok) return parsed;
  if (!plainRecord(files) || !exactKeys(files, parsed.value.photos.map((p) => p.photoId))
    || !parsed.value.photos.every((p) => {
      const url = files[p.photoId];
      if (typeof url !== 'string') return false;
      try { const u = new URL(url); return u.protocol === 'file:' && !u.host && !u.search && !u.hash && decodeURIComponent(u.pathname).includes(`/Library/Caches/fixlist-captures/${parsed.value.captureId}/`) && !decodeURIComponent(u.pathname).split('/').includes('..'); } catch { return false; }
    }) || new Set(Object.values(files)).size !== parsed.value.photos.length) return captureFail('Native capture requires one local cache file URL per photo.');
  return { ok: true, value: { ...parsed.value, roomId: manifest.roomId as string, files: { ...files } as Record<string, string> } };
}
export function newCaptureId(): string { return `cap-${crypto.randomUUID()}`; }
export async function sha256Bytes(bytes: Uint8Array<ArrayBuffer> | ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
export async function sha256Blob(blob: Blob): Promise<string> { return sha256Bytes(await blob.arrayBuffer()); }
/** Header/scan structure and dimensions, without browser decoding or trusting a MIME label. */
export function jpegDimensions(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
  const word = (i: number) => b[i]! * 256 + b[i + 1]!;
  let dimensions: { width: number; height: number } | null = null;
  for (let at = 2; at < b.length - 3;) {
    if (b[at++] !== 0xff) return null;
    while (b[at] === 0xff) at++;
    const marker = b[at++], length = word(at);
    if (length < 2 || at + length > b.length - 2) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker!)) {
      if (length < 8 || dimensions) return null;
      const height = word(at + 3), width = word(at + 5);
      if (width < 1 || height < 1 || width > 1600 || height > 1600) return null;
      dimensions = { width, height };
    }
    if (marker === 0xda) return length >= 6 && at + length < b.length - 2 ? dimensions : null;
    at += length;
  }
  return null;
}
export function isJpegBytes(b: Uint8Array): boolean { return jpegDimensions(b) !== null; }
