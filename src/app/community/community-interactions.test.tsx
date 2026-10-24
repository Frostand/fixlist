import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import * as domain from '../../community';
import type { AssistantReply, CommunityResult, Language, ListeningSession } from '../../community/types';
import { assistant } from '../../lib/assistant';
import { AskScreen, ActiveRequest } from './Elder';
import { RoomCapture } from './RoomCapture';
import { DraftScreen } from './DraftScreen';
import { VolunteerJob, ScheduleChoices } from './Volunteer';
import { AccountHeader, CommunityBody } from './CommunityApp';
import { DemoAccountChoices } from './Onboarding';
import { Settings } from './Settings';
import { Button, Sheet } from './UI';
import { EvidencePhoto } from './JobCard';
import type { CommunityController } from './useCommunity';

// A small hook driver exercises component event handlers without a DOM, browser,
// new test dependency or server. It does not claim layout/native validation.
interface Driver {
    cursor: number;
    values: unknown[];
    effects: Array<() => void>;
    cleanups: Array<() => void>;
}
const runtime = vi.hoisted(() => ({ active: null as Driver | null, language: 'en' as Language, readCapture: vi.fn() }));
vi.mock('react', async importOriginal => {
    const actual = await importOriginal<typeof import('react')>();
    return { ...actual,
        useState(initial: unknown) {
            const driver = runtime.active;
            if (!driver) return actual.useState(initial);
            const i = driver.cursor++;
            if (!(i in driver.values)) driver.values[i] = typeof initial === 'function' ? initial() : initial;
            return [driver.values[i], (value: unknown) => { driver.values[i] = typeof value === 'function' ? value(driver.values[i]) : value; }];
        },
        useRef(initial: unknown) {
            const driver = runtime.active;
            if (!driver) return actual.useRef(initial);
            const i = driver.cursor++;
            if (!(i in driver.values)) driver.values[i] = { current: initial };
            return driver.values[i];
        },
        useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
            const driver = runtime.active;
            if (!driver) return actual.useEffect(effect, deps);
            const i = driver.cursor++, prior = driver.values[i] as readonly unknown[] | undefined;
            if (!deps || !prior || deps.some((value, index) => !Object.is(value, prior[index]))) {
                driver.values[i] = deps;
                driver.effects.push(() => { driver.cleanups[i]?.(); const cleanup = effect(); driver.cleanups[i] = typeof cleanup === 'function' ? cleanup : () => {}; });
            }
        },
        useMemo<T>(factory: () => T, deps: readonly unknown[]) {
            const driver = runtime.active;
            if (!driver) return actual.useMemo(factory, deps);
            const i = driver.cursor++, prior = driver.values[i] as { deps: readonly unknown[]; value: T } | undefined;
            if (!prior || deps.some((value, index) => !Object.is(value, prior.deps[index]))) driver.values[i] = { deps, value: factory() };
            return (driver.values[i] as { value: T }).value;
        },
    };
});
vi.mock('../../i18n', async importOriginal => {
    const actual = await importOriginal<typeof import('../../i18n')>();
    return { ...actual, useLanguage: () => runtime.language, useT: () => Object.assign((key: import('../../i18n').MessageKey, values?: import('../../i18n').Values) => actual.translate(runtime.language, key, values), { language: runtime.language }) };
});
vi.mock('../../lib/capture-storage', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/capture-storage')>(), getCaptureStore: () => ({ read: runtime.readCapture }), getCommunityCaptureStore: () => ({ read: runtime.readCapture }) }));
vi.mock('./NearbyMap', () => ({ default: () => null }));
function driver(render: () => ReactNode) {
    const state: Driver = { cursor: 0, values: [], effects: [], cleanups: [] };
    const result = { render() { state.cursor = 0; runtime.active = state; let tree: ReactNode; try { tree = render(); } finally { runtime.active = null; } for (const run of state.effects.splice(0)) run(); return tree; }, unmount() { for (const cleanup of state.cleanups) cleanup?.(); } };
    return result;
}
function nodes(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) return node.flatMap(value => nodes(value, type));
    if (!isValidElement<{ children?: ReactNode }>(node)) return [];
    return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...nodes(node.props.children, type)];
}
function press(tree: ReactNode, label: string) {
    const control = [...nodes(tree, Button), ...nodes(tree, 'button')].find(node => renderToStaticMarkup(<>{node.props.children as ReactNode}</>).includes(label));
    expect(control, label).toBeDefined();
    return (control!.props.onClick as () => unknown)();
}
function rootProps(tree: ReactNode) { return (tree as ReactElement<Record<string, unknown>>).props; }
const settle = () => new Promise(resolve => setImmediate(resolve));
const NOW = '2026-10-23T12:00:00.000Z';
function listeningFixture() {
    let end!: (value: Awaited<ListeningSession['done']>) => void;
    const sessionId = 'test-listening';
    const done = new Promise<Awaited<ListeningSession['done']>>(resolve => { end = resolve; });
    const finish = (reason: Awaited<ListeningSession['done']>['reason'], text: string) => end({ sessionId, reason, text });
    return { session: { sessionId, done, stop: vi.fn(async () => { finish('stopped', 'Please change the kitchen light bulb'); return 'Please change the kitchen light bulb'; }), cancel: vi.fn(() => finish('cancelled', '')) }, finish };
}
function stateOf(result: CommunityResult) { if (!result.ok) throw new Error(result.message); return result.state; }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); runtime.language = 'en'; });

