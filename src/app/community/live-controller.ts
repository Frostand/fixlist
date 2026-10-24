import type { AsyncLiveCommunityPort, LiveAccess, LiveAdvance, LiveDiscoveryJob, LiveFailureCode, LiveJob, LiveJobDetails, LiveMessage, LiveMutation, LivePage, LiveResult, LiveServiceCredit, PostLiveRequest } from '../../community/ports';
import type { Language } from '../../community/types';

export type LiveCommand = { kind: 'post'; input: PostLiveRequest }
    | { kind: 'accept' | 'confirm' | 'cancel'; jobId: string }
    | { kind: 'advance'; jobId: string; step: LiveAdvance }
    | { kind: 'message'; jobId: string; text: string; language: Language }
    | { kind: 'rate'; jobId: string; stars: 1 | 2 | 3 | 4 | 5; note: string };
export interface Resource<T> { value: T | null; loading: boolean; error: LiveFailureCode | null }
export interface PendingLiveCommand { readonly key: string; readonly command: LiveCommand; running: boolean; error: LiveFailureCode | null }
/** Explicit page-owned user intent, never a server-state cache. A verified workspace
 * change destroys the previous input. Same-account session rebinds retain its receipt. */
export class LiveRetryScope {
    private namespace: string | null = null;
    private pending: PendingLiveCommand | null = null;
    bind(namespace: string) { if (this.namespace !== namespace) { this.namespace = namespace; this.pending = null; } }
    read(namespace: string) { return this.namespace === namespace ? this.pending : null; }
    write(namespace: string, pending: PendingLiveCommand | null) { if (this.namespace === namespace) this.pending = pending; }
}
export interface LiveViewState {
    access: Resource<LiveAccess>; discovery: Resource<LivePage<LiveDiscoveryJob>>; jobs: Resource<LivePage<LiveJob>>;
    credits: Resource<LivePage<LiveServiceCredit>>; details: Resource<LiveJobDetails>; messages: Resource<LivePage<LiveMessage>>;
    selectedId: string | null; pending: PendingLiveCommand | null; notice: string | null;
}
const resource = <T>(): Resource<T> => ({ value: null, loading: false, error: null });
const initial = (): LiveViewState => ({ access: resource(), discovery: resource(), jobs: resource(), credits: resource(), details: resource(), messages: resource(), selectedId: null, pending: null, notice: null });
const blocked = (code: LiveFailureCode) => ['permission_denied', 'pending_access', 'session_changed'].includes(code);
const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
type ListName = 'discovery' | 'jobs' | 'credits';

/** A mounted workspace owns this controller. No storage, demo state, tokens or subscriptions.
 * Signals AND read tickets reject transports that settle after abort/account unmount.
 * Only an explicit execute/retry can mutate; refreshing never repeats a mutation. */
