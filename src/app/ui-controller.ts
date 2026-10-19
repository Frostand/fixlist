import { applyCommand, type DemoCommand, type DemoState } from '../domain/workflow';
import type { DemoScenario } from '../domain/types';
import { OperationError, operationFailure, type FailureCode, type OperationFailure } from '../domain/failures';
import { DEMO_STORAGE_KEY, loadDemoState, saveDemoState, validateState, type DemoStorage, type LoadResult } from '../lib/demo-storage';
import { reencodePhoto, type PhotoStore } from '../lib/photo-storage';
import { withDemoStorageLock } from '../lib/storage-lock';
export type UiCommand = DemoCommand extends infer C ? C extends DemoCommand ? Omit<C, 'actorId' | 'at'> : never : never;
export type DispatchResult = { ok: true } | { ok: false; error: string; code: FailureCode };
export type Dispatch = ((command: UiCommand, requireSaved?: boolean) => Promise<DispatchResult>) & {
  invalidate?(reason?: FailureCode): void;
  refresh?(): Promise<LoadResult>;
  capture?(): () => boolean;
  photoRecovery?(id: string): () => boolean;
};
/** The snapshot is the optimistic revision token. Failed saves never publish a new state. */
export function createUiDispatch(options: { scenario: DemoScenario; getState(): DemoState; storage: DemoStorage | null; publish(state: DemoState, saved: boolean, announce?: boolean): void; clock(): string; onError(error: string): void; onFailure?(failure: OperationFailure): void }): Dispatch {
  let token: string | null = null, epoch = 0, resetEpoch = 0, blocked = false, pending = false;
  let blockedCode: FailureCode = 'recovery_required';
  function inspect(): LoadResult {
    try { token = options.storage?.getItem(DEMO_STORAGE_KEY) ?? null; }
    catch { blocked = true; blockedCode = 'storage_unavailable'; return loadDemoState(options.storage, options.scenario); }
    const loaded = loadDemoState(options.storage ? { ...options.storage, getItem: () => token, setItem: () => {}, removeItem: () => {} } : null, options.scenario);
    blocked = ['invalid', 'error', 'unavailable'].includes(loaded.status);
    blockedCode = loaded.status === 'invalid' ? 'recovery_required' : 'storage_unavailable';
    return loaded;
  }
  const loaded = inspect();
  const supplied = validateState(options.getState(), options.scenario), observed = validateState(loaded.state, options.scenario);
  if (!blocked && (!supplied.ok || !observed.ok || JSON.stringify(supplied.state) !== JSON.stringify(observed.state))) {
    blocked = true; blockedCode = 'stale_revision';
  }
  const fail = (failure: OperationFailure): DispatchResult => { options.onError(failure.message); options.onFailure?.(failure); return { ok: false, error: failure.message, code: failure.code }; };
  const dispatch: Dispatch = async (command) => {
    // Ignore repeated activation without clearing inputs, navigating or announcing success.
    if (pending) return { ok: false, code: 'cancelled', error: 'A change is already being saved.' };
    if (blocked) return fail({ code: blockedCode, message: blockedCode === 'stale_revision' ? 'Another view changed this data. Refresh saved data before trying again.' : blockedCode === 'cancelled' ? 'This operation was cancelled by reset.' : blockedCode === 'storage_unavailable' ? 'Storage is unavailable. No change was saved.' : 'Saved data needs recovery. Export it or deliberately reset before replacing it.' });
    const before = options.getState();
    const result = applyCommand(options.scenario, before, { ...command, actorId: before.activePersonId, at: options.clock() });
    if (!result.ok) return fail({ code: result.code, message: result.error });
    const operationEpoch = epoch; pending = true;
    try {
      const saved = await saveDemoState(options.storage, options.scenario, result.state, token, () => epoch === operationEpoch && !blocked);
      if (epoch !== operationEpoch) return fail({ code: blocked ? blockedCode : 'cancelled', message: 'This view changed while saving. Refresh saved data before trying again.' });
      if (saved.status !== 'saved') return fail({ code: saved.code, message: saved.message });
      token = saved.token;
      options.publish(result.state, true);
      return { ok: true };
    } finally { pending = false; }
  };
  dispatch.invalidate = (reason = 'cancelled') => { epoch++; if (reason === 'cancelled') resetEpoch++; blocked = true; blockedCode = reason; };
  dispatch.refresh = async () => {
    const operationEpoch = ++epoch; blocked = true; blockedCode = 'cancelled';
    try { return await withDemoStorageLock(() => { if (epoch !== operationEpoch) return loadDemoState(options.storage, options.scenario); const loaded = inspect(); if (!blocked) options.publish(loaded.state, true, false); return loaded; }); }
    catch { blocked = true; blockedCode = 'storage_unavailable'; fail({ code: blockedCode, message: 'Saved data could not be locked for refresh.' }); return { status: 'error', state: options.getState(), message: 'Saved data could not be refreshed.' }; }
  };
  dispatch.capture = () => {
    const operationEpoch = epoch, operationToken = token;
    return () => {
      try { return !blocked && epoch === operationEpoch && (options.storage?.getItem(DEMO_STORAGE_KEY) ?? null) === operationToken; } catch { return false; }
    };
  };
  dispatch.photoRecovery = (id) => {
    const operationReset = resetEpoch, original = options.getState().photos.find((p) => p.id === id);
    return () => {
      if (!original || resetEpoch !== operationReset) return false;
      const loaded = loadDemoState(options.storage, options.scenario);
      const photo = ['loaded', 'migrated'].includes(loaded.status) ? loaded.state.photos.find((p) => p.id === id) : null;
      return !!photo && photo.addedAt === original.addedAt && photo.addedBy === original.addedBy && photo.checklistItemId === original.checklistItemId && photo.width === original.width && photo.height === original.height;
    };
  };
  return dispatch;
}
function currentOperation(dispatch: Dispatch, isCurrent?: () => boolean): () => boolean {
  const current = dispatch.capture?.();
  return () => (current?.() ?? true) && (isCurrent?.() ?? true);
}
async function privateStore<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { const failure = operationFailure(error, 'storage_unavailable'); throw new OperationError(failure.code, failure.message); }
}
function assertCurrent(current: () => boolean): void { if (!current()) throw new OperationError('cancelled', 'photo-cancelled'); }
/** Blob first, durable metadata second; a failed command is compensated before returning. */
export async function addPhoto(options: { input: Blob; id: string; checklistItemId: string; store: PhotoStore; dispatch: Dispatch; encode?: typeof reencodePhoto; isCurrent?: () => boolean }): Promise<void> {
  const current = currentOperation(options.dispatch, options.isCurrent);
  const encoded = await (options.encode ?? reencodePhoto)(options.input);
  assertCurrent(current);
  await privateStore(() => options.store.write(options.id, encoded.blob));
  try {
    assertCurrent(current);
    const result = await options.dispatch({ type: 'add_photo', photoId: options.id, checklistItemId: options.checklistItemId, width: encoded.width, height: encoded.height }, true);
    if (!result.ok) throw new OperationError(result.code, result.error);
  } catch (error) { await privateStore(() => options.store.remove(options.id)); throw error; }
}
/** A cancelled removal must never compensate by restoring a reset blob or old metadata. */
export async function removePhoto(options: { id: string; store: PhotoStore; dispatch: Dispatch; metadataExists?: () => boolean; isCurrent?: () => boolean }): Promise<void> {
  const current = currentOperation(options.dispatch, options.isCurrent);
  const recover = options.dispatch.photoRecovery?.(options.id);
  const backup = await privateStore(() => options.store.read(options.id));
  assertCurrent(current);
  await privateStore(() => options.store.remove(options.id));
  try {
    assertCurrent(current);
    const result = await options.dispatch({ type: 'remove_photo', photoId: options.id }, true);
    if (!result.ok) throw new OperationError(result.code, result.error);
  } catch (error) { if (backup && (recover?.() ?? current()) && (options.metadataExists?.() ?? true)) await privateStore(() => options.store.write(options.id, backup)); throw error; }
}
export { operationFailure };
