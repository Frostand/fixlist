import { describe, expect, it } from 'vitest';
import { acceptJob, arrive, cancelJob, completeOnboarding, confirmDone, createAccount, postJob, rateJob, reportDone, sendMessage, signIn, signOut, startTrip, updateLanguage, updateVolunteerProfile } from './commands';
import { createSeedState } from './seed';
import { quickPickAnalysis } from './task-rules';
import { completeAccountSetup, type SetupValues } from './setup';
import { validateCommunityState } from './storage';
import type { CommunityResult, CommunityState, Job, JobAnalysis, Language, VolunteerProfile } from './types';

const NOW = '2026-10-23T12:00:00.000Z', LATER = '2026-10-24T12:00:00.000Z';
const ELDER = 'elder-margaret', VOL = 'volunteer-jordan', FAMILY = 'family-alex', OTHER = 'volunteer-marcus';
function resultState(result: CommunityResult): CommunityState { expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.message); expect(validateCommunityState(result.state)).toBe(true); return result.state; }
function as(state: CommunityState, actorId: string): CommunityState { return resultState(signIn(state, actorId)); }
function posted(minutes = 20): { state: CommunityState; jobId: string } {
  const result = postJob(as(createSeedState(NOW), ELDER), { actorId: ELDER, elderId: ELDER, source: 'typed', originalText: 'Help with a bulb', analysis: { ...quickPickAnalysis('light-bulb', 'en'), estimatedMinutes: minutes } }, NOW);
  if (!result.ok) throw new Error(result.message);
  expect(validateCommunityState(result.state)).toBe(true);
  return result;
}
function assigned(): { state: CommunityState; jobId: string } {
  const { state, jobId } = posted();
  return { state: resultState(acceptJob(as(state, VOL), { jobId, volunteerId: VOL, scheduledFor: LATER }, NOW)), jobId };
}
function withStatus(status: Job['status'], minutes = 20): { state: CommunityState; jobId: string } {
  let { state, jobId } = posted(minutes);
  if (status === 'open') return { state, jobId };
  state = resultState(acceptJob(as(state, VOL), { jobId, volunteerId: VOL, scheduledFor: LATER }, NOW));
  if (status === 'accepted') return { state, jobId };
  state = resultState(startTrip(state, { jobId, volunteerId: VOL }, NOW));
  if (status === 'on-the-way') return { state, jobId };
  state = resultState(arrive(state, { jobId, volunteerId: VOL }, NOW));
  if (status === 'arrived') return { state, jobId };
  state = resultState(reportDone(state, { jobId, volunteerId: VOL }, NOW));
  if (status === 'reported-done') return { state, jobId };
  state = resultState(confirmDone(as(state, ELDER), { jobId, actorId: ELDER }, NOW));
  return { state, jobId };
}
describe('atomic account setup', () => {
  const input = (role: SetupValues['role']): SetupValues => ({ role, name: ' New Person ', area: ' Suwanee, GA ', language: 'ko', needs: [' Using ladders '], skills: ['yard'], tools: ['gloves'], availability: [{ day: 2, part: 'evening' }], maxMiles: 23, school: ' Demo School ', elderId: 'elder-rosa' });
  it.each(['elder', 'volunteer'] as const)('creates a complete %s candidate without mutating source or retaining input arrays', role => {
    const state = createSeedState(NOW), before = JSON.stringify(state), values = input(role);
    const result = completeAccountSetup(state, null, values, 'email', NOW);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(validateCommunityState(result.state)).toBe(true);
    expect(result.state.accounts.at(-1)).toMatchObject({ name: 'New Person', firstName: 'New', language: 'ko', area: 'Suwanee, GA', provider: 'email', location: { lat: 34.0515, lng: -84.0713 } });
    expect(result.state.session.onboarded).toContain(result.accountId);
    values.needs.push('Changed'); values.skills.push('errands'); values.tools.push('car'); values.availability[0]!.day = 5;
    if (role === 'elder') expect(result.state.elders.at(-1)).toMatchObject({ needs: ['Using ladders'], familyIds: [], addressHint: '' });
    else expect(result.state.volunteers.at(-1)).toMatchObject({ skills: ['yard'], tools: ['gloves'], availability: [{ day: 2, part: 'evening' }], school: 'Demo School', maxMiles: 23, badges: { idChecked: false, backgroundCheck: false } });
    expect(JSON.stringify(state)).toBe(before);
    expect(completeAccountSetup(result.state, null, input(role), 'email', NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
  });
  it.each(['elder', 'volunteer'] as const)('updates the selected %s in place, idempotently, without touching other records', role => {
    const seed = createSeedState(NOW), id = `${role}-new-demo`, state = as(seed, id), values = input(role);
    const result = completeAccountSetup(state, id, values, 'google', NOW);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const again = completeAccountSetup(result.state, id, values, 'google', NOW);
    expect(again.ok).toBe(true); if (!again.ok) return;
    expect(again.state).toEqual(result.state); expect(validateCommunityState(again.state)).toBe(true);
    expect(again.state.accounts).toHaveLength(seed.accounts.length);
    expect(again.state.elders).toHaveLength(seed.elders.length); expect(again.state.volunteers).toHaveLength(seed.volunteers.length);
    expect(again.state.accounts.find(a => a.id === id)).toMatchObject({ provider: 'email', createdAt: seed.accounts.find(a => a.id === id)!.createdAt });
    expect(again.state.accounts.filter(a => a.id !== id)).toEqual(seed.accounts.filter(a => a.id !== id));
    expect(again.state.families).toBe(seed.families); expect(again.state.jobs).toBe(seed.jobs); expect(again.state.messages).toBe(seed.messages);
    expect(seed.session.onboarded).not.toContain(id);
  });
  it.each([
    { name: '' }, { area: ' ' }, { language: 'zz' }, { role: 'admin' }, { needs: ['x'.repeat(201)] }, { needs: Array(31).fill('Need') },
  ])('rejects invalid elder setup without a candidate state (%j)', patch => {
    const state = createSeedState(NOW), before = JSON.stringify(state);
    expect(completeAccountSetup(state, null, { ...input('elder'), ...patch } as SetupValues, 'email', NOW)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(JSON.stringify(state)).toBe(before);
  });
  it.each([
    { skills: ['bogus'] }, { tools: ['bogus'] }, { tools: ['car', 'car'] }, { availability: [{ day: 2, part: 'noon' }] },
    { availability: [{ day: 2, part: 'morning' }, { day: 2, part: 'morning' }] }, { maxMiles: Infinity }, { school: 'x'.repeat(201) },
    { badges: { idChecked: true, backgroundCheck: true } },
  ])('rejects invalid volunteer setup and self-granted fields (%j)', patch => {
    const state = as(createSeedState(NOW), 'volunteer-new-demo');
    expect(completeAccountSetup(state, 'volunteer-new-demo', { ...input('volunteer'), ...patch } as SetupValues, 'email', NOW)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(state.session.onboarded).not.toContain('volunteer-new-demo');
  });
  it('rejects absent or stale actors, role changes, bad timestamps and unsupported providers', () => {
    const state = as(createSeedState(NOW), ELDER);
    expect(completeAccountSetup(state, VOL, input('volunteer'), 'email', NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(completeAccountSetup(state, null, input('elder'), 'email', NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(completeAccountSetup(state, ELDER, input('volunteer'), 'email', NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(completeAccountSetup({ ...state, session: { ...state.session, accountId: 'missing' } }, 'missing', input('elder'), 'email', NOW)).toMatchObject({ ok: false, code: 'not_found' });
    expect(completeAccountSetup(state, ELDER, input('elder'), 'email', 'bad')).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(completeAccountSetup(state, ELDER, input('elder'), 'bad' as 'email', NOW)).toMatchObject({ ok: false, code: 'invalid_input' });
  });
  it('never creates or changes family authorization from the setup picker', () => {
    const state = as(createSeedState(NOW), FAMILY);
    const result = completeAccountSetup(state, FAMILY, input('family'), 'email', NOW);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.state.families).toBe(state.families); expect(result.state.elders).toBe(state.elders);
    const created = completeAccountSetup(resultState(signOut(state)), null, input('family'), 'email', NOW);
    expect(created.ok).toBe(true); if (!created.ok) return;
    expect(created.state.families.at(-1)).toEqual({ accountId: created.accountId, elderIds: [] });
    expect(created.state.elders).toBe(state.elders); expect(validateCommunityState(created.state)).toBe(true);
  });
});
describe('demo profiles and permissions', () => {
  it('signs in/out without mutating state; rejects nonexistent profiles', () => {
    const state = createSeedState(NOW), before = JSON.stringify(state);
    expect(signIn(state, 'missing')).toMatchObject({ ok: false, code: 'not_found' });
    const signed = as(state, VOL); expect(signed.session.accountId).toBe(VOL);
    expect(resultState(signOut(signed)).session.accountId).toBeNull(); expect(JSON.stringify(state)).toBe(before);
  });
  it('completes onboarding only for the current profile, idempotently', () => {
    const seed = createSeedState(NOW), state = { ...seed, session: { accountId: ELDER, onboarded: [] } };
    const next = resultState(completeOnboarding(state, ELDER));
    expect(resultState(completeOnboarding(next, ELDER)).session.onboarded).toEqual([ELDER]);
    expect(completeOnboarding(state, FAMILY)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(completeOnboarding(state, 'missing')).toMatchObject({ ok: false, code: 'not_found' });
  });
  it.each(['elder', 'volunteer', 'family'] as const)('creates a matching empty %s profile and selects it', (role) => {
    const state = createSeedState(NOW), before = JSON.stringify(state);
    const result = createAccount(state, { role, name: ' New Person ', language: 'ko', provider: 'email', area: 'Suwanee, GA' }, NOW);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(validateCommunityState(result.state)).toBe(true); expect(result.state.session.accountId).toBe(result.accountId);
    const account = result.state.accounts.find((a) => a.id === result.accountId)!;
    expect(account).toMatchObject({ name: 'New Person', firstName: 'New', role, location: { lat: 34.0515, lng: -84.0713 } });
    const collection = role === 'elder' ? result.state.elders : role === 'volunteer' ? result.state.volunteers : result.state.families;
    expect(collection.some((p) => p.accountId === result.accountId)).toBe(true); expect(JSON.stringify(state)).toBe(before);
  });
  it('rejects invalid account input and defaults unknown areas to Cumming', () => {
    const state = createSeedState(NOW), input = { role: 'elder' as const, name: 'N', language: 'en' as const, provider: 'email' as const, area: 'Unknown area' };
    const result = createAccount(state, input, NOW); if (!result.ok) throw new Error(result.message);
    expect(result.state.accounts.at(-1)!.location).toEqual({ lat: 34.2073, lng: -84.1402 });
    for (const patch of [{ name: '' }, { language: 'zz' }, { role: 'admin' }, { provider: 'bogus' }, { area: '' }]) expect(createAccount(state, { ...input, ...patch } as typeof input, NOW).ok).toBe(false);
    expect(createAccount(state, input, 'bad').ok).toBe(false);
    const second = createAccount(result.state, input, NOW); expect(second.ok && second.accountId).not.toBe(result.accountId);
  });
  it('updates only the current profile language', () => {
    const state = as(createSeedState(NOW), ELDER), before = JSON.stringify(state);
    expect(resultState(updateLanguage(state, ELDER, 'vi')).accounts.find((a) => a.id === ELDER)!.language).toBe('vi');
    expect(updateLanguage(state, FAMILY, 'es')).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(updateLanguage(state, 'missing', 'en')).toMatchObject({ ok: false, code: 'not_found' });
    expect(updateLanguage(state, ELDER, 'bad' as Language)).toMatchObject({ ok: false, code: 'invalid_input' }); expect(JSON.stringify(state)).toBe(before);
  });
  it('edits the current volunteer profile with copied input and rejects bad settings or self-awarded badges', () => {
    const state = as(createSeedState(NOW), VOL), before = JSON.stringify(state);
    const skills: VolunteerProfile['skills'][number][] = ['general', 'yard'];
    const next = resultState(updateVolunteerProfile(state, VOL, { skills, bio: 'I can help', maxMiles: 5 }));
    skills.push('errands'); expect(next.volunteers.find((v) => v.accountId === VOL)!.skills).toEqual(['general', 'yard']);
    expect(updateVolunteerProfile(state, OTHER, {})).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(updateVolunteerProfile(state, ELDER, {})).toMatchObject({ ok: false, code: 'not_found' });
    for (const patch of [{ maxMiles: -1 }, { maxMiles: Infinity }, { availability: [{ day: 8, part: 'morning' }] }, { tools: ['chainsaw'] }, { skills: ['yard', 'yard'] }]) expect(updateVolunteerProfile(state, VOL, patch as Partial<VolunteerProfile>)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(updateVolunteerProfile(state, VOL, { badges: { idChecked: true, backgroundCheck: true } })).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('request lifecycle and immutability', () => {
  it('posts for an elder or linked family with a copied draft; rejects other actors and invalid drafts', () => {
    const analysis = quickPickAnalysis('light-bulb', 'en'), payload = { actorId: FAMILY, familyRevision: 1, elderId: ELDER, source: 'quick-pick' as const, originalText: ' Help please ', analysis };
    const base = as(createSeedState(NOW), FAMILY), before = JSON.stringify(base), result = postJob(base, payload, NOW);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const job = result.state.jobs.find((j) => j.id === result.jobId)!; expect(job).toMatchObject({ status: 'open', createdById: FAMILY, originalText: 'Help please', hoursCredited: null });
    (analysis.tools as string[]).push('gloves'); expect(job.analysis.tools).toEqual(['ladder']); expect(validateCommunityState(result.state)).toBe(true); expect(JSON.stringify(base)).toBe(before);
    expect(postJob(as(base, VOL), { ...payload, actorId: VOL }, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(postJob(base, { ...payload, elderId: 'elder-rosa' }, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(postJob(base, { ...payload, elderId: 'missing' }, NOW)).toMatchObject({ ok: false, code: 'not_found' });
    for (const patch of [{ originalText: '' }, { analysis: { ...analysis, estimatedMinutes: -1 } }, { repeatEveryDays: 0 }, { evidence: [{ roomId: 'bad' }] }]) expect(postJob(base, { ...payload, ...patch } as typeof payload, NOW)).toMatchObject({ ok: false, code: 'invalid_input' });
  });
  it('records every transition and credits hours only after elder confirmation', () => {
    let { state, jobId } = assigned(); const before = JSON.stringify(state);
    state = resultState(startTrip(state, { jobId, volunteerId: VOL }, NOW));
    state = resultState(arrive(state, { jobId, volunteerId: VOL }, NOW));
    state = resultState(reportDone(state, { jobId, volunteerId: VOL, note: ' Replaced the bulb ' }, NOW));
    expect(state.jobs.at(-1)!.hoursCredited).toBeNull();
    state = resultState(confirmDone(as(state, ELDER), { jobId, actorId: ELDER }, NOW));
    state = resultState(rateJob(state, { jobId, actorId: ELDER, stars: 5, note: 'Thank you' }, NOW));
    const job = state.jobs.at(-1)!;
    expect(job.timeline.map((e) => e.type)).toEqual(['posted', 'accepted', 'on-the-way', 'arrived', 'reported-done', 'confirmed', 'rated']);
    expect(job.timeline[4]!.note).toBe('Replaced the bulb'); expect(job.hoursCredited).toBeNull(); expect(job.rating?.stars).toBe(5);
    expect(before).not.toBe(JSON.stringify(state));
  });
  it.each(['accepted', 'on-the-way', 'arrived'] as const)('allows an assigned volunteer to report done from %s', (status) => {
    const { state, jobId } = withStatus(status);
    expect(resultState(reportDone(state, { jobId, volunteerId: VOL }, NOW)).jobs.at(-1)!.status).toBe('reported-done');
  });
  it.each([1, 20, 23, 37, 38, 60, 75, 90])('confirms %i estimated minutes without issuing policy-free hours', minutes => {
    const { state, jobId } = withStatus('reported-done', minutes);
    expect(confirmDone(as(state, FAMILY), { jobId, actorId: FAMILY }, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(resultState(confirmDone(as(state, ELDER), { jobId, actorId: ELDER }, NOW)).jobs.at(-1)!.hoursCredited).toBeNull();
  });
  it('rejects acceptance by non-volunteers, absent actors, repeated acceptance and invalid schedules', () => {
    const { state, jobId } = posted(), payload = { jobId, volunteerId: VOL, scheduledFor: LATER };
    expect(acceptJob(state, payload, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(acceptJob(state, { ...payload, volunteerId: ELDER }, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(acceptJob(as(state, VOL), { ...payload, scheduledFor: 'bad' }, NOW)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(acceptJob(as(state, VOL), { ...payload, scheduledFor: '2020-01-01T00:00:00Z' }, NOW)).toMatchObject({ ok: false, code: 'invalid_input' });
    const assigned = resultState(acceptJob(as(state, VOL), payload, NOW));
    expect(acceptJob(assigned, payload, NOW)).toMatchObject({ ok: false, code: 'invalid_state' });
    expect(acceptJob(assigned, { ...payload, jobId: 'missing' }, NOW)).toMatchObject({ ok: false, code: 'not_found' });
  });
  it.each([startTrip, arrive, reportDone])('rejects volunteer transitions by outsiders and missing requests', (command) => {
    const { state, jobId } = assigned(), before = JSON.stringify(state);
    expect(command(as(state, OTHER), { jobId, volunteerId: OTHER }, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(command(as(state, ELDER), { jobId, volunteerId: VOL }, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(command(state, { jobId: 'missing', volunteerId: VOL }, NOW)).toMatchObject({ ok: false, code: 'not_found' });
    expect(JSON.stringify(state)).toBe(before);
  });
  it.each([
    ['open', startTrip], ['accepted', arrive], ['on-the-way', startTrip], ['arrived', arrive], ['reported-done', reportDone], ['completed', reportDone],
  ] as const)('blocks an invalid transition from %s', (status, command) => {
    const { state, jobId } = withStatus(status);
    // An open request has no assigned volunteer, so its permission guard runs first.
    expect(command(as(state, VOL), { jobId, volunteerId: VOL }, NOW).ok).toBe(false);
  });
  it('rejects invalid notes and retroactive event timestamps without changing state', () => {
    const { state, jobId } = assigned(), before = JSON.stringify(state);
    expect(startTrip(state, { jobId, volunteerId: VOL }, '2026-10-22T00:00:00Z')).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(reportDone(state, { jobId, volunteerId: VOL, note: 'x'.repeat(2001) }, NOW)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(JSON.stringify(state)).toBe(before);
  });
  it.each([confirmDone, cancelJob])('enforces elder/family authority and existence', (command) => {
    const { state, jobId } = withStatus('reported-done');
    expect(command(state, { jobId, actorId: VOL }, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(command(as(state, 'elder-rosa'), { jobId, actorId: 'elder-rosa' }, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(command(state, { jobId: 'missing', actorId: VOL }, NOW)).toMatchObject({ ok: false, code: 'not_found' });
  });
  it('blocks premature/repeated confirmations, premature/repeated ratings, and invalid stars', () => {
    const open = posted(); expect(confirmDone(open.state, { jobId: open.jobId, actorId: ELDER }, NOW)).toMatchObject({ ok: false, code: 'invalid_state' });
    expect(rateJob(open.state, { jobId: open.jobId, actorId: ELDER, stars: 5 }, NOW)).toMatchObject({ ok: false, code: 'invalid_state' });
    const { state: done, jobId } = withStatus('completed'), state = as(done, FAMILY), payload = { jobId, actorId: FAMILY, familyRevision: 1, stars: 4 };
    expect(confirmDone(state, { jobId, actorId: FAMILY }, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    for (const stars of [0, 6, 2.5, NaN]) expect(rateJob(state, { ...payload, stars }, NOW)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(rateJob(as(state, VOL), { ...payload, actorId: VOL }, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(rateJob(state, { ...payload, jobId: 'missing' }, NOW)).toMatchObject({ ok: false, code: 'not_found' });
    const rated = resultState(rateJob(state, payload, NOW)); expect(rateJob(rated, payload, NOW)).toMatchObject({ ok: false, code: 'invalid_state' });
  });
  it.each(['open', 'accepted', 'on-the-way', 'arrived', 'reported-done'] as const)('allows family cancellation from %s, without creating credit', (status) => {
    const { state: base, jobId } = withStatus(status), state = as(base, FAMILY), payload = { jobId, actorId: FAMILY, familyRevision: 1 };
    const next = resultState(cancelJob(state, payload, NOW)); expect(next.jobs.at(-1)!).toMatchObject({ status: 'cancelled', hoursCredited: null });
    expect(cancelJob(next, payload, NOW)).toMatchObject({ ok: false, code: 'invalid_state' });
    expect(reportDone(as(next, VOL), { jobId, volunteerId: VOL }, NOW).ok).toBe(false);
  });
  it('does not cancel completed jobs or trust a one-sided family link', () => {
    const { state, jobId } = withStatus('completed'); expect(cancelJob(as(state, ELDER), { jobId, actorId: ELDER }, NOW)).toMatchObject({ ok: false, code: 'invalid_state' });
    const base = posted(), unlinked = { ...base.state, families: [] };
    expect(cancelJob({ ...unlinked, session: { ...unlinked.session, accountId: FAMILY } }, { jobId: base.jobId, actorId: FAMILY }, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
  });
  it('allows participant messages with copied translations, while rejecting outsiders and invalid text', () => {
    const { state: base, jobId } = assigned(), before = JSON.stringify(base), translations = { es: 'Voy en camino' };
    let state = resultState(sendMessage(base, { jobId, fromId: VOL, text: ' On my way ', language: 'en', translations }, NOW));
    translations.es = 'changed'; expect(state.messages.at(-1)!.translations.es).toBe('Voy en camino');
    for (const actorId of [ELDER, FAMILY]) state = resultState(sendMessage(as(state, actorId), { jobId, fromId: actorId, familyRevision: 1, text: 'Thank you', language: 'en' }, NOW));
    expect(state.messages).toHaveLength(3); expect(state.messages[0]!.text).toBe('On my way'); expect(JSON.stringify(base)).toBe(before);
    expect(sendMessage(as(base, OTHER), { jobId, fromId: OTHER, text: 'hello', language: 'en' }, NOW)).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(sendMessage(base, { jobId: 'missing', fromId: VOL, text: 'hello', language: 'en' }, NOW)).toMatchObject({ ok: false, code: 'not_found' });
    for (const patch of [{ text: '' }, { language: 'zz' }, { translations: { xx: 'bad' } }]) expect(sendMessage(base, { jobId, fromId: VOL, text: 'hello', language: 'en', ...patch } as Parameters<typeof sendMessage>[1], NOW)).toMatchObject({ ok: false, code: 'invalid_input' });
  });
  it('copies nested scan evidence and slots when posting', () => {
    const { state } = posted(), evidence = { roomId: 'room-kitchen', photoId: 'photo-one', flagId: 'flag-one', label: 'Review rug', point: { u: 0.2, v: 0.3 }, thumbnail: null };
    const slots = [{ day: 6 as const, part: 'morning' as const }];
    const result = postJob(state, { actorId: ELDER, elderId: ELDER, source: 'scan', originalText: 'Review the rug', analysis: quickPickAnalysis('light-bulb', 'en') as JobAnalysis, evidence: [evidence], preferredSlots: slots, repeatEveryDays: 7 }, NOW);
    if (!result.ok) throw new Error(result.message); evidence.point.u = 1; slots[0]!.day = 0 as 6;
    expect(result.state.jobs.at(-1)!.evidence[0]!.point?.u).toBe(0.2); expect(result.state.jobs.at(-1)!.preferredSlots[0]!.day).toBe(6); expect(validateCommunityState(result.state)).toBe(true);
  });
});
