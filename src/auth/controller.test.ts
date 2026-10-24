import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './controller';
import type { AccountProfile, AuthGateway, AuthSession, ProfileInput } from './types';

const uid = '11111111-1111-4111-8111-111111111111';
const identity: AuthSession = { userId: uid, backendId: 'https://one.supabase.co', email: 'person@example.test', expiresAt: 2000000000 };
const input: ProfileInput = { role: 'elder', name: 'Person', area: 'Town', language: 'en', needs: [], skills: [], tools: [], availability: [], maxMiles: 10, school: '' };
function gateway() {
    let session: AuthSession | null = null, profile: AccountProfile | null = null;
    let event = () => {};
    const g: AuthGateway = {
        backendId: identity.backendId,
        getVerifiedSession: vi.fn(async () => session),
        subscribe: vi.fn(fn => { event = fn; return () => { event = () => {}; }; }),
        getProfile: vi.fn(async () => profile),
        saveProfile: vi.fn(async (userId, value) => ({ ...value, userId, updatedAt: '2026-10-24T00:00:00Z' })),
        signIn: vi.fn(async () => { session = identity; }),
        register: vi.fn(async () => 'confirmation' as const),
        resendConfirmation: vi.fn(async () => {}), requestReset: vi.fn(async () => {}), updatePassword: vi.fn(async () => {}),
        oauth: vi.fn(async () => {}), callback: vi.fn(async () => 'ignored' as const), cancel: vi.fn(async () => {}),
        signOut: vi.fn(async () => { session = null; }),
    };
    return { g, emit: () => event(), setSession(s: AuthSession | null) { session = s; }, setProfile(p: AccountProfile | null) { profile = p; } };
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }

