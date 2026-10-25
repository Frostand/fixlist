import { canManageElder } from './commands';
import { scoreMatch } from './matching';
import type { Account, AccountRole, CommunityState, Job, MatchResult, VolunteerStats } from './types';

export function currentAccount(state: CommunityState): Account | null { return state.accounts.find((a) => a.id === state.session.accountId) ?? null; }
const matchOrder = (a: MatchResult, b: MatchResult) => b.score - a.score || a.distanceMiles - b.distanceMiles || a.jobId.localeCompare(b.jobId) || a.volunteerId.localeCompare(b.volunteerId);
export function matchesForVolunteer(state: CommunityState, volunteerId: string, now: string): MatchResult[] {
  const volunteer = state.volunteers.find((v) => v.accountId === volunteerId);
  return volunteer ? state.jobs.filter((j) => j.status === 'open').map((j) => scoreMatch(state, j, volunteer, now)).sort(matchOrder) : [];
}
export function matchesForJob(state: CommunityState, jobId: string, now: string): MatchResult[] {
  const job = state.jobs.find((j) => j.id === jobId);
  return job ? state.volunteers.map((v) => scoreMatch(state, job, v, now)).sort(matchOrder) : [];
}
export function jobsForElder(state: CommunityState, elderId: string): Job[] { if (!state.session.accountId || !canManageElder(state, state.session.accountId, elderId)) return []; return state.jobs.filter((j) => j.elderId === elderId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id)); }
export function jobsForVolunteer(state: CommunityState, volunteerId: string): Job[] { return state.jobs.filter((j) => j.volunteerId === volunteerId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id)); }
export function visibleJob(state: CommunityState, jobId: string, viewerId: string): { job: Job; elder: Account; address: string | null } | null {
  const job = state.jobs.find((j) => j.id === jobId), viewer = state.accounts.find((a) => a.id === viewerId);
  if (!job || !viewer || state.session.accountId !== viewerId) return null;
  const managed = canManageElder(state, viewerId, job.elderId);
  if (!managed && !(viewer.role === 'volunteer' && (job.status === 'open' || job.volunteerId === viewerId))) return null;
  const elder = state.accounts.find((a) => a.id === job.elderId && a.role === 'elder');
  if (!elder) return null;
  const canSeeAddress = canManageElder(state, viewerId, job.elderId) || viewer.role === 'volunteer' && job.volunteerId === viewerId;
  const address = canSeeAddress ? state.elders.find((e) => e.accountId === job.elderId)?.addressHint ?? null : null;
  return { job, elder, address: address || null };
}
export function volunteerStats(state: CommunityState, volunteerId: string): VolunteerStats {
  const completed = state.jobs.filter((j) => j.volunteerId === volunteerId && j.status === 'completed');
  const ratings = completed.flatMap((j) => j.rating ? [j.rating.stars] : []);
  return { rating: ratings.length ? ratings.reduce((sum, stars) => sum + stars, 0) / ratings.length : null, ratingCount: ratings.length,
    jobsDone: completed.length, hours: completed.reduce((sum, j) => sum + (j.hoursCredited ?? 0), 0) };
}
export function serviceLog(state: CommunityState, volunteerId: string): { jobId: string; date: string; title: string; elderFirstName: string; hours: number; confirmedAt: string }[] {
  return state.jobs.filter((j) => j.volunteerId === volunteerId && j.status === 'completed' && j.hoursCredited !== null).flatMap((j) => {
    const confirmed = j.timeline.find((e) => e.type === 'confirmed');
    const elder = state.accounts.find((a) => a.id === j.elderId);
    return confirmed && elder ? [{ jobId: j.id, date: j.scheduledFor ?? confirmed.at, title: j.analysis.titleEnglish, elderFirstName: elder.firstName, hours: j.hoursCredited!, confirmedAt: confirmed.at }] : [];
  }).sort((a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt) || a.jobId.localeCompare(b.jobId));
}
export function accountsByRole(state: CommunityState, role: AccountRole): Account[] { return state.accounts.filter((a) => a.role === role); }
