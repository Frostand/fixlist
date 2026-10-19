import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { activeState, atStage, run } from '../domain/roles-test-helpers';
import { createInitialState, elderNextStep, helperNextStep, visibleHouseholdFor, visibleRequestsFor, type DemoState, type Language } from '../domain/workflow';
import { I18nProvider } from '../i18n';
import { en } from '../i18n/en';
import { es } from '../i18n/es';
import { DEMO_STORAGE_KEY } from '../lib/demo-storage';
import { App } from './App';
import { PhoneShell } from './PhoneShell';
import { ResidentHome, ResidentPlan, RoomList, openPlanActionRequest, type ResidentProps } from './ResidentScreens';
import { RequestList } from './RequestScreens';
import { HelpScreen, MoreScreen, NavigationLayoutPicker } from './SettingsScreens';
import { navigationLayouts, type NavigationLayout } from './navigation-layouts';
import { emptyNavigationState, loadNavigationState, NAVIGATION_STORAGE_KEY, updateNavigationState } from './navigation-state';
import { createUiDispatch } from './ui-controller';
import { parseRoute, routeHash, type Route } from './routes';

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
describe('navigation prototype screen integration', () => {
  it.each(navigationLayouts)('keeps every resident destination reachable through the actual shell and screen entries in %s', (layout) => {
    const props = propsFor(), requestViews = visibleRequestsFor(scenario, props.state, props.person.id).filter((v) => v.kind === 'household');
    const shell = markup(<PhoneShell {...props} layout={layout} route={{ role: 'r', screen: 'home' }} title="Home" hasChecklist hasPlan hasRequests><p /></PhoneShell>);
    const home = markup(<ResidentHome {...props} layout={layout} requests={requestViews} next={elderNextStep(scenario, props.state)} />);
    const more = markup(<MoreScreen {...props} resident canViewScan onReset={noop} layout={layout} onLayoutChange={async () => true} />);
    const rooms = markup(<RoomList {...props} showScanEntry={layout !== 'current'} />);
    const requests = markup(<RequestList requests={requestViews} navigate={noop} showResources={layout !== 'current'} />);
    const help = markup(<HelpScreen {...props} />);
    const destinations = new Set(links(shell + home + more + rooms + requests + help));
    for (const screen of ['home', 'check', 'plan', 'requests', 'resources', 'scan', 'access', 'report', 'language', 'about', 'help']) expect(destinations.has(`#/r/${screen}`), `${layout}: ${screen}`).toBe(true);
    expect(destinations.has(`#/r/request/${props.state.requests[0]!.id}`)).toBe(true);
    if (layout === 'current') expect(destinations.has('#/r/more')).toBe(true);
    else { expect(shell).toContain('Account and settings: Margaret'); expect(shell).toContain('Using this screen'); expect(more).toContain(en['app.disclosure']); }
    // People and guide remain native button actions in settings, and questions
    // remain native room/resume buttons rather than new route names.
    expect(more).toContain(en['nav.switch']); expect(more).toContain(en['routing.resumeGuide']); expect(rooms).toContain(en['check.resume']);
    expect(more).toContain('id="navigation-layout"'); expect(more).toContain(en['navigation.label']);
    for (const hash of destinations) expect(routeHash(parseRoute(hash))).toBe(hash);
  });
  it.each(navigationLayouts)('retains allowed helper links and hides resident-only settings/actions in %s', (layout) => {
    const state = run(atStage(), { type: 'grant_delegation', personId: 'sam', scopes: ['checklist', 'confirm', 'requests'] }), props = propsFor(state, 'sam');
    const home = markup(<ResidentHome {...props} layout={layout} requests={visibleRequestsFor(scenario, state, 'sam')} next={helperNextStep(scenario, state, 'sam')} />);
    const more = markup(<MoreScreen {...props} resident={false} canViewScan onReset={noop} layout={layout} onLayoutChange={async () => true} />);
    const rooms = markup(<RoomList {...props} showScanEntry={layout !== 'current'} />);
    expect(home).toContain('#/r/plan'); expect(more).toContain('#/r/language'); expect(more).toContain('#/r/about');
    expect(more).not.toContain('#/r/access'); expect(more).not.toContain('#/r/report'); expect(more).not.toContain(en['more.reset']);
    expect((layout === 'current' ? more : rooms)).toContain('#/r/scan');
    expect(home).not.toContain(en['request.invite']);
  });
  it('shows only confirmed actions inline in three, and only a short summary in four, before updates', () => {
    const unconfirmed = scenario.checklist.find((q) => q.referenceActionId !== 'review-rug')!;
    const state = run(activeState(), { type: 'answer_checklist', checklistItemId: unconfirmed.id, answer: 'yes' }), props = propsFor(state);
    const home = (layout: NavigationLayout) => markup(<ResidentHome {...props} layout={layout} requests={visibleRequestsFor(scenario, state, 'margaret')} next={elderNextStep(scenario, state)} />);
    const three = home('three'), four = home('four'), action = scenario.referenceActions.find((a) => a.id === 'review-rug')!;
    expect(three).toContain(action.title); expect(three).toContain(en['plan.ask']); expect(three).toContain('#/r/plan');
    expect(three.indexOf(action.title)).toBeLessThan(three.indexOf(en['home.updates']));
    expect(three).not.toContain(scenario.referenceActions.find((a) => a.id === unconfirmed.referenceActionId)!.title);
    expect(four).not.toContain(action.title); expect(four).not.toContain(en['plan.ask']); expect(four).toContain(en['navigation.fullPlan']);
    expect(home('current')).toBe(markup(<ResidentHome {...props} requests={visibleRequestsFor(scenario, state, 'margaret')} next={elderNextStep(scenario, state)} />));
  });
  it('preserves scan, plan and request restrictions for helpers with partial grants', () => {
    const state = run(activeState(), { type: 'grant_delegation', personId: 'sam', scopes: ['confirm'] }), props = propsFor(state, 'sam');
    const rooms = markup(<RoomList {...props} showScanEntry />); expect(rooms).not.toContain('#/r/scan');
    for (const layout of ['three', 'four'] as const) {
      const html = markup(<ResidentHome {...props} layout={layout} requests={[]} next={helperNextStep(scenario, state, 'sam')} />);
      expect(html).toContain('#/r/plan'); expect(html).not.toContain(en['plan.ask']); expect(html).not.toContain(en['home.updates']);
    }
    const checklistOnly = run(activeState(), { type: 'grant_delegation', personId: 'sam', scopes: ['checklist'] }), limited = propsFor(checklistOnly, 'sam');
    expect(markup(<ResidentHome {...limited} layout="three" requests={[]} next={helperNextStep(scenario, checklistOnly, 'sam')} />)).not.toContain('#/r/plan');
  });
  it.each(['en', 'es'] as const)('has typed prototype settings, account/help and scan labels in %s', (language) => {
    const props = propsFor(), dict = language === 'en' ? en : es;
    const html = markup(<><PhoneShell {...props} layout="four" route={{ role: 'r', screen: 'home' }} title={dict['nav.home']} hasChecklist hasPlan><p /></PhoneShell><MoreScreen {...props} resident canViewScan onReset={noop} layout="four" onLayoutChange={async () => true} /><RoomList {...props} showScanEntry /></>, language);
    for (const key of ['nav.rooms', 'nav.fixList', 'nav.requests', 'nav.account', 'nav.screenHelp', 'nav.appHelp', 'nav.scan3d', 'navigation.label', 'navigation.current', 'navigation.three', 'navigation.four'] as const) expect(html).toContain(dict[key]);
  });
  it.each(navigationLayouts)('keeps volunteer shell markup identical in %s', (layout) => {
    const props = propsFor(), person = props.state.people.find((p) => p.id === 'alex')!, route: Route = { role: 'v', screen: 'profile' };
    const render = (choice?: NavigationLayout) => markup(<PhoneShell person={person} route={route} title="Profile" navigate={noop} hasChecklist={false} hasPlan={false} {...(choice ? { layout: choice } : {})}><p /></PhoneShell>);
    expect(render(layout)).toBe(render()); expect(render(layout)).not.toContain('Account and settings');
  });
  it.each(['three', 'four'] as const)('renders the correct nested tab and one settings header entry in %s', (layout) => {
    const props = propsFor();
    for (const screen of ['question', 'scan', 'request', 'sharing', 'invite', 'review', 'resources', 'plan', 'more', 'language', 'access', 'report', 'about', 'help'] as const) {
      const route = parseRoute(`#/r/${screen}${['question', 'request', 'sharing', 'invite', 'review'].includes(screen) ? '/sample-id' : ''}`);
      const { html, tree } = capture(() => PhoneShell({ person: props.person, route, layout, title: screen, navigate: props.navigate, hasChecklist: true, hasPlan: true, hasRequests: true, children: null }));
      const tabs = html.match(/<nav class="tab-bar[\s\S]*?<\/nav>/)?.[0] ?? '';
      const expected = ['question', 'scan'].includes(screen) ? 'check' : ['request', 'sharing', 'invite', 'review', 'resources'].includes(screen) ? 'requests' : screen === 'plan' ? layout === 'three' ? 'home' : 'plan' : null;
      expect(tabs.match(/aria-current="page"/g)?.length ?? 0).toBe(expected ? 1 : 0);
      if (expected) expect(tabs).toContain(`href="#/r/${expected}" aria-current="page"`);
      const account = elements(tree, 'button').filter((b) => b.props['aria-label'] === 'Account and settings: Margaret'); expect(account).toHaveLength(1);
      expect(elements(tree, 'button').filter((b) => String(b.props['aria-label']).startsWith('Switch person:'))).toHaveLength(0);
    }
  });
  it.each(navigationLayouts)('keeps native settings, room and account buttons connected in %s', async (layout) => {
    const props = propsFor(), navigate = vi.fn();
    const { tree: settings } = capture(() => MoreScreen({ ...props, navigate, resident: true, canViewScan: true, onReset: noop, layout, onLayoutChange: async () => true }));
    const settingsButtons = elements(settings, 'button');
    await (settingsButtons.find((b) => b.props.children === en['routing.resumeGuide'])!.props.onClick as () => Promise<void>)();
    expect(navigate).toHaveBeenLastCalledWith({ screen: 'guide' });
    (settingsButtons.find((b) => b.props.children === en['nav.switch'])!.props.onClick as () => void)(); expect(navigate).toHaveBeenLastCalledWith({ screen: 'people' });
    const { tree: rooms } = capture(() => RoomList({ ...props, navigate, showScanEntry: layout !== 'current' }));
    (elements(rooms, 'button')[0]!.props.onClick as () => void)(); expect(navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'question', id: scenario.checklist[0]!.id });
    if (layout !== 'current') {
      const { tree } = capture(() => PhoneShell({ ...props, navigate, layout, route: { role: 'r', screen: 'home' }, title: 'Home', hasChecklist: true, hasPlan: true, children: null }));
      (elements(tree, 'button').find((b) => b.props['aria-label'] === 'Account and settings: Margaret')!.props.onClick as () => void)();
      expect(navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'more' });
    }
  });
  it('uses the settings selector callback to persist all choices and preserves drafts', async () => {
    const storage = memory();
    await updateNavigationState(storage, (saved) => ({ ...saved, dismissedGuides: ['sam'] }));
    for (const layout of navigationLayouts) {
      const { tree } = capture(() => NavigationLayoutPicker({ layout: loadNavigationState(storage).layout, onChange: async (next) => !!await updateNavigationState(storage, (saved) => ({ ...saved, layout: next })) }));
      const select = elements(tree, 'select')[0]!;
      await (select.props.onChange as (event: { target: { value: string } }) => Promise<void>)({ target: { value: layout } });
      expect(loadNavigationState(storage)).toMatchObject({ layout, dismissedGuides: ['sam'] });
    }
  });
  it.each(navigationLayouts)('launches the actual App with ?nav=%s overriding saved layout and a nested deep link', (layout) => {
    const storage = memory(); storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ format: 'fixlist-saved-v1', revision: 1, state: atStage() }));
    storage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({ ...emptyNavigationState(), layout: layout === 'four' ? 'three' : 'four' }));
    vi.stubGlobal('window', { localStorage: storage, location: { hash: '#/r/question/rug-check', search: `?nav=${layout}` }, history: { state: null } });
    const html = renderToStaticMarkup(<App />), tabs = html.match(/<nav class="tab-bar[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(tabs).toContain(layout === 'current' ? en['nav.check'] : en['nav.rooms']); expect(tabs).toContain('href="#/r/check" aria-current="page"');
    expect(links(tabs)).toHaveLength(layout === 'current' ? 5 : layout === 'three' ? 3 : 4);
    expect(html).toContain('id="screen-heading"'); expect(html).not.toContain(en['person.noGrant']);
  });
  it('uses current navigation for an older saved navigation record', () => {
    const storage = memory(), { layout: _layout, ...old } = emptyNavigationState();
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ format: 'fixlist-saved-v1', revision: 1, state: createInitialState(scenario) })); storage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify(old));
    vi.stubGlobal('window', { localStorage: storage, location: { hash: '#/r/home', search: '?nav=invalid' }, history: { state: null } });
    const html = renderToStaticMarkup(<App />); expect(html).toContain('href="#/r/more"'); expect(html).not.toContain('Account and settings');
  });
  it.each(navigationLayouts)('reloads the actual App and controlled settings choice from persisted %s', (layout) => {
    const storage = memory(); storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ format: 'fixlist-saved-v1', revision: 1, state: atStage() }));
    storage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({ ...emptyNavigationState(), layout }));
    vi.stubGlobal('window', { localStorage: storage, location: { hash: '#/r/more', search: '' }, history: { state: null } });
    const html = renderToStaticMarkup(<App />), tabs = html.match(/<nav class="tab-bar[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(html).toContain(`<option value="${layout}" selected="">`); expect(links(tabs)).toHaveLength(layout === 'current' ? 5 : layout === 'three' ? 3 : 4);
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
