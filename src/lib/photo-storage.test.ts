import { describe, expect, it } from 'vitest';
import { createIndexedDbPhotoStore, isJpegPhoto, photoDimensions, resetPhotoStorage, serializePhotoStore, type PhotoStore } from './photo-storage';
describe('photo sizing and JPEG boundary', () => {
  it.each([[4000, 3000, 1600, 1200], [3000, 4000, 1200, 1600], [1600, 1600, 1600, 1600], [800, 600, 800, 600], [1, 10000, 1, 1600], [10000, 1, 1600, 1]])('%i × %i becomes %i × %i', (w, h, width, height) => { expect(photoDimensions(w, h)).toEqual({ width, height }); });
  it.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid dimensions %s', (n) => { expect(() => photoDimensions(n, 10)).toThrow(); expect(() => photoDimensions(10, n)).toThrow(); });
  it('requires bounded nonempty JPEG blobs, never a source file or data URL', () => {
    expect(isJpegPhoto(new Blob(['jpeg'], { type: 'image/jpeg' }))).toBe(true);
    for (const b of [new Blob([], { type: 'image/jpeg' }), new Blob(['png'], { type: 'image/png' }), 'data:image/jpeg;base64,x', {}, null]) expect(isJpegPhoto(b)).toBe(false);
  });
  it('fails clearly when IndexedDB is unavailable', async () => { const store = createIndexedDbPhotoStore(undefined); await expect(store.read('photo')).rejects.toThrow('unavailable'); await expect(store.write('photo', new Blob(['jpeg'], { type: 'image/jpeg' }))).rejects.toThrow('unavailable'); expect((await resetPhotoStorage(store)).ok).toBe(false); });
  it('serializes old writes before reset; a failed operation does not block later deletion', async () => {
    const bytes = new Map<string, Blob>(); const order: string[] = [];
    const underlying: PhotoStore = { read: async (id) => bytes.get(id) ?? null, write: async (id, b) => { await Promise.resolve(); bytes.set(id, b); order.push('write'); }, remove: async (id) => { bytes.delete(id); }, clear: async () => { bytes.clear(); order.push('clear'); } };
    const store = serializePhotoStore(underlying); const b = new Blob(['jpeg'], { type: 'image/jpeg' });
    await Promise.all([store.write('p', b), store.clear()]); expect(bytes.size).toBe(0); expect(order).toEqual(['write', 'clear']);
    underlying.write = async () => { throw new Error('quota'); }; await expect(store.write('p', b)).rejects.toThrow('quota'); await expect(store.clear()).resolves.toBeUndefined();
  });
});
