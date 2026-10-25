import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as domain from '../../community';
import type { CommunityResult, CommunityState } from '../../community/types';
import { assistant } from '../../lib/assistant';
import * as captureStorage from '../../lib/capture-storage';
import * as nativeCapture from '../../lib/native-capture';
import { CommunityBody, AccountHeader } from './CommunityApp';
import { DraftScreen } from './DraftScreen';
import type { Draft } from './Elder';
import { AskScreen, ElderHome } from './Elder';
import { DraftEditor } from './JobCard';
import { Settings } from './Settings';
import { Availability, Button, Chips } from './UI';
import { useCommunity } from './useCommunity';

// The existing component-handler harness, with dependency-aware effects and cleanup.
interface Driver { cursor: number; values: unknown[]; effects: Array<() => void>; cleanups: Array<() => void> }
const runtime = vi.hoisted(() => ({ active: null as Driver | null }));
vi.mock('react', async importOriginal => {
    const actual = await importOriginal<typeof import('react')>();
    return { ...actual,
        useState(initial: unknown) {
            const d = runtime.active;
            if (!d) return actual.useState(initial);
            const i = d.cursor++;
            if (!(i in d.values)) d.values[i] = typeof initial === 'function' ? initial() : initial;
            return [d.values[i], (value: unknown) => { d.values[i] = typeof value === 'function' ? value(d.values[i]) : value; }];
        },
        useRef(initial: unknown) {
            const d = runtime.active;
            if (!d) return actual.useRef(initial);
            const i = d.cursor++;
            if (!(i in d.values)) d.values[i] = { current: initial };
            return d.values[i];
        },
        useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
            const d = runtime.active;
            if (!d) return actual.useEffect(effect, deps);
            const i = d.cursor++, prior = d.values[i] as readonly unknown[] | undefined;
            if (!deps || !prior || deps.some((value, index) => !Object.is(value, prior[index]))) {
                d.values[i] = deps;
                d.effects.push(() => { d.cleanups[i]?.(); const cleanup = effect(); d.cleanups[i] = typeof cleanup === 'function' ? cleanup : () => {}; });
            }
        },
    };
});
vi.mock('./NearbyMap', () => ({ default: () => null }));
vi.mock('../../i18n', async importOriginal => {
    const actual = await importOriginal<typeof import('../../i18n')>();
    return { ...actual, useLanguage: () => 'en', useT: () => Object.assign((key: import('../../i18n').MessageKey, values?: import('../../i18n').Values) => actual.translate('en', key, values), { language: 'en' }) };
});
function driver<T>(render: () => T) {
    const d: Driver = { cursor: 0, values: [], effects: [], cleanups: [] };
    const view = { render() { d.cursor = 0; runtime.active = d; let result: T; try { result = render(); } finally { runtime.active = null; } for (const run of d.effects.splice(0)) run(); return result; }, unmount() { for (const cleanup of d.cleanups) cleanup?.(); } };
    cleanups.push(() => view.unmount());
    return view;
}
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const NOW = '2026-10-23T12:00:00.000Z', ELDER = 'elder-margaret', VOLUNTEER = 'volunteer-jordan';
function stateOf(result: CommunityResult): CommunityState { if (!result.ok) throw new Error(result.message); return result.state; }
function pendingJob() {
    let state = stateOf(domain.signIn(domain.createSeedState(NOW), ELDER));
    const posted = domain.postJob(state, { actorId: ELDER, elderId: ELDER, originalText: 'My custom request', source: 'typed', analysis: domain.quickPickAnalysis('light-bulb', 'en'), evidence: [{ roomId: 'hallway', photoId: 'custom-photo', flagId: 'custom-flag', label: 'My custom spot', point: null, thumbnail: 'data:image/jpeg;base64,/9j/2Q==' }] }, NOW);
    if (!posted.ok) throw new Error(posted.message);
    state = stateOf(domain.signIn(posted.state, VOLUNTEER));
    state = stateOf(domain.acceptJob(state, { jobId: posted.jobId, volunteerId: VOLUNTEER, scheduledFor: NOW }, NOW));
    state = stateOf(domain.reportDone(state, { jobId: posted.jobId, volunteerId: VOLUNTEER }, NOW));
    return { state: stateOf(domain.signIn(state, ELDER)), jobId: posted.jobId };
}
class MemoryStorage implements Storage {
    constructor(readonly values = new Map<string, string>()) {}
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    key(index: number) { return [...this.values.keys()][index] ?? null; }
    getItem(key: string) { return this.values.get(key) ?? null; }
    setItem(key: string, value: string) { this.values.set(key, value); }
    removeItem(key: string) { this.values.delete(key); }
}
function client(storage: Storage) {
    const listeners = new Map<string, Set<(event: Partial<StorageEvent>) => void>>();
    const window = { localStorage: storage, location: { hash: '#/c/home' }, scrollTo() {}, addEventListener(type: string, callback: (event: Partial<StorageEvent>) => void) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(callback); }, removeEventListener(type: string, callback: (event: Partial<StorageEvent>) => void) { listeners.get(type)?.delete(callback); } };
    const view = driver(() => { vi.stubGlobal('window', window); return useCommunity(); });
    return { ...view, event(payload: Partial<StorageEvent>) { for (const listener of listeners.get('storage') ?? []) listener(payload); }, navigate(hash: string) { window.location.hash = hash; for (const listener of listeners.get('hashchange') ?? []) listener({}); } };
}
function nodes(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) return node.flatMap(value => nodes(value, type));
    if (!isValidElement<{ children?: ReactNode }>(node)) return [];
    return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...nodes(node.props.children, type)];
}
function button(tree: ReactNode, text: string) {
    const found = nodes(tree, Button).find(node => node.props.children === text);
    expect(found, text).toBeDefined();
    return found!;
}
function press(node: ReactElement<Record<string, unknown>>) { return (node.props.onClick as () => void)(); }

