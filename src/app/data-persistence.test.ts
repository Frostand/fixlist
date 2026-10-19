import { describe, expect, it, vi } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { createInitialState, type DemoState } from '../domain/workflow';
import { atStage, at } from '../domain/roles-test-helpers';
import { DEMO_STORAGE_KEY, loadDemoState, resetDemoState, saveDemoState } from '../lib/demo-storage';
import { createUiDispatch, removePhoto } from './ui-controller';
import type { PhotoStore } from '../lib/photo-storage';
function storage() { const items = new Map<string, string>(); return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v); }, removeItem: (k: string) => { items.delete(k); } }; }
function client(s: ReturnType<typeof storage>, initial?: DemoState) { let state = initial ?? loadDemoState(s, scenario).state; const errors: string[] = []; const dispatch = createUiDispatch({ scenario, storage: s, getState: () => state, clock: () => at, onError: (e) => errors.push(e), publish: (next) => { state = next; } }); return { dispatch, errors, get state() { return state; } }; }
describe('durable UI transitions', () => {
  it('D02 a stale independent client cannot restore revoked sharing on a language edit', async () => {
    const s = storage(); const seeded = atStage('invited'); seeded.requests[0]!.sharing.photos = true;
    expect((await saveDemoState(s, scenario, seeded)).status).toBe('saved');
    const a = client(s), b = client(s); const r = a.state.requests[0]!;
    expect((await a.dispatch({ type: 'revoke_shared_field', requestId: r.id, expectedRevision: r.revision, field: 'photos' })).ok).toBe(true);
    expect((await b.dispatch({ type: 'set_language', language: 'es' })).ok).toBe(false);
    expect(loadDemoState(s, scenario).state.requests[0]!.sharing.photos).toBe(false);
  });
  it('D05 person selection cannot replace rejected recoverable bytes', async () => {
    const s = storage(); s.items.set(DEMO_STORAGE_KEY, '{recoverable old bytes'); const c = client(s);
    expect((await c.dispatch({ type: 'select_person', personId: 'sam' })).ok).toBe(false);
    expect(s.items.get(DEMO_STORAGE_KEY)).toBe('{recoverable old bytes');
  });
  it('D15 storage failure preserves the last durable state and rejects success', async () => {
    const s = storage(), c = client(s); s.setItem = () => { throw new Error('QuotaExceededError'); };
    const before = c.state;
    expect((await c.dispatch({ type: 'set_language', language: 'es' })).ok).toBe(false);
    expect(c.state).toBe(before);
  });
  it('D01 delayed photo removal cannot dispatch old state after metadata reset', async () => {
    const s = storage(); const initial = { ...atStage('draft'), photos: [{ id: 'photo-one', checklistItemId: 'rug-check', addedBy: 'margaret', addedAt: at, width: 1, height: 1 }] };
    await saveDemoState(s, scenario, initial); const c = client(s); let release!: () => void;
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    const store: PhotoStore = { read: async () => blob, write: vi.fn(async () => {}), clear: async () => {}, remove: async () => { await new Promise<void>((r) => { release = r; }); } };
    const pending = removePhoto({ id: 'photo-one', store, dispatch: c.dispatch });
    await vi.waitFor(() => expect(release).toBeDefined());
    await resetDemoState(s, scenario); release();
    await pending.catch(() => {});
    expect(loadDemoState(s, scenario).state).toEqual(createInitialState(scenario));
    expect(store.write).not.toHaveBeenCalled();
  });
});

