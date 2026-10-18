import type { DemoScenario, FamilyRequest, HumanConfirmation } from '../domain/types';
import {
  canConfirmConcern,
  createInitialState,
  FAMILY_LABEL,
  HELPER_LABEL,
  isChecklistAnswer,
  isCriterionStatus,
  isIsoTimestamp,
  REQUEST_NOTE,
  REQUEST_SOURCE,
  requestIdForAction,
  type DemoState,
} from '../domain/workflow';

export const DEMO_STORAGE_KEY = 'fixlist:demo:v1';
export const MAX_SERIALIZED_BYTES = 64 * 1024;

/** A narrow boundary keeps browser failures testable without using real storage. */
export interface DemoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ValidationResult =
  | { ok: true; state: DemoState }
  | { ok: false; error: string };

export interface LoadResult {
  status: 'loaded' | 'migrated' | 'empty' | 'invalid' | 'unavailable' | 'error';
  state: DemoState;
  message: string;
}

export interface SaveResult {
  status: 'saved' | 'invalid' | 'unavailable' | 'error';
  message: string;
}

export interface ResetResult {
  status: 'reset' | 'unavailable' | 'error';
  state: DemoState;
  message: string;
}

type StorageInput = DemoStorage | null | undefined;
type BrowserStorageHost = { readonly localStorage: DemoStorage };

const stateKeys = [
  'schemaVersion', 'scenarioId', 'checklistAnswers', 'confirmations', 'profileId', 'requests',
] as const;
// These are the original version-1 IDs, deliberately independent of the
// expanding current catalog. New IDs must never make a legacy payload valid.
const legacyStateKeys = [
  'schemaVersion', 'scenarioId', 'checklistAnswers', 'confirmations', 'criterionAnswers', 'requests',
] as const;
const legacyChecklistIds = ['rug-check', 'cord-check'] as const;
const legacyConcernIds = ['rug-concern', 'cord-concern'] as const;
const legacyActionIds = ['review-rug', 'review-cord'] as const;
const legacyProgramIds = ['fictional-maple-support'] as const;
const legacyCriterionIds = ['fictional-area', 'fictional-residency'] as const;
const legacyScenarioId = 'fictional-maple-house';
const confirmationKeys = ['humanConfirmed', 'confirmedBy', 'confirmedAt'] as const;
const requestKeys = [
  'id', 'referenceActionId', 'helperLabel', 'recordedBy', 'status', 'note', 'completion', 'source',
] as const;
const completionKeys = ['status', 'reportedBy', 'reportedAt'] as const;
const sourceKeys = ['status', 'label', 'citationUrl', 'verifiedAt'] as const;

/** Require data properties, including all expected keys and no extra keys. */
function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Reflect.ownKeys(value);
  const expected = new Set(keys);
  return actual.length === expected.size && actual.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && expected.has(key) && descriptor !== undefined && 'value' in descriptor;
  });
}

/** Reject sparse arrays, accessors and extra array properties without reading them. */
function boundedDataArray(value: unknown, maxLength: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maxLength) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === value.length + 1 && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor
      && (key === 'length' || (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length));
  });
}

