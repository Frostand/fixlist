import { describe, expect, it, vi } from 'vitest';
import { CallbackTransactions } from './callbacks';
function storage() { const map = new Map<string, string>(); return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } }; }
describe('persisted PKCE callback transaction gate', () => {
    it('tries every verifier slot despite transaction deletion failure, invalidates in memory, and allows a fresh flow', async () => {
        const s = storage(), remove = vi.spyOn(s, 'removeItem'), t = new CallbackTransactions(s, 'project', 'https://fixlist.example/');
        const redirect = await t.begin('oauth'), id = 'a'.repeat(32);
        s.setItem('project-code-verifier', 'synthetic'); s.setItem('project-flows-code-verifier', JSON.stringify([id])); s.setItem(`project-flow-${id}-code-verifier`, 'synthetic');
        remove.mockImplementation(k => { if (k === 'project:transaction') throw new Error('synthetic failure'); s.map.delete(k); });
        await expect(t.cancel()).rejects.toThrow();
        expect(s.map.has('project:transaction')).toBe(true); expect([...s.map.keys()]).toEqual(['project:transaction']);
        remove.mockImplementation(k => { s.map.delete(k); });
        expect(await t.consume(`${redirect}&code=cancelled`)).toBeNull();
        const next = await t.begin('oauth'); expect(await t.consume(`${next}&code=fresh`)).toMatchObject({ code: 'fresh' });
    });
    it.each(['https://fixlist.example/', 'app.fixlist.demo://auth/callback'])('handles cold/warm duplicate delivery once for %s', async base => {
        const s = storage(), t = new CallbackTransactions(s, 'project', base), redirect = await t.begin('oauth');
        const cold = new CallbackTransactions(s, 'project', base), url = `${redirect}&code=one-use-code`;
        expect(await cold.consume(url)).toEqual({ code: 'one-use-code', kind: 'oauth' });
        expect(await t.consume(url)).toBeNull();
    });
    it('rejects unallowlisted paths/hosts, token fragments, wrong transaction, duplicates and arbitrary next URLs', async () => {
        const s = storage(), t = new CallbackTransactions(s, 'project', 'https://fixlist.example/'), r = await t.begin('confirmation');
        expect(await t.consume(r.replace('fixlist.example', 'attacker.example') + '&code=abc')).toBeNull();
        await expect(t.consume(r + '&code=abc#access_token=hidden')).rejects.toThrow();
        await expect(t.consume(r + '&code=a&code=b')).rejects.toThrow();
        await expect(t.consume(r + '&code=a&next=https://evil.test')).rejects.toThrow();
        await expect(t.consume('https://fixlist.example/?code=abc&fl_auth=wrong')).rejects.toThrow();
        expect(await t.consume(r + '&code=abc')).toMatchObject({ kind: 'confirmation' });
    });
    it('cancellation/expiry/provider rejection clear PKCE and cannot authenticate', async () => {
        let time = 0; const s = storage(), t = new CallbackTransactions(s, 'project', 'https://fixlist.example/', () => time);
        let r = await t.begin('recovery'); s.setItem('project-code-verifier', 'private'); time = 3600001;
        await expect(t.consume(r + '&code=expired')).rejects.toThrow(); expect(s.getItem('project-code-verifier')).toBeNull();
        r = await t.begin('oauth'); await expect(t.consume(r + '#error=access_denied&error_description=cancelled')).rejects.toThrow();
        r = await t.begin('oauth'); await t.cancel(); expect(await t.consume(r + '&code=cancelled')).toBeNull();
    });
    it('separates backend projects and latest requests; no cross-project verifier reuse', async () => {
        const s = storage(), a = new CallbackTransactions(s, 'one', 'https://fixlist.example/'), b = new CallbackTransactions(s, 'two', 'https://fixlist.example/');
        const r = await a.begin('oauth'); expect(await b.consume(r + '&code=a')).toBeNull();
        const next = await a.begin('recovery'); await expect(a.consume(r + '&code=a')).rejects.toThrow();
        expect(await a.consume(next + '&code=b')).toMatchObject({ kind: 'recovery' });
    });
});
