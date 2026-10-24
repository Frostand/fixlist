import { describe, expect, it, vi } from 'vitest';
import type { LiveResult, LiveJobDetails, LiveMutation, PostLiveRequest } from '../../community/ports';
import { analyzeTaskWithRules } from '../../community/task-rules';
import { LiveCommunityController, LiveRetryScope } from './live-controller';
import { ELDER, VOLUNTEER, TEST_JOB, liveFixture } from './live-fixture.test-support';
const draft = (): PostLiveRequest => ({ requestId: TEST_JOB, source: 'typed', originalText: 'Please water my plants', analysis: analyzeTaskWithRules('Please water my plants', 'en'), address: 'PRIVATE test address' });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const denialCodes = ['permission_denied', 'pending_access', 'session_changed'] as const;
const lateOutcomes: Array<{ label: string; result(jobId: string): LiveResult<LiveMutation> }> = [
    { label: 'success', result: jobId => ({ ok: true, value: { jobId, status: 'open', messageId: null } }) },
    { label: 'access failure', result: () => ({ ok: false, code: 'session_changed' }) },
];
async function heldPost() {
    const f = liveFixture(), p = f.port(ELDER, 'elder'), c = new LiveCommunityController(p);
    await c.start(); await c.execute({ kind: 'post', input: draft() });
    const old = deferred<LiveResult<LiveMutation>>(), next = deferred<LiveResult<LiveMutation>>();
    const post = vi.spyOn(p, 'postRequest').mockImplementationOnce(() => old.promise).mockImplementationOnce(() => next.promise);
    const access = vi.spyOn(p, 'access');
    const input = { ...draft(), requestId: crypto.randomUUID() };
    const operation = c.execute({ kind: 'post', input }), pending = c.state.pending!, signal = post.mock.calls[0]![2];
    input.address = 'Edited after dispatch'; input.analysis.title = 'Edited after dispatch';
    return { f, p, c, old, next, post, access, operation, pending, signal, requestId: input.requestId };
}

