import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { activeState, atStage, run } from '../domain/roles-test-helpers';
import { createInitialState, visibleHouseholdFor, type DemoState, type Language } from '../domain/workflow';
import { I18nProvider } from '../i18n';
import { en } from '../i18n/en';
import { DEMO_STORAGE_KEY } from '../lib/demo-storage';
import { App } from './App';
import { PhoneShell } from './PhoneShell';
import { ResidentPlan, openPlanActionRequest, type ResidentProps } from './ResidentScreens';
import { MoreScreen } from './SettingsScreens';
import { emptyNavigationState, loadNavigationState, NAVIGATION_STORAGE_KEY, updateNavigationState } from './navigation-state';
import { createUiDispatch } from './ui-controller';

const noop = () => {}, send = async () => ({ ok: true as const });
function markup(node: ReactNode, language: Language = 'en') { return renderToStaticMarkup(<I18nProvider language={language}>{node}</I18nProvider>); }
function propsFor(state = atStage(), id = 'margaret'): ResidentProps { return { scenario, state, person: state.people.find((p) => p.id === id)!, household: visibleHouseholdFor(scenario, state, id)!, dispatch: send, navigate: noop }; }
function memory() { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } }; }
function links(html: string): string[] { return [...html.matchAll(/href="(#\/[^" ]+)"/g)].map((m) => m[1]!); }
function elements(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((n) => elements(n, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...elements(node.props.children, type)];
}
// Capture callbacks under React's server dispatcher; these are component callback
// checks, not mounted-browser, focus, layout or native interaction evidence.
function capture(render: () => ReactNode) {
  let tree: ReactNode;
  function Probe() { tree = render(); return tree; }
  const html = markup(<Probe />); return { tree, html };
}
afterEach(() => vi.unstubAllGlobals());
describe('single navigation screen integration', () => {
  it.each(['current', 'three', 'four'] as const)('renders the same four tabs for old alias %s', (layout) => {
    const props = propsFor();
    const { html, tree } = capture(() => PhoneShell({ ...props, layout, route: { role: 'r', screen: 'home' }, title: 'Home', hasChecklist: true, hasPlan: true, hasRequests: true, children: null }));
    const tabs = html.match(/<nav class="tab-bar[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(links(tabs)).toEqual(['#/r/home', '#/r/check', '#/r/plan', '#/r/requests']);
    expect(html).not.toContain(en['nav.screenHelp']);
    const account = elements(tree, 'button').find((button) => button.props['aria-label'] === `${en['nav.account']}: Margaret`)!;
    const navigate = vi.fn();
    const shell = capture(() => PhoneShell({ ...props, navigate, route: { role: 'r', screen: 'home' }, title: 'Home', hasChecklist: true, hasPlan: true, children: null }));
    expect(account).toBeDefined();
    (elements(shell.tree, 'button').find((button) => button.props['aria-label'] === `${en['nav.account']}: Margaret`)!.props.onClick as () => void)();
    expect(navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'more' });
  });
  it('uses a compact back button and returns settings to its originating tab', () => {
    const props = propsFor(), navigate = vi.fn();
    const { tree, html } = capture(() => PhoneShell({ ...props, navigate, route: { role: 'r', screen: 'more' }, returnTo: { role: 'r', screen: 'plan' }, title: en['nav.account'], hasChecklist: true, hasPlan: true, children: null }));
    expect(html).toContain('compact-bar'); expect(html).toContain('id="screen-heading"');
    (elements(tree, 'button')[0]!.props.onClick as () => void)();
    expect(navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'plan' });
  });
  it('preserves resident-only settings gates and volunteer tabs', () => {
    const props = propsFor(), helper = props.state.people.find((person) => person.id === 'sam')!;
    const more = markup(<MoreScreen {...props} person={helper} resident={false} canViewScan={false} onReset={noop} />);
    expect(more).not.toContain('#/r/access'); expect(more).not.toContain('#/r/report'); expect(more).not.toContain(en['more.reset']);
    const person = props.state.people.find((p) => p.id === 'alex')!;
    const shell = markup(<PhoneShell person={person} route={{ role: 'v', screen: 'profile' }} title="Profile" navigate={noop} hasChecklist={false} hasPlan={false}><p /></PhoneShell>);
    expect(links(shell)).toEqual(['#/v/home', '#/v/tasks', '#/v/profile']);
  });
  it.each(['three', 'four'] as const)('ignores both saved and query layout %s without losing pending destinations or dismissals', async (layout) => {
    const storage = memory();
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ format: 'fixlist-saved-v1', revision: 1, state: atStage() }));
    storage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({ ...emptyNavigationState(), layout, dismissedGuides: ['sam'], pendingDestination: '#/r/plan' }));
    expect(loadNavigationState(storage)).toMatchObject({ layout: 'current', dismissedGuides: ['sam'], pendingDestination: { role: 'r', screen: 'plan' } });
    vi.stubGlobal('window', { localStorage: storage, location: { hash: '#/r/question/rug-check', search: `?nav=${layout}` }, history: { state: null } });
    const html = renderToStaticMarkup(<App />), tabs = html.match(/<nav class="tab-bar[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(links(tabs)).toEqual(['#/r/home', '#/r/check', '#/r/plan', '#/r/requests']);
    expect(tabs).toContain('href="#/r/check" aria-current="page"'); expect(html).not.toContain('navigation-layout');
    await updateNavigationState(storage, (saved) => ({ ...saved, pendingDestination: null }));
    expect(loadNavigationState(storage)).toMatchObject({ dismissedGuides: ['sam'], pendingDestination: null });
  });
});

