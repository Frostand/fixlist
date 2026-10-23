import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bundle from '../../scan/tests/capture-parity/valid-bundle.json';
import macFlags from '../../scan/tests/capture-parity/valid-flags.json';
import { CaptureError, validateCaptureManifest } from './capture-model';
import { createMemoryCaptureStore, type StoredCapture } from './capture-storage';
import { displayFlags, validateCaptureSuggestions } from './capture-suggestions';
import { CAPTURE_FLAG_EXCLUDED } from './capture-types';
import { analyzeAndSaveFlags, analyzeCaptureOnDevice, ondeviceFlagCopy, ondeviceFlagsAvailable } from './ondevice-flags';
import { ONDEVICE_MODEL, ONDEVICE_THRESHOLDS } from './ondevice-model';
import { trustedPhotoQuestions } from './scan-suggestions';

const mock = vi.hoisted(() => ({ native: true, platform: 'ios', availability: vi.fn(), analyze: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mock.native, getPlatform: () => mock.platform }, registerPlugin: () => mock }));
const scoredId = Object.keys(ONDEVICE_THRESHOLDS).find((key) => !CAPTURE_FLAG_EXCLUDED.has(key) && ONDEVICE_THRESHOLDS[key]! < 1)!;
function record(): StoredCapture {
  const parsed = validateCaptureManifest({ ...bundle, photos: bundle.photos.map(({ jpeg: _jpeg, ...photo }) => photo) });
  if (!parsed.ok) throw new Error(parsed.error);
  return { manifest: parsed.value, photos: new Map(bundle.photos.map((photo) => [photo.photoId, new Blob([Uint8Array.from(atob(photo.jpeg), (c) => c.charCodeAt(0))], { type: 'image/jpeg' })])), flags: null };
}
function response(photoId: string, score?: number) {
  return { model: { ...ONDEVICE_MODEL, identity: { ...ONDEVICE_MODEL.identity } }, photos: [{ photoId, items: Object.fromEntries(trustedPhotoQuestions.map((q) => [q.checklistItemId, {
    relevance: score ?? (ONDEVICE_THRESHOLDS[q.checklistItemId] === 1 ? .9 : (1 + ONDEVICE_THRESHOLDS[q.checklistItemId]!) / 2), point: null as { u: number; v: number } | null,
  }])) }] };
}
beforeEach(() => {
  vi.clearAllMocks(); mock.native = true; mock.platform = 'ios';
  mock.availability.mockResolvedValue({ available: true, model: ONDEVICE_MODEL });
  mock.analyze.mockImplementation(async ({ photos }: { photos: { photoId: string; jpegBase64: string }[] }) => response(photos[0]!.photoId));
});
afterEach(() => vi.unstubAllGlobals());

