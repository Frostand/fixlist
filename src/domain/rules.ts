import type { ChecklistAnswer, DemoState } from './workflow';
import type { CriterionStatus, DemoScenario } from './types';

export const FAMILY_LABEL = 'Fictional family member';
export const HELPER_LABEL = 'Fictional family-known helper';
export const REQUEST_NOTE =
  'A local fictional family record only. Nothing is sent, and no helper or repair is independently verified.';
export const REQUEST_SOURCE = Object.freeze({
  status: 'synthetic' as const,
  label: 'Authored fictional fixture for the FixList demo',
  citationUrl: null,
  verifiedAt: null,
});
export const REQUEST_HISTORY_NOTICE =
  'This retained family report does not resolve any current or newly confirmed concern and does not verify a repair.';

/** Canonical UTC timestamps only; conversion validates the supplied value, never reads a clock. */
export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

export function isChecklistAnswer(value: unknown): value is ChecklistAnswer {
  return value === 'unknown' || value === 'yes' || value === 'no';
}

export function isCriterionStatus(value: unknown): value is CriterionStatus {
  return value === 'met' || value === 'not_met' || value === 'unknown';
}

export function requestIdForAction(referenceActionId: string): string {
  return `request-${referenceActionId}`;
}

/** Null means the trusted catalog contains a broken or empty evidence chain. */
export function getRequiredChecklistItemIds(scenario: DemoScenario, concernId: string): readonly string[] | null {
  const concern = scenario.concerns.find((item) => item.id === concernId);
  if (!concern || concern.evidenceIds.length === 0 || !scenario.referenceActions.some((item) => item.id === concern.referenceActionId)) return null;
  const required: string[] = [];
  for (const evidenceId of concern.evidenceIds) {
    const evidence = scenario.evidence.find((item) => item.id === evidenceId);
    const checklist = evidence && scenario.checklist.find((item) => item.id === evidence.checklistItemId);
    if (!evidence || !checklist || checklist.referenceActionId !== concern.referenceActionId) return null;
    required.push(checklist.id);
  }
  return [...new Set(required)].sort();
}

export function canConfirmConcern(scenario: DemoScenario, state: DemoState, concernId: string): boolean {
  const required = getRequiredChecklistItemIds(scenario, concernId);
  return required !== null && required.every((id) => state.checklistAnswers[id] === 'yes');
}

export function isConfirmedConcern(scenario: DemoScenario, state: DemoState, concernId: string): boolean {
  const confirmation = state.confirmations[concernId];
  if (!confirmation?.humanConfirmed) return false;
  const actor = state.people.find((p) => p.id === confirmation.actorId);
  const resident = state.people.find((p) => p.id === state.household.residentId);
  const label = actor?.role === 'resident' && actor.id === state.household.residentId ? `${actor.name} (resident)`
    : actor?.role === 'family_helper' ? `${actor.name} (family helper) for ${resident?.name ?? 'the resident'}`
      : confirmation.actorId === 'family-before-roles' ? 'Family record (before roles)' : null;
  return label !== null && confirmation.confirmedBy === label
    && isIsoTimestamp(confirmation.confirmedAt)
    && canConfirmConcern(scenario, state, concernId);
}
