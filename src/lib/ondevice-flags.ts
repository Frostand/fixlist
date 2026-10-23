import { Capacitor, registerPlugin } from '@capacitor/core';
import { CaptureError, exactKeys, jpegDimensions, plainRecord, sha256Blob, unitProbability, validateCaptureManifest } from './capture-model';
import type { CaptureStore, StoredCapture } from './capture-storage';
import { getCaptureStore } from './capture-storage';
import { validateCaptureSuggestions } from './capture-suggestions';
import type { CaptureSuggestionsFile, PixelPoint } from './capture-types';
import { ONDEVICE_MODEL, ONDEVICE_THRESHOLDS } from './ondevice-model';
import { isTrustedOndeviceModel, ondeviceFlagCopy } from './ondevice-contract';
export { ondeviceFlagCopy } from './ondevice-contract';
import { trustedPhotoQuestions, TRUSTED_SUGGESTION_NOTICE } from './scan-suggestions';

interface NativeItem { relevance: number; point: PixelPoint | null }
interface HazardPlugin {
  availability(): Promise<unknown>;
  analyze(options: { photos: { photoId: string; jpegBase64: string }[] }): Promise<unknown>;
}
const plugin = registerPlugin<HazardPlugin>('FixListHazards');
const invalid = (message = 'The on-device photo check returned incomplete or invalid evidence.') => new CaptureError('INVALID_CAPTURE', message);
const cancelled = () => new CaptureError('CANCELLED', 'This room view changed. Reload before saving.');
function assertCurrent(isCurrent?: () => boolean): void { if (isCurrent && !isCurrent()) throw cancelled(); }

/** Browsers/Android/missing native resources fail closed; this does not use a network fallback. */
export async function ondeviceFlagsAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return false;
  try {
    const value = await plugin.availability();
    return plainRecord(value) && value.available === true && isTrustedOndeviceModel(value.model);
  } catch { return false; }
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function nativePhoto(value: unknown, photoId: string, width: number, height: number): Record<string, NativeItem> {
  if (!plainRecord(value) || !exactKeys(value, ['model', 'photos']) || !isTrustedOndeviceModel(value.model) || !Array.isArray(value.photos) || value.photos.length !== 1) throw invalid();
  const photo: unknown = value.photos[0];
  if (!plainRecord(photo) || !exactKeys(photo, ['photoId', 'items']) || photo.photoId !== photoId || !plainRecord(photo.items)
    || !exactKeys(photo.items, trustedPhotoQuestions.map((q) => q.checklistItemId))) throw invalid();
  const result: Record<string, NativeItem> = {};
  for (const { checklistItemId } of trustedPhotoQuestions) {
    const item = photo.items[checklistItemId];
    if (!plainRecord(item) || !exactKeys(item, ['relevance', 'point']) || !unitProbability(item.relevance) || item.relevance === 1) throw invalid();
    if (item.point !== null && (!plainRecord(item.point) || !exactKeys(item.point, ['u', 'v']) || typeof item.point.u !== 'number' || !Number.isFinite(item.point.u)
      || typeof item.point.v !== 'number' || !Number.isFinite(item.point.v) || item.point.u < 0 || item.point.u >= width || item.point.v < 0 || item.point.v >= height)) throw invalid();
    result[checklistItemId] = { relevance: item.relevance, point: item.point === null ? null : { u: item.point.u as number, v: item.point.v as number } };
  }
  return result;
}

/**
 * Local, relevance-only inference. Checks immutable JPEG bytes before native work.
 * One photo per bridge call bounds base64 memory and permits cancellation between
 * photos; the native encoder stays loaded. No checklist/domain command is issued.
 */