describe('community durable command boundary', () => {
    it('rejects stale intent after reset without running it or resurrecting a custom completed job and thumbnail', () => {
        const storage = new MemoryStorage(), pending = pendingJob();
        const completed = stateOf(domain.confirmDone(pending.state, { jobId: pending.jobId, actorId: ELDER }, NOW));
        expect(domain.saveCommunity(storage, completed)).toBe(true);
        const a = client(storage), b = client(new MemoryStorage(storage.values));
        const first = a.render(), stale = b.render();
        first.reset();
        const command = vi.fn((s: CommunityState) => domain.updateLanguage(s, ELDER, 'es'));
        expect(stale.run(command)).toMatchObject({ ok: false, code: 'conflict' });
        expect(command).not.toHaveBeenCalled();
        expect(b.render().state.jobs.some(job => job.id === pending.jobId)).toBe(false);
        expect(storage.getItem(domain.COMMUNITY_STORAGE_KEY)).not.toContain('custom-photo');
        expect(b.render().issue).toBeTruthy();
    });
    it('preserves a newer completion without inventing hours, refreshes immediately, and never retries the stale language edit', () => {
        const storage = new MemoryStorage(), { state, jobId } = pendingJob(); domain.saveCommunity(storage, state);
        const a = client(storage), b = client(new MemoryStorage(storage.values));
        const current = a.render(), stale = b.render();
        expect(current.run(s => domain.confirmDone(s, { jobId, actorId: ELDER }, NOW)).ok).toBe(true);
        expect(stale.run(s => domain.updateLanguage(s, ELDER, 'es'))).toMatchObject({ ok: false, code: 'conflict' });
        // Reuse the same callback before a React rerender to check immediate ref refresh.
        let observed: CommunityState | undefined;
        stale.run(s => { observed = s; return domain.updateLanguage(s, ELDER, 'ko'); });
        expect(observed!.jobs.find(job => job.id === jobId)).toMatchObject({ status: 'completed', hoursCredited: null });
        expect(domain.loadCommunity(storage, NOW).state.accounts.find(a => a.id === ELDER)!.language).toBe('ko');
    });
    it('rechecks after a command before writing or publishing its candidate success', () => {
        const storage = new MemoryStorage(); domain.saveCommunity(storage, stateOf(domain.signIn(domain.createSeedState(NOW), ELDER)));
        const view = client(storage), controller = view.render();
        const newer = stateOf(domain.signIn(domain.createSeedState(NOW), VOLUNTEER));
        expect(controller.run(s => { domain.saveCommunity(storage, newer); return domain.updateLanguage(s, ELDER, 'es'); })).toMatchObject({ ok: false, code: 'conflict' });
        expect(view.render().state).toEqual(newer);
        expect(domain.loadCommunity(storage, NOW).state).toEqual(newer);
    });
    it('rejects a stale reset at the same precondition without overwriting newer data', () => {
        const storage = new MemoryStorage(); domain.saveCommunity(storage, stateOf(domain.signIn(domain.createSeedState(NOW), ELDER)));
        const a = client(storage), b = client(new MemoryStorage(storage.values)), first = a.render(), stale = b.render();
        expect(first.run(s => domain.updateLanguage(s, ELDER, 'es')).ok).toBe(true);
        const raw = storage.getItem(domain.COMMUNITY_STORAGE_KEY), write = vi.spyOn(storage, 'setItem');
        expect(stale.reset()).toMatchObject({ ok: false, code: 'conflict' });
        expect(write).not.toHaveBeenCalled(); expect(storage.getItem(domain.COMMUNITY_STORAGE_KEY)).toBe(raw);
        expect(b.render().account?.language).toBe('es');
    });
    it('rejects a replacement visible after writing and before publishing success', () => {
        const storage = new MemoryStorage(); domain.saveCommunity(storage, stateOf(domain.signIn(domain.createSeedState(NOW), ELDER)));
        const view = client(storage), controller = view.render(), latest = stateOf(domain.signIn(controller.state, VOLUNTEER));
        const raw = JSON.stringify({ revision: 99, resetEpoch: 'newer-epoch', state: latest });
        vi.spyOn(storage, 'setItem').mockImplementation((key, value) => { storage.values.set(key, value); storage.values.set(key, raw); });
        expect(controller.run(s => domain.updateLanguage(s, ELDER, 'es'))).toMatchObject({ ok: false, code: 'conflict' });
        expect(view.render().state).toEqual(latest); expect(view.render().resetEpoch).toBe('newer-epoch');
    });
    it('rereads current storage for delayed events rather than adopting an old payload', () => {
        const storage = new MemoryStorage(), { state, jobId } = pendingJob(); domain.saveCommunity(storage, state);
        const view = client(new MemoryStorage(storage.values)); view.render();
        const oldPayload = storage.getItem(domain.COMMUNITY_STORAGE_KEY);
        const completed = stateOf(domain.confirmDone(state, { jobId, actorId: ELDER }, NOW)); domain.saveCommunity(storage, completed);
        view.event({ key: domain.COMMUNITY_STORAGE_KEY, newValue: oldPayload, storageArea: (globalThis.window as unknown as { localStorage: Storage }).localStorage });
        expect(view.render().state).toEqual(completed);
        view.event({ key: 'unrelated', newValue: null });
        expect(view.render().state).toEqual(completed);
    });
    it('handles clear events and ignores other storage areas without trusting event bytes', () => {
        const storage = new MemoryStorage(); domain.saveCommunity(storage, stateOf(domain.signIn(domain.createSeedState(NOW), ELDER)));
        const view = client(storage); const before = view.render();
        storage.values.clear();
        view.event({ key: null, storageArea: new MemoryStorage(), newValue: 'not current data' });
        expect(view.render().state).toBe(before.state);
        view.event({ key: null, storageArea: storage });
        expect(view.render().account).toBeNull(); expect(view.render().resetEpoch).toBe('empty');
    });
    it('notifies same-document clients explicitly and cleans up subscriptions', () => {
        const storage = new MemoryStorage(), a = client(storage), b = client(storage);
        const first = a.render(); b.render();
        expect(first.run(s => domain.signIn(s, ELDER)).ok).toBe(true);
        expect(b.render().account?.id).toBe(ELDER);
        const before = b.render().state; b.unmount();
        first.run(domain.signOut);
        expect(b.render().state).toEqual(before);
    });
    it('keeps generic command results synchronous and notifies same-document clients of reset epochs', () => {
        const storage = new MemoryStorage(), a = client(storage), b = client(storage), first = a.render(); b.render();
        const result = first.run(s => ({ ...domain.signIn(s, ELDER), receipt: 'synchronous' }));
        expect(result).not.toBeInstanceOf(Promise); expect(result).toMatchObject({ ok: true, receipt: 'synchronous' });
        const epoch = b.render().resetEpoch;
        expect(first.reset().ok).toBe(true);
        expect(b.render().resetEpoch).not.toBe(epoch); expect(b.render().account).toBeNull();
    });
    it.each(['read', 'write', 'missing'] as const)('rejects %s storage failure without returning or publishing command success', mode => {
        const storage = new MemoryStorage(); domain.saveCommunity(storage, stateOf(domain.signIn(domain.createSeedState(NOW), ELDER)));
        const view = client(storage), controller = view.render(), before = controller.state;
        if (mode === 'read') vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        if (mode === 'write') vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        if (mode === 'missing') { view.unmount(); vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, get localStorage() { throw new Error('blocked'); } }); }
        const active = mode === 'missing' ? driver(useCommunity).render() : controller;
        const result = active.run(s => domain.signIn(s, VOLUNTEER));
        expect(result.ok).toBe(false);
        expect(result).not.toHaveProperty('state');
        if (mode !== 'missing') { expect(view.render().state).toBe(before); expect(view.render().issue).toBe('storage'); }
    });
    it('does not publish or return success when verification becomes inaccessible after writing', () => {
        const storage = new MemoryStorage(); domain.saveCommunity(storage, stateOf(domain.signIn(domain.createSeedState(NOW), ELDER)));
        const view = client(storage), controller = view.render(), before = controller.state;
        const read = vi.spyOn(storage, 'getItem');
        vi.spyOn(storage, 'setItem').mockImplementation((key, raw) => { storage.values.set(key, raw); read.mockImplementation(() => { throw new Error('read blocked'); }); });
        expect(controller.run(s => domain.updateLanguage(s, ELDER, 'es'))).toMatchObject({ ok: false });
        expect(view.render().state).toBe(before); expect(view.render().issue).toBe('storage');
    });
    it('resets with one replacement write and a fresh string epoch; failed reset preserves the old state and epoch', () => {
        const storage = new MemoryStorage(); domain.saveCommunity(storage, stateOf(domain.signIn(domain.createSeedState(NOW), ELDER)));
        const view = client(storage), controller = view.render(), epoch = controller.resetEpoch;
        const write = vi.spyOn(storage, 'setItem'), remove = vi.spyOn(storage, 'removeItem');
        expect(controller.reset()).toMatchObject({ ok: true });
        expect(write).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled();
        const reset = view.render(); expect(typeof reset.resetEpoch).toBe('string'); expect(reset.resetEpoch).not.toBe(epoch);
        expect(JSON.parse(storage.getItem(domain.COMMUNITY_STORAGE_KEY)!)).toMatchObject({ revision: expect.any(Number), resetEpoch: reset.resetEpoch, state: reset.state });
        write.mockImplementation(() => { throw new Error('quota'); });
        expect(reset.reset()).toMatchObject({ ok: false });
        expect(view.render().state).toBe(reset.state); expect(view.render().resetEpoch).toBe(reset.resetEpoch);
    });
});

