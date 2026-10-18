import type { DemoScenario } from '../domain/types';
import { createInitialState, noSharing, requestIdForAction, type DemoState } from '../domain/workflow';
import { LEGACY_ACTOR_ID, LEGACY_LABEL } from '../data/demo-people';
import { validateLegacyState } from './legacy-demo-state';
import { reconstructState } from './state-validation';
import { resetPhotoStorage } from './photo-storage';
import { resetScanStorage } from './scan-storage';
export const DEMO_STORAGE_KEY = 'fixlist:demo:v1';
export const MAX_SERIALIZED_BYTES = 64 * 1024;
export interface DemoStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export type ValidationResult = { ok: true; state: DemoState } | { ok: false; error: string };
export interface LoadResult { status: 'loaded' | 'migrated' | 'empty' | 'invalid' | 'unavailable' | 'error'; state: DemoState; message: string }
export interface SaveResult { status: 'saved' | 'invalid' | 'unavailable' | 'error'; message: string }
export interface ResetResult { status: 'reset' | 'unavailable' | 'error'; state: DemoState; message: string }
type StorageInput = DemoStorage | null | undefined;
function withinSizeLimit(s: string): boolean { return s.length <= MAX_SERIALIZED_BYTES && new TextEncoder().encode(s).byteLength <= MAX_SERIALIZED_BYTES; }
export function validateState(value: unknown, scenario: DemoScenario): ValidationResult {
  try {
    const state = reconstructState(value, scenario);
    if (!withinSizeLimit(JSON.stringify(state))) return { ok: false, error: 'Demo state exceeds the 64 KiB storage limit.' };
    return { ok: true, state };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Invalid saved demo state.' }; }
}
export function migrateOldState(value: unknown, scenario: DemoScenario): ValidationResult {
  const parsed = validateLegacyState(value, scenario);
  if (!parsed.ok) return parsed;
  const old = parsed.value;
  const initial = createInitialState(scenario);
  const attribution = { actorId: LEGACY_ACTOR_ID, at: null };
  return validateState({ ...initial, checklistAnswers: { ...initial.checklistAnswers, ...old.checklistAnswers },
    confirmations: { ...initial.confirmations, ...Object.fromEntries(Object.entries(old.confirmations).map(([id, c]) => [id, c.humanConfirmed ? { ...c, actorId: LEGACY_ACTOR_ID, confirmedBy: LEGACY_LABEL } : c])) },
    profileId: old.profileId,
    requests: old.requests.map((r) => ({ id: requestIdForAction(r.referenceActionId), referenceActionId: r.referenceActionId,
      status: 'draft', revision: 1, volunteerId: null, sharing: noSharing(), visitTimes: '', areaLabel: '', scanLocation: null, proposedTime: null, agreedTime: null, updates: [], reportedDone: null, confirmedDone: null,
      createdBy: attribution, updatedBy: attribution, history: [], independentVerification: 'not available in this demo',
      legacyHistory: { label: LEGACY_LABEL, status: r.status, completion: r.completion.status === 'family_reported_complete' ? { ...r.completion, reportedBy: LEGACY_LABEL } : { ...r.completion }, note: 'Inactive history only; no volunteer invitation, acceptance or repair verification was inferred.' },
    })),
  }, scenario);
}
export function getBrowserStorage(browser: { readonly localStorage: DemoStorage } | null = typeof window === 'undefined' ? null : window): DemoStorage | null {
  try { return browser?.localStorage ?? null; } catch { return null; }
}
/** Loading, migration and recovery never write or remove saved bytes. */
export function loadDemoState(storage: StorageInput, scenario: DemoScenario): LoadResult {
  const state = createInitialState(scenario);
  if (!storage) return { status: 'unavailable', state, message: 'Browser storage is unavailable. Changes are kept in memory only.' };
  let bytes: string | null;
  try { bytes = storage.getItem(DEMO_STORAGE_KEY); } catch { return { status: 'error', state, message: 'Saved demo data could not be read. A fresh demo is running in memory; saved data was not changed.' }; }
  if (bytes === null) return { status: 'empty', state, message: 'Fresh fictional demo. No saved demo data was found.' };
  if (!withinSizeLimit(bytes)) return { status: 'invalid', state, message: 'Saved demo data exceeds the 64 KiB limit. Saved data was not changed.' };
  let parsed: unknown;
  try { parsed = JSON.parse(bytes); } catch { return { status: 'invalid', state, message: 'Saved demo data is not valid JSON. Saved data was not changed.' }; }
  const version = parsed && typeof parsed === 'object' ? Object.getOwnPropertyDescriptor(parsed, 'schemaVersion')?.value : null;
  const migrate = version === 1 || version === 2;
  const result = migrate ? migrateOldState(parsed, scenario) : validateState(parsed, scenario);
  return result.ok ? { status: migrate ? 'migrated' : 'loaded', state: result.state, message: migrate
    ? 'Legacy demo data migrated in memory. Family records are unassigned drafts with inactive history; no volunteer invitation or acceptance was inferred. Legacy screening statuses were not converted to facts. Saved data is unchanged until an explicit edit is saved.'
    : 'Saved fictional demo data loaded from this browser.' }
    : { status: 'invalid', state, message: `Saved demo data was rejected: ${result.error} A fresh demo is running; saved data was not changed.` };
}
export function saveDemoState(storage: StorageInput, scenario: DemoScenario, state: DemoState): SaveResult {
  const result = validateState(state, scenario);
  if (!result.ok) return { status: 'invalid', message: `Demo data was not saved: ${result.error} Changes remain in memory only.` };
  if (!storage) return { status: 'unavailable', message: 'Browser storage is unavailable. Changes are kept in memory only.' };
  try { storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(result.state)); return { status: 'saved', message: 'Fictional demo changes saved in this browser only.' }; }
  catch { return { status: 'error', message: 'Changes could not be saved. Changes remain in memory only; reloading may restore older saved data.' }; }
}
/** Synchronous metadata reset; the app uses resetFixListData to also await the private stores. */
export function resetDemoState(storage: StorageInput, scenario: DemoScenario): ResetResult {
  const state = createInitialState(scenario);
  if (!storage) return { status: 'unavailable', state, message: 'Demo reset in memory. Browser storage is unavailable, so reloading may restore older saved data.' };
  try { storage.removeItem(DEMO_STORAGE_KEY); return { status: 'reset', state, message: 'Demo metadata reset. Only FixList demo data was removed.' }; }
  catch { return { status: 'error', state, message: 'Demo reset in memory, but saved data could not be removed. Reloading may restore older saved data.' }; }
}
/** Each owned store is attempted even if another fails; unrelated keys/databases are untouched. */
export async function resetFixListData(storage: StorageInput, scenario: DemoScenario, stores = { photos: resetPhotoStorage, scan: resetScanStorage }): Promise<ResetResult> {
  const result = resetDemoState(storage, scenario);
  const outcomes = await Promise.allSettled([stores.photos(), stores.scan()]);
  const failed = outcomes.some((o) => o.status === 'rejected' || !o.value.ok);
  return failed ? { ...result, status: 'error', message: `${result.message} Some saved photos or scans could not be cleared. Reloading may restore older data.` } : result;
}
