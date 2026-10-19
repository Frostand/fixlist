import { OperationError, operationFailure, type FailureCode } from '../domain/failures';
import { validateScanDocument, validateScanDocumentAsync, type ScanDocument, type ScanErrorCode } from './scan-model';
import type { SuggestionCatalog } from './scan-suggestions';

export const SCAN_DATABASE = 'fixlist-scan';
const STORE = 'local-scan';
const KEY = 'current';
const GENERATION_KEY = '__reset_generation';
export interface ScanStore {
  read(): Promise<unknown>;
  write(document: ScanDocument): Promise<void>;
  clear(): Promise<void>;
  invalidate?(): void;
}
export type ScanFailureCode = FailureCode | ScanErrorCode;
export type ScanStorageResult = { ok: true; message: string } | { ok: false; message: string; code: ScanFailureCode };

/** The injectable store boundary keeps the validation/failure contract testable without a DOM. */
export async function loadScan(store: ScanStore, concernIds: ReadonlySet<string>, catalog?: SuggestionCatalog): Promise<ScanStorageResult & { document: ScanDocument | null }> {
  try {
    const raw = await store.read();
    if (raw === undefined || raw === null) return { ok: true, document: null, message: 'No saved room scan in this browser.' };
    const result = await validateScanDocumentAsync(raw, concernIds, catalog);
    if (!result.ok) return { ok: false, code: result.code ?? 'invalid_media', document: null, message: `Saved scan was not opened: ${result.error} Saved bytes were left untouched.` };
    const { document, dropped } = result.value;
    const suggestionNotice = document.version === 2 && document.suggestions?.droppedItems
      ? ` ${document.suggestions.droppedItems} model suggestion(s) were dropped because their checklist/concern links are unknown or no longer match the catalog.` : '';
    return { ok: true, document, message: (dropped > 0
      ? `Saved scan loaded. ${dropped} pin${dropped === 1 ? ' was' : 's were'} dropped because the linked concern is no longer in the catalog.`
      : 'Saved scan and pins loaded from this browser. Open the viewer to see them.') + suggestionNotice };
  } catch (error) {
    return { ok: false, code: operationFailure(error, 'storage_unavailable').code, document: null, message: 'Scan storage could not be read. You can still import or generate a room in memory; it may not survive a reload.' };
  }
}
export async function saveScan(store: ScanStore, document: ScanDocument, concernIds: ReadonlySet<string>, catalog?: SuggestionCatalog): Promise<ScanStorageResult> {
  const validated = validateScanDocument(document, concernIds, catalog);
  if (!validated.ok || validated.value.dropped > 0) return { ok: false, code: !validated.ok ? validated.code ?? 'invalid_media' : 'invalid_media', message: 'Scan was not saved because its data or linked concerns are invalid.' };
  try {
    await store.write(validated.value.document);
    return { ok: true, message: 'Scan, upright setting, pins and model suggestion choices saved in this browser only.' };
  } catch (error) {
    return { ok: false, code: operationFailure(error, 'storage_unavailable').code, message: 'Scan changes are in memory only: browser storage could not save them. Reload may restore an older scan or lose these changes.' };
  }
}
export async function clearScan(store: ScanStore): Promise<ScanStorageResult> {
  try { await store.clear(); return { ok: true, message: 'Saved scan and pins cleared from this browser.' }; }
  catch (error) { return { ok: false, code: operationFailure(error, 'storage_unavailable').code, message: 'The scan was cleared from this view, but browser storage could not be cleared. Reload may restore the previous scan and pins.' }; }
}

/** One transaction per operation; success means transaction completion, not just request success. */
export function createIndexedDbScanStore(factory: IDBFactory | undefined): ScanStore {
  let observedGeneration = 0;
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!factory) { reject(new Error('IndexedDB unavailable')); return; }
      const request = factory.open(SCAN_DATABASE, 1);
      let abandoned = false;
      const timeout = setTimeout(() => { abandoned = true; reject(new Error('Scan database open timed out')); }, 5000);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onerror = () => { clearTimeout(timeout); reject(new Error('Scan database open failed')); };
      request.onblocked = () => { abandoned = true; clearTimeout(timeout); reject(new Error('Scan database is blocked by another tab')); };
      request.onsuccess = () => {
        clearTimeout(timeout);
        if (abandoned) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }
  async function transact(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest, reset = false): Promise<unknown> {
    const expectedGeneration = observedGeneration;
    const database = await open();
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        let result: unknown;
        let commitGeneration: number | undefined;
        const timeout = setTimeout(() => { try { transaction.abort(); } catch { /* Already ended. */ } reject(new Error('Scan transaction timed out')); }, 10000);
        transaction.oncomplete = () => { clearTimeout(timeout); if (commitGeneration !== undefined) observedGeneration = commitGeneration; resolve(result); };
        transaction.onabort = transaction.onerror = () => { clearTimeout(timeout); reject(new Error('Scan transaction failed')); };
        try {
          const store = transaction.objectStore(STORE);
          const generation = store.get(GENERATION_KEY);
          generation.onsuccess = () => {
            try {
              const current = generation.result ?? 0;
              if (!Number.isSafeInteger(current) || current < 0 || mode === 'readwrite' && !reset && current !== expectedGeneration) {
                clearTimeout(timeout);
                reject(new OperationError('stale_revision', 'Scan reset in another view. Reload before saving.'));
                transaction.abort();
                return;
              }
              if (mode === 'readonly') commitGeneration = current;
              const request = operation(store);
              request.onsuccess = () => { result = request.result; };
              if (reset) { store.put(current + 1, GENERATION_KEY); commitGeneration = current + 1; }
            } catch (error) {
              clearTimeout(timeout); reject(error);
              try { transaction.abort(); } catch { /* ended */ }
            }
          };
        } catch (error) {
          clearTimeout(timeout);
          try { transaction.abort(); } catch { /* Already ended. */ }
          reject(error);
        }
      });
    } finally { database.close(); }
  }
  return {
    read: () => transact('readonly', (store) => store.get(KEY)),
    write: async (document) => { await transact('readwrite', (store) => store.put(document, KEY)); },
    clear: async () => { await transact('readwrite', (store) => store.clear(), true); },
  };
}

/** Serialize reads, writes and reset so an older in-flight write cannot resurrect a reset scan. */
export function serializeScanStore(store: ScanStore): ScanStore {
  let tail: Promise<unknown> = Promise.resolve();
  let invalidated = false;
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.catch(() => undefined);
    return result;
  }
  return { read: () => enqueue(() => store.read()), write: (document) => invalidated ? Promise.reject(new OperationError('cancelled', 'Scan operation cancelled by reset.')) : enqueue(() => store.write(document)), clear: () => enqueue(() => store.clear()), invalidate: () => { invalidated = true; } };
}
let browserStore: ScanStore | undefined;
export function getScanStore(): ScanStore {
  if (!browserStore) {
    let factory: IDBFactory | undefined;
    try { factory = globalThis.indexedDB; } catch { /* Browser privacy policy may deny acquisition. */ }
    browserStore = serializeScanStore(createIndexedDbScanStore(factory));
  }
  return browserStore;
}
export async function resetScanStorage(): Promise<ScanStorageResult> { const store = getScanStore(); store.invalidate?.(); const result = await clearScan(store); browserStore = undefined; return result; }
