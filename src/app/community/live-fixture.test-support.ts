/** Deterministic port for tests or a separate local story entry. Never imported by the app. */
import type { AsyncLiveCommunityPort, LiveAccess, LiveAdvance, LiveJobDetails, LiveMessage, LiveMutation, LivePageInput, LiveResult, PostLiveRequest } from '../../community/ports';
import type { Language } from '../../community/types';
export const ELDER = '11111111-1111-4111-8111-111111111111', VOLUNTEER = '22222222-2222-4222-8222-222222222222';
export const TEST_JOB = '33333333-3333-4333-8333-333333333333';
const at = '2026-10-24T12:00:00Z';
const ok = <T>(value: T): LiveResult<T> => ({ ok: true, value });
export function liveFixture() {
    let details: LiveJobDetails | null = null;
    let accessState: LiveAccess['state'] = 'approved';
    let nextMessage = 1;
    const messages: LiveMessage[] = [];
    const receipts = new Map<string, { payload: string; value: LiveMutation }>();
    const calls: Array<{ op: string; payload: unknown; key: string; signal: AbortSignal }> = [];
    let loseNext = false;
    const mutate = async (op: string, payload: unknown, key: string, signal: AbortSignal, work: () => LiveMutation): Promise<LiveResult<LiveMutation>> => {
        calls.push({ op, payload, key, signal });
        const encoded = JSON.stringify({ op, payload }), prior = receipts.get(key);
        if (prior && prior.payload !== encoded) return { ok: false, code: 'idempotency_conflict' };
        const value = prior?.value ?? work();
        if (!prior) receipts.set(key, { payload: encoded, value });
        if (loseNext) { loseNext = false; return { ok: false, code: 'retry' }; }
        return ok(value);
    };
    const discovery = () => details ? { id: details.job.id, category: details.job.category, catalogTitle: details.job.catalogTitle, coarseArea: details.job.coarseArea, neededSkills: details.job.neededSkills, approvedServiceCreditMinutes: details.job.approvedServiceCreditMinutes } : null;
    function port(userId: string, role: 'elder' | 'volunteer'): AsyncLiveCommunityPort {
        const receipt = (): LiveMutation => ({ jobId: details!.job.id, status: details!.job.status, messageId: null });
        const page = <T>(items: T[], input: LivePageInput) => ok({ items: input.cursor ? [] : items, nextCursor: null });
        return {
            identity: { backendId: 'https://fixture.invalid', userId },
            access: async () => ok({ state: accessState, role, community: accessState === 'approved' ? { id: TEST_JOB, label: 'Local test community', coarseArea: 'Test district' } : null }),
            discover: async p => page(details?.job.status === 'open' ? [discovery()!] : [], p),
            ownJobs: async p => page(details && (details.job.elderId === userId || details.job.volunteerId === userId) ? [details.job] : [], p),
            details: async () => details && (details.job.elderId === userId || details.job.volunteerId === userId) ? ok(structuredClone(details)) : { ok: false, code: 'permission_denied' },
            messages: async (_id, p) => page([...messages].reverse(), p),
            serviceHours: async p => page(details?.job.status === 'completed' && details.job.volunteerId === userId ? [{ jobId: details.job.id, volunteerId: userId, approvedServiceCreditMinutes: 20, confirmedAt: at }] : [], p),
            postRequest: async (input: PostLiveRequest, key, signal) => mutate('post', input, key, signal, () => {
                details = { job: { id: input.requestId, category: input.analysis.category, catalogTitle: 'Household help', coarseArea: 'Test district', neededSkills: input.analysis.skills, approvedServiceCreditMinutes: 20, elderId: userId, volunteerId: null, status: 'open', createdAt: at }, source: input.source, originalText: input.originalText, analysis: input.analysis, address: input.address, elderName: 'Test resident', volunteerName: null, rating: null, events: [{ id: '1', actorId: userId, type: 'posted', at }] };
                return receipt();
            }),
            acceptJob: async (jobId, key, signal) => mutate('accept', { jobId }, key, signal, () => { details!.job = { ...details!.job, volunteerId: userId, status: 'accepted' }; details!.volunteerName = 'Test helper'; return receipt(); }),
            advanceJob: async (jobId, step: LiveAdvance, key, signal) => mutate('advance', { jobId, step }, key, signal, () => { details!.job = { ...details!.job, status: step }; return receipt(); }),
            sendMessage: async (jobId, text, language: Language, key, signal) => mutate('message', { jobId, text, language }, key, signal, () => { const id = String(nextMessage++); messages.push({ id, jobId, text, language, fromId: userId, at }); return { ...receipt(), messageId: id }; }),
            confirmDone: async (jobId, key, signal) => mutate('confirm', { jobId }, key, signal, () => { details!.job = { ...details!.job, status: 'completed' }; return receipt(); }),
            cancelJob: async (jobId, key, signal) => mutate('cancel', { jobId }, key, signal, () => { details!.job = { ...details!.job, status: 'cancelled' }; return receipt(); }),
            rateJob: async (jobId, stars, note, key, signal) => mutate('rate', { jobId, stars, note }, key, signal, () => { details!.rating = { byId: userId, stars, note, at }; return receipt(); }),
        };
    }
    return { port, calls, messages, get details() { return details; }, setAccess(state: LiveAccess['state']) { accessState = state; }, loseResponse() { loseNext = true; } };
}