describe('draft submission while translation is pending', () => {
    it('keeps an accepted synchronous submission locked until it leaves the screen', () => {
        const onPost = vi.fn().mockReturnValue(true), draft: Draft = { analysis: domain.quickPickAnalysis('light-bulb', 'en'), source: 'typed', text: 'Change my bulb', evidence: [] };
        const view = driver(() => DraftScreen({ draft, onChange() {}, onPost }));
        const submit = button(view.render(), 'Post this request');
        press(submit); press(submit);
        expect(onPost).toHaveBeenCalledOnce();
        expect(button(view.render(), 'Getting things ready…').props.disabled).toBe(true);
    });
    function editable(onPost = vi.fn().mockReturnValue(false)) {
        let draft: Draft = { analysis: domain.quickPickAnalysis('light-bulb', 'es'), source: 'typed', text: 'My original words', evidence: [] };
        const onChange = vi.fn((next: Draft) => { draft = next; });
        const view = driver(() => DraftScreen({ draft, onChange, onPost }));
        press(button(view.render(), 'Change something'));
        const editor = nodes(view.render(), DraftEditor)[0]!;
        (editor.props.onChange as (analysis: Draft['analysis']) => void)({ ...draft.analysis, title: 'Mi título nuevo', summary: 'Mi descripción nueva' });
        (editor.props.onSlots as (slots: unknown[]) => void)([{ day: 6, part: 'morning' }]);
        return { view, onChange, onPost, get draft() { return draft; } };
    }
    it('guards duplicate calls immediately, freezes every editor control, and submits one immutable snapshot', async () => {
        const resolvers: Array<(text: string | null) => void> = [];
        vi.spyOn(assistant, 'translate').mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
        const { view, onChange, onPost } = editable();
        const before = view.render(), submit = button(before, 'Post this request'), staleEditor = nodes(before, DraftEditor)[0]!;
        press(submit); press(submit);
        expect(assistant.translate).toHaveBeenCalledTimes(2);
        const pending = view.render(), editor = nodes(pending, DraftEditor)[0]!;
        expect(editor.props.disabled).toBe(true);
        const fields = driver(() => DraftEditor(editor.props as unknown as Parameters<typeof DraftEditor>[0])).render();
        expect(nodes(fields, 'fieldset').some(field => field.props.disabled === true)).toBe(true);
        const changes = onChange.mock.calls.length;
        (staleEditor.props.onChange as (a: unknown) => void)({ title: 'Too late' });
        (staleEditor.props.onSlots as (s: unknown[]) => void)([{ day: 1, part: 'evening' }]);
        expect(onChange).toHaveBeenCalledTimes(changes);
        resolvers[0]!('New English title'); resolvers[1]!('New English summary');
        await new Promise(resolve => setImmediate(resolve));
        expect(onPost).toHaveBeenCalledExactlyOnceWith([{ day: 6, part: 'morning' }], expect.objectContaining({ title: 'Mi título nuevo', summary: 'Mi descripción nueva', titleEnglish: 'New English title', summaryEnglish: 'New English summary' }));
        expect(nodes(view.render(), DraftEditor)[0]!.props.disabled).toBe(false);
    });
    it('unlocks on failed posting, preserves accepted edits and slots, and allows editing and retry', async () => {
        vi.spyOn(assistant, 'translate').mockRejectedValue(new Error('unavailable'));
        const result = editable();
        press(button(result.view.render(), 'Post this request'));
        await new Promise(resolve => setImmediate(resolve));
        const editor = nodes(result.view.render(), DraftEditor)[0]!;
        expect(editor.props.disabled).toBe(false);
        expect(result.draft.analysis.title).toBe('Mi título nuevo');
        expect(editor.props.slots).toEqual([{ day: 6, part: 'morning' }]);
        expect(result.onPost).toHaveBeenCalledExactlyOnceWith([{ day: 6, part: 'morning' }], expect.objectContaining({ titleEnglish: 'Mi título nuevo', summaryEnglish: 'Mi descripción nueva' }));
        (editor.props.onChange as (a: Draft['analysis']) => void)({ ...result.draft.analysis, estimatedMinutes: 50 });
        expect(result.draft.analysis.estimatedMinutes).toBe(50);
        press(button(result.view.render(), 'Post this request'));
        await new Promise(resolve => setImmediate(resolve));
        expect(result.onPost).toHaveBeenCalledTimes(2);
    });
    it('disables native inputs, tools and availability together through the editor fieldset', () => {
        const analysis = domain.quickPickAnalysis('light-bulb', 'en');
        const view = driver(() => DraftEditor({ analysis, slots: [], onChange() {}, onSlots() {}, disabled: true }));
        const tree = view.render(), html = renderToStaticMarkup(<>{tree}</>);
        expect(html).toMatch(/<fieldset[^>]*disabled/);
        expect(nodes(tree, 'input')).toHaveLength(2); expect(nodes(tree, 'textarea')).toHaveLength(1);
        expect(nodes(tree, Chips)).toHaveLength(1); expect(nodes(tree, Availability)).toHaveLength(1);
    });
});

