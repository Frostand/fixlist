import type { AvailabilitySlot, Language, Skill, Tool } from '../community/types';
import type { AsyncLiveCommunityPort } from '../community/ports';

/** A backend-verified identity. Tokens stay private to the provider implementation. */
export interface AuthSession { userId: string; backendId: string; email: string | null; expiresAt: number; recovery?: boolean }
export interface Workspace { mode: 'live'; backendId: string; userId: string; namespace: string }
export function workspaceFor(session: AuthSession): Workspace {
    return { mode: 'live', backendId: session.backendId, userId: session.userId, namespace: JSON.stringify(['live', session.backendId, session.userId]) };
}
export interface ProfileInput {
    role: 'elder' | 'volunteer'; name: string; area: string; language: Language;
    needs: string[]; skills: Skill[]; tools: Tool[]; availability: AvailabilitySlot[]; maxMiles: number; school: string;
}
/** No screening claims, family links, jobs, messages or client-supplied authority fields. */
export interface AccountProfile extends ProfileInput { userId: string; updatedAt: string }
export type CallbackResult = 'ignored' | 'signed-in' | 'recovery';
export interface AuthGateway {
    readonly backendId: string;
    /** Binds only the current verified non-recovery session to this gateway's SDK. */
    createLiveCommunity?(session: AuthSession): AsyncLiveCommunityPort | null;
    setForeground?(active: boolean): void;
    getVerifiedSession(): Promise<AuthSession | null>;
    subscribe(changed: () => void): () => void;
    getProfile(userId: string, signal: AbortSignal): Promise<AccountProfile | null>;
    saveProfile(userId: string, input: ProfileInput, signal: AbortSignal): Promise<AccountProfile>;
    signIn(email: string, password: string): Promise<void>;
    register(email: string, password: string): Promise<'confirmation'>;
    resendConfirmation(email: string): Promise<void>;
    requestReset(email: string): Promise<void>;
    updatePassword(password: string): Promise<void>;
    oauth(provider: 'google' | 'apple'): Promise<void>;
    callback(url: string): Promise<CallbackResult>;
    cancel(): Promise<void>;
    signOut(): Promise<void>;
}
export type AuthMessage = 'confirmation' | 'reset-sent' | 'auth-error' | 'cancelled' | 'password-updated' | null;
export interface AuthState {
    phase: 'loading' | 'signed-out' | 'sign-out-error' | 'onboarding' | 'ready' | 'profile-error' | 'recovery';
    session: AuthSession | null; workspace: Workspace | null; profile: AccountProfile | null;
    busy: boolean; message: AuthMessage;
}