export class LiveCommunityController {
    state = initial();
    private active = true;
    private listeners = new Set<() => void>();
    private reads = new Map<string, AbortController>();
    private mutation = new AbortController();
    private readonly namespace: string;
    constructor(readonly port: AsyncLiveCommunityPort, private readonly retryScope = new LiveRetryScope()) {
        this.namespace = JSON.stringify(['live', port.identity.backendId, port.identity.userId]);
        this.retryScope.bind(this.namespace);
        this.restoreRetry();
    }
    private restoreRetry() {
        const pending = this.retryScope.read(this.namespace);
        this.state = { ...this.state, pending: pending?.running ? { ...pending, running: false, error: 'aborted' } : pending };
    }
    start() { this.active = true; this.mutation = new AbortController(); this.restoreRetry(); return this.refresh(); }
    subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
    private publish(patch: Partial<LiveViewState>) { if (this.active) {
        this.state = { ...this.state, ...patch };
        if ('pending' in patch) this.retryScope.write(this.namespace, this.state.pending);
        this.listeners.forEach(fn => fn());
    } }
    private read(name: string) {
        this.reads.get(name)?.abort();
        const controller = new AbortController(); this.reads.set(name, controller);
        return { signal: controller.signal, current: () => this.active && !controller.signal.aborted && this.reads.get(name) === controller };
    }
    private abortReads() { this.reads.forEach(c => c.abort()); this.reads.clear(); }
    private deny(code: LiveFailureCode) {
        this.abortReads();
        this.publish({ ...initial(), access: { value: null, loading: false, error: code }, pending: this.state.pending });
    }
    private async safely<T>(work: () => Promise<LiveResult<T>>): Promise<LiveResult<T>> {
        try { return await work(); } catch { return { ok: false, code: 'retry' }; }
    }
    async refresh() {
        if (!this.active || this.state.pending?.running) return;
        this.abortReads();
        const selectedId = this.state.selectedId, pending = this.state.pending, notice = this.state.notice;
        this.publish({ ...initial(), selectedId, pending, notice, access: { value: null, loading: true, error: null } });
        const ticket = this.read('access');
        const result = await this.safely(() => this.port.access(ticket.signal));
        if (!ticket.current()) return;
        if (!result.ok) { this.deny(result.code); return; }
        this.publish({ access: { value: result.value, loading: false, error: null } });
        if (result.value.state !== 'approved') { this.publish({ selectedId: null }); return; }
        await Promise.all([this.loadList('jobs'), ...(result.value.role === 'volunteer' ? [this.loadList('discovery'), this.loadList('credits')] : []), ...(selectedId ? [this.select(selectedId)] : [])]);
    }
    async loadList(name: ListName, more = false) {
        if (!this.active || this.state.access.value?.state !== 'approved' || this.state[name].loading) return;
        if (name !== 'jobs' && this.state.access.value.role !== 'volunteer') return;
        const prior = this.state[name].value;
        if (more && !prior?.nextCursor) return;
        const ticket = this.read(name), page = more ? { cursor: prior!.nextCursor!, limit: 25 } : { limit: 25 };
        this.publish({ [name]: { value: more ? prior : null, loading: true, error: null } });
        const work = async (): Promise<LiveResult<LivePage<LiveDiscoveryJob | LiveJob | LiveServiceCredit>>> => {
            if (name === 'discovery') return this.port.discover(page, ticket.signal);
            if (name === 'jobs') return this.port.ownJobs(page, ticket.signal);
            return this.port.serviceHours(page, ticket.signal);
        };
        const result = await this.safely(work);
        if (!ticket.current()) return;
        if (!result.ok) {
            if (blocked(result.code)) { this.deny(result.code); return; }
            this.publish({ [name]: { value: more ? prior : null, loading: false, error: result.code } }); return;
        }
        // Deduplicate overlapping pages while keeping server order.
        const items = [...(more ? prior?.items ?? [] : []), ...result.value.items];
        const seen = new Set<string>();
        const unique = items.filter(row => { const id = 'id' in row ? row.id : row.jobId; if (seen.has(id)) return false; seen.add(id); return true; });
        this.publish({ [name]: { value: { items: unique, nextCursor: result.value.nextCursor }, loading: false, error: null } });
    }
    async select(jobId: string) {
        if (!this.active || this.state.access.value?.state !== 'approved') return;
        const ticket = this.read('details'); this.reads.get('messages')?.abort();
        this.publish({ selectedId: jobId, details: { value: null, loading: true, error: null }, messages: resource() });
        const result = await this.safely(() => this.port.details(jobId, ticket.signal));
        if (!ticket.current()) return;
        if (!result.ok) { if (blocked(result.code)) this.deny(result.code); else this.publish({ details: { value: null, loading: false, error: result.code } }); return; }
        this.publish({ details: { value: result.value, loading: false, error: null } });
        await this.loadMessages();
    }
    closeDetails() {
        this.reads.get('details')?.abort(); this.reads.get('messages')?.abort();
        this.publish({ selectedId: null, details: resource(), messages: resource() });
    }
    async loadMessages(more = false) {
        const jobId = this.state.selectedId, prior = this.state.messages.value;
        if (!this.active || !jobId || !this.state.details.value || this.state.messages.loading || this.state.access.value?.state !== 'approved' || (more && !prior?.nextCursor)) return;
        const ticket = this.read('messages'), page = more ? { cursor: prior!.nextCursor!, limit: 25 } : { limit: 25 };
        this.publish({ messages: { value: more ? prior : null, loading: true, error: null } });
        const result = await this.safely(() => this.port.messages(jobId, page, ticket.signal));
        if (!ticket.current()) return;
        if (!result.ok) { if (blocked(result.code)) this.deny(result.code); else this.publish({ messages: { value: more ? prior : null, loading: false, error: result.code } }); return; }
        const rows = [...(more ? prior?.items ?? [] : []), ...result.value.items], seen = new Set<string>();
        this.publish({ messages: { value: { items: rows.filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; }), nextCursor: result.value.nextCursor }, loading: false, error: null } });
    }
    async execute(command: LiveCommand): Promise<boolean> {
        if (!this.active || this.state.pending || this.state.access.value?.state !== 'approved') return false;
        const snapshot: LiveCommand = freeze(JSON.parse(JSON.stringify(command)));
        this.publish({ pending: { key: crypto.randomUUID(), command: snapshot, running: false, error: null }, notice: null });
        return this.retry();
    }
    async retry(): Promise<boolean> {
        const pending = this.state.pending;
        if (!this.active || !pending || pending.running || this.state.access.value?.state !== 'approved') return false;
        this.publish({ pending: { ...pending, running: true, error: null } });
        const { command: c, key } = pending, signal = this.mutation.signal;
        const result = await this.safely<LiveMutation>(() => {
            switch (c.kind) {
                case 'post': return this.port.postRequest(c.input, key, signal);
                case 'accept': return this.port.acceptJob(c.jobId, key, signal);
                case 'advance': return this.port.advanceJob(c.jobId, c.step, key, signal);
                case 'message': return this.port.sendMessage(c.jobId, c.text, c.language, key, signal);
                case 'confirm': return this.port.confirmDone(c.jobId, key, signal);
                case 'cancel': return this.port.cancelJob(c.jobId, key, signal);
                case 'rate': return this.port.rateJob(c.jobId, c.stars, c.note, key, signal);
            }
        });
        if (!this.active || signal.aborted) return false;
        if (!result.ok) {
            this.publish({ pending: { ...pending, running: false, error: result.code } });
            if (blocked(result.code)) this.deny(result.code);
            return false;
        }
        this.publish({ pending: null, selectedId: result.value.jobId, notice: 'Saved by the server. Check the refreshed job below; refresh again if its latest state is unavailable.' });
        await this.refresh();
        return true;
    }
    discardRetry() {
        if (!this.state.pending || this.state.pending.running) return;
        this.publish({ pending: null, notice: 'Retry record discarded. A lost response may already have saved. Refresh and check your jobs/messages before creating a replacement.' });
    }
    dispose() {
        this.active = false; this.abortReads(); this.mutation.abort();
        const pending = this.state.pending;
        if (pending) this.retryScope.write(this.namespace, pending.running ? { ...pending, running: false, error: 'aborted' } : pending);
        this.state = initial(); this.listeners.clear();
    }
}
