// A stripped startup URL survives React StrictMode effect cleanup until the active
// mount finishes processing it. It is never persisted, logged or put back in history.
let pending: string | null = null;
export function pendingWebCallback(location: Pick<Location, 'href'>, history: Pick<History, 'replaceState'>): string | null {
    const parsed = new URL(location.href), params = parsed.searchParams, fragment = new URLSearchParams(parsed.hash.slice(1));
    if (params.has('code') || params.has('error') || fragment.has('error') || fragment.has('access_token') || fragment.has('refresh_token')) {
        pending = location.href;
        history.replaceState(null, '', '/#/c/signin');
    }
    return pending;
}
export function finishWebCallback(url: string) { if (pending === url) pending = null; }
