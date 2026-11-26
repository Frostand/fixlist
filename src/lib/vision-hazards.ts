import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { CaptureError, captureDate, captureFail, exactKeys, finiteNumber, jpegDimensions, plainRecord, sha256Blob, unitProbability, validateCaptureManifest, type CaptureResult } from './capture-model';
import { bytesToBase64 } from './capture-bundle';
import type { CaptureManifest } from './capture-types';
import type { CaptureStore, StoredCapture } from './capture-storage';
import type { Vec3 } from './room-geometry';
export { bytesToBase64 } from './capture-bundle';
export async function jpegBlobToBase64(blob: Blob): Promise<string> {
  if (!(blob instanceof Blob) || blob.type !== 'image/jpeg' || !blob.size || blob.size > 24 * 1024 * 1024) throw new CaptureError('INVALID_CAPTURE', 'Invalid or oversized AI review JPEG.');
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

export const HAZARD_CATEGORIES = ['trip', 'slip', 'lighting', 'stairs', 'bathroom', 'fire', 'reach', 'furniture', 'other'] as const;
export const HAZARD_SEVERITIES = ['high', 'medium', 'low'] as const;
export interface VisionModel { id: string; license: string; bytes: number }
export interface VisionHazard {
  label: string; detail: string; tip: string;
  category: typeof HAZARD_CATEGORIES[number]; severity: typeof HAZARD_SEVERITIES[number];
  box: { x: number; y: number; w: number; h: number } | null;
  direction: Vec3 | null; thumbnail: string | null;
}
export interface VisionResponse { model: string | VisionModel; hazards: readonly VisionHazard[] }
export interface VisionAvailability {
  available: boolean; state: 'ready' | 'needs-download' | 'downloading' | 'unsupported';
  model: VisionModel | null; progress?: number; reason?: string;
}
export interface VisionProgress { fraction: number; phase: 'download' | 'load' }
interface VisionPlugin {
  availability(): Promise<unknown>; prepare(): Promise<unknown>;
  addListener(name: 'visionProgress', listener: (event: unknown) => void): Promise<PluginListenerHandle>;
  describePhoto(options: { photoId: string; jpegBase64: string }): Promise<unknown>;
  describePanorama(options: { stopId: string; jpegBase64: string }): Promise<unknown>;
}
export const FixListVision = registerPlugin<VisionPlugin>('FixListVision');
export interface AIReviewSource {
  kind: 'panorama' | 'photo'; id: string; sha256: string; model: string | VisionModel; hazards: readonly VisionHazard[];
}
/** Optional local sidecar. Every source is present, in manifest order, even when it has no suggestions. */
export interface AIReview {
  format: 'fixlist-ai-review'; version: 1; captureId: string; roomId: string; createdAt: string;
  sources: readonly AIReviewSource[];
}
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const dense = (v: unknown): v is unknown[] => Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype
  && Reflect.ownKeys(v).length === v.length + 1 && Array.from({ length: v.length }, (_, i) => i)
    .every(i => Object.hasOwn(Object.getOwnPropertyDescriptor(v, i) ?? {}, 'value'));
function validModel(v: unknown): v is VisionModel { return plainRecord(v) && exactKeys(v, ['id', 'license', 'bytes']) && text(v.id, 200) && text(v.license, 500) && Number.isSafeInteger(v.bytes) && (v.bytes as number) > 0; }
export function validateVisionResponse(value: unknown): CaptureResult<VisionResponse> {
  if (!plainRecord(value) || !exactKeys(value, ['model', 'hazards']) || !(text(value.model, 200) || validModel(value.model))
    || !dense(value.hazards) || value.hazards.length > 30) return captureFail('Invalid on-device AI response.');
  for (const h of value.hazards) {
    if (!plainRecord(h) || !exactKeys(h, ['label', 'detail', 'tip', 'category', 'severity', 'box', 'direction', 'thumbnail'])
      || !text(h.label, 60) || !text(h.detail, 240) || !text(h.tip, 240)
      || !HAZARD_CATEGORIES.includes(h.category as VisionHazard['category']) || !HAZARD_SEVERITIES.includes(h.severity as VisionHazard['severity'])) return captureFail('Invalid AI suggestion fields.');
    if (h.box !== null && (!plainRecord(h.box) || !exactKeys(h.box, ['x', 'y', 'w', 'h']) || !Object.values(h.box).every(unitProbability)
      || (h.box.w as number) <= 0 || (h.box.h as number) <= 0 || (h.box.x as number) + (h.box.w as number) > 1.000001 || (h.box.y as number) + (h.box.h as number) > 1.000001)) return captureFail('Invalid AI suggestion box.');
    if (h.direction !== null && (!dense(h.direction) || h.direction.length !== 3 || !h.direction.every(finiteNumber)
      || Math.abs(Math.hypot(...h.direction as number[]) - 1) > 0.01)) return captureFail('Invalid AI suggestion direction.');
    if (h.thumbnail !== null) {
      if (typeof h.thumbnail !== 'string' || h.thumbnail.length > 40 * 1024 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(h.thumbnail)) return captureFail('Invalid AI thumbnail.');
      try {
        const encoded = h.thumbnail.slice(23), bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        if (bytes.length > 40 * 1024 || bytesToBase64(bytes) !== encoded || !jpegDimensions(bytes)) return captureFail('Invalid AI thumbnail JPEG.');
      } catch { return captureFail('Invalid AI thumbnail base64.'); }
    }
  }
  return { ok: true, value: structuredClone(value) as unknown as VisionResponse };
}
export function reviewSources(capture: CaptureManifest) {
  return [...(capture.tour?.stops ?? []).map(s => ({ kind: 'panorama' as const, id: s.stopId, sha256: s.panorama.sha256, fileId: s.panorama.fileId })),
    ...capture.photos.map(p => ({ kind: 'photo' as const, id: p.photoId, sha256: p.sha256, fileId: p.photoId }))];
}
export function validateAIReview(value: unknown, capture: CaptureManifest): CaptureResult<AIReview> {
  if (!plainRecord(value) || !exactKeys(value, ['format', 'version', 'captureId', 'roomId', 'createdAt', 'sources'])
    || value.format !== 'fixlist-ai-review' || value.version !== 1 || value.captureId !== capture.captureId || value.roomId !== capture.roomId
    || !captureDate(value.createdAt) || !dense(value.sources)) return captureFail('Invalid AI review or capture binding.');
  const expected = reviewSources(capture);
  if (expected.length !== value.sources.length) return captureFail('AI review evidence is incomplete.');
  for (const [i, source] of value.sources.entries()) {
    const e = expected[i]!;
    if (!plainRecord(source) || !exactKeys(source, ['kind', 'id', 'sha256', 'model', 'hazards']) || source.kind !== e.kind || source.id !== e.id || source.sha256 !== e.sha256
      || !validateVisionResponse({ model: source.model, hazards: source.hazards }).ok) return captureFail('AI review does not match the saved evidence.');
  }
  return { ok: true, value: structuredClone(value) as unknown as AIReview };
}
const unsupported = (): VisionAvailability => ({ available: false, state: 'unsupported', model: null, reason: 'On-device AI review requires the supported iPhone app. No review was run.' });
export async function visionAvailability(): Promise<VisionAvailability> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return unsupported();
  try {
    const v = await FixListVision.availability();
    if (!plainRecord(v) || !['available', 'state', 'model', 'progress', 'reason'].every(k => !Object.hasOwn(v, k) || Object.getOwnPropertyDescriptor(v, k)?.get === undefined)
      || Object.keys(v).some(k => !['available', 'state', 'model', 'progress', 'reason'].includes(k)) || typeof v.available !== 'boolean'
      || !['ready', 'needs-download', 'downloading', 'unsupported'].includes(v.state as string) || v.state === 'ready' && !v.available || v.state === 'unsupported' && v.available
      || !(validModel(v.model) || v.state === 'unsupported' && (v.model === null || v.model === undefined))
      || v.progress !== undefined && !unitProbability(v.progress) || v.reason !== undefined && !text(v.reason, 1000)) return unsupported();
    return { ...v, model: v.model ?? null } as unknown as VisionAvailability;
  } catch { return unsupported(); }
}
function requireCurrent(options: { isCurrent?: () => boolean; signal?: AbortSignal }) {
  if (options.signal?.aborted || options.isCurrent && !options.isCurrent()) throw new CaptureError('CANCELLED', 'AI review cancelled because this room view changed.');
}
// A cancelled native call cannot be interrupted: retain the global queue until it settles.
let tail: Promise<unknown> = Promise.resolve();
function exclusive<T>(run: () => Promise<T>): Promise<T> { const next = tail.then(run); tail = next.catch(() => undefined); return next; }
export function prepareVision(options: { isCurrent?: () => boolean; signal?: AbortSignal; onProgress?(p: VisionProgress): void } = {}): Promise<void> {
  return exclusive(async () => {
    requireCurrent(options);
    const a = await visionAvailability(); requireCurrent(options);
    if (a.state === 'unsupported') throw new Error(a.reason);
    let listener: PluginListenerHandle | undefined;
    try {
      listener = await FixListVision.addListener('visionProgress', v => {
        if (options.signal?.aborted || options.isCurrent && !options.isCurrent()) return;
        if (plainRecord(v) && exactKeys(v, ['fraction', 'phase']) && unitProbability(v.fraction) && ['download', 'load'].includes(v.phase as string)) options.onProgress?.(v as unknown as VisionProgress);
      });
      requireCurrent(options);
      const result = await FixListVision.prepare(); requireCurrent(options);
      if (!plainRecord(result) || !exactKeys(result, ['available']) || result.available !== true) throw new Error('The on-device AI model could not load.');
    } finally { await listener?.remove(); }
  });
}
export function analyzeCaptureVision(record: StoredCapture, options: { isCurrent?: () => boolean; signal?: AbortSignal; onProgress?(p: { kind: 'panorama' | 'photo'; current: number; total: number }): void } = {}): Promise<AIReview> {
  return exclusive(async () => {
    requireCurrent(options);
    const parsed = validateCaptureManifest(record.manifest); if (!parsed.ok) throw new CaptureError(parsed.code, parsed.error);
    const capture = parsed.value, photos = new Map(record.photos), panoramas = new Map(record.panoramaBlobs), sources = reviewSources(capture);
    const a = await visionAvailability(); requireCurrent(options);
    if (a.state !== 'ready' || !a.available) throw new Error(a.reason ?? 'Download the on-device AI model before checking this room.');
    // Verify all bytes before sending any of them to native.
    for (const source of sources) {
      requireCurrent(options);
      const blob = (source.kind === 'panorama' ? panoramas : photos).get(source.fileId);
      if (!(blob instanceof Blob) || blob.type !== 'image/jpeg' || blob.size > 24 * 1024 * 1024 || await sha256Blob(blob) !== source.sha256) throw new CaptureError('INVALID_CAPTURE', 'AI review evidence does not match its saved hash.');
      const d = jpegDimensions(new Uint8Array(await blob.arrayBuffer()), source.kind === 'panorama' ? 4096 : 1600);
      const dimensions = source.kind === 'panorama' ? capture.tour!.stops.find(s => s.stopId === source.id)!.panorama : capture.photos.find(p => p.photoId === source.id)!;
      if (!d || d.width !== dimensions.width || d.height !== dimensions.height) throw new CaptureError('INVALID_CAPTURE', 'AI review image dimensions do not match.');
    }
    const results: AIReviewSource[] = [];
    for (const source of sources) {
      requireCurrent(options);
      const group = sources.filter(s => s.kind === source.kind);
      options.onProgress?.({ kind: source.kind, current: group.indexOf(source) + 1, total: group.length });
      const blob = (source.kind === 'panorama' ? panoramas : photos).get(source.fileId)!;
      const jpegBase64 = await jpegBlobToBase64(blob); requireCurrent(options);
      const raw = await (source.kind === 'panorama' ? FixListVision.describePanorama({ stopId: source.id, jpegBase64 }) : FixListVision.describePhoto({ photoId: source.id, jpegBase64 }));
      requireCurrent(options);
      const result = validateVisionResponse(raw); if (!result.ok) throw new CaptureError(result.code, result.error);
      const modelId = typeof result.value.model === 'string' ? result.value.model : result.value.model.id;
      if (modelId !== a.model?.id) throw new CaptureError('INVALID_CAPTURE', 'AI response model does not match the available on-device model.');
      results.push({ kind: source.kind, id: source.id, sha256: source.sha256, ...result.value });
    }
    return { format: 'fixlist-ai-review', version: 1, captureId: capture.captureId, roomId: capture.roomId, createdAt: new Date().toISOString(), sources: results };
  });
}
export async function analyzeAndSaveVision(roomId: string, options: { store: CaptureStore; isCurrent: () => boolean; signal?: AbortSignal; onProgress?(p: { kind: 'panorama' | 'photo'; current: number; total: number }): void }): Promise<AIReview> {
  requireCurrent(options); const record = await options.store.read(roomId); requireCurrent(options);
  if (!record) throw new CaptureError('CAPTURE_MISMATCH', 'This room has no saved walk-through.');
  const review = await analyzeCaptureVision(record, options); requireCurrent(options);
  if (!options.store.writeAIReview) throw new CaptureError('STORAGE', 'AI review storage is unavailable.');
  await options.store.writeAIReview(roomId, review, () => { try { requireCurrent(options); return true; } catch { return false; } });
  return review;
}
