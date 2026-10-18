import type { DemoScenario } from './types';
import type { DemoState, RequestView } from './workflow';
import { canConfirmConcern, computePlan, getRequestViews, currentRequestForAction, hasScope, liveAssignment } from './workflow';
import type { VolunteerRequestView } from './roles';

export type VisibleRequest = ({ kind: 'household' } & RequestView) | VolunteerRequestView;
/** Never spread a request into the volunteer projection: absent fields really have no key. */
export function visibleRequestsFor(scenario: DemoScenario, state: DemoState, actorId: string): readonly VisibleRequest[] {
  const actor = state.people.find((p) => p.id === actorId);
  if (!actor) return [];
  const views = getRequestViews(scenario, state);
  if (hasScope(state, actorId, 'requests')) return views.map((v) => ({ kind: 'household', ...structuredClone(v) }));
  if (actor.role !== 'volunteer') return [];
  return views.filter(({ request: r, active }) => active && r.volunteerId === actorId && !['draft', 'declined', 'cancelled'].includes(r.status)).map(({ request: r, active }) => {
    const action = scenario.referenceActions.find((a) => a.id === r.referenceActionId)!;
    const checks = scenario.checklist.filter((c) => c.referenceActionId === action.id);
    const view: VolunteerRequestView = { kind: 'volunteer', id: r.id, status: r.status, revision: r.revision, active, title: action.title, nextStep: action.nextStep,
      proposedTime: structuredClone(r.proposedTime), agreedTime: structuredClone(r.agreedTime), updates: structuredClone(r.updates), reportedDone: structuredClone(r.reportedDone), confirmedDone: structuredClone(r.confirmedDone), independentVerification: r.independentVerification };
    if (liveAssignment(r) && r.sharing.roomName) view.roomName = [...new Set(checks.map((c) => scenario.rooms.find((room) => room.id === c.roomId)!.name))].join(', ');
    if (liveAssignment(r) && r.sharing.photos) view.photos = structuredClone(state.photos.filter((p) => p.addedBy === state.household.residentId && checks.some((c) => c.id === p.checklistItemId)));
    if (liveAssignment(r) && r.sharing.scanLocation) view.scanLocation = r.scanLocation;
    if (liveAssignment(r) && r.sharing.visitTimes) view.visitTimes = r.visitTimes;
    if (liveAssignment(r) && r.sharing.areaLabel) view.areaLabel = r.areaLabel;
    return view;
  });
}
/** Optional sections enforce grants without returning the underlying state. Scan access is an explicit capability. */
export function visibleHouseholdFor(scenario: DemoScenario, state: DemoState, actorId: string) {
  const checklist = hasScope(state, actorId, 'checklist');
  const confirm = hasScope(state, actorId, 'confirm');
  const requests = hasScope(state, actorId, 'requests');
  if (!checklist && !confirm && !requests) return null;
  return {
    ...(checklist ? { checklistAnswers: { ...state.checklistAnswers }, photos: structuredClone(state.photos), canViewScan: true } : {}),
    ...(confirm ? { confirmations: structuredClone(state.confirmations) } : {}),
    ...(confirm || requests ? { plan: structuredClone(computePlan(scenario, state)) } : {}),
    ...(requests ? { requests: visibleRequestsFor(scenario, state, actorId) } : {}),
  };
}
export type ElderNextStep =
  | { kind: 'answer_checklist'; checklistItemId: string }
  | { kind: 'confirm_concern'; concernId: string }
  | { kind: 'create_request'; referenceActionId: string }
  | { kind: 'invite_volunteer' | 'find_professional'; requestId: string }
  | { kind: 'agree_time' | 'review_completion'; requestId: string }
  | { kind: 'wait_for_volunteer' | 'track_referral'; requestId: string }
  | { kind: 'done' };
