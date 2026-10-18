import type { DemoScenario, FamilyRequest, FictionalProfile, HumanConfirmation } from './types';
import { computePlan } from './plan';
import {
  canConfirmConcern, FAMILY_LABEL, HELPER_LABEL, isChecklistAnswer,
  isIsoTimestamp, REQUEST_HISTORY_NOTICE, REQUEST_NOTE, REQUEST_SOURCE, requestIdForAction,
} from './rules';

export { computePlan } from './plan';
export type { PlanItem } from './plan';
export { computeWorkRelevance, screenProgram } from './screening';
export type { ProgramWorkRelevance, ScreeningResult } from './screening';
export { computeCoverage } from './coverage';
export { validateCatalog } from './catalog';
export {
  canConfirmConcern, FAMILY_LABEL, getRequiredChecklistItemIds, HELPER_LABEL, isChecklistAnswer,
  isConfirmedConcern, isCriterionStatus, isIsoTimestamp, REQUEST_HISTORY_NOTICE, REQUEST_NOTE,
  REQUEST_SOURCE, requestIdForAction,
} from './rules';

export type ChecklistAnswer = 'unknown' | 'yes' | 'no';

export interface DemoState {
  readonly schemaVersion: 2;
  readonly scenarioId: string;
  readonly checklistAnswers: Record<string, ChecklistAnswer>;
  readonly confirmations: Record<string, HumanConfirmation>;
  readonly profileId: string;
  readonly requests: readonly FamilyRequest[];
}

export type DemoCommand =
  | { type: 'answer_checklist'; checklistItemId: string; answer: ChecklistAnswer }
  | { type: 'confirm_concern'; concernId: string; at: string }
  | { type: 'unconfirm_concern'; concernId: string }
  | { type: 'select_profile'; profileId: string }
  | { type: 'create_request'; referenceActionId: string }
  | { type: 'set_request_status'; requestId: string; status: FamilyRequest['status'] }
  | { type: 'complete_request'; requestId: string; at: string }
  | { type: 'reopen_request'; requestId: string };

export type CommandResult = { ok: true; state: DemoState } | { ok: false; error: string };

export interface RequestView {
  readonly request: FamilyRequest;
  readonly active: boolean;
  readonly activityLabel: 'Active plan action' | 'Inactive history';
  readonly historyNotice: string;
}

function unconfirmed(): HumanConfirmation {
  return { humanConfirmed: false, confirmedBy: null, confirmedAt: null };
}

export function createInitialState(scenario: DemoScenario): DemoState {
  return {
    schemaVersion: 2,
    scenarioId: scenario.id,
    checklistAnswers: Object.fromEntries(scenario.checklist.map((item) => [item.id, 'unknown' as const])),
    confirmations: Object.fromEntries(scenario.concerns.map((concern) => [concern.id, unconfirmed()])),
    profileId: 'unknown-profile',
    requests: [],
  };
}

export function getSelectedProfile(scenario: DemoScenario, state: DemoState): FictionalProfile | null {
  return scenario.profiles.find((profile) => profile.id === state.profileId) ?? null;
}

export function getRequestViews(scenario: DemoScenario, state: DemoState): readonly RequestView[] {
  const activeActionIds = new Set(computePlan(scenario, state).map((item) => item.referenceActionId));
  return state.requests.map((request) => {
    const active = activeActionIds.has(request.referenceActionId);
    return { request, active, activityLabel: active ? 'Active plan action' : 'Inactive history', historyNotice: REQUEST_HISTORY_NOTICE };
  });
}

