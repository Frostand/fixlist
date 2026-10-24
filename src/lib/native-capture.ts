import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Language } from '../domain/roles';
import { translate } from '../i18n';
import { NATIVE_CAPTURE_STRING_KEYS, type FixListCapturePlugin, type NativeCaptureOutcome, type NativeCaptureStartOptions } from './capture-types';
import { CaptureError, isJpegBytes, newCaptureId, sha256Blob, validateCaptureManifest, validateNativeCaptureResult } from './capture-model';
import { getCaptureStore, type CaptureStore } from './capture-storage';

export const FixListCapture = registerPlugin<FixListCapturePlugin>('FixListCapture');
const isIOS = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
export type CapturePrompt = NativeCaptureStartOptions['prompts'][number];
export async function captureAvailability(): ReturnType<FixListCapturePlugin['availability']> {
  if (!isIOS()) return { arkit: false, camera: 'not-determined' };
  return FixListCapture.availability();
}
export async function discardAllNativeCaptures(): Promise<{ ok: boolean }> {
  if (!isIOS()) return { ok: true };
  try { await FixListCapture.discardAll(); return { ok: true }; } catch { return { ok: false }; }
}
interface RunCaptureOptions {
  roomId: string; roomName: string; language: Language; prompts: readonly CapturePrompt[];
  replaceConfirmed?: boolean; expectedCaptureId?: string | null; store?: CaptureStore; isCurrent?(): boolean; signal?: AbortSignal;
}
/** Always attempt temporary-file cleanup; preserve the saved outcome if cleanup fails. */
export async function runNativeCapture(options: RunCaptureOptions): Promise<NativeCaptureOutcome> {
  if (!isIOS()) return { status: 'unavailable' };
  if (options.signal?.aborted || options.isCurrent && !options.isCurrent()) return { status: 'cancelled' };
  let result: NativeCaptureOutcome = { status: 'failed' };
  let cleanupFailed = false, abortCleanup: Promise<void> | undefined;
  const captureId = newCaptureId(), store = options.store ?? getCaptureStore();
  const isCurrent = () => !options.signal?.aborted && (!options.isCurrent || options.isCurrent());
  const requireCurrent = () => { if (!isCurrent()) throw new CaptureError('CANCELLED', 'Capture cancelled before saving.'); };
  // Install before start: an abort must reach native even while camera permission
  // or file preparation holds the start promise. Every discard targets this ID.
  const cleanup = async () => { try { await FixListCapture.discard({ captureId }); } catch { cleanupFailed = true; } };
  const abort = () => { abortCleanup = cleanup(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    requireCurrent();
    const strings = Object.fromEntries(NATIVE_CAPTURE_STRING_KEYS.map((key) => [key, translate(options.language, `capture.native.${key}`)]));
    const start: NativeCaptureStartOptions = { captureId, roomId: options.roomId, roomName: options.roomName, language: options.language, prompts: options.prompts, strings };
    const outcome = await FixListCapture.start(start);
    requireCurrent();
    if (outcome.status !== 'completed') result = outcome;
    else {
      const parsed = validateNativeCaptureResult(outcome.capture);
      if (!parsed.ok) throw new CaptureError(parsed.code, parsed.error);
      if (parsed.value.captureId !== captureId || parsed.value.roomId !== options.roomId) throw new CaptureError('CAPTURE_MISMATCH', 'Native capture identity does not match this room.');
      const { files, ...capture } = parsed.value;
      const valid = validateCaptureManifest(capture);
      if (!valid.ok) throw new CaptureError(valid.code, valid.error);
      const photos = new Map<string, Blob>();
      for (const p of valid.value.photos) {
        requireCurrent();
        const response = await fetch(Capacitor.convertFileSrc(files[p.photoId]!), options.signal ? { signal: options.signal } : undefined);
        requireCurrent();
        if (!response.ok) throw new CaptureError('INVALID_CAPTURE', 'A captured photo could not be read.');
        const bytes = await response.arrayBuffer(), blob = new Blob([bytes], { type: 'image/jpeg' });
        requireCurrent();
        if (!isJpegBytes(new Uint8Array(bytes)) || await sha256Blob(blob) !== p.sha256) throw new CaptureError('INVALID_CAPTURE', 'A captured photo does not match its SHA-256.');
        requireCurrent();
        photos.set(p.photoId, blob);
      }
      requireCurrent();
      await store.writeCapture(valid.value, photos, options.replaceConfirmed ?? false, isCurrent, options.expectedCaptureId);
      result = { status: 'completed' };
    }
  } catch (error) { result = { status: !isCurrent() || error instanceof CaptureError && error.code === 'CANCELLED' ? 'cancelled' : 'failed', reason: error instanceof Error ? error.message : 'The walk-through could not finish.' }; }
  finally {
    options.signal?.removeEventListener('abort', abort);
    await cleanup();
    await abortCleanup;
    if (cleanupFailed) result.cleanupFailed = true;
  }
  return result;
}
export async function shareText(fileName: string, text: string): Promise<{ completed: boolean }> {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(fileName)) throw new CaptureError('INVALID_CAPTURE', 'Invalid export file name.');
  if (isIOS()) return FixListCapture.shareFile({ fileName, text });
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.append(a);
  try { a.click(); return { completed: true }; } finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