describe('shared full-plan and compact-plan primary action', () => {
  function controller(initial: DemoState) {
    let state = initial; const storage = memory(); storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ format: 'fixlist-saved-v1', revision: 1, state }));
    const navigate = vi.fn(), dispatch = createUiDispatch({ scenario, getState: () => state, storage, clock: () => '2026-10-18T13:00:00.000Z', publish: (next) => { state = next; }, onError: noop });
    return { get state() { return state; }, navigate, dispatch };
  }
  it('creates a local request before opening resident sharing, and opens an existing request without duplicating it', async () => {
    const c = controller(activeState()), action = scenario.referenceActions.find((a) => a.id === 'review-rug')!;
    await openPlanActionRequest({ ...propsFor(c.state), dispatch: c.dispatch, navigate: c.navigate, action });
    expect(c.state.requests).toHaveLength(1); expect(c.navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'sharing', id: c.state.requests[0]!.id });
    await openPlanActionRequest({ ...propsFor(c.state), dispatch: c.dispatch, navigate: c.navigate, action });
    expect(c.state.requests).toHaveLength(1); expect(c.navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'request', id: c.state.requests[0]!.id });
  });
  it('keeps professional work out of sharing/invitation and opens the existing local referral flow', async () => {
    let state = createInitialState(scenario); const concern = scenario.concerns.find((c) => scenario.referenceActions.find((a) => a.id === c.referenceActionId)?.effort === 'professional')!;
    const action = scenario.referenceActions.find((a) => a.id === concern.referenceActionId)!;
    for (const item of scenario.checklist.filter((q) => q.referenceActionId === action.id)) state = run(state, { type: 'answer_checklist', checklistItemId: item.id, answer: 'yes' });
    state = run(state, { type: 'confirm_concern', concernId: concern.id }); const c = controller(state);
    await openPlanActionRequest({ ...propsFor(c.state), dispatch: c.dispatch, navigate: c.navigate, action });
    expect(c.state.requests[0]).toMatchObject({ referenceActionId: action.id, professionalReferral: null, volunteerId: null }); expect(c.navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'request', id: c.state.requests[0]!.id });
    expect(() => run(c.state, { type: 'invite_volunteer', requestId: c.state.requests[0]!.id, expectedRevision: c.state.requests[0]!.revision, volunteerId: 'alex' })).toThrow();
  });
  it('allows a granted helper draft without opening resident sharing and never navigates on a rejected creation', async () => {
    const state = run(run(activeState(), { type: 'grant_delegation', personId: 'sam', scopes: ['requests'] }), { type: 'select_person', personId: 'sam' }), c = controller(state), action = scenario.referenceActions.find((a) => a.id === 'review-rug')!;
    await openPlanActionRequest({ ...propsFor(c.state, 'sam'), dispatch: c.dispatch, navigate: c.navigate, action });
    expect(c.navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'request', id: c.state.requests[0]!.id });
    c.navigate.mockClear();
    await openPlanActionRequest({ ...propsFor(activeState()), dispatch: async () => ({ ok: false, code: 'stale_revision', error: 'stale' }), navigate: c.navigate, action });
    expect(c.navigate).not.toHaveBeenCalled();
    const denied = run(activeState(), { type: 'grant_delegation', personId: 'sam', scopes: ['checklist'] }), dispatch = vi.fn(send);
    await openPlanActionRequest({ ...propsFor(denied, 'sam'), dispatch, navigate: c.navigate, action }); expect(dispatch).not.toHaveBeenCalled(); expect(c.navigate).not.toHaveBeenCalled();
    expect(markup(<ResidentPlan {...propsFor(denied, 'sam')} />)).not.toContain(en['plan.ask']);
  });
});
