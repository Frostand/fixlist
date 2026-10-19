import { describe, expect, it } from 'vitest';
import { createIndexedDbScanStore, loadScan, saveScan, clearScan } from './scan-storage';
import { createIndexedDbPhotoStore } from './photo-storage';
import type { ScanDocument } from './scan-model';

/** Shared transactional IDB harness: independent adapters share durable records, never JS queues. */
function databaseFactory(): IDBFactory {
  const records = new Map<string, Map<string, unknown>>();
  const tails = new Map<string, Promise<void>>();
  return { open(name: string) {
    const opening: any = {};
    queueMicrotask(() => {
      if (!records.has(name)) records.set(name, new Map());
      opening.result = { close() {}, objectStoreNames: { contains: () => true }, transaction(_store: string, mode: string) {
        let release!: () => void;
        const predecessor = tails.get(name) ?? Promise.resolve();
        tails.set(name, new Promise<void>((r) => { release = r; }));
        const tx: any = {};
        let local = new Map<string, unknown>(), active = false, stopped = false, scheduled = false;
        const jobs: Array<() => void> = [];
        function flush() {
          if (!active || stopped || scheduled) return;
          scheduled = true;
          queueMicrotask(() => {
            scheduled = false;
            if (stopped) return;
            const job = jobs.shift();
            if (job) { job(); flush(); }
            else { stopped = true; if (mode === 'readwrite') records.set(name, local); tx.oncomplete?.(); release(); }
          });
        }
        function request(work: () => unknown) { const req: any = {}; jobs.push(() => { req.result = work(); req.onsuccess?.(); }); flush(); return req; }
        tx.objectStore = () => ({
          get: (key: string) => request(() => local.get(key)),
          put: (value: unknown, key: string) => request(() => { local.set(key, value); return key; }),
          delete: (key: string) => request(() => local.delete(key)),
          clear: () => request(() => local.clear()),
        });
        tx.abort = () => { if (stopped) return; stopped = true; tx.onabort?.(); release(); };
        void predecessor.then(() => { if (stopped) return; local = new Map(records.get(name)); active = true; flush(); });
        return tx;
      } };
      opening.onsuccess?.();
    });
    return opening;
  } } as unknown as IDBFactory;
}
const concerns = new Set(['rug']);
function scan(): ScanDocument { return { version: 1, asset: { name: 'room.splat', blob: new Blob([new Uint8Array(32)]), kind: 'imported', metadata: null }, flipUpright: false, pins: [] }; }
describe('durable media reset generations', () => {
  it('D03 a second independently instantiated scan client cannot restore a retained document after reset', async () => {
    const factory = databaseFactory(), a = createIndexedDbScanStore(factory), b = createIndexedDbScanStore(factory);
    expect((await saveScan(a, scan(), concerns)).ok).toBe(true);
    const retained = await loadScan(a, concerns);
    expect((await clearScan(b)).ok).toBe(true);
    expect(await saveScan(a, retained.document!, concerns)).toMatchObject({ ok: false, code: 'stale_revision' });
    const reloaded = await loadScan(createIndexedDbScanStore(factory), concerns);
    expect(reloaded.document).toBe(null);
    // A deliberate fresh read establishes the new generation for new work.
    await loadScan(a, concerns);
    expect((await saveScan(a, scan(), concerns)).ok).toBe(true);
  });
  it('D01 an independent stale photo client cannot put its backup back after reset', async () => {
    const factory = databaseFactory(), a = createIndexedDbPhotoStore(factory), b = createIndexedDbPhotoStore(factory);
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    await a.write('photo-one', blob);
    const backup = await a.read('photo-one');
    await b.clear();
    await expect(a.write('photo-one', backup!)).rejects.toMatchObject({ code: 'stale_revision' });
    expect(await createIndexedDbPhotoStore(factory).read('photo-one')).toBe(null);
  });
  it('D03 a reset serializes after an already-started other-client write, then removes it', async () => {
    const factory = databaseFactory(), a = createIndexedDbScanStore(factory), b = createIndexedDbScanStore(factory);
    const writing = saveScan(a, scan(), concerns), clearing = clearScan(b);
    await Promise.all([writing, clearing]);
    expect((await loadScan(createIndexedDbScanStore(factory), concerns)).document).toBe(null);
  });
});