describe('capacity and coherent saves', () => {
  it('D04 oversized multibyte updates are rejected before publication, keeping durable capacity for exits', async () => {
    const s = storage(); let seed = atStage('in_progress');
    const r = seed.requests[0]!;
    seed = { ...seed, requests: [{ ...r, sharing: { roomName: true, photos: true, scanLocation: true, visitTimes: true, areaLabel: true } }], activePersonId: 'alex' };
    await saveDemoState(s, scenario, seed);
    const c = client(s); let rejected = false;
    for (let i = 0; i < 40; i++) {
      const before = c.state, token = s.items.get(DEMO_STORAGE_KEY);
      const result = await c.dispatch({ type: 'post_update', requestId: before.requests[0]!.id, expectedRevision: before.requests[0]!.revision, text: '界'.repeat(278) + String(i).padStart(2, '0') });
      if (!result.ok) {
        expect(result.code).toBe('storage_capacity'); expect(c.state).toBe(before); expect(s.items.get(DEMO_STORAGE_KEY)).toBe(token);
        expect(loadDemoState(s, scenario).state).toEqual(before); rejected = true; break;
      }
    }
    expect(rejected).toBe(true);
    expect(new TextEncoder().encode(s.items.get(DEMO_STORAGE_KEY)!).byteLength).toBeLessThanOrEqual(65536);
    let request = c.state.requests[0]!;
    const report = await c.dispatch({ type: 'report_done', requestId: request.id, expectedRevision: request.revision }); expect(report.ok, JSON.stringify(report)).toBe(true);
    expect((await c.dispatch({ type: 'select_person', personId: 'margaret' })).ok).toBe(true);
    const reported = c.state;
    for (const decision of ['confirm_done', 'not_done_yet'] as const) {
      const local = storage(); await saveDemoState(local, scenario, reported); const d = client(local); request = d.state.requests[0]!;
      expect((await d.dispatch({ type: decision, requestId: request.id, expectedRevision: request.revision })).ok).toBe(true);
      for (const field of ['roomName', 'photos', 'scanLocation', 'visitTimes', 'areaLabel'] as const) {
        request = d.state.requests[0]!;
        expect((await d.dispatch({ type: 'revoke_shared_field', requestId: request.id, expectedRevision: request.revision, field })).ok).toBe(true);
        expect(loadDemoState(local, scenario).state).toEqual(d.state);
      }
      if (decision === 'not_done_yet') {
        for (const type of ['cancel_invitation', 'cancel_request'] as const) { request = d.state.requests[0]!; expect((await d.dispatch({ type, requestId: request.id, expectedRevision: request.revision })).ok).toBe(true); }
        expect(loadDemoState(local, scenario).state.requests[0]!.status).toBe('cancelled');
      }
    }
  });
  it('N10 an answer and its resume position save in one transition with no partial-success masking', async () => {
    const s = storage(), c = client(s); const write = vi.spyOn(s, 'setItem');
    expect((await c.dispatch({ type: 'answer_checklist', checklistItemId: 'cord-check', answer: 'yes', position: 1 })).ok).toBe(true);
    expect(write).toHaveBeenCalledOnce();
    expect(loadDemoState(s, scenario).state.checklistAnswers['cord-check']).toBe('yes');
    expect(c.state.people[0]!.checklistPosition).toBe(1);
    write.mockImplementation(() => { throw new Error('unavailable'); });
    expect((await c.dispatch({ type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes', position: 0 })).ok).toBe(false);
    expect(c.state.checklistAnswers['rug-check']).toBe('unknown'); expect(c.state.people[0]!.checklistPosition).toBe(1);
  });
});

describe('reset and failure outcomes', () => {
  it('D01 a photo encoded after reset cannot restore either metadata or bytes', async () => {
    const { addPhoto } = await import('./ui-controller');
    const s = storage(); await saveDemoState(s, scenario, atStage('draft')); const c = client(s);
    const blobs = new Map<string, Blob>(); const blob = new Blob(['jpeg'], { type: 'image/jpeg' }); let finish!: (v: { blob: Blob; width: number; height: number }) => void;
    const store: PhotoStore = { read: async (id) => blobs.get(id) ?? null, write: async (id, b) => { blobs.set(id, b); }, remove: async (id) => { blobs.delete(id); }, clear: async () => { blobs.clear(); } };
    const pending = addPhoto({ input: blob, id: 'late-photo', checklistItemId: 'rug-check', store, dispatch: c.dispatch, encode: () => new Promise((r) => { finish = r; }) });
    c.dispatch.invalidate?.(); await resetDemoState(s, scenario); await store.clear();
    finish({ blob, width: 800, height: 600 });
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(blobs.size).toBe(0); expect(loadDemoState(s, scenario).state).toEqual(createInitialState(scenario));
  });
  it('D15 permission, unavailable storage and stale revisions have distinct typed outcomes', async () => {
    const s = storage(), c = client(s);
    expect((await c.dispatch({ type: 'select_person', personId: 'alex' })).ok).toBe(true);
    expect(await c.dispatch({ type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' })).toMatchObject({ ok: false, code: 'permission_denied' });
    c.dispatch.invalidate?.('stale_revision');
    expect(await c.dispatch({ type: 'set_language', language: 'es' })).toMatchObject({ ok: false, code: 'stale_revision' });
    const unavailable = createUiDispatch({ scenario, getState: () => createInitialState(scenario), storage: null, publish: () => { throw new Error('must not publish'); }, clock: () => at, onError: () => {} });
    expect(await unavailable({ type: 'set_language', language: 'es' })).toMatchObject({ ok: false, code: 'storage_unavailable' });
  });
  it('D15 private-media storage failure remains distinct from processing failure', async () => {
    const { addPhoto } = await import('./ui-controller');
    const { reencodePhoto } = await import('../lib/photo-storage');
    const { OperationError } = await import('../domain/failures');
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    const store: PhotoStore = { read: async () => null, write: async () => { throw new Error('write unavailable'); }, remove: async () => {}, clear: async () => {} };
    await expect(reencodePhoto(new Blob(['text'], { type: 'text/plain' }))).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(addPhoto({ input: blob, id: 'photo', checklistItemId: 'rug-check', store, dispatch: async () => ({ ok: true }), encode: async () => ({ blob, width: 1, height: 1 }) })).rejects.toMatchObject({ code: 'storage_unavailable' });
    await expect(addPhoto({ input: blob, id: 'photo', checklistItemId: 'rug-check', store, dispatch: async () => ({ ok: true }), encode: async () => { throw new OperationError('processing_failure', 'encode failed'); } })).rejects.toMatchObject({ code: 'processing_failure' });
  });
});

it('D01 a concurrent non-reset edit cancels removal without losing a still-durable photo', async () => {
  const s = storage(), seed = { ...atStage('draft'), photos: [{ id: 'photo-one', checklistItemId: 'rug-check', addedBy: 'margaret', addedAt: at, width: 800, height: 600 }] };
  await saveDemoState(s, scenario, seed); const a = client(s), b = client(s);
  const blob = new Blob(['jpeg'], { type: 'image/jpeg' }), blobs = new Map([['photo-one', blob]]); let release!: () => void;
  const store: PhotoStore = { read: async (id) => blobs.get(id) ?? null, write: async (id, value) => { blobs.set(id, value); }, clear: async () => { blobs.clear(); }, remove: async (id) => { blobs.delete(id); await new Promise<void>((r) => { release = r; }); } };
  const pending = removePhoto({ id: 'photo-one', store, dispatch: a.dispatch });
  await vi.waitFor(() => expect(release).toBeDefined());
  expect((await b.dispatch({ type: 'set_language', language: 'es' })).ok).toBe(true); release();
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  expect(loadDemoState(s, scenario).state.photos).toHaveLength(1); expect(blobs.get('photo-one')).toBe(blob);
});

it('D02 a write between initial load and client construction cannot bind stale state to a fresh revision', async () => {
  const s = storage(), seeded = atStage('invited'); seeded.requests[0]!.sharing.photos = true;
  await saveDemoState(s, scenario, seeded); const previouslyLoaded = loadDemoState(s, scenario).state;
  const fresh = client(s), r = fresh.state.requests[0]!;
  await fresh.dispatch({ type: 'revoke_shared_field', requestId: r.id, expectedRevision: r.revision, field: 'photos' });
  const stale = client(s, previouslyLoaded);
  expect(await stale.dispatch({ type: 'set_language', language: 'es' })).toMatchObject({ ok: false, code: 'stale_revision' });
  expect(loadDemoState(s, scenario).state.requests[0]!.sharing.photos).toBe(false);
});
