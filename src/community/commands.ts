import { isLanguage } from '../domain/roles';
import { locationForArea } from './geo';
import * as valid from './validation';
import type { Account, CommunityFailure, CommunityResult, CommunityState, Job, JobAnalysis, JobEventType, JobSource, Language, ScanEvidence, SignInProvider, VolunteerProfile, AccountRole, AvailabilitySlot } from './types';

const fail = (code: CommunityFailure['code'], message: string): CommunityFailure => ({ ok: false, code, message });
const success = (state: CommunityState): CommunityResult => ({ ok: true, state });
const active = (state: CommunityState, actorId: string): boolean => state.session.accountId === actorId && state.accounts.some((a) => a.id === actorId);
const nextId = (prefix: string, ids: readonly string[]): string => {
  let number = 1;
  while (ids.includes(`${prefix}-${number}`)) number++;
  return `${prefix}-${number}`;
};
/** Both sides of a family link must agree; a lone stale profile never grants access. */
export function canManageElder(state: CommunityState, actorId: string, elderId: string): boolean {
  const actor = state.accounts.find((a) => a.id === actorId), elder = state.elders.find((e) => e.accountId === elderId);
  return !!elder && (actor?.role === 'elder' && actor.id === elderId || actor?.role === 'family'
    && elder.familyIds.includes(actorId) && state.families.some((f) => f.accountId === actorId && f.elderIds.includes(elderId)));
}
export function signIn(state: CommunityState, accountId: string): CommunityResult {
  return state.accounts.some((a) => a.id === accountId) ? success({ ...state, session: { ...state.session, accountId } }) : fail('not_found', 'Demo profile not found.');
}
export function signOut(state: CommunityState): CommunityResult { return success({ ...state, session: { ...state.session, accountId: null } }); }
export function completeOnboarding(state: CommunityState, accountId: string): CommunityResult {
  if (!state.accounts.some((a) => a.id === accountId)) return fail('not_found', 'Demo profile not found.');
  if (!active(state, accountId)) return fail('permission_denied', 'Choose your own demo profile first.');
  return success({ ...state, session: { ...state.session, onboarded: [...new Set([...state.session.onboarded, accountId])] } });
}
export function createAccount(state: CommunityState, input: { role: AccountRole; name: string; language: Language; provider: SignInProvider; area: string }, now: string): ({ ok: true; state: CommunityState; accountId: string } | CommunityFailure) {
  if (!valid.oneOf(input.role, ['elder', 'volunteer', 'family']) || !valid.text(input.name, 120) || !isLanguage(input.language)
    || !valid.oneOf(input.provider, ['apple', 'google', 'email']) || !valid.text(input.area, 160) || !valid.iso(now)) return fail('invalid_input', 'Enter a name, language and area.');
  const accountId = nextId('account', state.accounts.map((a) => a.id));
  const name = input.name.trim(), area = input.area.trim();
  const account: Account = { id: accountId, role: input.role, name, firstName: name.split(/\s+/u)[0]!, avatarTone: 'sage', language: input.language, provider: input.provider, area, location: locationForArea(area), createdAt: now };
  return { ok: true, accountId, state: { ...state, accounts: [...state.accounts, account], session: { ...state.session, accountId },
    elders: input.role === 'elder' ? [...state.elders, { accountId, needs: [], addressHint: '', familyIds: [] }] : state.elders,
    volunteers: input.role === 'volunteer' ? [...state.volunteers, { accountId, skills: [], tools: [], availability: [], maxMiles: 10, bio: '', badges: { idChecked: false, backgroundCheck: false } }] : state.volunteers,
    families: input.role === 'family' ? [...state.families, { accountId, elderIds: [] }] : state.families } };
}
export function updateLanguage(state: CommunityState, accountId: string, language: Language): CommunityResult {
  if (!state.accounts.some((a) => a.id === accountId)) return fail('not_found', 'Demo profile not found.');
  if (!active(state, accountId)) return fail('permission_denied', 'Only your own language can be changed.');
  if (!isLanguage(language)) return fail('invalid_input', 'Choose a supported language.');
  return success({ ...state, accounts: state.accounts.map((a) => a.id === accountId ? { ...a, language } : a) });
}
export function updateVolunteerProfile(state: CommunityState, accountId: string, patch: Partial<Omit<VolunteerProfile, 'accountId'>>): CommunityResult {
  const profile = state.volunteers.find((v) => v.accountId === accountId);
  if (!profile) return fail('not_found', 'Volunteer profile not found.');
  if (!active(state, accountId)) return fail('permission_denied', 'Only your own volunteer profile can be changed.');
  if (!valid.shape(patch, [], ['skills', 'tools', 'availability', 'maxMiles', 'school', 'bio', 'badges'])) return fail('invalid_input', 'Invalid volunteer profile.');
  const next = { ...profile, ...patch };
  if (!valid.volunteer(next)) return fail('invalid_input', 'Check the skills, tools, distance and availability.');
  // Badges describe demo records, not checks a person can award themselves.
  if (patch.badges && (patch.badges.idChecked !== profile.badges.idChecked || patch.badges.backgroundCheck !== profile.badges.backgroundCheck)) return fail('permission_denied', 'Verification badges cannot be self-awarded.');
  return success({ ...state, volunteers: state.volunteers.map((v) => v.accountId === accountId ? structuredClone(next) : v) });
}
export function postJob(state: CommunityState, input: { actorId: string; elderId: string; source: JobSource; originalText: string; analysis: JobAnalysis; evidence?: readonly ScanEvidence[]; preferredSlots?: readonly AvailabilitySlot[]; repeatEveryDays?: number | null }, now: string): ({ ok: true; state: CommunityState; jobId: string } | CommunityFailure) {
  if (!state.elders.some((e) => e.accountId === input.elderId)) return fail('not_found', 'Elder profile not found.');
  if (!active(state, input.actorId) || !canManageElder(state, input.actorId, input.elderId)) return fail('permission_denied', 'Only the elder or a linked family member can post this request.');
  const jobId = nextId('job', state.jobs.map((j) => j.id));
  const job: Job = { id: jobId, elderId: input.elderId, createdById: input.actorId, createdAt: now, source: input.source, originalText: input.originalText.trim(), analysis: input.analysis,
    evidence: input.evidence ?? [], preferredSlots: input.preferredSlots ?? [], repeatEveryDays: input.repeatEveryDays ?? null,
    status: 'open', volunteerId: null, scheduledFor: null, timeline: [{ at: now, actorId: input.actorId, type: 'posted' }], rating: null, hoursCredited: null };
  if (!valid.job(job)) return fail('invalid_input', 'Check the request text, analysis, evidence and dates.');
  return { ok: true, state: { ...state, jobs: [...state.jobs, structuredClone(job)] }, jobId };
}
function changed(state: CommunityState, job: Job, actorId: string, type: JobEventType, now: string, patch: Partial<Job> = {}, note?: string): CommunityResult {
  const latest = job.timeline.at(-1)!;
  if (!valid.iso(now) || Date.parse(now) < Date.parse(latest.at)) return fail('invalid_input', 'The update time must follow the request history.');
  if (note !== undefined && !valid.text(note, 2000, true)) return fail('invalid_input', 'The note is too long or contains invalid characters.');
  const event = { at: now, actorId, type, ...(note?.trim() ? { note: note.trim() } : {}) };
  const next = { ...job, ...patch, timeline: [...job.timeline, event] };
  return success({ ...state, jobs: state.jobs.map((j) => j.id === job.id ? next : j) });
}
export function acceptJob(state: CommunityState, input: { jobId: string; volunteerId: string; scheduledFor: string }, now: string): CommunityResult {
  const job = state.jobs.find((j) => j.id === input.jobId);
  if (!job) return fail('not_found', 'Request not found.');
  if (!active(state, input.volunteerId) || !state.volunteers.some((v) => v.accountId === input.volunteerId)) return fail('permission_denied', 'Choose your volunteer profile first.');
  if (job.status !== 'open' || job.volunteerId !== null) return fail('invalid_state', 'This request is no longer open.');
  if (!valid.iso(input.scheduledFor) || !valid.iso(now) || Date.parse(input.scheduledFor) < Date.parse(now)) return fail('invalid_input', 'Choose a present or future visit time.');
  return changed(state, job, input.volunteerId, 'accepted', now, { status: 'accepted', volunteerId: input.volunteerId, scheduledFor: input.scheduledFor });
}
function volunteerStep(state: CommunityState, input: { jobId: string; volunteerId: string; note?: string }, now: string, allowed: readonly Job['status'][], status: 'on-the-way' | 'arrived' | 'reported-done'): CommunityResult {
  const job = state.jobs.find((j) => j.id === input.jobId);
  if (!job) return fail('not_found', 'Request not found.');
  if (!active(state, input.volunteerId) || job.volunteerId !== input.volunteerId || !state.volunteers.some((v) => v.accountId === input.volunteerId)) return fail('permission_denied', 'Only the assigned volunteer can make this update.');
  if (!allowed.includes(job.status)) return fail('invalid_state', 'This update does not follow the current request status.');
  return changed(state, job, input.volunteerId, status, now, { status }, input.note);
}
export function startTrip(state: CommunityState, input: { jobId: string; volunteerId: string }, now: string): CommunityResult { return volunteerStep(state, input, now, ['accepted'], 'on-the-way'); }
export function arrive(state: CommunityState, input: { jobId: string; volunteerId: string }, now: string): CommunityResult { return volunteerStep(state, input, now, ['on-the-way'], 'arrived'); }
export function reportDone(state: CommunityState, input: { jobId: string; volunteerId: string; note?: string }, now: string): CommunityResult { return volunteerStep(state, input, now, ['accepted', 'on-the-way', 'arrived'], 'reported-done'); }
function elderJob(state: CommunityState, jobId: string, actorId: string): Job | CommunityFailure {
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) return fail('not_found', 'Request not found.');
  return active(state, actorId) && canManageElder(state, actorId, job.elderId) ? job : fail('permission_denied', 'Only the elder or a linked family member can make this update.');
}
export function confirmDone(state: CommunityState, input: { jobId: string; actorId: string }, now: string): CommunityResult {
  const job = elderJob(state, input.jobId, input.actorId);
  if ('ok' in job) return job;
  if (job.status !== 'reported-done') return fail('invalid_state', 'The volunteer must report completion first.');
  return changed(state, job, input.actorId, 'confirmed', now, { status: 'completed', hoursCredited: valid.creditHours(job.analysis.estimatedMinutes) });
}
export function rateJob(state: CommunityState, input: { jobId: string; actorId: string; stars: number; note?: string }, now: string): CommunityResult {
  const job = elderJob(state, input.jobId, input.actorId);
  if ('ok' in job) return job;
  if (job.status !== 'completed' || job.rating !== null) return fail('invalid_state', 'Only a completed, unrated request can be rated.');
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) return fail('invalid_input', 'Choose one to five stars.');
  return changed(state, job, input.actorId, 'rated', now, { rating: { stars: input.stars as 1 | 2 | 3 | 4 | 5, byId: input.actorId, at: now, ...(input.note?.trim() ? { note: input.note.trim() } : {}) } }, input.note);
}
export function cancelJob(state: CommunityState, input: { jobId: string; actorId: string }, now: string): CommunityResult {
  const job = elderJob(state, input.jobId, input.actorId);
  if ('ok' in job) return job;
  if (job.status === 'completed' || job.status === 'cancelled') return fail('invalid_state', 'This request is already closed.');
  return changed(state, job, input.actorId, 'cancelled', now, { status: 'cancelled' });
}
export function sendMessage(state: CommunityState, input: { jobId: string; fromId: string; text: string; language: Language; translations?: Partial<Record<Language, string>> }, now: string): CommunityResult {
  const job = state.jobs.find((j) => j.id === input.jobId);
  if (!job) return fail('not_found', 'Request not found.');
  if (!active(state, input.fromId) || !(canManageElder(state, input.fromId, job.elderId) || job.volunteerId === input.fromId)) return fail('permission_denied', 'Only request participants can send a message.');
  if (!valid.text(input.text) || !isLanguage(input.language) || !valid.iso(now) || Date.parse(now) < Date.parse(job.createdAt)
    || (input.translations !== undefined && (!valid.shape(input.translations, [], ['en', 'es', 'zh', 'vi', 'ko', 'tl', 'ru', 'fr', 'ar']) || !Object.values(input.translations).every((t) => valid.text(t))))) return fail('invalid_input', 'Enter a message in a supported language.');
  const message = { id: nextId('message', state.messages.map((m) => m.id)), jobId: job.id, fromId: input.fromId, at: now, text: input.text.trim(), language: input.language, translations: { ...input.translations } };
  return success({ ...state, messages: [...state.messages, message] });
}
