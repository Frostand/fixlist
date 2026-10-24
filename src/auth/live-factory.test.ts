import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseAuthGateway } from './supabase';
import type { AuthConfig } from './config';
const uid = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const at = '2026-10-24T00:00:00Z';
const config: AuthConfig = { url: 'https://factory-test.supabase.co', backendId: 'https://factory-test.supabase.co', publishableKey: 'sb_publishable_syntheticpubliconly', storageKey: 'factory-test', redirectUrl: 'https://fixlist.example/', native: false, google: false, appleWeb: false, appleNative: false };
const clients: SupabaseClient[] = [];
afterEach(async () => { for (const client of clients.splice(0)) { client.auth.stopAutoRefresh(); await client.auth.dispose(); } vi.restoreAllMocks(); });
function harness() {
    const map = new Map<string, string>(); let fault = false, activeId = uid, rpcGate: Promise<void> | null = null;
    const user = () => ({ id: activeId, email: 'test@example.invalid', aud: 'authenticated', role: 'authenticated', confirmed_at: at, created_at: at, app_metadata: {}, user_metadata: {} });
    const calls: Array<{ path: string; authorization: string | null }> = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        calls.push({ path, authorization: new Headers(init?.headers).get('Authorization') });
        if (path.includes('/rpc/')) await rpcGate;
        const body = path.endsWith('/user') ? user() : path.endsWith('/token') || path.endsWith('/verify') ? { access_token: `synthetic.${activeId}.token`, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, user: user() }
            : path.endsWith('/community_access') ? { ok: true, value: { state: 'approved', role: 'elder', community: { id: uid, label: 'Test community', coarseArea: 'Test district' } } } : {};
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const storage = { getItem: (key: string) => { if (fault) throw new Error('synthetic storage fault'); return map.get(key) ?? null; }, setItem: (key: string, value: string) => { if (fault) throw new Error('synthetic storage fault'); map.set(key, value); }, removeItem: (key: string) => { if (fault) throw new Error('synthetic storage fault'); map.delete(key); } };
    const client = createClient(config.url, config.publishableKey, { auth: { flowType: 'pkce', storageKey: config.storageKey, storage, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher } }); clients.push(client);
    const subscribe = vi.spyOn(client.auth, 'onAuthStateChange'), rpc = vi.spyOn(client, 'rpc');
    const gateway = new SupabaseAuthGateway(config, storage, client, null, () => {});
    const login = async () => { await gateway.signIn('test@example.invalid', 'synthetic-password'); return (await gateway.getVerifiedSession())!; };
    return { client, gateway, map, calls, fetcher, subscribe, rpc, login, fault(value: boolean) { fault = value; }, account(value: string) { activeId = value; }, gate(value: Promise<void> | null) { rpcGate = value; } };
}
const signal = () => new AbortController().signal;
const tick = () => new Promise(resolve => setImmediate(resolve));
describe('same SDK live-community gateway factory', () => {
    it('requires backend verification, reuses the exact SDK RPC and the one auth subscription, and keeps credentials out of DTOs', async () => {
        const h = harness(); await h.client.auth.signInWithPassword({ email: 'test@example.invalid', password: 'synthetic' });
        expect(h.gateway.createLiveCommunity({ userId: uid, backendId: config.backendId, recovery: false, expiresAt: 0, email: null })).toBeNull();
        const session = await h.gateway.getVerifiedSession(); expect(session).not.toBeNull();
        const port = h.gateway.createLiveCommunity(session!)!; h.gateway.createLiveCommunity(session!);
        const off = h.gateway.subscribe(() => {}); off();
        expect(h.subscribe).toHaveBeenCalledOnce();
        expect(await port.access(signal())).toMatchObject({ ok: true, value: { state: 'approved' } }); expect(h.rpc).toHaveBeenCalledOnce();
        expect(h.calls.find(v => v.path.endsWith('/community_access'))?.authorization).toBe(`Bearer synthetic.${uid}.token`);
        expect(JSON.stringify(port.identity)).toBe(JSON.stringify({ backendId: config.backendId, userId: uid }));
        expect(JSON.stringify(session)).not.toContain('synthetic'); expect(h.calls.some(v => v.path.endsWith('/user'))).toBe(true);
    });
    it('invalidates the old port synchronously while authentication refresh re-verifies, including same-user refresh', async () => {
        const h = harness(), session = await h.login(), port = h.gateway.createLiveCommunity(session)!;
        const refreshing = h.gateway.getVerifiedSession();
        expect(h.gateway.createLiveCommunity(session)).toBeNull(); expect(await port.access(signal())).toEqual({ ok: false, code: 'session_changed' });
        const renewed = await refreshing; expect(renewed?.userId).toBe(uid);
        expect(await port.access(signal())).toEqual({ ok: false, code: 'session_changed' });
        expect((await h.gateway.createLiveCommunity(renewed!)!.access(signal())).ok).toBe(true);
    });
    it('immediately denies a recovery marker, and refuses a recovery verified session without issuing RPCs', async () => {
        const h = harness(), session = await h.login(), port = h.gateway.createLiveCommunity(session)!;
        h.map.set(`${config.storageKey}:recovery`, uid);
        expect(await port.access(signal())).toEqual({ ok: false, code: 'session_changed' });
        const recovery = await h.gateway.getVerifiedSession(); expect(recovery?.recovery).toBe(true);
        expect(h.gateway.createLiveCommunity(recovery!)).toBeNull(); expect(h.rpc).not.toHaveBeenCalled();
    });
    it('also blocks a real SDK PASSWORD_RECOVERY event before a persisted marker exists', async () => {
        const h = harness(), session = await h.login(), port = h.gateway.createLiveCommunity(session)!;
        await h.client.auth.verifyOtp({ token_hash: 'synthetic-recovery', type: 'recovery' });
        expect(h.map.has(`${config.storageKey}:recovery`)).toBe(false);
        expect(h.gateway.createLiveCommunity(session)).toBeNull(); expect(await port.access(signal())).toEqual({ ok: false, code: 'session_changed' });
        const recovery = await h.gateway.getVerifiedSession(); expect(recovery?.recovery).toBe(true); expect(h.gateway.createLiveCommunity(recovery!)).toBeNull();
    });
    it('denies an out-of-band SDK account transition before the queued controller notification and never revives the old binding', async () => {
        const h = harness(), session = await h.login(), port = h.gateway.createLiveCommunity(session)!;
        h.account(other); await h.client.auth.signInWithPassword({ email: 'other@example.invalid', password: 'synthetic' });
        expect(h.gateway.createLiveCommunity(session)).toBeNull(); expect(await port.access(signal())).toEqual({ ok: false, code: 'session_changed' });
        const current = await h.gateway.getVerifiedSession(); expect(current?.userId).toBe(other);
        expect(h.gateway.createLiveCommunity(session)).toBeNull(); expect(h.gateway.createLiveCommunity({ ...current!, backendId: 'https://wrong.invalid' })).toBeNull();
        expect((await h.gateway.createLiveCommunity(current!)!.access(signal())).ok).toBe(true);
    });
    it('invalidates an in-flight RPC result when logout starts and blocks a failed logout until cleanup retry', async () => {
        const h = harness(), session = await h.login(), port = h.gateway.createLiveCommunity(session)!;
        let resolve!: () => void; h.gate(new Promise<void>(r => { resolve = r; })); const result = port.access(signal());
        await tick(); expect(h.rpc).toHaveBeenCalledOnce();
        h.fault(true); const logout = h.gateway.signOut();
        expect(h.gateway.createLiveCommunity(session)).toBeNull(); resolve(); expect(await result).toEqual({ ok: false, code: 'session_changed' });
        await expect(logout).rejects.toThrow('cleanup'); h.fault(false);
        expect(await h.gateway.getVerifiedSession()).toBeNull(); expect(h.gateway.createLiveCommunity(session)).toBeNull();
        await expect(h.gateway.signIn('test@example.invalid', 'synthetic')).rejects.toThrow();
        await h.gateway.signOut(); expect(await h.gateway.getVerifiedSession()).toBeNull();
        const fresh = await h.login(); expect(h.gateway.createLiveCommunity(fresh)).not.toBeNull();
        expect(await port.access(signal())).toEqual({ ok: false, code: 'session_changed' });
    });
    it('invalidates on cancellation immediately and rejects unverified backend users', async () => {
        const h = harness(), session = await h.login(), port = h.gateway.createLiveCommunity(session)!;
        const cancelled = h.gateway.cancel(); expect(h.gateway.createLiveCommunity(session)).toBeNull(); await cancelled;
        expect(await port.access(signal())).toEqual({ ok: false, code: 'session_changed' });
        h.fetcher.mockImplementationOnce(async () => new Response(JSON.stringify({ id: uid, confirmed_at: null, is_anonymous: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        await expect(h.gateway.getVerifiedSession()).rejects.toThrow(); expect(h.gateway.createLiveCommunity(session)).toBeNull();
    });
});
