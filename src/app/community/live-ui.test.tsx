import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceFor, type AccountProfile, type AuthState } from '../../auth/types';
import type { AuthController } from '../../auth/controller';
import type { LiveDiscoveryJob, LiveJobDetails as Details, LiveResult } from '../../community/ports';
import type { Language } from '../../community/types';
import { LiveWorkspace, LiveCommunityApp } from './LiveCommunityApp';
import { LiveRequestDraft } from './LiveRequestDraft';
import { LiveJobDetails } from './LiveJobDetails';
import { LiveCommunityController, LiveRetryScope } from './live-controller';
import { ELDER, VOLUNTEER, liveFixture } from './live-fixture.test-support';
import { Button } from './UI';
import { AuthScreen, VerifiedCommunity } from './AuthApp';

interface DriverState { cursor: number; values: unknown[]; effects: Array<() => void>; cleanups: Array<() => void> }
const runtime = vi.hoisted(() => ({ active: null as DriverState | null, language: 'en' as Language }));
vi.mock('react', async original => {
    const actual = await original<typeof import('react')>();
    return { ...actual,
        useState(initial: unknown) {
            const d = runtime.active; if (!d) return actual.useState(initial);
            const i = d.cursor++; if (!(i in d.values)) d.values[i] = typeof initial === 'function' ? initial() : initial;
            return [d.values[i], (v: unknown) => { d.values[i] = typeof v === 'function' ? v(d.values[i]) : v; }];
        },
        useRef(initial: unknown) {
            const d = runtime.active; if (!d) return actual.useRef(initial);
            const i = d.cursor++; if (!(i in d.values)) d.values[i] = { current: initial };
            return d.values[i];
        },
        useMemo<T>(factory: () => T, deps: readonly unknown[]) {
            const d = runtime.active; if (!d) return actual.useMemo(factory, deps);
            const i = d.cursor++, prior = d.values[i] as { value: T; deps: readonly unknown[] } | undefined;
            if (!prior || deps.some((v, j) => !Object.is(v, prior.deps[j]))) d.values[i] = { value: factory(), deps };
            return (d.values[i] as { value: T }).value;
        },
        useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
            const d = runtime.active; if (!d) return actual.useEffect(effect, deps);
            const i = d.cursor++, prior = d.values[i] as readonly unknown[] | undefined;
            if (!deps || !prior || deps.some((v, j) => !Object.is(v, prior[j]))) {
                d.values[i] = deps; d.effects.push(() => { d.cleanups[i]?.(); const cleanup = effect(); d.cleanups[i] = typeof cleanup === 'function' ? cleanup : () => {}; });
            }
        },
    };
});
vi.mock('../../i18n', async original => {
    const actual = await original<typeof import('../../i18n')>();
    return { ...actual, useT: () => Object.assign((key: import('../../i18n').MessageKey) => actual.translate(runtime.language, key), { language: runtime.language }) };
});
function driver(render: () => ReactNode) {
    const d: DriverState = { cursor: 0, values: [], effects: [], cleanups: [] };
    return { state: d, render() { d.cursor = 0; runtime.active = d; let tree; try { tree = render(); } finally { runtime.active = null; } d.effects.splice(0).forEach(run => run()); return tree; }, unmount() { d.cleanups.forEach(cleanup => cleanup?.()); } };
}
function nodes(n: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(n)) return n.flatMap(v => nodes(v, type)); if (!isValidElement<{ children?: ReactNode }>(n)) return [];
    return [...(n.type === type ? [n as ReactElement<Record<string, unknown>>] : []), ...nodes(n.props.children, type)];
}
function content(n: ReactNode): string { if (Array.isArray(n)) return n.map(content).join(''); if (isValidElement<{ children?: ReactNode }>(n)) return content(n.props.children); return typeof n === 'string' || typeof n === 'number' ? String(n) : ''; }
function call(n: ReactElement<Record<string, unknown>>, event: string, ...args: unknown[]) { return (n.props[event] as (...a: unknown[]) => unknown)(...args); }
function button(tree: ReactNode, label: string) { const n = nodes(tree, Button).find(n => content(n.props.children as ReactNode) === label); expect(n, label).toBeDefined(); return n!; }
function press(tree: ReactNode, label: string) { const n = button(tree, label); expect(n.props.disabled, label).not.toBe(true); return call(n, 'onClick'); }
function change(tree: ReactNode, type: string, index: number, value: string | boolean) { call(nodes(tree, type)[index]!, 'onChange', { target: typeof value === 'boolean' ? { checked: value } : { value } }); }
function submit(tree: ReactNode, index = 0) { call(nodes(tree, 'form')[index]!, 'onSubmit', { preventDefault() {} }); }
const settle = () => new Promise(resolve => setImmediate(resolve));
const profile = (userId: string, role: 'elder' | 'volunteer', language: Language = 'en'): AccountProfile => ({ userId, role, language, name: 'Test person', area: 'Test district', needs: [], skills: [], tools: [], availability: [], maxMiles: 10, school: '', updatedAt: '' });
afterEach(() => { vi.restoreAllMocks(); runtime.language = 'en'; });

