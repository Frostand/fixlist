import { describe, expect, it } from 'vitest';
import { jpegDimensions, validateCaptureManifest, validateNativeCaptureResult } from './capture-model';
import { createMemoryCaptureStore } from './capture-storage';
import { reviewFixture, tourFixture } from './__fixtures__/capture-tour';
import { validateAIReview } from './vision-hazards';
describe('optional tour manifest and durable review', () => {
  it('accepts tour-only and old photo manifests, and exact panorama cache file URLs', async () => {
    const r = await tourFixture(); expect(validateCaptureManifest(r.manifest).ok).toBe(true);
    const old = await tourFixture(true); const { tour: _tour, ...legacy } = old.manifest; expect(validateCaptureManifest(legacy).ok).toBe(true);
    expect(validateCaptureManifest({ ...legacy, photos: [] }).ok).toBe(false);
    const files = Object.fromEntries(r.manifest.tour!.stops.map(s => [s.panorama.fileId, `file:///var/mobile/Application/a/Library/Caches/fixlist-captures/${r.manifest.captureId}/${s.panorama.fileId}.jpg`]));
    expect(validateNativeCaptureResult({ ...r.manifest, files }).ok).toBe(true);
    expect(validateNativeCaptureResult({ ...r.manifest, files: { ...files, 'pano-s1': files['pano-s2'] } }).ok).toBe(false);
  });
  it('refuses extra fields, duplicate/invalid stops, invalid dimensions, hashes, coverage and sparse coordinates', async () => {
    const r = await tourFixture(), tour = r.manifest.tour!, s = tour.stops[0]!;
    for (const patch of [{ extra: 1 }, { version: 2 }, { stops: [] }, { stops: Array(7).fill(s) }, { stops: [s, s] },
      ...[{ stopId: 's100' }, { position: [0, NaN, 1] }, { position: Array(3) }, { capturedAt: 'yesterday' }, { extra: 1 },
        ...[{ fileId: 'wrong' }, { width: 2048 }, { sha256: 'x' }, { coverage: 1.01 }].map(p => ({ panorama: { ...s.panorama, ...p } }))].map(p => ({ stops: [{ ...s, ...p }] }))]) {
      expect(validateCaptureManifest({ ...r.manifest, tour: { ...tour, ...patch } }).ok, JSON.stringify(patch)).toBe(false);
    }
  });
  it('hashes panorama bytes and saves capture-bound AI reviews without losing them on flags/media reads', async () => {
    const r = await tourFixture(), store = createMemoryCaptureStore(), review = reviewFixture(r.manifest);
    await store.writeCapture(r.manifest, r.photos, false, undefined, null, { videos: null, videoBlobs: new Map(), panoramaBlobs: r.panoramaBlobs! });
    await store.writeAIReview!(r.manifest.roomId, review);
    const saved = (await store.read(r.manifest.roomId))!; expect(saved.aiReview).toEqual(review); expect(saved.panoramaBlobs!.size).toBe(2);
    expect(jpegDimensions(new Uint8Array(await saved.panoramaBlobs!.get('pano-s1')!.arrayBuffer()), 4096)).toEqual({ width: 4096, height: 2048 });
    await expect(store.writeAIReview!(r.manifest.roomId, { ...review, captureId: 'cap-other-room' })).rejects.toMatchObject({ code: 'INVALID_CAPTURE' });
    await expect(store.writeAIReview!(r.manifest.roomId, review, () => false)).rejects.toMatchObject({ code: 'CANCELLED' });
    const altered = new Map(r.panoramaBlobs); altered.set('pano-s1', new Blob(['bad'], { type: 'image/jpeg' }));
    await expect(createMemoryCaptureStore().writeCapture(r.manifest, r.photos, false, undefined, null, { videos: null, videoBlobs: new Map(), panoramaBlobs: altered })).rejects.toMatchObject({ code: 'INVALID_CAPTURE' });
    expect(validateAIReview({ ...review, sources: [...review.sources].reverse() }, r.manifest).ok).toBe(false);
    expect(validateAIReview({ ...review, sources: review.sources.map(s => ({ ...s, sha256: '0'.repeat(64) })) }, r.manifest).ok).toBe(false);
    await expect(createMemoryCaptureStore(100).writeCapture(r.manifest, r.photos, false, undefined, null, { videos: null, videoBlobs: new Map(), panoramaBlobs: r.panoramaBlobs! })).rejects.toMatchObject({ code: 'CAPACITY' });
  });
});

it('exports/reimports panorama bytes alongside photos while preserving the exact manifest', async () => {
  const { buildCaptureBundle, parseCaptureBundle } = await import('./capture-bundle'); const r = await tourFixture();
  const bundle = await buildCaptureBundle(r.manifest, r.photos, r.panoramaBlobs);
  const parsed = await parseCaptureBundle(bundle.text); expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.value.manifest).toEqual(r.manifest); expect(parsed.value.panoramaBlobs!.size).toBe(2);
});

const pythonAvailable = (await import('node:child_process')).spawnSync('./scan/venv-python', ['-c', 'import PIL'], { encoding: 'utf8', timeout: 10000 }).status === 0;
it.skipIf(!pythonAvailable)('keeps the Python exact-keys manifest validator in parity for tours and zero-photo captures', async () => {
  const { spawnSync } = await import('node:child_process'), r = await tourFixture();
  const python = spawnSync('./scan/venv-python', ['-c', 'import sys,json; sys.path.insert(0,"scan"); from capture_schema import validate_capture_manifest; validate_capture_manifest(json.load(sys.stdin))'], { input: JSON.stringify(r.manifest), encoding: 'utf8', timeout: 10000 });
  expect(python.status, python.stderr).toBe(0);
});
