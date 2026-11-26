import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acceptJob, createSeedState, sendMessage as send, signIn } from '../../community';
import type { CommunityState } from '../../community/types';
import { ActiveRequest, RequestList } from './Elder';
import { markMessagesSeen, unreadMessages } from './unread';

const now = '2026-10-25T16:00:00.000Z';
class MemoryStorage { private data = new Map<string, string>(); getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } removeItem(k: string) { this.data.delete(k); } clear() { this.data.clear(); } }
let original: Storage | undefined;
beforeEach(() => { original = globalThis.localStorage; Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true }); });
afterEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true }); });

/** The demo acts as whoever is signed in on the device; switch accounts the way the app does. */
function sendMessage(state: CommunityState, input: Parameters<typeof send>[1], at: string) {
  const signed = signIn(state, input.fromId); if (!signed.ok) throw new Error(signed.message);
  return send(signed.state, input, at);
}
function acceptedChat(): { state: CommunityState; jobId: string; elderId: string } {
  let state = createSeedState(now);
  const asJordan = signIn(state, 'volunteer-jordan'); if (!asJordan.ok) throw new Error(asJordan.message); state = asJordan.state;
  const job = state.jobs.find((j) => j.status === 'open')!;
  const accepted = acceptJob(state, { jobId: job.id, volunteerId: 'volunteer-jordan', scheduledFor: '2026-10-31T13:00:00.000Z' }, now);
  if (!accepted.ok) throw new Error(accepted.message);
  state = accepted.state;
  const sent = sendMessage(state, { jobId: job.id, fromId: 'volunteer-jordan', text: 'Hi! I can come Saturday at 9.', language: 'en' }, '2026-10-25T16:01:00.000Z');
  if (!sent.ok) throw new Error(sent.message);
  return { state: sent.state, jobId: job.id, elderId: job.elderId };
}

describe('unread messages', () => {
  it('counts only other people\'s messages until the chat is opened', () => {
    const { state, jobId, elderId } = acceptedChat();
    expect(unreadMessages(state, elderId, jobId)).toBe(1);
    expect(unreadMessages(state, 'volunteer-jordan', jobId)).toBe(0);
    markMessagesSeen(state, elderId, jobId);
    expect(unreadMessages(state, elderId, jobId)).toBe(0);
    const reply = sendMessage(state, { jobId, fromId: elderId, text: 'Thank you!', language: 'en' }, '2026-10-25T16:02:00.000Z');
    if (!reply.ok) throw new Error(reply.message);
    expect(unreadMessages(reply.state, 'volunteer-jordan', jobId)).toBe(1);
    expect(unreadMessages(reply.state, elderId, jobId)).toBe(0);
  });
  it('shows a badge on the older adult\'s Message button and on the volunteer\'s job card', () => {
    const { state, jobId, elderId } = acceptedChat();
    const job = state.jobs.find((j) => j.id === jobId)!;
    const card = renderToStaticMarkup(<ActiveRequest state={state} job={job} onNavigate={() => {}} viewerId={elderId}/>);
    expect(card).toContain('c-unread'); expect(card).toContain('New messages: 1');
    const reply = sendMessage(state, { jobId, fromId: elderId, text: 'See you then.', language: 'en' }, '2026-10-25T16:03:00.000Z');
    if (!reply.ok) throw new Error(reply.message);
    const list = renderToStaticMarkup(<RequestList state={reply.state} jobs={[job]} onOpen={() => {}} viewerId="volunteer-jordan" onMessage={() => {}}/>);
    expect(list).toContain('Message'); expect(list).toContain('New messages: 1');
  });
});
