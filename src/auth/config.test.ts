import { describe, expect, it, vi } from 'vitest';
import { readAuthConfig } from './config';
import { nativeAuthStorage, type NativeAuthPlugin } from './native';
const env = { VITE_SUPABASE_URL: 'https://one.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_syntheticpubliconly' };
describe('public configuration and secure storage gates', () => {
    it('defaults unavailable and rejects private/legacy JWT keys, remote HTTP and redirect escapes', () => {
        expect(readAuthConfig({}, 'https://fixlist.test', false, false).reason).toBe('not-configured');
        for (const key of ['sb_secret_neveruse', 'eyJhbGciOiJfake.legacy.jwt']) expect(readAuthConfig({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: key }, 'https://fixlist.test', false, false).config).toBeNull();
        for (const value of ['https://evil.test/', 'https://fixlist.test/arbitrary', 'https://fixlist.test/?next=evil', 'https://fixlist.test/#fragment']) expect(readAuthConfig({ ...env, VITE_AUTH_WEB_REDIRECT_URL: value }, 'https://fixlist.test', false, false).config).toBeNull();
        expect(readAuthConfig({ ...env, VITE_SUPABASE_URL: 'http://remote.test' }, 'https://fixlist.test', false, false).config).toBeNull();
    });
    it('native requires its own plugin; every project gets distinct auth keys and fixed allowlisted callback', () => {
        expect(readAuthConfig(env, 'capacitor://localhost', true, false).reason).toBe('native-unavailable');
        const a = readAuthConfig(env, 'capacitor://localhost', true, true).config!;
        const b = readAuthConfig({ ...env, VITE_SUPABASE_URL: 'https://two.supabase.co' }, 'https://fixlist.test', false, false).config!;
        expect(a.storageKey).not.toBe(b.storageKey); expect(a.redirectUrl).toBe('app.fixlist.demo://auth/callback');
        expect(readAuthConfig({ ...env, VITE_AUTH_NATIVE_REDIRECT_URL: 'evil://auth/callback' }, 'capacitor://localhost', true, true).config).toBeNull();
    });
    it('Keychain failures propagate with no localStorage fallback', async () => {
        const plugin = { storageGet: vi.fn(async () => { throw new Error('Keychain locked'); }), storageSet: vi.fn(async () => { throw new Error('Keychain locked'); }), storageRemove: vi.fn(async () => { throw new Error('Keychain locked'); }) } as unknown as NativeAuthPlugin;
        const store = nativeAuthStorage(plugin);
        await expect(store.getItem('fixlist:live:project:auth')).rejects.toThrow('Keychain locked');
        await expect(store.setItem('fixlist:live:project:auth', 'synthetic')).rejects.toThrow();
        await expect(store.removeItem('fixlist:live:project:auth')).rejects.toThrow();
    });
});
