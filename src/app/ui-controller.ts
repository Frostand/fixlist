import { applyCommand, type DemoCommand, type DemoState } from '../domain/workflow';
import type { DemoScenario } from '../domain/types';
import { saveDemoState, type DemoStorage } from '../lib/demo-storage';
import { reencodePhoto, type PhotoStore } from '../lib/photo-storage';
export type UiCommand = DemoCommand extends infer C ? C extends DemoCommand ? Omit<C, 'actorId' | 'at'> : never : never;
export type DispatchResult = { ok: true } | { ok: false; error: string };
export type Dispatch = (command: UiCommand, requireSaved?: boolean) => DispatchResult;
/** Shared by every UI handler and the journey test. Actor comes from the active demo person, never a resident fallback. */
export function createUiDispatch(options: { scenario: DemoScenario; getState(): DemoState; storage: DemoStorage | null; publish(state: DemoState, saved: boolean): void; clock(): string; onError(error: string): void }): Dispatch {
  return (command, requireSaved = false) => {
    const before = options.getState();
    const result = applyCommand(options.scenario, before, { ...command, actorId: before.activePersonId, at: options.clock() });
    if (!result.ok) { options.onError(result.error); return result; }
    const saved = saveDemoState(options.storage, options.scenario, result.state).status === 'saved';
    if (requireSaved && !saved) { options.onError('photo-persistence'); return { ok: false, error: 'photo-persistence' }; }
    options.publish(result.state, saved);
    return { ok: true };
  };
}
/** Blob first, durable metadata second; a failed command is compensated before returning. */
export async function addPhoto(options: { input: Blob; id: string; checklistItemId: string; store: PhotoStore; dispatch: Dispatch; encode?: typeof reencodePhoto; isCurrent?: () => boolean }): Promise<void> {
  const encoded = await (options.encode ?? reencodePhoto)(options.input);
  if (options.isCurrent && !options.isCurrent()) return;
  await options.store.write(options.id, encoded.blob);
  try {
    if (options.isCurrent && !options.isCurrent()) throw new Error('photo-cancelled');
    const result = options.dispatch({ type: 'add_photo', photoId: options.id, checklistItemId: options.checklistItemId, width: encoded.width, height: encoded.height }, true);
    if (!result.ok) throw new Error(result.error);
  } catch (error) { await options.store.remove(options.id); throw error; }
}
/** Keep a backup until removal of the metadata succeeds durably. */
export async function removePhoto(options: { id: string; store: PhotoStore; dispatch: Dispatch; metadataExists?: () => boolean }): Promise<void> {
  const backup = await options.store.read(options.id);
  await options.store.remove(options.id);
  try {
    const result = options.dispatch({ type: 'remove_photo', photoId: options.id }, true);
    if (!result.ok) throw new Error(result.error);
  } catch (error) { if (backup && (options.metadataExists?.() ?? true)) await options.store.write(options.id, backup); throw error; }
}