describe('on-device relevance flags (mocked bridge; no device claim)', () => {
  it.each([[false, 'web'], [true, 'android']] as const)('has no network/native fallback for native=%s platform=%s', async (native, platform) => {
    mock.native = native; mock.platform = platform;
    expect(await ondeviceFlagsAvailable()).toBe(false); expect(mock.availability).not.toHaveBeenCalled();
    await expect(analyzeCaptureOnDevice(record())).rejects.toThrow('unavailable'); expect(mock.analyze).not.toHaveBeenCalled();
  });
  it('fails closed for unavailable resources, errors and model identity drift', async () => {
    mock.availability.mockRejectedValueOnce(new Error('missing plugin')); expect(await ondeviceFlagsAvailable()).toBe(false);
    mock.availability.mockResolvedValueOnce({ available: false }); expect(await ondeviceFlagsAvailable()).toBe(false);
    mock.availability.mockResolvedValueOnce({ available: true, model: { ...ONDEVICE_MODEL, identity: { ...ONDEVICE_MODEL.identity, weightsSHA256: '0'.repeat(64) } } });
    expect(await ondeviceFlagsAvailable()).toBe(false);
  });
  it('builds validator-passing raw relevance, binds all ordered hashes and keeps checklist state untouched', async () => {
    const saved = record(), before = structuredClone(saved.manifest), flags = await analyzeCaptureOnDevice(saved);
    expect(scoredId).toBeTruthy(); expect(validateCaptureSuggestions(flags, saved.manifest)).toEqual({ ok: true, value: flags });
    expect(flags.capture.photos).toEqual(saved.manifest.photos.map(({ photoId, sha256 }) => ({ photoId, sha256 })));
    expect(flags.model).toEqual(ONDEVICE_MODEL); expect(flags.calibration).toBeNull(); expect(flags.thresholds.perItem).toEqual(ONDEVICE_THRESHOLDS);
    expect(flags.items.find((q) => q.checklistItemId === scoredId)?.bestPhotoId).toBe('p01');
    expect(saved.manifest).toEqual(before); expect(saved.flags).toBeNull();
    expect(mock.analyze).toHaveBeenCalledTimes(saved.manifest.photos.length);
    expect(mock.analyze.mock.calls[0]![0].photos).toEqual([{ photoId: 'p01', jpegBase64: bundle.photos[0]!.jpeg }]);
  });
  it('uses the relevance question as English fallback and explicitly says no hazard was established', async () => {
    const flags = await analyzeCaptureOnDevice(record());
    for (const item of flags.items) {
      const question = trustedPhotoQuestions.find((q) => q.checklistItemId === item.checklistItemId)!;
      expect(item.question).toBe(question.relevanceQuestion); expect(item.limitation).toContain('Unverified AI output');
      expect(item.limitation).toContain('not whether there is a hazard'); expect(item.limitation).toContain(question.limitation);
    }
    expect(ondeviceFlagCopy('cord-check').question).toBe('Is an open floor walking path visible in this photo?');
    expect(() => ondeviceFlagCopy('unknown')).toThrow();
  });
  it('applies exact per-item thresholds without converting relevance into a condition answer', async () => {
    const threshold = ONDEVICE_THRESHOLDS[scoredId]!;
    mock.analyze.mockImplementation(async ({ photos }) => response(photos[0].photoId, threshold - 1e-8));
    expect((await analyzeCaptureOnDevice(record())).items.find((q) => q.checklistItemId === scoredId)?.status).toBe('below-threshold');
    mock.analyze.mockImplementation(async ({ photos }) => response(photos[0].photoId, threshold));
    const item = (await analyzeCaptureOnDevice(record())).items.find((q) => q.checklistItemId === scoredId)!;
    expect(item.status).toBe('suggested'); expect(item.score).toBe(threshold);
    expect(item.perPhoto[0]).toMatchObject({ rawProbability: threshold, probability: threshold, relevanceProbability: threshold });
  });
  it('keeps excluded questions hidden even with extreme relevance evidence', async () => {
    mock.analyze.mockImplementation(async ({ photos }) => response(photos[0].photoId, 1 - 1e-12));
    const flags = await analyzeCaptureOnDevice(record());
    for (const id of CAPTURE_FLAG_EXCLUDED) {
      expect(flags.items.find((q) => q.checklistItemId === id)?.status).toBe('below-threshold');
      expect(displayFlags(flags).some((q) => q.checklistItemId === id)).toBe(false);
    }
  });
  it.each(['hash', 'missing', 'extra', 'dimensions', 'mime'] as const)('refuses %s mismatch before scoring any photos', async (kind) => {
    const saved = record(), photos = new Map(saved.photos);
    if (kind === 'hash') saved.manifest.photos[1]!.sha256 = 'a'.repeat(64);
    if (kind === 'missing') photos.delete('p02');
    if (kind === 'extra') photos.set('p99', photos.get('p01')!);
    if (kind === 'dimensions') saved.manifest.photos[0]!.width = 15;
    if (kind === 'mime') photos.set('p01', new Blob([await photos.get('p01')!.arrayBuffer()], { type: 'text/plain' }));
    await expect(analyzeCaptureOnDevice({ ...saved, photos })).rejects.toBeInstanceOf(CaptureError);
    expect(mock.analyze).not.toHaveBeenCalled();
  });
  it.each(['photo', 'duplicate', 'missing-item', 'nan', 'over-one', 'endpoint', 'model', 'point'] as const)('refuses malformed native %s evidence', async (kind) => {
    mock.analyze.mockImplementation(async ({ photos }) => {
      const value = response(photos[0].photoId);
      if (kind === 'photo') value.photos[0]!.photoId = 'p99';
      if (kind === 'duplicate') value.photos.push(value.photos[0]!);
      if (kind === 'missing-item') delete value.photos[0]!.items[scoredId];
      if (kind === 'nan') value.photos[0]!.items[scoredId]!.relevance = NaN;
      if (kind === 'over-one') value.photos[0]!.items[scoredId]!.relevance = 1.01;
      if (kind === 'endpoint') value.photos[0]!.items[scoredId]!.relevance = 1;
      if (kind === 'model') value.model.identity.runtimeSHA256 = '0'.repeat(64) as typeof value.model.identity.runtimeSHA256;
      if (kind === 'point') value.photos[0]!.items[scoredId]!.point = { u: -1, v: 0 };
      return value;
    });
    await expect(analyzeCaptureOnDevice(record())).rejects.toBeInstanceOf(CaptureError);
  });
  it('keeps points only for threshold-passing best photos and enforces grid centres', async () => {
    mock.analyze.mockImplementation(async ({ photos }) => {
      const value = response(photos[0].photoId); value.photos[0]!.items[scoredId]!.point = { u: 8, v: 8 }; return value;
    });
    expect((await analyzeCaptureOnDevice(record())).items.find((q) => q.checklistItemId === scoredId)?.point).toEqual({ u: 8, v: 8 });
    mock.analyze.mockImplementation(async ({ photos }) => {
      const value = response(photos[0].photoId); value.photos[0]!.items[scoredId]!.point = { u: 1, v: 1 }; return value;
    });
    await expect(analyzeCaptureOnDevice(record())).rejects.toThrow('grid cell centre');
  });
  it('preserves strict Mac imports and rejects Core ML threshold/copy/calibration/identity substitution', async () => {
    const saved = record(), flags = await analyzeCaptureOnDevice(saved);
    expect(validateCaptureSuggestions(macFlags, saved.manifest).ok).toBe(true);
    const mutations = [
      (f: typeof flags) => { f.items[0]!.question = trustedPhotoQuestions[0]!.question; },
      (f: typeof flags) => { f.items[0]!.limitation = 'Safe'; },
      (f: typeof flags) => { f.thresholds.perItem = { ...ONDEVICE_THRESHOLDS, [scoredId]: 0 }; },
      (f: typeof flags) => { f.model.license = 'free'; },
      (f: typeof flags) => { f.model.identity = null; },
      (f: typeof flags) => { f.items[0]!.perPhoto[0]!.relevanceProbability = .1; },
      (f: typeof flags) => { f.calibration = {}; },
      (f: typeof flags) => { f.capture.photos[0]!.sha256 = 'f'.repeat(64); },
    ];
    for (const mutate of mutations) { const value = structuredClone(flags); mutate(value); expect(validateCaptureSuggestions(value, saved.manifest).ok).toBe(false); }
    expect(validateCaptureSuggestions({ ...macFlags, thresholds: { ...macFlags.thresholds, perItem: ONDEVICE_THRESHOLDS } }, saved.manifest).ok).toBe(false);
  });
  it('saves through the existing store and rejects stale actor/route work before publication', async () => {
    const saved = record(), store = createMemoryCaptureStore(); await store.writeCapture(saved.manifest, saved.photos);
    const flags = await analyzeAndSaveFlags(saved.manifest.roomId, { store, isCurrent: () => true });
    expect((await store.read(saved.manifest.roomId))?.flags).toEqual(flags);
    await expect(analyzeAndSaveFlags(saved.manifest.roomId, { store, isCurrent: () => false })).rejects.toMatchObject({ code: 'CANCELLED' });
    let current = true;
    mock.analyze.mockImplementationOnce(async ({ photos }) => { current = false; return response(photos[0].photoId); });
    await expect(analyzeAndSaveFlags(saved.manifest.roomId, { store, isCurrent: () => current })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect((await store.read(saved.manifest.roomId))?.flags).toEqual(flags);
  });
  it('cannot resurrect flags after capture deletion or reset during inference', async () => {
    const saved = record(), store = createMemoryCaptureStore(); await store.writeCapture(saved.manifest, saved.photos);
    mock.analyze.mockImplementationOnce(async ({ photos }) => { await store.clear(); return response(photos[0].photoId); });
    await expect(analyzeAndSaveFlags(saved.manifest.roomId, { store, isCurrent: () => true })).rejects.toMatchObject({ code: 'CAPTURE_MISMATCH' });
    expect(await store.read(saved.manifest.roomId)).toBeNull();
  });
});
