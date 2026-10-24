import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthController } from '../../auth/controller';
import type { AuthState } from '../../auth/types';
import type { AuthConfiguration } from '../../auth/config';
import AuthApp, { AuthScreen } from './AuthApp';
import { Setup } from './Onboarding';
import { Button } from './UI';
interface Driver { cursor: number; values: unknown[] }
const runtime = vi.hoisted(() => ({ active: null as Driver | null }));
vi.mock('react', async original => {
    const actual = await original<typeof import('react')>();
    return { ...actual, useState(initial: unknown) { const d = runtime.active; if (!d) return actual.useState(initial); const i = d.cursor++; if (!(i in d.values)) d.values[i] = typeof initial === 'function' ? initial() : initial; return [d.values[i], (v: unknown) => { d.values[i] = typeof v === 'function' ? v(d.values[i]) : v; }]; }, useEffect() {} };
});
afterEach(() => { vi.unstubAllGlobals(); });
function driver(render: () => ReactNode) { const d: Driver = { cursor: 0, values: [] }; return () => { d.cursor = 0; runtime.active = d; try { return render(); } finally { runtime.active = null; } }; }
function nodes(n: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] { if (Array.isArray(n)) return n.flatMap(v => nodes(v, type)); if (!isValidElement<{ children?: ReactNode }>(n)) return []; return [...(n.type === type ? [n as ReactElement<Record<string, unknown>>] : []), ...nodes(n.props.children, type)]; }
function text(n: ReactNode): string { if (Array.isArray(n)) return n.map(text).join(''); if (isValidElement<{ children?: ReactNode }>(n)) return text(n.props.children); return typeof n === 'string' ? n : ''; }
function call(n: ReactElement<Record<string, unknown>>, prop: string, ...args: unknown[]) { return (n.props[prop] as (...a: unknown[]) => unknown)(...args); }
function press(tree: ReactNode, label: string) { const b = nodes(tree, Button).find(n => text(n.props.children as ReactNode) === label)!; expect(b).toBeDefined(); call(b, 'onClick'); }
const blank: AuthState = { phase: 'signed-out', session: null, workspace: null, profile: null, message: null, busy: false };
const cfg: AuthConfiguration = { config: { backendId: 'https://test.supabase.co', url: 'https://test.supabase.co', publishableKey: 'sb_publishable_syntheticpubliconly', storageKey: 'test', redirectUrl: 'https://fixlist.example/', native: false, google: true, appleWeb: true, appleNative: false }, reason: null };
function controller() { return { signIn: vi.fn(), register: vi.fn(), resendConfirmation: vi.fn(), requestReset: vi.fn(), oauth: vi.fn(), updatePassword: vi.fn(), saveProfile: vi.fn(), signOut: vi.fn(), refresh: vi.fn(), cancel: vi.fn() } as unknown as AuthController; }
function fill(tree: ReactNode, index: number, value: string) { call(nodes(tree, 'input')[index]!, 'onChange', { target: { value } }); }
function submit(tree: ReactNode) { call(nodes(tree, 'form')[0]!, 'onSubmit', { preventDefault() {} }); }
describe('actual real account UI handlers (no demo provider selectors)', () => {
    it('starts outside demo; choosing demos is explicit and reversible', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://fixlist.example', hash: '' } });
        const view = driver(() => AuthApp({ demo: <div>fictional-data-only</div> }));
        const screen = nodes(view(), AuthScreen)[0]!; expect(text(view())).not.toContain('fictional-data-only');
        call(screen, 'onDemo'); await Promise.resolve(); expect(text(view())).toContain('Local demo mode'); expect(text(view())).toContain('fictional-data-only');
        call(nodes(view(), 'button')[0]!, 'onClick'); expect(text(view())).not.toContain('fictional-data-only');
    });
    it('email forms dispatch real register/login/reset calls and clear passwords', () => {
        const c = controller(), view = driver(() => AuthScreen({ state: blank, controller: c, configuration: cfg, onDemo() {} }));
        fill(view(), 0, 'person@example.test'); fill(view(), 1, 'synthetic-password'); submit(view());
        expect(c.signIn).toHaveBeenCalledWith('person@example.test', 'synthetic-password'); expect(nodes(view(), 'input')[1]?.props.value).toBe('');
        press(view(), 'Create account'); fill(view(), 1, 'new-password'); submit(view()); expect(c.register).toHaveBeenCalledWith('person@example.test', 'new-password');
        press(view(), 'Forgot password?'); expect(nodes(view(), 'input')).toHaveLength(1); submit(view()); expect(c.requestReset).toHaveBeenCalledWith('person@example.test');
        press(view(), 'Continue with Google'); press(view(), 'Continue with Apple'); expect(c.oauth).toHaveBeenNthCalledWith(1, 'google'); expect(c.oauth).toHaveBeenNthCalledWith(2, 'apple');
        expect(text(view())).not.toContain('Margaret');
    });
    it('confirmation/reset errors are visible and recovery update is separate from login', () => {
        const c = controller(); let state: AuthState = { ...blank, message: 'confirmation' };
        const view = driver(() => AuthScreen({ state, controller: c, configuration: cfg, onDemo() {} }));
        fill(view(), 0, 'person@example.test'); press(view(), 'Resend confirmation email'); expect(c.resendConfirmation).toHaveBeenCalledWith('person@example.test');
        expect(text(view())).toContain('same device and browser'); state = { ...blank, phase: 'recovery', message: 'auth-error' };
        fill(view(), 0, 'replacement-password'); submit(view()); expect(c.updatePassword).toHaveBeenCalledWith('replacement-password');
        expect(nodes(view(), 'p').some(n => n.props.role === 'alert')).toBe(true);
    });
    it.each(['elder', 'volunteer'] as const)('real %s setup passes preferences to verified controller, never demo account/link IDs', role => {
        const c = controller(), state: AuthState = { ...blank, phase: 'onboarding' };
        const view = driver(() => AuthScreen({ state, controller: c, configuration: cfg, onDemo() {} }));
        press(view(), role === 'elder' ? 'I need help at home' : 'I want to volunteer'); const setup = nodes(view(), Setup)[0]!;
        expect(setup.props.elders).toEqual([]); call(setup, 'onComplete', { name: 'Person', role, language: 'en', area: 'Town', needs: [], skills: [], tools: [], availability: [], maxMiles: 10, school: '', elderId: 'forged-demo-id' });
        expect(c.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ role })); expect(c.saveProfile).not.toHaveBeenCalledWith(expect.objectContaining({ elderId: expect.anything() }));
    });
    it('missing config disables real providers and forms without a demo fallback', () => {
        const tree = driver(() => AuthScreen({ state: blank, controller: null, configuration: { config: null, reason: 'native-unavailable' }, onDemo() {} }))();
        expect(text(tree)).toContain('unavailable in this iPhone build'); expect(nodes(tree, 'input').every(n => n.props.disabled)).toBe(true);
        expect(nodes(tree, Button).filter(n => /Continue with/.test(text(n.props.children as ReactNode))).every(n => n.props.disabled)).toBe(true);
    });
    it('ready account has no seeded activity and no operational community/capture routes', () => {
        const state: AuthState = { ...blank, phase: 'ready', profile: { userId: 'verified', role: 'volunteer', name: 'Person', area: 'Town', language: 'en', needs: [], skills: [], tools: [], availability: [], maxMiles: 10, school: '', updatedAt: '' } };
        const tree = driver(() => AuthScreen({ state, controller: controller(), configuration: cfg, onDemo() {} }))();
        const html = renderToStaticMarkup(<>{tree}</>); expect(html).toContain('Community features are not available yet'); expect(html).not.toContain('href="#/c/');
        expect(html).not.toContain('Margaret'); expect(html).toContain('screening badges');
    });
});
