import { describe, expect, it, vi } from 'vitest';
import { createSeedState } from './seed';
import { COMMUNITY_STORAGE_KEY, loadCommunity, loadCommunitySnapshot, resetCommunity, saveCommunity, validateCommunityState } from './storage';
import type { CommunityState } from './types';

const NOW = '2026-10-23T12:00:00.000Z';
class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
describe('fictional seed data', () => {
  it('is valid, deterministic and has unique IDs and complete role references', () => {
    const state = createSeedState(NOW); expect(validateCommunityState(state)).toBe(true); expect(createSeedState(NOW)).toEqual(state);
    expect(state.accounts).toHaveLength(14); expect(state.elders).toHaveLength(7); expect(state.volunteers).toHaveLength(6); expect(state.families).toHaveLength(1);
    const ids = [...state.accounts.map((a) => a.id), ...state.jobs.map((j) => j.id), ...state.messages.map((m) => m.id)]; expect(new Set(ids).size).toBe(ids.length);
    expect(state.jobs.every((j) => state.accounts.some((a) => a.id === j.elderId && a.role === 'elder'))).toBe(true);
    expect(state.jobs.filter((j) => j.status === 'open')).toHaveLength(8); expect(state.jobs.filter((j) => j.status === 'accepted')).toHaveLength(1);
    expect(state.jobs.filter((j) => j.status === 'on-the-way')).toHaveLength(1); expect(state.jobs.filter((j) => j.status === 'completed')).toHaveLength(22);
    expect(state.jobs.filter((j) => j.elderId === 'elder-margaret')).toHaveLength(1); expect(state.jobs.filter((j) => j.elderId === 'elder-margaret')[0]!.status).toBe('completed');
    expect(state.accounts.every((a) => a.location.lat >= 33.9 && a.location.lat <= 34.5 && a.location.lng >= -84.3 && a.location.lng <= -83.9)).toBe(true);
    expect(state.elders.every((e) => e.accountId === 'elder-new-demo' ? e.addressHint === '' : e.addressHint.includes('(fictional)'))).toBe(true);
    expect(state.jobs.find((j) => j.elderId === 'elder-soonja')!.originalText).toMatch(/[가-힣]/u);
    expect(state.jobs.find((j) => j.elderId === 'elder-wei')!.originalText).toMatch(/[\u4e00-\u9fff]/u);
    expect(() => createSeedState('bad')).toThrow(RangeError);
  });
  it('shifts all timestamps relative to now without sharing nested records', () => {
    const first = createSeedState(NOW), later = createSeedState('2026-10-24T12:00:00.000Z');
    expect(Date.parse(later.jobs[0]!.createdAt) - Date.parse(first.jobs[0]!.createdAt)).toBe(86400000);
    (first.volunteers[0]!.tools as string[]).push('car'); expect(createSeedState(NOW).volunteers[0]!.tools).not.toContain('car');
  });
});
describe('community storage validation and recovery', () => {
  it('reads legacy version-1 state without migrating or dropping its bytes', () => {
    const storage = new MemoryStorage(), state = createSeedState(NOW), raw = JSON.stringify(state, null, 2);
    storage.setItem(COMMUNITY_STORAGE_KEY, raw);
    expect(loadCommunity(storage, NOW)).toEqual({ state, status: 'loaded' });
    expect(storage.getItem(COMMUNITY_STORAGE_KEY)).toBe(raw);
  });
  it('loads a validated revision/epoch envelope without rewriting it', () => {
    const storage = new MemoryStorage(), state = createSeedState(NOW), raw = JSON.stringify({ revision: 7, resetEpoch: 'reset-one', state });
    storage.setItem(COMMUNITY_STORAGE_KEY, raw);
    expect(loadCommunity(storage, NOW)).toEqual({ state, status: 'loaded' });
    expect(storage.getItem(COMMUNITY_STORAGE_KEY)).toBe(raw);
  });
  it('pairs the loaded state and exact raw precondition in one read', () => {
    const storage = new MemoryStorage(), state = createSeedState(NOW), raw = JSON.stringify({ revision: 3, resetEpoch: 'epoch-three', state }, null, 2);
    const read = vi.spyOn(storage, 'getItem').mockReturnValueOnce(raw).mockReturnValue('different later bytes');
    expect(loadCommunitySnapshot(storage, NOW)).toEqual({ state, raw, status: 'loaded', revision: 3, resetEpoch: 'epoch-three', readable: true });
    expect(read).toHaveBeenCalledExactlyOnceWith(COMMUNITY_STORAGE_KEY);
  });
  it.each([
    { revision: -1, resetEpoch: 'epoch' }, { revision: 1.5, resetEpoch: 'epoch' },
    { revision: Number.MAX_SAFE_INTEGER + 1, resetEpoch: 'epoch' }, { revision: 1, resetEpoch: '' },
    { revision: 1, resetEpoch: 7 }, { revision: 1, resetEpoch: 'epoch', extra: true },
  ])('rejects malformed envelope metadata while preserving its bytes: %j', metadata => {
    const storage = new MemoryStorage(), raw = JSON.stringify({ ...metadata, state: createSeedState(NOW) });
    storage.setItem(COMMUNITY_STORAGE_KEY, raw);
    expect(loadCommunity(storage, NOW).status).toBe('recovered');
    expect(storage.getItem(COMMUNITY_STORAGE_KEY)).toBe(raw);
  });
  it('round-trips only this key and resets without clearing unrelated browser data', () => {
    const storage = new MemoryStorage(), state = createSeedState(NOW); storage.setItem('unrelated', 'keep');
    expect(loadCommunity(storage, NOW)).toEqual({ state, status: 'seeded' }); expect(saveCommunity(storage, state)).toBe(true);
    expect(loadCommunity(storage, NOW)).toEqual({ state, status: 'loaded' });
    expect(resetCommunity(storage, NOW)).toEqual(state); expect(JSON.parse(storage.getItem(COMMUNITY_STORAGE_KEY)!)).toMatchObject({ state, resetEpoch: expect.any(String) }); expect(storage.getItem('unrelated')).toBe('keep');
    expect(loadCommunity(storage, NOW).status).toBe('loaded');
  });
  it.each(['{broken json', '{}', 'null', '{"version":9}'])('recovers corrupt data while preserving its saved bytes: %s', (raw) => {
    const storage = new MemoryStorage(); storage.setItem(COMMUNITY_STORAGE_KEY, raw);
    const loaded = loadCommunity(storage, NOW); expect(loaded.status).toBe('recovered'); expect(validateCommunityState(loaded.state)).toBe(true); expect(storage.getItem(COMMUNITY_STORAGE_KEY)).toBe(raw);
  });
  it('handles missing storage, blocked reads, quota failures and reset errors', () => {
    const blocked: Storage = { length: 0, clear: () => { throw new Error('blocked'); }, key: () => null, getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(loadCommunity(null, NOW).status).toBe('seeded'); expect(loadCommunity(blocked, NOW).status).toBe('recovered');
    expect(saveCommunity(null, createSeedState(NOW))).toBe(false); expect(saveCommunity(blocked, createSeedState(NOW))).toBe(false);
    expect(validateCommunityState(resetCommunity(blocked, NOW))).toBe(true); expect(validateCommunityState(resetCommunity(null, NOW))).toBe(true);
  });
  it.each([
    ['wrong version', (s: CommunityState) => ({ ...s, version: 2 })],
    ['duplicate account', (s: CommunityState) => ({ ...s, accounts: [...s.accounts, s.accounts[0]] })],
    ['missing session account', (s: CommunityState) => ({ ...s, session: { ...s.session, accountId: 'missing' } })],
    ['unknown onboarded account', (s: CommunityState) => ({ ...s, session: { ...s.session, onboarded: ['missing'] } })],
    ['missing elder profile', (s: CommunityState) => ({ ...s, elders: s.elders.slice(1) })],
    ['wrong profile role', (s: CommunityState) => ({ ...s, volunteers: [...s.volunteers, { ...s.volunteers[0], accountId: 'elder-margaret' }] })],
    ['one-sided family link', (s: CommunityState) => ({ ...s, families: [{ accountId: 'family-alex', elderIds: [] }] })],
    ['bad language', (s: CommunityState) => ({ ...s, accounts: s.accounts.map((a, i) => i ? a : { ...a, language: 'zz' }) })],
    ['bad coordinates', (s: CommunityState) => ({ ...s, accounts: s.accounts.map((a, i) => i ? a : { ...a, location: { lat: NaN, lng: 0 } }) })],
    ['bad calendar date', (s: CommunityState) => ({ ...s, accounts: s.accounts.map((a, i) => i ? a : { ...a, createdAt: '2026-02-30T00:00:00Z' }) })],
    ['unsupported skill', (s: CommunityState) => ({ ...s, volunteers: s.volunteers.map((v, i) => i ? v : { ...v, skills: ['wizard'] }) })],
    ['invalid slot', (s: CommunityState) => ({ ...s, volunteers: s.volunteers.map((v, i) => i ? v : { ...v, availability: [{ day: 7, part: 'morning' }] }) })],
    ['nonexistent elder', (s: CommunityState) => ({ ...s, jobs: s.jobs.map((j, i) => i ? j : { ...j, elderId: 'missing' }) })],
    ['no posted event', (s: CommunityState) => ({ ...s, jobs: s.jobs.map((j, i) => i ? j : { ...j, timeline: [] }) })],
    ['invented assignment', (s: CommunityState) => ({ ...s, jobs: s.jobs.map((j, i) => i ? j : { ...j, status: 'accepted', volunteerId: 'volunteer-jordan', scheduledFor: NOW }) })],
    ['premature hours', (s: CommunityState) => ({ ...s, jobs: s.jobs.map((j, i) => i ? j : { ...j, hoursCredited: 1 }) })],
    ['incorrect confirmed hours', (s: CommunityState) => ({ ...s, jobs: s.jobs.map((j) => j.status === 'completed' ? { ...j, hoursCredited: 10 } : j) })],
    ['fake rating actor', (s: CommunityState) => ({ ...s, jobs: s.jobs.map((j) => j.rating ? { ...j, rating: { ...j.rating, byId: 'volunteer-jordan' } } : j) })],
    ['out of range scan point', (s: CommunityState) => ({ ...s, jobs: s.jobs.map((j, i) => i ? j : { ...j, evidence: [{ roomId: 'room', photoId: 'photo', flagId: 'flag', label: 'spot', point: { u: 2, v: 0 }, thumbnail: null }] }) })],
    ['untrusted image URL', (s: CommunityState) => ({ ...s, jobs: s.jobs.map((j, i) => i ? j : { ...j, evidence: [{ roomId: 'room', photoId: 'photo', flagId: 'flag', label: 'spot', point: null, thumbnail: 'https://example.com/photo.jpg' }] }) })],
    ['outsider message', (s: CommunityState) => ({ ...s, messages: [{ id: 'message-one', jobId: s.jobs[0]!.id, fromId: 'volunteer-marcus', at: NOW, text: 'hello', language: 'en', translations: {} }] })],
    ['unknown property', (s: CommunityState) => ({ ...s, uploaded: true })],
  ])('rejects %s in load and save', (_label, corrupt) => {
    const bad = corrupt(createSeedState(NOW)); expect(validateCommunityState(bad)).toBe(false);
    const storage = new MemoryStorage(); storage.setItem(COMMUNITY_STORAGE_KEY, JSON.stringify(bad));
    expect(loadCommunity(storage, NOW).status).toBe('recovered'); expect(saveCommunity(storage, bad as CommunityState)).toBe(false);
  });
  it('rejects getters without invoking them, sparse arrays, unknown event types and backwards history', () => {
    const seed = createSeedState(NOW); let invoked = false;
    const getter = { ...seed }; Object.defineProperty(getter, 'version', { get: () => { invoked = true; return 1; }, enumerable: true });
    expect(validateCommunityState(getter)).toBe(false); expect(invoked).toBe(false);
    expect(validateCommunityState({ ...seed, accounts: new Array(12) })).toBe(false);
    for (const patch of [{ type: 'magically-done' }, { at: '2000-01-01T00:00:00Z' }]) {
      const jobs = seed.jobs.map((j) => j.status === 'completed' ? { ...j, timeline: j.timeline.map((event, i) => i === 1 ? { ...event, ...patch } : event) } : j);
      expect(validateCommunityState({ ...seed, jobs })).toBe(false);
    }
  });
});
