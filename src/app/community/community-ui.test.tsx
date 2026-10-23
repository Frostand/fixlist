import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as d from '../../community';
import type { AvailabilitySlot, CommunityResult } from '../../community/types';
import { I18nProvider, translate } from '../../i18n';
import { en } from '../../i18n/en';
import { es } from '../../i18n/es';
import { usesClassic, Root } from './Root';
import { DraftScreen, parseCommunityRoute } from './CommunityApp';
import { DemoAccountChoices, RoleChoice, SignIn } from './Onboarding';
import { Confirmation, ElderHome, ProgressTracker, RatingForm, RequestList, type Draft } from './Elder';
import { EvidencePhoto, JobCard, OriginalToggle } from './JobCard';
import { NearbyList, ScheduleChoices, ServiceHours, VolunteerJob, VolunteerProfileScreen } from './Volunteer';
import { Messages } from './Messages';
import { Button, MatchChips } from './UI';
import { applyCommunityCommand, type CommunityController } from './useCommunity';
vi.mock('./NearbyMap', () => ({ default: () => null }));
const NOW = '2026-10-23T12:00:00.000Z', LATER = '2026-10-24T13:00:00.000Z', ELDER = 'elder-margaret', VOL = 'volunteer-jordan';
const noop = () => { };
function memoryStorage(): Storage { const values = new Map<string, string>(); return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: (k) => { values.delete(k); }, clear: () => values.clear(), key: (i) => [...values.keys()][i] ?? null, get length() { return values.size; } }; }
function stateOf(result: CommunityResult) { expect(result.ok).toBe(true); if (!result.ok)
    throw new Error(result.message); return result.state; }
function elements(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] { if (Array.isArray(node))
    return node.flatMap((n) => elements(n, type)); if (!isValidElement<{
    children?: ReactNode;
}>(node))
    return []; return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...elements(node.props.children, type)]; }
