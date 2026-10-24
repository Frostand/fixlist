import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import { CallbackTransactions } from './callbacks';
import type { AuthConfig } from './config';
import type { NativeAuthPlugin } from './native';
import { parseProfile } from './validation';
import type { AuthGateway, AuthSession, CallbackResult, ProfileInput } from './types';
import { SupabaseLiveCommunity } from '../community/supabase';

function check(error: unknown) { if (error) throw new Error('Authentication request failed'); }
export function createSupabaseGateway(config: AuthConfig, storage: SupportedStorage, native: NativeAuthPlugin | null, navigate = (url: string) => window.location.assign(url)) {
    const client = createClient(config.url, config.publishableKey, { auth: { flowType: 'pkce', storage, storageKey: config.storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, debug: false } });
    return new SupabaseAuthGateway(config, storage, client, native, navigate);
}
/** Auth mutations share a queue. A late login cannot write tokens after signOut has finished. */
export class SupabaseAuthGateway implements AuthGateway {
    readonly backendId: string;
    private transactions: CallbackTransactions;
    private tail: Promise<unknown> = Promise.resolve();
    private cancelled = 0;
    private sessionBlocked = false;
    private logoutIncomplete = false;
    private verifiedAccessToken: string | null = null;
    private liveGeneration = 0;
    private liveSession: AuthSession | null = null;
    private recoveryUserId: string | null = null;
    private listeners = new Set<() => void>();
    private exchanges = new Map<string, Promise<CallbackResult>>();
    constructor(readonly config: AuthConfig, private storage: SupportedStorage, private client: SupabaseClient, private native: NativeAuthPlugin | null, private navigate: (url: string) => void) {
        this.backendId = config.backendId;
        this.transactions = new CallbackTransactions(storage, config.storageKey, config.redirectUrl);
        // One gateway subscription, shared with the controller and port factory.
        this.client.auth.onAuthStateChange((event, session) => {
            if (event === 'INITIAL_SESSION') return;
            if (event === 'PASSWORD_RECOVERY') this.recoveryUserId = session?.user.id ?? null;
            if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') this.recoveryUserId = null;
            this.invalidateLive();
            queueMicrotask(() => this.listeners.forEach(changed => changed()));
        });
    }
    private invalidateLive() { ++this.liveGeneration; this.liveSession = null; }
    createLiveCommunity(session: AuthSession) {
        const binding = this.liveSession, generation = this.liveGeneration;
        if (!binding || this.sessionBlocked || this.logoutIncomplete || binding.recovery || session.recovery
            || session.userId !== binding.userId || session.backendId !== this.backendId) return null;
        const active = () => this.liveSession === binding && this.liveGeneration === generation && !this.sessionBlocked && !this.logoutIncomplete;
        return new SupabaseLiveCommunity({ backendId: this.backendId, client: this.client, currentIdentity: async () => {
            if (!active()) return null;
            const { data, error } = await this.client.auth.getSession();
            if (error || !data.session || data.session.user.id !== binding.userId
                || data.session.access_token !== this.verifiedAccessToken) return null;
            const recovery = await this.storage.getItem(`${this.config.storageKey}:recovery`);
            return active() && recovery !== binding.userId ? { backendId: this.backendId, userId: binding.userId } : null;
        } }, { backendId: this.backendId, userId: binding.userId });
    }
    private serial<T>(fn: () => Promise<T>): Promise<T> { const result = this.tail.then(fn); this.tail = result.catch(() => {}); return result; }
    private mutation<T>(work: () => Promise<T>): Promise<T> {
        const generation = this.cancelled;
        return this.serial(async () => {
            if (generation !== this.cancelled || this.logoutIncomplete) throw new Error('Request cancelled');
            return work();
        });
    }
    setForeground(active: boolean) {
        const work = active && !this.sessionBlocked ? this.client.auth.startAutoRefresh() : this.client.auth.stopAutoRefresh();
        void work.catch(() => {});
    }
    private authenticated(generation: number) {
        if (generation !== this.cancelled || this.logoutIncomplete) return;
        const wasBlocked = this.sessionBlocked; this.sessionBlocked = false;
        if (wasBlocked) this.setForeground(true);
    }
    subscribe(changed: () => void) {
        this.listeners.add(changed);
        return () => { this.listeners.delete(changed); };
    }
    async getVerifiedSession(): Promise<AuthSession | null> {
        this.invalidateLive();
        const liveGeneration = this.liveGeneration;
        const generation = this.cancelled;
        if (this.sessionBlocked || this.logoutIncomplete) return null;
        const { data, error } = await this.client.auth.getSession(); check(error);
        if (!data.session) return null;
        const { data: verified, error: verifyError } = await this.client.auth.getUser(data.session.access_token); check(verifyError);
        if (!verified.user || verified.user.id !== data.session.user.id || !verified.user.confirmed_at || verified.user.is_anonymous) throw new Error('Unverified identity');
        const recovery = this.recoveryUserId === verified.user.id || await this.storage.getItem(`${this.config.storageKey}:recovery`) === verified.user.id;
        const current = await this.client.auth.getSession(); check(current.error);
        if (this.sessionBlocked || this.logoutIncomplete || generation !== this.cancelled || liveGeneration !== this.liveGeneration
            || current.data.session?.access_token !== data.session.access_token || current.data.session.user.id !== verified.user.id) return null;
        this.verifiedAccessToken = data.session.access_token;
        const session = { userId: verified.user.id, backendId: this.backendId, email: verified.user.email ?? null, expiresAt: data.session.expires_at ?? 0, recovery };
        if (!recovery) this.liveSession = session;
        return session;
    }
    async getProfile(userId: string, signal: AbortSignal) {
        const { data, error } = await this.client.from('account_profiles').select('*').eq('user_id', userId).abortSignal(signal).maybeSingle(); check(error);
        return data ? parseProfile(data, userId) : null;
    }
    async saveProfile(userId: string, value: ProfileInput, signal: AbortSignal) {
        // A typed row of preferences, never a shared domain-state blob. RLS checks auth.uid again.
        const row = { user_id: userId, role: value.role, name: value.name.trim(), area: value.area.trim(), language: value.language,
            needs: value.role === 'elder' ? value.needs : [], skills: value.role === 'volunteer' ? value.skills : [], tools: value.role === 'volunteer' ? value.tools : [],
            availability: value.role === 'volunteer' ? value.availability : [], max_miles: value.role === 'volunteer' ? value.maxMiles : 10, school: value.role === 'volunteer' ? value.school.trim() : '' };
        // No update permission: first setup inserts one immutable-role profile. A concurrent duplicate requires reload.
        const { data, error } = await this.client.from('account_profiles').insert(row).select('*').abortSignal(signal).single(); check(error);
        return parseProfile(data, userId);
    }
    signIn(email: string, password: string) { this.invalidateLive(); return this.mutation(async () => {
        const generation = this.cancelled;
        await this.transactions.cancel(); await this.storage.removeItem(`${this.config.storageKey}:recovery`);
        const { error } = await this.client.auth.signInWithPassword({ email, password }); check(error);
        this.authenticated(generation);
    }); }
    register(email: string, password: string): Promise<'confirmation'> { return this.mutation(async () => {
        const emailRedirectTo = await this.transactions.begin('confirmation');
        const { data, error } = await this.client.auth.signUp({ email, password, options: { emailRedirectTo } }); check(error);
        // Deployment must require email confirmation. Fail closed even if misconfigured.
        if (data.session) { await this.client.auth.signOut({ scope: 'local' }); throw new Error('Email confirmation required'); }
        return 'confirmation' as const;
    }); }
    resendConfirmation(email: string) { return this.mutation(async () => {
        const emailRedirectTo = await this.transactions.begin('confirmation');
        // Pinned SDK creates a fresh persisted verifier. Its optional sb_flow_id is supported by our callback gate.
        const { error } = await this.client.auth.resend({ type: 'signup', email, options: { emailRedirectTo } }); check(error);
    }); }
    requestReset(email: string) { return this.mutation(async () => {
        const redirectTo = await this.transactions.begin('recovery'); const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo }); check(error);
    }); }
    updatePassword(password: string) { return this.mutation(async () => {
        const session = await this.getVerifiedSession(); if (!session?.recovery) throw new Error('Recovery required');
        const { error } = await this.client.auth.updateUser({ password }); check(error);
        await this.storage.removeItem(`${this.config.storageKey}:recovery`);
        this.recoveryUserId = null;
    }); }
    oauth(provider: 'google' | 'apple') { this.invalidateLive(); return this.mutation(async () => {
        const generation = this.cancelled;
        if (provider === 'apple' && this.config.native) {
            if (!this.config.appleNative || !this.native) throw new Error('Native Apple unavailable');
            const { token, nonce } = await this.native.appleSignIn();
            if (generation !== this.cancelled) return;
            const { error } = await this.client.auth.signInWithIdToken({ provider: 'apple', token, nonce }); check(error);
            this.authenticated(generation);
            return;
        }
        if (!(provider === 'google' ? this.config.google : this.config.appleWeb)) throw new Error('Provider unavailable');
        try {
            const redirectTo = await this.transactions.begin('oauth');
            const { data, error } = await this.client.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } }); check(error);
            if (!data.url) throw new Error('Authorization URL unavailable');
            if (generation !== this.cancelled) return;
            if (this.config.native) {
                if (!this.native) throw new Error('Native browser unavailable');
                const result = await this.native.openOAuth({ url: data.url });
                if (generation !== this.cancelled) return;
                await this.exchangeOnce(result.url);
            } else this.navigate(data.url);
        } catch {
            // Native cancellation/start failure can arrive after the authorization URL escaped.
            // cancel invalidates before any fallible storage operation.
            await this.transactions.cancel().catch(() => {});
            throw new Error('Authentication request failed');
        }
    }); }
    private async exchangeOnce(url: string): Promise<CallbackResult> {
        // Remember outcomes by a digest, not the code-bearing URL. Duplicate failed
        // delivery (including StrictMode startup) must retain its error, not hide it.
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
        const key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        const prior = this.exchanges.get(key);
        if (prior) { await prior; return 'ignored'; }
        const exchange = this.exchange(url); this.exchanges.set(key, exchange);
        if (this.exchanges.size > 4) this.exchanges.delete(this.exchanges.keys().next().value!);
        return exchange;
    }
    private async exchange(url: string): Promise<CallbackResult> {
        const generation = this.cancelled;
        const pending = await this.transactions.consume(url); if (!pending) return 'ignored';
        try {
            const { data, error } = await this.client.auth.exchangeCodeForSession(pending.code, pending.flowId ? { flowId: pending.flowId } : undefined); check(error);
            if (!data.session) throw new Error('No session');
            if (pending.kind === 'recovery') await this.storage.setItem(`${this.config.storageKey}:recovery`, data.session.user.id);
            else await this.storage.removeItem(`${this.config.storageKey}:recovery`);
            this.authenticated(generation);
            return pending.kind === 'recovery' ? 'recovery' : 'signed-in';
        } finally { await this.transactions.cancel(); }
    }
    callback(url: string) { this.invalidateLive(); return this.mutation(() => this.exchangeOnce(url)); }
    async cancel() {
        this.invalidateLive();
        ++this.cancelled; this.transactions.invalidate();
        try { if (this.native) await this.native.cancel(); }
        finally { await this.serial(() => this.transactions.cancel()); }
    }
    signOut() {
        this.invalidateLive();
        ++this.cancelled; this.transactions.invalidate();
        this.sessionBlocked = true; this.logoutIncomplete = true;
        return this.serial(async () => {
            let failed = false;
            const attempt = async (work: () => unknown) => { try { await work(); } catch { failed = true; } };
            await attempt(() => this.client.auth.stopAutoRefresh());
            try { const { error } = await this.client.auth.signOut({ scope: 'local' }); check(error); }
            catch {
                failed = true;
                // The SDK reads storage before revoking. If storage is inaccessible, use only
                // the previously backend-verified token for best-effort current-session revocation.
                if (this.verifiedAccessToken) await attempt(async () => {
                    const { error } = await this.client.auth.admin.signOut(this.verifiedAccessToken!, 'local'); check(error);
                });
            }
            await attempt(() => this.transactions.cancel());
            await attempt(() => this.storage.removeItem(`${this.config.storageKey}:recovery`));
            await attempt(() => this.storage.removeItem(this.config.storageKey));
            await attempt(() => this.storage.removeItem(`${this.config.storageKey}-user`));
            if (failed) { this.logoutIncomplete = true; throw new Error('Sign-out cleanup failed'); }
            this.logoutIncomplete = false; this.verifiedAccessToken = null;
            // Verification remains blocked until a fresh explicit authentication succeeds.
        });
    }
}
