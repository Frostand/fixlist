import { isLanguage, LANGUAGE_CODES } from '../domain/roles';
import { FAMILY_SCOPES, LEGACY_FAMILY_SCOPES, historicallyAuthorized, migrateFamilyHistory, reciprocalFamilyLink } from './family';
import { createSeedState } from './seed';
import * as valid from './validation';
import type { ChatMessage, CommunityFailure, CommunityResult, CommunityState, Job, JobStatus } from './types';

export const COMMUNITY_STORAGE_KEY = 'fixlist.community.v1';
function validHistory(state: CommunityState, job: Job): boolean {
  const first = job.timeline[0]!;
  if (first.type !== 'posted' || first.actorId !== job.createdById || first.at !== job.createdAt || !historicallyAuthorized(state, job.createdById, job.elderId, first.at, first.familyGrantRevision)) return false;
  let status: JobStatus = 'open', rated = false, lastTime = Date.parse(job.createdAt), accepted = false;
  for (const event of job.timeline.slice(1)) {
    const time = Date.parse(event.at);
    if (time < lastTime || !state.accounts.some((a) => a.id === event.actorId) || event.familyGrantRevision !== undefined && !state.accounts.some(a => a.id === event.actorId && a.role === 'family')) return false;
    lastTime = time;
    const assigned = event.actorId === job.volunteerId && state.volunteers.some((v) => v.accountId === event.actorId);
    switch (event.type) {
      case 'accepted':
        if (status !== 'open' || !assigned || !job.scheduledFor || Date.parse(job.scheduledFor) < time) return false;
        accepted = true; status = 'accepted'; break;
      case 'on-the-way': if (status !== 'accepted' || !assigned) return false; status = 'on-the-way'; break;
      case 'arrived': if (status !== 'on-the-way' || !assigned) return false; status = 'arrived'; break;
      case 'reported-done': if (!['accepted', 'on-the-way', 'arrived'].includes(status) || !assigned) return false; status = 'reported-done'; break;
      case 'confirmed': {
        const legacy = !state.familyHistory || state.familyHistory.legacyConfirmations.some(r => r.jobId === job.id && r.familyId === event.actorId && r.at === event.at);
        if (status !== 'reported-done' || event.actorId !== job.elderId && !legacy || !historicallyAuthorized(state, event.actorId, job.elderId, event.at, event.familyGrantRevision)) return false;
        status = 'completed'; break;
      }
      case 'rated':
        if (status !== 'completed' || rated || !historicallyAuthorized(state, event.actorId, job.elderId, event.at, event.familyGrantRevision) || !job.rating
          || job.rating.byId !== event.actorId || job.rating.at !== event.at) return false;
        rated = true; break;
      case 'cancelled': if (status === 'completed' || status === 'cancelled' || !historicallyAuthorized(state, event.actorId, job.elderId, event.at, event.familyGrantRevision)) return false; status = 'cancelled'; break;
      default: return false;
    }
  }
  return status === job.status && (accepted ? job.volunteerId !== null && job.scheduledFor !== null : job.volunteerId === null && job.scheduledFor === null)
    && (status === 'completed' ? job.hoursCredited === null || job.hoursCredited === valid.creditHours(job.analysis.estimatedMinutes) : job.hoursCredited === null)
    && rated === (job.rating !== null);
}
function validFamilyHistory(state: CommunityState): boolean {
  const h = state.familyHistory;
  if (h === undefined) return true;
  if (!valid.shape(h, ['grants', 'legacyConfirmations']) || !valid.list(h.grants, (g): g is import('./types').FamilyGrant =>
    valid.shape(g, ['familyId', 'elderId', 'revision', 'scopes', 'approvedById', 'approvedAt', 'revokedAt', 'revokedById', 'origin'])
    && valid.id(g.familyId) && valid.id(g.elderId) && g.approvedById === g.elderId && Number.isSafeInteger(g.revision) && (g.revision as number) > 0
    && valid.list(g.scopes, (s): s is import('./types').FamilyScope => valid.oneOf(s, FAMILY_SCOPES), 4) && valid.unique(g.scopes)
    && LEGACY_FAMILY_SCOPES.every(s => (g.scopes as string[]).includes(s)) && valid.iso(g.approvedAt)
    && valid.oneOf(g.origin, ['elder-approved', 'legacy-link', 'fictional-demo']) && (g.origin !== 'legacy-link' || !(g.scopes as string[]).includes('profile'))
    && (g.revokedAt === null ? g.revokedById === null : valid.iso(g.revokedAt) && Date.parse(g.revokedAt) >= Date.parse(g.approvedAt)
      && (g.revokedById === g.elderId || g.revokedById === g.familyId)))
    || !valid.unique(h.grants.map(g => g.revision)) || !valid.list(h.legacyConfirmations, (r): r is import('./types').FamilyHistory['legacyConfirmations'][number] =>
      valid.shape(r, ['jobId', 'familyId', 'at']) && valid.id(r.jobId) && valid.id(r.familyId) && valid.iso(r.at))) return false;
  if (!h.grants.every((g, i) => i === 0 || g.revision > h.grants[i - 1]!.revision)) return false;
  if (!valid.unique(h.legacyConfirmations.map(r => r.jobId))) return false;
  for (const g of h.grants) {
    if (!state.accounts.some(a => a.id === g.familyId && a.role === 'family') || !state.elders.some(e => e.accountId === g.elderId)) return false;
    const later = h.grants.filter(other => other.familyId === g.familyId && other.elderId === g.elderId && other.revision > g.revision);
    if (later.some(other => g.revokedAt === null || Date.parse(g.revokedAt) > Date.parse(other.approvedAt))) return false;
    if (g.revokedAt === null && !reciprocalFamilyLink(state, g.familyId, g.elderId)) return false;
  }
  if (!state.families.every(f => f.elderIds.every(elderId => h.grants.some(g => g.familyId === f.accountId && g.elderId === elderId && g.revokedAt === null)))) return false;
  return h.legacyConfirmations.every(r => {
    const job = state.jobs.find(j => j.id === r.jobId);
    return !!job && job.timeline.some(e => e.type === 'confirmed' && e.actorId === r.familyId && e.at === r.at)
      && h.grants.some(g => g.familyId === r.familyId && g.elderId === job.elderId && g.origin === 'legacy-link');
  });
}
function message(value: unknown): value is ChatMessage {
  return valid.shape(value, ['id', 'jobId', 'fromId', 'at', 'text', 'language', 'translations'], ['familyGrantRevision']) && valid.id(value.id) && valid.id(value.jobId) && valid.id(value.fromId)
    && valid.iso(value.at) && valid.text(value.text) && isLanguage(value.language) && valid.shape(value.translations, [], LANGUAGE_CODES)
    && (value.familyGrantRevision === undefined || Number.isSafeInteger(value.familyGrantRevision) && (value.familyGrantRevision as number) > 0)
    && Object.values(value.translations).every((translation) => valid.text(translation));
}
/** Validate shapes and cross-record permissions; no state is trusted merely because it parsed as JSON. */
export function validateCommunityState(value: unknown): value is CommunityState {
  try {
    if (!valid.shape(value, ['version', 'session', 'accounts', 'elders', 'volunteers', 'families', 'jobs', 'messages'], ['familyHistory']) || value.version !== 1
      || !valid.shape(value.session, ['accountId', 'onboarded']) || !(value.session.accountId === null || valid.id(value.session.accountId)) || !valid.ids(value.session.onboarded)
      || !valid.list(value.accounts, valid.account) || !valid.list(value.elders, valid.elder) || !valid.list(value.volunteers, valid.volunteer) || !valid.list(value.families, valid.family)
      || !valid.list(value.jobs, valid.job) || !valid.list(value.messages, message)) return false;
    const state = value as unknown as CommunityState;
    const accountIds = state.accounts.map((a) => a.id);
    if (!valid.unique([...accountIds, ...state.jobs.map((j) => j.id), ...state.messages.map((m) => m.id)])
      || !valid.unique(state.elders.map((e) => e.accountId)) || !valid.unique(state.volunteers.map((v) => v.accountId)) || !valid.unique(state.families.map((f) => f.accountId))
      || state.session.accountId !== null && !accountIds.includes(state.session.accountId) || !state.session.onboarded.every((i) => accountIds.includes(i))) return false;
    if (!state.accounts.every((a) => (state.elders.some((e) => e.accountId === a.id) ? a.role === 'elder' : a.role !== 'elder')
      && (state.volunteers.some((v) => v.accountId === a.id) ? a.role === 'volunteer' : a.role !== 'volunteer')
      && (state.families.some((f) => f.accountId === a.id) ? a.role === 'family' : a.role !== 'family'))) return false;
    if (!state.elders.every((e) => state.accounts.some((a) => a.id === e.accountId && a.role === 'elder')
      && e.familyIds.every((i) => state.families.some((f) => f.accountId === i && f.elderIds.includes(e.accountId))))
      || !state.volunteers.every((v) => state.accounts.some((a) => a.id === v.accountId && a.role === 'volunteer'))
      || !state.families.every((f) => state.accounts.some((a) => a.id === f.accountId && a.role === 'family')
        && f.elderIds.every((i) => state.elders.some((e) => e.accountId === i && e.familyIds.includes(f.accountId))))) return false;
    if (!validFamilyHistory(state)) return false;
    if (!state.jobs.every((j) => state.elders.some((e) => e.accountId === j.elderId) && validHistory(state, j))) return false;
    return state.messages.every((m) => {
      const job = state.jobs.find((j) => j.id === m.jobId);
      return !!job && accountIds.includes(m.fromId) && Date.parse(m.at) >= Date.parse(job.createdAt)
        && (historicallyAuthorized(state, m.fromId, job.elderId, m.at, m.familyGrantRevision, 'messages') || m.fromId === job.volunteerId && m.familyGrantRevision === undefined);
    });
  } catch { return false; }
}
export interface CommunitySnapshot {
  state: CommunityState;
  status: 'loaded' | 'seeded' | 'recovered';
  raw: string | null;
  revision: number;
  resetEpoch: string;
  readable: boolean;
}
/** State and its exact durable precondition always come from the same read. No read migrates bytes. */
export function loadCommunitySnapshot(storage: Storage | null, now: string): CommunitySnapshot {
  let raw: string | null = null, readable = false;
  try {
    if (storage) { raw = storage.getItem(COMMUNITY_STORAGE_KEY); readable = true; }
    if (raw === null) return { state: createSeedState(now), status: 'seeded', raw, revision: 0, resetEpoch: 'empty', readable };
    const value: unknown = JSON.parse(raw);
    if (validateCommunityState(value)) return { state: migrateFamilyHistory(value), status: 'loaded', raw, revision: 0, resetEpoch: 'legacy', readable };
    if (valid.shape(value, ['revision', 'resetEpoch', 'state']) && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0
      && typeof value.resetEpoch === 'string' && value.resetEpoch.length > 0 && value.resetEpoch.length <= 200 && validateCommunityState(value.state)) {
      return { state: migrateFamilyHistory(value.state), status: 'loaded', raw, revision: value.revision as number, resetEpoch: value.resetEpoch, readable };
    }
  } catch { /* Preserve corrupt bytes and distinguish inaccessible storage from an absent key. */ }
  return { state: createSeedState(now), status: 'recovered', raw, revision: 0, resetEpoch: 'recovered', readable };
}
export function loadCommunity(storage: Storage | null, now: string): { state: CommunityState; status: CommunitySnapshot['status'] } {
  const { state, status } = loadCommunitySnapshot(storage, now);
  return { state, status };
}
const subscribers = new WeakMap<Storage, Set<() => void>>();
function notifyCommunity(storage: Storage) { for (const listener of subscribers.get(storage) ?? []) listener(); }
function envelope(snapshot: CommunitySnapshot, state: CommunityState, resetEpoch: string): string {
  if (!validateCommunityState(state) || !Number.isSafeInteger(snapshot.revision + 1)) throw new Error('Invalid community state or revision.');
  return JSON.stringify({ revision: snapshot.revision + 1, resetEpoch, state });
}
function newResetEpoch() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
/** Compatibility convenience API. Interactive commands use the observed-snapshot controller below. */
export function saveCommunity(storage: Storage | null, state: CommunityState): boolean {
  try {
    if (!storage) return false;
    const snapshot = loadCommunitySnapshot(storage, new Date().toISOString());
    if (!snapshot.readable) return false;
    storage.setItem(COMMUNITY_STORAGE_KEY, envelope(snapshot, state, snapshot.resetEpoch));
  } catch { return false; }
  notifyCommunity(storage);
  return true;
}
export function resetCommunity(storage: Storage | null, now: string): CommunityState {
  const state = createSeedState(now);
  try {
    if (storage) {
      const snapshot = loadCommunitySnapshot(storage, now);
      if (snapshot.readable) {
        storage.setItem(COMMUNITY_STORAGE_KEY, envelope(snapshot, state, newResetEpoch()));
        notifyCommunity(storage);
      }
    }
  } catch { /* Legacy API returns the candidate seed; controllers report reset failures explicitly. */ }
  return state;
}