describe('mounted live workspace async controller', () => {
    it('completes resident → helper → resident confirmation/rating and policy-credit cycle', async () => {
        const f = liveFixture(), elder = new LiveCommunityController(f.port(ELDER, 'elder')), volunteer = new LiveCommunityController(f.port(VOLUNTEER, 'volunteer'));
        await elder.start(); await volunteer.start(); expect(elder.state.jobs.value?.items).toEqual([]);
        expect(await elder.execute({ kind: 'post', input: draft() })).toBe(true);
        expect(elder.state.details.value?.job.status).toBe('open'); await volunteer.refresh();
        expect(volunteer.state.discovery.value?.items[0]).not.toHaveProperty('address');
        expect(volunteer.state.discovery.value?.items[0]).not.toHaveProperty('originalText');
        expect(await volunteer.execute({ kind: 'accept', jobId: TEST_JOB })).toBe(true);
        expect(volunteer.state.details.value?.address).toBe('PRIVATE test address');
        expect(await volunteer.execute({ kind: 'message', jobId: TEST_JOB, text: 'Ready to help', language: 'en' })).toBe(true);
        await elder.refresh(); expect(elder.state.messages.value?.items[0]?.text).toBe('Ready to help');
        await elder.execute({ kind: 'message', jobId: TEST_JOB, text: 'Thank you', language: 'en' });
        for (const step of ['on-the-way', 'arrived', 'reported-done'] as const) {
            expect(await volunteer.execute({ kind: 'advance', jobId: TEST_JOB, step })).toBe(true);
            expect(volunteer.state.details.value?.job.status).toBe(step);
        }
        expect(volunteer.state.credits.value?.items).toEqual([]);
        await elder.refresh(); expect(elder.state.details.value?.job.status).toBe('reported-done');
        expect(await elder.execute({ kind: 'confirm', jobId: TEST_JOB })).toBe(true);
        expect(await elder.execute({ kind: 'rate', jobId: TEST_JOB, stars: 4, note: 'Careful help' })).toBe(true);
        expect(elder.state.details.value?.rating?.stars).toBe(4);
        await volunteer.refresh(); expect(volunteer.state.credits.value?.items[0]?.approvedServiceCreditMinutes).toBe(20);
        elder.dispose(); volunteer.dispose();
    });
    it('cancels only through an awaited explicit command and refreshes the committed state', async () => {
        const f = liveFixture(), c = new LiveCommunityController(f.port(ELDER, 'elder')); await c.start();
        await c.execute({ kind: 'post', input: draft() }); await c.execute({ kind: 'cancel', jobId: TEST_JOB });
        expect(f.calls.map(call => call.op)).toEqual(['post', 'cancel']); expect(c.state.details.value?.job.status).toBe('cancelled');
    });
    it.each(['pending', 'revoked'] as const)('does not query private or discovery resources while %s', async state => {
        const f = liveFixture(); f.setAccess(state); const p = f.port(ELDER, 'elder');
        const jobs = vi.spyOn(p, 'ownJobs'), discover = vi.spyOn(p, 'discover'), details = vi.spyOn(p, 'details');
        const c = new LiveCommunityController(p); await c.start();
        expect(c.state.access.value?.state).toBe(state); expect(jobs).not.toHaveBeenCalled(); expect(discover).not.toHaveBeenCalled(); expect(details).not.toHaveBeenCalled();
        expect(await c.execute({ kind: 'post', input: draft() })).toBe(false);
        f.setAccess('approved'); await c.refresh(); expect(jobs).toHaveBeenCalledOnce();
    });
    it.each(['permission_denied', 'pending_access', 'session_changed'] as const)('clears every private view on %s and access retry is read only', async code => {
        const f = liveFixture(), p = f.port(ELDER, 'elder'), c = new LiveCommunityController(p); await c.start(); await c.execute({ kind: 'post', input: draft() });
        vi.spyOn(p, 'messages').mockResolvedValueOnce({ ok: false, code }); await c.loadMessages();
        expect(c.state.details.value).toBeNull(); expect(c.state.jobs.value).toBeNull(); expect(c.state.messages.value).toBeNull(); expect(c.state.access.error).toBe(code);
        const count = f.calls.length; await c.refresh(); expect(f.calls).toHaveLength(count); expect(c.state.access.value?.state).toBe('approved');
    });
    it.each(denialCodes.flatMap(code => lateOutcomes.map(outcome => ({ code, ...outcome }))))('retires an in-flight mutation on $code; late $label cannot change its explicit fresh retry', async ({ code, result }) => {
        const h = await heldPost(), { c } = h;
        try {
            vi.spyOn(h.p, 'ownJobs').mockResolvedValueOnce({ ok: false, code }); await c.loadList('jobs');
            expect(h.signal.aborted).toBe(true);
            expect(c.state.pending).toMatchObject({ key: h.pending.key, command: h.pending.command, running: false, error: 'aborted' });
            expect(c.state.access.error).toBe(code); expect(c.state.jobs.value).toBeNull(); expect(c.state.details.value).toBeNull(); expect(c.state.messages.value).toBeNull();
            expect(c.state.selectedId).toBeNull(); expect(c.state.notice).toBeNull();
            expect(await c.retry()).toBe(false); expect(h.post).toHaveBeenCalledOnce();
            h.f.setAccess('pending'); await c.refresh(); expect(h.access).toHaveBeenCalledOnce();
            expect(c.state.access.value?.state).toBe('pending'); expect(await c.retry()).toBe(false); expect(h.post).toHaveBeenCalledOnce();
            h.f.setAccess('approved'); await c.refresh(); expect(h.access).toHaveBeenCalledTimes(2);
            expect(c.state.access.value?.state).toBe('approved'); expect(h.post).toHaveBeenCalledOnce();
            const retrying = c.retry(), retry = c.state.pending, newSignal = h.post.mock.calls[1]![2];
            expect(newSignal).not.toBe(h.signal); expect(newSignal.aborted).toBe(false);
            expect(h.post.mock.calls[1]![0]).toBe(h.post.mock.calls[0]![0]); expect(h.post.mock.calls[1]![1]).toBe(h.pending.key);
            expect(h.post.mock.calls[1]![0].address).toBe('PRIVATE test address'); expect(Object.isFrozen(h.post.mock.calls[1]![0].analysis)).toBe(true);
            h.old.resolve(result(h.requestId)); expect(await h.operation).toBe(false);
            expect(c.state.pending).toBe(retry); expect(c.state.pending?.running).toBe(true); expect(c.state.access.value?.state).toBe('approved'); expect(c.state.notice).toBeNull();
            h.next.resolve({ ok: false, code: 'retry' }); expect(await retrying).toBe(false);
            expect(c.state.pending).toMatchObject({ key: h.pending.key, command: h.pending.command, running: false, error: 'retry' });
            expect(await c.retry()).toBe(true); expect(h.post).toHaveBeenCalledTimes(3);
            expect(h.post.mock.calls[2]![2]).not.toBe(newSignal); expect(h.post.mock.calls[2]![2].aborted).toBe(false);
            expect(h.post.mock.calls[2]!.slice(0, 2)).toEqual(h.post.mock.calls[0]!.slice(0, 2));
        } finally { c.dispose(); h.old.resolve({ ok: false, code: 'aborted' }); h.next.resolve({ ok: false, code: 'aborted' }); }
    });
    it.each(lateOutcomes)('ignores old $label after the fresh attempt already failed', async ({ result }) => {
        const h = await heldPost(), { c } = h;
        try {
            vi.spyOn(h.p, 'ownJobs').mockResolvedValueOnce({ ok: false, code: 'permission_denied' }); await c.loadList('jobs'); await c.refresh();
            const retrying = c.retry(); h.next.resolve({ ok: false, code: 'retry' }); expect(await retrying).toBe(false);
            const retry = c.state.pending; expect(retry?.error).toBe('retry');
            h.old.resolve(result(h.requestId)); expect(await h.operation).toBe(false);
            expect(c.state.pending).toBe(retry); expect(c.state.notice).toBeNull(); expect(c.state.access.value?.state).toBe('approved');
            await c.refresh(); expect(h.post).toHaveBeenCalledTimes(2); expect(c.state.pending).toBe(retry);
        } finally { c.dispose(); h.old.resolve({ ok: false, code: 'aborted' }); h.next.resolve({ ok: false, code: 'aborted' }); }
    });
    it.each([false, true])('retires an old mutation across start with dispose=%s and never lets it finish a newer attempt', async dispose => {
        const h = await heldPost(), { c } = h;
        try {
            if (dispose) c.dispose(); await c.start();
            expect(h.signal.aborted).toBe(true); expect(c.state.pending).toMatchObject({ key: h.pending.key, running: false, error: 'aborted' });
            expect(h.post).toHaveBeenCalledOnce(); const retrying = c.retry(), retry = c.state.pending;
            expect(h.post.mock.calls[1]![2]).not.toBe(h.signal); expect(h.post.mock.calls[1]![2].aborted).toBe(false);
            h.old.resolve({ ok: true, value: { jobId: h.requestId, status: 'open', messageId: null } }); expect(await h.operation).toBe(false);
            expect(c.state.pending).toBe(retry); expect(c.state.notice).toBeNull();
            h.next.resolve({ ok: false, code: 'retry' }); expect(await retrying).toBe(false); expect(c.state.pending?.error).toBe('retry');
        } finally { c.dispose(); h.old.resolve({ ok: false, code: 'aborted' }); h.next.resolve({ ok: false, code: 'aborted' }); }
    });
    it('keeps the immutable payload and UUID after a committed lost response, then replays without a duplicate', async () => {
        const f = liveFixture(), c = new LiveCommunityController(f.port(ELDER, 'elder')); await c.start(); f.loseResponse();
        const input = draft(); expect(await c.execute({ kind: 'post', input })).toBe(false);
        input.address = 'EDITED'; input.analysis.title = 'EDITED';
        const pending = c.state.pending; expect(pending?.error).toBe('retry');
        expect(await c.execute({ kind: 'post', input })).toBe(false); expect(f.calls).toHaveLength(1);
        await c.refresh(); expect(c.state.pending?.key).toBe(pending?.key); expect(f.calls).toHaveLength(1);
        expect(await c.retry()).toBe(true);
        expect(f.calls[1]?.key).toBe(f.calls[0]?.key); expect(f.calls[1]?.payload).toEqual(f.calls[0]?.payload);
        expect(c.state.details.value?.address).toBe('PRIVATE test address'); expect(c.state.jobs.value?.items).toHaveLength(1);
        expect(c.state.pending).toBeNull();
    });
    it('prevents duplicate message clicks in flight and reuses the same receipt after a lost response', async () => {
        const f = liveFixture(), p = f.port(ELDER, 'elder'), c = new LiveCommunityController(p); await c.start(); await c.execute({ kind: 'post', input: draft() });
        const gate = deferred<void>(), send = p.sendMessage;
        vi.spyOn(p, 'sendMessage').mockImplementation(async (...args) => { await gate.promise; return send(...args); }); f.loseResponse();
        const command = { kind: 'message' as const, jobId: TEST_JOB, text: 'One message only', language: 'en' as const };
        const first = c.execute(command); expect(c.state.pending?.running).toBe(true);
        expect(await c.execute(command)).toBe(false); expect(await c.retry()).toBe(false); gate.resolve(); expect(await first).toBe(false);
        const key = c.state.pending?.key; expect(await c.retry()).toBe(true);
        expect(f.messages).toHaveLength(1); expect(f.calls.filter(v => v.op === 'message').map(v => v.key)).toEqual([key, key]);
    });
    it('requires explicit discard before edited input can receive a new UUID', async () => {
        const f = liveFixture(), c = new LiveCommunityController(f.port(ELDER, 'elder')); await c.start(); f.loseResponse(); await c.execute({ kind: 'post', input: draft() });
        const key = c.state.pending?.key; c.discardRetry(); expect(c.state.notice).toContain('may already have saved');
        const input = { ...draft(), requestId: crypto.randomUUID(), originalText: 'A different request' };
        await c.execute({ kind: 'post', input }); expect(f.calls[1]?.key).not.toBe(key); expect(f.calls[1]?.payload).toEqual(input);
    });
    it.each(['retry', 'aborted'] as const)('keeps receipt after %s and does not claim success', async code => {
        const f = liveFixture(), p = f.port(ELDER, 'elder'), c = new LiveCommunityController(p); await c.start();
        vi.spyOn(p, 'postRequest').mockResolvedValueOnce({ ok: false, code });
        expect(await c.execute({ kind: 'post', input: draft() })).toBe(false); expect(c.state.pending?.error).toBe(code); expect(c.state.notice).toBeNull();
        expect(await c.retry()).toBe(true); expect(p.postRequest).toHaveBeenCalledTimes(2);
        expect(vi.mocked(p.postRequest).mock.calls[0]?.slice(0, 2)).toEqual(vi.mocked(p.postRequest).mock.calls[1]?.slice(0, 2));
    });
    it('does not render a rejected or thrown query as an empty successful result', async () => {
        const p = liveFixture().port(VOLUNTEER, 'volunteer'); vi.spyOn(p, 'discover').mockRejectedValueOnce(new Error('synthetic network error'));
        const c = new LiveCommunityController(p); await c.start(); expect(c.state.discovery.value).toBeNull(); expect(c.state.discovery.error).toBe('retry');
        await c.loadList('discovery'); expect(c.state.discovery.value?.items).toEqual([]); expect(c.state.discovery.error).toBeNull();
    });
    it('discards an older selected-job response and aborts its signal', async () => {
        const f = liveFixture(), p = f.port(ELDER, 'elder'), c = new LiveCommunityController(p); await c.start(); await c.execute({ kind: 'post', input: draft() });
        const old = deferred<LiveResult<LiveJobDetails>>(), details = structuredClone(f.details!);
        vi.spyOn(p, 'details').mockImplementationOnce(async (_id, signal) => { const response = await old.promise; expect(signal.aborted).toBe(true); return response; });
        const first = c.select(TEST_JOB); c.closeDetails(); old.resolve({ ok: true, value: details }); await first;
        expect(c.state.details.value).toBeNull(); expect(c.state.selectedId).toBeNull();
    });
    it('aborts private reads/mutations on unmount, drops late results, and never shares state with another account', async () => {
        const f = liveFixture(), p = f.port(ELDER, 'elder'), c = new LiveCommunityController(p); await c.start(); await c.execute({ kind: 'post', input: draft() });
        const late = deferred<LiveResult<LiveMutation>>(); let signal!: AbortSignal;
        vi.spyOn(p, 'cancelJob').mockImplementation(async (_job, _key, s) => { signal = s; return late.promise; });
        const command = c.execute({ kind: 'cancel', jobId: TEST_JOB }); c.dispose(); expect(signal.aborted).toBe(true);
        const other = new LiveCommunityController(f.port(VOLUNTEER, 'volunteer')); await other.start();
        late.resolve({ ok: true, value: { jobId: TEST_JOB, status: 'cancelled', messageId: null } }); expect(await command).toBe(false);
        expect(c.state.details.value).toBeNull(); expect(other.state.details.value).toBeNull(); expect(other.state.jobs.value?.items).toEqual([]);
    });
    it('pages lists/messages with server cursors, deduplicates overlaps and retains newest-first backing order', async () => {
        const f = liveFixture(), p = f.port(ELDER, 'elder'), c = new LiveCommunityController(p); await c.start(); await c.execute({ kind: 'post', input: draft() });
        const job = f.details!.job;
        vi.spyOn(p, 'ownJobs').mockResolvedValueOnce({ ok: true, value: { items: [job], nextCursor: '30' } }).mockResolvedValueOnce({ ok: true, value: { items: [job, { ...job, id: crypto.randomUUID() }], nextCursor: null } });
        await c.loadList('jobs'); await c.loadList('jobs', true); expect(p.ownJobs).toHaveBeenLastCalledWith({ cursor: '30', limit: 25 }, expect.any(AbortSignal)); expect(c.state.jobs.value?.items).toHaveLength(2);
        const row = { id: '100000000000000001', jobId: TEST_JOB, fromId: ELDER, text: 'Newest', language: 'en' as const, at: '2026-10-24T12:00:00Z' };
        vi.spyOn(p, 'messages').mockResolvedValueOnce({ ok: true, value: { items: [row], nextCursor: '60' } }).mockResolvedValueOnce({ ok: true, value: { items: [{ ...row, id: '59', text: 'Older' }], nextCursor: null } });
        await c.loadMessages(); await c.loadMessages(true); expect(c.state.messages.value?.items.map(m => m.text)).toEqual(['Newest', 'Older']);
        expect(p.messages).toHaveBeenLastCalledWith(TEST_JOB, { cursor: '60', limit: 25 }, expect.any(AbortSignal));
    });
    it('can restart after the React StrictMode effect cleanup without accepting pre-cleanup results', async () => {
        const f = liveFixture(), p = f.port(ELDER, 'elder'), old = deferred<Awaited<ReturnType<typeof p.access>>>();
        vi.spyOn(p, 'access').mockImplementationOnce(() => old.promise);
        const c = new LiveCommunityController(p), first = c.start(); c.dispose(); await c.start();
        old.resolve({ ok: true, value: { state: 'revoked', role: null, community: null } }); await first;
        expect(c.state.access.value?.state).toBe('approved');
    });
    it('retains an aborted immutable mutation across same-account auth remount; old response cannot clear its new retry', async () => {
        const f = liveFixture(), scope = new LiveRetryScope(), p = f.port(ELDER, 'elder');
        const gate = deferred<void>(), post = p.postRequest;
        vi.spyOn(p, 'postRequest').mockImplementation(async (...args) => { const saved = await post(...args); await gate.promise; return saved; });
        const first = new LiveCommunityController(p, scope); await first.start();
        const operation = first.execute({ kind: 'post', input: draft() }), pending = first.state.pending;
        await Promise.resolve(); first.dispose(); expect(pending?.running).toBe(true);
        const second = new LiveCommunityController(f.port(ELDER, 'elder'), scope); await second.start();
        expect(second.state.pending).toMatchObject({ key: pending?.key, error: 'aborted', running: false });
        expect(second.state.pending?.command).toEqual(pending?.command); expect(first.state.details.value).toBeNull();
        gate.resolve(); expect(await operation).toBe(false); expect(second.state.pending?.key).toBe(pending?.key);
        expect(await second.retry()).toBe(true); expect(f.calls[1]?.key).toBe(f.calls[0]?.key); expect(f.calls[1]?.payload).toEqual(f.calls[0]?.payload); expect(second.state.jobs.value?.items).toHaveLength(1);
    });
    it('destroys the previous intent on verified account/backend transition and an old cleanup cannot restore it', async () => {
        const f = liveFixture(), scope = new LiveRetryScope(), first = new LiveCommunityController(f.port(ELDER, 'elder'), scope); await first.start(); f.loseResponse();
        await first.execute({ kind: 'post', input: draft() }); expect(first.state.pending).not.toBeNull();
        const second = new LiveCommunityController(f.port(VOLUNTEER, 'volunteer'), scope); first.dispose(); await second.start();
        expect(second.state.pending).toBeNull(); second.dispose();
        const returning = new LiveCommunityController(f.port(ELDER, 'elder'), scope); expect(returning.state.pending).toBeNull();
        expect(returning.state.details.value).toBeNull(); expect(returning.state.jobs.value).toBeNull();
    });
});
