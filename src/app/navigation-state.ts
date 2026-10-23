import type { DemoStorage } from '../lib/demo-storage';
import type { DemoScenario } from '../domain/types';
import { visibleRequestsFor, type DemoState, type Person } from '../domain/workflow';
import { parseRoute, routeHash, type Route } from './routes';
import { NAVIGATION_STORAGE_KEY, withDemoStorageLock } from '../lib/storage-lock';
import { isNavigationLayout, type NavigationLayout } from './navigation-layouts';

/** Navigation context only; deliberately separate from the household saved-state schema. */
export { NAVIGATION_STORAGE_KEY } from '../lib/storage-lock';
export interface InvitationDraft { requestId: string; volunteerId: string; residentId: string; revision: number }
export interface NavigationState { version: 1; invitations: readonly InvitationDraft[]; dismissedGuides: readonly string[]; pendingDestination: Route | null; layout: NavigationLayout }
export const emptyNavigationState = (): NavigationState => ({ version: 1, invitations: [], dismissedGuides: [], pendingDestination: null, layout: 'current' });
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
export function loadNavigationState(storage: DemoStorage | null): NavigationState {
  try {
    const raw = storage?.getItem(NAVIGATION_STORAGE_KEY); if (!raw || raw.length > 16384) return emptyNavigationState();
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !['dismissedGuides,invitations,pendingDestination,version', 'dismissedGuides,invitations,layout,pendingDestination,version'].includes(Object.keys(value).sort().join(','))
      || Object.hasOwn(value, 'layout') && !isNavigationLayout(value.layout)
      || !Array.isArray(value.invitations) || value.invitations.length > 100 || !Array.isArray(value.dismissedGuides) || value.dismissedGuides.length > 20
      || !value.dismissedGuides.every(validId) || new Set(value.dismissedGuides).size !== value.dismissedGuides.length) return emptyNavigationState();
    const ids = new Set<string>();
    for (const draft of value.invitations) {
      if (!draft || Object.keys(draft).sort().join(',') !== 'requestId,residentId,revision,volunteerId' || !validId(draft.requestId) || !validId(draft.volunteerId) || !validId(draft.residentId)
        || !Number.isSafeInteger(draft.revision) || draft.revision < 1 || ids.has(draft.requestId)) return emptyNavigationState();
      ids.add(draft.requestId);
    }
    let pendingDestination: Route | null = null;
    if (value.pendingDestination !== null) {
      if (typeof value.pendingDestination !== 'string') return emptyNavigationState();
      pendingDestination = parseRoute(value.pendingDestination);
      if (!('role' in pendingDestination) || routeHash(pendingDestination) !== value.pendingDestination) return emptyNavigationState();
    }
    return { ...value, pendingDestination, layout: 'current' };
  } catch { return emptyNavigationState(); }
}
/** Read and transform inside the household lock so drafts cannot overwrite another tab's edits. */
export async function updateNavigationState(storage: DemoStorage | null, update: (current: NavigationState) => NavigationState | null): Promise<NavigationState | null> {
  try { return await withDemoStorageLock(() => { if (!storage) return null; const value = update(loadNavigationState(storage)); if (!value) return null; storage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({ ...value, pendingDestination: value.pendingDestination ? routeHash(value.pendingDestination) : null })); return value; }); } catch { return null; }
}
export async function saveNavigationState(storage: DemoStorage | null, value: NavigationState): Promise<boolean> {
  return (await updateNavigationState(storage, () => value)) !== null;
}
export async function clearNavigationState(storage: DemoStorage | null): Promise<boolean> {
  try { return await withDemoStorageLock(() => { if (!storage) return false; storage.removeItem(NAVIGATION_STORAGE_KEY); return true; }); } catch { return false; }
}
export function createInvitationDraft(state: DemoState, requestId: string, volunteerId: string): InvitationDraft | null {
  const request = state.requests.find((r) => r.id === requestId);
  return request ? { requestId, volunteerId, residentId: state.household.residentId, revision: request.revision } : null;
}
export function selectedInvitationVolunteer(scenario: DemoScenario, state: DemoState, drafts: readonly InvitationDraft[], requestId: string): Person | null {
  const draft = drafts.find((d) => d.requestId === requestId);
  if (!draft || state.activePersonId !== state.household.residentId || draft.residentId !== state.household.residentId) return null;
  const view = visibleRequestsFor(scenario, state, state.activePersonId).find((v) => v.kind === 'household' && v.request.id === requestId);
  if (!view || view.kind !== 'household' || !view.active || view.request.revision !== draft.revision || view.request.volunteerId !== null || !['draft', 'declined'].includes(view.request.status)) return null;
  const action = scenario.referenceActions.find((a) => a.id === view.request.referenceActionId);
  if (!action || action.effort === 'professional' || action.helpRouting.kind !== 'family_review') return null;
  return state.people.find((p) => p.id === draft.volunteerId && p.role === 'volunteer') ?? null;
}
