import { describe, expect, it, vi } from 'vitest';
import { finishWebCallback, pendingWebCallback } from './web-callback';
describe('web callback startup ownership', () => {
    it('strips before network waits and retains a callback across StrictMode cleanup until active processing finishes', () => {
        const location = { href: 'https://fixlist.example/?fl_auth=synthetic&code=synthetic-code' }, original = location.href;
        const history = { replaceState: vi.fn((_a: unknown, _b: string, path?: string | URL | null) => { location.href = new URL(String(path), location.href).href; }) };
        expect(pendingWebCallback(location, history)).toBe(original); expect(location.href).toBe('https://fixlist.example/#/c/signin');
        expect(pendingWebCallback(location, history)).toBe(original); expect(history.replaceState).toHaveBeenCalledOnce();
        finishWebCallback(original); expect(pendingWebCallback(location, history)).toBeNull();
    });
    it('strips provider error and unsupported implicit token fragments without trusting their identity', () => {
        for (const hash of ['#error=access_denied', '#access_token=synthetic&refresh_token=synthetic']) {
            const location = { href: `https://fixlist.example/${hash}` }, history = { replaceState: vi.fn() };
            const incoming = pendingWebCallback(location, history); expect(history.replaceState).toHaveBeenCalled(); expect(incoming).toBe(location.href); finishWebCallback(incoming!);
        }
    });
});
