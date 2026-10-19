import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { at, atStage } from '../domain/roles-test-helpers';
import type { DemoState } from '../domain/workflow';
import { DEMO_STORAGE_KEY, loadDemoState, resetDemoState, resetFixListData, saveDemoState, type DemoStorage } from '../lib/demo-storage';
import { createUiDispatch, type DispatchResult } from './ui-controller';
import { clearNavigationState, loadNavigationState, NAVIGATION_STORAGE_KEY, saveNavigationState, updateNavigationState } from './navigation-state';

/** Each callback holds its named lock until its returned promise settles. */
class ExclusiveLocks {
  private tails = new Map<string, Promise<unknown>>();
  requests: string[] = [];
  request<T>(name: string, options: { mode: string }, callback: () => T | Promise<T>): Promise<T> {
    expect(options.mode).toBe('exclusive'); this.requests.push(name);
    const result = (this.tails.get(name) ?? Promise.resolve()).then(callback);
    this.tails.set(name, result.catch(() => {})); return result;
  }
}
function sharedStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function client(storage: DemoStorage) {
  let state = loadDemoState(storage, scenario).state;
  const publish = vi.fn((next: DemoState) => { state = next; }), onFailure = vi.fn();
  const dispatch = createUiDispatch({ scenario, storage, getState: () => state, publish, clock: () => at, onError: () => {}, onFailure });
  return { dispatch, publish, onFailure, get state() { return state; } };
}
function hold(locks: ExclusiveLocks) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { release, pending: locks.request(`${DEMO_STORAGE_KEY}:write`, { mode: 'exclusive' }, () => gate) };
}
afterEach(() => vi.unstubAllGlobals());
describe('D02 deterministic cross-tab critical sections', () => {
  it.each([false, true])('documents the fallback race and queues the same interleaving with locks=%s', async (locked) => {
    const locks = new ExclusiveLocks(); vi.stubGlobal('navigator', locked ? { locks } : {});
    const storage = sharedStorage(), seed = atStage('invited'); seed.requests[0]!.sharing.photos = true;
    await saveDemoState(storage, scenario, seed);
    const a = client(storage), b = client(storage), request = b.state.requests[0]!;
    let revocation!: Promise<DispatchResult>, triggered = false;
    const write = storage.setItem;
    storage.setItem = (key, value) => {
      if (!triggered && key === DEMO_STORAGE_KEY) {
        triggered = true;
        revocation = b.dispatch({ type: 'revoke_shared_field', requestId: request.id, expectedRevision: request.revision, field: 'photos' });
        expect(a.publish).not.toHaveBeenCalled();
      }
      write(key, value);
    };
    expect(await a.dispatch({ type: 'set_language', language: 'es' })).toEqual({ ok: true });
    if (locked) {
      expect(await revocation).toMatchObject({ ok: false, code: 'stale_revision' });
      expect(b.publish).not.toHaveBeenCalled(); expect(b.onFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'stale_revision', message: expect.stringContaining('Refresh') }));
      expect(new Set(locks.requests)).toEqual(new Set([`${DEMO_STORAGE_KEY}:write`]));
    } else {
      // With no lock both clients report success, but A overwrites B's durable revocation.
      expect(await revocation).toEqual({ ok: true }); expect(b.state.requests[0]!.sharing.photos).toBe(false);
    }
    expect(loadDemoState(storage, scenario).state.requests[0]!.sharing.photos).toBe(true);
  });
  it('keeps the revocation durable when it owns the lock first and refuses the stale language edit', async () => {
    vi.stubGlobal('navigator', { locks: new ExclusiveLocks() });
    const storage = sharedStorage(), seed = atStage('invited'); seed.requests[0]!.sharing.photos = true;
    await saveDemoState(storage, scenario, seed);
    const a = client(storage), b = client(storage), request = a.state.requests[0]!;
    let stale!: Promise<DispatchResult>, triggered = false; const write = storage.setItem;
    storage.setItem = (key, value) => { if (!triggered) { triggered = true; stale = b.dispatch({ type: 'set_language', language: 'es' }); } write(key, value); };
    expect(await a.dispatch({ type: 'revoke_shared_field', requestId: request.id, expectedRevision: request.revision, field: 'photos' })).toEqual({ ok: true });
    expect(await stale).toMatchObject({ ok: false, code: 'stale_revision' }); expect(b.publish).not.toHaveBeenCalled();
    expect(loadDemoState(storage, scenario).state.requests[0]!.sharing.photos).toBe(false);
  });
  it('queues reset triggered immediately before a save writes, so reset removes the completed save', async () => {
    vi.stubGlobal('navigator', { locks: new ExclusiveLocks() });
    const storage = sharedStorage(); await saveDemoState(storage, scenario, atStage('invited'));
    const a = client(storage); let reset!: ReturnType<typeof resetDemoState>; const write = storage.setItem;
    storage.setItem = (key, value) => { reset = resetDemoState(storage, scenario); expect(storage.getItem(DEMO_STORAGE_KEY)).not.toBeNull(); write(key, value); };
    expect(await a.dispatch({ type: 'set_language', language: 'es' })).toEqual({ ok: true });
    expect((await reset).status).toBe('reset'); expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  });
  it('refuses an older save queued behind reset and removes navigation under that same lock', async () => {
    const locks = new ExclusiveLocks(); vi.stubGlobal('navigator', { locks });
    const storage = sharedStorage(); await saveDemoState(storage, scenario, atStage('invited'));
    storage.values.set(NAVIGATION_STORAGE_KEY, 'old draft'); storage.values.set('another-app', 'keep');
    const a = client(storage), gate = hold(locks), reset = resetDemoState(storage, scenario);
    const pending = a.dispatch({ type: 'set_language', language: 'es' });
    expect(a.publish).not.toHaveBeenCalled(); gate.release(); await gate.pending;
    expect((await reset).status).toBe('reset'); expect(await pending).toMatchObject({ ok: false, code: 'stale_revision' });
    expect(a.publish).not.toHaveBeenCalled(); expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull(); expect(storage.getItem(NAVIGATION_STORAGE_KEY)).toBeNull(); expect(storage.getItem('another-app')).toBe('keep');
  });
  it('holds the lock throughout private-store reset so an old save cannot run during cleanup', async () => {
    const locks = new ExclusiveLocks(); vi.stubGlobal('navigator', { locks });
    const storage = sharedStorage(); await saveDemoState(storage, scenario, atStage('invited'));
    const a = client(storage); let release!: () => void, started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const reset = resetFixListData(storage, scenario, { captures: async () => ({ ok: true, message: '' }), photos: () => { started(); return new Promise<{ ok: boolean; message: string }>((resolve) => { release = () => resolve({ ok: true, message: 'cleared' }); }); }, scan: async () => ({ ok: true, message: 'cleared' }) });
    await began; const pending = a.dispatch({ type: 'set_language', language: 'es' });
    await Promise.resolve(); expect(a.publish).not.toHaveBeenCalled(); expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
    release(); expect((await reset).status).toBe('reset'); expect(await pending).toMatchObject({ ok: false, code: 'stale_revision' });
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  });
  it('does not publish while waiting and ignores repeated activation without reporting success', async () => {
    const locks = new ExclusiveLocks(); vi.stubGlobal('navigator', { locks });
    const storage = sharedStorage(), a = client(storage), gate = hold(locks);
    const pending = a.dispatch({ type: 'set_language', language: 'es' });
    expect(await a.dispatch({ type: 'set_language', language: 'es' })).toMatchObject({ ok: false, code: 'cancelled' });
    expect(a.onFailure).not.toHaveBeenCalled(); expect(a.publish).not.toHaveBeenCalled(); expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
    gate.release(); await gate.pending; expect(await pending).toEqual({ ok: true }); expect(a.publish).toHaveBeenCalledOnce();
    expect(loadDemoState(storage, scenario).state).toEqual(a.state);
  });
  it('cancels a waiting save before even an empty reset and permits edits only after locked refresh', async () => {
    const locks = new ExclusiveLocks(); vi.stubGlobal('navigator', { locks });
    const storage = sharedStorage(), a = client(storage), gate = hold(locks);
    const pending = a.dispatch({ type: 'set_language', language: 'es' });
    a.dispatch.invalidate?.(); const reset = resetDemoState(storage, scenario);
    gate.release(); await gate.pending;
    expect(await pending).toMatchObject({ ok: false, code: 'cancelled' }); expect((await reset).status).toBe('reset');
    expect(a.publish).not.toHaveBeenCalled(); expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
    expect((await a.dispatch.refresh?.())?.status).toBe('empty');
    expect(await a.dispatch({ type: 'set_language', language: 'es' })).toEqual({ ok: true });
  });
  it('refresh waits behind another tab save and publishes its durable state without another write', async () => {
    const locks = new ExclusiveLocks(); vi.stubGlobal('navigator', { locks });
    const storage = sharedStorage(), a = client(storage), b = client(storage), gate = hold(locks);
    const write = vi.spyOn(storage, 'setItem'), pending = b.dispatch({ type: 'set_language', language: 'es' }), refreshed = a.dispatch.refresh?.();
    expect(a.publish).not.toHaveBeenCalled(); gate.release(); await gate.pending;
    expect(await pending).toEqual({ ok: true }); expect((await refreshed)?.state).toEqual(b.state);
    expect(a.publish).toHaveBeenCalledWith(b.state, true, false); expect(write).toHaveBeenCalledOnce();
  });
  it('failed writes release the lock, retain state and allow a later retry', async () => {
    vi.stubGlobal('navigator', { locks: new ExclusiveLocks() });
    const storage = sharedStorage(), a = client(storage), before = a.state, write = storage.setItem;
    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    expect(await a.dispatch({ type: 'set_language', language: 'es' })).toMatchObject({ ok: false, code: 'storage_capacity' });
    expect(a.state).toBe(before); expect(a.publish).not.toHaveBeenCalled(); expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
    storage.setItem = write; expect(await a.dispatch({ type: 'set_language', language: 'es' })).toEqual({ ok: true });
  });
  it('lock acquisition failure is a typed failure rather than an unlocked write', async () => {
    vi.stubGlobal('navigator', { locks: { request: async () => { throw Error('lock denied'); } } });
    const storage = sharedStorage(), a = client(storage), write = vi.spyOn(storage, 'setItem');
    expect(await a.dispatch({ type: 'set_language', language: 'es' })).toMatchObject({ ok: false, code: 'storage_unavailable' });
    expect(a.publish).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect((await resetDemoState(storage, scenario)).status).toBe('error'); expect((await a.dispatch.refresh?.())?.status).toBe('error');
  });
  it('reads navigation drafts inside the lock, preserving both independent updates and ordering clear', async () => {
    const locks = new ExclusiveLocks(); vi.stubGlobal('navigator', { locks });
    const storage = sharedStorage(), gate = hold(locks);
    const a = updateNavigationState(storage, (saved) => ({ ...saved, dismissedGuides: [...saved.dismissedGuides, 'sam'] }));
    const b = updateNavigationState(storage, (saved) => ({ ...saved, dismissedGuides: [...saved.dismissedGuides, 'alex'] }));
    expect(storage.getItem(NAVIGATION_STORAGE_KEY)).toBeNull(); gate.release(); await gate.pending; await a; await b;
    expect(loadNavigationState(storage).dismissedGuides).toEqual(['sam', 'alex']);
    const saved = saveNavigationState(storage, loadNavigationState(storage)), cleared = clearNavigationState(storage); await saved; expect(await cleared).toBe(true);
    expect(storage.getItem(NAVIGATION_STORAGE_KEY)).toBeNull(); expect(new Set(locks.requests)).toEqual(new Set([`${DEMO_STORAGE_KEY}:write`]));
  });
});
