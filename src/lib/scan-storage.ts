import { validateScanDocument, type ScanDocument } from './scan-model';
import type { SuggestionCatalog } from './scan-suggestions';

export const SCAN_DATABASE = 'fixlist-scan';
const STORE = 'local-scan';
const KEY = 'current';
export interface ScanStore {
  read(): Promise<unknown>;
  write(document: ScanDocument): Promise<void>;
  clear(): Promise<void>;
}
export type ScanStorageResult = { ok: boolean; message: string };

/** The injectable store boundary keeps the validation/failure contract testable without a DOM. */
export async function loadScan(store: ScanStore, concernIds: ReadonlySet<string>, catalog?: SuggestionCatalog): Promise<ScanStorageResult & { document: ScanDocument | null }> {
  try {
    const raw = await store.read();
    if (raw === undefined || raw === null) return { ok: true, document: null, message: 'No saved room scan in this browser.' };
    const result = validateScanDocument(raw, concernIds, catalog);
    if (!result.ok) return { ok: false, document: null, message: `Saved scan was not opened: ${result.error} Saved bytes were left untouched.` };
    const { document, dropped } = result.value;
    const suggestionNotice = document.version === 2 && document.suggestions?.droppedItems
      ? ` ${document.suggestions.droppedItems} model suggestion(s) were dropped because their checklist/concern links are unknown or no longer match the catalog.` : '';
    return { ok: true, document, message: (dropped > 0
      ? `Saved scan loaded. ${dropped} pin${dropped === 1 ? ' was' : 's were'} dropped because the linked concern is no longer in the catalog.`
      : 'Saved scan and pins loaded from this browser. Open the viewer to see them.') + suggestionNotice };
  } catch {
    return { ok: false, document: null, message: 'Scan storage could not be read. You can still import or generate a room in memory; it may not survive a reload.' };
  }
}
export async function saveScan(store: ScanStore, document: ScanDocument, concernIds: ReadonlySet<string>, catalog?: SuggestionCatalog): Promise<ScanStorageResult> {
  const validated = validateScanDocument(document, concernIds, catalog);
  if (!validated.ok || validated.value.dropped > 0) return { ok: false, message: 'Scan was not saved because its data or linked concerns are invalid.' };
  try {
    await store.write(validated.value.document);
    return { ok: true, message: 'Scan, upright setting, pins and model suggestion choices saved in this browser only.' };
  } catch {
    return { ok: false, message: 'Scan changes are in memory only: browser storage could not save them. Reload may restore an older scan or lose these changes.' };
  }
}
export async function clearScan(store: ScanStore): Promise<ScanStorageResult> {
  try { await store.clear(); return { ok: true, message: 'Saved scan and pins cleared from this browser.' }; }
  catch { return { ok: false, message: 'The scan was cleared from this view, but browser storage could not be cleared. Reload may restore the previous scan and pins.' }; }
}

/** One transaction per operation; success means transaction completion, not just request success. */
export function createIndexedDbScanStore(factory: IDBFactory | undefined): ScanStore {
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
  async function transact(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
    const database = await open();
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction(STORE, mode);
        let result: unknown;
        const timeout = setTimeout(() => { try { transaction.abort(); } catch { /* Already ended. */ } reject(new Error('Scan transaction timed out')); }, 10000);
        transaction.oncomplete = () => { clearTimeout(timeout); resolve(result); };
        transaction.onabort = transaction.onerror = () => { clearTimeout(timeout); reject(new Error('Scan transaction failed')); };
        try {
          const request = operation(transaction.objectStore(STORE));
          request.onsuccess = () => { result = request.result; };
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
    clear: async () => { await transact('readwrite', (store) => store.clear()); },
  };
}

/** Serialize reads, writes and reset so an older in-flight write cannot resurrect a reset scan. */
export function serializeScanStore(store: ScanStore): ScanStore {
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.catch(() => undefined);
    return result;
  }
  return { read: () => enqueue(() => store.read()), write: (document) => enqueue(() => store.write(document)), clear: () => enqueue(() => store.clear()) };
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
export function resetScanStorage(): Promise<ScanStorageResult> { return clearScan(getScanStore()); }
