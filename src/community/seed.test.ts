import { describe, expect, it } from 'vitest';
import { createSeedState, NEW_ELDER_DEMO_ID } from './seed';
import { scoreMatch } from './matching';
import { quickPickAnalysis } from './task-rules';
import { validateCommunityState } from './storage';
import { serviceLog, volunteerStats } from './queries';

const NOW = '2026-10-23T12:00:00.000Z';
describe('authored community demo stories', () => {
  it('adds only two empty first-run demos and preserves every original seed record', async () => {
    const state = createSeedState(NOW), newIds = ['elder-new-demo', 'volunteer-new-demo'];
    const { familyHistory, ...original } = state;
    expect(familyHistory?.grants).toMatchObject([{ elderId: 'elder-margaret', familyId: 'family-alex', origin: 'fictional-demo', scopes: ['requests', 'capture', 'messages', 'profile'] }]);
    const existing = { ...original, accounts: state.accounts.filter(a => !newIds.includes(a.id)), elders: state.elders.filter(e => !newIds.includes(e.accountId)), volunteers: state.volunteers.filter(v => !newIds.includes(v.accountId)) };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(existing)));
    expect(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')).toBe('c0a6138e4dc232f57025c8e77fdbbf08d97481c9abf3bde76bac54709fa6c900');
    expect(state.accounts).toHaveLength(14);
    expect(state.elders.find(e => e.accountId === newIds[0])).toEqual({ accountId: newIds[0], needs: [], familyIds: [], addressHint: '' });
    expect(state.volunteers.find(v => v.accountId === newIds[1])).toMatchObject({ skills: [], tools: [], availability: [], bio: '', badges: { idChecked: false, backgroundCheck: false } });
    expect(state.session.onboarded).toEqual(existing.accounts.map(a => a.id));
    expect(state.jobs.some(j => newIds.includes(j.elderId) || newIds.includes(j.volunteerId ?? ''))).toBe(false);
    expect(state.families.some(f => newIds.includes(f.accountId) || f.elderIds.some(id => newIds.includes(id)))).toBe(false);
    expect(validateCommunityState(state)).toBe(true);
  });
  it('gives all jobs distinct specific titles, leaving the bulb quick pick for the new request', () => {
    const { jobs } = createSeedState(NOW);
    expect(jobs).toHaveLength(32);
    expect(new Set(jobs.map((j) => j.analysis.titleEnglish)).size).toBe(jobs.length);
    expect(new Set(jobs.map((j) => j.analysis.title)).size).toBe(jobs.length);
    const bulb = quickPickAnalysis('light-bulb', 'en');
    expect(jobs.some((j) => j.analysis.titleEnglish === bulb.titleEnglish)).toBe(false);
    expect(jobs.find((j) => j.elderId === 'elder-margaret')!.analysis.titleEnglish).toBe('Tighten the loose stair handrail');
  });
  it('authors each original request, title and summary in its elder’s language with separate English text', () => {
    const state = createSeedState(NOW);
    const scripts = { en: /[a-z]/iu, es: /[áéíóúñ¿]|\b(?:el|la|las|del|un|una|cuatro|alarma|pasillo)\b/iu, ko: /[가-힣]/u, zh: /[\u4e00-\u9fff]/u, vi: /[ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/iu };
    for (const job of state.jobs) {
      const language = state.accounts.find((a) => a.id === job.elderId)!.language as keyof typeof scripts;
      expect(job.analysis.language).toBe(language); expect(job.originalText).toMatch(scripts[language]);
      expect(job.analysis.title).toMatch(scripts[language]); expect(job.analysis.summary).toMatch(scripts[language]);
      expect(job.analysis.summaryEnglish.length).toBeGreaterThan(50);
      if (language === 'en') {
        expect(job.analysis.title).toBe(job.analysis.titleEnglish); expect(job.analysis.summary).toBe(job.analysis.summaryEnglish);
      } else {
        expect(job.analysis.title).not.toBe(job.analysis.titleEnglish); expect(job.analysis.summary).not.toBe(job.analysis.summaryEnglish);
      }
    }
    expect(validateCommunityState(state)).toBe(true);
  });
  it('keeps the eight distinct open stories, practical details and scan provenance', () => {
    const state = createSeedState(NOW), open = state.jobs.filter((j) => j.status === 'open');
    expect(open).toHaveLength(8);
    const ceiling = open.find((j) => j.elderId === 'elder-soonja' && j.analysis.tools.includes('ladder'))!;
    expect(ceiling.analysis.titleEnglish).toBe('Replace the kitchen ceiling light');
    expect(ceiling.analysis.summaryEnglish).toContain('tall ladder');
    const groceries = open.find((j) => j.elderId === 'elder-rosa' && j.analysis.category === 'errand')!;
    expect(groceries.analysis.summaryEnglish).toContain('four grocery bags');
    expect(groceries.preferredSlots).toEqual([{ day: 4, part: 'afternoon' }]);
    expect(open.some((j) => j.elderId === 'elder-linh' && j.analysis.titleEnglish.includes('iPad'))).toBe(true);
    expect(open.some((j) => j.elderId === 'elder-linh' && j.analysis.peopleNeeded === 2 && j.analysis.skills.includes('lifting'))).toBe(true);
    const grab = open.find((j) => j.elderId === 'elder-wei')!;
    expect(grab.analysis).toMatchObject({ peopleNeeded: 2, skills: ['safety-install'] });
    expect(grab.analysis.tools).toEqual(expect.arrayContaining(['drill', 'stud-finder']));
    expect(grab.source).toBe('scan'); expect(grab.evidence).toHaveLength(1);
    expect(grab.evidence[0]).toMatchObject({ thumbnail: null }); expect(grab.evidence[0]!.flagId).toBeTruthy(); expect(grab.evidence[0]!.label).toBeTruthy();
    const tomatoes = open.find((j) => j.repeatEveryDays !== null)!;
    expect(tomatoes.elderId).toBe('elder-soonja'); expect(tomatoes.repeatEveryDays).toBe(7);
    expect(tomatoes.preferredSlots).toEqual([{ day: 2, part: 'morning' }]);
  });
  it('keeps distinct active work, warm completed reviews and short needs lists for every elder', () => {
    const state = createSeedState(NOW);
    expect(state.jobs.filter((j) => j.status === 'accepted')).toHaveLength(1);
    expect(state.jobs.filter((j) => j.status === 'on-the-way')).toHaveLength(1);
    const completed = state.jobs.filter((j) => j.status === 'completed'); expect(completed).toHaveLength(22);
    const notes = completed.flatMap((j) => j.rating?.note ? [j.rating.note] : []);
    expect(new Set(notes).size).toBe(notes.length);
    expect(notes.every((note) => note.length > 40 && !note.includes('Fictional demo rating'))).toBe(true);
    expect(completed.every((j) => j.rating && j.hoursCredited !== null)).toBe(true);
    expect(completed.filter((j) => j.volunteerId === 'volunteer-jordan' && j.rating?.note)).toHaveLength(3);
    expect(state.elders.filter(e => e.accountId !== NEW_ELDER_DEMO_ID).every((e) => e.needs.length >= 2 && e.needs.length <= 4 && e.needs.every((n) => n.trim().length > 0))).toBe(true);
  });
  it('preserves the current open and active requests exactly', async () => {
    const protectedJobs = createSeedState(NOW).jobs.filter((j) => j.status !== 'completed');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(protectedJobs)));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(hash).toBe('f3d9e7ff0c21996a63f0cedc91d5a606b6d953d86507671a74dc627c6ac38d52');
  });
  it.each([
    ['volunteer-jordan', 6, 9.5, 29 / 6], ['volunteer-marcus', 9, 15, 44 / 9],
    ['volunteer-priya', 3, 4.5, 14 / 3], ['volunteer-ana', 3, 4.5, 14 / 3], ['volunteer-ethan', 1, 1.75, 5],
  ] as const)('has a confirmed track record for %s', (volunteerId, jobsDone, hours, rating) => {
    const state = createSeedState(NOW), stats = volunteerStats(state, volunteerId), log = serviceLog(state, volunteerId);
    expect(stats).toEqual({ jobsDone, hours, rating, ratingCount: jobsDone });
    expect(log).toHaveLength(jobsDone); expect(log.reduce((total, row) => total + row.hours, 0)).toBe(hours);
    expect(log.every((row) => row.confirmedAt && Date.parse(row.confirmedAt) < Date.parse(NOW))).toBe(true);
  });
  it('dates the completed history within the past three months and after account creation', () => {
    const state = createSeedState(NOW), epoch = Date.parse(NOW), earliest = epoch - 90 * 86400000;
    for (const job of state.jobs.filter((j) => j.status === 'completed')) {
      expect(Date.parse(job.createdAt)).toBeGreaterThanOrEqual(earliest);
      for (const event of job.timeline) {
        expect(Date.parse(event.at)).toBeLessThan(epoch);
        expect(Date.parse(state.accounts.find((a) => a.id === event.actorId)!.createdAt)).toBeLessThanOrEqual(Date.parse(event.at));
      }
    }
    const jordan = serviceLog(state, 'volunteer-jordan').map((row) => Date.parse(row.confirmedAt));
    expect(Math.max(...jordan) - Math.min(...jordan)).toBeGreaterThanOrEqual(70 * 86400000);
    expect(new Set(state.jobs.filter((j) => j.volunteerId === 'volunteer-jordan').map((j) => j.elderId)).size).toBeGreaterThanOrEqual(4);
    expect(state.jobs.filter((j) => j.elderId === 'elder-margaret').map((j) => j.id)).toEqual(['job-past-margaret']);
  });
  it('gives Jordan strong matches for Soon-ja’s ceiling light and Margaret’s new bulb request', () => {
    const state = createSeedState(NOW), volunteer = state.volunteers.find((v) => v.accountId === 'volunteer-jordan')!;
    const ceiling = state.jobs.find((j) => j.id === 'job-open-soonja-bulb')!;
    const newRequest = { ...ceiling, id: 'job-demo-new-bulb', elderId: 'elder-margaret', analysis: quickPickAnalysis('light-bulb', 'en') };
    for (const job of [ceiling, newRequest]) {
      const match = scoreMatch(state, job, volunteer, NOW);
      expect(match.score).toBeGreaterThanOrEqual(90); expect(match.distanceMiles).toBeLessThanOrEqual(volunteer.maxMiles);
      expect(match.gaps).toEqual([]); expect(match.reasons).toContainEqual({ kind: 'tool', tool: 'ladder' });
    }
  });
});
