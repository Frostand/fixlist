import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../scan/tests/capture-parity/valid-bundle.json';
import flags from '../../scan/tests/capture-parity/valid-flags.json';
import { buildCaptureBundle, parseCaptureBundle } from './capture-bundle';
import { validateCaptureSuggestions } from './capture-suggestions';
import { createIndexedDbCaptureStore, createMemoryCaptureStore, getCaptureStore, getCommunityCaptureStore, resetCaptureStorage, serializeCaptureStore, type CaptureStore } from './capture-storage';
import { sha256Blob } from './capture-model';
import { resetFixListData } from './demo-storage';
import { demoScenario } from '../data/demo-scenario';
async function data() { const parsed = await parseCaptureBundle(JSON.stringify(fixture)); if (!parsed.ok) throw new Error(parsed.error); return parsed.value; }
afterEach(() => vi.unstubAllGlobals());
describe('community capture namespaces in the shared database', () => {
  afterEach(async () => { await resetCaptureStorage(getCaptureStore()); });
  it('isolates A/B reads, writes, flags, replacement and removal; legacy stays classic-only', async () => {
    vi.stubGlobal('indexedDB', databaseFactory());
    const classic = getCaptureStore(), a = getCommunityCaptureStore('elder-a', 'reset-1'), b = getCommunityCaptureStore('elder-b', 'reset-1');
    const { manifest, photos } = await data();
    await classic.writeCapture(manifest, photos);
    expect(await a.read(manifest.roomId)).toBeNull(); expect(await b.read(manifest.roomId)).toBeNull();
    const ma = { ...manifest, captureId: 'cap-community-a01' }, mb = { ...manifest, captureId: 'cap-community-b01' };
    await a.writeCapture(ma, photos, false, undefined, null);
    await b.writeCapture(mb, photos, false, undefined, null);
    expect((await getCommunityCaptureStore('elder-a', 'reset-1').read(manifest.roomId))?.manifest).toEqual(ma);
    await expect(b.writeCapture(ma, photos, true, undefined, ma.captureId)).rejects.toMatchObject({ code: 'CAPTURE_MISMATCH' });
    await a.writeCapture({ ...ma, captureId: 'cap-community-a02' }, photos, true, undefined, ma.captureId);
    const fa = { ...flags, capture: { ...flags.capture, captureId: 'cap-community-a02' } };
    const parsed = validateCaptureSuggestions(fa, { ...ma, captureId: 'cap-community-a02' }); if (!parsed.ok) throw new Error(parsed.error);
    await a.writeFlags(manifest.roomId, parsed.value);
    expect((await b.read(manifest.roomId))?.flags).toBeNull();
    await a.remove(manifest.roomId, 'cap-community-a02');
    expect((await b.read(manifest.roomId))?.manifest).toEqual(mb);
    const legacy = await classic.read(manifest.roomId); expect(legacy?.manifest).toEqual(manifest);
    const owned = (await b.read(manifest.roomId))!;
    expect(Object.keys(owned.manifest)).toEqual(Object.keys(manifest));
    const exported = JSON.parse((await buildCaptureBundle(owned.manifest, owned.photos)).text);
    expect(exported.roomId).toBe(manifest.roomId);
    expect(Object.keys(exported)).toEqual(Object.keys(fixture));
    expect(JSON.stringify(exported)).not.toContain('elder-b');
    expect(JSON.stringify(exported)).not.toContain('reset-1');
    expect((await resetCaptureStorage(classic)).ok).toBe(true);
  });
  it('separates epochs and prevents pending/old clients from resurrecting data after durable reset', async () => {
    vi.stubGlobal('indexedDB', databaseFactory());
    const old = getCommunityCaptureStore('elder-a', 'reset-1'), next = getCommunityCaptureStore('elder-a', 'reset-2'), { manifest, photos } = await data();
    await old.writeCapture(manifest, photos);
    expect(await next.read(manifest.roomId)).toBeNull();
    const blob = photos.get('p01')!, bytes = await blob.arrayBuffer();
    let began!: () => void, release!: () => void;
    const started = new Promise<void>(r => { began = r; }), blocked = new Promise<void>(r => { release = r; });
    blob.arrayBuffer = async () => { began(); await blocked; return bytes; };
    const pending = old.writeCapture(manifest, photos, true).catch((e: unknown) => e);
    await started; await resetCaptureStorage(getCaptureStore()); release();
    expect(await pending).toMatchObject({ code: 'CANCELLED' });
    expect(await old.read(manifest.roomId)).toBeNull();
    await expect(old.writeCapture(manifest, photos)).rejects.toMatchObject({ code: 'CANCELLED' });
    await getCommunityCaptureStore('elder-a', 'reset-2').writeCapture(manifest, photos);
    expect((await next.read(manifest.roomId))?.manifest.roomId).toBe(manifest.roomId);
    await resetCaptureStorage(getCaptureStore());
  });
  it('enforces one 120 MiB budget across classic, elders and epochs', async () => {
    vi.stubGlobal('indexedDB', databaseFactory());
    const { manifest, photos } = await data(), first = manifest.photos[0]!, original = photos.get(first.photoId)!;
    const bytes = new Uint8Array(await original.arrayBuffer());
    const large = new Blob([bytes.slice(0, -2), new Uint8Array(8 * 1024 * 1024 - original.size), bytes.slice(-2)], { type: 'image/jpeg' });
    const capture = { ...manifest, photos: [{ ...first, sha256: await sha256Blob(large) }] }, blobs = new Map([[first.photoId, large]]);
    await getCaptureStore().writeCapture(capture, blobs);
    for (let i = 0; i < 13; i++) await getCommunityCaptureStore(`elder-${i}`, `epoch-${i}`).writeCapture(capture, blobs);
    const last = getCommunityCaptureStore('elder-last', 'epoch-last');
    await expect(last.writeCapture(capture, blobs)).rejects.toMatchObject({ code: 'CAPACITY' });
    expect(await last.read(manifest.roomId)).toBeNull();
    expect((await getCaptureStore().read(manifest.roomId))?.manifest).toEqual(capture);
    await resetCaptureStorage(getCaptureStore());
  });
});
describe('capture storage atomicity and reset', () => {
  it('stores per-photo blobs and latest validated flags, requiring consent to replace', async () => {
    const store = createMemoryCaptureStore(), { manifest, photos } = await data();
    await store.writeCapture(manifest, photos);
    await expect(store.writeCapture({ ...manifest, captureId: 'cap-replacement-0002' }, photos)).rejects.toThrow('Confirm');
    const parsed = validateCaptureSuggestions(flags, manifest); if (!parsed.ok) throw new Error(parsed.error);
    await store.writeFlags(manifest.roomId, parsed.value);
    const stored = await store.read(manifest.roomId); expect(stored?.manifest).toEqual(manifest); expect(stored?.flags).toEqual(flags);
    expect(await stored?.photos.get('p01')?.arrayBuffer()).toEqual(await photos.get('p01')?.arrayBuffer());
    await store.writeCapture({ ...manifest, captureId: 'cap-replacement-0002' }, photos, true);
    expect((await store.read(manifest.roomId))?.flags).toBe(null);
    await expect(store.writeFlags(manifest.roomId, parsed.value)).rejects.toMatchObject({ code: 'CAPTURE_MISMATCH' });
    await expect(store.remove(manifest.roomId, manifest.captureId)).rejects.toThrow('changed');
    await store.remove(manifest.roomId, 'cap-replacement-0002'); expect(await store.read(manifest.roomId)).toBe(null);
  });
  it('enforces a total budget across rooms and preserves old data on failure', async () => {
    const { manifest, photos } = await data(), size = new Blob([JSON.stringify(manifest), 'null']).size + [...photos.values()].reduce((n, b) => n + b.size, 0);
    const store = createMemoryCaptureStore(size);
    await store.writeCapture(manifest, photos);
    await expect(store.writeCapture({ ...manifest, roomId: 'hallway' }, photos)).rejects.toMatchObject({ code: 'CAPACITY' });
    expect((await store.read(manifest.roomId))?.manifest.captureId).toBe(manifest.captureId);
    expect(await store.read('hallway')).toBe(null);
  });
  it('rejects mutated JPEGs and missing or unknown photo blobs without overwriting', async () => {
    const { manifest, photos } = await data(), store = createMemoryCaptureStore(); await store.writeCapture(manifest, photos);
    for (const bad of [new Map(), new Map([...photos, ['extra', photos.get('p01')!]]), new Map([...photos, ['p01', new Blob(['changed'], { type: 'image/jpeg' })]])]) await expect(store.writeCapture(manifest, bad, true)).rejects.toThrow();
    expect((await store.read(manifest.roomId))?.manifest).toEqual(manifest);
  });
  it('snapshots queued inputs and returned records rather than sharing mutable metadata', async () => {
    const { manifest, photos } = await data(), store = createMemoryCaptureStore();
    const write = store.writeCapture(manifest, photos); manifest.roomId = 'hallway'; await write;
    const record = await store.read('living-room'); record!.manifest.roomId = 'bathroom'; expect((await store.read('living-room'))?.manifest.roomId).toBe('living-room');
  });
  it('checks current authorization after photo validation and before mutations commit', async () => {
    const { manifest, photos } = await data(), store = createMemoryCaptureStore();
    let current = true, started!: () => void, release!: () => void;
    const began = new Promise<void>((r) => { started = r; }), blocked = new Promise<void>((r) => { release = r; });
    const blob = photos.get('p01')!, bytes = await blob.arrayBuffer();
    blob.arrayBuffer = async () => { started(); await blocked; return bytes; };
    const writing = store.writeCapture(manifest, photos, false, () => current);
    await began; current = false; release();
    await expect(writing).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(await store.read(manifest.roomId)).toBe(null);
    await store.writeCapture(manifest, photos);
    const parsed = validateCaptureSuggestions(flags, manifest); if (!parsed.ok) throw new Error(parsed.error);
    await expect(store.writeFlags(manifest.roomId, parsed.value, () => false)).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(store.remove(manifest.roomId, manifest.captureId, () => false)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect((await store.read(manifest.roomId))?.flags).toBe(null);
  });
  it('binds replacement consent to the capture observed before the tour', async () => {
    const { manifest, photos } = await data(), store = createMemoryCaptureStore();
    await store.writeCapture(manifest, photos, false, undefined, null);
    const changed = { ...manifest, captureId: 'cap-another-client' };
    await store.writeCapture(changed, photos, true, undefined, manifest.captureId);
    await expect(store.writeCapture({ ...manifest, captureId: 'cap-late-tour-0001' }, photos, true, undefined, manifest.captureId)).rejects.toMatchObject({ code: 'CAPTURE_MISMATCH' });
    await expect(store.writeCapture(manifest, photos, false, undefined, null)).rejects.toMatchObject({ code: 'CAPTURE_MISMATCH' });
    expect((await store.read(manifest.roomId))?.manifest.captureId).toBe(changed.captureId);
  });
  it('keeps old clients stale after a cross-client reset, even after readonly refresh', async () => {
    const factory = databaseFactory(), old = createIndexedDbCaptureStore(factory), resetting = createIndexedDbCaptureStore(factory), { manifest, photos } = await data();
    await old.writeCapture(manifest, photos);
    await resetting.clear();
    expect(await old.read(manifest.roomId)).toBe(null);
    await expect(old.writeCapture(manifest, photos)).rejects.toMatchObject({ code: 'CANCELLED' });
    const fresh = createIndexedDbCaptureStore(factory);
    expect(await fresh.read(manifest.roomId)).toBe(null);
    await fresh.writeCapture(manifest, photos);
    expect((await fresh.read(manifest.roomId))?.manifest.captureId).toBe(manifest.captureId);
  });
  it('observes only generation before photo validation and cannot adopt an intervening reset', async () => {
    const reads: string[] = [];
    const factory = databaseFactory((method, key) => reads.push(key ? `${method}:${key}` : method)), writing = createIndexedDbCaptureStore(factory), resetting = createIndexedDbCaptureStore(factory), { manifest, photos } = await data();
    const photo = photos.get('p01')!, bytes = await photo.arrayBuffer();
    let started!: () => void, release!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; }), blocked = new Promise<void>((resolve) => { release = resolve; });
    photo.arrayBuffer = async () => { started(); await blocked; return bytes; };
    const pending = writing.writeCapture(manifest, photos).catch((error: unknown) => error);
    await began; const preflightReads = [...reads]; await resetting.clear(); release();
    expect(await pending).toMatchObject({ code: 'CANCELLED' });
    expect(preflightReads).toEqual(['get:__reset_generation']);
    expect(await createIndexedDbCaptureStore(factory).read(manifest.roomId)).toBe(null);
  });
  it('waits for an active write, rejects queued and late writes, and clears bytes on reset', async () => {
    const { manifest, photos } = await data(), underlying = createMemoryCaptureStore();
    let start!: () => void, release!: () => void;
    const started = new Promise<void>((r) => { start = r; }), blocked = new Promise<void>((r) => { release = r; });
    const store = serializeCaptureStore({ ...underlying, writeCapture: async (...args) => { start(); await blocked; await underlying.writeCapture(...args); } });
    const first = store.writeCapture(manifest, photos); await started;
    const queued = store.writeCapture({ ...manifest, roomId: 'bathroom' }, photos).catch((e: unknown) => e);
    const reset = resetCaptureStorage(store); release(); await first.catch((e: unknown) => expect(e).toMatchObject({ code: 'CANCELLED' })); expect((await reset).ok).toBe(true);
    expect(await queued).toMatchObject({ code: 'CANCELLED' });
    await expect(store.writeCapture(manifest, photos)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(await underlying.read(manifest.roomId)).toBe(null);
  });
  it('reports unavailable storage and still attempts every owned reset store after failures', async () => {
    const store = createIndexedDbCaptureStore(undefined); await expect(store.read('bathroom')).rejects.toThrow('unavailable'); expect((await resetCaptureStorage(store)).ok).toBe(false);
    const attempts: string[] = [];
    const result = await resetFixListData(null, demoScenario, { photos: async () => { attempts.push('photos'); throw new Error('denied'); }, scan: async () => { attempts.push('scan'); return { ok: false, code: 'storage_unavailable', message: '' }; }, captures: async () => { attempts.push('captures'); return { ok: true, message: '' }; } });
    expect(attempts).toEqual(['photos', 'scan', 'captures']); expect(result.status).toBe('error');
  });
  it('does not let a failed write poison later cleanup', async () => {
    const { manifest, photos } = await data(); let cleared = false;
    const store: CaptureStore = serializeCaptureStore({ read: async () => null, writeCapture: async () => { throw new Error('quota'); }, writeFlags: async () => {}, remove: async () => {}, clear: async () => { cleared = true; } });
    await expect(store.writeCapture(manifest, photos)).rejects.toThrow('quota'); await store.clear(); expect(cleared).toBe(true);
  });
});

/** Minimal transactional IDB harness: independent store clients share durable records. */
function databaseFactory(onRead?: (method: 'get' | 'getAllKeys' | 'getAll', key?: string) => void): IDBFactory {
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
          get: (key: string) => { onRead?.('get', key); return request(() => local.get(key)); },
          getAllKeys: () => { onRead?.('getAllKeys'); return request(() => [...local.keys()]); },
          getAll: () => { onRead?.('getAll'); return request(() => [...local.values()]); },
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
