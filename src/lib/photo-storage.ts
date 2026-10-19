import { OperationError } from '../domain/failures';
import { validId } from '../domain/workflow';
export const PHOTO_DATABASE = 'fixlist-photos';
export const PHOTO_STORE = 'jpeg-blobs';
const GENERATION_KEY = '__reset_generation';
export const MAX_PHOTO_EDGE = 1600;
export interface PhotoStore { read(id: string): Promise<Blob | null>; write(id: string, blob: Blob): Promise<void>; remove(id: string): Promise<void>; clear(): Promise<void>; invalidate?(): void }
/** Pure dimensions; never upscale. Both output edges are integers in 1..1600. */
export function photoDimensions(width: number, height: number): { width: number; height: number } {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error('Photo dimensions must be positive integers.');
  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function isJpegPhoto(blob: unknown): blob is Blob { return blob instanceof Blob && blob.type === 'image/jpeg' && blob.size > 0 && blob.size <= 16 * 1024 * 1024; }
/** Repainting pixels into a new JPEG discards the source file's EXIF and other metadata. No upload. */
export async function reencodePhoto(input: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  if (!(input instanceof Blob) || !input.type.startsWith('image/') || !input.size || input.size > 32 * 1024 * 1024) throw new OperationError('invalid_media', 'Choose an image under 32 MiB.');
  const image = new Image();
  const url = URL.createObjectURL(input);
  try {
    image.src = url;
    try { await image.decode(); } catch { throw new OperationError('invalid_media', 'The image could not be decoded. Choose another image.'); }
    const dimensions = photoDimensions(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new OperationError('processing_failure', 'Photo re-encoding is unavailable.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new OperationError('processing_failure', 'Photo could not be re-encoded.')), 'image/jpeg', 0.85));
    if (!isJpegPhoto(blob)) throw new OperationError('invalid_media', 'The re-encoded photo could not be stored as JPEG.');
    return { blob, ...dimensions };
  } finally { URL.revokeObjectURL(url); }
}
export function createIndexedDbPhotoStore(factory: IDBFactory | undefined): PhotoStore {
  let observedGeneration = 0;
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!factory) return reject(new Error('Photo storage is unavailable.'));
      const request = factory.open(PHOTO_DATABASE, 1);
      let abandoned = false;
      const timer = setTimeout(() => { abandoned = true; reject(new Error('Photo database open timed out.')); }, 5000);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(PHOTO_STORE)) request.result.createObjectStore(PHOTO_STORE); };
      request.onerror = () => { clearTimeout(timer); reject(new Error('Photo database could not open.')); };
      request.onblocked = () => { abandoned = true; clearTimeout(timer); reject(new Error('Photo database is blocked by another tab.')); };
      request.onsuccess = () => { clearTimeout(timer); if (abandoned) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    });
  }
  async function transact(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest, reset = false): Promise<unknown> {
    const expectedGeneration = observedGeneration;
    const db = await open();
    try { return await new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, mode);
      let result: unknown;
      let commitGeneration: number | undefined;
      const timer = setTimeout(() => { try { tx.abort(); } catch { /* ended */ } reject(new Error('Photo transaction timed out.')); }, 10000);
      tx.oncomplete = () => { clearTimeout(timer); if (commitGeneration !== undefined) observedGeneration = commitGeneration; resolve(result); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(new Error('Photo transaction failed.')); };
      try {
        const store = tx.objectStore(PHOTO_STORE), generation = store.get(GENERATION_KEY);
        generation.onsuccess = () => {
          try {
            const current = generation.result ?? 0;
            if (!Number.isSafeInteger(current) || current < 0 || mode === 'readwrite' && !reset && current !== expectedGeneration) {
              clearTimeout(timer); reject(new OperationError('stale_revision', 'Photos reset in another view. Reload before saving.')); tx.abort(); return;
            }
            if (mode === 'readonly') commitGeneration = current;
            const request = operation(store); request.onsuccess = () => { result = request.result; };
            if (reset) { store.put(current + 1, GENERATION_KEY); commitGeneration = current + 1; }
          } catch (error) {
            clearTimeout(timer); reject(error);
            try { tx.abort(); } catch { /* ended */ }
          }
        };
      }
      catch (error) { clearTimeout(timer); try { tx.abort(); } catch { /* ended */ } reject(error); }
    }); } finally { db.close(); }
  }
  function check(id: string) { if (!validId(id)) throw new Error('Invalid photo ID.'); }
  return {
    read: async (id) => { check(id); const value = await transact('readonly', (s) => s.get(id)); if (value === undefined) return null; if (!isJpegPhoto(value)) throw new Error('Saved photo is invalid.'); return value; },
    write: async (id, blob) => { check(id); if (!isJpegPhoto(blob)) throw new Error('Store only a re-encoded JPEG.'); await transact('readwrite', (s) => s.put(blob, id)); },
    remove: async (id) => { check(id); await transact('readwrite', (s) => s.delete(id)); },
    clear: async () => { await transact('readwrite', (s) => s.clear(), true); },
  };
}
/** Order all operations, including reset, so a queued old write cannot resurrect deleted photos. */
export function serializePhotoStore(store: PhotoStore): PhotoStore {
  let tail: Promise<unknown> = Promise.resolve();
  let invalidated = false;
  function enqueue<T>(operation: () => Promise<T>): Promise<T> { const result = tail.then(operation, operation); tail = result.catch(() => undefined); return result; }
  return { read: (id) => enqueue(() => store.read(id)), write: (id, b) => invalidated ? Promise.reject(new OperationError('cancelled', 'Photo operation cancelled by reset.')) : enqueue(() => store.write(id, b)), remove: (id) => enqueue(() => store.remove(id)), clear: () => enqueue(() => store.clear()), invalidate: () => { invalidated = true; } };
}
let browserStore: PhotoStore | undefined;
export function getPhotoStore(): PhotoStore {
  if (!browserStore) { let factory: IDBFactory | undefined; try { factory = globalThis.indexedDB; } catch { /* denied */ } browserStore = serializePhotoStore(createIndexedDbPhotoStore(factory)); }
  return browserStore;
}
export async function resetPhotoStorage(store = getPhotoStore()): Promise<{ ok: boolean; message: string }> {
  store.invalidate?.();
  try { await store.clear(); if (store === browserStore) browserStore = undefined; return { ok: true, message: 'Saved photos cleared from this device.' }; }
  catch { return { ok: false, message: 'Saved photos could not be cleared; reloading may restore them.' }; }
}
