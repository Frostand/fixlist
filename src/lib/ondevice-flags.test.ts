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
import { scanFlagAnalysis } from '../community/task-rules';
import { analysis as validAnalysis } from '../community/validation';
import { demoScenario } from '../data/demo-scenario';
import { catalogText } from '../i18n/catalog';
import { translate, type Translator } from '../i18n';

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

describe('on-device object review flags (mocked bridge; no device claim)', () => {
  it('carries floor clutter through validation, durable storage, catalog copy and a reviewable help draft', async () => {
    const saved = record(), store = createMemoryCaptureStore();
    await store.writeCapture(saved.manifest, saved.photos);
    mock.analyze.mockImplementation(async ({ photos }) => {
      const value = response(photos[0].photoId, 0);
      value.photos[0]!.items['floor-clutter-check'] = { relevance: 0.4, point: { u: 7, v: 12 } };
      return value;
    });
    const flags = await analyzeAndSaveFlags(saved.manifest.roomId, { store, isCurrent: () => true });
    const item = displayFlags(flags).find((q) => q.checklistItemId === 'floor-clutter-check')!;
    expect(item).toMatchObject({ concernId: 'clutter-concern', status: 'suggested', point: { u: 7, v: 12 } });
    expect(item.question).toContain('Possible loose object');
    expect((await store.read(saved.manifest.roomId))?.flags).toEqual(flags);
    expect(demoScenario.checklist.find((q) => q.id === item.checklistItemId)?.referenceActionId).toBe('review-floor-clutter');
    for (const language of ['en', 'es', 'fr'] as const) {
      const t = Object.assign((...args: Parameters<Translator>) => translate(language, ...args), { language });
      expect(catalogText(t, 'check', item.checklistItemId)).not.toBe(t('common.unavailable'));
      expect(catalogText(t, 'action', 'review-floor-clutter', 'nextStep')).not.toBe(t('common.unavailable'));
      const draft = scanFlagAnalysis(item.checklistItemId, item.question, language);
      expect(validAnalysis(draft)).toBe(true);
      expect(draft.titleEnglish).toBe('Clear a walkway');
      expect(draft.summaryEnglish).toContain('resident’s permission');
      expect(draft.safetyNotes.join(' ')).toContain('unverified room flag');
    }
  });
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
  it('uses honest object review copy as English fallback, never an area relevance question', async () => {
    const flags = await analyzeCaptureOnDevice(record());
    for (const item of flags.items) {
      const question = trustedPhotoQuestions.find((q) => q.checklistItemId === item.checklistItemId)!;
      expect(item.question).not.toBe(question.relevanceQuestion); expect(item.limitation).toContain('Unverified AI output');
      expect(item.limitation).toContain('not a safety verdict'); expect(item.limitation).toContain(question.limitation);
    }
    expect(ondeviceFlagCopy('cord-check').question).toContain('Possible cord');
    expect(ondeviceFlagCopy('bathroom-support-check').question).toContain('no grab bar detected');
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
  it('preserves actual detector centres below the old 0.7 CLIP location gate', async () => {
    mock.analyze.mockImplementation(async ({ photos }) => {
      const value = response(photos[0].photoId, ONDEVICE_THRESHOLDS[scoredId]); value.photos[0]!.items[scoredId]!.point = { u: 3.25, v: 11.75 }; return value;
    });
    expect((await analyzeCaptureOnDevice(record())).items.find((q) => q.checklistItemId === scoredId)?.point).toEqual({ u: 3.25, v: 11.75 });
    mock.analyze.mockImplementation(async ({ photos }) => {
      const value = response(photos[0].photoId, ONDEVICE_THRESHOLDS[scoredId]! - 1e-8); value.photos[0]!.items[scoredId]!.point = { u: 1, v: 1 }; return value;
    });
    expect((await analyzeCaptureOnDevice(record())).items.find((q) => q.checklistItemId === scoredId)?.point).toBeNull();
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
