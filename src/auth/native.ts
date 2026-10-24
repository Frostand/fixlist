import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { SupportedStorage } from '@supabase/supabase-js';
export interface NativeAuthPlugin {
    storageGet(options: { key: string }): Promise<{ value: string | null }>;
    storageSet(options: { key: string; value: string }): Promise<void>;
    storageRemove(options: { key: string }): Promise<void>;
    appleSignIn(): Promise<{ token: string; nonce: string }>;
    openOAuth(options: { url: string }): Promise<{ url: string }>;
    cancel(): Promise<void>;
    getLaunchUrl(): Promise<{ url?: string }>;
    addListener(event: 'authActive', fn: (data: { active: boolean }) => void): Promise<PluginListenerHandle>;
    addListener(event: 'authUrl', fn: (data: { url: string }) => void): Promise<PluginListenerHandle>;
}
export const nativeAuth = registerPlugin<NativeAuthPlugin>('FixListAuth');
export function nativeAuthAvailable() { return Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('FixListAuth'); }
/** No localStorage fallback on native, including when Keychain access fails. */
export function nativeAuthStorage(plugin: NativeAuthPlugin = nativeAuth): SupportedStorage {
    return { getItem: async key => (await plugin.storageGet({ key })).value, setItem: async (key, value) => { await plugin.storageSet({ key, value }); }, removeItem: async key => { await plugin.storageRemove({ key }); } };
}