export type CommunityIssue = 'command' | 'storage' | 'recovered' | null;
/** Synchronous preconditions, not atomic CAS: genuinely simultaneous tab writes can still race. */
export function createCommunityStore(storage: Storage | null, now = () => new Date().toISOString()) {
  let observed = loadCommunitySnapshot(storage, now());
  let issue: CommunityIssue = observed.status === 'recovered' ? 'recovered' : null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  function storageFailure(): CommunityFailure {
    issue = 'storage'; publish();
    return { ok: false, code: 'invalid_state', message: 'Community changes could not be saved.' };
  }
  function conflict(latest: CommunitySnapshot): CommunityFailure {
    observed = latest; issue = 'command'; publish();
    return { ok: false, code: 'conflict', message: 'Community data changed. Review the latest state before trying again.' };
  }
  function check(raw: string | null): CommunityFailure | null {
    const latest = loadCommunitySnapshot(storage, now());
    if (!latest.readable) return storageFailure();
    return latest.raw === raw ? null : conflict(latest);
  }
  function refresh() {
    const latest = loadCommunitySnapshot(storage, now());
    if (!latest.readable) { storageFailure(); return; }
    if (latest.raw !== observed.raw) {
      observed = latest; issue = latest.status === 'recovered' ? 'recovered' : null; publish();
    }
  }
  function commit<T extends CommunityResult>(command: (state: CommunityState) => T, reset = false): T | CommunityFailure {
    const before = observed, initialFailure = check(before.raw);
    if (initialFailure) return initialFailure;
    const result = command(before.state);
    if (!result.ok) {
      const failure = check(before.raw);
      if (failure) return failure;
      issue = 'command'; publish(); return result;
    }
    let raw: string;
    try { raw = envelope(before, result.state, reset ? newResetEpoch() : before.resetEpoch); }
    catch { return storageFailure(); }
    const failure = check(before.raw);
    if (failure) return failure;
    try { storage!.setItem(COMMUNITY_STORAGE_KEY, raw); }
    catch { return storageFailure(); }
    // Also reject any replacement visible before publication; this still is not a cross-tab transaction.
    const saved = loadCommunitySnapshot(storage, now());
    if (!saved.readable) return storageFailure();
    if (saved.raw !== raw) return conflict(saved);
    observed = { ...saved, state: result.state }; issue = null; publish();
    notifyCommunity(storage!);
    return result;
  }
  return {
    get state() { return observed.state; },
    get resetEpoch() { return observed.resetEpoch; },
    get issue() { return issue; },
    run: <T extends CommunityResult>(command: (state: CommunityState) => T): T | CommunityFailure => commit(command),
    reset: (): CommunityResult => commit(() => ({ ok: true, state: createSeedState(now()) }), true),
    clearIssue() { issue = null; publish(); },
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (storage) {
        let clients = subscribers.get(storage);
        if (!clients) { clients = new Set(); subscribers.set(storage, clients); }
        clients.add(refresh);
      }
      return () => {
        listeners.delete(listener);
        if (storage && !listeners.size) subscribers.get(storage)?.delete(refresh);
      };
    },
  };
}
