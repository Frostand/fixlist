import type { FailureCode } from './failures';
import type { DemoScenario, FictionalProfile, HumanConfirmation } from './types';
import type { Attribution, Delegation, DelegationScope, HelpRequest, Household, HouseholdPhoto, Language, Person, PersonRole, RequestSharing, SharingField } from './roles';
import { isLanguage, MAX_HOUSEHOLD_PHOTOS, MAX_REMOVED_PHOTO_HISTORY, noSharing, REQUEST_HISTORY_LIMIT, sharingFields } from './roles';
import { demoPeople, RESIDENT_ID } from '../data/demo-people';
import { computePlan } from './plan';
import { canConfirmConcern, isChecklistAnswer, isIsoTimestamp, REQUEST_HISTORY_NOTICE, requestIdForAction } from './rules';
export { computePlan, groupPlanByEffort, PLAN_GROUPING_EXPLANATION } from './plan';
export type { PlanItem } from './plan';
export { computeWorkRelevance, screenProgram } from './screening';
export type { ProgramWorkRelevance, ScreeningResult } from './screening';
export { computeCoverage } from './coverage';
export { validateCatalog } from './catalog';
export * from './roles';
export { canConfirmConcern, FAMILY_LABEL, getRequiredChecklistItemIds, HELPER_LABEL, isChecklistAnswer, isConfirmedConcern, isCriterionStatus, isIsoTimestamp, REQUEST_HISTORY_NOTICE, REQUEST_NOTE, REQUEST_SOURCE, requestIdForAction } from './rules';
export type ChecklistAnswer = 'unknown' | 'yes' | 'no';
export interface DemoState {
  readonly schemaVersion: 5;
  readonly actionEpisodes: Record<string, number>;
  readonly removedPhotos: readonly (HouseholdPhoto & { removedBy: Attribution })[];
  readonly removedPhotoHistoryTruncated: boolean;
  readonly scenarioId: string;
  readonly checklistAnswers: Record<string, ChecklistAnswer>;
  readonly checklistAttribution: Record<string, Attribution | null>;
  readonly confirmationAttribution: Record<string, Attribution | null>;
  readonly confirmations: Record<string, HumanConfirmation>;
  readonly profileId: string;
  readonly profileAttribution: Attribution | null;
  readonly requests: readonly HelpRequest[];
  readonly people: readonly Person[];
  readonly household: Household;
  readonly delegations: readonly Delegation[];
  readonly photos: readonly HouseholdPhoto[];
  readonly activePersonId: string;
}
type RequestTarget = { requestId: string; expectedRevision: number };
type CommandPayload =
  | { type: 'answer_checklist'; checklistItemId: string; answer: ChecklistAnswer; position?: number }
  | { type: 'confirm_concern' | 'unconfirm_concern'; concernId: string }
  | { type: 'select_profile'; profileId: string }
  | { type: 'create_person'; personId: string; name: string; role: PersonRole; language: Language }
  | { type: 'select_person'; personId: string }
  | { type: 'set_language'; language: Language }
  | { type: 'set_onboarding'; guideId: string; stepIndex: number; completed: boolean }
  | { type: 'set_checklist_position'; position: number }
  | { type: 'set_volunteer_profile'; skills: readonly string[]; availability: string }
  | { type: 'grant_delegation'; personId: string; scopes: readonly DelegationScope[] }
  | { type: 'revoke_delegation'; personId: string }
  | { type: 'add_photo'; photoId: string; checklistItemId: string; width: number; height: number }
  | { type: 'remove_photo'; photoId: string }
  | { type: 'create_request'; referenceActionId: string; expectedRevision: 0 }
  | (RequestTarget & { type: 'set_sharing'; sharing: RequestSharing; visitTimes: string; areaLabel: string; scanLocation: string | null })
  | (RequestTarget & { type: 'revoke_shared_field'; field: SharingField })
  | (RequestTarget & { type: 'invite_volunteer'; volunteerId: string })
  | (RequestTarget & { type: 'decline_invitation'; reason: string })
  | (RequestTarget & { type: 'propose_time'; text: string })
  | (RequestTarget & { type: 'post_update'; text: string })
  | (RequestTarget & { type: 'accept_invitation' | 'agree_time' | 'report_done' | 'confirm_done' | 'not_done_yet' | 'withdraw' | 'cancel_request' | 'cancel_invitation' | 'record_referral' | 'contact_referral' | 'close_referral' });
