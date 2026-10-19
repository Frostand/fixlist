import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { createInitialState, visibleHouseholdFor } from '../domain/workflow';
import { I18nProvider } from '../i18n';
import { en } from '../i18n/en';
import { ResourcesScreen, MoreScreen, ResetConfirmation } from './SettingsScreens';
import { GuideScreen, openGuide, skipGuide } from './PeopleScreens';
import { ChecklistQuestion } from './ResidentScreens';
import { PhoneShell } from './PhoneShell';
import { focusTarget, focusVisible, skipToContent } from './focus';
import { guideProgress } from './view-model';
import { createUiDispatch } from './ui-controller';

const noop = () => {}, dispatch = async () => ({ ok: true as const });
describe('routing UI regressions', () => {
  it.each(['sam', 'alex'])('shows only general help for %s without reading any screening or household fact state', (id) => {
    const state = createInitialState(scenario), person = state.people.find((p) => p.id === id)!;
    const guarded = new Proxy(state, { get(target, key, receiver) { if (['profileId', 'checklistAnswers', 'confirmations'].includes(String(key))) throw Error('private-facts-read'); return Reflect.get(target, key, receiver); } });
    const html = renderToStaticMarkup(<ResourcesScreen scenario={scenario} state={guarded} person={person} dispatch={dispatch} />);
    expect(html).toContain('Eldercare Locator'); expect(html).toContain(en['routing.resourcesGeneral'].replaceAll("'", '&#x27;'));
    expect(html).not.toContain('fictional-profile'); expect(html).not.toContain('Needs information'); expect(html).not.toContain('expected at least');
  });
  it('keeps resident screening available', () => {
    const state = createInitialState(scenario);
    const html = renderToStaticMarkup(<ResourcesScreen scenario={scenario} state={state} person={state.people[0]!} dispatch={dispatch} />);
    expect(html).toContain('fictional-profile'); expect(html).toContain('Needs information');
  });
  it('renders a guide as a focused flow with a heading and explicit skip', () => {
    const state = createInitialState(scenario);
    const html = renderToStaticMarkup(<GuideScreen person={state.people[0]!} residentName="Margaret" dispatch={dispatch} onExit={noop} />);
    expect(html).toContain('start-shell'); expect(html).toContain('id="screen-heading"'); expect(html).toContain(en['nav.skip']);
    expect(html).not.toContain('tab-bar'); expect(html).not.toContain('person-chip');
  });
  it('skips without falsely completing the guide and resumes the saved step', async () => {
    let state = createInitialState(scenario); const navigate = vi.fn(), onExit = vi.fn();
    const items = new Map<string, string>(), storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v); }, removeItem: (k: string) => { items.delete(k); } };
    const send = createUiDispatch({ scenario, getState: () => state, storage, clock: () => '2026-10-18T15:00:00.000Z', publish: (next) => { state = next; }, onError: noop });
    await send({ type: 'set_onboarding', guideId: 'resident-guide', stepIndex: 2, completed: false });
    await skipGuide(state.people[0]!, send, onExit); expect(onExit).toHaveBeenCalledWith(true); expect(guideProgress(state.people[0]!)).toEqual({ stepIndex: 2, completed: false });
    const before = state; await openGuide(state.people[0]!, send, navigate); expect(state).toBe(before); expect(navigate).toHaveBeenCalledWith({ screen: 'guide' });
    const html = renderToStaticMarkup(<MoreScreen person={state.people[0]!} resident canViewScan navigate={navigate} dispatch={send} onReset={noop} />);
    expect(html).toContain(en['routing.resumeGuide']);
    await send({ type: 'set_onboarding', guideId: 'resident-guide', stepIndex: 3, completed: true });
    await openGuide(state.people[0]!, send, navigate); expect(guideProgress(state.people[0]!)).toEqual({ stepIndex: 0, completed: false });
  });
  it('supports a catalog question without a concern and distinguishes question navigation from screen Back', () => {
    const catalog = { ...scenario, concerns: scenario.concerns.filter((c) => c.id !== 'rug-concern') }, state = createInitialState(catalog);
    state.checklistAnswers['rug-check'] = 'yes'; const person = state.people[0]!;
    const html = renderToStaticMarkup(<ChecklistQuestion scenario={catalog} state={state} person={person} household={visibleHouseholdFor(catalog, state, person.id)!} dispatch={dispatch} navigate={noop} questionId="rug-check" saved suggestions={null} photoStillRecorded={() => false} onPhotoError={noop} />);
    expect(html).toContain('Previous question'); expect(html).not.toContain(en['check.confirm']); expect(html).toContain('type="radio"');
  });
  it('marks the resources entry tab active and includes the Help return trigger', () => {
    const person = createInitialState(scenario).people[0]!;
    const html = renderToStaticMarkup(<PhoneShell person={person} route={{ role: 'r', screen: 'resources' }} returnTo={{ role: 'r', screen: 'plan' }} title="Resources" navigate={noop} hasChecklist hasPlan><p /></PhoneShell>);
    expect(html).toContain('href="#/r/plan" aria-current="page"'); expect(html).toContain(`id="${focusTarget('help-close')}"`); expect(html).toContain('href="#screen-heading"');
  });
  it('renders a labelled modal reset confirmation bounded above the tab bar, initially targeting Keep', () => {
    const html = renderToStaticMarkup(<I18nProvider language="es"><ResetConfirmation onReset={noop} onCancel={noop} /></I18nProvider>);
    expect(html).toContain('<dialog'); expect(html).toContain('aria-labelledby="reset-title"'); expect(html).toContain('aria-describedby="reset-description reset-bundled-description"');
    expect(html).toContain('max-height:calc(100dvh - 10rem - env(safe-area-inset-bottom))'); expect(html).toContain('overflow-y:auto'); expect(html).toContain(`id="${focusTarget('reset-open')}"`);
  });
});

describe('intentional focus targets', () => {
  it('prevents the skip-link default, focusing visible content while route and source state stay unchanged', () => {
    const route = { role: 'r', screen: 'plan' }, state = createInitialState(scenario), before = structuredClone(state);
    const heading = { focus: vi.fn(), scrollIntoView: vi.fn() }, root = { getElementById: vi.fn(() => heading as unknown as HTMLElement) }, event = { preventDefault: vi.fn() };
    skipToContent(event, root);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(root.getElementById).toHaveBeenCalledWith('screen-heading'); expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true }); expect(heading.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(route).toEqual({ role: 'r', screen: 'plan' }); expect(state).toEqual(before);
  });
  it('targets the Help trigger on close and Keep on reset open, then the reset trigger on close', () => {
    expect(focusTarget('help-open')).toBe('context-help-heading'); expect(focusTarget('help-close')).toBe('context-help-trigger');
    expect(focusTarget('reset-open')).toBe('reset-cancel'); expect(focusTarget('reset-close')).toBe('reset-trigger');
    expect(() => focusVisible(null)).not.toThrow();
  });
});
