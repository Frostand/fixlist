import { workspaceFor, type AuthGateway, type AuthMessage, type AuthState, type ProfileInput } from './types';

const empty = (): AuthState => ({ phase: 'signed-out', session: null, workspace: null, profile: null, busy: false, message: null });
/** Every identity transition drops ownership synchronously, then re-verifies with the backend.
 * AbortSignals stop profile work; generation checks also protect transports that ignore aborts. */
export class AuthController {
    state: AuthState = { ...empty(), phase: 'loading' };
    private generation = 0;
    private abort = new AbortController();
    private listeners = new Set<() => void>();
    private unsubscribe: (() => void) | undefined;
    private disposed = false;
    private mutating = false;
    private leaving: Promise<void> | null = null;
    constructor(readonly gateway: AuthGateway) {}
    subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
    private publish(patch: Partial<AuthState>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); } }
    private invalidate() { this.abort.abort(); this.abort = new AbortController(); return ++this.generation; }
    private current(g: number) { return !this.disposed && this.generation === g; }
    async start() {
        this.disposed = false;
        this.unsubscribe?.();
        this.unsubscribe = this.gateway.subscribe(() => { if (!this.mutating) void this.refresh(); });
        await this.refresh();
    }
    async refresh(recovery = false) {
        const g = this.invalidate();
        this.publish({ ...empty(), phase: 'loading', busy: true });
        try {
            const session = await this.gateway.getVerifiedSession();
            if (!this.current(g)) return;
            if (!session) { this.publish(empty()); return; }
            if (session.backendId !== this.gateway.backendId) throw new Error('Backend mismatch');
            this.publish({ session, workspace: workspaceFor(session) });
            if (recovery || session.recovery) { this.publish({ phase: 'recovery', busy: false }); return; }
            try {
                const profile = await this.gateway.getProfile(session.userId, this.abort.signal);
                if (!this.current(g)) return;
                if (profile && profile.userId !== session.userId) throw new Error('Profile owner mismatch');
                this.publish({ profile, phase: profile ? 'ready' : 'onboarding', busy: false });
            } catch { if (this.current(g)) this.publish({ phase: 'profile-error', profile: null, busy: false }); }
        } catch { if (this.current(g)) this.publish({ ...empty(), message: 'auth-error' }); }
    }
    private async action(work: () => Promise<void>, message: AuthMessage = null, refresh = false) {
        if (this.state.busy || this.disposed) return;
        const g = this.generation;
        this.mutating = true; this.publish({ busy: true, message: null });
        try {
            await work(); if (!this.current(g)) return;
            if (refresh) await this.refresh();
            else this.publish({ busy: false, message });
        } catch { if (this.current(g)) this.publish({ busy: false, message: 'auth-error' }); }
        finally { this.mutating = false; }
    }
    signIn = (email: string, password: string) => this.action(() => this.gateway.signIn(email, password), null, true);
    register = (email: string, password: string) => this.action(async () => { await this.gateway.register(email, password); }, 'confirmation');
    resendConfirmation = (email: string) => this.action(() => this.gateway.resendConfirmation(email), 'confirmation');
    requestReset = (email: string) => this.action(() => this.gateway.requestReset(email), 'reset-sent');
    oauth = (provider: 'google' | 'apple') => this.action(() => this.gateway.oauth(provider), null, true);
    updatePassword = (password: string) => this.state.phase !== 'recovery' ? Promise.resolve() : this.action(() => this.gateway.updatePassword(password), 'password-updated', true);
    async callback(url: string) {
        if (this.disposed) return;
        // Callback processing is serialized by the gateway; do not run verification inside SDK event locks.
        const g = this.invalidate();
        this.publish({ ...empty(), phase: 'loading', busy: true });
        this.mutating = true;
        try {
            const result = await this.gateway.callback(url);
            if (this.current(g)) await this.refresh(result === 'recovery');
        } catch { if (this.current(g)) this.publish({ ...empty(), message: 'auth-error' }); }
        finally { this.mutating = false; }
    }
    async saveProfile(input: ProfileInput) {
        if (!this.state.session || this.state.phase !== 'onboarding' || this.state.busy) return;
        const g = this.generation, uid = this.state.session.userId, signal = this.abort.signal;
        this.publish({ busy: true, message: null });
        try {
            const profile = await this.gateway.saveProfile(uid, input, signal);
            if (!this.current(g)) return;
            if (profile.userId !== uid) throw new Error('Profile owner mismatch');
            this.publish({ profile, phase: 'ready', busy: false });
        } catch { if (this.current(g)) this.publish({ busy: false, message: 'auth-error' }); }
    }
    cancel = () => this.leave('cancelled');
    signOut = () => this.leave(null);
    private leave(message: AuthMessage): Promise<void> {
        if (this.leaving) return this.leaving;
        const operation = this.performLeave(message);
        this.leaving = operation;
        void operation.finally(() => { this.leaving = null; });
        return operation;
    }
    private async performLeave(message: AuthMessage) {
        const g = this.invalidate();
        this.publish({ ...empty(), busy: true }); this.mutating = true;
        try {
            // Try both cleanup steps even if native cancellation itself is unavailable.
            try { await this.gateway.cancel(); } finally { await this.gateway.signOut(); }
            if (this.current(g)) this.publish({ ...empty(), message });
        } catch { if (this.current(g)) this.publish({ ...empty(), message: 'auth-error' }); }
        finally { this.mutating = false; }
    }
    dispose() { this.invalidate(); this.state = empty(); this.disposed = true; this.unsubscribe?.(); this.listeners.clear(); }
}
