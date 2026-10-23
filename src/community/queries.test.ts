import { describe, expect, it } from 'vitest';
import { accountsByRole, currentAccount, jobsForElder, jobsForVolunteer, matchesForJob, matchesForVolunteer, serviceLog, visibleJob, volunteerStats } from './queries';
import { scoreMatch } from './matching';
import { createSeedState } from './seed';
import { quickPickAnalysis } from './task-rules';
import type { CommunityState, Job, VolunteerProfile } from './types';

const NOW = '2026-10-23T12:00:00.000Z', VOL = 'volunteer-jordan';
function matchFixture(): { state: CommunityState; job: Job; volunteer: VolunteerProfile } {
  const seed = createSeedState(NOW), job: Job = { ...seed.jobs[0]!, analysis: { ...quickPickAnalysis('light-bulb', 'en'), skills: ['general', 'electrical-basic'], tools: ['ladder', 'drill'] }, preferredSlots: [{ day: 6, part: 'morning' }] };
  const volunteer: VolunteerProfile = { ...seed.volunteers[0]!, skills: ['electrical-basic'], tools: ['ladder', 'drill'], availability: [{ day: 6, part: 'morning' }], maxMiles: 10 };
  const state: CommunityState = { ...seed, jobs: [job], accounts: seed.accounts.map((a) => ({ ...a, location: { lat: 34, lng: -84 }, language: a.id === job.elderId ? 'ko' : 'en' })), volunteers: [volunteer] };
  return { state, job, volunteer };
}
describe('explainable weighted matching', () => {
  it('awards 35 skills + 20 tools + 20 time + 15 distance + 7 unrated = 97', () => {
    const { state, job, volunteer } = matchFixture(), result = scoreMatch(state, job, volunteer, NOW);
    expect(result.score).toBe(97); expect(result.distanceMiles).toBe(0); expect(result.gaps).toEqual([]);
    expect(result.reasons).toEqual(expect.arrayContaining([{ kind: 'skill', skill: 'general' }, { kind: 'tool', tool: 'ladder' }, { kind: 'available', slot: { day: 6, part: 'morning' } }, { kind: 'distance', miles: 0 }]));
  });
  it('scores skill and tool fractions and always satisfies general', () => {
    const { state, job, volunteer } = matchFixture();
    const missingSkill = scoreMatch(state, job, { ...volunteer, skills: [] }, NOW);
    expect(missingSkill.score).toBe(80); expect(missingSkill.gaps).toContainEqual({ kind: 'missing-skill', skill: 'electrical-basic' });
    const missingTool = scoreMatch(state, job, { ...volunteer, tools: ['ladder'] }, NOW);
    expect(missingTool.score).toBe(87); expect(missingTool.gaps).toContainEqual({ kind: 'missing-tool', tool: 'drill' });
    expect(scoreMatch(state, { ...job, analysis: { ...job.analysis, tools: [], skills: [] } }, { ...volunteer, skills: [], tools: [] }, NOW).score).toBe(97);
  });
  it('requires a shared slot, while an unconstrained job accepts any actual availability', () => {
    const { state, job, volunteer } = matchFixture();
    expect(scoreMatch(state, job, { ...volunteer, availability: [{ day: 6, part: 'evening' }] }, NOW)).toMatchObject({ score: 77, gaps: [{ kind: 'no-shared-time' }], sharedSlots: [] });
    expect(scoreMatch(state, { ...job, preferredSlots: [] }, volunteer, NOW).score).toBe(97);
    expect(scoreMatch(state, { ...job, preferredSlots: [] }, { ...volunteer, availability: [] }, NOW).score).toBe(77);
  });
  it('uses the linear distance budget and handles a zero-mile radius', () => {
    const { state, job, volunteer } = matchFixture();
    const farther = { ...state, accounts: state.accounts.map((a) => a.id === VOL ? { ...a, location: { lat: 34.1, lng: -84 } } : a) };
    expect(scoreMatch(farther, job, volunteer, NOW)).toMatchObject({ distanceMiles: 6.9, score: 87 });
    const outside = scoreMatch(farther, job, { ...volunteer, maxMiles: 5 }, NOW);
    expect(outside.score).toBe(82); expect(outside.gaps).toContainEqual({ kind: 'too-far', miles: 6.9 });
    expect(scoreMatch(state, job, { ...volunteer, maxMiles: 0 }, NOW).score).toBe(97);
    expect(scoreMatch(farther, job, { ...volunteer, maxMiles: 0 }, NOW).score).toBe(82);
  });
  it('adds average ratings and the five-point language bonus, capped at 100', () => {
    const { state, job, volunteer } = matchFixture(), seed = createSeedState(NOW);
    // Keep the weight example at a known 4.5 average, independent of expanded demo history.
    const rated = { ...state, jobs: [...state.jobs, ...seed.jobs.filter((j) => ['job-past-margaret', 'job-past-rosa'].includes(j.id))] };
    expect(scoreMatch(rated, job, volunteer, NOW)).toMatchObject({ score: 99 });
    expect(scoreMatch(rated, job, volunteer, NOW).reasons).toContainEqual({ kind: 'rating', stars: 4.5 });
    const sharedLanguage = { ...rated, accounts: rated.accounts.map((a) => a.id === VOL ? { ...a, language: 'ko' as const } : a) };
    expect(scoreMatch(sharedLanguage, job, volunteer, NOW)).toMatchObject({ score: 100 });
    expect(scoreMatch(sharedLanguage, job, volunteer, NOW).reasons).toContainEqual({ kind: 'language', language: 'ko' });
  });
  it('ranks a fully equipped nearby volunteer above one missing tools, and only lists open jobs', () => {
    const { state, job, volunteer } = matchFixture(), lessEquipped = { ...volunteer, accountId: 'volunteer-marcus', tools: [] };
    const compare = { ...state, volunteers: [lessEquipped, volunteer] };
    expect(matchesForJob(compare, job.id, NOW).map((m) => m.volunteerId)).toEqual([VOL, 'volunteer-marcus']);
    const seed = createSeedState(NOW), matches = matchesForVolunteer(seed, VOL, NOW);
    expect(matches).toHaveLength(8); expect(matches.every((m) => seed.jobs.find((j) => j.id === m.jobId)!.status === 'open')).toBe(true);
    for (let i = 1; i < matches.length; i++) expect(matches[i - 1]!.score).toBeGreaterThanOrEqual(matches[i]!.score);
    expect(matchesForVolunteer(seed, 'missing', NOW)).toEqual([]); expect(matchesForJob(seed, 'missing', NOW)).toEqual([]);
  });
  it('breaks equal-score ties by nearest distance and does not mutate inputs', () => {
    const { state, job, volunteer } = matchFixture();
    const fartherJob = { ...job, id: 'job-z', elderId: 'elder-rosa' }, closerJob = { ...job, id: 'job-a' };
    const noRadius = { ...state, volunteers: [{ ...volunteer, maxMiles: 0 }], jobs: [fartherJob, closerJob], accounts: state.accounts.map((a) => ({ ...a, language: 'ko' as const, location: a.id === VOL ? { lat: 34, lng: -84 } : { lat: a.id === 'elder-rosa' ? 34.2 : 34.1, lng: -84 } })) };
    const before = JSON.stringify(noRadius), matches = matchesForVolunteer(noRadius, VOL, NOW);
    expect(matches[0]!.score).toBe(matches[1]!.score); expect(matches[0]!.jobId).toBe('job-a'); expect(JSON.stringify(noRadius)).toBe(before);
  });
});

