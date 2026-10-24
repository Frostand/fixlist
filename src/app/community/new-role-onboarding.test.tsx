import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as domain from '../../community';
import { createCommunityStore } from '../../community/storage';
import type { AccountRole, CommunityState } from '../../community/types';
import { CommunityBody, Tabs } from './CommunityApp';
import { DemoAccountChoices, Setup, SignIn, type SetupValues } from './Onboarding';
import { Availability, Back, Chips, LanguageSelect } from './UI';
import type { CommunityController } from './useCommunity';

// Exercise real component handlers and the durable store without adding a DOM dependency.
interface Driver { cursor: number; values: unknown[]; effects: Array<() => void>; cleanups: Array<() => void> }
const runtime = vi.hoisted(() => ({ active: null as Driver | null }));
vi.mock('react', async original => {
    const actual = await original<typeof import('react')>();
    return { ...actual,
        useState(initial: unknown) {
            const d = runtime.active;
            if (!d) return actual.useState(initial);
            const i = d.cursor++;
            if (!(i in d.values)) d.values[i] = typeof initial === 'function' ? initial() : initial;
            return [d.values[i], (v: unknown) => { d.values[i] = typeof v === 'function' ? v(d.values[i]) : v; }];
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
            if (!deps || !prior || deps.some((v, index) => !Object.is(v, prior[index]))) {
                d.values[i] = deps;
                d.effects.push(() => { d.cleanups[i]?.(); const cleanup = effect(); d.cleanups[i] = typeof cleanup === 'function' ? cleanup : () => {}; });
            }
        },
    };
});
vi.mock('../../i18n', async original => {
    const actual = await original<typeof import('../../i18n')>();
    return { ...actual, useT: () => Object.assign((key: import('../../i18n').MessageKey, values?: import('../../i18n').Values) => actual.translate('en', key, values), { language: 'en' }) };
});
vi.mock('./NearbyMap', () => ({ default: () => null }));
const cleanups: Array<() => void> = [];
function driver<T>(render: () => T) {
    const d: Driver = { cursor: 0, values: [], effects: [], cleanups: [] };
    cleanups.push(() => d.cleanups.forEach(cleanup => cleanup?.()));
    return { render() { d.cursor = 0; runtime.active = d; let result: T; try { result = render(); } finally { runtime.active = null; } d.effects.splice(0).forEach(run => run()); return result; } };
}
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const NOW = '2026-10-23T12:00:00.000Z';
const blankId = (role: 'elder' | 'volunteer') => `${role}-new-demo`;
class MemoryStorage implements Storage {
    values = new Map<string, string>();
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    key(i: number) { return [...this.values.keys()][i] ?? null; }
    getItem(k: string) { return this.values.get(k) ?? null; }
    setItem(k: string, v: string) { this.values.set(k, v); }
    removeItem(k: string) { this.values.delete(k); }
}
function nodes(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) return node.flatMap(n => nodes(n, type));
    if (!isValidElement<{ children?: ReactNode }>(node)) return [];
    return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...nodes(node.props.children, type)];
}
function one(node: ReactNode, type: unknown) { const found = nodes(node, type); expect(found).toHaveLength(1); return found[0]!; }
function invoke(node: ReactElement<Record<string, unknown>>, prop: string, ...args: unknown[]) { return (node.props[prop] as (...args: unknown[]) => unknown)(...args); }
function submit(tree: ReactNode) { invoke(one(tree, 'form'), 'onSubmit', { preventDefault() {} }); }
function input(tree: ReactNode, index: number, value: string) { invoke(nodes(tree, 'input')[index]!, 'onChange', { target: { value } }); }
function values(role: AccountRole): SetupValues {
    return { role, name: ' New Person ', area: ' Suwanee, GA ', language: 'es', needs: ['Using ladders'], skills: ['yard', 'errands'], tools: ['gloves', 'car'], availability: [{ day: 2, part: 'evening' }], maxMiles: 23, school: ' Demo School ', elderId: 'elder-margaret' };
}
function app(initial = domain.createSeedState(NOW), hash = '#/c/signin') {
    const storage = new MemoryStorage(); domain.saveCommunity(storage, initial);
    const store = createCommunityStore(storage, () => NOW);
    const listeners = new Map<string, () => void>();
    let currentHash = hash;
    const location = { get hash() { return currentHash; }, set hash(value: string) { currentHash = value.startsWith('#') ? value : `#${value}`; } };
    vi.stubGlobal('window', { location, scrollTo() {}, addEventListener(type: string, callback: () => void) { listeners.set(type, callback); }, removeEventListener(type: string) { listeners.delete(type); } });
    vi.stubGlobal('document', { documentElement: { style: { fontSize: '' }, dataset: {} }, querySelector: () => null });
    const view = driver(() => {
        const c: CommunityController = { state: store.state, account: domain.currentAccount(store.state), run: store.run, reset: store.reset, resetEpoch: store.resetEpoch, issue: store.issue, clearIssue: store.clearIssue };
        return CommunityBody({ controller: c, language: c.account?.language ?? 'en', onGuestLanguage() {} });
    });
    return { storage, store, location, render: view.render, navigate(hash: string) { location.hash = hash; listeners.get('hashchange')?.(); } };
}
function signed(state: CommunityState, id: string) { const r = domain.signIn(state, id); if (!r.ok) throw new Error(r.message); return r.state; }