describe('real account lifecycle and isolation', () => {
    it('returns unsuccessful logout, blocks passive and explicit auth until retry, and survives native cancellation failure', async () => {
        const { g, setSession, emit } = gateway(); setSession(identity);
        const c = new AuthController(g); await c.start();
        vi.mocked(g.cancel).mockRejectedValueOnce(new Error('synthetic native failure'));
        vi.mocked(g.signOut).mockRejectedValueOnce(new Error('synthetic storage failure'));
        expect(await c.signOut()).toBe(false); expect(g.signOut).toHaveBeenCalledOnce();
        expect(c.state).toMatchObject({ phase: 'sign-out-error', session: null, workspace: null, profile: null, busy: false, message: 'auth-error' });
        const reads = vi.mocked(g.getVerifiedSession).mock.calls.length;
        emit(); await c.refresh(); await c.start(); await c.callback('late'); await c.oauth('google'); await c.signIn('person@example.test', 'password');
        expect(g.getVerifiedSession).toHaveBeenCalledTimes(reads); expect(g.callback).not.toHaveBeenCalled(); expect(g.signIn).not.toHaveBeenCalled(); expect(g.oauth).not.toHaveBeenCalled();
        expect(c.state.phase).toBe('sign-out-error'); expect(await c.signOut()).toBe(true);
        await c.signIn('person@example.test', 'password'); expect(c.state.session?.userId).toBe(uid);
    });
    it('preserves failed cleanup across dispose/start and clears the shared leave promise for retry', async () => {
        const { g, setSession } = gateway(); setSession(identity); const c = new AuthController(g); await c.start();
        vi.mocked(g.signOut).mockRejectedValueOnce(new Error('synthetic cleanup failure'));
        const first = c.signOut(), duplicate = c.signOut(); expect(first).toBe(duplicate);
        expect(await first).toBe(false); c.dispose(); await c.start();
        expect(c.state.phase).toBe('sign-out-error'); expect(c.state.session).toBeNull();
        expect(await c.signOut()).toBe(true); expect(g.signOut).toHaveBeenCalledTimes(2);
    });
    it('registration waits for confirmation; login gets backend-verified identity then saves setup under that UID', async () => {
        const { g } = gateway(), c = new AuthController(g); await c.start();
        await c.register('person@example.test', 'example-password');
        expect(c.state.session).toBeNull(); expect(c.state.message).toBe('confirmation');
        await c.signIn('person@example.test', 'example-password');
        expect(c.state.phase).toBe('onboarding'); expect(c.state.profile).toBeNull();
        expect(c.state.workspace?.namespace).toBe(JSON.stringify(['live', identity.backendId, uid]));
        await c.saveProfile(input);
        expect(g.saveProfile).toHaveBeenCalledWith(uid, input, expect.any(AbortSignal));
        expect(c.state.phase).toBe('ready'); expect(c.state.profile?.userId).toBe(uid);
    });
    it.each(['elder', 'volunteer'] as const)('durably saves %s setup and restores a verified account without seeds', async role => {
        const { g, setSession, setProfile } = gateway(); setSession(identity);
        const c = new AuthController(g); await c.start(); await c.saveProfile({ ...input, role });
        setProfile(c.state.profile); const restored = new AuthController(g); await restored.start();
        expect(restored.state.phase).toBe('ready'); expect(restored.state.profile?.role).toBe(role);
        expect(Object.keys(restored.state.workspace!)).toEqual(['mode', 'backendId', 'userId', 'namespace']);
    });
    it('clears ownership before awaiting a new verification, aborts old reads, rejects stale profiles', async () => {
        const { g, setSession } = gateway(); setSession(identity);
        const pending = deferred<AccountProfile | null>(); let signal: AbortSignal | undefined;
        vi.mocked(g.getProfile).mockImplementationOnce((_id, s) => { signal = s; return pending.promise; });
        const c = new AuthController(g), starting = c.start(); await Promise.resolve(); await Promise.resolve();
        setSession({ ...identity, userId: '22222222-2222-4222-8222-222222222222' });
        await c.refresh(); expect(signal?.aborted).toBe(true);
        pending.resolve({ ...input, userId: uid, updatedAt: '' }); await starting;
        expect(c.state.profile).toBeNull(); expect(c.state.session?.userId).not.toBe(uid);
    });
    it('profile outage retains only verified ownership, blocks workflow and never restores a demo profile', async () => {
        const { g, setSession } = gateway(); setSession(identity); vi.mocked(g.getProfile).mockRejectedValue(new Error('offline'));
        const c = new AuthController(g); await c.start(); expect(c.state.phase).toBe('profile-error');
        expect(c.state.workspace?.userId).toBe(uid); expect(c.state.profile).toBeNull();
    });
    it('rejects a profile owned by another user and backend mismatches', async () => {
        const { g, setSession, setProfile } = gateway(); setSession(identity);
        setProfile({ ...input, userId: 'someone-else', updatedAt: '' }); const c = new AuthController(g); await c.start();
        expect(c.state.phase).toBe('profile-error'); expect(c.state.profile).toBeNull();
        setSession({ ...identity, backendId: 'https://other.supabase.co' }); await c.refresh(); expect(c.state.session).toBeNull();
    });
    it('sign out immediately invalidates pending setup; late completion cannot resurrect it', async () => {
        const { g, setSession } = gateway(); setSession(identity); const c = new AuthController(g); await c.start();
        const p = deferred<AccountProfile>(); vi.mocked(g.saveProfile).mockReturnValueOnce(p.promise);
        const save = c.saveProfile(input); const out = c.signOut(); expect(c.state.workspace).toBeNull();
        p.resolve({ ...input, userId: uid, updatedAt: '' }); await Promise.all([save, out]);
        expect(c.state.phase).toBe('signed-out'); expect(c.state.profile).toBeNull();
    });
    it('confirmation/reset failures are actionable; reset callback requires verified session and update failure stays in recovery', async () => {
        const { g, setSession } = gateway(), c = new AuthController(g); await c.start();
        vi.mocked(g.register).mockRejectedValueOnce(new Error('secret backend text'));
        await c.register('person@example.test', 'password'); expect(c.state.message).toBe('auth-error');
        vi.mocked(g.requestReset).mockRejectedValueOnce(new Error('no network')); await c.requestReset('person@example.test'); expect(c.state.message).toBe('auth-error');
        setSession(identity); vi.mocked(g.callback).mockResolvedValueOnce('recovery'); await c.callback('callback');
        expect(c.state.phase).toBe('recovery'); vi.mocked(g.updatePassword).mockRejectedValueOnce(new Error('weak'));
        await c.updatePassword('weak'); expect(c.state.phase).toBe('recovery'); expect(c.state.message).toBe('auth-error');
        await c.updatePassword('better-password'); expect(c.state.phase).toBe('onboarding');
    });
    it('callback clears existing workspace before waiting, and ignored duplicate still re-verifies before restoring ownership', async () => {
        const { g, setSession, setProfile } = gateway(); setSession(identity); setProfile({ ...input, userId: uid, updatedAt: '' });
        const c = new AuthController(g); await c.start(); const pending = deferred<'ignored'>(); vi.mocked(g.callback).mockReturnValueOnce(pending.promise);
        const done = c.callback('duplicate'); expect(c.state.workspace).toBeNull(); expect(c.state.profile).toBeNull();
        pending.resolve('ignored'); await done; expect(c.state.phase).toBe('ready'); expect(g.getVerifiedSession).toHaveBeenCalledTimes(2);
    });
    it('repeated leave requests await the same cleanup and cannot race a new sign-in', async () => {
        const { g } = gateway(), c = new AuthController(g); await c.start(); const pending = deferred<void>(); vi.mocked(g.cancel).mockReturnValueOnce(pending.promise);
        const first = c.signOut(), second = c.signOut(); expect(first).toBe(second); expect(c.state.busy).toBe(true);
        await c.signIn('person@example.test', 'password'); expect(g.signIn).not.toHaveBeenCalled(); pending.resolve(); await first;
        expect(g.signOut).toHaveBeenCalledOnce(); expect(c.state.phase).toBe('signed-out');
    });
    it('dispose aborts ownership and stale external/session completion', async () => {
        const { g, setSession } = gateway(); setSession(identity); const p = deferred<AuthSession | null>();
        vi.mocked(g.getVerifiedSession).mockReturnValueOnce(p.promise); const c = new AuthController(g), start = c.start();
        c.dispose(); p.resolve(identity); await start; expect(c.state.session).toBeNull(); expect(g.getProfile).not.toHaveBeenCalled();
    });
});
