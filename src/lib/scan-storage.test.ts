import { describe, expect, it, vi } from 'vitest';
import { clearScan, createIndexedDbScanStore, loadScan, saveScan, serializeScanStore, SCAN_DATABASE, type ScanStore } from './scan-storage';
import type { ScanDocument, ScanPin } from './scan-model';
import { verifiedSceneHash } from './scan-model';
import { suggestionCatalogFixture, suggestionDocumentFixture } from './scan-suggestions.fixture';

const concerns = new Set(['rug']);
const pin: ScanPin = { id: 'pin-1', concernId: 'rug', position: [0, 1, 0], createdAt: '2026-10-17T14:00:00.000Z' };
function document(): ScanDocument {
  return { version: 1, asset: { name: 'room.splat', blob: new Blob([new Uint8Array(32)]), metadata: null, kind: 'imported' }, flipUpright: true, pins: [pin] };
}
class MemoryStore implements ScanStore {
  value: unknown;
  failRead = false; failWrite = false; failClear = false;
  writes = 0; clears = 0;
  async read(): Promise<unknown> { if (this.failRead) throw new Error('Denied'); return this.value; }
  async write(value: ScanDocument) { if (this.failWrite) throw new Error('Quota exceeded'); this.writes++; this.value = value; }
  async clear() { if (this.failClear) throw new Error('Denied'); this.clears++; this.value = undefined; }
}

