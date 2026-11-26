import type { CommunityState } from '../../community/types';

/** Per-device record of the newest message each account has seen in each job's chat. Demo-only; no server state. */
const KEY = 'fixlist.messages.seen.v1';
type Seen = Record<string, string>;
const id = (accountId: string, jobId: string) => `${accountId}:${jobId}`;
function read(): Seen {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Seen : {};
  } catch { return {}; }
}
/** Messages from other people in this job that arrived after the account last opened the chat. */
export function unreadMessages(state: CommunityState, accountId: string, jobId: string): number {
  const seen = read()[id(accountId, jobId)] ?? '';
  return state.messages.filter((m) => m.jobId === jobId && m.fromId !== accountId && m.at > seen).length;
}
export function markMessagesSeen(state: CommunityState, accountId: string, jobId: string): void {
  const latest = state.messages.filter((m) => m.jobId === jobId).reduce((newest, m) => (m.at > newest ? m.at : newest), '');
  const all = read();
  if (!latest || (all[id(accountId, jobId)] ?? '') >= latest) return;
  all[id(accountId, jobId)] = latest;
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(all)); } catch { /* Storage full or unavailable: badges simply stay. */ }
}
export const ACTIVE_STATUSES: readonly string[] = ['accepted', 'on-the-way', 'arrived', 'reported-done'];