describe('community polish interactions', () => {
    it('moves idle → listening → thinking → replied, speaks and replays, and keeps the draft visible', async () => {
        vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true); vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
        vi.spyOn(assistant, 'availability').mockResolvedValue({ onDeviceModel: true, speechInput: true, speechOutput: true });
        let partial: (words: string) => void = () => {};
        const { session } = listeningFixture();
        vi.spyOn(assistant, 'startListening').mockImplementation(async (_language, onPartial) => { partial = onPartial; return session; });
        let reply!: (value: AssistantReply) => void;
        vi.spyOn(assistant, 'chat').mockReturnValue(new Promise(resolve => { reply = resolve; }));
        const speak = vi.spyOn(assistant, 'speak').mockResolvedValue(); vi.spyOn(assistant, 'stopSpeaking').mockImplementation(() => {});
        const onDraft = vi.fn(), onPost = vi.fn().mockReturnValue(true), account = domain.createSeedState(NOW).accounts[0]!;
        const view = driver(() => AskScreen({ talk: true, account, onDraft, onPost }));
        expect(rootProps(view.render())['data-talk-phase']).toBe('idle'); await settle();
        press(view.render(), 'Tap to talk'); await settle(); expect(rootProps(view.render())['data-talk-phase']).toBe('listening');
        partial('Please change the kitchen'); expect(renderToStaticMarkup(<>{view.render()}</>)).toContain('Please change the kitchen');
        press(view.render(), 'Stop'); await settle(); expect(rootProps(view.render())['data-talk-phase']).toBe('thinking');
        const analysis = domain.quickPickAnalysis('light-bulb', 'en'); reply({ text: 'I wrote this up for you.', job: analysis, engine: 'rules' }); await settle();
        const replied = view.render(); expect(rootProps(replied)['data-talk-phase']).toBe('replied');
        expect(speak).toHaveBeenCalledWith('I wrote this up for you.', 'en'); expect(onDraft).not.toHaveBeenCalled();
        const markup = renderToStaticMarkup(<>{replied}</>); expect(markup).toContain('FixList</span>'); expect(markup).toContain('You</span>'); expect(markup).toContain('Post this request');
        press(replied, 'Play reply again'); expect(speak).toHaveBeenCalledTimes(2);
        const preview = nodes(replied, DraftScreen)[0]!;
        (preview.props.onPost as (slots: unknown[], a: unknown) => void)([], analysis); expect(onPost).toHaveBeenCalledWith(expect.objectContaining({ source: 'voice' }), [], analysis);
        view.unmount();
    });
    it('shows typed input when voice is unavailable and cancels a pending listening start on leave', async () => {
        vi.spyOn(assistant, 'availability').mockResolvedValue({ onDeviceModel: false, speechInput: false, speechOutput: false });
        const account = domain.createSeedState(NOW).accounts[0]!, view = driver(() => AskScreen({ talk: true, account, onDraft: vi.fn() }));
        view.render(); await settle(); const unavailable = view.render();
        expect(rootProps(unavailable)['data-talk-phase']).toBe('idle'); expect(nodes(unavailable, 'textarea')).toHaveLength(1);
        expect(renderToStaticMarkup(<>{unavailable}</>)).not.toContain('I’m listening'); view.unmount();
        vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true); vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
        vi.mocked(assistant.availability).mockResolvedValue({ onDeviceModel: true, speechInput: true, speechOutput: true });
        let resolve!: (value: ListeningSession) => void, signal: AbortSignal | undefined;
        vi.spyOn(assistant, 'startListening').mockImplementation((_language, _partial, inputSignal) => { signal = inputSignal; return new Promise(done => { resolve = done; }); });
        const leaving = driver(() => AskScreen({ talk: true, account, onDraft: vi.fn() })); leaving.render(); await settle(); press(leaving.render(), 'Tap to talk'); leaving.unmount();
        expect(signal?.aborted).toBe(true);
        const cancel = vi.fn(); resolve({ ...listeningFixture().session, cancel }); await settle(); expect(cancel).toHaveBeenCalledOnce();
    });
    it.each(['final', 'stopped'] as const)('consumes a %s terminal exactly once, including manual stop plus done', async reason => {
        vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true); vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
        vi.spyOn(assistant, 'availability').mockResolvedValue({ onDeviceModel: true, speechInput: true, speechOutput: true });
        const { session, finish } = listeningFixture();
        vi.spyOn(assistant, 'startListening').mockResolvedValue(session);
        const chat = vi.spyOn(assistant, 'chat').mockResolvedValue({ text: 'Which room?', job: null, engine: 'rules' });
        vi.spyOn(assistant, 'speak').mockResolvedValue(); vi.spyOn(assistant, 'stopSpeaking').mockImplementation(() => {});
        const account = domain.createSeedState(NOW).accounts[0]!, view = driver(() => AskScreen({ talk: true, account, onDraft: vi.fn() }));
        view.render(); await settle(); press(view.render(), 'Tap to talk'); await settle();
        if (reason === 'stopped') press(view.render(), 'Stop');
        finish(reason, 'Please change the kitchen light bulb'); await settle();
        expect(rootProps(view.render())['data-talk-phase']).toBe('replied'); expect(chat).toHaveBeenCalledOnce();
        view.unmount();
    });
    it.each(['error', 'background', 'interrupted', 'cancelled'] as const)('leaves listening on %s and preserves interrupted words for editing', async reason => {
        vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true); vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
        vi.spyOn(assistant, 'availability').mockResolvedValue({ onDeviceModel: true, speechInput: true, speechOutput: true });
        const { session, finish } = listeningFixture(); vi.spyOn(assistant, 'startListening').mockResolvedValue(session);
        const chat = vi.spyOn(assistant, 'chat');
        const account = domain.createSeedState(NOW).accounts[0]!, view = driver(() => AskScreen({ talk: true, account, onDraft: vi.fn() }));
        view.render(); await settle(); press(view.render(), 'Tap to talk'); await settle();
        finish(reason, 'Please change the kitchen'); await settle(); const tree = view.render();
        expect(rootProps(tree)['data-talk-phase']).toBe('idle'); expect(chat).not.toHaveBeenCalled();
        if (reason !== 'cancelled') expect(nodes(tree, 'textarea')[0]?.props.value).toBe('Please change the kitchen');
        view.unmount();
    });
    it('ignores old-account terminal results and replies after the account changes', async () => {
        vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true); vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
        vi.spyOn(assistant, 'availability').mockResolvedValue({ onDeviceModel: true, speechInput: true, speechOutput: true });
        const first = listeningFixture(), second = listeningFixture();
        vi.spyOn(assistant, 'startListening').mockResolvedValueOnce(first.session).mockResolvedValueOnce(second.session);
        let reply!: (value: AssistantReply) => void;
        const chat = vi.spyOn(assistant, 'chat').mockReturnValue(new Promise(resolve => { reply = resolve; }));
        const speak = vi.spyOn(assistant, 'speak').mockResolvedValue();
        const accounts = domain.createSeedState(NOW).accounts; let account = accounts[0]!;
        const view = driver(() => AskScreen({ talk: true, account, onDraft: vi.fn() }));
        view.render(); await settle(); press(view.render(), 'Tap to talk'); await settle();
        first.finish('final', 'Old account words'); await settle(); expect(chat).toHaveBeenCalledOnce();
        account = accounts[1]!; view.render(); await settle();
        reply({ text: 'Old account private reply', job: null, engine: 'rules' }); await settle();
        expect(renderToStaticMarkup(<>{view.render()}</>)).not.toContain('Old account'); expect(speak).not.toHaveBeenCalled();
        press(view.render(), 'Tap to talk'); await settle(); account = accounts[2]!; view.render(); await settle();
        second.finish('final', 'Another old account'); await settle(); expect(chat).toHaveBeenCalledOnce(); view.unmount();
    });
    it('preselects the only shared slot and accepts the date displayed', () => {
        const state = domain.createSeedState(NOW), job = state.jobs.find(j => j.id === 'job-open-soonja-bulb')!, elder = state.accounts.find(a => a.id === job.elderId)!, profile = state.volunteers[0]!;
        const match = domain.scoreMatch(state, job, profile, NOW);
        const accepted = vi.fn().mockReturnValue(true);
        const view = driver(() => VolunteerJob({ job, elder, profile, address: null, match, onAccept: accepted, onStep: () => true, onMessages: () => {} }));
        press(view.render(), 'Volunteer for this'); const sheet = view.render();
        const schedule = nodes(sheet, ScheduleChoices)[0]!; expect(schedule.props.chosen).toEqual(match.sharedSlots[0]);
        const choices = driver(() => ScheduleChoices(schedule.props as unknown as Parameters<typeof ScheduleChoices>[0]));
        const tree = choices.render(); expect(nodes(tree, 'button')[0]!.props['aria-pressed']).toBe(true);
        const confirm = nodes(tree, Button)[0]!; expect(confirm.props.disabled).toBe(false); (confirm.props.onClick as () => void)();
        expect(accepted).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)); view.unmount();
    });
    it('keeps the chosen Hallway and carries the marked thumbnail through preview and posting', async () => {
        runtime.readCapture.mockResolvedValue(null);
        const context = new Proxy({}, { get: () => () => {}, set: () => true });
        vi.stubGlobal('document', { createElement: () => ({ getContext: () => context, toDataURL: () => 'data:image/jpeg;base64,/9j/2Q==' }) });
        const onDraft = vi.fn(), view = driver(() => RoomCapture({ ownerId: 'elder-margaret', resetEpoch: 'test-reset', onDraft, onType: () => {} }));
        press(view.render(), 'Hallway'); await settle(); press(view.render(), 'Use the sample room photos');
        const review = view.render(); const photo = nodes(review, EvidencePhoto)[0]!;
        expect(photo.props.caption).toBe(false); expect(photo.props.evidence).toMatchObject({ roomId: 'hallway', point: { u: .23, v: .92 } });
        const markup = renderToStaticMarkup(<>{review}</>); expect(markup).toContain('Hallway'); expect(markup).not.toContain('Living room'); expect(markup).toContain('Practice room: a sample picture, not your home.');
        press(review, 'Ask for help with this'); expect(onDraft).toHaveBeenCalledOnce();
        const [analysis, evidence] = onDraft.mock.calls[0]!;
        let state = stateOf(domain.signIn(domain.createSeedState(NOW), 'elder-margaret'));
        const draft = { analysis, evidence: [evidence], source: 'scan' as const, text: evidence.label };
        const preview = driver(() => DraftScreen({ draft, onChange: () => {}, onPost: slots => { const result = domain.postJob(state, { actorId: 'elder-margaret', elderId: 'elder-margaret', originalText: draft.text, analysis, evidence: draft.evidence, source: 'scan', preferredSlots: slots }, NOW); state = stateOf(result); return true; } }));
        const previewTree = preview.render(), previewMarkup = renderToStaticMarkup(<>{previewTree}</>);
        expect(previewMarkup).toContain('data:image/jpeg;base64,/9j/2Q=='); expect(previewMarkup).toContain('c-photo-marker');
        press(previewTree, 'Post this request'); expect(state.jobs.find(j => j.evidence.some(e => e.photoId === 'sample-room'))?.evidence[0]!.roomId).toBe('hallway'); view.unmount();
    });
    it('signs out and opens the account sheet directly, then signs into the selected profile', () => {
        let state = stateOf(domain.signIn(domain.createSeedState(NOW), 'elder-margaret'));
        const location = { hash: '#/c/home' };
        vi.stubGlobal('window', { location, addEventListener() {}, removeEventListener() {}, scrollTo() {} });
        vi.stubGlobal('document', { documentElement: { style: { fontSize: '' }, dataset: {} }, querySelector: () => null });
        const controller: CommunityController = { get state() { return state; }, get account() { return domain.currentAccount(state); }, issue: null, run: command => { const result = command(state); if (result.ok) state = result.state; return result; }, reset() {}, clearIssue() {} };
        const view = driver(() => CommunityBody({ controller, language: 'en', onGuestLanguage: () => {} }));
        const first = view.render(); const header = nodes(first, 'main'); expect(header).toHaveLength(1);
        const accountHeader = nodes(first, AccountHeader)[0]!;
        (accountHeader.props.onSettings as () => void)(); const settings = nodes(view.render(), Settings)[0]!;
        (settings.props.onSwitch as () => void)(); expect(state.session.accountId).toBeNull(); expect(location.hash).toBe('/c/accounts');
        const switched = view.render(); expect(nodes(switched, Sheet)).toHaveLength(1); const choices = nodes(switched, DemoAccountChoices)[0]!;
        (choices.props.onSelect as (id: string) => void)('volunteer-jordan'); expect(state.session.accountId).toBe('volunteer-jordan'); expect(location.hash).toBe('/c/nearby');
        view.unmount();
    });
    it.each(['accepted', 'on-the-way', 'arrived', 'reported-done'] as const)('shows the correct elder/family %s status and routes messages/confirmation', status => {
        const state = domain.createSeedState(NOW), source = state.jobs.find(j => j.elderId === 'elder-margaret')!;
        const onNavigate = vi.fn(), job = { ...source, status, volunteerId: 'volunteer-jordan', scheduledFor: '2026-10-24T13:00:00.000Z' };
        const view = driver(() => ActiveRequest({ state, job, onNavigate })), tree = view.render(), markup = renderToStaticMarkup(<>{tree}</>);
        expect(markup).toContain(status === 'accepted' ? 'Jordan is coming' : status === 'on-the-way' ? 'Jordan is on the way' : status === 'arrived' ? 'Jordan has arrived' : 'please confirm');
        press(tree, 'Message'); expect(onNavigate).toHaveBeenCalledWith(`messages/${job.id}`);
        if (status === 'reported-done') { press(tree, 'Confirm'); expect(onNavigate).toHaveBeenCalledWith(`confirm/${job.id}`); }
    });
});