function capture(render: () => ReactNode, language: 'en' | 'es' = 'en') { let tree: ReactNode; function Probe() { tree = render(); return tree; } const html = renderToStaticMarkup(<I18nProvider language={language}><Probe /></I18nProvider>); return { tree, html }; }
function button(tree: ReactNode, label: string) { const element = [...elements(tree, Button), ...elements(tree, 'button')].find((e) => e.props.children === label); expect(element, `button ${label}`).toBeDefined(); return element!; }
function click(element: ReactElement<Record<string, unknown>>) { return (element.props.onClick as () => unknown)(); }
function posted() { let state = stateOf(d.signIn(d.createSeedState(NOW), ELDER)); const result = d.postJob(state, { actorId: ELDER, elderId: ELDER, source: 'quick-pick', originalText: 'Change a light bulb', analysis: d.quickPickAnalysis('light-bulb', 'en'), preferredSlots: [{ day: 6, part: 'morning' }] }, NOW); if (!result.ok)
    throw new Error(result.message); state = result.state; return { state, jobId: result.jobId }; }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('community routing and first run', () => {
    it.each(['#/r/home', '#/v/tasks', '#/start', '#/people', '#/guide/elder'])('preserves the legacy route %s', (hash) => expect(usesClassic(null, hash)).toBe(true));
    it('chooses classic mode explicitly and keeps c routes in the new app', () => { expect(usesClassic('classic', '#/c/home')).toBe(true); expect(usesClassic(null, '#/c/home')).toBe(false); expect(parseCommunityRoute('#/c/job/job-12')).toEqual({ screen: 'job', id: 'job-12' }); expect(parseCommunityRoute('#/c/job/%zz').id).toBe(''); });
    it('renders the actual community Root by default and the classic return control for legacy', () => { const storage = memoryStorage(); vi.stubGlobal('window', { location: { hash: '#/c/intro' }, localStorage: storage }); vi.stubGlobal('localStorage', storage); expect(renderToStaticMarkup(<Root />)).toContain('A little help at home.'); storage.setItem('fixlist.mode', 'classic'); const classic = renderToStaticMarkup(<Root />); expect(classic).toContain('Back to new FixList'); expect(classic).not.toContain('c-landing-nav'); });
    it('renders all sign-in providers and grouped account choices, then role and elder home', () => { let state = d.createSeedState(NOW), route = 'signin'; const sign = capture(() => SignIn({ groups: { elder: d.accountsByRole(state, 'elder'), volunteer: d.accountsByRole(state, 'volunteer'), family: d.accountsByRole(state, 'family') }, onSignIn: noop, onCreate: noop, onBack: noop })); expect(sign.html).toContain('Continue with Apple'); expect(sign.html).toContain('Continue with Google'); expect(sign.html).toContain('Continue with email'); expect(sign.html).toContain('sign-in uses sample accounts on this phone'); const groups = { elder: d.accountsByRole(state, 'elder'), volunteer: d.accountsByRole(state, 'volunteer'), family: d.accountsByRole(state, 'family') }; const sheet = capture(() => DemoAccountChoices({ groups, onSelect: (id) => { state = stateOf(d.signIn(state, id)); route = 'home'; }, onCreate: () => { route = 'role'; } })); expect(sheet.html).toContain('People who want help'); expect(sheet.html).toContain('Volunteers'); expect(sheet.html).toContain('Family'); click(button(sheet.tree, translate('en', 'c.signin.new'))); expect(route).toBe('role'); let role = ''; const roles = capture(() => RoleChoice({ onSelect: (r) => { role = r; }, onBack: noop })); const cards = elements(roles.tree, 'button'); click(cards[0]!); expect(role).toBe('elder'); const accountChoice = elements(sheet.tree, 'button').find((e) => (e.props.onClick as () => void) && renderToStaticMarkup(e).includes('Margaret Lee'))!; click(accountChoice); expect(route).toBe('home'); const elder = d.currentAccount(state)!; const home = capture(() => ElderHome({ state, account: elder, elder, jobs: d.jobsForElder(state, elder.id), onNavigate: noop, onDraft: noop })); expect(home.html).toContain('Hello, Margaret.'); expect(home.html).toContain('Talk to FixList'); });
    it('keeps every new English key available in Spanish', () => { for (const key of Object.keys(en).filter((k) => k.startsWith('c.'))) {
        expect(es[key as keyof typeof es], key).toBeTruthy();
    } });
});
describe('elder request UI and persistence', () => {
    it('quick pick opens a checked job card, and posting appears in My help', () => { let state = stateOf(d.signIn(d.createSeedState(NOW), ELDER)), draft: Draft | null = null; const account = d.currentAccount(state)!; const home = capture(() => ElderHome({ state, account, elder: account, jobs: [], onNavigate: noop, onDraft: (next) => { draft = next; } })); const quick = elements(home.tree, 'button').find((e) => e.props.className === 'c-chip')!; click(quick); expect(draft).not.toBeNull(); const selected = draft as unknown as Draft; expect(selected.source).toBe('quick-pick'); const storage = memoryStorage(); let postedId = ''; const preview = capture(() => DraftScreen({ draft: selected, onChange: noop, onPost: (preferredSlots) => { const { result, saved } = applyCommunityCommand(state, (s) => d.postJob(s, { actorId: ELDER, elderId: ELDER, source: selected.source, originalText: selected.text, analysis: selected.analysis, preferredSlots }, NOW), storage); expect(saved).toBe(true); if (result.ok) {
            state = result.state;
            postedId = result.jobId;
        } return result.ok; } })); expect(preview.html).toContain('Does this look right?'); expect(preview.html).toContain('using task rules'); click(button(preview.tree, translate('en', 'c.job.post'))); expect(postedId).toBeTruthy(); const jobs = d.jobsForElder(state, ELDER); expect((jobs[0]!).id).toBe(postedId); const myHelp = renderToStaticMarkup(<RequestList state={state} jobs={jobs} onOpen={noop}/>); expect(myHelp).toContain(selected.analysis.titleEnglish); expect(myHelp).toContain('Request progress'); expect(d.loadCommunity(storage, NOW).state.jobs.some((j) => j.id === postedId)).toBe(true); });
    it('keeps failed commands and denied storage separate from success', () => { const state = d.createSeedState(NOW), storage = memoryStorage(); const failed = applyCommunityCommand(state, (s) => d.postJob(s, { actorId: ELDER, elderId: ELDER, source: 'typed', originalText: 'Help', analysis: d.quickPickAnalysis('light-bulb', 'en') }, NOW), storage); expect(failed.result.ok).toBe(false); expect(storage.getItem(d.COMMUNITY_STORAGE_KEY)).toBeNull(); const denied = { ...storage, setItem: () => { throw new Error('denied'); } }; const changed = applyCommunityCommand(state, (s) => d.signIn(s, ELDER), denied); expect(changed.result.ok).toBe(true); expect(changed.saved).toBe(false); });
    it('uses original text or English content without pretending the rules were AI', () => { const analysis = d.quickPickAnalysis('light-bulb', 'ko'); const html = renderToStaticMarkup(<JobCard analysis={analysis}/>); expect(html).toContain(analysis.titleEnglish); expect(html).toContain('using task rules'); expect(html).not.toContain('Written by on-device AI'); const toggle = vi.fn(); const control = capture(() => OriginalToggle({ language: 'ko', original: false, onChange: toggle })); expect(control.html).toContain('한국어'); click(elements(control.tree, Button)[0]!); expect(toggle).toHaveBeenCalledWith(true); });
    it('attaches a scan marker to the photo and keeps the label visible', () => { const html = renderToStaticMarkup(<EvidencePhoto evidence={{ roomId: 'living-room', photoId: 'p01', flagId: 'rug-flag', label: 'Sample rug', point: { u: 0.4, v: 0.6 }, thumbnail: 'data:image/jpeg;base64,/9j/2Q==' }}/>); expect(html).toContain('Room photo: Sample rug'); expect(html).toContain('Marked area to review'); expect(html).toContain('left:40%'); });
    it('renders translated message content for the viewer and retains the original', () => { let { state, jobId } = posted(); state = stateOf(d.signIn(state, VOL)); state = stateOf(d.acceptJob(state, { jobId, volunteerId: VOL, scheduledFor: LATER }, NOW)); state = stateOf(d.sendMessage(state, { jobId, fromId: VOL, text: 'See you Saturday', language: 'en', translations: { es: 'Nos vemos el sábado' } }, NOW)); state = stateOf(d.signIn(state, ELDER)); const account = { ...d.currentAccount(state)!, language: 'es' as const }, job = state.jobs.find((j) => j.id === jobId)!; const html = capture(() => Messages({ state, account, job, run: vi.fn() as unknown as CommunityController['run'] }), 'es').html; expect(html).toContain('Nos vemos el sábado'); expect(html).toContain('See you Saturday'); expect(html).toContain('Traducido para usted'); });
});
describe('volunteer matching, privacy and the trust loop', () => {
    it('renders the query order with explainable reasons and gaps', () => { const state = stateOf(d.updateVolunteerProfile(stateOf(d.signIn(d.createSeedState(NOW), VOL)), VOL, { maxMiles: 50 })), matches = d.matchesForVolunteer(state, VOL, NOW); expect(matches.length).toBeGreaterThan(2); const view = capture(() => NearbyList({ state, matches, onOpen: noop })); const scores = elements(view.tree, 'article').map((node) => node.props['data-score'] as number); expect(scores).toEqual(matches.map((m) => m.score)); expect(scores).toEqual([...scores].sort((a, b) => b - a)); expect(view.html).toContain('% match'); expect(view.html).toContain('Has a ladder'); expect(view.html).toContain('Free Sat morning'); expect(view.html).toContain('mi away'); expect(view.html).toContain('Still needed:'); expect(renderToStaticMarkup(<MatchChips reasons={[{ kind: 'language', language: 'ko' }]}/>)).toContain('Speaks 한국어'); });
    it('hides the exact address before accepting and reveals it only to the assigned volunteer', () => { let { state, jobId } = posted(); state = stateOf(d.signIn(state, VOL)); const before = d.visibleJob(state, jobId, VOL)!; const hint = (state.elders.find((e) => e.accountId === ELDER)!).addressHint; const profile = state.volunteers.find((v) => v.accountId === VOL)!; const html = renderToStaticMarkup(<VolunteerJob {...before} profile={profile} match={null} onAccept={() => true} onStep={() => true} onMessages={noop}/>); expect(html).toContain('Exact address shared after you accept.'); expect(html).not.toContain(hint); state = stateOf(d.acceptJob(state, { jobId, volunteerId: VOL, scheduledFor: LATER }, NOW)); const after = d.visibleJob(state, jobId, VOL)!; expect(after.address).toBe(hint); expect((d.visibleJob(state, jobId, 'volunteer-marcus')!).address).toBeNull(); const active = renderToStaticMarkup(<VolunteerJob {...after} profile={profile} match={null} onAccept={() => true} onStep={() => true} onMessages={noop}/>); expect(active).toContain(hint); expect(active).toContain('https://www.google.com/maps/dir/'); });
    it('accepts a selected shared slot, checks in, waits for elder confirmation, rates and updates the service log', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(NOW));
        let { state, jobId } = posted();
        state = stateOf(d.signIn(state, VOL));
        const baseline = d.volunteerStats(state, VOL);
        const match = d.matchesForVolunteer(state, VOL, NOW).find((m) => m.jobId === jobId)!;
        let selected: AvailabilitySlot | null = null;
        const choices = capture(() => ScheduleChoices({ slots: match.sharedSlots, chosen: null, customDate: '', onChosen: (slot) => { selected = slot; }, onCustomDate: noop, onAccept: noop }));
        click(elements(choices.tree, 'button')[0]!);
        expect(selected).toEqual(match.sharedSlots[0]);
        const choose = capture(() => ScheduleChoices({ slots: match.sharedSlots, chosen: selected, customDate: '', onChosen: noop, onCustomDate: noop, onAccept: (scheduledFor) => { state = stateOf(d.acceptJob(state, { jobId, volunteerId: VOL, scheduledFor }, NOW)); } }));
        click(button(choose.tree, translate('en', 'c.accept.confirm')));
        expect((state.jobs.find((j) => j.id === jobId)!).status).toBe('accepted');
        const profile = state.volunteers.find((v) => v.accountId === VOL)!;
        function screen() { const view = d.visibleJob(state, jobId, VOL)!; return capture(() => VolunteerJob({ ...view, profile, match: null, onAccept: () => false, onStep: (step, note) => { state = stateOf(step === 'trip' ? d.startTrip(state, { jobId, volunteerId: VOL }, NOW) : step === 'arrive' ? d.arrive(state, { jobId, volunteerId: VOL }, NOW) : d.reportDone(state, { jobId, volunteerId: VOL, ...(note ? { note } : {}) }, NOW)); return true; }, onMessages: noop })); }
        click(button(screen().tree, translate('en', 'c.active.trip')));
        click(button(screen().tree, translate('en', 'c.active.arrive')));
        click(button(screen().tree, translate('en', 'c.active.done')));
        expect((state.jobs.find((j) => j.id === jobId)!).status).toBe('reported-done');
        expect(d.volunteerStats(state, VOL).hours).toBe(baseline.hours);
        expect(screen().html).toContain('Waiting for the resident to confirm.');
        state = stateOf(d.signIn(state, ELDER));
        const confirmation = capture(() => Confirmation({ job: state.jobs.find((j) => j.id === jobId)!, volunteerName: 'Jordan', onConfirm: () => { state = stateOf(d.confirmDone(state, { jobId, actorId: ELDER }, NOW)); return true; }, onRate: () => false, onBack: noop }));
        click(button(confirmation.tree, translate('en', 'c.confirm.yes')));
        expect((state.jobs.find((j) => j.id === jobId)!).status).toBe('completed');
        let stars = 0;
        const rating = capture(() => RatingForm({ stars: 0, note: 'Thank you!', onStars: (n) => { stars = n; }, onNote: noop, onSubmit: noop }));
        const starButtons = elements(rating.tree, 'button');
        expect(starButtons).toHaveLength(5);
        click(starButtons[4]!);
        expect(stars).toBe(5);
        const rated = capture(() => RatingForm({ stars, note: 'Thank you!', onStars: noop, onNote: noop, onSubmit: () => { state = stateOf(d.rateJob(state, { jobId, actorId: ELDER, stars, note: 'Thank you!' }, NOW)); } }));
        ((elements(rated.tree, 'form')[0]!).props.onSubmit as (event: {
            preventDefault(): void;
        }) => void)({ preventDefault: noop });
        const stats = d.volunteerStats(state, VOL);
        expect(stats.jobsDone).toBe(baseline.jobsDone + 1);
        expect(stats.hours).toBeGreaterThan(baseline.hours);
        expect(stats.ratingCount).toBe(baseline.ratingCount + 1);
        const volunteer = state.accounts.find((a) => a.id === VOL)!;
        expect(renderToStaticMarkup(<VolunteerProfileScreen state={state} account={volunteer} onEdit={noop} onLog={noop}/>)).toContain('Verified hours');
        expect(renderToStaticMarkup(<ServiceHours state={state} account={volunteer}/>)).toContain('Confirmed for Margaret');
        expect(d.serviceLog(state, VOL).some((row) => row.jobId === jobId)).toBe(true);
    });
    it('shows all six progress stages, with resident confirmation distinct from done', () => { const html = renderToStaticMarkup(<ProgressTracker status="reported-done"/>); expect(html).toContain('Done — please confirm'); expect(html).toContain('You confirmed'); expect(html).toContain('aria-current="step"'); });
});