describe('community transient scope', () => {
    it('returns a failed community reset to Settings and keeps the current screen open', async () => {
        const storage = new MemoryStorage(); domain.saveCommunity(storage, stateOf(domain.signIn(domain.createSeedState(NOW), ELDER)));
        const model = client(storage), controller = model.render();
        vi.stubGlobal('document', { documentElement: { style: { fontSize: '' }, dataset: {} }, querySelector: () => null });
        vi.spyOn(captureStorage, 'resetCaptureStorage').mockResolvedValue({ ok: true, message: '' });
        vi.spyOn(nativeCapture, 'discardAllNativeCaptures').mockResolvedValue({ ok: true });
        const body = driver(() => CommunityBody({ controller, language: 'en', onGuestLanguage() {} }));
        (nodes(body.render(), AccountHeader)[0]!.props.onSettings as () => void)();
        const settings = nodes(body.render(), Settings)[0]!;
        vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        expect(await (settings.props.onReset as () => Promise<boolean>)()).toBe(false);
        expect(window.location.hash).toBe('#/c/home'); expect(nodes(body.render(), Settings)).toHaveLength(1);
        expect(model.render().state).toBe(controller.state);
        expect(captureStorage.resetCaptureStorage).not.toHaveBeenCalled();
        expect(nativeCapture.discardAllNativeCaptures).not.toHaveBeenCalled();
    });
    function resetView() {
        const storage = new MemoryStorage(); domain.saveCommunity(storage, stateOf(domain.signIn(domain.createSeedState(NOW), ELDER)));
        const model = client(storage); let controller = model.render();
        vi.stubGlobal('document', { documentElement: { style: { fontSize: '' }, dataset: {} }, querySelector: () => null });
        const body = driver(() => CommunityBody({ controller, language: 'en', onGuestLanguage() {} }));
        (nodes(body.render(), AccountHeader)[0]!.props.onSettings as () => void)();
        const settings = nodes(body.render(), Settings)[0]!;
        return { storage, model, body, reset: settings.props.onReset as () => Promise<boolean>, render() { controller = model.render(); return body.render(); } };
    }
    it('rejects an actual stale reset handler before either capture clear', async () => {
        const clear = vi.spyOn(captureStorage, 'resetCaptureStorage').mockResolvedValue({ ok: true, message: '' });
        const native = vi.spyOn(nativeCapture, 'discardAllNativeCaptures').mockResolvedValue({ ok: true });
        const view = resetView(), other = client(new MemoryStorage(view.storage.values));
        expect(other.render().run(s => domain.updateLanguage(s, ELDER, 'es')).ok).toBe(true);
        const durable = view.storage.getItem(domain.COMMUNITY_STORAGE_KEY);
        expect(await view.reset()).toBe(false);
        expect(view.model.render().issue).toBeTruthy();
        expect(clear).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled();
        expect(view.storage.getItem(domain.COMMUNITY_STORAGE_KEY)).toBe(durable);
    });
    it('finishes successful capture cleanup across the render caused by its own reset', async () => {
        let finish!: () => void;
        vi.spyOn(captureStorage, 'resetCaptureStorage').mockImplementation(() => new Promise(resolve => { finish = () => resolve({ ok: true, message: '' }); }));
        const native = vi.spyOn(nativeCapture, 'discardAllNativeCaptures').mockResolvedValue({ ok: true });
        const view = resetView(), resetting = view.reset();
        expect(view.model.render().account).toBeNull();
        expect(nodes(view.render(), Settings)).toHaveLength(0);
        finish(); expect(await resetting).toBe(true); expect(native).toHaveBeenCalledOnce();
        expect(window.location.hash).toBe('/c/intro');
        expect(nodes(view.render(), 'p').filter(node => node.props.role === 'status')).toHaveLength(0);
    });
    it.each(['indexeddb', 'native'] as const)('shows the %s cleanup failure after the community reset has committed', async failure => {
        vi.spyOn(captureStorage, 'resetCaptureStorage').mockImplementation(async () => {
            expect(view.model.render().account).toBeNull();
            return { ok: failure !== 'indexeddb', message: '' };
        });
        vi.spyOn(nativeCapture, 'discardAllNativeCaptures').mockResolvedValue({ ok: failure !== 'native' });
        const view = resetView(), epoch = view.model.render().resetEpoch;
        expect(await view.reset()).toBe(false);
        expect(view.model.render().resetEpoch).not.toBe(epoch); expect(view.model.render().account).toBeNull();
        const tree = view.render();
        expect(nodes(tree, 'p').some(node => node.props.role === 'status' && node.props.children === 'Some FixList data could not be cleared. Try reset again before leaving this device.')).toBe(true);
        expect(nodes(tree, Settings)).toHaveLength(0);
    });
    it.each(['indexeddb', 'native'] as const)('does not continue a reset into a new account while %s cleanup is pending', async pending => {
        let finish!: () => void;
        const clear = vi.spyOn(captureStorage, 'resetCaptureStorage').mockImplementation(() => pending === 'indexeddb' ? new Promise(resolve => { finish = () => resolve({ ok: true, message: '' }); }) : Promise.resolve({ ok: true, message: '' }));
        const native = vi.spyOn(nativeCapture, 'discardAllNativeCaptures').mockImplementation(() => new Promise(resolve => { finish = () => resolve({ ok: false }); }));
        const view = resetView(), resetting = view.reset();
        await new Promise(resolve => setImmediate(resolve));
        expect(view.model.render().account).toBeNull();
        expect(view.model.render().run(s => domain.signIn(s, VOLUNTEER)).ok).toBe(true);
        view.model.navigate('#/c/nearby'); view.render();
        (nodes(view.render(), AccountHeader)[0]!.props.onSettings as () => void)();
        const settings = nodes(view.render(), Settings)[0]!;
        (settings.props.onSize as (size: string) => void)('larger');
        finish(); expect(await resetting).toBe(false);
        expect(view.model.render().account?.id).toBe(VOLUNTEER);
        expect(window.location.hash).toBe('#/c/nearby');
        const tree = view.render();
        expect(nodes(tree, Settings)[0]!.props.textSize).toBe('larger');
        expect(nodes(tree, 'p').filter(node => node.props.role === 'status')).toHaveLength(0);
        expect(clear).toHaveBeenCalledOnce(); expect(native).toHaveBeenCalledTimes(pending === 'native' ? 1 : 0);
    });
    it.each(['type', 'talk'])('remounts the %s Ask screen after a same-account reset and sign-in', screen => {
        const view = resetView(); view.model.navigate(`#/c/${screen}`);
        const before = nodes(view.render(), AskScreen)[0]!;
        expect(view.model.render().reset().ok).toBe(true);
        expect(view.model.render().run(s => domain.signIn(s, ELDER)).ok).toBe(true);
        // Render only the final snapshot, as with a batched reset and sign-in.
        const after = nodes(view.render(), AskScreen)[0]!;
        expect(after.props.account).toMatchObject({ id: ELDER });
        expect(after.key).not.toBe(before.key);
    });
    it('invalidates the draft and settings on reset epoch changes even for the same account', () => {
        const storage = new MemoryStorage(); domain.saveCommunity(storage, stateOf(domain.signIn(domain.createSeedState(NOW), ELDER)));
        const model = client(storage); let controller = model.render();
        vi.stubGlobal('document', { documentElement: { style: { fontSize: '' }, dataset: {} }, querySelector: () => null });
        const body = driver(() => CommunityBody({ controller, language: 'en', onGuestLanguage() {} }));
        const initial = body.render();
        (nodes(initial, AccountHeader)[0]!.props.onSettings as () => void)();
        expect(nodes(body.render(), Settings)).toHaveLength(1);
        const draft: Draft = { analysis: domain.quickPickAnalysis('light-bulb', 'en'), text: 'My request', source: 'typed', evidence: [] };
        (nodes(body.render(), ElderHome)[0]!.props.onDraft as (draft: Draft) => void)(draft);
        model.navigate('#/c/draft');
        expect(nodes(body.render(), DraftScreen)).toHaveLength(1);
        // Same-account replacement from another client must still invalidate settings.
        controller = { ...controller, resetEpoch: 'new-epoch' };
        body.render();
        expect(nodes(body.render(), Settings)).toHaveLength(0);
        expect(nodes(body.render(), DraftScreen)).toHaveLength(0);
    });
});