export function elderNextStep(scenario: DemoScenario, state: DemoState, actorId = state.household.residentId): ElderNextStep | null {
  if (actorId !== state.household.residentId) return null;
  const active = getRequestViews(scenario, state).filter((v) => v.active).map((v) => v.request);
  const reported = active.find((r) => r.status === 'volunteer_reported_done');
  if (reported) return { kind: 'review_completion', requestId: reported.id };
  const proposed = active.find((r) => r.status === 'accepted' && r.proposedTime);
  if (proposed) return { kind: 'agree_time', requestId: proposed.id };
  const person = state.people.find((p) => p.id === actorId)!;
  const checks = [...scenario.checklist.slice(person.checklistPosition), ...scenario.checklist.slice(0, person.checklistPosition)];
  const unanswered = checks.find((c) => !state.checklistAnswers[c.id] || state.checklistAnswers[c.id] === 'unknown');
  if (unanswered) return { kind: 'answer_checklist', checklistItemId: unanswered.id };
  const concern = scenario.concerns.find((c) => !state.confirmations[c.id]?.humanConfirmed && canConfirmConcern(scenario, state, c.id));
  if (concern) return { kind: 'confirm_concern', concernId: concern.id };
  const plan = computePlan(scenario, state);
  for (const item of plan) {
    const request = currentRequestForAction(state, item.referenceActionId);
    if (!request) return { kind: 'create_request', referenceActionId: item.referenceActionId };
    if (request.professionalReferral) continue;
    if (request.status === 'draft' || request.status === 'declined') return { kind: item.referenceAction.effort === 'professional' ? 'find_professional' : 'invite_volunteer', requestId: request.id };
  }
  const referral = active.find((r) => r.professionalReferral && r.professionalReferral !== 'closed');
  if (referral) return { kind: 'track_referral', requestId: referral.id };
  const waiting = active.find((r) => !['resident_confirmed_done', 'cancelled'].includes(r.status) && r.professionalReferral !== 'closed');
  return waiting ? { kind: 'wait_for_volunteer', requestId: waiting.id } : { kind: 'done' };
}
export type HelperNextStep = Extract<ElderNextStep, { kind: 'answer_checklist' | 'confirm_concern' | 'create_request' | 'done' }> | { kind: 'helper_wait'; requestId: string } | { kind: 'helper_evidence' | 'helper_access' };
export function helperNextStep(scenario: DemoScenario, state: DemoState, actorId: string): HelperNextStep | null {
  const person = state.people.find((p) => p.id === actorId);
  if (person?.role !== 'family_helper') return null;
  if (hasScope(state, actorId, 'checklist')) {
    const checks = [...scenario.checklist.slice(person.checklistPosition), ...scenario.checklist.slice(0, person.checklistPosition)];
    const unanswered = checks.find((c) => state.checklistAnswers[c.id] === 'unknown');
    if (unanswered) return { kind: 'answer_checklist', checklistItemId: unanswered.id };
    if (hasScope(state, actorId, 'confirm')) {
      const concern = scenario.concerns.find((c) => !state.confirmations[c.id]?.humanConfirmed && canConfirmConcern(scenario, state, c.id));
      if (concern) return { kind: 'confirm_concern', concernId: concern.id };
    }
  } else if (hasScope(state, actorId, 'confirm')) return { kind: 'helper_evidence' };
  if (hasScope(state, actorId, 'requests')) {
    const item = computePlan(scenario, state).find((p) => !currentRequestForAction(state, p.referenceActionId));
    if (item) return { kind: 'create_request', referenceActionId: item.referenceActionId };
    const waiting = getRequestViews(scenario, state).find((v) => v.active && v.request.status !== 'resident_confirmed_done' && v.request.professionalReferral !== 'closed');
    if (waiting) return { kind: 'helper_wait', requestId: waiting.request.id };
  }
  return state.delegations.some((d) => d.personId === actorId && d.scopes.length) ? { kind: 'done' } : { kind: 'helper_access' };
}
export type VolunteerNextStep = { kind: 'accept_or_decline' | 'propose_time' | 'wait_for_resident' | 'post_update' | 'report_done'; requestId: string } | { kind: 'done' };
export function volunteerNextStep(scenario: DemoScenario, state: DemoState, actorId: string): VolunteerNextStep | null {
  if (state.people.find((p) => p.id === actorId)?.role !== 'volunteer') return null;
  const requests = visibleRequestsFor(scenario, state, actorId).filter((v): v is VolunteerRequestView => v.kind === 'volunteer');
  const r = requests.find((v) => v.status === 'invited') ?? requests.find((v) => v.status !== 'resident_confirmed_done');
  if (!r) return { kind: 'done' };
  const kind = r.status === 'invited' ? 'accept_or_decline' : r.status === 'accepted' ? r.proposedTime ? 'wait_for_resident' : 'propose_time'
    : r.status === 'scheduled' ? 'post_update' : r.status === 'in_progress' ? 'report_done' : 'wait_for_resident';
  return { kind, requestId: r.id };
}