describe('scan persistence contract through an injectable store', () => {
  it('hashes cold restored scene bytes before publishing identified suggestions and preserves typed mismatches', async () => {
    const store = new MemoryStore(), input = suggestionDocumentFixture(), ids = new Set(['rug-concern']);
    const cold = structuredClone(input); store.value = cold;
    expect(verifiedSceneHash(cold.asset.blob)).toBeUndefined();
    const restored = await loadScan(store, ids, suggestionCatalogFixture);
    expect(restored).toMatchObject({ ok: true, document: { suggestions: input.suggestions } });
    expect(verifiedSceneHash(cold.asset.blob)).toBe(input.suggestions.data.scan.identity!.sceneSHA256);
    const wrongScene = { ...cold, asset: { ...cold.asset, blob: new Blob([new Uint8Array(32).fill(1)]) } }; store.value = wrongScene;
    expect(await loadScan(store, ids, suggestionCatalogFixture)).toMatchObject({ ok: false, code: 'SCENE_IDENTITY_MISMATCH', document: null });
    expect(store.value).toBe(wrongScene); expect(store.writes).toBe(0);
    delete input.suggestions.data.scan.identity; store.value = input;
    expect(await loadScan(store, ids, suggestionCatalogFixture)).toMatchObject({ ok: false, code: 'SCENE_IDENTITY_MISSING', document: null });
    expect(await saveScan(store, input, ids, suggestionCatalogFixture)).toMatchObject({ ok: false, code: 'SCENE_IDENTITY_MISSING' });
  });
  it('keeps an absent database empty without a write', async () => {
    const store = new MemoryStore();
    expect(await loadScan(store, concerns)).toMatchObject({ ok: true, document: null });
    expect(store.writes).toBe(0);
  });
  it('round trips scan bytes, orientation and pins separately from workflow storage', async () => {
    const store = new MemoryStore(), input = document();
    expect(await saveScan(store, input, concerns)).toMatchObject({ ok: true });
    expect(await loadScan(store, concerns)).toMatchObject({ ok: true, document: input });
    expect(SCAN_DATABASE).toBe('fixlist-scan');
    expect(Object.keys(store.value as object)).not.toContain('checklistAnswers');
  });
  it('reports invalid saved data, preserving bytes for recovery without auto-saving', async () => {
    const store = new MemoryStore();
    const bad = { ...document(), version: 99 };
    store.value = bad;
    expect(await loadScan(store, concerns)).toMatchObject({ ok: false, document: null, message: expect.stringContaining('left untouched') });
    expect(store.value).toBe(bad);
    expect(store.writes).toBe(0);
  });
  it('surfaces catalog filtering in the load notice without rewriting the stored pins', async () => {
    const store = new MemoryStore(), input = document();
    store.value = { ...input, pins: [pin, { ...pin, id: 'old', concernId: 'retired' }] };
    const result = await loadScan(store, concerns);
    expect(result).toMatchObject({ ok: true, document: { pins: [pin] }, message: expect.stringContaining('1 pin was dropped') });
    expect(store.writes).toBe(0);
  });
  it('rejects bad save data and unknown concern IDs before writing', async () => {
    const store = new MemoryStore();
    expect(await saveScan(store, { ...document(), pins: [{ ...pin, concernId: 'retired' }] }, concerns)).toMatchObject({ ok: false });
    expect(await saveScan(store, { ...document(), pins: [{ ...pin, position: [NaN, 0, 0] }] }, concerns)).toMatchObject({ ok: false });
    expect(store.writes).toBe(0);
  });
  it('truthfully reports read denial while allowing a fresh in-memory room', async () => {
    const store = new MemoryStore(); store.failRead = true;
    expect(await loadScan(store, concerns)).toMatchObject({ ok: false, document: null, message: expect.stringContaining('in memory') });
  });
  it('truthfully reports quota/write denial and preserves the caller’s in-memory document', async () => {
    const store = new MemoryStore(); store.failWrite = true;
    const input = document();
    expect(await saveScan(store, input, concerns)).toMatchObject({ ok: false, message: expect.stringContaining('in memory only') });
    expect(input.pins).toEqual([pin]);
    expect(store.value).toBeUndefined();
  });
  it('clears only its own scan store and reports a failed clear without claiming deletion', async () => {
    const store = new MemoryStore(); store.value = document(); store.failClear = true;
    expect(await clearScan(store)).toMatchObject({ ok: false, message: expect.stringContaining('Reload may restore') });
    expect(store.value).toBeDefined();
    store.failClear = false;
    expect(await clearScan(store)).toMatchObject({ ok: true });
    expect(store.value).toBeUndefined();
  });
  it('orders pending writes before reset so late transaction completion cannot resurrect a scan', async () => {
    const calls: string[] = [];
    let finish: (() => void) | undefined;
    const underlying: ScanStore = {
      read: async () => undefined,
      write: async () => { calls.push('write-start'); await new Promise<void>((resolve) => { finish = resolve; }); calls.push('write-end'); },
      clear: async () => { calls.push('clear'); },
    };
    const store = serializeScanStore(underlying);
    const write = store.write(document()), reset = store.clear();
    await Promise.resolve();
    expect(calls).toEqual(['write-start']);
    finish?.();
    await Promise.all([write, reset]);
    expect(calls).toEqual(['write-start', 'write-end', 'clear']);
  });
  it('allows reset and later reads after a rejected write', async () => {
    const underlying = new MemoryStore(); underlying.failWrite = true;
    const store = serializeScanStore(underlying);
    await expect(store.write(document())).rejects.toThrow();
    await store.clear();
    await expect(store.read()).resolves.toBeUndefined();
    expect(underlying.clears).toBe(1);
  });
  it('turns unavailable IndexedDB and factory acquisition errors into truthful failures', async () => {
    const absent = createIndexedDbScanStore(undefined);
    expect(await saveScan(absent, document(), concerns)).toMatchObject({ ok: false });
    expect(await clearScan(absent)).toMatchObject({ ok: false });
    const denied = createIndexedDbScanStore({ open: () => { throw new Error('Blocked by browser'); } } as unknown as IDBFactory);
    expect(await loadScan(denied, concerns)).toMatchObject({ ok: false, document: null });
  });
});

