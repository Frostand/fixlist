import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bundle from '../../scan/tests/capture-parity/valid-bundle.json';
import { captureAvailability, discardAllNativeCaptures, runNativeCapture } from './native-capture';
import { NATIVE_CAPTURE_STRING_KEYS } from './capture-types';
import { createMemoryCaptureStore } from './capture-storage';
import { resetFixListData } from './demo-storage';
import { demoScenario } from '../data/demo-scenario';
import { translate } from '../i18n';
const mock = vi.hoisted(() => ({ platform: 'web', native: false, availability: vi.fn(), start: vi.fn(), discard: vi.fn(), discardAll: vi.fn(), shareFile: vi.fn(), convert: vi.fn((url: string) => `converted:${url}`) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mock.native, getPlatform: () => mock.platform, convertFileSrc: mock.convert }, registerPlugin: () => mock }));
const options = { roomId: 'living-room', roomName: 'Living room', language: 'en' as const, prompts: [{ checklistItemId: null, text: 'Overview' }] };
beforeEach(() => { vi.clearAllMocks(); mock.native = true; mock.platform = 'ios'; mock.discard.mockResolvedValue(undefined); mock.discardAll.mockResolvedValue(undefined); });
afterEach(() => vi.unstubAllGlobals());
describe('native capture bridge boundaries (mocked plugin; no device claim)', () => {
  it.each(['en', 'es', 'zh', 'vi', 'ko', 'tl', 'ru', 'fr', 'ar'] as const)('bridges every native string in %s', async language => {
    mock.start.mockResolvedValue({ status: 'cancelled' });
    await runNativeCapture({ ...options, language, store: createMemoryCaptureStore() });
    const passed = mock.start.mock.calls[0]![0];
    expect(passed.language).toBe(language);
    for (const key of NATIVE_CAPTURE_STRING_KEYS) expect(passed.strings[key]).toBe(translate(language, `capture.native.${key}`));
  });
  it('retries cleanup in finally when the immediate abort discard fails', async () => {
    const abort = new AbortController();
    mock.start.mockImplementation(async () => { abort.abort(); return { status: 'cancelled' }; });
    mock.discard.mockRejectedValueOnce(new Error('first cleanup failed'));
    expect(await runNativeCapture({ ...options, signal: abort.signal, store: createMemoryCaptureStore() })).toMatchObject({ status: 'cancelled', cleanupFailed: true });
    expect(mock.discard).toHaveBeenCalledTimes(2);
  });
  it('aborts native file reads and prevents the durable write', async () => {
    const abort = new AbortController(), store = createMemoryCaptureStore();
    mock.start.mockImplementation(async (args) => ({ status: 'completed', capture: { ...bundle, captureId: args.captureId, photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => p), files: Object.fromEntries(bundle.photos.map(p => [p.photoId, `file:///var/app/Library/Caches/fixlist-captures/${args.captureId}/${p.photoId}.jpg`])) } }));
    let fetching!: () => void; const started = new Promise<void>(r => { fetching = r; });
    const fetchPhoto = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); fetching();
    }));
    vi.stubGlobal('fetch', fetchPhoto);
    const pending = runNativeCapture({ ...options, signal: abort.signal, store });
    await started; abort.abort();
    expect((await pending).status).toBe('cancelled');
    expect(fetchPhoto).toHaveBeenCalledOnce(); expect(mock.discard).toHaveBeenCalledTimes(2);
    expect(await store.read(options.roomId)).toBeNull();
  });
  it('discards the allocated ID immediately while start is pending, and ignores late completion', async () => {
    const abort = new AbortController(), store = createMemoryCaptureStore();
    let finish!: (value: { status: string }) => void;
    mock.start.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = runNativeCapture({ ...options, store, signal: abort.signal });
    const id = mock.start.mock.calls[0]![0].captureId;
    abort.abort();
    expect(mock.discard).toHaveBeenCalledWith({ captureId: id });
    finish({ status: 'completed' });
    expect((await pending).status).toBe('cancelled');
    expect(mock.discard.mock.calls).toEqual([[{ captureId: id }], [{ captureId: id }]]);
    expect(await store.read(options.roomId)).toBeNull();
  });
  it('registers abort before entering start and never starts an already aborted request', async () => {
    const abort = new AbortController();
    mock.start.mockImplementation(async () => { abort.abort(); return { status: 'cancelled' }; });
    expect((await runNativeCapture({ ...options, signal: abort.signal, store: createMemoryCaptureStore() })).status).toBe('cancelled');
    expect(mock.discard).toHaveBeenCalledTimes(2);
    mock.start.mockClear(); mock.discard.mockClear();
    await runNativeCapture({ ...options, signal: abort.signal, store: createMemoryCaptureStore() });
    expect(mock.start).not.toHaveBeenCalled();
  });
  it('removes the old abort handler so it cannot discard a newer capture', async () => {
    const first = new AbortController(), second = new AbortController();
    mock.start.mockResolvedValueOnce({ status: 'cancelled' });
    await runNativeCapture({ ...options, signal: first.signal, store: createMemoryCaptureStore() });
    let finish!: (value: { status: string }) => void;
    mock.start.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = runNativeCapture({ ...options, signal: second.signal, store: createMemoryCaptureStore() });
    const id = mock.start.mock.calls[1]![0].captureId;
    mock.discard.mockClear(); first.abort(); expect(mock.discard).not.toHaveBeenCalled();
    second.abort(); expect(mock.discard).toHaveBeenCalledWith({ captureId: id });
    finish({ status: 'cancelled' }); await pending;
  });
  it.each([[false, 'web'], [true, 'android']] as const)('never asks native for availability outside iOS', async (native, platform) => {
    mock.native = native; mock.platform = platform; expect((await captureAvailability()).arkit).toBe(false); expect(mock.availability).not.toHaveBeenCalled(); expect(await discardAllNativeCaptures()).toEqual({ ok: true }); expect(mock.discardAll).not.toHaveBeenCalled();
  });
  it.each(['cancelled', 'unavailable', 'denied', 'failed'])('discards temporary files on %s', async (status) => {
    mock.start.mockResolvedValue({ status }); expect((await runNativeCapture({ ...options, store: createMemoryCaptureStore() })).status).toBe(status); expect(mock.discard).toHaveBeenCalledOnce();
  });
  it('passes every translated native string, re-hashes converted file bytes, stores, then discards', async () => {
    const store = createMemoryCaptureStore();
    mock.start.mockImplementation(async (args) => ({ status: 'completed', capture: { ...bundle, captureId: args.captureId, roomId: args.roomId, photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => p), files: Object.fromEntries(bundle.photos.map((p) => [p.photoId, `file:///var/app/Library/Caches/fixlist-captures/${args.captureId}/${p.photoId}.jpg`])) } }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { const p = bundle.photos.find((p) => url.endsWith(`${p.photoId}.jpg`))!; return new Response(Uint8Array.from(atob(p.jpeg), (c) => c.charCodeAt(0))); }));
    expect((await runNativeCapture({ ...options, store })).status).toBe('completed');
    expect(mock.convert).toHaveBeenCalledTimes(2); expect(mock.discard).toHaveBeenCalledOnce();
    const args = mock.start.mock.calls[0]![0]; expect(Object.keys(args.strings)).toEqual([...NATIVE_CAPTURE_STRING_KEYS]); expect(args.strings.findFloor).toBe('Point the phone at the floor and move it slowly.'); expect(args.prompts[0].checklistItemId).toBe(null); expect(args.roomId).toBe(options.roomId);
    const record = await store.read('living-room'); expect(record?.manifest.roomId).toBe('living-room'); expect(record?.photos.size).toBe(2);
  });
  it('reports a saved capture even when native temporary-file cleanup fails', async () => {
    const store = createMemoryCaptureStore();
    mock.start.mockImplementation(async (args) => ({ status: 'completed', capture: { ...bundle, captureId: args.captureId, roomId: args.roomId, photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => p), files: Object.fromEntries(bundle.photos.map((p) => [p.photoId, `file:///var/app/Library/Caches/fixlist-captures/${args.captureId}/${p.photoId}.jpg`])) } }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { const p = bundle.photos.find((p) => url.endsWith(`${p.photoId}.jpg`))!; return new Response(Uint8Array.from(atob(p.jpeg), (c) => c.charCodeAt(0))); }));
    mock.discard.mockRejectedValue(new Error('cleanup failed'));
    expect(await runNativeCapture({ ...options, store })).toMatchObject({ status: 'completed', cleanupFailed: true });
    expect((await store.read(options.roomId))?.photos.size).toBe(2);
  });
  it('refuses a stale operation before asking native to start', async () => {
    expect((await runNativeCapture({ ...options, store: createMemoryCaptureStore(), isCurrent: () => false })).status).toBe('cancelled');
    expect(mock.start).not.toHaveBeenCalled();
  });
  it('cleans up a completed native callback without reading its photos after the view expires', async () => {
    let current = true;
    const store = createMemoryCaptureStore();
    mock.start.mockImplementation(async (args) => {
      current = false;
      return { status: 'completed', capture: { ...bundle, captureId: args.captureId, roomId: args.roomId, photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => p), files: Object.fromEntries(bundle.photos.map((p) => [p.photoId, `file:///var/app/Library/Caches/fixlist-captures/${args.captureId}/${p.photoId}.jpg`])) } };
    });
    const fetchPhoto = vi.fn(async () => new Response('expired view must not read photos'));
    vi.stubGlobal('fetch', fetchPhoto);
    expect((await runNativeCapture({ ...options, store, isCurrent: () => current })).status).toBe('cancelled');
    expect(fetchPhoto).not.toHaveBeenCalled(); expect(mock.discard).toHaveBeenCalledOnce(); expect(await store.read(options.roomId)).toBe(null);
  });
  it('stops reading later native photos if the view expires during the first read', async () => {
    let current = true;
    const store = createMemoryCaptureStore();
    mock.start.mockImplementation(async (args) => ({ status: 'completed', capture: { ...bundle, captureId: args.captureId, roomId: args.roomId, photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => p), files: Object.fromEntries(bundle.photos.map((p) => [p.photoId, `file:///var/app/Library/Caches/fixlist-captures/${args.captureId}/${p.photoId}.jpg`])) } }));
    const fetchPhoto = vi.fn(async (url: string) => {
      current = false;
      const photo = bundle.photos.find((p) => url.endsWith(`${p.photoId}.jpg`))!;
      return new Response(Uint8Array.from(atob(photo.jpeg), (c) => c.charCodeAt(0)));
    });
    vi.stubGlobal('fetch', fetchPhoto);
    expect((await runNativeCapture({ ...options, store, isCurrent: () => current })).status).toBe('cancelled');
    expect(fetchPhoto).toHaveBeenCalledOnce(); expect(mock.discard).toHaveBeenCalledOnce(); expect(await store.read(options.roomId)).toBe(null);
  });
  it('refuses mismatched JPEG bytes and still discards', async () => {
    const store = createMemoryCaptureStore();
    mock.start.mockImplementation(async (args) => ({ status: 'completed', capture: { ...bundle, captureId: args.captureId, photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => p), files: Object.fromEntries(bundle.photos.map((p) => [p.photoId, `file:///var/app/Library/Caches/fixlist-captures/${args.captureId}/${p.photoId}.jpg`])) } }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not the captured JPEG')));
    expect((await runNativeCapture({ ...options, store })).status).toBe('failed'); expect(await store.read('living-room')).toBe(null); expect(mock.discard).toHaveBeenCalledOnce();
  });
  it('discards even if start rejects and reports native discardAll failure during reset', async () => {
    mock.start.mockRejectedValue(new Error('plugin failed')); expect((await runNativeCapture({ ...options, store: createMemoryCaptureStore() })).status).toBe('failed'); expect(mock.discard).toHaveBeenCalledOnce();
    mock.discardAll.mockRejectedValue(new Error('cleanup failed'));
    const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    const result = await resetFixListData(storage, demoScenario, { photos: async () => ({ ok: true, message: '' }), scan: async () => ({ ok: true, message: '' }), captures: async () => ({ ok: true, message: '' }) });
    expect(mock.discardAll).toHaveBeenCalledOnce(); expect(result.status).toBe('error');
  });
});
