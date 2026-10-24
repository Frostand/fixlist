export interface AuthConfig {
    url: string; publishableKey: string; backendId: string; storageKey: string;
    redirectUrl: string; google: boolean; appleWeb: boolean; appleNative: boolean; native: boolean;
}
export type AuthConfiguration = { config: AuthConfig; reason: null } | { config: null; reason: 'not-configured' | 'invalid-config' | 'native-unavailable' };
/** Only public project configuration belongs in Vite. Never accepts a JWT/service-role key. */
export function readAuthConfig(env: Record<string, unknown>, origin: string, native: boolean, nativeAvailable: boolean): AuthConfiguration {
    if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) return { config: null, reason: 'not-configured' };
    try {
        const url = new URL(String(env.VITE_SUPABASE_URL));
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if ((!local && url.protocol !== 'https:') || (local && !['https:', 'http:'].includes(url.protocol)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid backend');
        const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY);
        if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key)) throw new Error('Use public publishable key');
        const redirect = new URL(native ? String(env.VITE_AUTH_NATIVE_REDIRECT_URL || 'app.fixlist.demo://auth/callback') : String(env.VITE_AUTH_WEB_REDIRECT_URL || `${origin}/`));
        if (native) {
            if (redirect.href !== 'app.fixlist.demo://auth/callback') throw new Error('Native callback');
        } else if (redirect.origin !== origin || redirect.pathname !== '/' || redirect.search || redirect.hash || redirect.username || redirect.password || (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname)))) throw new Error('Web callback');
        if (native && !nativeAvailable) return { config: null, reason: 'native-unavailable' };
        const backendId = url.origin;
        return { reason: null, config: { url: backendId, publishableKey: key, backendId, storageKey: `fixlist:live:${encodeURIComponent(backendId)}:auth`, redirectUrl: redirect.href,
            google: env.VITE_AUTH_GOOGLE_ENABLED === 'true', appleWeb: env.VITE_AUTH_APPLE_WEB_ENABLED === 'true', appleNative: env.VITE_AUTH_APPLE_NATIVE_ENABLED === 'true', native } };
    } catch { return { config: null, reason: 'invalid-config' }; }
}