function withinSizeLimit(serialized: string): boolean {
  // UTF-8 needs at least one byte per UTF-16 code unit, so avoid encoding huge input.
  return serialized.length <= MAX_SERIALIZED_BYTES
    && new TextEncoder().encode(serialized).byteLength <= MAX_SERIALIZED_BYTES;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function invalid(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function parseChecklistAnswers(value: unknown, checklistIds: readonly string[]): Parsed<DemoState['checklistAnswers']> {
  if (!exactRecord(value, checklistIds)) return invalid('Checklist answers must contain exactly the known checklist IDs.');
  const checklistAnswers: DemoState['checklistAnswers'] = {};
  for (const id of checklistIds) {
    const answer = value[id];
    if (!isChecklistAnswer(answer)) return invalid('Unsupported checklist answer.');
    checklistAnswers[id] = answer;
  }
  return { ok: true, value: checklistAnswers };
}

function parseConfirmations(value: unknown, concernIds: readonly string[]): Parsed<DemoState['confirmations']> {
  if (!exactRecord(value, concernIds)) return invalid('Confirmations must contain exactly the known concern IDs.');
  const confirmations: Record<string, HumanConfirmation> = {};
  for (const concernId of concernIds) {
    const confirmation = value[concernId];
    if (!exactRecord(confirmation, confirmationKeys)) return invalid(`Invalid confirmation fields for ${concernId}.`);
    if (confirmation.humanConfirmed === false) {
      if (confirmation.confirmedBy !== null || confirmation.confirmedAt !== null) return invalid(`Unconfirmed concern ${concernId} cannot have attribution or a timestamp.`);
      confirmations[concernId] = { humanConfirmed: false, confirmedBy: null, confirmedAt: null };
    } else if (confirmation.humanConfirmed === true) {
      if (confirmation.confirmedBy !== FAMILY_LABEL || !isIsoTimestamp(confirmation.confirmedAt)) return invalid(`Invalid confirmation attribution or canonical ISO timestamp for ${concernId}.`);
      confirmations[concernId] = { humanConfirmed: true, confirmedBy: FAMILY_LABEL, confirmedAt: confirmation.confirmedAt };
    } else {
      return invalid(`Unsupported confirmation status for ${concernId}.`);
    }
  }
  return { ok: true, value: confirmations };
}

function parseRequests(value: unknown, knownActionIds: readonly string[]): Parsed<FamilyRequest[]> {
  const requests: FamilyRequest[] = [];
  if (!boundedDataArray(value, knownActionIds.length)) return invalid('Requests must be a bounded data array of known actions.');
  const actionIds = new Set(knownActionIds);
  const seenRequestIds = new Set<string>();
  const seenActionIds = new Set<string>();
  for (const request of value) {
    if (!exactRecord(request, requestKeys)) return invalid('Invalid family request fields.');
    if (typeof request.referenceActionId !== 'string' || !actionIds.has(request.referenceActionId)) return invalid('Family request references an unknown action.');
    const referenceActionId = request.referenceActionId;
    const requestId = requestIdForAction(referenceActionId);
    if (request.id !== requestId) return invalid('Family request has an unknown or mismatched request ID.');
    if (seenRequestIds.has(requestId) || seenActionIds.has(referenceActionId)) return invalid('Duplicate family request or action ID.');
    seenRequestIds.add(requestId);
    seenActionIds.add(referenceActionId);
    if (request.helperLabel !== HELPER_LABEL || request.recordedBy !== FAMILY_LABEL || request.note !== REQUEST_NOTE) return invalid('Family request attribution, helper, or note is not a fixed synthetic value.');
    if (request.status !== 'draft' && request.status !== 'family_reported_requested' && request.status !== 'family_reported_in_progress') return invalid('Unsupported family request status.');
    if (!exactRecord(request.source, sourceKeys)
      || request.source.status !== REQUEST_SOURCE.status
      || request.source.label !== REQUEST_SOURCE.label
      || request.source.citationUrl !== null
      || request.source.verifiedAt !== null) return invalid('Family request source must be the fixed synthetic source with no verification date.');
    if (!exactRecord(request.completion, completionKeys)) return invalid('Invalid completion fields.');
    let completion: FamilyRequest['completion'];
    if (request.completion.status === 'unconfirmed') {
      if (request.completion.reportedBy !== null || request.completion.reportedAt !== null) return invalid('Unconfirmed completion cannot have attribution or a timestamp.');
      completion = { status: 'unconfirmed', reportedBy: null, reportedAt: null };
    } else if (request.completion.status === 'family_reported_complete') {
      if (request.status === 'draft') return invalid('A draft request cannot be reported complete.');
      if (request.completion.reportedBy !== FAMILY_LABEL || !isIsoTimestamp(request.completion.reportedAt)) return invalid('Invalid completion attribution or canonical ISO timestamp.');
      completion = { status: 'family_reported_complete', reportedBy: FAMILY_LABEL, reportedAt: request.completion.reportedAt };
    } else {
      return invalid('Unsupported completion status.');
    }
    requests.push({
      id: requestId,
      referenceActionId,
      helperLabel: HELPER_LABEL,
      recordedBy: FAMILY_LABEL,
      status: request.status,
      note: REQUEST_NOTE,
      completion,
      source: { ...REQUEST_SOURCE },
    });
  }
  return { ok: true, value: requests };
}

/**
 * Saved JSON is untrusted. Validate all v2 fields, then reconstruct fresh state
 * using trusted catalog IDs/constants. No facts, source text or derived output
 * are accepted. This also makes save strictly v2-only; only load may migrate.
 */
export function validateState(value: unknown, scenario: DemoScenario): ValidationResult {
  if (!exactRecord(value, stateKeys)) return invalid('State has missing, unknown, or unsupported fields.');
  if (value.schemaVersion !== 2) return invalid('Unsupported demo schema version.');
  if (value.scenarioId !== scenario.id) return invalid('Saved state belongs to an unknown scenario.');
  const checklist = parseChecklistAnswers(value.checklistAnswers, scenario.checklist.map((item) => item.id));
  if (!checklist.ok) return checklist;
  const concernIds = scenario.concerns.map((concern) => concern.id);
  const confirmations = parseConfirmations(value.confirmations, concernIds);
  if (!confirmations.ok) return confirmations;
  if (typeof value.profileId !== 'string' || !scenario.profiles.some((profile) => profile.id === value.profileId)) return invalid('Saved state references an unknown fictional profile.');
  const requests = parseRequests(value.requests, scenario.referenceActions.map((action) => action.id));
  if (!requests.ok) return requests;

  const state: DemoState = {
    schemaVersion: 2,
    scenarioId: scenario.id,
    checklistAnswers: checklist.value,
    confirmations: confirmations.value,
    profileId: value.profileId,
    requests: requests.value,
  };
  for (const concernId of concernIds) {
    if (state.confirmations[concernId]?.humanConfirmed && !canConfirmConcern(scenario, state, concernId)) return invalid(`Confirmed concern ${concernId} lacks its required yes answers or valid evidence chain.`);
  }
  // Requests may be inactive history. A later confirmation timestamp need not
  // precede a retained completion timestamp; reactivation does not verify repair.
  if (!withinSizeLimit(JSON.stringify(state))) return invalid('Demo state exceeds the 64 KiB storage limit.');
  return { ok: true, state };
}

/** Validate the complete frozen v1 contract before discarding any legacy field. */
function migrateLegacyState(value: unknown, scenario: DemoScenario): ValidationResult {
  if (!exactRecord(value, legacyStateKeys)) return invalid('Legacy state has missing, unknown, or unsupported fields.');
  if (value.schemaVersion !== 1 || value.scenarioId !== legacyScenarioId || scenario.id !== legacyScenarioId) return invalid('Unsupported legacy schema or scenario.');
  const checklist = parseChecklistAnswers(value.checklistAnswers, legacyChecklistIds);
  if (!checklist.ok) return checklist;
  const confirmations = parseConfirmations(value.confirmations, legacyConcernIds);
  if (!confirmations.ok) return confirmations;
  for (const [index, concernId] of legacyConcernIds.entries()) {
    if (confirmations.value[concernId]?.humanConfirmed && checklist.value[legacyChecklistIds[index]!] !== 'yes') return invalid(`Legacy confirmed concern ${concernId} lacks its required yes answer.`);
  }
  if (!exactRecord(value.criterionAnswers, legacyProgramIds)) return invalid('Legacy criterion answers must contain exactly the original program ID.');
  const criterionAnswers = value.criterionAnswers['fictional-maple-support'];
  if (!exactRecord(criterionAnswers, legacyCriterionIds)) return invalid('Legacy criterion answers must contain exactly the original criterion IDs.');
  if (!legacyCriterionIds.every((id) => isCriterionStatus(criterionAnswers[id]))) return invalid('Unsupported legacy criterion answer.');
  const requests = parseRequests(value.requests, legacyActionIds);
  if (!requests.ok) return requests;
  const initial = createInitialState(scenario);
  // Recorded criterion statuses are not facts. All new answers/confirmations and
  // the profile remain unknown/unconfirmed; retained requests remain local history.
  return validateState({
    ...initial,
    checklistAnswers: { ...initial.checklistAnswers, ...checklist.value },
    confirmations: { ...initial.confirmations, ...confirmations.value },
    profileId: 'unknown-profile',
    requests: requests.value,
  }, scenario);
}

/** Reading window.localStorage itself may throw (for example, denied storage). */
export function getBrowserStorage(
  browser: BrowserStorageHost | null = typeof window === 'undefined' ? null : window,
): DemoStorage | null {
  try {
    return browser?.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Loading is read-only, including recovery. The caller chooses when to save. */
export function loadDemoState(storage: StorageInput, scenario: DemoScenario): LoadResult {
  const state = createInitialState(scenario);
  if (!storage) return { status: 'unavailable', state, message: 'Browser storage is unavailable. Changes are kept in memory only.' };
  let serialized: string | null;
  try {
    serialized = storage.getItem(DEMO_STORAGE_KEY);
  } catch {
    return { status: 'error', state, message: 'Saved demo data could not be read. A fresh demo is running in memory; saved data was not changed.' };
  }
  if (serialized === null) return { status: 'empty', state, message: 'Fresh fictional demo. No saved demo data was found.' };
  if (!withinSizeLimit(serialized)) return { status: 'invalid', state, message: 'Saved demo data exceeds the 64 KiB limit. A fresh demo is running; saved data was not changed.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { status: 'invalid', state, message: 'Saved demo data is not valid JSON. A fresh demo is running; saved data was not changed.' };
  }
  const isLegacy = parsed !== null && typeof parsed === 'object'
    && Object.getOwnPropertyDescriptor(parsed, 'schemaVersion')?.value === 1;
  const result = isLegacy ? migrateLegacyState(parsed, scenario) : validateState(parsed, scenario);
  return result.ok
    ? isLegacy
      ? { status: 'migrated', state: result.state, message: 'Legacy fictional demo data migrated in memory. Legacy screening statuses were not converted to facts; select a fictional profile to screen again. Saved data is unchanged until your next successful explicit edit is saved.' }
      : { status: 'loaded', state: result.state, message: 'Saved fictional demo data loaded from this browser.' }
    : { status: 'invalid', state, message: `Saved demo data was rejected: ${result.error} A fresh demo is running; saved data was not changed.` };
}

export function saveDemoState(storage: StorageInput, scenario: DemoScenario, state: DemoState): SaveResult {
  const result = validateState(state, scenario);
  if (!result.ok) return { status: 'invalid', message: `Demo data was not saved: ${result.error} Changes remain in memory only.` };
  if (!storage) return { status: 'unavailable', message: 'Browser storage is unavailable. Changes are kept in memory only.' };
  try {
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(result.state));
    return { status: 'saved', message: 'Fictional demo changes saved in this browser only.' };
  } catch {
    return { status: 'error', message: 'Changes could not be saved in this browser. Changes remain in memory only; reloading may restore older saved data.' };
  }
}

export function resetDemoState(storage: StorageInput, scenario: DemoScenario): ResetResult {
  const state = createInitialState(scenario);
  if (!storage) return { status: 'unavailable', state, message: 'Demo reset in memory. Browser storage is unavailable, so reloading may restore older saved data.' };
  try {
    storage.removeItem(DEMO_STORAGE_KEY);
    return { status: 'reset', state, message: 'Demo reset. Only FixList demo data was removed from this browser.' };
  } catch {
    return { status: 'error', state, message: 'Demo reset in memory, but saved demo data could not be removed. Reloading may restore older saved data.' };
  }
}