describe('complete role setup journeys', () => {
    it('loads older valid saved state without injecting demos or rewriting bytes', () => {
        const seed = domain.createSeedState(NOW), ids = ['elder-new-demo', 'volunteer-new-demo'];
        const older = { ...seed, accounts: seed.accounts.filter(a => !ids.includes(a.id)), elders: seed.elders.filter(e => !ids.includes(e.accountId)), volunteers: seed.volunteers.filter(v => !ids.includes(v.accountId)) };
        const storage = new MemoryStorage(), raw = JSON.stringify(older); storage.setItem(domain.COMMUNITY_STORAGE_KEY, raw);
        const write = vi.spyOn(storage, 'setItem'), store = createCommunityStore(storage, () => NOW);
        expect(domain.loadCommunity(storage, NOW)).toEqual({ status: 'loaded', state: older }); expect(store.state).toEqual(older);
        expect(storage.getItem(domain.COMMUNITY_STORAGE_KEY)).toBe(raw); expect(write).not.toHaveBeenCalled();
    });
    it.each(['elder', 'volunteer'] as const)('persists every %s field through the full blank-demo form and reload, in place', role => {
        const a = app(), count = a.store.state.accounts.length;
        const sign = one(a.render(), SignIn);
        invoke(sign, 'onSignIn', blankId(role), 'google');
        expect(a.location.hash).toBe(`#/c/setup/${role}`);
        a.navigate(a.location.hash);
        const setupNode = one(a.render(), Setup);
        let props = setupNode.props as unknown as Parameters<typeof Setup>[0];
        expect(props.role).toBe(role);
        const form = driver(() => Setup(props));
        expect(nodes(form.render(), 'input').map(n => n.props.value)).toEqual(['', '']);
        input(form.render(), 0, ' New Person '); input(form.render(), 1, ' Suwanee, GA ');
        invoke(one(form.render(), LanguageSelect), 'onChange', 'es');
        props = one(a.render(), Setup).props as unknown as Parameters<typeof Setup>[0];
        expect(a.store.state.session.onboarded).not.toContain(blankId(role));
        expect(a.store.state.accounts.find(account => account.id === blankId(role))!.language).toBe('en');
        submit(form.render());
        if (role === 'elder') {
            invoke(one(form.render(), Chips), 'onChange', ['ladders']);
        } else {
            const chips = nodes(form.render(), Chips);
            expect(chips.map(n => n.props.selected)).toEqual([[], []]);
            invoke(chips[0]!, 'onChange', ['yard', 'errands']); invoke(chips[1]!, 'onChange', ['gloves', 'car']);
            submit(form.render());
            expect(one(form.render(), Availability).props.value).toEqual([]);
            invoke(one(form.render(), Availability), 'onChange', [{ day: 2, part: 'evening' }]);
            input(form.render(), 0, '23'); input(form.render(), 1, ' Demo School ');
        }
        submit(form.render());
        const loaded = domain.loadCommunity(a.storage, NOW).state, id = blankId(role);
        expect(loaded.accounts).toHaveLength(count);
        expect(loaded.accounts.find(account => account.id === id)).toMatchObject({ name: 'New Person', firstName: 'New', area: 'Suwanee, GA', language: 'es' });
        expect(loaded.session.onboarded).toContain(id);
        if (role === 'elder') expect(loaded.elders.find(p => p.accountId === id)).toMatchObject({ needs: ['Using ladders'], familyIds: [], addressHint: '' });
        else expect(loaded.volunteers.find(p => p.accountId === id)).toMatchObject({ skills: ['yard', 'errands'], tools: ['gloves', 'car'], availability: [{ day: 2, part: 'evening' }], maxMiles: 23, school: 'Demo School', badges: { idChecked: false, backgroundCheck: false } });
        invoke(setupNode, 'onComplete', values(role));
        expect(a.store.state.accounts).toHaveLength(count);
        expect(a.store.state.session.onboarded.filter(accountId => accountId === id)).toHaveLength(1);
        expect(a.location.hash).toBe(`#/c/${role === 'elder' ? 'home' : 'nearby'}`);
        const reloaded = app(loaded, a.location.hash);
        expect(nodes(reloaded.render(), Setup)).toHaveLength(0); expect(nodes(reloaded.render(), Tabs)).toHaveLength(1);
    });

    it.each(['elder', 'volunteer'] as const)('creates a guest %s atomically and rejects a stale guest retry', role => {
        const a = app(undefined, `#/c/setup/${role}`), count = a.store.state.accounts.length;
        const setup = one(a.render(), Setup);
        invoke(setup, 'onComplete', values(role));
        expect(a.store.state.accounts).toHaveLength(count + 1);
        expect(a.store.state.session.onboarded).toContain(a.store.state.session.accountId);
        const id = a.store.state.session.accountId;
        if (role === 'elder') expect(a.store.state.elders.find(p => p.accountId === id)?.needs).toEqual(['Using ladders']);
        else expect(a.store.state.volunteers.find(p => p.accountId === id)).toMatchObject({ school: 'Demo School', maxMiles: 23, availability: values(role).availability });
        const first = a.store.state;
        invoke(setup, 'onComplete', values(role));
        expect(a.store.state).toBe(first);
        expect(domain.loadCommunity(a.storage, NOW).state).toEqual(first);
    });

    it.each(['elder', 'volunteer'] as const)('keeps failed %s storage commits incomplete and retries without a duplicate', role => {
        const a = app(undefined, `#/c/setup/${role}`), before = a.store.state, raw = a.storage.getItem(domain.COMMUNITY_STORAGE_KEY);
        const setup = one(a.render(), Setup), write = vi.spyOn(a.storage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        invoke(setup, 'onComplete', values(role));
        expect(a.store.state).toBe(before); expect(a.storage.getItem(domain.COMMUNITY_STORAGE_KEY)).toBe(raw);
        expect(a.location.hash).toBe(`#/c/setup/${role}`);
        write.mockRestore(); invoke(setup, 'onComplete', values(role));
        expect(a.store.state.accounts).toHaveLength(before.accounts.length + 1);
    });

    it.each(['elder', 'volunteer'] as const)('keeps a selected blank %s unchanged when storage is denied', role => {
        const a = app(signed(domain.createSeedState(NOW), blankId(role)), '#/c/home');
        const setup = one(a.render(), Setup), before = a.store.state;
        const write = vi.spyOn(a.storage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        invoke(setup, 'onComplete', values(role)); expect(a.store.state).toBe(before);
        expect(domain.loadCommunity(a.storage, NOW).state.session.onboarded).not.toContain(blankId(role));
        write.mockRestore(); invoke(setup, 'onComplete', values(role));
        expect(a.store.state.accounts).toHaveLength(before.accounts.length); expect(a.store.state.session.onboarded).toContain(blankId(role));
    });

    it('rejects a stale selected actor or wrong role without completion', () => {
        const a = app(signed(domain.createSeedState(NOW), 'elder-margaret'), '#/c/setup/elder');
        const setup = one(a.render(), Setup);
        a.store.run(s => domain.signIn(s, 'elder-rosa'));
        const latest = a.store.state;
        invoke(setup, 'onComplete', values('elder')); expect(a.store.state).toBe(latest);
        const currentSetup = one(a.render(), Setup);
        invoke(currentSetup, 'onComplete', values('volunteer')); expect(a.store.state).toBe(latest);
    });

    it.each([
        ['elder', { needs: ['x'.repeat(201)] }], ['elder', { name: '   ' }], ['elder', { area: '' }],
        ['volunteer', { maxMiles: -1 }], ['volunteer', { availability: [{ day: 8, part: 'evening' }] }],
        ['volunteer', { school: 'x'.repeat(201) }], ['volunteer', { skills: ['yard', 'yard'] }],
    ] as const)('rejects invalid %s fields without creating an account or claiming completion (%j)', (role, patch) => {
        const a = app(undefined, `#/c/setup/${role}`), before = a.store.state, raw = a.storage.getItem(domain.COMMUNITY_STORAGE_KEY);
        invoke(one(a.render(), Setup), 'onComplete', { ...values(role), ...patch });
        expect(a.store.state).toBe(before); expect(a.storage.getItem(domain.COMMUNITY_STORAGE_KEY)).toBe(raw);
        expect(a.location.hash).toBe(`#/c/setup/${role}`);
    });

    it.each(['elder', 'volunteer'] as const)('blocks direct routes for an incomplete %s and keeps back/account switching usable', role => {
        const state = signed(domain.createSeedState(NOW), blankId(role));
        const a = app(state, '#/c/home');
        for (const hash of ['#/c/home', '#/c/nearby', '#/c/job/job-past-margaret', '#/c/rooms', '#/c/messages/job-past-margaret', '#/c/setup/family']) {
            a.navigate(hash); const tree = a.render();
            expect(one(tree, Setup).props.role).toBe(role); expect(nodes(tree, Tabs)).toHaveLength(0);
        }
        invoke(one(a.render(), Setup), 'onBack');
        expect(a.store.state.session.accountId).toBeNull();
        a.navigate(a.location.hash);
        const tree = a.render(), sign = nodes(tree, SignIn)[0], choices = nodes(tree, DemoAccountChoices)[0];
        expect(sign ?? choices).toBeDefined();
        if (sign) invoke(sign, 'onSignIn', 'volunteer-jordan', 'email'); else invoke(choices!, 'onSelect', 'volunteer-jordan');
        a.navigate(a.location.hash); expect(nodes(a.render(), Setup)).toHaveLength(0);
    });

    it.each(['elder-margaret', 'volunteer-jordan', 'family-alex'])('preserves the completed %s demo home', id => {
        const a = app(signed(domain.createSeedState(NOW), id), '#/c/home');
        expect(nodes(a.render(), Setup)).toHaveLength(0); expect(nodes(a.render(), Tabs)).toHaveLength(1);
    });

    it.each(['elder', 'volunteer'] as const)('also guards an incomplete custom %s account on reload', role => {
        const created = domain.createAccount(domain.createSeedState(NOW), { role, name: 'Custom', area: 'Cumming', language: 'en', provider: 'email' }, NOW);
        if (!created.ok) throw new Error(created.message);
        const a = app(created.state, '#/c/jobs');
        expect(one(a.render(), Setup).props.role).toBe(role); expect(nodes(a.render(), Tabs)).toHaveLength(0);
    });

    it('restores the document language after leaving an unsaved setup-language preview', () => {
        const a = app(undefined, '#/c/setup/elder');
        invoke(one(a.render(), Setup), 'onLanguage', 'ar');
        expect(one(a.render(), Setup).props.language).toBe('ar');
        // The nested provider owns this DOM update in the browser.
        document.documentElement.lang = 'ar'; document.documentElement.dir = 'rtl';
        a.navigate('#/c/intro'); a.render();
        expect(document.documentElement.lang).toBe('en'); expect(document.documentElement.dir).toBe('ltr');
    });

    it('keeps form back navigation and selections intact, with no default availability', () => {
        const onBack = vi.fn();
        const form = driver(() => Setup({ role: 'volunteer', language: 'en', elders: [], onLanguage() {}, onComplete() {}, onBack }));
        input(form.render(), 0, 'Name'); input(form.render(), 1, 'Area'); submit(form.render());
        invoke(nodes(form.render(), Chips)[0]!, 'onChange', ['yard']); submit(form.render());
        expect(one(form.render(), Availability).props.value).toEqual([]);
        invoke(one(form.render(), Back), 'onClick'); expect(nodes(form.render(), Chips)[0]!.props.selected).toEqual(['yard']);
        invoke(one(form.render(), Back), 'onClick'); expect(nodes(form.render(), 'input')[0]!.props.value).toBe('Name');
        invoke(one(form.render(), Back), 'onClick'); expect(onBack).toHaveBeenCalledOnce();
    });
});