export async function analyzeCaptureOnDevice(record: StoredCapture, options: { isCurrent?: () => boolean } = {}): Promise<CaptureSuggestionsFile> {
  assertCurrent(options.isCurrent);
  const validated = validateCaptureManifest(record.manifest);
  if (!validated.ok) throw new CaptureError(validated.code, validated.error);
  const capture = validated.value, photos = new Map(record.photos);
  if (photos.size !== capture.photos.length) throw invalid('Saved room photos are incomplete.');
  if (!await ondeviceFlagsAvailable()) throw invalid('The on-device photo model is unavailable.');
  const evidence: Record<string, NativeItem>[] = [];
  // Check all photos before asking the model, including later photos in the tour.
  for (const photo of capture.photos) {
    assertCurrent(options.isCurrent);
    const blob = photos.get(photo.photoId);
    if (!(blob instanceof Blob) || blob.type !== 'image/jpeg' || !blob.size || blob.size > 8 * 1024 * 1024 || await sha256Blob(blob) !== photo.sha256) throw invalid('A room photo does not match its saved hash.');
    const dimensions = jpegDimensions(new Uint8Array(await blob.arrayBuffer()));
    if (dimensions?.width !== photo.width || dimensions.height !== photo.height) throw invalid('A room photo does not match its saved dimensions.');
  }
  for (const photo of capture.photos) {
    assertCurrent(options.isCurrent);
    const response = await plugin.analyze({ photos: [{ photoId: photo.photoId, jpegBase64: base64(new Uint8Array(await photos.get(photo.photoId)!.arrayBuffer())) }] });
    assertCurrent(options.isCurrent);
    evidence.push(nativePhoto(response, photo.photoId, photo.width, photo.height));
  }
  const file: CaptureSuggestionsFile = {
    format: 'fixlist-capture-suggestions', version: 1, createdAt: new Date().toISOString(),
    capture: { captureId: capture.captureId, roomId: capture.roomId, photos: capture.photos.map(({ photoId, sha256 }) => ({ photoId, sha256 })) },
    model: structuredClone(ONDEVICE_MODEL), thresholds: { suggestion: 1, relevance: 0, location: 0.7, perItem: { ...ONDEVICE_THRESHOLDS } },
    calibration: null, notice: TRUSTED_SUGGESTION_NOTICE,
    items: trustedPhotoQuestions.map((item) => {
      const perPhoto = capture.photos.map((photo, i) => {
        const raw = evidence[i]![item.checklistItemId]!.relevance;
        return { photoId: photo.photoId, rawProbability: raw, probability: raw, relevanceProbability: raw };
      });
      const best = perPhoto.reduce((a, b) => b.probability > a.probability ? b : a), index = perPhoto.indexOf(best);
      const suggested = best.probability >= ONDEVICE_THRESHOLDS[item.checklistItemId]!;
      return { checklistItemId: item.checklistItemId, concernId: item.concernId, ...ondeviceFlagCopy(item.checklistItemId),
        status: suggested ? 'suggested' : 'below-threshold', score: best.probability, bestPhotoId: best.photoId, perPhoto,
        point: suggested && best.probability >= 0.7 ? evidence[index]![item.checklistItemId]!.point : null };
    }),
  };
  const result = validateCaptureSuggestions(file, capture);
  if (!result.ok) throw new CaptureError(result.code, result.error);
  return result.value;
}

/**
 * UI integration hook for after capture / Check photos again. The caller must
 * supply its existing actor/scope/route/revision guard; it is checked throughout
 * analysis and inside the durable save. Existing flags survive any failure.
 */
export async function analyzeAndSaveFlags(roomId: string, options: { isCurrent: () => boolean; store?: CaptureStore }): Promise<CaptureSuggestionsFile> {
  assertCurrent(options.isCurrent);
  const store = options.store ?? getCaptureStore(), record = await store.read(roomId);
  if (!record) throw new CaptureError('CAPTURE_MISMATCH', 'This room has no saved walk-through.');
  assertCurrent(options.isCurrent);
  const flags = await analyzeCaptureOnDevice(record, options);
  assertCurrent(options.isCurrent);
  await store.writeFlags(roomId, flags, options.isCurrent);
  return flags;
}
