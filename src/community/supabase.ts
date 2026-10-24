import type { SupabaseClient } from '@supabase/supabase-js';
import { isLanguage } from '../domain/roles';
import { shape } from './validation';
import * as valid from './live-validation';
import type { AsyncLiveCommunityPort, LiveAdvance, LiveFailureCode, LiveIdentity, LivePageInput, LiveResult, LiveMutation, LivePage, LiveDiscoveryJob, LiveJob, LiveJobDetails, LiveMessage, LiveServiceCredit, PostLiveRequest } from './ports';
import type { Language } from './types';

/** Inject the SAME SDK instance used by the auth gateway. The parent should expose
 * this narrow transport/factory from that gateway (its client is currently private).
 * Do not create another client, storage adapter, session or auth subscription here.
 * currentIdentity must read the gateway's current verified, non-recovery session;
 * return null immediately on sign-out, recovery, or account/backend transition.
 * getSession supplies that same client's current token; each RPC pins Authorization
 * to its preflight token so a late SDK session switch cannot act as another user.
 * The token never becomes part of a DTO, receipt, log or persisted draft. */
export interface LiveCommunityTransport {
  readonly backendId: string;
  readonly client: Pick<SupabaseClient, 'rpc'> & { auth: Pick<SupabaseClient['auth'], 'getSession'> };
  currentIdentity(): Promise<LiveIdentity | null>;
}
const failure = <T>(code: LiveFailureCode): LiveResult<T> => ({ok:false,code});
const serverFailures = ['invalid_input','invalid_state','permission_denied','pending_access','not_found','conflict','unsupported_team','idempotency_conflict'] as const;
const pageArgs = (page: LivePageInput): Record<string, unknown> | null => {
  if (!shape(page,[],['cursor','limit']) || (page.cursor!==undefined && !valid.cursor(page.cursor))
    || (page.limit!==undefined && (typeof page.limit!=='number' || !Number.isInteger(page.limit) || page.limit<1 || page.limit>100))) return null;
  return {p_before:page.cursor ?? null,p_limit:page.limit ?? 50};
};

