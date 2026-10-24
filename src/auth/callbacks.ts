import type { SupportedStorage } from '@supabase/supabase-js';
export type AuthTransactionKind = 'oauth' | 'confirmation' | 'recovery';
interface Transaction { id: string; kind: AuthTransactionKind; expires: number }
export class CallbackTransactions {
    private consuming = false;
    private invalidated = false;
    constructor(private storage: SupportedStorage, private key: string, private redirectUrl: string, private now = () => Date.now()) {}
    async begin(kind: AuthTransactionKind): Promise<string> {
        await this.cancel();
        const t: Transaction = { id: Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''), kind, expires: this.now() + (kind === 'oauth' ? 10 * 60_000 : 60 * 60_000) };
        await this.storage.setItem(`${this.key}:transaction`, JSON.stringify(t));
        this.invalidated = false;
        const url = new URL(this.redirectUrl); url.searchParams.set('fl_auth', t.id); return url.href;
    }
    // Invalidate synchronously: failed persistence must not revive a cancelled flow in this runtime.
    invalidate() { this.invalidated = true; }
    async cancel() {
        this.invalidate();
        let failed = false;
        const attempt = async (work: () => unknown) => { try { await work(); } catch { failed = true; } };
        await attempt(() => this.storage.removeItem(`${this.key}:transaction`));
        // Pinned auth-js 2.118 SDK keeps indexed flow slots as well as the legacy verifier.
        let index: string | null = null;
        await attempt(async () => { index = await this.storage.getItem(`${this.key}-flows-code-verifier`); });
        if (index) {
            let ids: unknown; try { ids = JSON.parse(index); } catch { ids = []; }
            if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string' && /^[a-f0-9]{32}$/.test(id)) await attempt(() => this.storage.removeItem(`${this.key}-flow-${id}-code-verifier`));
        }
        await attempt(() => this.storage.removeItem(`${this.key}-flows-code-verifier`));
        await attempt(() => this.storage.removeItem(`${this.key}-code-verifier`));
        if (failed) throw new Error('Callback cleanup failed');
    }
    async consume(urlString: string): Promise<{ code: string; kind: AuthTransactionKind; flowId?: string } | null> {
        if (this.invalidated) return null;
        let url: URL; try { url = new URL(urlString); } catch { return null; }
        const allowed = new URL(this.redirectUrl);
        // Custom-scheme URL.origin is "null": compare protocol, host and exact path too.
        if (url.protocol !== allowed.protocol || url.host !== allowed.host || url.pathname !== allowed.pathname || url.username || url.password) return null;
        if (url.hash) {
            const fragment = new URLSearchParams(url.hash.slice(1));
            if (!fragment.has('error') || [...fragment.keys()].some(k => !['error', 'error_code', 'error_description'].includes(k))) throw new Error('Unsupported callback fragment');
            for (const [key, value] of fragment) url.searchParams.append(key, value);
            url.hash = '';
        }
        if (!url.searchParams.has('code') && !url.searchParams.has('error')) return null;
        if (this.consuming) return null;
        this.consuming = true;
        try {
            for (const k of url.searchParams.keys()) if (url.searchParams.getAll(k).length !== 1 || !['code', 'fl_auth', 'sb_flow_id', 'error', 'error_code', 'error_description'].includes(k)) throw new Error('Invalid callback');
            const raw = await this.storage.getItem(`${this.key}:transaction`);
            if (!raw || this.invalidated) return null;
            const t = JSON.parse(raw) as Transaction;
            if (typeof t.id !== 'string' || !Number.isFinite(t.expires) || t.id !== url.searchParams.get('fl_auth')) throw new Error('Callback mismatch');
            // Consume before the exchange. Duplicate warm/cold delivery cannot replay it.
            this.invalidate();
            await this.storage.removeItem(`${this.key}:transaction`);
            if (t.expires <= this.now() || !['oauth', 'confirmation', 'recovery'].includes(t.kind) || url.searchParams.has('error')) { await this.cancel(); throw new Error('Expired or denied'); }
            const code = url.searchParams.get('code');
            if (!code || code.length > 2048) { await this.cancel(); throw new Error('Invalid code'); }
            const flowId = url.searchParams.get('sb_flow_id');
            if (flowId !== null && !/^[a-f0-9]{32}$/.test(flowId)) { await this.cancel(); throw new Error('Invalid flow'); }
            return { code, kind: t.kind, ...(flowId ? { flowId } : {}) };
        } finally { this.consuming = false; }
    }
}
