import { distanceMiles } from './geo';
import type { CommunityState, Job, MatchGap, MatchReason, MatchResult, VolunteerProfile } from './types';

export function scoreMatch(state: CommunityState, job: Job, volunteer: VolunteerProfile, _now: string): MatchResult {
  const elder = state.accounts.find((a) => a.id === job.elderId);
  const account = state.accounts.find((a) => a.id === volunteer.accountId);
  const miles = elder && account ? distanceMiles(elder.location, account.location) : Infinity;
  const reasons: MatchReason[] = [], gaps: MatchGap[] = [];
  const requiredSkills = [...new Set(job.analysis.skills)], requiredTools = [...new Set(job.analysis.tools)];
  const skills = requiredSkills.filter((skill) => {
    if (skill === 'general' || volunteer.skills.includes(skill)) { reasons.push({ kind: 'skill', skill }); return true; }
    gaps.push({ kind: 'missing-skill', skill }); return false;
  });
  const tools = requiredTools.filter((tool) => {
    if (volunteer.tools.includes(tool)) { reasons.push({ kind: 'tool', tool }); return true; }
    gaps.push({ kind: 'missing-tool', tool }); return false;
  });
  const sharedSlots = volunteer.availability.filter((slot) => job.preferredSlots.length === 0
    || job.preferredSlots.some((preferred) => preferred.day === slot.day && preferred.part === slot.part));
  if (sharedSlots.length) sharedSlots.forEach((slot) => reasons.push({ kind: 'available', slot: { ...slot } }));
  else gaps.push({ kind: 'no-shared-time' });
  const withinRange = Number.isFinite(miles) && miles <= volunteer.maxMiles;
  if (withinRange) reasons.push({ kind: 'distance', miles });
  else gaps.push({ kind: 'too-far', miles });
  const ratings = state.jobs.filter((j) => j.volunteerId === volunteer.accountId && j.status === 'completed' && j.rating !== null).map((j) => j.rating!.stars);
  const rating = ratings.length ? ratings.reduce((sum, stars) => sum + stars, 0) / ratings.length : null;
  if (rating !== null) reasons.push({ kind: 'rating', stars: rating });
  const sameLanguage = !!elder && !!account && elder.language === account.language;
  if (sameLanguage) reasons.push({ kind: 'language', language: elder.language });
  const score = 35 * (requiredSkills.length ? skills.length / requiredSkills.length : 1)
    + 20 * (requiredTools.length ? tools.length / requiredTools.length : 1)
    + (sharedSlots.length ? 20 : 0)
    + (withinRange ? volunteer.maxMiles === 0 ? 15 : 15 * (1 - miles / volunteer.maxMiles) : 0)
    + (rating === null ? 7 : rating / 5 * 10) + (sameLanguage ? 5 : 0);
  return { jobId: job.id, volunteerId: volunteer.accountId, score: Math.max(0, Math.min(100, Math.round(score))), distanceMiles: miles, reasons, gaps, sharedSlots: sharedSlots.map((slot) => ({ ...slot })) };
}