describe('community queries and privacy', () => {
  it('gets current profiles, role lists and jobs without reordering the state', () => {
    const state = createSeedState(NOW), before = JSON.stringify(state);
    expect(currentAccount(state)).toBeNull(); expect(currentAccount({ ...state, session: { ...state.session, accountId: VOL } })?.id).toBe(VOL);
    expect(accountsByRole(state, 'elder')).toHaveLength(6); expect(accountsByRole(state, 'family')).toHaveLength(1);
    const jobs = jobsForElder(state, 'elder-soonja'); expect(jobs).toHaveLength(8);
    expect(jobs.map((j) => Date.parse(j.createdAt))).toEqual(jobs.map((j) => Date.parse(j.createdAt)).sort((a, b) => b - a));
    expect(jobsForVolunteer(state, VOL)).toHaveLength(6); expect(jobsForVolunteer(state, 'volunteer-ethan')).toHaveLength(2);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('reveals an address only to the elder, linked family and assigned volunteer', () => {
    const state = createSeedState(NOW), jobId = 'job-past-margaret';
    for (const viewerId of ['elder-margaret', 'family-alex', VOL]) expect(visibleJob(state, jobId, viewerId)?.address).toBe('Oak Hollow Ct area (fictional)');
    for (const viewerId of ['volunteer-marcus', 'elder-rosa', 'volunteer-priya']) {
      const view = visibleJob(state, jobId, viewerId)!;
      expect(view.address).toBeNull(); expect(view.elder.area).toBe('Cumming, GA'); expect(JSON.stringify(view)).not.toContain('Oak Hollow');
    }
    expect(visibleJob(state, 'job-open-soonja-bulb', VOL)?.address).toBeNull();
    expect(visibleJob(state, jobId, 'missing')).toBeNull(); expect(visibleJob(state, 'missing', VOL)).toBeNull();
    const revoked = { ...state, families: [{ accountId: 'family-alex', elderIds: [] }] };
    expect(visibleJob(revoked, jobId, 'family-alex')?.address).toBeNull();
  });
  it('counts confirmed jobs only and emits an English service log with confirmation dates', () => {
    const state = createSeedState(NOW), jordan = volunteerStats(state, VOL), marcus = volunteerStats(state, 'volunteer-marcus');
    expect(jordan).toEqual({ rating: 29 / 6, ratingCount: 6, jobsDone: 6, hours: 9.5 });
    expect(marcus.ratingCount).toBe(9); expect(marcus.hours).toBe(15);
    expect(volunteerStats(state, 'volunteer-ethan')).toEqual({ rating: 5, ratingCount: 1, jobsDone: 1, hours: 1.75 });
    expect(volunteerStats(state, 'missing')).toEqual({ rating: null, ratingCount: 0, jobsDone: 0, hours: 0 });
    const log = serviceLog(state, VOL); expect(log).toHaveLength(6);
    expect(log.slice(0, 2).map((row) => [row.title, row.hours])).toEqual([['Add plug-in night lights along the hallway', 0.5], ['Tighten the loose stair handrail', 0.75]]);
    expect(log.every((row) => row.confirmedAt && !row.elderFirstName.includes(' '))).toBe(true);
    expect(log[0]!.confirmedAt > log[1]!.confirmedAt).toBe(true);
    expect(serviceLog(state, 'volunteer-ethan')).toHaveLength(1); expect(serviceLog(state, 'missing')).toEqual([]);
  });
});