/** Small event harness checks the real adapter boundary: request success is not commit. */
function idbHarness() {
  let request: { onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void; onblocked?: () => void; result?: unknown };
  let transaction: { oncomplete?: () => void; onabort?: () => void; onerror?: () => void; objectStore: () => unknown; abort: () => void };
  let operation: { onsuccess?: () => void; result?: unknown };
  const close = vi.fn(), createObjectStore = vi.fn();
  const store = { get: vi.fn((key: string) => { if (key === '__reset_generation') { const generation = { result: 0, onsuccess: undefined as (() => void) | undefined }; queueMicrotask(() => generation.onsuccess?.()); return generation; } operation = {}; return operation; }), put: vi.fn(() => { operation = {}; return operation; }), clear: vi.fn(() => { operation = {}; return operation; }) };
  const database = {
    close, createObjectStore, onversionchange: undefined,
    objectStoreNames: { contains: () => false },
    transaction: vi.fn(() => {
      transaction = { objectStore: () => store, abort: () => transaction.onabort?.() };
      return transaction;
    }),
  };
  const open = vi.fn(() => { request = {}; queueMicrotask(() => { request.result = database; request.onsuccess?.(); }); return request; });
  return {
    factory: { open } as unknown as IDBFactory, close, open, store, database, createObjectStore,
    success(value?: unknown) { operation.result = value; operation.onsuccess?.(); },
    commit() { transaction.oncomplete?.(); }, abort() { transaction.onabort?.(); },
    upgrade() { request.onupgradeneeded?.(); }, blocked() { request.onblocked?.(); },
  };
}

describe('IndexedDB transaction adapter', () => {
  it('uses a dedicated database/store and waits for transaction commit before reporting a save', async () => {
    const harness = idbHarness(), adapter = createIndexedDbScanStore(harness.factory);
    let finished = false;
    const saving = saveScan(adapter, document(), concerns).then((result) => { finished = true; return result; });
    await vi.waitFor(() => expect(harness.store.put).toHaveBeenCalledOnce());
    expect(harness.open).toHaveBeenCalledWith('fixlist-scan', 1);
    expect(harness.database.transaction).toHaveBeenCalledWith('local-scan', 'readwrite');
    harness.success();
    await Promise.resolve();
    expect(finished).toBe(false);
    harness.commit();
    expect(await saving).toMatchObject({ ok: true });
    expect(harness.close).toHaveBeenCalledOnce();
  });
  it('reports an aborted transaction as a failure even after the put request succeeded', async () => {
    const harness = idbHarness(), adapter = createIndexedDbScanStore(harness.factory);
    const saving = saveScan(adapter, document(), concerns);
    await vi.waitFor(() => expect(harness.store.put).toHaveBeenCalledOnce());
    harness.success(); harness.abort();
    expect(await saving).toMatchObject({ ok: false, message: expect.stringContaining('in memory only') });
    expect(harness.close).toHaveBeenCalledOnce();
  });
  it('loads untrusted data only after a readonly transaction completes, then validates it', async () => {
    const harness = idbHarness(), adapter = createIndexedDbScanStore(harness.factory);
    const loading = loadScan(adapter, concerns);
    await vi.waitFor(() => expect(harness.store.get).toHaveBeenCalledWith('current'));
    harness.success({ arbitrary: 'untrusted' }); harness.commit();
    expect(await loading).toMatchObject({ ok: false, document: null });
    expect(harness.database.transaction).toHaveBeenCalledWith('local-scan', 'readonly');
    expect(harness.close).toHaveBeenCalledOnce();
  });
  it('clears its object store and closes the connection only after commit', async () => {
    const harness = idbHarness(), adapter = createIndexedDbScanStore(harness.factory);
    const clearing = clearScan(adapter);
    await vi.waitFor(() => expect(harness.store.clear).toHaveBeenCalledOnce());
    expect(harness.close).not.toHaveBeenCalled();
    harness.success(); harness.commit();
    expect(await clearing).toMatchObject({ ok: true });
    expect(harness.close).toHaveBeenCalledOnce();
  });
});