export class SupabaseLiveCommunity implements AsyncLiveCommunityPort {
  readonly identity: LiveIdentity;
  constructor(private readonly transport: LiveCommunityTransport, identity: LiveIdentity) {
    if (!valid.uuid(identity.userId) || !identity.backendId || identity.backendId!==transport.backendId) throw new Error('Invalid live community binding');
    this.identity=Object.freeze({...identity});
  }
  private async bound(): Promise<boolean> {
    const current=await this.transport.currentIdentity();
    return current?.userId===this.identity.userId && current.backendId===this.identity.backendId;
  }
  private async call<T>(name: string, args: Record<string,unknown>, check: (v: unknown)=>v is T, signal: AbortSignal): Promise<LiveResult<T>> {
    if (signal.aborted) return failure('aborted');
    try {
      if (!await this.bound()) return failure('session_changed');
      const {data:session,error:sessionError}=await this.transport.client.auth.getSession();
      if (sessionError) return failure('retry');
      if (!session.session || session.session.user.id!==this.identity.userId || !await this.bound()) return failure('session_changed');
      if (signal.aborted) return failure('aborted');
      const {data,error}=await this.transport.client.rpc(name,args)
        .setHeader('Authorization',`Bearer ${session.session.access_token}`).abortSignal(signal);
      if (signal.aborted) return failure('aborted');
      if (!await this.bound()) return failure('session_changed');
      if (error) return failure(error.code==='42501' || error.code==='PGRST301' ? 'permission_denied' : 'retry');
      if (shape(data,['ok','code']) && data.ok===false && serverFailures.some(code=>code===data.code)) return failure(data.code as LiveFailureCode);
      if (!shape(data,['ok','value']) || data.ok!==true || !check(data.value)) return failure('retry');
      return {ok:true,value:data.value};
    } catch { return failure(signal.aborted ? 'aborted' : 'retry'); }
  }
  private mutate(op: string, payload: Record<string,unknown>, key: string, signal: AbortSignal) {
    if (!valid.uuid(key)) return Promise.resolve(failure<LiveMutation>('invalid_input'));
    // Snapshot plain bounded values before awaiting identity/session checks. A caller
    // mutating its draft in flight cannot change the payload associated with a key.
    const snapshot: Record<string,unknown>=JSON.parse(JSON.stringify(payload));
    const expectedStatus: Record<string,unknown>={post_request:'open',accept_job:'accepted',advance_job:snapshot.step,confirm_done:'completed',cancel_job:'cancelled',rate_job:'completed'};
    return this.call(`community_${op}`,{p_key:key,p_payload:snapshot},(v): v is LiveMutation => valid.mutation(v)
      && v.jobId===(snapshot.requestId ?? snapshot.jobId) && (op==='send_message'
        ? v.messageId!==null && ['accepted','on-the-way','arrived','reported-done'].includes(v.status)
        : v.messageId===null && v.status===expectedStatus[op]),signal);
  }
  access(signal: AbortSignal) { return this.call('community_access',{},valid.access,signal); }
  discover(page: LivePageInput, signal: AbortSignal) {
    const args=pageArgs(page);return args ? this.call('community_discover',args,valid.page(valid.discovery),signal) : Promise.resolve(failure<LivePage<LiveDiscoveryJob>>('invalid_input'));
  }
  ownJobs(page: LivePageInput, signal: AbortSignal) {
    const args=pageArgs(page);return args ? this.call('community_own_jobs',args,valid.page((v): v is LiveJob => valid.liveJob(v) && (v.elderId===this.identity.userId || v.volunteerId===this.identity.userId)),signal) : Promise.resolve(failure<LivePage<LiveJob>>('invalid_input'));
  }
  details(jobId: string, signal: AbortSignal) {
    return valid.uuid(jobId) ? this.call('community_job_details',{p_job_id:jobId},(v): v is LiveJobDetails => valid.details(v) && v.job.id===jobId && (v.job.elderId===this.identity.userId || v.job.volunteerId===this.identity.userId),signal) : Promise.resolve(failure<LiveJobDetails>('invalid_input'));
  }
  messages(jobId: string, page: LivePageInput, signal: AbortSignal) {
    const args=pageArgs(page);return args && valid.uuid(jobId) ? this.call('community_messages',{...args,p_job_id:jobId},valid.page((v): v is LiveMessage => valid.message(v) && v.jobId===jobId),signal) : Promise.resolve(failure<LivePage<LiveMessage>>('invalid_input'));
  }
  serviceHours(page: LivePageInput, signal: AbortSignal) {
    const args=pageArgs(page);return args ? this.call('community_service_hours',args,valid.page((v): v is LiveServiceCredit => valid.credit(v) && v.volunteerId===this.identity.userId),signal) : Promise.resolve(failure<LivePage<LiveServiceCredit>>('invalid_input'));
  }
  postRequest(input: PostLiveRequest, key: string, signal: AbortSignal) {
    if (!valid.postInput(input)) return Promise.resolve(failure<LiveMutation>('invalid_input'));
    if (input.analysis.peopleNeeded!==1) return Promise.resolve(failure<LiveMutation>('unsupported_team'));
    return this.mutate('post_request',{...input},key,signal);
  }
  acceptJob(jobId: string, key: string, signal: AbortSignal) { return this.jobMutation('accept_job',jobId,{},key,signal); }
  advanceJob(jobId: string, step: LiveAdvance, key: string, signal: AbortSignal) {
    if (!['on-the-way','arrived','reported-done'].includes(step)) return Promise.resolve(failure<LiveMutation>('invalid_input'));
    return this.jobMutation('advance_job',jobId,{step},key,signal);
  }
  sendMessage(jobId: string, text: string, language: Language, key: string, signal: AbortSignal) {
    if (!valid.liveText(text,2000) || !isLanguage(language)) return Promise.resolve(failure<LiveMutation>('invalid_input'));
    return this.jobMutation('send_message',jobId,{text,language},key,signal);
  }
  confirmDone(jobId: string, key: string, signal: AbortSignal) { return this.jobMutation('confirm_done',jobId,{},key,signal); }
  cancelJob(jobId: string, key: string, signal: AbortSignal) { return this.jobMutation('cancel_job',jobId,{},key,signal); }
  rateJob(jobId: string, stars: 1|2|3|4|5, note: string, key: string, signal: AbortSignal) {
    if (!Number.isInteger(stars) || stars<1 || stars>5 || !valid.liveText(note,1000,true)) return Promise.resolve(failure<LiveMutation>('invalid_input'));
    return this.jobMutation('rate_job',jobId,{stars,note},key,signal);
  }
  private jobMutation(op: string, jobId: string, extra: Record<string,unknown>, key: string, signal: AbortSignal) {
    return valid.uuid(jobId) ? this.mutate(op,{jobId,...extra},key,signal) : Promise.resolve(failure<LiveMutation>('invalid_input'));
  }
}
