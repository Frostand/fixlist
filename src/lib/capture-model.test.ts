import { describe, expect, it } from 'vitest';
import bundle from '../../scan/tests/capture-parity/valid-bundle.json';
import { newCaptureId, sha256Bytes, validateCaptureManifest, validateNativeCaptureResult } from './capture-model';
export function fixtureManifest() { return { ...structuredClone(bundle), photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => structuredClone(p)) }; }
describe('capture manifest boundary', () => {
  it('accepts ARKit and photos-only manifests, open and skipped outlines', () => {
    const m = fixtureManifest(); expect(validateCaptureManifest(m).ok).toBe(true);
    m.outline.closed = false; expect(validateCaptureManifest(m).ok).toBe(true);
    expect(validateCaptureManifest({ ...m, outline: null }).ok).toBe(true);
    expect(validateCaptureManifest({ ...m, mode: 'photos', floorY: null, outline: null, doors: [], photos: m.photos.map((p) => ({ ...p, camera: null })) }).ok).toBe(true);
  });
  it.each([
    { mystery: true }, { captureId: 'cap-short' }, { roomId: 'unknown' }, { createdAt: '2026-02-30T00:00:00.000Z' }, { photos: [] }, { photos: Array(41).fill(bundle.photos[0]) },
    { mode: 'photos' }, { floorY: Number.NaN }, { floorY: null }, { doors: [[51, 0]] }, { doors: Array(9).fill([0, 0]) },
    { outline: { closed: true, points: [[0, 0], [0, 0], [1, 0]] } }, { outline: { closed: true, points: [[0, 0], [1, 0]] } },
  ])('refuses malformed manifest fields %j', (patch) => expect(validateCaptureManifest({ ...fixtureManifest(), ...patch }).ok).toBe(false));
  it.each([
    { width: 0 }, { height: 1601 }, { width: 1.5 }, { photoId: 'p1' }, { checklistItemId: 'unknown' }, { takenAt: 'yesterday' }, { sha256: 'A'.repeat(64) }, { extra: 1 },
    { camera: { transform: Array(16).fill(0), intrinsics: [1, 1, 8, 8], tracking: 'normal' } },
  ])('refuses malformed photo fields %j', (patch) => { const m = fixtureManifest(); expect(validateCaptureManifest({ ...m, photos: [{ ...m.photos[0], ...patch }] }).ok).toBe(false); });
  it('checks bottom row, handedness, orthogonality, intrinsics and unique IDs', () => {
    for (const [index, value] of [[3, .00001], [7, 1], [11, 1], [15, .9999], [0, -1], [4, .01]] as const) {
      const m = fixtureManifest(); m.photos[0]!.camera.transform[index] = value; expect(validateCaptureManifest(m).ok).toBe(false);
    }
    for (const intrinsics of [[0, 1, 8, 8], [1, 1, 0, 8], [1, 1, 16, 8], [1, 1, 8, 16], [Infinity, 1, 8, 8]]) {
      const m = fixtureManifest(); m.photos[0]!.camera.intrinsics = intrinsics; expect(validateCaptureManifest(m).ok).toBe(false);
    }
    const m = fixtureManifest(); m.photos[1]!.photoId = 'p01'; expect(validateCaptureManifest(m).ok).toBe(false);
  });
  it('rejects getters, symbols and nonplain objects without invoking them', () => {
    const m = fixtureManifest(); Object.defineProperty(m, 'version', { get: () => { throw new Error('must not run'); } }); expect(validateCaptureManifest(m).ok).toBe(false);
    expect(validateCaptureManifest({ ...fixtureManifest(), [Symbol('extra')]: 1 }).ok).toBe(false);
    expect(validateCaptureManifest(new Date()).ok).toBe(false);
  });
  it('accepts exactly one native file URL per photo, including an unassigned room', () => {
    const m = fixtureManifest(), files = Object.fromEntries(m.photos.map((p) => [p.photoId, `file:///var/mobile/Application/a/Library/Caches/fixlist-captures/${m.captureId}/${p.photoId}.jpg`]));
    expect(validateNativeCaptureResult({ ...m, roomId: '', files }).ok).toBe(true);
    for (const invalid of [{}, { ...files, other: files.p01 }, { ...files, p01: 'https://example.test/image.jpg' }, { ...files, p01: 'file:///private/photo.jpg' }, { ...files, p01: files.p02 }]) expect(validateNativeCaptureResult({ ...m, files: invalid }).ok).toBe(false);
  });
  it('generates conforming IDs and computes real SHA-256', async () => {
    expect(newCaptureId()).toMatch(/^cap-[a-z0-9-]{8,40}$/);
    expect(await sha256Bytes(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
