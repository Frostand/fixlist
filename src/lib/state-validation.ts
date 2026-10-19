import type { DemoScenario, HumanConfirmation } from '../domain/types';
import type { Attribution, HelpRequest, Person } from '../domain/roles';
import { MAX_HOUSEHOLD_PHOTOS, MAX_REMOVED_PHOTO_HISTORY, MAX_REQUEST_HISTORY, remainingPrivacyEvents, sharingFields } from '../domain/roles';
import { attributionLabel, canConfirmConcern, createInitialState, isChecklistAnswer, isIsoTimestamp, requestIdForAction, validId, validText, type DemoState } from '../domain/workflow';
import { demoPeople, LEGACY_ACTOR_ID, LEGACY_LABEL } from '../data/demo-people';

function reject(message: string): never { throw new Error(message); }
function obj(v: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return reject('Expected a plain data record.');
  const keys = Reflect.ownKeys(v);
  if (keys.length !== fields.length || keys.some((k) => typeof k !== 'string' || !fields.includes(k))) return reject('Missing or unknown state fields.');
  const out: Record<string, unknown> = Object.create(null);
  for (const k of fields) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !('value' in d) || !d.enumerable) return reject('State must contain enumerable data fields.');
    out[k] = d.value;
  }
  return out;
}
function arr(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || v.length > max || Reflect.ownKeys(v).length !== v.length + 1) return reject('Expected a bounded dense array.');
  return Array.from({ length: v.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (!d || !('value' in d) || !d.enumerable) return reject('Arrays must contain data fields.');
    return d.value;
  });
}
function text(v: unknown, max: number, empty = false): string { return validText(v, max, empty) ? v : reject('Unsupported text in saved state.'); }
function id(v: unknown): string { return validId(v) ? v : reject('Unsupported ID in saved state.'); }
function iso(v: unknown): string { return isIsoTimestamp(v) ? v : reject('A canonical timestamp is required.'); }
function int(v: unknown, min: number, max: number): number { return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : reject('Number is outside its supported bounds.'); }
function bool(v: unknown): boolean { return typeof v === 'boolean' ? v : reject('Expected a boolean.'); }
function one<T extends string>(v: unknown, values: readonly T[]): T { return typeof v === 'string' && values.includes(v as T) ? v as T : reject('Unsupported saved value.'); }
function unique<T>(values: T[], key: (v: T) => string): T[] { if (new Set(values.map(key)).size !== values.length) reject('Duplicate saved ID.'); return values; }
const attrKeys = ['actorId', 'at'];
const personKeys = ['id', 'name', 'role', 'fictional', 'language', 'onboarding', 'checklistPosition', 'skills', 'availability', 'selfReportLabel', 'createdBy', 'updatedBy'];
/** Schema 4 is accepted only by its explicit migration entry point. Validate all history before trimming. */
export function reconstructState(value: unknown, scenario: DemoScenario, version: 4 | 5 = 5): DemoState {
  const initial = createInitialState(scenario);
  const root = obj(value, Object.keys(initial).filter((key) => version !== 4 || key !== 'removedPhotoHistoryTruncated'));
  if (root.schemaVersion !== version || root.scenarioId !== scenario.id) reject('Unsupported demo version or scenario.');
  // IDs/roles first, before validating cross-record attribution. Fixture identities are immutable.
  const rawPeople = arr(root.people, 20).map((p) => obj(p, personKeys));
  const identities = unique(rawPeople.map((p) => ({ id: id(p.id), role: one(p.role, ['resident', 'family_helper', 'volunteer']) })), (p) => p.id);
  if (identities.some((p) => p.id === LEGACY_ACTOR_ID)) reject('Legacy attribution is not a demo account.');
  const household = obj(root.household, ['id', 'residentId']);
  if (household.id !== 'maple-house' || household.residentId !== 'margaret' || identities.filter((p) => p.role === 'resident').length !== 1 || !identities.some((p) => p.id === household.residentId && p.role === 'resident')) reject('Maple House must have exactly its one resident.');
  for (const fixture of demoPeople) if (!rawPeople.some((p) => p.id === fixture.id && p.role === fixture.role && p.name === fixture.name)) reject('Fixed demo identities cannot be changed or removed.');
  const personRole = (actor: unknown) => identities.find((p) => p.id === actor)?.role;
  function attribution(v: unknown, roles?: readonly Person['role'][]): Attribution {
    const a = obj(v, attrKeys);
    const role = personRole(a.actorId);
    if (!role || roles && !roles.includes(role)) return reject('Unknown actor or role in attribution.');
    return { actorId: a.actorId as string, at: iso(a.at) };
  }
  const people: Person[] = rawPeople.map((p) => {
    const guideKeys = p.onboarding && typeof p.onboarding === 'object' ? Reflect.ownKeys(p.onboarding).map((k) => id(k)) : reject('Invalid onboarding.');
    if (guideKeys.length > 8) reject('Too many setup guides.');
    const guides = obj(p.onboarding, guideKeys);
    const onboarding = Object.fromEntries(guideKeys.map((k) => { const g = obj(guides[k], ['stepIndex', 'completed']); return [k, { stepIndex: int(g.stepIndex, 0, 3), completed: bool(g.completed) }]; }));
    if (p.fictional !== true || p.selfReportLabel !== 'Self-reported, not verified') reject('Demo profiles must retain their fictional and unverified labels.');
    return { id: id(p.id), name: text(p.name, 40), role: one(p.role, ['resident', 'family_helper', 'volunteer']), fictional: true, language: one(p.language, ['en', 'es']), onboarding, checklistPosition: int(p.checklistPosition, 0, scenario.checklist.length - 1), skills: unique(arr(p.skills, 10).map((s) => text(s, 80)), (s) => s), availability: text(p.availability, 280, true), selfReportLabel: 'Self-reported, not verified', createdBy: attribution(p.createdBy), updatedBy: attribution(p.updatedBy) };
  });
  const activePersonId = id(root.activePersonId);
  if (!personRole(activePersonId)) reject('Unknown active person.');
  const checklistRaw = obj(root.checklistAnswers, scenario.checklist.map((c) => c.id));
  const checklistAnswers = Object.fromEntries(Object.entries(checklistRaw).map(([k, v]) => [k, isChecklistAnswer(v) ? v : reject('Unsupported checklist answer.')]));
  const checklistBy = obj(root.checklistAttribution, scenario.checklist.map((c) => c.id));
  const checklistAttribution = Object.fromEntries(Object.entries(checklistBy).map(([k, v]) => [k, v === null ? null : attribution(v, ['resident', 'family_helper'])]));
  const confirmationBy = obj(root.confirmationAttribution, scenario.concerns.map((c) => c.id));
  const confirmationAttribution = Object.fromEntries(Object.entries(confirmationBy).map(([k, v]) => [k, v === null ? null : attribution(v, ['resident', 'family_helper'])]));
  const rawConfirmations = obj(root.confirmations, scenario.concerns.map((c) => c.id));
  const confirmations: Record<string, HumanConfirmation> = {};
  for (const [k, v] of Object.entries(rawConfirmations)) {
    const human = v && typeof v === 'object' ? Object.getOwnPropertyDescriptor(v, 'humanConfirmed')?.value : null;
    const c = obj(v, human === true ? ['humanConfirmed', 'actorId', 'confirmedBy', 'confirmedAt'] : ['humanConfirmed', 'confirmedBy', 'confirmedAt']);
    if (human === false && c.confirmedBy === null && c.confirmedAt === null) confirmations[k] = { humanConfirmed: false, confirmedBy: null, confirmedAt: null };
    else if (human === true && (personRole(c.actorId) === 'resident' || personRole(c.actorId) === 'family_helper' || c.actorId === LEGACY_ACTOR_ID)) {
      const label = c.actorId === LEGACY_ACTOR_ID ? LEGACY_LABEL : attributionLabel({ ...initial, people }, c.actorId as string);
      if (c.confirmedBy !== label) reject('Confirmation label does not match its actor.');
      confirmations[k] = { humanConfirmed: true, actorId: c.actorId as string, confirmedBy: label, confirmedAt: iso(c.confirmedAt) };
    } else reject('Invalid confirmation.');
  }
  const profileId = id(root.profileId);
  if (!scenario.profiles.some((p) => p.id === profileId)) reject('Unknown fictional profile.');
  const profileAttribution = root.profileAttribution === null ? null : attribution(root.profileAttribution, ['resident']);
  const delegations = unique(arr(root.delegations, 19).map((v) => {
    const d = obj(v, ['personId', 'scopes', 'updatedBy']);
    if (personRole(d.personId) !== 'family_helper') reject('Only family helpers can hold grants.');
    return { personId: id(d.personId), scopes: unique(arr(d.scopes, 3).map((s) => one(s, ['checklist', 'confirm', 'requests'] as const)), (s) => s), updatedBy: attribution(d.updatedBy, ['resident']) };
  }), (d) => d.personId);
  const photos = unique(arr(root.photos, MAX_HOUSEHOLD_PHOTOS).map((v) => {
    const p = obj(v, ['id', 'checklistItemId', 'addedBy', 'addedAt', 'width', 'height']);
    if (!scenario.checklist.some((c) => c.id === p.checklistItemId) || !['resident', 'family_helper'].includes(personRole(p.addedBy) ?? '')) reject('Invalid photo owner or checklist item.');
    return { id: id(p.id), checklistItemId: id(p.checklistItemId), addedBy: id(p.addedBy), addedAt: iso(p.addedAt), width: int(p.width, 1, 1600), height: int(p.height, 1, 1600) };
  }), (p) => p.id);
  const episodeRaw = obj(root.actionEpisodes, scenario.referenceActions.map((a) => a.id));
  const actionEpisodes = Object.fromEntries(Object.entries(episodeRaw).map(([k, v]) => [k, int(v, 0, 1000000)]));
  const removedPhotos = unique(arr(root.removedPhotos, version === 4 ? 64 : MAX_REMOVED_PHOTO_HISTORY).map((v) => {
    const p = obj(v, ['id', 'checklistItemId', 'addedBy', 'addedAt', 'width', 'height', 'removedBy']);
    if (!scenario.checklist.some((c) => c.id === p.checklistItemId) || !['resident', 'family_helper'].includes(personRole(p.addedBy) ?? '')) reject('Invalid removed photo attribution.');
    const removedBy = attribution(p.removedBy, ['resident', 'family_helper']);
    if (removedBy.actorId !== household.residentId && removedBy.actorId !== p.addedBy) reject('Invalid photo removal authority.');
    return { id: id(p.id), checklistItemId: id(p.checklistItemId), addedBy: id(p.addedBy), addedAt: iso(p.addedAt), width: int(p.width, 1, 1600), height: int(p.height, 1, 1600), removedBy };
  }), (p) => p.id);
  if ((version === 4 && photos.length + removedPhotos.length > 64) || photos.some((p) => removedPhotos.some((r) => p.id === r.id))) reject('Invalid photo attribution history.');
  const removedPhotoHistoryTruncated = version === 4 ? removedPhotos.length > MAX_REMOVED_PHOTO_HISTORY : bool(root.removedPhotoHistoryTruncated);
  const actionCounts = new Map<string, number>();
  const requestKeys = ['id', 'referenceActionId', 'episode', 'professionalReferral', 'status', 'revision', 'volunteerId', 'sharing', 'visitTimes', 'areaLabel', 'scanLocation', 'proposedTime', 'agreedTime', 'updates', 'reportedDone', 'confirmedDone', 'createdBy', 'updatedBy', 'history', 'legacyHistory', 'independentVerification'];
  const requests = unique(arr(root.requests, 64).map((v): HelpRequest => {
    const r = obj(v, requestKeys);
    const action = scenario.referenceActions.find((a) => a.id === r.referenceActionId);
    if (!action) return reject('Unknown request/action ID.');
    const ordinal = (actionCounts.get(action.id) ?? 0) + 1; actionCounts.set(action.id, ordinal);
    if (r.id !== (ordinal === 1 ? requestIdForAction(action.id) : `${requestIdForAction(action.id)}-${ordinal}`)) reject('Unknown or mismatched request/action ID.');
    const episode = int(r.episode, 1, actionEpisodes[action.id]!);
    const status = one(r.status, ['draft', 'invited', 'declined', 'accepted', 'scheduled', 'in_progress', 'volunteer_reported_done', 'resident_confirmed_done', 'cancelled']);
    const volunteerId = r.volunteerId === null ? null : id(r.volunteerId);
    const assigned = !['draft', 'declined', 'cancelled'].includes(status);
    if (assigned !== (volunteerId !== null) || volunteerId && personRole(volunteerId) !== 'volunteer' || assigned && (action.effort === 'professional' || action.helpRouting.kind !== 'family_review')) reject('Invalid volunteer assignment.');
    const professionalReferral = r.professionalReferral === null ? null : one(r.professionalReferral, ['recorded', 'contacted', 'closed']);
    if (professionalReferral && (action.effort !== 'professional' || !['draft', 'cancelled'].includes(status))) reject('Invalid professional referral.');
    const rawSharing = obj(r.sharing, sharingFields);
    const sharing = Object.fromEntries(sharingFields.map((k) => [k, bool(rawSharing[k])])) as HelpRequest['sharing'];
    function timed(v: unknown, role: Person['role']): (Attribution & { text: string }) | null {
      if (v === null) return null;
      const t = obj(v, ['actorId', 'at', 'text']);
      const a = attribution({ actorId: t.actorId, at: t.at }, [role]);
      if (role === 'volunteer' && a.actorId !== volunteerId) reject('Task records must belong to its assigned volunteer.');
      return { ...a, text: text(t.text, 280) };
    }
    const proposedTime = timed(r.proposedTime, 'volunteer');
    const agreedTime = timed(r.agreedTime, 'resident');
    const updates = arr(r.updates, 40).map((u) => timed(u, 'volunteer') ?? reject('Missing update.'));
    const reportedDone = r.reportedDone === null ? null : attribution(r.reportedDone, ['volunteer']);
    const confirmedDone = r.confirmedDone === null ? null : attribution(r.confirmedDone, ['resident']);
    if (reportedDone && reportedDone.actorId !== volunteerId) reject('Wrong completion reporter.');
    const scheduled = ['scheduled', 'in_progress', 'volunteer_reported_done', 'resident_confirmed_done'].includes(status);
    if (scheduled !== (agreedTime !== null) || agreedTime && (!proposedTime || agreedTime.text !== proposedTime.text) || proposedTime && !assigned) reject('Invalid visit proposal/agreement.');
    if (['in_progress', 'volunteer_reported_done', 'resident_confirmed_done'].includes(status) && updates.length === 0 || !scheduled && updates.length > 0) reject('Invalid progress records.');
    if ((status === 'volunteer_reported_done' || status === 'resident_confirmed_done') !== (reportedDone !== null) || (status === 'resident_confirmed_done') !== (confirmedDone !== null)) reject('Invalid completion state.');
    let legacyHistory: HelpRequest['legacyHistory'] = null;
    if (r.legacyHistory !== null) {
      const l = obj(r.legacyHistory, ['label', 'status', 'completion', 'note']);
      if (l.label !== LEGACY_LABEL || l.note !== 'Inactive history only; no volunteer invitation, acceptance or repair verification was inferred.') reject('Invalid legacy history label.');
      const comp = obj(l.completion, ['status', 'reportedBy', 'reportedAt']);
      const legacyStatus = one(l.status, ['draft', 'family_reported_requested', 'family_reported_in_progress']);
      const completion: NonNullable<HelpRequest['legacyHistory']>['completion'] = comp.status === 'unconfirmed' && comp.reportedBy === null && comp.reportedAt === null ? { status: 'unconfirmed', reportedBy: null, reportedAt: null }
        : comp.status === 'family_reported_complete' && legacyStatus !== 'draft' && comp.reportedBy === LEGACY_LABEL ? { status: 'family_reported_complete', reportedBy: LEGACY_LABEL, reportedAt: iso(comp.reportedAt) } : reject('Invalid retained legacy completion.');
      legacyHistory = { label: LEGACY_LABEL, status: legacyStatus, completion, note: l.note as NonNullable<HelpRequest['legacyHistory']>['note'] };
    }
    function requestAttribution(v: unknown): HelpRequest['createdBy'] {
      const a = obj(v, attrKeys);
      return a.actorId === LEGACY_ACTOR_ID && a.at === null && legacyHistory ? { actorId: LEGACY_ACTOR_ID, at: null } : attribution(v, ['resident', 'family_helper']);
    }
    const createdBy = requestAttribution(r.createdBy);
    const updatedBy = r.updatedBy && typeof r.updatedBy === 'object' && Object.getOwnPropertyDescriptor(r.updatedBy, 'actorId')?.value === LEGACY_ACTOR_ID ? requestAttribution(r.updatedBy) : attribution(r.updatedBy);
    const residentEvents = ['record_referral', 'contact_referral', 'close_referral', 'set_sharing', 'revoke_shared_field', 'invite_volunteer', 'agree_time', 'confirm_done', 'not_done_yet', 'cancel_invitation', 'cancel_request'];
    const volunteerEvents = ['accept_invitation', 'decline_invitation', 'propose_time', 'post_update', 'report_done', 'withdraw'];
    const history = arr(r.history, MAX_REQUEST_HISTORY).map((v) => {
      const h = obj(v, ['actorId', 'at', 'type', 'text']);
      const type = one(h.type, ['create_request', ...residentEvents, ...volunteerEvents]);
      const a = attribution({ actorId: h.actorId, at: h.at }, residentEvents.includes(type) ? ['resident'] : volunteerEvents.includes(type) ? ['volunteer'] : ['resident', 'family_helper']);
      return { ...a, type, text: h.text === null ? null : text(h.text, 280, true) };
    });
    let stage = 'draft';
    let currentVolunteer: string | null = null;
    let hasProposal = false;
    let referralStage: HelpRequest['professionalReferral'] = null;
    let replayProposal: HelpRequest['proposedTime'] = null, replayAgreement: HelpRequest['agreedTime'] = null;
    let replayUpdates: HelpRequest['updates'] = [];
    let replayReported: Attribution | null = null, replayConfirmed: Attribution | null = null;
    let previousTime = createdBy.at;

    for (const [index, event] of history.entries()) {
      if (previousTime !== null && event.at < previousTime) reject('Request events run backwards in time.');
      previousTime = event.at;
      if (event.type === 'create_request') {
        if (index !== 0 || legacyHistory || event.at !== createdBy.at || event.actorId !== createdBy.actorId) reject('Creation must match the first new-request event.');
        continue;
      }
      const by = { actorId: event.actorId, at: event.at };
      if (['propose_time', 'post_update'].includes(event.type) && !validText(event.text, 280)) reject('A work event needs its original text.');
      if (event.type === 'propose_time') replayProposal = { ...by, text: event.text! };
      if (event.type === 'agree_time') replayAgreement = { ...by, text: replayProposal?.text ?? '' };
      if (event.type === 'post_update') replayUpdates = [...replayUpdates, { ...by, text: event.text! }];
      if (event.type === 'report_done') replayReported = by;
      if (event.type === 'confirm_done') replayConfirmed = by;
      if (event.type === 'not_done_yet') { replayReported = null; replayConfirmed = null; }
      if (['withdraw', 'cancel_invitation', 'decline_invitation', 'cancel_request'].includes(event.type)) {
        replayProposal = null; replayAgreement = null; replayUpdates = []; replayReported = null; replayConfirmed = null;
      }
      const permitted: Record<string, readonly string[]> = {
        record_referral: ['draft'], contact_referral: ['draft'], close_referral: ['draft'],
        set_sharing: ['draft', 'declined', 'invited', 'accepted', 'scheduled', 'in_progress', 'volunteer_reported_done'],
        revoke_shared_field: ['draft', 'invited', 'declined', 'accepted', 'scheduled', 'in_progress', 'volunteer_reported_done', 'resident_confirmed_done', 'cancelled'],
        invite_volunteer: ['draft', 'declined'], accept_invitation: ['invited'], decline_invitation: ['invited'], propose_time: ['accepted'], agree_time: ['accepted'], post_update: ['scheduled', 'in_progress'], report_done: ['in_progress'], confirm_done: ['volunteer_reported_done'], not_done_yet: ['volunteer_reported_done'], withdraw: ['invited', 'accepted', 'scheduled', 'in_progress', 'volunteer_reported_done'], cancel_invitation: ['invited', 'accepted', 'scheduled', 'in_progress', 'volunteer_reported_done'], cancel_request: ['draft', 'invited', 'declined', 'accepted', 'scheduled', 'in_progress', 'volunteer_reported_done'],
      };
      if (!permitted[event.type]?.includes(stage)) reject('Illegal request transition in history.');
      if (volunteerEvents.includes(event.type) && event.actorId !== currentVolunteer) reject('History actor is not the invited volunteer.');
      if (event.type === 'invite_volunteer') { if (personRole(event.text) !== 'volunteer') reject('Unknown invitation target.'); currentVolunteer = event.text; stage = 'invited'; }
      if (['record_referral', 'contact_referral', 'close_referral'].includes(event.type)) {
        if (action.effort !== 'professional') reject('A nonprofessional action cannot record a professional referral.');
        if (referralStage !== (event.type === 'record_referral' ? null : event.type === 'contact_referral' ? 'recorded' : 'contacted')) reject('Illegal professional referral transition.');
        referralStage = event.type === 'record_referral' ? 'recorded' : event.type === 'contact_referral' ? 'contacted' : 'closed';
      }
      if (event.type === 'accept_invitation') stage = 'accepted';
      if (event.type === 'propose_time') hasProposal = true;
      if (event.type === 'agree_time') { if (!hasProposal) reject('Agreement lacks a proposal.'); stage = 'scheduled'; }
      if (event.type === 'post_update') stage = 'in_progress';
      if (event.type === 'report_done') stage = 'volunteer_reported_done';
      if (event.type === 'confirm_done') stage = 'resident_confirmed_done';
      if (event.type === 'not_done_yet') stage = 'in_progress';
      if (['withdraw', 'cancel_invitation', 'decline_invitation', 'cancel_request'].includes(event.type)) { currentVolunteer = null; hasProposal = false; stage = event.type === 'decline_invitation' ? 'declined' : event.type === 'cancel_request' ? 'cancelled' : 'draft'; }
    }
    // History is authoritative for proposals, progress and completion aggregates.
    for (const [actual, replayed] of [[proposedTime, replayProposal], [agreedTime, replayAgreement], [updates, replayUpdates], [reportedDone, replayReported], [confirmedDone, replayConfirmed]]) {
      if (JSON.stringify(actual) !== JSON.stringify(replayed)) reject('Request records disagree with their authoritative events.');
    }
    if (professionalReferral !== referralStage || stage !== status || currentVolunteer !== volunteerId) reject('Request status or volunteer disagrees with history.');
    // Even a loaded state must retain capacity for all remaining revocations
    // and exits; a full live request with shared fields is not valid state.
    if (history.length + remainingPrivacyEvents({ status, sharing }) > MAX_REQUEST_HISTORY) reject('Request history lacks its privacy reserve.');
    const revision = int(r.revision, 1, MAX_REQUEST_HISTORY + 1);
    if (revision !== history.length + (legacyHistory ? 1 : 0) || !legacyHistory && history[0]?.type !== 'create_request') reject('Request revision/history mismatch.');
    const last = history.at(-1);
    if (!last && (updatedBy.actorId !== createdBy.actorId || updatedBy.at !== createdBy.at)) reject('An unchanged legacy request cannot have new attribution.');
    if (last && (last.actorId !== updatedBy.actorId || last.at !== updatedBy.at)) reject('Latest request attribution is inconsistent.');
    if (r.independentVerification !== 'not available in this demo') reject('Independent verification is unavailable.');
    return { id: r.id as string, referenceActionId: action.id, episode, professionalReferral, status, revision, volunteerId, sharing, visitTimes: text(r.visitTimes, 280, true), areaLabel: text(r.areaLabel, 80, true), scanLocation: r.scanLocation === null ? null : id(r.scanLocation), proposedTime, agreedTime, updates, reportedDone, confirmedDone, createdBy, updatedBy, history, legacyHistory, independentVerification: 'not available in this demo' };
  }), (r) => r.id);
  const state: DemoState = { schemaVersion: 5, actionEpisodes, removedPhotos: removedPhotos.slice(-MAX_REMOVED_PHOTO_HISTORY), removedPhotoHistoryTruncated, scenarioId: scenario.id, checklistAnswers, checklistAttribution, confirmationAttribution, confirmations, profileId, profileAttribution, requests, people, household: { id: 'maple-house', residentId: household.residentId as string }, delegations, photos, activePersonId };
  for (const concern of scenario.concerns) if (confirmations[concern.id]?.humanConfirmed && !canConfirmConcern(scenario, state, concern.id)) reject('Confirmed concern lacks its required yes answers.');
  return state;
}