/** Applies an explicit local command. The caller supplies validated state; saved JSON needs the storage validator. */
export function applyCommand(scenario: DemoScenario, state: DemoState, command: DemoCommand): CommandResult {
  const fail = (error: string): CommandResult => ({ ok: false, error });
  const succeed = (next: DemoState): CommandResult => ({ ok: true, state: next });
  if (state.schemaVersion !== 2 || state.scenarioId !== scenario.id) return fail('State does not belong to this scenario.');

  switch (command.type) {
    case 'answer_checklist': {
      if (!scenario.checklist.some((item) => item.id === command.checklistItemId)) return fail('Unknown checklist item.');
      if (!isChecklistAnswer(command.answer)) return fail('Unsupported checklist answer.');
      const checklistAnswers = { ...state.checklistAnswers, [command.checklistItemId]: command.answer };
      const confirmations = { ...state.confirmations };
      const next = { ...state, checklistAnswers, confirmations };
      for (const concern of scenario.concerns) {
        if (!canConfirmConcern(scenario, next, concern.id)) confirmations[concern.id] = unconfirmed();
      }
      return succeed(next);
    }
    case 'confirm_concern': {
      if (!scenario.concerns.some((concern) => concern.id === command.concernId)) return fail('Unknown concern.');
      if (!isIsoTimestamp(command.at)) return fail('Confirmation requires a valid canonical ISO UTC timestamp.');
      if (!canConfirmConcern(scenario, state, command.concernId)) return fail('Every valid checklist item backing this concern must be answered yes before confirmation.');
      return succeed({ ...state, confirmations: {
        ...state.confirmations,
        [command.concernId]: { humanConfirmed: true, confirmedBy: FAMILY_LABEL, confirmedAt: command.at },
      } });
    }
    case 'unconfirm_concern': {
      if (!scenario.concerns.some((concern) => concern.id === command.concernId)) return fail('Unknown concern.');
      return succeed({ ...state, confirmations: { ...state.confirmations, [command.concernId]: unconfirmed() } });
    }
    case 'select_profile':
      if (!scenario.profiles.some((profile) => profile.id === command.profileId)) return fail('Unknown fictional profile.');
      return succeed({ ...state, profileId: command.profileId });
    case 'create_request': {
      if (!scenario.referenceActions.some((action) => action.id === command.referenceActionId)) return fail('Unknown reference action.');
      if (!computePlan(scenario, state).some((item) => item.referenceActionId === command.referenceActionId)) return fail('Requests can be created only for an active plan action.');
      if (state.requests.some((request) => request.referenceActionId === command.referenceActionId)) return fail('A retained request already exists for this action.');
      const request: FamilyRequest = {
        id: requestIdForAction(command.referenceActionId),
        referenceActionId: command.referenceActionId,
        helperLabel: HELPER_LABEL,
        recordedBy: FAMILY_LABEL,
        status: 'draft',
        note: REQUEST_NOTE,
        completion: { status: 'unconfirmed', reportedBy: null, reportedAt: null },
        source: { ...REQUEST_SOURCE },
      };
      return succeed({ ...state, requests: [...state.requests, request] });
    }
    case 'set_request_status':
    case 'complete_request':
    case 'reopen_request': {
      const request = state.requests.find((item) => item.id === command.requestId);
      if (!request) return fail('Unknown family request.');
      if (!computePlan(scenario, state).some((item) => item.referenceActionId === request.referenceActionId)) return fail('This request is inactive history. Reactivate its plan action before updating it.');
      let updated: FamilyRequest;
      if (command.type === 'reopen_request') {
        if (request.completion.status !== 'family_reported_complete') return fail('Only a completed family report can be reopened.');
        updated = { ...request, completion: { status: 'unconfirmed', reportedBy: null, reportedAt: null } };
      } else {
        if (request.completion.status !== 'unconfirmed') return fail('Reopen the family report before changing it.');
        if (command.type === 'complete_request') {
          if (request.status !== 'family_reported_requested' && request.status !== 'family_reported_in_progress') return fail('A draft cannot be reported complete.');
          if (!isIsoTimestamp(command.at)) return fail('Completion requires a valid canonical ISO UTC timestamp.');
          updated = { ...request, completion: { status: 'family_reported_complete', reportedBy: FAMILY_LABEL, reportedAt: command.at } };
        } else {
          const nextStatus = request.status === 'draft' ? 'family_reported_requested'
            : request.status === 'family_reported_requested' ? 'family_reported_in_progress' : null;
          if (nextStatus === null || command.status !== nextStatus) return fail('Only draft → family-reported requested → family-reported in progress is allowed.');
          updated = { ...request, status: command.status };
        }
      }
      return succeed({ ...state, requests: state.requests.map((item) => item.id === request.id ? updated : item) });
    }
    default:
      return fail('Unknown workflow command.');
  }
}
