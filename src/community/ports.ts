import type { JobAnalysis, JobEventType, JobSource, JobStatus, Language, Skill, TaskCategory } from './types';

/** Live DTOs deliberately contain no fictional geo, screening badges or demo state. */
export type LiveFailureCode = 'invalid_input' | 'invalid_state' | 'permission_denied' | 'pending_access'
  | 'not_found' | 'conflict' | 'unsupported_team' | 'idempotency_conflict' | 'retry' | 'aborted' | 'session_changed';
export type LiveResult<T> = { ok: true; value: T } | { ok: false; code: LiveFailureCode };
export interface LiveIdentity { readonly backendId: string; readonly userId: string }
export interface LiveAccess {
  state: 'approved' | 'pending' | 'revoked'; role: 'elder' | 'volunteer' | null;
  community: { id: string; label: string; coarseArea: string } | null;
}
export interface LiveDiscoveryJob {
  id: string; category: TaskCategory; catalogTitle: string; coarseArea: string;
  neededSkills: readonly Skill[]; approvedServiceCreditMinutes: number | null;
}
export interface LiveJob extends LiveDiscoveryJob {
  elderId: string; volunteerId: string | null; status: JobStatus; createdAt: string;
}
export interface LiveEvent { id: string; actorId: string; type: JobEventType; at: string }
export interface LiveRating { stars: 1 | 2 | 3 | 4 | 5; note: string; at: string; byId: string }
export interface LiveJobDetails {
  job: LiveJob; source: JobSource; originalText: string; analysis: JobAnalysis; address: string;
  elderName: string; volunteerName: string | null; events: readonly LiveEvent[]; rating: LiveRating | null;
}
export interface LiveMessage { id: string; jobId: string; fromId: string; at: string; text: string; language: Language }
/** Approved service credit, not measured work duration or official school verification. */
export interface LiveServiceCredit { jobId: string; volunteerId: string; approvedServiceCreditMinutes: number; confirmedAt: string }
export interface LivePage<T> { items: readonly T[]; nextCursor: string | null }
export interface LivePageInput { cursor?: string; limit?: number }
export interface PostLiveRequest { requestId: string; source: JobSource; originalText: string; analysis: JobAnalysis; address: string }
export interface LiveMutation { jobId: string; status: JobStatus; messageId: string | null }
export type LiveAdvance = 'on-the-way' | 'arrived' | 'reported-done';

/** All calls require a signal. Retain the same idempotency key AND payload after an
 * uncertain response, including cancellation. Receipts replay the committed result,
 * which may precede the current job state. Refresh queries after mutations.
 * Queries use descending server ordinals, at most 100 rows/page; messages newest first.
 * No realtime subscriptions or automatic/background mutations are implied. */
export interface AsyncLiveCommunityPort {
  readonly identity: LiveIdentity;
  access(signal: AbortSignal): Promise<LiveResult<LiveAccess>>;
  discover(page: LivePageInput, signal: AbortSignal): Promise<LiveResult<LivePage<LiveDiscoveryJob>>>;
  ownJobs(page: LivePageInput, signal: AbortSignal): Promise<LiveResult<LivePage<LiveJob>>>;
  details(jobId: string, signal: AbortSignal): Promise<LiveResult<LiveJobDetails>>;
  messages(jobId: string, page: LivePageInput, signal: AbortSignal): Promise<LiveResult<LivePage<LiveMessage>>>;
  serviceHours(page: LivePageInput, signal: AbortSignal): Promise<LiveResult<LivePage<LiveServiceCredit>>>;
  postRequest(input: PostLiveRequest, key: string, signal: AbortSignal): Promise<LiveResult<LiveMutation>>;
  acceptJob(jobId: string, key: string, signal: AbortSignal): Promise<LiveResult<LiveMutation>>;
  advanceJob(jobId: string, step: LiveAdvance, key: string, signal: AbortSignal): Promise<LiveResult<LiveMutation>>;
  sendMessage(jobId: string, text: string, language: Language, key: string, signal: AbortSignal): Promise<LiveResult<LiveMutation>>;
  confirmDone(jobId: string, key: string, signal: AbortSignal): Promise<LiveResult<LiveMutation>>;
  cancelJob(jobId: string, key: string, signal: AbortSignal): Promise<LiveResult<LiveMutation>>;
  rateJob(jobId: string, stars: 1 | 2 | 3 | 4 | 5, note: string, key: string, signal: AbortSignal): Promise<LiveResult<LiveMutation>>;
}
