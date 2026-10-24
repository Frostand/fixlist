import type { CaptureManifest, CaptureSuggestionsFile } from './capture-types';
import { CaptureError, jpegDimensions, sha256Blob, validateCaptureManifest } from './capture-model';
import { validateCaptureSuggestions } from './capture-suggestions';

export const CAPTURE_DATABASE = 'fixlist-captures';
export const MAX_CAPTURE_STORAGE_BYTES = 120 * 1024 * 1024;
const STORE = 'rooms', GENERATION = '__reset_generation';
export interface StoredCapture { manifest: CaptureManifest; photos: ReadonlyMap<string, Blob>; flags: CaptureSuggestionsFile | null }
export interface CaptureStore {
  read(roomId: string): Promise<StoredCapture | null>;
  writeCapture(manifest: CaptureManifest, photos: ReadonlyMap<string, Blob>, replaceConfirmed?: boolean, isCurrent?: () => boolean, expectedCaptureId?: string | null): Promise<void>;
  writeFlags(roomId: string, flags: CaptureSuggestionsFile, isCurrent?: () => boolean): Promise<void>;
  remove(roomId: string, captureId: string, isCurrent?: () => boolean): Promise<void>;
  clear(): Promise<void>;
  invalidate?(): void;
}
const stale = () => new CaptureError('CANCELLED', 'This room view changed. Reload before saving.');
function assertCurrent(current?: () => boolean): void { if (current && !current()) throw stale(); }
function size(record: StoredCapture): number { return new Blob([JSON.stringify(record.manifest), JSON.stringify(record.flags)]).size + [...record.photos.values()].reduce((s, b) => s + b.size, 0); }
async function checked(record: StoredCapture): Promise<StoredCapture> {
  const result = validateCaptureManifest(record.manifest);
  if (!result.ok) throw new CaptureError(result.code, result.error);
  if (!(record.photos instanceof Map) || record.photos.size !== result.value.photos.length) throw new CaptureError('INVALID_CAPTURE', 'Saved room photos are incomplete.');
  for (const p of result.value.photos) {
    const b = record.photos.get(p.photoId);
    if (!(b instanceof Blob) || b.type !== 'image/jpeg' || !b.size || b.size > MAX_CAPTURE_STORAGE_BYTES) throw new CaptureError('INVALID_CAPTURE', 'A room photo is missing or is not a JPEG.');
    const dimensions = jpegDimensions(new Uint8Array(await b.arrayBuffer()));
    if (!dimensions || dimensions.width !== p.width || dimensions.height !== p.height || await sha256Blob(b) !== p.sha256) throw new CaptureError('INVALID_CAPTURE', 'A room photo does not match its saved hash or dimensions.');
  }
  const flags = record.flags === null ? null : validateCaptureSuggestions(record.flags, result.value);
  if (flags && !flags.ok) throw new CaptureError(flags.code, flags.error);
  return { manifest: result.value, photos: new Map(record.photos), flags: flags?.ok ? flags.value : null };
}
type Change = (rooms: Map<string, StoredCapture>) => void;
interface Backend { observeGeneration(): Promise<void>; read(roomId: string): Promise<StoredCapture | null>; change(update: Change, reset?: boolean): Promise<void> }
function storeFromBackend(backend: Backend, key: (roomId: string) => string = (id) => id): CaptureStore {
  return serializeCaptureStore({
    read: async (roomId) => { const r = await backend.read(key(roomId)); return r ? checked(r) : null; },
    writeCapture: async (manifest, photos, replaceConfirmed = false, isCurrent, expectedCaptureId) => {
      // Clone before awaiting: caller changes cannot alter queued data or bypass validation.
      const snapshot: StoredCapture = { manifest: structuredClone(manifest), photos: new Map(photos), flags: null };
      // Observe the durable reset generation before reading/hashing photo bytes.
      // A client's first write must not adopt a reset that occurs during validation.
      await backend.observeGeneration();
      const record = await checked(snapshot);
      await backend.change((rooms) => {
        assertCurrent(isCurrent);
        const id = key(record.manifest.roomId);
        if (expectedCaptureId !== undefined && (rooms.get(id)?.manifest.captureId ?? null) !== expectedCaptureId) throw new CaptureError('CAPTURE_MISMATCH', 'This walk-through changed. Reload before replacing.');
        if (rooms.has(id) && !replaceConfirmed) throw new CaptureError('INVALID_CAPTURE', 'Confirm before replacing this room walk-through.');
        rooms.set(id, record);
      });
    },
    writeFlags: async (roomId, flags, isCurrent) => { const snapshot = structuredClone(flags); await backend.change((rooms) => {
      assertCurrent(isCurrent);
      const id = key(roomId), r = rooms.get(id);
      if (!r) throw new CaptureError('CAPTURE_MISMATCH', 'These flags belong to a different capture.');
      const valid = validateCaptureSuggestions(snapshot, r.manifest);
      if (!valid.ok) throw new CaptureError(valid.code, valid.error);
      rooms.set(id, { ...r, flags: valid.value });
    }); },
    remove: (roomId, captureId, isCurrent) => backend.change((rooms) => {
      assertCurrent(isCurrent);
      const id = key(roomId), r = rooms.get(id);
      if (r && r.manifest.captureId !== captureId) throw new CaptureError('CAPTURE_MISMATCH', 'This walk-through changed. Reload before deleting.');
      rooms.delete(id);
    }),
    clear: () => backend.change((rooms) => rooms.clear(), true),
  });
}
function capacity(rooms: Map<string, StoredCapture>, budget: number) {
  if ([...rooms.values()].reduce((s, r) => s + size(r), 0) > budget) throw new CaptureError('CAPACITY', 'Room photos have reached the 120 MiB device limit. Delete a walk-through before saving another.');
}
export function createMemoryCaptureStore(budget = MAX_CAPTURE_STORAGE_BYTES): CaptureStore {
  let rooms = new Map<string, StoredCapture>();
  return storeFromBackend({ observeGeneration: async () => {}, read: async (id) => structuredClone(rooms.get(id) ?? null), change: async (update) => {
    const next = new Map(rooms); update(next); capacity(next, budget); rooms = structuredClone(next);
  } });
}
/** The read/budget check/replacement and durable reset generation share one IDB transaction. */
export function createIndexedDbCaptureStore(factory: IDBFactory | undefined, scope?: { elderId: string; resetEpoch: string }): CaptureStore {
  // Namespace only the database key. Manifests/exports retain ordinary room IDs
  // and contain no account metadata. Legacy string room keys stay classic-only.
  if (scope && (typeof scope.elderId !== 'string' || !scope.elderId || typeof scope.resetEpoch !== 'string' || !scope.resetEpoch)) throw new CaptureError('STORAGE', 'A current community capture owner and reset epoch are required.');
  const prefix = scope ? `community:${JSON.stringify([scope.resetEpoch, scope.elderId])}:` : '';
  // A new client adopts its first successful transaction generation. Readonly
  // refreshes never re-arm a client after a reset in another tab.
  let observedGeneration: number | undefined;
  async function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!factory) return reject(new CaptureError('STORAGE', 'Room photo storage is unavailable.'));
      const request = factory.open(CAPTURE_DATABASE, 1);
      let abandoned = false;
      const timer = setTimeout(() => { abandoned = true; reject(new CaptureError('STORAGE', 'Room database open timed out.')); }, 5000);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
      request.onerror = () => { clearTimeout(timer); reject(new CaptureError('STORAGE', 'Room database could not open.')); };
      request.onblocked = () => { abandoned = true; clearTimeout(timer); reject(new CaptureError('STORAGE', 'Room database is blocked by another view.')); };
      request.onsuccess = () => { clearTimeout(timer); if (abandoned) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    });
  }
  function transaction(mode: 'readonly', run: null): Promise<void>;
  function transaction<T>(mode: IDBTransactionMode, run: (rooms: Map<string, StoredCapture>) => T, reset?: boolean): Promise<T>;
  async function transaction<T>(mode: IDBTransactionMode, run: ((rooms: Map<string, StoredCapture>) => T) | null, reset = false): Promise<T | void> {
    const expectedGeneration = observedGeneration, db = await open();
    try { return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode), s = tx.objectStore(STORE);
      let result: T, commitGeneration: number;
      const timer = setTimeout(() => { try { tx.abort(); } catch { /* ended */ } reject(new CaptureError('STORAGE', 'Room transaction timed out.')); }, 10000);
      tx.oncomplete = () => { clearTimeout(timer); if (reset || observedGeneration === undefined) observedGeneration = commitGeneration; resolve(result); };
      tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(new CaptureError('STORAGE', 'Room data could not be saved or cleared.')); };
      const generation = s.get(GENERATION);
      generation.onsuccess = () => {
        const current: unknown = generation.result ?? 0;
        if (!Number.isSafeInteger(current) || (current as number) < 0 || mode === 'readwrite' && !reset && expectedGeneration !== undefined && current !== expectedGeneration) { reject(stale()); tx.abort(); return; }
        commitGeneration = current as number;
        // A generation-only barrier waits for transaction completion without
        // requesting or cloning any room manifests or photo Blobs.
        if (run === null) return;
        const keys = s.getAllKeys(), records = s.getAll();
        records.onsuccess = () => {
          try {
            const rooms = new Map<string, StoredCapture>();
            keys.result.forEach((key, i) => { if (key !== GENERATION) rooms.set(String(key), records.result[i] as StoredCapture); });
            result = run(rooms);
            if (mode === 'readwrite') {
              capacity(rooms, MAX_CAPTURE_STORAGE_BYTES); s.clear();
              for (const [id, r] of rooms) s.put(r, id);
              if (reset) commitGeneration++;
              s.put(commitGeneration, GENERATION);
            }
          } catch (error) { reject(error); tx.abort(); }
        };
      };
    }); } finally { db.close(); }
  }
  return storeFromBackend({ observeGeneration: () => transaction('readonly', null), read: (id) => transaction('readonly', (rooms) => rooms.get(id) ?? null), change: (update, reset) => transaction('readwrite', update, reset) }, (id) => prefix + id);
}
/** Invalidate immediately; clear waits for already running operations, then removes them. */
export function serializeCaptureStore(store: CaptureStore): CaptureStore {
  let tail: Promise<unknown> = Promise.resolve(), invalidated = false;
  function enqueue<T>(fn: () => Promise<T>, write = false): Promise<T> {
    const result = tail.then(() => { if (write && invalidated) throw stale(); return fn(); });
    tail = result.catch(() => undefined); return result;
  }
  return { read: (id) => enqueue(() => store.read(id)), writeCapture: (m, p, c, current, expected) => {
    const manifest = structuredClone(m), photos = new Map(p);
    return enqueue(() => store.writeCapture(manifest, photos, c, current, expected), true);
  }, writeFlags: (id, f, current) => { const flags = structuredClone(f); return enqueue(() => store.writeFlags(id, flags, current), true); }, remove: (id, captureId, current) => enqueue(() => store.remove(id, captureId, current), true), clear: () => enqueue(() => store.clear()), invalidate: () => { invalidated = true; store.invalidate?.(); } };
}
let browserStore: CaptureStore | undefined;
function browserFactory(): IDBFactory | undefined { try { return globalThis.indexedDB; } catch { return undefined; } }
export function getCaptureStore(): CaptureStore {
  if (!browserStore) browserStore = createIndexedDbCaptureStore(browserFactory());
  return browserStore;
}
/** Call only after authorizing the current actor for this elder. Memoize per view. */
export function getCommunityCaptureStore(elderId: string, resetEpoch: string): CaptureStore {
  return createIndexedDbCaptureStore(browserFactory(), { elderId, resetEpoch });
}
export async function resetCaptureStorage(store = getCaptureStore()): Promise<{ ok: boolean; message: string }> {
  store.invalidate?.();
  try { await store.clear(); if (store === browserStore) browserStore = undefined; return { ok: true, message: 'Room walk-throughs cleared from this device.' }; }
  catch { return { ok: false, message: 'Room walk-throughs could not be cleared; reloading may restore them.' }; }
}