describe('role return routes and new elder accounts', () => {
    it('returns an existing volunteer from the classic button’s home route to Nearby', () => {
        const storage = memoryStorage();
        const state = stateOf(d.signIn(d.createSeedState(NOW), VOL));
        expect(d.saveCommunity(storage, state)).toBe(true);
        vi.stubGlobal('window', { location: { hash: '#/c/home' }, localStorage: storage });
        vi.stubGlobal('localStorage', storage);
        const html = renderToStaticMarkup(<Root/>);
        expect(html).toContain('A little help, close by.');
        expect(html).not.toContain('This account isn’t linked yet');
    });
    it('creates and completes a new elder account before rendering their home', () => {
        const created = d.createAccount(d.createSeedState(NOW), { role: 'elder', name: 'Evelyn Demo', area: 'Cumming, GA', language: 'en', provider: 'email' }, NOW);
        if (!created.ok) throw new Error(created.message);
        const state = stateOf(d.completeOnboarding(created.state, created.accountId));
        const account = d.currentAccount(state)!;
        const html = renderToStaticMarkup(<ElderHome account={account} elder={account} state={state} jobs={[]} onNavigate={noop} onDraft={noop}/>);
        expect(html).toContain('Hello, Evelyn.');
        expect(html).toContain('Talk to FixList');
        expect(state.session.onboarded).toContain(created.accountId);
    });
    it('shows the linked elder to the seeded family and offers a request on their behalf', () => {
        const state = stateOf(d.signIn(d.createSeedState(NOW), 'family-alex'));
        const account = d.currentAccount(state)!;
        const elder = state.accounts.find((a) => a.id === ELDER)!;
        const navigate = vi.fn();
        const view = capture(() => ElderHome({ account, elder, state, jobs: d.jobsForElder(state, ELDER), onNavigate: navigate, onDraft: noop }));
        expect(view.html).toContain('Here for Margaret');
        click(button(view.tree, translate('en', 'c.family.ask', { name: 'Margaret' })));
        expect(navigate).toHaveBeenCalledWith('type');
    });
});
