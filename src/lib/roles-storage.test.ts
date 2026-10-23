import { describe, expect, it } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { LEGACY_LABEL } from '../data/demo-people';
import { applyCommand, createInitialState, computePlan, getRequestViews, type DemoState } from '../domain/workflow';
import { activeState, at, atStage, run, target } from '../domain/roles-test-helpers';
import type { HelpRequestStatus } from '../domain/roles';
import { DEMO_STORAGE_KEY, loadDemoState, resetFixListData, saveDemoState, validateState, type DemoStorage } from './demo-storage';
import { FAMILY_LABEL, HELPER_LABEL, REQUEST_NOTE, REQUEST_SOURCE } from '../domain/rules';
class Store implements DemoStorage {
  values = new Map<string, string>(); writes: string[] = []; removes: string[] = [];
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string, v: string) { this.writes.push(k); this.values.set(k, v); }
  removeItem(k: string) { this.removes.push(k); this.values.delete(k); }
}
const statuses: HelpRequestStatus[] = ['draft', 'invited', 'accepted', 'declined', 'scheduled', 'in_progress', 'volunteer_reported_done', 'resident_confirmed_done', 'cancelled'];
describe('version 3 trusted reconstruction', () => {
  it.each(statuses.flatMap((status) => [true, false].map((active) => ({ status, active }))))('round trip $status, active=$active, every profile', async ({ status, active }) => {
    let s = atStage(status);
    if (!active) s = run(s, { type: 'unconfirm_concern', concernId: 'rug-concern' });
    for (const p of demoScenario.profiles) {
      s = run(s, { type: 'select_profile', profileId: p.id }); const store = new Store(); expect((await saveDemoState(store, demoScenario, s)).status).toBe('saved');
      const loaded = loadDemoState(store, demoScenario); expect(loaded.status).toBe('loaded'); expect(loaded.state).toEqual(s); expect(loaded.state).not.toBe(s); expect(loaded.state.requests).not.toBe(s.requests); expect(loaded.state.people[0]).not.toBe(s.people[0]); expect(computePlan(demoScenario, loaded.state)).toEqual(computePlan(demoScenario, s));
    }
  });
  it('round trips grants, removed confirmation attribution, photos, person prefs and sharing', () => {
    let s = run(atStage('invited'), { type: 'grant_delegation', personId: 'sam', scopes: ['checklist'] });
    s = run(s, { type: 'add_photo', photoId: 'p', checklistItemId: 'rug-check', width: 1000, height: 800 }, 'sam'); s = run(s, { type: 'set_language', language: 'es' }, 'sam'); s = run(s, { type: 'set_onboarding', guideId: 'elder', stepIndex: 3, completed: true });
    s = run(s, { type: 'set_sharing', ...target(s), sharing: { roomName: true, photos: true, scanLocation: true, visitTimes: true, areaLabel: true }, visitTimes: 'Saturday', areaLabel: 'Fictional Maple area', scanLocation: 'pin-rug' });
    s = run(s, { type: 'unconfirm_concern', concernId: 'rug-concern' });
    expect(validateState(s, demoScenario)).toEqual({ ok: true, state: s });
    expect(s.confirmationAttribution['rug-concern']).toEqual({ actorId: 'margaret', at });
  });
  const paths = [[], ['people', 0], ['people', 0, 'createdBy'], ['household'], ['requests', 0], ['requests', 0, 'sharing'], ['requests', 0, 'createdBy'], ['requests', 0, 'history', 0], ['requests', 0, 'proposedTime'], ['requests', 0, 'agreedTime'], ['requests', 0, 'updates', 0], ['requests', 0, 'reportedDone'], ['requests', 0, 'confirmedDone'], ['confirmations', 'rug-concern'], ['confirmationAttribution', 'rug-concern'], ['checklistAttribution', 'rug-check']] as const;
  function atPath(value: unknown, path: readonly (string | number)[]): Record<string, unknown> { let out = value as Record<string, unknown>; for (const key of path) out = out[key] as Record<string, unknown>; return out; }
  it.each(paths.map((path) => ({ path, name: path.join('.') || 'root' })))('rejects missing/extra/accessor fields at $name without running getters', ({ path }) => {
    const base = atStage('resident_confirmed_done'); const keys = Object.keys(atPath(base, path));
    for (const key of keys) { const s = structuredClone(base); delete atPath(s, path)[key]; expect(validateState(s, demoScenario).ok).toBe(false); }
    const extra = structuredClone(base); atPath(extra, path).secret = 'not allowed'; expect(validateState(extra, demoScenario).ok).toBe(false);
    let calls = 0; const getter = structuredClone(base); Object.defineProperty(atPath(getter, path), keys[0]!, { enumerable: true, get: () => { calls++; return 'must not read'; } }); expect(validateState(getter, demoScenario).ok).toBe(false); expect(calls).toBe(0);
  });
  it.each([
    (s: DemoState) => { s.people[2]!.role = 'resident'; },
    (s: DemoState) => { s.people[2]!.role = 'family_helper'; },
    (s: DemoState) => { s.household.residentId = 'alex'; },
    (s: DemoState) => { s.people[0]!.name = 'Other'; },
    (s: DemoState) => { s.people[0]!.language = 'xx' as never; },
    (s: DemoState) => { s.requests[0]!.volunteerId = 'jordan'; },
    (s: DemoState) => { s.requests[0]!.status = 'draft'; },
    (s: DemoState) => { s.requests[0]!.revision++; },
    (s: DemoState) => { s.requests[0]!.history[1]!.type = 'report_done'; },
    (s: DemoState) => { s.requests[0]!.history[2]!.actorId = 'jordan'; },
    (s: DemoState) => { s.requests[0]!.agreedTime!.text = 'Changed'; },
    (s: DemoState) => { s.requests[0]!.independentVerification = 'verified' as never; },
  ])('rejects inconsistent roles, assignments, history, revision or verification %#', (mutate) => { const s = atStage('resident_confirmed_done'); mutate(s); expect(validateState(s, demoScenario).ok).toBe(false); });
  it('rejects unknown actors and malformed public commands instead of role or clock defaults', () => {
    const s = activeState();
    expect(applyCommand(demoScenario, s, { type: 'select_profile', profileId: 'maple-owner' } as never).ok).toBe(false);
    expect(applyCommand(demoScenario, s, { type: 'select_profile', profileId: 'maple-owner', actorId: 'alex', at } as never).ok).toBe(false);
    expect(applyCommand(demoScenario, s, { type: 'create_request', referenceActionId: 'review-rug', actorId: 'margaret', at } as never).ok).toBe(false);
  });
});
function v2(status: 'draft' | 'family_reported_requested' | 'family_reported_in_progress', complete: boolean, active: boolean) {
  const initial = createInitialState(demoScenario);
  return { schemaVersion: 2, scenarioId: demoScenario.id, checklistAnswers: { ...initial.checklistAnswers, 'rug-check': 'yes' }, confirmations: { ...initial.confirmations, ...(active ? { 'rug-concern': { humanConfirmed: true, confirmedBy: FAMILY_LABEL, confirmedAt: at } } : {}) }, profileId: 'maple-owner', requests: [{ id: 'request-review-rug', referenceActionId: 'review-rug', helperLabel: HELPER_LABEL, recordedBy: FAMILY_LABEL, status, note: REQUEST_NOTE, completion: complete ? { status: 'family_reported_complete', reportedBy: FAMILY_LABEL, reportedAt: at } : { status: 'unconfirmed', reportedBy: null, reportedAt: null }, source: { ...REQUEST_SOURCE } }] };
}
describe('v2 to v4 in-memory migration', () => {
  const modes = [{ status: 'draft', complete: false }, { status: 'family_reported_requested', complete: false }, { status: 'family_reported_in_progress', complete: false }, { status: 'family_reported_requested', complete: true }, { status: 'family_reported_in_progress', complete: true }] as const;
  it.each(modes.flatMap((mode) => [false, true].map((active) => ({ ...mode, active }))))('$status complete=$complete active=$active preserves history without inferred invitations', async ({ status, complete, active }) => {
    const old = v2(status, complete, active); const bytes = JSON.stringify(old); const store = new Store(); store.values.set(DEMO_STORAGE_KEY, bytes); store.values.set('other', 'keep');
    const first = loadDemoState(store, demoScenario); const second = loadDemoState(store, demoScenario);
    expect(first.status).toBe('migrated'); expect(first.state).toEqual(second.state); expect(first.state.schemaVersion).toBe(5); expect(first.state.profileId).toBe('maple-owner');
    const r = first.state.requests[0]!; expect(r).toMatchObject({ status: 'draft', revision: 1, volunteerId: null, createdBy: { actorId: 'family-before-roles', at: null }, reportedDone: null, confirmedDone: null, legacyHistory: { label: LEGACY_LABEL, status, completion: { status: complete ? 'family_reported_complete' : 'unconfirmed' } } });
    if (complete) expect(r.legacyHistory!.completion).toMatchObject({ reportedBy: LEGACY_LABEL, reportedAt: at });
    expect(getRequestViews(demoScenario, first.state)[0]!.active).toBe(active); expect(computePlan(demoScenario, first.state)).toHaveLength(active ? 1 : 0);
    expect(store.values.get(DEMO_STORAGE_KEY)).toBe(bytes); expect(store.writes).toEqual([]); expect(store.removes).toEqual([]);
    expect((await saveDemoState(store, demoScenario, first.state)).status).toBe('saved'); expect(loadDemoState(store, demoScenario).state).toEqual(first.state); expect(store.values.get('other')).toBe('keep');
  });
  it('migrated active drafts can be explicitly shared/invited without losing their inactive completion note', () => {
    const store = new Store(); store.values.set(DEMO_STORAGE_KEY, JSON.stringify(v2('family_reported_requested', true, true)));
    let s = loadDemoState(store, demoScenario).state; s = run(s, { type: 'invite_volunteer', ...target(s), volunteerId: 'alex' }); s = run(s, { type: 'accept_invitation', ...target(s) }, 'alex'); expect(validateState(s, demoScenario)).toMatchObject({ ok: true }); expect(s.requests[0]!.legacyHistory!.completion.status).toBe('family_reported_complete');
  });
  it('rejects malformed v2 before migration, never saving recovery state', () => {
    const old = v2('draft', false, true); old.requests[0]!.helperLabel = 'Invented'; const store = new Store(); const bytes = JSON.stringify(old); store.values.set(DEMO_STORAGE_KEY, bytes); expect(loadDemoState(store, demoScenario).status).toBe('invalid'); expect(store.values.get(DEMO_STORAGE_KEY)).toBe(bytes); expect(store.writes).toEqual([]);
  });
});
describe('complete FixList reset', () => {
  it('clears only its local key and both owned stores, attempting each even when another fails', async () => {
    const store = new Store(); store.values.set(DEMO_STORAGE_KEY, 'old'); store.values.set('other', 'keep'); const attempts: string[] = [];
    const result = await resetFixListData(store, demoScenario, { captures: async () => ({ ok: true, message: '' }), photos: async () => { attempts.push('photos'); throw new Error('denied'); }, scan: async () => { attempts.push('scan'); return { ok: true, message: 'cleared' }; } });
    expect(attempts).toEqual(['photos', 'scan']); expect(result.status).toBe('error'); expect(result.state).toEqual(createInitialState(demoScenario)); expect(store.values.get('other')).toBe('keep'); expect(store.removes).toEqual([DEMO_STORAGE_KEY, 'fixlist:navigation:v1']);
  });
});