describe('live React controls using injected async port', () => {
    it('collects phone help through the real live controls and posts the actual resolved outcome', async () => {
        const f = liveFixture(), c = new LiveCommunityController(f.port(ELDER, 'elder')); await c.start();
        const view = driver(() => LiveRequestDraft({ controller: c, language: 'en', locked: !!c.state.pending }));
        change(view.render(), 'textarea', 0, 'Help with my phone');
        change(view.render(), 'textarea', 1, 'Private address');
        press(view.render(), 'Review task and address'); await settle();
        expect(nodes(view.render(), 'input')).toHaveLength(0);
        expect(content(view.render())).toContain('What would you like to do with it?');
        change(view.render(), 'textarea', 0, 'make text larger');
        press(view.render(), 'Review task and address'); await settle();
        expect(content(view.render())).toContain('make text larger');
        change(view.render(), 'input', 0, true);
        press(view.render(), 'Post reviewed request'); await settle();
        expect(f.calls).toHaveLength(1);
        expect(f.calls[0]?.payload).toMatchObject({ originalText: 'Help with my phone\nmake text larger', analysis: { summaryEnglish: expect.stringContaining('make text larger') } });
        view.unmount(); c.dispose();
    });
    it('mounts only ready+profile+non-recovery verified session, keys by workspace, and routes the bound port to the shell', () => {
        const p = liveFixture().port(ELDER, 'elder'), factory = vi.fn(() => p);
        const c = { gateway: { createLiveCommunity: factory }, refresh: vi.fn(), signOut: vi.fn(async () => false) } as unknown as AuthController;
        const session = { userId: ELDER, backendId: p.identity.backendId, email: null, expiresAt: 100, recovery: false };
        let state: AuthState = { phase: 'ready', profile: profile(ELDER, 'elder'), session, workspace: workspaceFor(session), busy: false, message: null };
        const screen = driver(() => AuthScreen({ state, controller: c, configuration: { config: null, reason: 'not-configured' }, onDemo() {} }));
        const mount = nodes(screen.render(), VerifiedCommunity)[0]!; expect(mount.key).toBe(state.workspace!.namespace);
        const binding = driver(() => VerifiedCommunity({ state, controller: c })); const shell = nodes(binding.render(), LiveCommunityApp)[0]!;
        expect(shell.props.port).toBe(p); expect(factory).toHaveBeenCalledOnce(); call(shell, 'onSignOut'); expect(c.signOut).toHaveBeenCalledOnce();
        state = { ...state, session: { ...session } }; binding.render(); expect(factory).toHaveBeenCalledTimes(2);
        state = { ...state, phase: 'loading' }; expect(nodes(screen.render(), VerifiedCommunity)).toHaveLength(0);
        state = { ...state, phase: 'ready', session: { ...session, recovery: true } }; expect(nodes(screen.render(), VerifiedCommunity)).toHaveLength(0);
        state = { ...state, session: null }; expect(nodes(screen.render(), VerifiedCommunity)).toHaveLength(0);
        state = { ...state, session, profile: null }; expect(nodes(screen.render(), VerifiedCommunity)).toHaveLength(0);
    });
    it('refuses missing/current-session binding or a profile owner mismatch and exposes a recheck action', () => {
        const p = liveFixture().port(ELDER, 'elder'), session = { userId: ELDER, backendId: p.identity.backendId, email: null, expiresAt: 100 };
        const state: AuthState = { phase: 'ready', profile: profile(VOLUNTEER, 'volunteer'), session, workspace: workspaceFor(session), busy: false, message: null };
        for (const port of [null, p]) {
            const c = { gateway: { createLiveCommunity: () => port }, refresh: vi.fn() } as unknown as AuthController;
            const binding = driver(() => VerifiedCommunity({ state, controller: c })); expect(nodes(binding.render(), LiveCommunityApp)).toHaveLength(0);
            press(binding.render(), 'Recheck sign-in'); expect(c.refresh).toHaveBeenCalledOnce();
        }
    });
    it('explicitly reviews/posts, accepts, messages, advances, confirms, rates and reads policy credit using actual controls', async () => {
        const f = liveFixture(), ep = f.port(ELDER, 'elder'), vp = f.port(VOLUNTEER, 'volunteer');
        const elder = driver(() => LiveWorkspace({ port: ep, profile: profile(ELDER, 'elder'), onSignOut() {}, onRecheckSession() {} }));
        const volunteer = driver(() => LiveWorkspace({ port: vp, profile: profile(VOLUNTEER, 'volunteer'), onSignOut() {}, onRecheckSession() {} }));
        elder.render(); volunteer.render(); await settle();
        const ec = (elder.state.values[0] as { value: LiveCommunityController }).value, vc = (volunteer.state.values[0] as { value: LiveCommunityController }).value;
        const draft = driver(() => LiveRequestDraft({ controller: ec, language: 'en', locked: !!ec.state.pending }));
        change(draft.render(), 'textarea', 0, 'Please water my plants'); change(draft.render(), 'textarea', 1, 'Private test street');
        expect(f.calls).toHaveLength(0); press(draft.render(), 'Review task and address'); await settle();
        expect(button(draft.render(), 'Post reviewed request').props.disabled).toBe(true);
        change(draft.render(), 'input', 0, true); press(draft.render(), 'Post reviewed request'); await settle();
        expect(f.calls[0]?.payload).toMatchObject({ originalText: 'Please water my plants', address: 'Private test street', source: 'typed' });
        press(volunteer.render(), 'Retry / refresh community'); await settle();
        press(volunteer.render(), 'Accept request'); await settle(); expect(vc.state.details.value?.address).toBe('Private test street');
        const vd = driver(() => LiveJobDetails({ details: vc.state.details.value!, state: vc.state, controller: vc, language: 'en' }));
        change(vd.render(), 'textarea', 0, 'I can bring a watering can'); submit(vd.render()); await settle();
        for (const label of ['Mark on the way', 'Mark arrived', 'Report task done']) { press(vd.render(), label); await settle(); }
        expect(vc.state.credits.value?.items).toEqual([]); press(elder.render(), 'Retry / refresh community'); await settle();
        const ed = driver(() => LiveJobDetails({ details: ec.state.details.value!, state: ec.state, controller: ec, language: 'en' }));
        expect(content(ed.render())).toContain('I can bring a watering can'); expect(button(ed.render(), 'Confirm completed task').props.disabled).toBe(true);
        change(ed.render(), 'input', 0, true); press(ed.render(), 'Confirm completed task'); await settle();
        change(ed.render(), 'select', 0, '4'); change(ed.render(), 'textarea', 0, 'Thank you'); submit(ed.render()); await settle();
        expect(ec.state.details.value?.rating).toMatchObject({ stars: 4, note: 'Thank you' });
        press(volunteer.render(), 'Refresh credit ledger'); await settle();
        const html = renderToStaticMarkup(<>{volunteer.render()}</>); expect(html).toContain('20 approved minutes'); expect(html).toContain('not measured work duration or official school verification');
        elder.unmount(); volunteer.unmount();
    });
    it('blocks teams and transport attachments, preserves only bounded user text, and requires renewed review after edits', async () => {
        const f = liveFixture(), c = new LiveCommunityController(f.port(ELDER, 'elder')); await c.start();
        const view = driver(() => LiveRequestDraft({ controller: c, language: 'en', locked: !!c.state.pending }));
        expect(nodes(view.render(), 'textarea')[0]?.props.maxLength).toBe(4000);
        change(view.render(), 'textarea', 0, 'Move the heavy sofa to the kitchen'); change(view.render(), 'textarea', 1, 'Private address'); press(view.render(), 'Review task and address'); await settle(); change(view.render(), 'input', 0, true);
        expect(content(view.render())).toContain('more than one helper'); expect(button(view.render(), 'Post reviewed request').props.disabled).toBe(true);
        call(button(view.render(), 'Post reviewed request'), 'onClick'); await settle(); expect(f.calls).toHaveLength(0);
        change(view.render(), 'textarea', 0, 'Water plants blob:private-capture'); expect(button(view.render(), 'Review task and address').props.disabled).toBe(true);
        change(view.render(), 'textarea', 0, 'Water plants'); press(view.render(), 'Review task and address'); await settle(); change(view.render(), 'input', 0, true);
        change(view.render(), 'textarea', 1, 'Updated address'); expect(nodes(view.render(), 'input')).toHaveLength(0); expect(f.calls).toHaveLength(0);
    });
    it('locks duplicate clicks and edited draft while uncertain; retry uses the original UUID/input and refresh alone never posts', async () => {
        const f = liveFixture(), p = f.port(ELDER, 'elder'); f.loseResponse();
        const shell = driver(() => LiveWorkspace({ port: p, profile: profile(ELDER, 'elder'), onSignOut() {}, onRecheckSession() {} })); shell.render(); await settle();
        const c = (shell.state.values[0] as { value: LiveCommunityController }).value, draft = driver(() => LiveRequestDraft({ controller: c, language: 'en', locked: !!c.state.pending }));
        change(draft.render(), 'textarea', 0, 'Water plants'); change(draft.render(), 'textarea', 1, 'PRIVATE address'); press(draft.render(), 'Review task and address'); await settle(); change(draft.render(), 'input', 0, true);
        const post = button(draft.render(), 'Post reviewed request'); call(post, 'onClick'); call(post, 'onClick'); await settle();
        expect(f.calls).toHaveLength(1); expect(nodes(draft.render(), 'fieldset')[0]?.props.disabled).toBe(true);
        expect(content(shell.render())).toContain('It may already have saved'); expect(nodes(shell.render(), 'p').some(n => n.props.role === 'alert')).toBe(true);
        press(shell.render(), 'Retry / refresh community'); await settle(); expect(f.calls).toHaveLength(1);
        press(shell.render(), 'Retry same action'); await settle(); expect(f.calls).toHaveLength(2); expect(f.calls[1]?.key).toBe(f.calls[0]?.key); expect(f.calls[1]?.payload).toEqual(f.calls[0]?.payload);
        shell.unmount();
    });
    it.each(['pending', 'revoked'] as const)('offers read-only retry and sign out for %s access with no selfapproval', async state => {
        const f = liveFixture(); f.setAccess(state); const p = f.port(ELDER, 'elder'), signout = vi.fn();
        const view = driver(() => LiveWorkspace({ port: p, profile: profile(ELDER, 'elder'), onSignOut: signout, onRecheckSession() {} }));
        view.render(); await settle(); expect(nodes(view.render(), LiveRequestDraft)).toHaveLength(0);
        expect(content(view.render())).toContain('cannot approve your account'); press(view.render(), 'Retry / refresh community'); await settle(); expect(f.calls).toHaveLength(0);
        press(view.render(), 'Sign out'); expect(signout).toHaveBeenCalledOnce(); view.unmount();
    });
    it('treats server membership role as authority and never renders private extras in discovery', async () => {
        const f = liveFixture(), p = f.port(VOLUNTEER, 'volunteer');
        const secret = { id: '33333333-3333-4333-8333-333333333333', category: 'household', catalogTitle: 'Household help', coarseArea: 'Coarse district', neededSkills: ['general'], approvedServiceCreditMinutes: 20, address: 'NEVER_DISCOVER_ADDRESS', originalText: 'NEVER_DISCOVER_NARRATIVE', elderName: 'NEVER_DISCOVER_NAME' };
        vi.spyOn(p, 'discover').mockResolvedValue({ ok: true, value: { items: [secret as LiveDiscoveryJob], nextCursor: '1' } });
        const view = driver(() => LiveWorkspace({ port: p, profile: profile(VOLUNTEER, 'elder'), onSignOut() {}, onRecheckSession() {} })); view.render(); await settle();
        expect(nodes(view.render(), LiveRequestDraft)).toHaveLength(0); const html = renderToStaticMarkup(<>{view.render()}</>);
        expect(html).toContain('profile role is a preference'); expect(html).not.toContain('NEVER_DISCOVER'); expect(html).toContain('Coarse district'); expect(html).not.toContain('screened');
        expect(button(view.render(), 'Load more requests')).toBeDefined(); view.unmount();
    });
    it('renders messages chronologically by safe large ordinals with language annotations and escapes markup', async () => {
        const f = liveFixture(), c = new LiveCommunityController(f.port(ELDER, 'elder')); await c.start();
        const analysis = (await import('../../community/task-rules')).analyzeTaskWithRules('Water plants', 'en');
        await c.execute({ kind: 'post', input: { requestId: '33333333-3333-4333-8333-333333333333', originalText: 'Water plants', source: 'typed', analysis, address: 'Private address' } });
        const row = { id: '9007199254740993', jobId: f.details!.job.id, fromId: ELDER, text: '<img src=x onerror=alert(1)>', language: 'ar' as const, at: '2026-10-24T12:00:00Z' };
        c.state = { ...c.state, messages: { value: { items: [row, { ...row, id: '9007199254740992', text: 'First' }], nextCursor: '30' }, loading: false, error: null } };
        const view = driver(() => LiveJobDetails({ details: f.details!, controller: c, state: c.state, language: 'en' }));
        const html = renderToStaticMarkup(<>{view.render()}</>); expect(html.indexOf('First')).toBeLessThan(html.indexOf('&lt;img')); expect(html).not.toContain('<img'); expect(html).toContain('lang="ar" dir="auto"');
        expect(button(view.render(), 'Load older messages')).toBeDefined();
    });
    it('binds the selected language/RTL while explicitly labeling English live navigation and does not mount mismatched profiles', async () => {
        const f = liveFixture(), p = f.port(ELDER, 'elder'); runtime.language = 'ar';
        const view = driver(() => LiveWorkspace({ port: p, profile: profile(ELDER, 'elder', 'ar'), onSignOut() {}, onRecheckSession() {} })); view.render(); await settle();
        const html = renderToStaticMarkup(<>{view.render()}</>); expect(html).toContain('lang="en" dir="rtl"'); expect(html).toContain('currently in English'); expect(html).toContain('lang="ar"');
        const invalid = LiveCommunityApp({ port: p, profile: profile(VOLUNTEER, 'volunteer'), onSignOut() {}, onRecheckSession() {} }); expect(content(invalid)).toContain('do not match'); view.unmount();
    });
    it('unmount aborts an actual shell private query and a late response cannot publish or affect the next account', async () => {
        const f = liveFixture(), p = f.port(ELDER, 'elder'); let finish!: (value: LiveResult<Details>) => void, signal!: AbortSignal;
        vi.spyOn(p, 'details').mockImplementation(async (_job, s) => { signal = s; return new Promise(r => { finish = r; }); });
        const view = driver(() => LiveWorkspace({ port: p, profile: profile(ELDER, 'elder'), onSignOut() {}, onRecheckSession() {} })); view.render(); await settle();
        const c = (view.state.values[0] as { value: LiveCommunityController }).value; const selecting = c.select('33333333-3333-4333-8333-333333333333'); view.unmount(); expect(signal.aborted).toBe(true);
        finish({ ok: false, code: 'permission_denied' }); await selecting; expect(c.state.access.error).toBeNull(); expect(c.state.details.value).toBeNull();
    });
    it('rebinds the same-account port even if React batches away the loading render, retaining only the uncertain receipt', async () => {
        const f = liveFixture(), scope = new LiveRetryScope(); let p = f.port(ELDER, 'elder'); f.loseResponse();
        const view = driver(() => LiveWorkspace({ port: p, retryScope: scope, profile: profile(ELDER, 'elder'), onSignOut() {}, onRecheckSession() {} }));
        view.render(); await settle(); const first = (view.state.values[0] as { value: LiveCommunityController }).value;
        const analysis = (await import('../../community/task-rules')).analyzeTaskWithRules('Water plants', 'en');
        await first.execute({ kind: 'post', input: { requestId: '33333333-3333-4333-8333-333333333333', originalText: 'Water plants', source: 'typed', analysis, address: 'Private address' } });
        const pending = first.state.pending; p = f.port(ELDER, 'elder'); view.render(); await settle();
        const second = (view.state.values[0] as { value: LiveCommunityController }).value; expect(second).not.toBe(first); expect(first.state.jobs.value).toBeNull();
        expect(second.state.pending?.key).toBe(pending?.key); expect(content(view.render())).toContain('Action not confirmed');
        press(view.render(), 'Retry same action'); await settle(); expect(f.calls[1]?.key).toBe(f.calls[0]?.key); expect(f.calls[1]?.payload).toEqual(f.calls[0]?.payload);
        expect(second.state.pending).toBeNull(); view.unmount();
    });
});