export type DemoCommand = CommandPayload & Attribution;
/** UI convenience only: the current resident screen supplies actor/time before dispatch. */
export type ResidentCommandInput = CommandPayload & { at?: string };
export type CommandResult = { ok: true; state: DemoState } | { ok: false; error: string; code: FailureCode };
export interface RequestView {
  readonly request: HelpRequest;
  readonly active: boolean;
  readonly inactiveReason: 'cancelled' | 'unconfirmed' | 'completed' | 'superseded' | null;
  readonly activityLabel: 'Active plan action' | 'Inactive history';
  readonly historyNotice: string;
}
export const unconfirmed = (): HumanConfirmation => ({ humanConfirmed: false, confirmedBy: null, confirmedAt: null });
export const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
export const validText = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && (empty || value.length > 0) && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
export function createInitialState(scenario: DemoScenario): DemoState {
  return { schemaVersion: 5, actionEpisodes: Object.fromEntries(scenario.referenceActions.map((a) => [a.id, 0])), removedPhotos: [], removedPhotoHistoryTruncated: false, scenarioId: scenario.id,
    checklistAnswers: Object.fromEntries(scenario.checklist.map((item) => [item.id, 'unknown' as const])),
    checklistAttribution: Object.fromEntries(scenario.checklist.map((item) => [item.id, null])),
    confirmations: Object.fromEntries(scenario.concerns.map((concern) => [concern.id, unconfirmed()])),
    confirmationAttribution: Object.fromEntries(scenario.concerns.map((concern) => [concern.id, null])),
    profileId: 'unknown-profile', profileAttribution: null, requests: [], people: structuredClone(demoPeople),
    household: { id: 'maple-house', residentId: RESIDENT_ID }, delegations: [], photos: [], activePersonId: RESIDENT_ID };
}
export function getSelectedProfile(scenario: DemoScenario, state: DemoState): FictionalProfile | null { return scenario.profiles.find((p) => p.id === state.profileId) ?? null; }
export function hasScope(state: DemoState, actorId: string, scope: DelegationScope): boolean {
  const actor = state.people.find((p) => p.id === actorId);
  return actor?.role === 'resident' && state.household.residentId === actorId
    || actor?.role === 'family_helper' && state.delegations.some((d) => d.personId === actorId && d.scopes.includes(scope));
}
export function attributionLabel(state: DemoState, actorId: string): string {
  const p = state.people.find((person) => person.id === actorId);
  const resident = state.people.find((person) => person.id === state.household.residentId);
  return p ? p.role === 'family_helper' ? `${p.name} (family helper) for ${resident?.name ?? 'the resident'}` : `${p.name} (${p.role})` : 'Family record (before roles)';
}
/** Internal/resident query; role-specific screens must use visibleRequestsFor. */
export function currentRequestForAction(state: DemoState, actionId: string): HelpRequest | undefined {
  return state.requests.findLast((r) => r.referenceActionId === actionId && r.episode === state.actionEpisodes[actionId] && r.status !== 'cancelled');
}
export function nextRequestId(state: DemoState, actionId: string): string {
  const count = state.requests.filter((r) => r.referenceActionId === actionId).length;
  return count === 0 ? requestIdForAction(actionId) : `${requestIdForAction(actionId)}-${count + 1}`;
}
export function getRequestViews(scenario: DemoScenario, state: DemoState): readonly RequestView[] {
  const activeIds = new Set(computePlan(scenario, state).map((p) => p.referenceActionId));
  return state.requests.map((request) => {
    const latest = currentRequestForAction(state, request.referenceActionId);
    const current = request.episode === state.actionEpisodes[request.referenceActionId] && latest?.id === request.id;
    const active = activeIds.has(request.referenceActionId) && request.status !== 'cancelled' && current;
    const inactiveReason = request.status === 'cancelled' ? 'cancelled' : !current ? 'superseded'
      : !activeIds.has(request.referenceActionId) ? 'unconfirmed' : (request.status === 'resident_confirmed_done' || request.professionalReferral === 'closed') ? 'completed' : null;
    return { request, active, inactiveReason, activityLabel: active ? 'Active plan action' : 'Inactive history', historyNotice: REQUEST_HISTORY_NOTICE };
  });
}
const residentTypes = new Set(['select_profile', 'grant_delegation', 'revoke_delegation', 'set_sharing', 'revoke_shared_field', 'invite_volunteer', 'cancel_invitation', 'cancel_request', 'agree_time', 'confirm_done', 'not_done_yet', 'record_referral', 'contact_referral', 'close_referral']);
const volunteerTypes = new Set(['accept_invitation', 'decline_invitation', 'propose_time', 'post_update', 'report_done', 'withdraw', 'set_volunteer_profile']);
export const SHARING_REVOCATION_NOTICE = 'They may already have seen this. Revoking stops future access on this device.';
export const liveAssignment = (r: HelpRequest): boolean => ['invited', 'accepted', 'scheduled', 'in_progress', 'volunteer_reported_done'].includes(r.status);
/** Pure local authorization and transitions. No clock, storage, upload or account authentication. */
export function applyCommand(scenario: DemoScenario, state: DemoState, c: DemoCommand): CommandResult {
  const fail = (error: string, code: FailureCode = 'invalid_state'): CommandResult => ({ ok: false, error, code });
  const ok = (next: DemoState): CommandResult => ({ ok: true, state: next });
  if (state.schemaVersion !== 5 || state.scenarioId !== scenario.id) return fail('State does not belong to this scenario.');
  const actor = state.people.find((p) => p.id === c.actorId);
  if (!actor) return fail('Choose a known demo person before making a change.');
  if (!isIsoTimestamp(c.at)) return fail('A valid canonical ISO UTC timestamp is required.');
  const by = { actorId: actor.id, at: c.at };
  const resident = actor.role === 'resident' && state.household.residentId === actor.id;
  if (residentTypes.has(c.type) && !resident) return fail('Only the resident can approve this change.', 'permission_denied');
  if (volunteerTypes.has(c.type) && actor.role !== 'volunteer') return fail('Only the invited volunteer can make this change.', 'permission_denied');
  const scope = ['answer_checklist', 'add_photo'].includes(c.type) ? 'checklist'
    : ['confirm_concern', 'unconfirm_concern'].includes(c.type) ? 'confirm' : c.type === 'create_request' ? 'requests' : null;
  if (scope && !hasScope(state, actor.id, scope)) return fail(`The resident must grant ${scope} permission for this change.`, 'permission_denied');
  if (c.type === 'confirm_concern' && !hasScope(state, actor.id, 'checklist')) return fail('Confirmation also needs an explicit checklist evidence grant.', 'permission_denied');
  const editPerson = (patch: Partial<Person>) => ok({ ...state, people: state.people.map((p) => p.id === actor.id ? { ...p, ...patch, updatedBy: by } : p) });
  switch (c.type) {
    case 'create_person': {
      if (!validId(c.personId) || state.people.some((p) => p.id === c.personId) || c.personId === 'family-before-roles') return fail('Choose a new demo person ID.');
      if (state.people.length >= 20 || !validText(c.name, 40)) return fail('Use a name of 1–40 characters; this demo supports up to 20 people.');
      if (!['resident', 'family_helper', 'volunteer'].includes(c.role) || !isLanguage(c.language)) return fail('Choose a supported role and language.');
      if (c.role === 'resident' && state.people.some((p) => p.role === 'resident')) return fail('Maple House already has its one resident. A new profile cannot take over the household.');
      const person: Person = { id: c.personId, name: c.name, role: c.role, fictional: true, language: c.language, onboarding: {}, checklistPosition: 0, skills: [], availability: '', selfReportLabel: 'Self-reported, not verified', createdBy: by, updatedBy: by };
      return ok({ ...state, people: [...state.people, person] });
    }
    case 'select_person':
      return state.people.some((p) => p.id === c.personId) ? ok({ ...state, activePersonId: c.personId }) : fail('Unknown demo person.');
    case 'set_language': return isLanguage(c.language) ? editPerson({ language: c.language }) : fail('Choose a supported language.');
    case 'set_onboarding':
      if (!validId(c.guideId) || !Number.isInteger(c.stepIndex) || c.stepIndex < 0 || c.stepIndex > 3 || typeof c.completed !== 'boolean' || Object.keys(actor.onboarding).length >= 8 && !Object.hasOwn(actor.onboarding, c.guideId)) return fail('Choose a valid guide and step from 0 to 3.');
      return editPerson({ onboarding: { ...actor.onboarding, [c.guideId]: { stepIndex: c.stepIndex, completed: c.completed } } });
    case 'set_checklist_position':
      return Number.isInteger(c.position) && c.position >= 0 && c.position < scenario.checklist.length ? editPerson({ checklistPosition: c.position }) : fail('Unknown checklist position.');
    case 'set_volunteer_profile':
      return Array.isArray(c.skills) && c.skills.length <= 10 && new Set(c.skills).size === c.skills.length && c.skills.every((s) => validText(s, 80)) && validText(c.availability, 280, true) ? editPerson({ skills: [...c.skills], availability: c.availability }) : fail('Use short self-reported skills and availability.');
    case 'grant_delegation':
    case 'revoke_delegation': {
      if (!state.people.some((p) => p.id === c.personId && p.role === 'family_helper')) return fail('Delegation is only for a family helper.');
      const scopes = c.type === 'grant_delegation' ? c.scopes : [];
      if (!Array.isArray(scopes) || c.type === 'grant_delegation' && !scopes.length || new Set(scopes).size !== scopes.length || scopes.some((s) => !['checklist', 'confirm', 'requests'].includes(s))) return fail('Choose explicit checklist, confirm or requests grants.');
      return ok({ ...state, delegations: [...state.delegations.filter((d) => d.personId !== c.personId), { personId: c.personId, scopes: [...scopes], updatedBy: by }] });
    }
    case 'answer_checklist': {
      if (!Object.hasOwn(state.checklistAnswers, c.checklistItemId) || !isChecklistAnswer(c.answer)) return fail('Unknown checklist item or answer.');
      if (c.position !== undefined && (!Number.isInteger(c.position) || c.position !== scenario.checklist.findIndex((q) => q.id === c.checklistItemId))) return fail('Answer position does not match its question.');
      const next = { ...state, people: c.position === undefined ? state.people : state.people.map((p) => p.id === actor.id ? { ...p, checklistPosition: c.position!, updatedBy: by } : p), checklistAnswers: { ...state.checklistAnswers, [c.checklistItemId]: c.answer }, checklistAttribution: { ...state.checklistAttribution, [c.checklistItemId]: by }, confirmations: { ...state.confirmations }, confirmationAttribution: { ...state.confirmationAttribution } };
      for (const concern of scenario.concerns) if (!canConfirmConcern(scenario, next, concern.id)) { if (next.confirmations[concern.id]?.humanConfirmed) next.confirmationAttribution[concern.id] = by; next.confirmations[concern.id] = unconfirmed(); }
      return ok(next);
    }
    case 'confirm_concern':
    case 'unconfirm_concern': {
      const concern = scenario.concerns.find((concern) => concern.id === c.concernId);
      if (!concern) return fail('Unknown concern.');
      if (c.type === 'confirm_concern' && !canConfirmConcern(scenario, state, c.concernId)) return fail('Every backing checklist answer must be yes before confirmation.');
      const wasPlanned = computePlan(scenario, state).some((p) => p.referenceActionId === concern.referenceActionId);
      const next = { ...state, confirmationAttribution: { ...state.confirmationAttribution, [c.concernId]: by }, confirmations: { ...state.confirmations, [c.concernId]: c.type === 'unconfirm_concern' ? unconfirmed() : { humanConfirmed: true as const, actorId: actor.id, confirmedBy: attributionLabel(state, actor.id), confirmedAt: c.at } } };
      if (c.type === 'confirm_concern' && !wasPlanned) next.actionEpisodes = { ...state.actionEpisodes, [concern.referenceActionId]: (state.actionEpisodes[concern.referenceActionId] ?? 0) + 1 };
      return ok(next);
    }
    case 'select_profile':
      return scenario.profiles.some((p) => p.id === c.profileId) ? ok({ ...state, profileId: c.profileId, profileAttribution: by }) : fail('Unknown fictional profile.');
    case 'add_photo': {
      if (!validId(c.photoId) || [...state.photos, ...state.removedPhotos].some((p) => p.id === c.photoId) || state.photos.length >= MAX_HOUSEHOLD_PHOTOS) return fail('Choose a unique photo ID; at most 64 photos can be kept.');
      if (!scenario.checklist.some((i) => i.id === c.checklistItemId) || ![c.width, c.height].every((n) => Number.isInteger(n) && n >= 1 && n <= 1600)) return fail('A photo needs a known question and dimensions up to 1600 pixels.');
      return ok({ ...state, photos: [...state.photos, { id: c.photoId, checklistItemId: c.checklistItemId, addedBy: actor.id, addedAt: c.at, width: c.width, height: c.height }] });
    }
    case 'remove_photo': {
      const photo = state.photos.find((p) => p.id === c.photoId);
      if (!photo || !resident && photo.addedBy !== actor.id) return fail('Only the resident or photo contributor can remove this photo.', 'permission_denied');
      return ok({ ...state, photos: state.photos.filter((p) => p.id !== c.photoId), removedPhotos: [...state.removedPhotos, { ...photo, removedBy: by }].slice(-MAX_REMOVED_PHOTO_HISTORY), removedPhotoHistoryTruncated: state.removedPhotoHistoryTruncated || state.removedPhotos.length >= MAX_REMOVED_PHOTO_HISTORY });
    }
    case 'create_request': {
      if (c.expectedRevision !== 0) return fail('This draft is stale. Refresh before trying again.');
      if (!computePlan(scenario, state).some((p) => p.referenceActionId === c.referenceActionId)) return fail('Requests require an active confirmed plan action.');
      if (currentRequestForAction(state, c.referenceActionId)) return fail('A retained request already exists for this action.');
      if (state.requests.length >= 64) return fail('This device has reached its retained request limit.', 'storage_capacity');
      const request: HelpRequest = { id: nextRequestId(state, c.referenceActionId), referenceActionId: c.referenceActionId, episode: state.actionEpisodes[c.referenceActionId]!, professionalReferral: null, status: 'draft', revision: 1, volunteerId: null, sharing: noSharing(), visitTimes: '', areaLabel: '', scanLocation: null, proposedTime: null, agreedTime: null, updates: [], reportedDone: null, confirmedDone: null, createdBy: by, updatedBy: by, history: [{ ...by, type: c.type, text: null }], legacyHistory: null, independentVerification: 'not available in this demo' };
      return ok({ ...state, requests: [...state.requests, request] });
    }
  }
  if (!('requestId' in c)) return fail('Unknown workflow command.');
  const r = state.requests.find((request) => request.id === c.requestId);
  if (!r) return fail('Unknown help request.');
  if (r.updatedBy.at !== null && c.at < r.updatedBy.at) return fail('The request timestamp is older than its last change.');
  if (!Number.isInteger(c.expectedRevision) || c.expectedRevision !== r.revision) return fail('This request changed. Refresh it before trying again.', 'stale_revision');
  const active = getRequestViews(scenario, state).find((v) => v.request.id === r.id)?.active;
  if (!active && !['revoke_shared_field', 'cancel_request', 'cancel_invitation', 'withdraw'].includes(c.type)) return fail('This request is inactive history. Confirm its plan action before updating it.');
  if (volunteerTypes.has(c.type) && (r.volunteerId !== actor.id || !liveAssignment(r))) return fail('This invitation or assignment is no longer available to you.', 'permission_denied');
  const inStatus = (...statuses: HelpRequest['status'][]) => statuses.includes(r.status);
  let patch: Partial<HelpRequest> = {};
  let text: string | null = null;
  let privacyReduction = false;
  const clearAssignment = { volunteerId: null, sharing: noSharing(), proposedTime: null, agreedTime: null, updates: [], reportedDone: null, confirmedDone: null };
  switch (c.type) {
    case 'record_referral':
    case 'contact_referral':
    case 'close_referral': {
      const action = scenario.referenceActions.find((a) => a.id === r.referenceActionId)!;
      if (action.effort !== 'professional') return fail('This action does not use professional referrals.');
      const stages = { record_referral: null, contact_referral: 'recorded', close_referral: 'contacted' };
      if (r.status !== 'draft' || r.professionalReferral !== stages[c.type]) return fail('Refresh the professional referral before updating it.', 'stale_revision');
      patch = { professionalReferral: c.type === 'record_referral' ? 'recorded' : c.type === 'contact_referral' ? 'contacted' : 'closed' }; break;
    }
    case 'set_sharing':
      if (!inStatus('draft', 'declined', 'invited', 'accepted', 'scheduled', 'in_progress', 'volunteer_reported_done')) return fail('Sharing cannot be edited at this stage.');
      if (!c.sharing || Object.keys(c.sharing).length !== sharingFields.length || sharingFields.some((f) => typeof c.sharing[f] !== 'boolean') || !validText(c.visitTimes, 280, true) || !validText(c.areaLabel, 80, true) || c.scanLocation !== null && !validId(c.scanLocation)) return fail('Choose supported sharing fields and short fictional visit and area notes.');
      if (sharingFields.every((f) => c.sharing[f] === r.sharing[f]) && c.visitTimes === r.visitTimes && c.areaLabel === r.areaLabel && c.scanLocation === r.scanLocation) return ok(state);
      privacyReduction = sharingFields.every((f) => !c.sharing[f] || r.sharing[f]) && sharingFields.some((f) => r.sharing[f] && !c.sharing[f]);
      patch = { sharing: { ...c.sharing }, visitTimes: c.visitTimes, areaLabel: c.areaLabel, scanLocation: c.scanLocation }; break;
    case 'revoke_shared_field':
      if (!sharingFields.includes(c.field)) return fail('Unknown shared field.');
      if (!r.sharing[c.field]) return ok(state);
      privacyReduction = true;
      patch = { sharing: { ...r.sharing, [c.field]: false } }; break;
    case 'invite_volunteer': {
      if (!inStatus('draft', 'declined') || r.volunteerId !== null) return fail('Cancel the existing invitation before inviting someone else.');
      const action = scenario.referenceActions.find((a) => a.id === r.referenceActionId)!;
      if (action.effort === 'professional' || action.helpRouting.kind !== 'family_review') return fail('Find a qualified professional. Volunteers do not do electrical, structural, plumbing or grab-bar installation work.');
      if (!state.people.some((p) => p.id === c.volunteerId && p.role === 'volunteer')) return fail('Choose a demo volunteer. Skills are self-reported, not verified.');
      text = c.volunteerId; patch = { status: 'invited', volunteerId: c.volunteerId }; break;
    }
    case 'accept_invitation':
      if (!inStatus('invited')) return fail('Only a current invitation can be accepted once.');
      patch = { status: 'accepted' }; break;
    case 'decline_invitation':
      if (!inStatus('invited') || !validText(c.reason, 280, true)) return fail('Only a current invitation can be declined with a short reason.');
      text = c.reason; patch = { ...clearAssignment, status: 'declined' }; break;
    case 'propose_time':
      if (!inStatus('accepted') || !validText(c.text, 280)) return fail('Accept the invitation before proposing a short visit time.');
      if (r.proposedTime?.text === c.text) return ok(state);
      text = c.text; patch = { proposedTime: { ...by, text } }; break;
    case 'agree_time':
      if (!inStatus('accepted') || !r.proposedTime) return fail('A volunteer must propose a time before you agree.');
      patch = { status: 'scheduled', agreedTime: { ...by, text: r.proposedTime.text } }; break;
    case 'post_update':
      if (!inStatus('scheduled', 'in_progress') || !validText(c.text, 280)) return fail('Agree a visit time first; updates must be 1–280 characters.');
      if (r.updates.at(-1)?.text === c.text) return ok(state);
      if (r.updates.length >= 40) return fail('This demo request has reached its 40-update limit.', 'storage_capacity');
      text = c.text; patch = { status: 'in_progress', updates: [...r.updates, { ...by, text }] }; break;
    case 'report_done':
      if (!inStatus('in_progress')) return fail('Post a progress update before reporting completion.');
      patch = { status: 'volunteer_reported_done', reportedDone: by }; break;
    case 'confirm_done':
      if (!inStatus('volunteer_reported_done')) return fail('Review a volunteer completion report first.');
      patch = { status: 'resident_confirmed_done', confirmedDone: by }; break;
    case 'not_done_yet':
      if (!inStatus('volunteer_reported_done')) return fail('Review a volunteer completion report first.');
      patch = { status: 'in_progress', reportedDone: null, confirmedDone: null }; break;
    case 'withdraw': patch = { ...clearAssignment, status: 'draft' }; break;
    case 'cancel_invitation':
      if (!liveAssignment(r)) return fail('There is no open invitation or assignment to cancel.');
      patch = { ...clearAssignment, status: 'draft' }; break;
    case 'cancel_request':
      if (inStatus('cancelled', 'resident_confirmed_done') || r.professionalReferral === 'closed') return fail('This request is already closed.');
      patch = { ...clearAssignment, status: 'cancelled' }; break;
    default: return fail('Unknown workflow command.');
  }
  // These transitions only reduce sharing or close an assignment/request. They
  // consume the bounded reserve that ordinary edits cannot use. Identical
  // revocations return above, so the reserve cannot be filled with no-ops.
  const exit = ['decline_invitation', 'withdraw', 'cancel_invitation', 'cancel_request', 'confirm_done', 'not_done_yet', 'close_referral'].includes(c.type);
  if (r.history.length >= REQUEST_HISTORY_LIMIT && !privacyReduction && !exit) return fail('This demo request has reached its history limit.', 'storage_capacity');
  const updated: HelpRequest = { ...r, ...patch, revision: r.revision + 1, updatedBy: by, history: [...r.history, { ...by, type: c.type, text }] };
  return ok({ ...state, requests: state.requests.map((item) => item.id === r.id ? updated : item) });
}

export { visibleRequestsFor, visibleHouseholdFor, elderNextStep, helperNextStep, volunteerNextStep } from './role-views';
