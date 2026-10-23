import { describe, expect, it } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { atStage, run } from '../domain/roles-test-helpers';
import { createInitialState } from '../domain/workflow';
import { clearNavigationState, createInvitationDraft, emptyNavigationState, loadNavigationState, NAVIGATION_STORAGE_KEY, saveNavigationState, selectedInvitationVolunteer, updateNavigationState } from './navigation-state';
import { navigationLayoutParameter, navigationLayouts } from './navigation-layouts';
import { resetFixListData } from '../lib/demo-storage';

function memory() { const bytes = new Map<string, string>(); return { bytes, getItem: (k: string) => bytes.get(k) ?? null, setItem: (k: string, v: string) => { bytes.set(k, v); }, removeItem: (k: string) => { bytes.delete(k); } }; }
describe('separately versioned navigation context', () => {
  it('defaults valid older records to current while preserving their drafts and pending destination', () => {
    const storage = memory(), { layout: _layout, ...old } = emptyNavigationState();
    const record = { ...old, dismissedGuides: ['sam'], pendingDestination: '#/r/plan' };
    storage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify(record));
    expect(loadNavigationState(storage)).toEqual({ ...record, pendingDestination: { role: 'r', screen: 'plan' }, layout: 'current' });
    expect(storage.getItem(NAVIGATION_STORAGE_KEY)).toBe(JSON.stringify(record));
  });
  it('normalizes legacy layouts without altering household bytes or other navigation fields', async () => {
    const storage = memory(), draft = createInvitationDraft(atStage(), atStage().requests[0]!.id, 'alex')!;
    storage.setItem('fixlist:demo:v1', 'household-unchanged');
    await saveNavigationState(storage, { ...emptyNavigationState(), invitations: [draft], dismissedGuides: ['sam'] });
    for (const layout of navigationLayouts) {
      expect(await updateNavigationState(storage, (saved) => ({ ...saved, layout }))).toMatchObject({ layout });
      expect(loadNavigationState(storage)).toMatchObject({ layout, invitations: [draft], dismissedGuides: ['sam'] });
      const override = navigationLayoutParameter(`?nav=${layout}`);
      await updateNavigationState(storage, (saved) => ({ ...saved, layout: override ?? saved.layout }));
      expect(loadNavigationState(storage).layout).toBe(layout); expect(storage.getItem('fixlist:demo:v1')).toBe('household-unchanged');
    }
    await updateNavigationState(storage, (saved) => ({ ...saved, layout: navigationLayoutParameter('?nav=invalid') ?? saved.layout }));
    expect(loadNavigationState(storage).layout).toBe('current');
  });
  it.each([null, false, 3, 'five', 'THREE', {}, []])('rejects an invalid stored layout %j', (layout) => {
    const storage = memory(); storage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({ ...emptyNavigationState(), layout }));
    expect(loadNavigationState(storage)).toEqual(emptyNavigationState());
  });
  it.each(navigationLayouts)('reset clears the %s preference and retains unrelated storage', async (layout) => {
    const storage = memory(); storage.setItem('unrelated', 'keep'); await saveNavigationState(storage, { ...emptyNavigationState(), layout });
    const result = await resetFixListData(storage, scenario, { captures: async () => ({ ok: true, message: '' }), photos: async () => ({ ok: true, message: '' }), scan: async () => ({ ok: true, message: '' }) });
    expect(result.status).toBe('reset'); expect(storage.getItem(NAVIGATION_STORAGE_KEY)).toBeNull(); expect(loadNavigationState(storage).layout).toBe('current'); expect(storage.getItem('unrelated')).toBe('keep');
  });
  it('recovers a selected volunteer after reload without changing household saved bytes', async () => {
    const state = atStage(), draft = createInvitationDraft(state, state.requests[0]!.id, 'alex')!, storage = memory();
    storage.setItem('fixlist:demo:v1', 'untouched-household');
    expect(await saveNavigationState(storage, { ...emptyNavigationState(), invitations: [draft], dismissedGuides: ['sam'], pendingDestination: { role: 'r', screen: 'plan' } })).toBe(true);
    const reloaded = loadNavigationState(storage);
    expect(reloaded.invitations).toEqual([draft]); expect(reloaded.dismissedGuides).toEqual(['sam']); expect(reloaded.pendingDestination).toEqual({ role: 'r', screen: 'plan' });
    expect(selectedInvitationVolunteer(scenario, structuredClone(state), reloaded.invitations, draft.requestId)?.id).toBe('alex');
    expect(storage.getItem('fixlist:demo:v1')).toBe('untouched-household');
    expect(await clearNavigationState(storage)).toBe(true); expect(storage.getItem(NAVIGATION_STORAGE_KEY)).toBeNull(); expect(storage.getItem('fixlist:demo:v1')).toBe('untouched-household');
  });
  it('revalidates person, actor, revision, assignment and plan activity on recovery', () => {
    const state = atStage(), request = state.requests[0]!, draft = createInvitationDraft(state, request.id, 'alex')!;
    const variants = [
      { ...state, people: state.people.filter((p) => p.id !== 'alex') },
      { ...state, people: state.people.map((p) => p.id === 'alex' ? { ...p, role: 'family_helper' as const } : p) },
      { ...state, activePersonId: 'sam' },
      { ...state, household: { ...state.household, residentId: 'someone-else' } },
      { ...state, requests: state.requests.map((r) => ({ ...r, revision: r.revision + 1 })) },
      { ...state, requests: state.requests.map((r) => ({ ...r, volunteerId: 'jordan' })) },
      { ...state, requests: state.requests.map((r) => ({ ...r, status: 'cancelled' as const })) },
      run(state, { type: 'unconfirm_concern', concernId: 'rug-concern' }),
    ];
    for (const changed of variants) expect(selectedInvitationVolunteer(scenario, changed, [draft], request.id)).toBeNull();
    const professional = { ...scenario, referenceActions: scenario.referenceActions.map((a) => a.id === request.referenceActionId ? { ...a, effort: 'professional' as const } : a) };
    expect(selectedInvitationVolunteer(professional, state, [draft], request.id)).toBeNull();
  });
  it('the actual send command revalidates against current state after a draft was recovered', () => {
    const state = atStage(), draft = createInvitationDraft(state, state.requests[0]!.id, 'alex')!;
    const current = { ...state, people: state.people.filter((p) => p.id !== 'alex') };
    expect(selectedInvitationVolunteer(scenario, current, [draft], draft.requestId)).toBeNull();
    expect(() => run(current, { type: 'invite_volunteer', requestId: draft.requestId, expectedRevision: draft.revision, volunteerId: draft.volunteerId })).toThrow();
  });
  it.each(['{', '{"version":2}', JSON.stringify({ ...emptyNavigationState(), invitations: [{ requestId: '__proto__' }] }), JSON.stringify({ ...emptyNavigationState(), pendingDestination: '#screen-heading' }), 'x'.repeat(16385)])('discards invalid context safely', (raw) => {
    const storage = memory(); storage.setItem(NAVIGATION_STORAGE_KEY, raw); expect(loadNavigationState(storage)).toEqual(emptyNavigationState());
  });
  it('handles unavailable storage without throwing or claiming durability', async () => {
    const broken = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); }, removeItem: () => { throw Error('blocked'); } };
    expect(loadNavigationState(broken)).toEqual(emptyNavigationState()); expect(await saveNavigationState(broken, emptyNavigationState())).toBe(false); expect(await clearNavigationState(broken)).toBe(false);
    expect(createInvitationDraft(createInitialState(scenario), 'missing', 'alex')).toBeNull();
  });
});
