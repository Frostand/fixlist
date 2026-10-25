import { locationForArea } from './geo';
import * as valid from './validation';
import type { CommunityFailure, CommunityResult, CommunityState, ElderProfileEdit, FamilyGrant, FamilyScope } from './types';

export const LEGACY_FAMILY_SCOPES: readonly FamilyScope[] = ['requests', 'capture', 'messages'];
export const FAMILY_SCOPES: readonly FamilyScope[] = [...LEGACY_FAMILY_SCOPES, 'profile'];
const failure = (message: string, code: CommunityFailure['code'] = 'permission_denied'): CommunityFailure => ({ ok: false, code, message });
/** UI callers surface the localized controller issue; this domain reason is diagnostic. */
export const familyScopeFailure = (): CommunityFailure => failure('Choose the elder again. This family permission changed.');
function familyActionDates(state: CommunityState, familyId: string, elderId: string): string[] {
  return [...state.jobs.filter(j => j.elderId === elderId).flatMap(j => j.timeline.filter(e => e.actorId === familyId).map(e => e.at)),
    ...state.messages.filter(m => m.fromId === familyId && state.jobs.some(j => j.id === m.jobId && j.elderId === elderId)).map(m => m.at)];
}
export function reciprocalFamilyLink(state: CommunityState, familyId: string, elderId: string): boolean {
  return state.accounts.some(a => a.id === familyId && a.role === 'family')
    && state.accounts.some(a => a.id === elderId && a.role === 'elder')
    && state.elders.some(e => e.accountId === elderId && e.familyIds.includes(familyId))
    && state.families.some(f => f.accountId === familyId && f.elderIds.includes(elderId));
}
/** No session authority: used only to inspect grant records, never as a view/mutation gate. */
export function familyGrant(state: CommunityState, familyId: string, elderId: string): FamilyGrant | null {
  if (!reciprocalFamilyLink(state, familyId, elderId)) return null;
  return state.familyHistory?.grants.find(g => g.familyId === familyId && g.elderId === elderId && g.revokedAt === null) ?? null;
}
/** Private views and commands share this current-session gate. */
export function canManageElder(state: CommunityState, actorId: string, elderId: string, scope: FamilyScope = 'requests', revision?: number): boolean {
  if (state.session.accountId !== actorId || !state.elders.some(e => e.accountId === elderId)) return false;
  const actor = state.accounts.find(a => a.id === actorId);
  if (actor?.role === 'elder') return actor.id === elderId;
  if (actor?.role !== 'family') return false;
  const grant = familyGrant(state, actorId, elderId);
  return !!grant && grant.scopes.includes(scope) && (revision === undefined || grant.revision === revision);
}
/** Mutations must carry the revision reviewed by the family actor; a new grant never revives old intent. */
export function canChangeElder(state: CommunityState, actorId: string, elderId: string, scope: FamilyScope = 'requests', revision?: number): boolean {
  return !(state.accounts.some(a => a.id === actorId && a.role === 'family') && revision === undefined)
    && canManageElder(state, actorId, elderId, scope, revision);
}
export function familyReceipt(state: CommunityState, actorId: string, elderId: string): { familyGrantRevision?: number } {
  const grant = familyGrant(state, actorId, elderId);
  return grant ? { familyGrantRevision: grant.revision } : {};
}
export function historicallyAuthorized(state: CommunityState, actorId: string, elderId: string, at: string, revision?: number, scope: FamilyScope = 'requests'): boolean {
  if (actorId === elderId) return state.accounts.some(a => a.id === elderId && a.role === 'elder') && revision === undefined;
  if (!state.familyHistory) return reciprocalFamilyLink(state, actorId, elderId) && revision === undefined;
  const grant = state.familyHistory.grants.find(g => g.familyId === actorId && g.elderId === elderId && g.revision === revision);
  return !!grant && grant.scopes.includes(scope) && Date.parse(at) >= Date.parse(grant.approvedAt)
    && (grant.revokedAt === null || Date.parse(at) <= Date.parse(grant.revokedAt));
}
/** Called only after the legacy snapshot has passed its original shape/history checks. No writes. */
export function migrateFamilyHistory(state: CommunityState): CommunityState {
  if (state.familyHistory) return state;
  const grants: FamilyGrant[] = [];
  for (const family of state.families) for (const elderId of family.elderIds) {
    if (!reciprocalFamilyLink(state, family.accountId, elderId)) continue;
    const dates = [state.accounts.find(a => a.id === family.accountId)!.createdAt,
      ...state.jobs.filter(j => j.elderId === elderId).flatMap(j => j.timeline.filter(e => e.actorId === family.accountId).map(e => e.at)),
      ...state.messages.filter(m => m.fromId === family.accountId && state.jobs.some(j => j.id === m.jobId && j.elderId === elderId)).map(m => m.at)];
    grants.push({ familyId: family.accountId, elderId, revision: grants.length + 1, scopes: [...LEGACY_FAMILY_SCOPES], approvedById: elderId,
      approvedAt: dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0]!, revokedAt: null, revokedById: null, origin: 'legacy-link' });
  }
  const receipt = (actorId: string, elderId: string) => {
    const grant = grants.find(g => g.familyId === actorId && g.elderId === elderId);
    return grant ? { familyGrantRevision: grant.revision } : {};
  };
  return { ...state, familyHistory: { grants, legacyConfirmations: state.jobs.flatMap(j => j.timeline.filter(e => e.type === 'confirmed' && e.actorId !== j.elderId).map(e => ({ jobId: j.id, familyId: e.actorId, at: e.at }))) },
    jobs: state.jobs.map(j => ({ ...j, timeline: j.timeline.map(e => ({ ...e, ...receipt(e.actorId, j.elderId) })) })),
    messages: state.messages.map(m => ({ ...m, ...receipt(m.fromId, state.jobs.find(j => j.id === m.jobId)!.elderId) })) };
}
/** Only the signed-in elder can approve scopes. Picker/setup values cannot call this on their behalf. */
export function approveFamilyGrant(state: CommunityState, input: { elderId: string; familyId: string; scopes: readonly FamilyScope[]; expectedRevision: number | null }, now: string): CommunityResult {
  if (state.session.accountId !== input.elderId || !state.accounts.some(a => a.id === input.elderId && a.role === 'elder')) return failure('The elder must approve from their own selected profile.');
  if (!state.families.some(f => f.accountId === input.familyId)) return failure('Family profile not found.', 'not_found');
  if (!valid.iso(now) || !valid.list(input.scopes, (s): s is FamilyScope => valid.oneOf(s, FAMILY_SCOPES), 4)
    || !valid.unique(input.scopes) || !LEGACY_FAMILY_SCOPES.every(s => input.scopes.includes(s))) return failure('Choose the request, capture and message permissions; information editing is optional.', 'invalid_input');
  state = migrateFamilyHistory(state);
  const history = state.familyHistory!;
  const previous = history.grants.filter(g => g.elderId === input.elderId && g.familyId === input.familyId);
  if (input.expectedRevision !== (previous.at(-1)?.revision ?? null)) return failure('Consent changed. Review it before approving again.');
  if (previous.some(g => Date.parse(now) < Date.parse(g.revokedAt ?? g.approvedAt)) || familyActionDates(state, input.familyId, input.elderId).some(at => Date.parse(now) < Date.parse(at))) return failure('Consent cannot predate its history.', 'invalid_input');
  const revision = Math.max(0, ...history.grants.map(g => g.revision)) + 1;
  if (!Number.isSafeInteger(revision)) return failure('Consent revision limit reached.', 'invalid_state');
  const grant: FamilyGrant = { familyId: input.familyId, elderId: input.elderId, scopes: [...input.scopes], revision, approvedById: input.elderId, approvedAt: now, revokedAt: null, revokedById: null, origin: 'elder-approved' };
  return { ok: true, state: { ...state,
    elders: state.elders.map(e => e.accountId === input.elderId ? { ...e, familyIds: [...new Set([...e.familyIds, input.familyId])] } : e),
    families: state.families.map(f => f.accountId === input.familyId ? { ...f, elderIds: [...new Set([...f.elderIds, input.elderId])] } : f),
    familyHistory: { ...history, grants: [...history.grants.map(g => g.elderId === input.elderId && g.familyId === input.familyId && g.revokedAt === null ? { ...g, revokedAt: now, revokedById: input.elderId } : g), grant] } } };
}
export function revokeFamilyGrant(state: CommunityState, input: { actorId: string; elderId: string; familyId: string; revision: number }, now: string): CommunityResult {
  const grant = familyGrant(state, input.familyId, input.elderId);
  if (state.session.accountId !== input.actorId || ![input.elderId, input.familyId].includes(input.actorId) || !grant || grant.revision !== input.revision) return failure('This consent changed. Review it before removing access.');
  const latestAction = [...familyActionDates(state, input.familyId, input.elderId), grant.approvedAt];
  if (!valid.iso(now) || latestAction.some(at => Date.parse(now) < Date.parse(at))) return failure('Removal cannot predate consent or recorded actions.', 'invalid_input');
  return { ok: true, state: { ...state,
    elders: state.elders.map(e => e.accountId === input.elderId ? { ...e, familyIds: e.familyIds.filter(id => id !== input.familyId) } : e),
    families: state.families.map(f => f.accountId === input.familyId ? { ...f, elderIds: f.elderIds.filter(id => id !== input.elderId) } : f),
    familyHistory: { ...state.familyHistory!, grants: state.familyHistory!.grants.map(g => g.revision === grant.revision ? { ...g, revokedAt: now, revokedById: input.actorId } : g) } } };
}
export function updateElderInformation(state: CommunityState, input: { actorId: string; elderId: string; revision?: number; profile: ElderProfileEdit }): CommunityResult {
  if (!canChangeElder(state, input.actorId, input.elderId, 'profile', input.revision)) return failure('The elder must approve information editing first.');
  const p = input.profile;
  if (!valid.shape(p, ['name', 'area', 'needs', 'addressHint', 'visitInstructions', 'preferences']) || !valid.text(p.name, 120) || !valid.text(p.area, 160)
    || !valid.list(p.needs, (n): n is string => valid.text(n, 200), 30) || !valid.unique(p.needs.map(n => n.trim()))
    || !valid.text(p.addressHint, 240, true) || !valid.text(p.visitInstructions, 1000, true) || !valid.elderPreferences(p.preferences)) return failure('Check the name, area, needs and visit preferences.', 'invalid_input');
  return { ok: true, state: { ...state,
    accounts: state.accounts.map(a => a.id === input.elderId ? { ...a, name: p.name.trim(), firstName: p.name.trim().split(/\s+/u)[0]!, area: p.area.trim(), location: locationForArea(p.area.trim()) } : a),
    elders: state.elders.map(e => e.accountId === input.elderId ? { ...e, needs: p.needs.map(n => n.trim()), addressHint: p.addressHint.trim(), visitInstructions: p.visitInstructions.trim(), preferences: structuredClone(p.preferences) } : e) } };
}
