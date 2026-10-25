import { describe, expect, it } from 'vitest';
import { createSeedState } from './seed';
import { canManageElder, confirmDone, postJob, reportDone, signIn, acceptJob } from './commands';
import { revokeFamilyGrant } from './family';
import { visibleJob } from './queries';
import { validateCommunityState } from './storage';
import { quickPickAnalysis } from './task-rules';
import type { CommunityResult } from './types';
const NOW = '2026-10-24T12:00:00.000Z';
const E = 'elder-margaret', F = 'family-alex', V = 'volunteer-jordan';
function stateOf(r: CommunityResult) { if (!r.ok) throw new Error(r.message); return r.state; }
describe('family authorization regressions on community paths', () => {
  it('does not grant private access outside the current actor session', () => {
    expect(canManageElder(createSeedState(NOW), F, E)).toBe(false);
    expect(visibleJob(createSeedState(NOW), 'job-past-margaret', F)).toBeNull();
  });
  it('does not expose private job contents to an unlinked family', () => {
    const state = stateOf(signIn(createSeedState(NOW), F));
    const revoked = { ...state, families: [{ accountId: F, elderIds: [] }] };
    expect(visibleJob(revoked, 'job-past-margaret', F)).toBeNull();
  });
  it('keeps historical family posts valid after reciprocal unlink', () => {
    const state = stateOf(signIn(createSeedState(NOW), F));
    const posted = postJob(state, { actorId: F, elderId: E, familyRevision: 1, source: 'typed', originalText: 'Help with a bulb', analysis: quickPickAnalysis('light-bulb', 'en') }, NOW);
    if (!posted.ok) throw new Error(posted.message);
    const revoked = stateOf(revokeFamilyGrant(posted.state, { actorId: F, elderId: E, familyId: F, revision: 1 }, NOW));
    expect(validateCommunityState(revoked)).toBe(true);
    expect(revoked.jobs).toEqual(posted.state.jobs);
  });
  it('only lets the exact elder confirm once and creates no estimated service credit', () => {
    let state = stateOf(signIn(createSeedState(NOW), E));
    const posted = postJob(state, { actorId: E, elderId: E, source: 'typed', originalText: 'Help with a bulb', analysis: quickPickAnalysis('light-bulb', 'en') }, NOW);
    if (!posted.ok) throw new Error(posted.message);
    state = stateOf(acceptJob(stateOf(signIn(posted.state, V)), { jobId: posted.jobId, volunteerId: V, scheduledFor: NOW }, NOW));
    state = stateOf(reportDone(state, { jobId: posted.jobId, volunteerId: V }, NOW));
    expect(confirmDone(stateOf(signIn(state, F)), { jobId: posted.jobId, actorId: F }, NOW).ok).toBe(false);
    state = stateOf(confirmDone(stateOf(signIn(state, E)), { jobId: posted.jobId, actorId: E }, NOW));
    expect(state.jobs.at(-1)?.hoursCredited).toBeNull();
    expect(confirmDone(state, { jobId: posted.jobId, actorId: E }, NOW).ok).toBe(false);
    expect(validateCommunityState(state)).toBe(true);
  });
});
