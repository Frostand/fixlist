import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAuthConfig } from './config';
import type { ProfileInput } from './types';
import { AuthController } from './controller';
import { SupabaseAuthGateway } from './supabase';
import type { NativeAuthPlugin } from './native';
const uid = '11111111-1111-4111-8111-111111111111';
const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'person@example.test', confirmed_at: '2026-10-24T00:00:00Z', app_metadata: {}, user_metadata: {}, created_at: '2026-10-24T00:00:00Z' };
const token = { access_token: 'header.payload.signature', refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, user };
const env = { VITE_SUPABASE_URL: 'https://fixlist-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_syntheticpubliconly', VITE_AUTH_GOOGLE_ENABLED: 'true', VITE_AUTH_APPLE_WEB_ENABLED: 'true', VITE_AUTH_APPLE_NATIVE_ENABLED: 'true' };
const clients: SupabaseClient[] = [];
afterEach(async () => { for (const c of clients.splice(0)) { c.auth.stopAutoRefresh(); await c.auth.dispose(); } });
function harness(native: NativeAuthPlugin | null = null) {
    const cfg = readAuthConfig(env, 'https://fixlist.example', !!native, true).config!;
    const map = new Map<string, string>(), storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
    let fail = '', verified = user, profile: Record<string, unknown> | null = null;
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
        const u = String(url), body = options?.body ? JSON.parse(String(options.body)) as Record<string, unknown> : {};
        calls.push({ url: u, body });
        const path = new URL(u).pathname;
        if (fail && path.endsWith(fail)) return new Response(JSON.stringify({ msg: 'synthetic failure', code: 'email_not_confirmed' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        if (path.endsWith('/account_profiles')) {
            if (options?.method === 'POST') profile = { ...body, updated_at: '2026-10-24T00:00:00Z' };
            return new Response(JSON.stringify(options?.method === 'POST' ? profile : profile ? [profile] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const data = path.endsWith('/user') ? verified : path.endsWith('/signup') ? user : path.endsWith('/token') ? token : {};
        return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = createClient(cfg.url, cfg.publishableKey, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: false, autoRefreshToken: false, storageKey: cfg.storageKey, storage }, global: { fetch: fetcher } }); clients.push(client);
    const navigate = vi.fn(), g = new SupabaseAuthGateway(cfg, storage, client, native, navigate);
    return { cfg, g, client, map, calls, navigate, fail(path: string) { fail = path; }, verified(u: typeof user) { verified = u; } };
}
function redirect(h: ReturnType<typeof harness>, endpoint: string) { return new URL(h.calls.find(c => c.url.includes(endpoint))!.url).searchParams.get('redirect_to')!; }
function callback(url: string, code = 'synthetic-once') { const u = new URL(url); u.searchParams.set('code', code); return u.href; }
describe('official Supabase SDK lifecycle with mocked transport', () => {
    it('email registration persists PKCE across reconstruction, confirms once, verifies identity with backend, and clears verifier slots', async () => {
        const h = harness(); expect(await h.g.register('person@example.test', 'synthetic-password')).toBe('confirmation');
        expect(h.calls[0]?.body.code_challenge_method).toBe('s256');
        const returnTo = redirect(h, '/signup'); expect(new URL(returnTo).searchParams.get('fl_auth')).toEqual(expect.any(String));
        expect(h.map.has(`${h.cfg.storageKey}-code-verifier`)).toBe(true);
        expect(await h.g.getVerifiedSession()).toBeNull();
        const fresh = new SupabaseAuthGateway(h.cfg, { getItem: k => h.map.get(k) ?? null, setItem: (k, v) => { h.map.set(k, v); }, removeItem: k => { h.map.delete(k); } }, h.client, null, () => {});
        expect(await fresh.callback(callback(returnTo))).toBe('signed-in'); expect(await fresh.callback(callback(returnTo))).toBe('ignored');
        const session = await fresh.getVerifiedSession(); expect(session?.userId).toBe(uid); expect(h.calls.some(c => c.url.endsWith('/user'))).toBe(true);
        const exchange = h.calls.find(c => c.url.includes('grant_type=pkce'))!;
        expect(exchange.body.code_verifier).toEqual(expect.any(String)); expect(exchange.body.auth_code).toBe('synthetic-once');
        expect([...h.map.keys()].some(k => k.endsWith('code-verifier'))).toBe(false);
    });
    it('resend starts a fresh persisted PKCE confirmation and rejects backend email/login errors', async () => {
        const h = harness(); await h.g.resendConfirmation('person@example.test');
        expect(h.calls[0]?.body.code_challenge_method).toBe('s256');
        expect(await h.g.callback(callback(redirect(h, '/resend')))).toBe('signed-in');
        await h.g.signOut(); h.fail('/token'); await expect(h.g.signIn('person@example.test', 'wrong')).rejects.toThrow();
        expect(await h.g.getVerifiedSession()).toBeNull();
    });
    it('duplicate delivery preserves a failed exchange instead of hiding it as an ignored callback', async () => {
        const h = harness(); await h.g.requestReset('person@example.test'); const url = callback(redirect(h, '/recover'));
        h.fail('/token'); await expect(h.g.callback(url)).rejects.toThrow(); await expect(h.g.callback(url)).rejects.toThrow();
        expect(h.calls.filter(c => c.url.includes('grant_type=pkce'))).toHaveLength(1);
    });
    it.each([false, true])('StrictMode cleanup/restart preserves callback result and failure visibility (failed=%s)', async failed => {
        const h = harness(); await h.g.requestReset('person@example.test'); const url = callback(redirect(h, '/recover'));
        if (failed) h.fail('/token'); const c = new AuthController(h.g);
        const start = c.start(), first = c.callback(url); c.dispose(); const restart = c.start(), second = c.callback(url);
        await Promise.all([start, first, restart, second]);
        expect(c.state.phase).toBe(failed ? 'signed-out' : 'recovery');
        expect(c.state.message).toBe(failed ? 'auth-error' : null);
        expect(h.calls.filter(v => v.url.includes('grant_type=pkce'))).toHaveLength(1); c.dispose();
    });
    it('backend identity verification rejects cached user spoofing and backend failure', async () => {
        const h = harness(); await h.g.signIn('person@example.test', 'synthetic-password');
        h.verified({ ...user, id: 'another-uid' }); await expect(h.g.getVerifiedSession()).rejects.toThrow();
        h.fail('/user'); await expect(h.g.getVerifiedSession()).rejects.toThrow();
    });
    it('reset callback persists recovery mode across reload; failures preserve it until password updated', async () => {
        const h = harness(); await h.g.requestReset('person@example.test');
        expect(await h.g.callback(callback(redirect(h, '/recover')))).toBe('recovery');
        expect((await h.g.getVerifiedSession())?.recovery).toBe(true);
        h.fail('/user'); await expect(h.g.updatePassword('synthetic-password')).rejects.toThrow();
        expect(h.map.get(`${h.cfg.storageKey}:recovery`)).toBe(uid);
        h.fail(''); await h.g.updatePassword('synthetic-password'); expect((await h.g.getVerifiedSession())?.recovery).toBe(false);
    });
    it('Google and Apple web use PKCE authorization URL, exact callback, and cancellation invalidates returns', async () => {
        const h = harness(); await h.g.oauth('google'); const url = new URL(h.navigate.mock.calls[0]![0] as string);
        expect(url.searchParams.get('provider')).toBe('google'); expect(url.searchParams.get('code_challenge_method')).toBe('s256');
        expect(url.searchParams.has('code_verifier')).toBe(false);
        await h.g.cancel(); expect(await h.g.callback(callback(url.searchParams.get('redirect_to')!))).toBe('ignored');
        await h.g.oauth('apple'); expect(new URL(h.navigate.mock.calls[1]![0] as string).searchParams.get('provider')).toBe('apple');
    });
    it.each(['elder', 'volunteer'] as const)('writes only bounded %s preferences using verified UID, then reloads through PostgREST', async role => {
        const h = harness(); await h.g.signIn('person@example.test', 'synthetic-password');
        const session = (await h.g.getVerifiedSession())!, signal = new AbortController().signal;
        expect(await h.g.getProfile(session.userId, signal)).toBeNull();
        const input: ProfileInput = { role, name: ' Person ', area: ' Town ', language: 'en', needs: role === 'elder' ? ['Ladders'] : [], skills: ['yard'], tools: ['gloves'], availability: [{ day: 2, part: 'evening' }], maxMiles: 23, school: 'School' };
        const saved = await h.g.saveProfile(session.userId, { ...input, badges: { backgroundCheck: true }, elderId: 'demo-forgery' } as ProfileInput, signal);
        expect(saved).toMatchObject({ userId: uid, role, name: 'Person', area: 'Town' });
        const row = h.calls.find(c => c.url.includes('/account_profiles') && Object.keys(c.body).length > 0)!.body;
        expect(row.user_id).toBe(uid); expect(row).not.toHaveProperty('badges'); expect(row).not.toHaveProperty('elderId'); expect(row).not.toHaveProperty('jobs');
        expect(await h.g.getProfile(session.userId, signal)).toEqual(saved);
    });
    it('cancels queued native auth before it can open a provider prompt', async () => {
        const appleSignIn = vi.fn(async () => ({ token: 'synthetic-apple-token', nonce: 'synthetic-raw-nonce' }));
        const h = harness({ appleSignIn, cancel: vi.fn(async () => {}) } as unknown as NativeAuthPlugin);
        const pending = h.g.oauth('apple'); const cancelled = h.g.cancel();
        await Promise.allSettled([pending, cancelled]); expect(appleSignIn).not.toHaveBeenCalled(); expect(h.calls).toHaveLength(0);
    });
    it('Apple native sends the raw nonce with ID token to backend, never selects a demo account', async () => {
        const appleSignIn = vi.fn(async () => ({ token: 'synthetic-apple-token', nonce: 'synthetic-raw-nonce' }));
        const h = harness({ appleSignIn, cancel: vi.fn(async () => {}) } as unknown as NativeAuthPlugin);
        await h.g.oauth('apple'); expect(appleSignIn).toHaveBeenCalledOnce();
        expect(h.calls[0]?.body).toMatchObject({ provider: 'apple', id_token: 'synthetic-apple-token', nonce: 'synthetic-raw-nonce' });
        expect((await h.g.getVerifiedSession())?.userId).toBe(uid); expect(h.navigate).not.toHaveBeenCalled();
        await h.g.signOut(); expect(h.map.has(h.cfg.storageKey)).toBe(false);
    });
});
