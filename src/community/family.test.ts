import { describe, expect, it } from 'vitest';
import { approveFamilyGrant, canManageElder, familyGrant, LEGACY_FAMILY_SCOPES, revokeFamilyGrant, updateElderInformation } from './family';
import { cancelJob, completeOnboarding, postJob, rateJob, sendMessage, signIn } from './commands';
import { COMMUNITY_STORAGE_KEY, createCommunityStore, loadCommunitySnapshot, saveCommunity, validateCommunityState } from './storage';
import { createSeedState } from './seed';
import { quickPickAnalysis } from './task-rules';
import { jobsForElder, visibleJob } from './queries';
import type { CommunityResult, CommunityState, ElderProfileEdit } from './types';
const NOW = '2026-10-24T12:00:00.000Z', NEXT = '2026-10-24T13:00:00.000Z';
const E = 'elder-margaret', F = 'family-alex', V = 'volunteer-jordan';
function ok(r: CommunityResult) { expect(r.ok).toBe(true); if (!r.ok) throw new Error(r.message); expect(validateCommunityState(r.state)).toBe(true); return r.state; }
function as(state: CommunityState, id: string) { return ok(signIn(state, id)); }
class MemoryStorage implements Storage {
  values = new Map<string, string>(); fail = false;
  get length() { return this.values.size; }
  clear() { this.values.clear(); } key(i: number) { return [...this.values.keys()][i] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error('quota'); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const profile = (): ElderProfileEdit => ({ name: ' Margaret Lee ', area: ' Suwanee, GA ', needs: [' Uses a cane '], addressHint: ' Fictional porch ', visitInstructions: ' Please message before visiting. ', preferences: { contact: 'ask-first', visitTimes: [{ day: 2, part: 'morning' }], notes: 'Speak slowly.' } });
const post = (state: CommunityState, revision = 1) => postJob(state, { actorId: F, elderId: E, familyRevision: revision, source: 'typed', originalText: 'Please help with the light', analysis: quickPickAnalysis('light-bulb', 'en') }, NOW);

describe('durable family grants and information commands', () => {
  it('requires the exact signed-in elder to approve and never grants access from an informational setup choice', () => {
    const seed = createSeedState(NOW), input = { elderId: 'elder-rosa', familyId: F, scopes: LEGACY_FAMILY_SCOPES, expectedRevision: null };
    for (const id of [F, V, E]) expect(approveFamilyGrant(as(seed, id), input, NOW).ok).toBe(false);
    const state = ok(approveFamilyGrant(as(seed, 'elder-rosa'), input, NOW));
    expect(state.elders.find(e => e.accountId === 'elder-rosa')?.familyIds).toContain(F);
    expect(state.families[0]?.elderIds).toEqual([E, 'elder-rosa']);
    expect(canManageElder(state, F, 'elder-rosa')).toBe(false);
    expect(canManageElder(as(state, F), F, 'elder-rosa')).toBe(true);
    expect(canManageElder(as(state, F), F, 'elder-rosa', 'profile')).toBe(false);
    expect(approveFamilyGrant(as(state, 'elder-rosa'), { ...input, scopes: ['profile'] }, NEXT).ok).toBe(false);
  });
  it('separates current access from past authorization through unlink, relink and reload', () => {
    let state = as(createSeedState(NOW), F);
    const posted = post(state); if (!posted.ok) throw new Error(posted.message);
    state = ok(sendMessage(posted.state, { jobId: posted.jobId, fromId: F, familyRevision: 1, language: 'en', text: 'I am helping Margaret.' }, NOW));
    state = ok(cancelJob(state, { jobId: posted.jobId, actorId: F, familyRevision: 1 }, NOW));
    const jobs = state.jobs, messages = state.messages;
    state = ok(revokeFamilyGrant(state, { actorId: F, elderId: E, familyId: F, revision: 1 }, NOW));
    expect(state.jobs).toBe(jobs); expect(state.messages).toBe(messages);
    expect(visibleJob(state, posted.jobId, F)).toBeNull(); expect(jobsForElder(state, E)).toEqual([]);
    const storage = new MemoryStorage(); expect(saveCommunity(storage, state)).toBe(true);
    const loaded = loadCommunitySnapshot(storage, NOW); expect(loaded.status).toBe('loaded'); expect(loaded.state.jobs).toEqual(jobs); expect(loaded.state.messages).toEqual(messages);
    state = ok(approveFamilyGrant(as(loaded.state, E), { elderId: E, familyId: F, scopes: LEGACY_FAMILY_SCOPES, expectedRevision: 1 }, NEXT));
    state = as(state, F);
    expect(familyGrant(state, F, E)?.revision).toBe(2);
    expect(post(state, 1).ok).toBe(false);
    expect(sendMessage(state, { jobId: posted.jobId, fromId: F, familyRevision: 1, text: 'stale', language: 'en' }, NEXT).ok).toBe(false);
    expect(revokeFamilyGrant(state, { actorId: F, elderId: E, familyId: F, revision: 1 }, NEXT).ok).toBe(false);
    expect(updateElderInformation(state, { actorId: F, elderId: E, revision: 1, profile: profile() }).ok).toBe(false);
    expect(approveFamilyGrant(as(state, E), { elderId: E, familyId: F, scopes: LEGACY_FAMILY_SCOPES, expectedRevision: 1 }, NEXT).ok).toBe(false);
    expect(visibleJob(state, posted.jobId, F)?.job.createdById).toBe(F);
  });
  it('saves only approved elder preferences atomically and reports durable storage failure', () => {
    const seed = as(createSeedState(NOW), F), storage = new MemoryStorage(); saveCommunity(storage, seed);
    const store = createCommunityStore(storage, () => NOW), input = profile(), before = store.state;
    storage.fail = true;
    expect(store.run(s => updateElderInformation(s, { actorId: F, elderId: E, revision: 1, profile: input })).ok).toBe(false);
    expect(store.state).toBe(before); expect(store.issue).toBe('storage');
    storage.fail = false;
    expect(store.run(s => updateElderInformation(s, { actorId: F, elderId: E, revision: 1, profile: input })).ok).toBe(true);
    input.preferences.visitTimes[0]!.day = 5;
    const state = loadCommunitySnapshot(storage, NOW).state;
    expect(state.accounts.find(a => a.id === E)).toMatchObject({ name: 'Margaret Lee', firstName: 'Margaret', area: 'Suwanee, GA', role: 'elder', language: 'en', provider: 'apple' });
    expect(state.elders.find(e => e.accountId === E)).toMatchObject({ needs: ['Uses a cane'], addressHint: 'Fictional porch', visitInstructions: 'Please message before visiting.', preferences: { contact: 'ask-first', visitTimes: [{ day: 2, part: 'morning' }] } });
    expect(state.session.onboarded).toEqual(seed.session.onboarded); expect(state.volunteers).toEqual(seed.volunteers); expect(state.jobs).toEqual(seed.jobs);
  });
  it('denies unknown, malformed, stale, unapproved or cross-session information edits without mutating input', () => {
    const state = as(createSeedState(NOW), F), before = JSON.stringify(state);
    for (const patch of [{ name: ' ' }, { area: '' }, { needs: ['x', 'x'] }, { addressHint: 'x'.repeat(241) }, { visitInstructions: 'x'.repeat(1001) }, { preferences: { contact: 'sms', visitTimes: [], notes: '' } }, { credentials: 'secret' }, { role: 'volunteer' }, { badges: { idChecked: true } }]) {
      expect(updateElderInformation(state, { actorId: F, elderId: E, revision: 1, profile: { ...profile(), ...patch } as ElderProfileEdit }).ok).toBe(false);
    }
    expect(updateElderInformation(as(state, V), { actorId: F, elderId: E, revision: 1, profile: profile() }).ok).toBe(false);
    expect(updateElderInformation(state, { actorId: F, elderId: 'elder-rosa', revision: 1, profile: profile() }).ok).toBe(false);
    expect(updateElderInformation(state, { actorId: F, elderId: E, profile: profile() }).ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('requires bound revisions for family mutations and a reviewed prior revision for consent approval', () => {
    const state = as(createSeedState(NOW), F);
    expect(postJob(state, { actorId: F, elderId: E, source: 'typed', originalText: 'Unbound request', analysis: quickPickAnalysis('light-bulb', 'en') }, NOW).ok).toBe(false);
    expect(sendMessage(state, { jobId: 'job-past-margaret', fromId: F, language: 'en', text: 'Unbound message' }, NOW).ok).toBe(false);
    const posted = post(state); if (!posted.ok) throw new Error(posted.message);
    expect(cancelJob(posted.state, { jobId: posted.jobId, actorId: F }, NOW).ok).toBe(false);
    const unrated = { ...state, jobs: state.jobs.map(j => j.id === 'job-past-margaret' ? { ...j, rating: null, timeline: j.timeline.filter(e => e.type !== 'rated') } : j) };
    expect(rateJob(unrated, { jobId: 'job-past-margaret', actorId: F, stars: 5 }, NOW).ok).toBe(false);
    expect(approveFamilyGrant(as(state, E), { elderId: E, familyId: F, scopes: LEGACY_FAMILY_SCOPES } as Parameters<typeof approveFamilyGrant>[1], NOW).ok).toBe(false);
  });
  it('does not complete blank demo setups or accept consent backdated before recorded actions', () => {
    const seed = createSeedState(NOW);
    for (const id of ['elder-new-demo', 'volunteer-new-demo']) expect(completeOnboarding(as(seed, id), id).ok).toBe(false);
    const posted = post(as(seed, F)); if (!posted.ok) throw new Error(posted.message);
    expect(revokeFamilyGrant(posted.state, { actorId: F, elderId: E, familyId: F, revision: 1 }, '2026-10-24T11:59:00.000Z').ok).toBe(false);
    expect(approveFamilyGrant(as(posted.state, E), { elderId: E, familyId: F, scopes: LEGACY_FAMILY_SCOPES, expectedRevision: 1 }, '2026-10-24T11:59:00.000Z').ok).toBe(false);
    const blank = ok(approveFamilyGrant(as(seed, 'elder-new-demo'), { elderId: 'elder-new-demo', familyId: F, scopes: [...LEGACY_FAMILY_SCOPES, 'profile'], expectedRevision: null }, NOW));
    const edited = ok(updateElderInformation(as(blank, F), { actorId: F, elderId: 'elder-new-demo', revision: 2, profile: profile() }));
    expect(edited.session.onboarded).not.toContain('elder-new-demo'); expect(edited.session.onboarded).not.toContain('volunteer-new-demo');
  });
});

describe('version-1 family history migration', () => {
  it('migrates valid legacy records without inventing profile consent or relabeling historic family confirmations', () => {
    const seed = createSeedState(NOW), { familyHistory: _history, ...legacy } = seed;
    legacy.session = { ...legacy.session, accountId: F };
    legacy.jobs = legacy.jobs.map(j => j.id === 'job-past-margaret' ? { ...j, createdById: F, timeline: j.timeline.map(e => ['posted', 'confirmed', 'rated'].includes(e.type) ? { ...e, actorId: F } : e), rating: { ...j.rating!, byId: F } } : j);
    const job = legacy.jobs.find(j => j.id === 'job-past-margaret')!;
    legacy.messages = [{ id: 'message-legacy-family', jobId: job.id, fromId: F, at: job.timeline.at(-1)!.at, text: 'Historic family message', language: 'en', translations: {} }];
    expect(validateCommunityState(legacy)).toBe(true);
    const raw = JSON.stringify({ revision: 12, resetEpoch: 'retain-captures', state: legacy }), storage = new MemoryStorage(); storage.setItem(COMMUNITY_STORAGE_KEY, raw);
    const migrated = loadCommunitySnapshot(storage, NOW); expect(migrated.status).toBe('loaded'); expect(migrated.resetEpoch).toBe('retain-captures'); expect(migrated.raw).toBe(raw); expect(storage.getItem(COMMUNITY_STORAGE_KEY)).toBe(raw);
    expect(familyGrant(migrated.state, F, E)).toMatchObject({ origin: 'legacy-link', scopes: LEGACY_FAMILY_SCOPES });
    expect(canManageElder(migrated.state, F, E, 'profile')).toBe(false);
    expect(updateElderInformation(migrated.state, { actorId: F, elderId: E, revision: 1, profile: profile() }).ok).toBe(false);
    const revoked = ok(revokeFamilyGrant(migrated.state, { actorId: F, elderId: E, familyId: F, revision: 1 }, NOW));
    expect(saveCommunity(storage, revoked)).toBe(true); const reload = loadCommunitySnapshot(storage, NOW); expect(reload.status).toBe('loaded');
    const historic = reload.state.jobs.find(j => j.id === job.id)!;
    expect(historic.timeline.find(e => e.type === 'confirmed')?.actorId).toBe(F); expect(historic.rating?.byId).toBe(F); expect(historic.hoursCredited).toBe(job.hoursCredited);
    expect(reload.state.messages[0]?.fromId).toBe(F); expect(visibleJob(reload.state, job.id, F)).toBeNull();
    const approved = ok(approveFamilyGrant(as(reload.state, E), { elderId: E, familyId: F, scopes: [...LEGACY_FAMILY_SCOPES, 'profile'], expectedRevision: 1 }, NEXT));
    expect(canManageElder(as(approved, F), F, E, 'profile', 2)).toBe(true);
  });
  it('rejects fabricated or overlapping grant records and one-sided links', () => {
    const state = createSeedState(NOW), grant = state.familyHistory!.grants[0]!;
    for (const bad of [
      { ...state, familyHistory: { grants: [{ ...grant, approvedById: F }], legacyConfirmations: [] } },
      { ...state, familyHistory: { grants: [{ ...grant, origin: 'legacy-link' }], legacyConfirmations: [] } },
      { ...state, familyHistory: { grants: [grant, { ...grant, revision: 2 }], legacyConfirmations: [] } },
      { ...state, elders: state.elders.map(e => ({ ...e, familyIds: [] })) },
    ]) expect(validateCommunityState(bad)).toBe(false);
  });
});
