import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeAndSaveVision, analyzeCaptureVision, prepareVision, validateVisionResponse, visionAvailability } from './vision-hazards';
import { tourFixture, visionHazard, visionModel } from './__fixtures__/capture-tour';
import { createMemoryCaptureStore } from './capture-storage';
const native = vi.hoisted(() => ({ ios: true, availability: vi.fn(), photo: vi.fn(), panorama: vi.fn(), prepare: vi.fn(), listener: vi.fn(), remove: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.ios, getPlatform: () => native.ios ? 'ios' : 'web' }, registerPlugin: () => ({ availability: native.availability, prepare: native.prepare, describePhoto: native.photo, describePanorama: native.panorama, addListener: native.listener }) }));
beforeEach(() => {
  native.ios = true; native.availability.mockReset().mockResolvedValue({ available: true, state: 'ready', model: visionModel });
  native.photo.mockReset().mockResolvedValue({ model: visionModel.id, hazards: [visionHazard] }); native.panorama.mockReset().mockResolvedValue({ model: visionModel.id, hazards: [visionHazard] });
  native.prepare.mockReset().mockResolvedValue({ available: true }); native.remove.mockReset().mockResolvedValue(undefined); native.listener.mockReset().mockResolvedValue({ remove: native.remove });
});
afterEach(() => vi.restoreAllMocks());
describe('strict on-device vision boundary', () => {
  it('accepts empty responses and every category, rejects malformed/dangerous response fields', () => {
    expect(validateVisionResponse({ model: visionModel.id, hazards: [] }).ok).toBe(true);
    for (const patch of [{ label: 'x'.repeat(61) }, { detail: 'x'.repeat(241) }, { tip: '' }, { severity: 'critical' }, { category: 'rugs' }, { extra: 1 },
      { direction: [1, 1, 1] }, { direction: [NaN, 0, 0] }, { direction: Array(3) }, { box: { x: 0.9, y: 0, w: 0.2, h: 0.1 } },
      { box: { x: 0, y: 0, w: 0, h: 0.5 } }, { thumbnail: 'https://example.test/photo.jpg' }, { thumbnail: 'data:image/jpeg;base64,AAAA' }, { thumbnail: 'data:image/jpeg;base64,' + 'A'.repeat(40 * 1024) }]) {
      expect(validateVisionResponse({ model: visionModel.id, hazards: [{ ...visionHazard, ...patch }] }).ok).toBe(false);
    }
    const getters = { ...visionHazard }; Object.defineProperty(getters, 'label', { get() { throw new Error('Never invoke'); } });
    expect(validateVisionResponse({ model: visionModel.id, hazards: [getters] }).ok).toBe(false);
    expect(validateVisionResponse({ model: visionModel.id, hazards: Array(1) }).ok).toBe(false);
    expect(validateVisionResponse({ model: visionModel.id, hazards: [], extra: true }).ok).toBe(false);
  });
  it('fails closed in browser, Android/missing/malformed plugins; needs-download is supported, not ready', async () => {
    native.ios = false; expect(await visionAvailability()).toMatchObject({ state: 'unsupported', available: false }); expect(native.availability).not.toHaveBeenCalled();
    native.ios = true; native.availability.mockResolvedValue({ available: true, state: 'needs-download', model: visionModel });
    expect(await visionAvailability()).toMatchObject({ state: 'needs-download' });
    await expect(analyzeCaptureVision(await tourFixture())).rejects.toThrow('Download');
    native.availability.mockResolvedValue({ available: true, state: 'ready', model: { ...visionModel, bytes: -1 } }); expect((await visionAvailability()).state).toBe('unsupported');
    native.availability.mockRejectedValue(new Error('Plugin missing')); expect((await visionAvailability()).state).toBe('unsupported');
  });
  it('runs panoramas then photos sequentially and saves only the complete capture-bound review', async () => {
    const r = await tourFixture(true), order: string[] = [], progress = vi.fn(), store = createMemoryCaptureStore();
    native.panorama.mockImplementation(async p => { order.push(p.stopId); expect(p.jpegBase64).toMatch(/^\/9j/); return { model: visionModel.id, hazards: [visionHazard] }; });
    native.photo.mockImplementation(async p => { order.push(p.photoId); return { model: visionModel.id, hazards: [] }; });
    await store.writeCapture(r.manifest, r.photos, false, undefined, null, { videos: null, videoBlobs: new Map(), panoramaBlobs: r.panoramaBlobs! });
    const review = await analyzeAndSaveVision(r.manifest.roomId, { store, isCurrent: () => true, onProgress: progress });
    expect(order).toEqual(['s1', 's2', 'p01', 'p02']); expect(progress.mock.calls.map(c => c[0])).toEqual([{ kind: 'panorama', current: 1, total: 2 }, { kind: 'panorama', current: 2, total: 2 }, { kind: 'photo', current: 1, total: 2 }, { kind: 'photo', current: 2, total: 2 }]);
    expect((await store.read(r.manifest.roomId))!.aiReview).toEqual(review);
  });
  it('retains the lock after cancellation until native settles, and never saves or starts another call early', async () => {
    const r = await tourFixture(); let resolve!: (v: unknown) => void; const blocked = new Promise(res => { resolve = res; });
    native.panorama.mockImplementationOnce(() => blocked);
    const controller = new AbortController(), first = analyzeCaptureVision(r, { signal: controller.signal }).catch(e => e);
    await vi.waitFor(() => expect(native.panorama).toHaveBeenCalledTimes(1)); controller.abort();
    const second = analyzeCaptureVision(r); await Promise.resolve(); expect(native.panorama).toHaveBeenCalledTimes(1);
    resolve({ model: visionModel.id, hazards: [] }); expect(await first).toMatchObject({ code: 'CANCELLED' }); await second; expect(native.panorama).toHaveBeenCalledTimes(3);
  });
  it('checks all image hashes before any inference and rejects a wrong response model', async () => {
    const r = await tourFixture(), altered = new Map(r.panoramaBlobs); altered.set('pano-s2', new Blob(['bad'], { type: 'image/jpeg' }));
    await expect(analyzeCaptureVision({ ...r, panoramaBlobs: altered })).rejects.toMatchObject({ code: 'INVALID_CAPTURE' }); expect(native.panorama).not.toHaveBeenCalled();
    native.panorama.mockResolvedValue({ model: 'another-model', hazards: [] }); await expect(analyzeCaptureVision(r)).rejects.toThrow('does not match');
  });
  it('validates progress and always removes its listener on download failure/cancellation', async () => {
    const progress = vi.fn(); native.listener.mockImplementation(async (_name, callback) => { callback({ fraction: 0.5, phase: 'download' }); callback({ fraction: 2, phase: 'download' }); return { remove: native.remove }; });
    await prepareVision({ onProgress: progress }); expect(progress).toHaveBeenCalledExactlyOnceWith({ fraction: 0.5, phase: 'download' }); expect(native.remove).toHaveBeenCalledTimes(1);
    native.prepare.mockRejectedValueOnce(new Error('network failed')); await expect(prepareVision()).rejects.toThrow('network failed'); expect(native.remove).toHaveBeenCalledTimes(2);
  });
});

it('rejects getters or symbol metadata on native arrays before accessing evidence', () => {
  const hazards = [visionHazard]; Object.defineProperty(hazards, 0, { get() { throw new Error('Must not access'); } });
  expect(validateVisionResponse({ model: visionModel.id, hazards }).ok).toBe(false);
  const direction = [0, 0, -1]; Object.assign(direction, { [Symbol('extra')]: true });
  expect(validateVisionResponse({ model: visionModel.id, hazards: [{ ...visionHazard, direction }] }).ok).toBe(false);
});

it('encodes JPEG bytes in bounded chunks and rejects non-JPEG or oversized blobs', async () => {
  const { bytesToBase64, jpegBlobToBase64 } = await import('./vision-hazards'), bytes = new Uint8Array(30_000).map((_, i) => i % 256);
  const encoded = bytesToBase64(bytes); expect(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))).toEqual(bytes);
  expect(await jpegBlobToBase64(new Blob([bytes], { type: 'image/jpeg' }))).toBe(encoded);
  await expect(jpegBlobToBase64(new Blob([bytes], { type: 'image/png' }))).rejects.toMatchObject({ code: 'INVALID_CAPTURE' });
});
