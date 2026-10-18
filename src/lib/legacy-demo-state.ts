import type { DemoScenario, FamilyRequest } from '../domain/types';
import { FAMILY_LABEL, HELPER_LABEL, isChecklistAnswer, isCriterionStatus, isIsoTimestamp, REQUEST_NOTE, REQUEST_SOURCE, requestIdForAction, type ChecklistAnswer } from '../domain/workflow';
type LegacyConfirmation = { humanConfirmed: false; confirmedBy: null; confirmedAt: null } | { humanConfirmed: true; confirmedBy: string; confirmedAt: string };
export interface LegacyState { schemaVersion: 2; scenarioId: string; checklistAnswers: Record<string, ChecklistAnswer>; confirmations: Record<string, LegacyConfirmation>; profileId: string; requests: FamilyRequest[] }
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

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function invalid(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function parseChecklistAnswers(value: unknown, checklistIds: readonly string[]): Parsed<Record<string, ChecklistAnswer>> {
  if (!exactRecord(value, checklistIds)) return invalid('Checklist answers must contain exactly the known checklist IDs.');
  const checklistAnswers: Record<string, ChecklistAnswer> = {};
  for (const id of checklistIds) {
    const answer = value[id];
    if (!isChecklistAnswer(answer)) return invalid('Unsupported checklist answer.');
    checklistAnswers[id] = answer;
  }
  return { ok: true, value: checklistAnswers };
}

function parseConfirmations(value: unknown, concernIds: readonly string[]): Parsed<Record<string, LegacyConfirmation>> {
  if (!exactRecord(value, concernIds)) return invalid('Confirmations must contain exactly the known concern IDs.');
  const confirmations: Record<string, LegacyConfirmation> = {};
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


export function validateLegacyState(value: unknown, scenario: DemoScenario): Parsed<LegacyState> {
  const version = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'schemaVersion')?.value : null;
  const v1 = version === 1;
  if (!exactRecord(value, v1 ? legacyStateKeys : stateKeys) || (!v1 && version !== 2) || value.scenarioId !== legacyScenarioId || scenario.id !== legacyScenarioId) return invalid('Unsupported legacy state shape, version or scenario.');
  const checklist = parseChecklistAnswers(value.checklistAnswers, v1 ? legacyChecklistIds : scenario.checklist.map((i) => i.id));
  const confirmations = parseConfirmations(value.confirmations, v1 ? legacyConcernIds : scenario.concerns.map((i) => i.id));
  const requests = parseRequests(value.requests, v1 ? legacyActionIds : scenario.referenceActions.map((i) => i.id));
  if (!checklist.ok) return checklist;
  if (!confirmations.ok) return confirmations;
  if (!requests.ok) return requests;
  if (v1) {
    if (!exactRecord(value.criterionAnswers, legacyProgramIds)) return invalid('Invalid legacy criteria.');
    const answers = value.criterionAnswers['fictional-maple-support'];
    if (!exactRecord(answers, legacyCriterionIds) || !legacyCriterionIds.every((id) => isCriterionStatus(answers[id]))) return invalid('Invalid legacy criterion statuses.');
  } else if (typeof value.profileId !== 'string' || !scenario.profiles.some((p) => p.id === value.profileId)) return invalid('Unknown legacy profile.');
  for (const concern of scenario.concerns) {
    if (!confirmations.value[concern.id]?.humanConfirmed) continue;
    if (!concern.evidenceIds.length || concern.evidenceIds.some((id) => {
      const evidence = scenario.evidence.find((e) => e.id === id);
      const check = scenario.checklist.find((c) => c.id === evidence?.checklistItemId);
      return !check || check.referenceActionId !== concern.referenceActionId || checklist.value[check.id] !== 'yes';
    })) return invalid('Legacy confirmation lacks required yes answers.');
  }
  return { ok: true, value: { schemaVersion: 2, scenarioId: scenario.id, checklistAnswers: checklist.value, confirmations: confirmations.value, profileId: v1 ? 'unknown-profile' : value.profileId as string, requests: requests.value } };
}
