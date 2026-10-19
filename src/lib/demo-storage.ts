import type { FailureCode } from '../domain/failures';
import { remainingPrivacyEvents } from '../domain/roles';
import type { DemoScenario } from '../domain/types';
import { createInitialState, noSharing, requestIdForAction, type DemoState } from '../domain/workflow';
import { LEGACY_ACTOR_ID, LEGACY_LABEL } from '../data/demo-people';
import { validateLegacyState } from './legacy-demo-state';
import { reconstructState } from './state-validation';
import { resetPhotoStorage } from './photo-storage';
import { resetScanStorage } from './scan-storage';
import { resetCaptureStorage } from './capture-storage';
import { discardAllNativeCaptures } from './native-capture';
import { DEMO_STORAGE_KEY, NAVIGATION_STORAGE_KEY, withDemoStorageLock } from './storage-lock';
export { DEMO_STORAGE_KEY } from './storage-lock';
export const MAX_SERIALIZED_BYTES = 64 * 1024;
export interface DemoStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export type ValidationResult = { ok: true; state: DemoState } | { ok: false; error: string; code: 'invalid_state' | 'storage_capacity' };
export interface LoadResult { status: 'loaded' | 'migrated' | 'empty' | 'invalid' | 'unavailable' | 'error'; state: DemoState; message: string }
export type SaveResult = { status: 'saved'; message: string; token: string } | { status: 'invalid' | 'unavailable' | 'error' | 'conflict' | 'capacity'; message: string; code: FailureCode };
export interface ResetResult { status: 'reset' | 'unavailable' | 'error'; state: DemoState; message: string }
type StorageInput = DemoStorage | null | undefined;
function withinSizeLimit(s: string): boolean { return s.length <= MAX_SERIALIZED_BYTES && new TextEncoder().encode(s).byteLength <= MAX_SERIALIZED_BYTES; }
export function validateState(value: unknown, scenario: DemoScenario): ValidationResult {
  try {
    const state = reconstructState(value, scenario);
    if (!withinSizeLimit(JSON.stringify(state))) return { ok: false, code: 'storage_capacity', error: 'Demo state exceeds the 64 KiB storage limit.' };
    return { ok: true, state };
  } catch (error) { return { ok: false, code: 'invalid_state', error: error instanceof Error ? error.message : 'Invalid saved demo state.' }; }
}
export function migrateOldState(value: unknown, scenario: DemoScenario): ValidationResult {
  const parsed = validateLegacyState(value, scenario);
  if (!parsed.ok) return { ...parsed, code: 'invalid_state' };
  const old = parsed.value;
  const initial = createInitialState(scenario);
  const attribution = { actorId: LEGACY_ACTOR_ID, at: null };
  return validateState({ ...initial, checklistAnswers: { ...initial.checklistAnswers, ...old.checklistAnswers },
    confirmations: { ...initial.confirmations, ...Object.fromEntries(Object.entries(old.confirmations).map(([id, c]) => [id, c.humanConfirmed ? { ...c, actorId: LEGACY_ACTOR_ID, confirmedBy: LEGACY_LABEL } : c])) },
    profileId: old.profileId,
    actionEpisodes: Object.fromEntries(scenario.referenceActions.map((a) => [a.id, old.requests.some((r) => r.referenceActionId === a.id) || scenario.concerns.some((c) => c.referenceActionId === a.id && old.confirmations[c.id]?.humanConfirmed) ? 1 : 0])),
    requests: old.requests.map((r) => ({ id: requestIdForAction(r.referenceActionId), referenceActionId: r.referenceActionId,
      episode: 1, professionalReferral: null, status: 'draft', revision: 1, volunteerId: null, sharing: noSharing(), visitTimes: '', areaLabel: '', scanLocation: null, proposedTime: null, agreedTime: null, updates: [], reportedDone: null, confirmedDone: null,
      createdBy: attribution, updatedBy: attribution, history: [], independentVerification: 'not available in this demo',
      legacyHistory: { label: LEGACY_LABEL, status: r.status, completion: r.completion.status === 'family_reported_complete' ? { ...r.completion, reportedBy: LEGACY_LABEL } : { ...r.completion }, note: 'Inactive history only; no volunteer invitation, acceptance or repair verification was inferred.' },
    })),
  }, scenario);
}
/** Frozen v3 gains episodes and photo-deletion attribution; historical requests remain intact. */
export function migrateRolesState(value: unknown, scenario: DemoScenario): ValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, code: 'invalid_state', error: 'Invalid v3 record.' };
  const old = value as Record<string, unknown>;
  const keys = Object.keys(createInitialState(scenario)).filter((k) => !['actionEpisodes', 'removedPhotos', 'removedPhotoHistoryTruncated'].includes(k));
  if (Reflect.ownKeys(old).length !== keys.length || keys.some((k) => !Object.hasOwn(old, k)) || old.schemaVersion !== 3 || !Array.isArray(old.requests)) return { ok: false, code: 'invalid_state', error: 'Invalid v3 fields.' };
  const confirmations = old.confirmations as DemoState['confirmations'];
  const requests = old.requests as Array<Record<string, unknown>>;
  if (requests.some((r) => !r || typeof r !== 'object' || Object.hasOwn(r, 'episode') || Object.hasOwn(r, 'professionalReferral'))) return { ok: false, code: 'invalid_state', error: 'Invalid v3 request.' };
  return validateState({ ...old, schemaVersion: 5, removedPhotos: [], removedPhotoHistoryTruncated: false, actionEpisodes: Object.fromEntries(scenario.referenceActions.map((a) => [a.id,
    requests.some((r) => r.referenceActionId === a.id) || scenario.concerns.some((c) => c.referenceActionId === a.id && confirmations?.[c.id]?.humanConfirmed) ? 1 : 0])),
    requests: requests.map((r) => ({ ...r, episode: 1, professionalReferral: null })),
  }, scenario);
}
/** Frozen v4 keeps live photos and validates its complete deletion log before bounding it. */
export function migratePhotoHistoryState(value: unknown, scenario: DemoScenario): ValidationResult {
  try { return validateState(reconstructState(value, scenario, 4), scenario); }
  catch (error) { return { ok: false, code: 'invalid_state', error: error instanceof Error ? error.message : 'Invalid v4 record.' }; }
}
export function getBrowserStorage(browser: { readonly localStorage: DemoStorage } | null = typeof window === 'undefined' ? null : window): DemoStorage | null {
  try { return browser?.localStorage ?? null; } catch { return null; }
}
/** Loading, migration and recovery never write or remove saved bytes. */
export function loadDemoState(storage: StorageInput, scenario: DemoScenario): LoadResult {
  const state = createInitialState(scenario);
  if (!storage) return { status: 'unavailable', state, message: 'Browser storage is unavailable. This view is in memory only; changes cannot be saved.' };
  let bytes: string | null;
  try { bytes = storage.getItem(DEMO_STORAGE_KEY); } catch { return { status: 'error', state, message: 'Saved demo data could not be read. A fresh demo is running in memory; saved data was not changed.' }; }
  if (bytes === null) return { status: 'empty', state, message: 'Fresh fictional demo. No saved demo data was found.' };
  if (!withinSizeLimit(bytes)) return { status: 'invalid', state, message: 'Saved demo data exceeds the 64 KiB limit. Saved data was not changed.' };
  let parsed: unknown;
  try { parsed = JSON.parse(bytes); } catch { return { status: 'invalid', state, message: 'Saved demo data is not valid JSON. Saved data was not changed.' }; }
  if (parsed && typeof parsed === 'object' && 'format' in parsed) {
    const envelope = parsed as Record<string, unknown>;
    if (envelope.format !== 'fixlist-saved-v1' || Object.keys(envelope).length !== 3 || !Number.isSafeInteger(envelope.revision) || (envelope.revision as number) < 1 || !Object.hasOwn(envelope, 'state')) return { status: 'invalid', state, message: 'Saved demo envelope is invalid. Saved bytes were not changed.' };
    parsed = envelope.state;
  }
  const version = parsed && typeof parsed === 'object' ? Object.getOwnPropertyDescriptor(parsed, 'schemaVersion')?.value : null;
  const migrate = version === 1 || version === 2 || version === 3 || version === 4;
  const result = version === 4 ? migratePhotoHistoryState(parsed, scenario) : version === 3 ? migrateRolesState(parsed, scenario) : migrate ? migrateOldState(parsed, scenario) : validateState(parsed, scenario);
  return result.ok ? { status: migrate ? 'migrated' : 'loaded', state: result.state, message: version === 4 ? 'Saved version 4 data migrated in memory to separate live-photo capacity from bounded deletion attribution. Only the newest 32 deletion records are retained; a truncation marker records any older history dropped. Saved bytes remain unchanged until an explicit edit.' : version === 3 ? 'Saved version 3 data migrated in memory to request episodes and photo attribution history. Saved bytes remain unchanged until an explicit edit.' : migrate
    ? 'Legacy demo data migrated in memory. Family records are unassigned drafts with inactive history; no volunteer invitation or acceptance was inferred. Legacy screening statuses were not converted to facts. Saved data is unchanged until an explicit edit is saved.'
    : 'Saved fictional demo data loaded from this browser.' }
    : { status: 'invalid', state, message: `Saved demo data was rejected: ${result.error} A fresh demo is running; saved data was not changed.` };
}
/** Reserve UTF-8 bytes for all remaining privacy exits and both completion choices. */
export function privacyReserveBytes(state: DemoState): number {
  return state.requests.reduce((n, r) => n + remainingPrivacyEvents(r) * 384 + (r.status === 'in_progress' && r.history.findLast((e) => ['post_update', 'not_done_yet'].includes(e.type))?.type === 'post_update' ? 768 : 0) + ((['cancelled', 'resident_confirmed_done'].includes(r.status) || r.professionalReferral === 'closed') ? 0 : 1024), 0)
    + state.photos.length * 192 + state.delegations.filter((d) => d.scopes.length).length * 128;
}
export async function saveDemoState(storage: StorageInput, scenario: DemoScenario, state: DemoState, expectedToken?: string | null, isCurrent: () => boolean = () => true): Promise<SaveResult> {
  const result = validateState(state, scenario);
  if (!result.ok) return { status: 'invalid', code: result.code, message: `Demo data was not saved: ${result.error} The previous saved state was kept.` };
  if (!storage) return { status: 'unavailable', code: 'storage_unavailable', message: 'Browser storage is unavailable. No change was saved.' };
  try {
    return await withDemoStorageLock((): SaveResult => {
      if (!isCurrent()) return { status: 'error', code: 'cancelled', message: 'This operation was cancelled before saving.' };
      const before = storage.getItem(DEMO_STORAGE_KEY);
      if (expectedToken !== undefined && before !== expectedToken) return { status: 'conflict', code: 'stale_revision', message: 'Another view changed or reset this household. Refresh saved data before trying again.' };
      let revision = 0;
      try { const previous = before === null ? null : JSON.parse(before); if (previous?.format === 'fixlist-saved-v1') revision = previous.revision; } catch { /* A guarded client never replaces rejected bytes. */ }
      if (!Number.isSafeInteger(revision + 1)) return { status: 'capacity', code: 'storage_capacity', message: 'The saved revision limit was reached. Export or reset before saving more changes.' };
      const token = JSON.stringify({ format: 'fixlist-saved-v1', revision: revision + 1, state: result.state });
      if (!withinSizeLimit(token) || new TextEncoder().encode(token).byteLength + privacyReserveBytes(result.state) > MAX_SERIALIZED_BYTES) return { status: 'capacity', code: 'storage_capacity', message: 'This device has reached its saved-data limit. The last saved state was kept; privacy exits and completion decisions remain available.' };
      storage.setItem(DEMO_STORAGE_KEY, token);
      return { status: 'saved', token, message: 'Fictional demo changes saved in this browser only.' };
    });
  } catch (error) {
    return { status: 'error', code: error instanceof DOMException && error.name === 'QuotaExceededError' ? 'storage_capacity' : 'storage_unavailable', message: 'Changes could not be saved. The previous saved state was kept; reloading may restore older saved data.' };
  }
}
/** Caller holds the same lock as saves; attempt both owned keys even after a failure. */
function resetMetadata(storage: StorageInput, scenario: DemoScenario): ResetResult {
  const state = createInitialState(scenario);
  if (!storage) return { status: 'unavailable', state, message: 'Demo reset in memory. Browser storage is unavailable, so reloading may restore older saved data.' };
  let failed = false;
  for (const key of [DEMO_STORAGE_KEY, NAVIGATION_STORAGE_KEY]) { try { storage.removeItem(key); } catch { failed = true; } }
  return failed ? { status: 'error', state, message: 'Demo reset in memory, but saved data could not be removed. Reloading may restore older saved data.' }
    : { status: 'reset', state, message: 'Demo metadata reset. Only FixList demo data was removed.' };
}
export async function resetDemoState(storage: StorageInput, scenario: DemoScenario): Promise<ResetResult> {
  try { return await withDemoStorageLock(() => resetMetadata(storage, scenario)); }
  catch { return { status: 'error', state: createInitialState(scenario), message: 'Saved demo data could not be locked for reset. Reloading may restore older saved data.' }; }
}
/** Each owned store is attempted even if another fails; unrelated keys/databases are untouched. */
export async function resetFixListData(storage: StorageInput, scenario: DemoScenario, stores = { photos: resetPhotoStorage, scan: resetScanStorage, captures: resetCaptureStorage }): Promise<ResetResult> {
  async function clearPrivateStores(result: ResetResult): Promise<ResetResult> {
    const outcomes = await Promise.allSettled([Promise.resolve().then(() => stores.photos()), Promise.resolve().then(() => stores.scan()), Promise.resolve().then(() => stores.captures()), Promise.resolve().then(() => discardAllNativeCaptures())]);
    const failed = outcomes.some((o) => o.status === 'rejected' || !o.value.ok);
    return failed ? { ...result, status: 'error', message: `${result.message} Some saved photos, scans or walk-throughs could not be cleared. Reloading may restore older data.` } : result;
  }
  try { return await withDemoStorageLock(() => clearPrivateStores(resetMetadata(storage, scenario))); }
  catch { return clearPrivateStores({ status: 'error', state: createInitialState(scenario), message: 'Saved demo data could not be locked for reset. Reloading may restore older saved data.' }); }
}
