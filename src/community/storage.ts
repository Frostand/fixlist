import { isLanguage, LANGUAGE_CODES } from '../domain/roles';
import { canManageElder } from './commands';
import { createSeedState } from './seed';
import * as valid from './validation';
import type { ChatMessage, CommunityState, Job, JobStatus } from './types';

export const COMMUNITY_STORAGE_KEY = 'fixlist.community.v1';
function validHistory(state: CommunityState, job: Job): boolean {
  const first = job.timeline[0]!;
  if (first.type !== 'posted' || first.actorId !== job.createdById || first.at !== job.createdAt || !canManageElder(state, job.createdById, job.elderId)) return false;
  let status: JobStatus = 'open', rated = false, lastTime = Date.parse(job.createdAt), accepted = false;
  for (const event of job.timeline.slice(1)) {
    const time = Date.parse(event.at);
    if (time < lastTime || !state.accounts.some((a) => a.id === event.actorId)) return false;
    lastTime = time;
    const assigned = event.actorId === job.volunteerId && state.volunteers.some((v) => v.accountId === event.actorId);
    switch (event.type) {
      case 'accepted':
        if (status !== 'open' || !assigned || !job.scheduledFor || Date.parse(job.scheduledFor) < time) return false;
        accepted = true; status = 'accepted'; break;
      case 'on-the-way': if (status !== 'accepted' || !assigned) return false; status = 'on-the-way'; break;
      case 'arrived': if (status !== 'on-the-way' || !assigned) return false; status = 'arrived'; break;
      case 'reported-done': if (!['accepted', 'on-the-way', 'arrived'].includes(status) || !assigned) return false; status = 'reported-done'; break;
      case 'confirmed': if (status !== 'reported-done' || !canManageElder(state, event.actorId, job.elderId)) return false; status = 'completed'; break;
      case 'rated':
        if (status !== 'completed' || rated || !canManageElder(state, event.actorId, job.elderId) || !job.rating
          || job.rating.byId !== event.actorId || job.rating.at !== event.at) return false;
        rated = true; break;
      case 'cancelled': if (status === 'completed' || status === 'cancelled' || !canManageElder(state, event.actorId, job.elderId)) return false; status = 'cancelled'; break;
      default: return false;
    }
  }
  return status === job.status && (accepted ? job.volunteerId !== null && job.scheduledFor !== null : job.volunteerId === null && job.scheduledFor === null)
    && (status === 'completed' ? job.hoursCredited === valid.creditHours(job.analysis.estimatedMinutes) : job.hoursCredited === null)
    && rated === (job.rating !== null);
}
function message(value: unknown): value is ChatMessage {
  return valid.shape(value, ['id', 'jobId', 'fromId', 'at', 'text', 'language', 'translations']) && valid.id(value.id) && valid.id(value.jobId) && valid.id(value.fromId)
    && valid.iso(value.at) && valid.text(value.text) && isLanguage(value.language) && valid.shape(value.translations, [], LANGUAGE_CODES)
    && Object.values(value.translations).every((translation) => valid.text(translation));
}
/** Validate shapes and cross-record permissions; no state is trusted merely because it parsed as JSON. */
export function validateCommunityState(value: unknown): value is CommunityState {
  try {
    if (!valid.shape(value, ['version', 'session', 'accounts', 'elders', 'volunteers', 'families', 'jobs', 'messages']) || value.version !== 1
      || !valid.shape(value.session, ['accountId', 'onboarded']) || !(value.session.accountId === null || valid.id(value.session.accountId)) || !valid.ids(value.session.onboarded)
      || !valid.list(value.accounts, valid.account) || !valid.list(value.elders, valid.elder) || !valid.list(value.volunteers, valid.volunteer) || !valid.list(value.families, valid.family)
      || !valid.list(value.jobs, valid.job) || !valid.list(value.messages, message)) return false;
    const state = value as unknown as CommunityState;
    const accountIds = state.accounts.map((a) => a.id);
    if (!valid.unique([...accountIds, ...state.jobs.map((j) => j.id), ...state.messages.map((m) => m.id)])
      || !valid.unique(state.elders.map((e) => e.accountId)) || !valid.unique(state.volunteers.map((v) => v.accountId)) || !valid.unique(state.families.map((f) => f.accountId))
      || state.session.accountId !== null && !accountIds.includes(state.session.accountId) || !state.session.onboarded.every((i) => accountIds.includes(i))) return false;
    if (!state.accounts.every((a) => (state.elders.some((e) => e.accountId === a.id) ? a.role === 'elder' : a.role !== 'elder')
      && (state.volunteers.some((v) => v.accountId === a.id) ? a.role === 'volunteer' : a.role !== 'volunteer')
      && (state.families.some((f) => f.accountId === a.id) ? a.role === 'family' : a.role !== 'family'))) return false;
    if (!state.elders.every((e) => state.accounts.some((a) => a.id === e.accountId && a.role === 'elder')
      && e.familyIds.every((i) => state.families.some((f) => f.accountId === i && f.elderIds.includes(e.accountId))))
      || !state.volunteers.every((v) => state.accounts.some((a) => a.id === v.accountId && a.role === 'volunteer'))
      || !state.families.every((f) => state.accounts.some((a) => a.id === f.accountId && a.role === 'family')
        && f.elderIds.every((i) => state.elders.some((e) => e.accountId === i && e.familyIds.includes(f.accountId))))) return false;
    if (!state.jobs.every((j) => state.elders.some((e) => e.accountId === j.elderId) && validHistory(state, j))) return false;
    return state.messages.every((m) => {
      const job = state.jobs.find((j) => j.id === m.jobId);
      return !!job && accountIds.includes(m.fromId) && Date.parse(m.at) >= Date.parse(job.createdAt)
        && (canManageElder(state, m.fromId, job.elderId) || m.fromId === job.volunteerId);
    });
  } catch { return false; }
}
export function loadCommunity(storage: Storage | null, now: string): { state: CommunityState; status: 'loaded' | 'seeded' | 'recovered' } {
  if (!storage) return { state: createSeedState(now), status: 'seeded' };
  try {
    const raw = storage.getItem(COMMUNITY_STORAGE_KEY);
    if (raw === null) return { state: createSeedState(now), status: 'seeded' };
    const value: unknown = JSON.parse(raw);
    return validateCommunityState(value) ? { state: value, status: 'loaded' } : { state: createSeedState(now), status: 'recovered' };
  } catch { return { state: createSeedState(now), status: 'recovered' }; }
}
export function saveCommunity(storage: Storage | null, state: CommunityState): boolean {
  try {
    if (!storage || !validateCommunityState(state)) return false;
    storage.setItem(COMMUNITY_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch { return false; }
}
export function resetCommunity(storage: Storage | null, now: string): CommunityState {
  const state = createSeedState(now);
  try { storage?.removeItem(COMMUNITY_STORAGE_KEY); } catch { /* The caller still receives a fresh in-memory demo. */ }
  return state;
}
