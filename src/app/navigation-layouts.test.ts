import { describe, expect, it } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { createInitialState, hasScope, visibleHouseholdFor, type DelegationScope } from '../domain/workflow';
import { run } from '../domain/roles-test-helpers';
import { en } from '../i18n/en';
import { es } from '../i18n/es';
import { hasSettingsEntry, navigationActiveTab, navigationLayoutParameter, navigationLayouts, navigationTabs, navigationTitleKey } from './navigation-layouts';
import { isTabRoot, navigationUrl, parentRoute, parseRoute, routeHash, type Route } from './routes';

const all = { hasChecklist: true, hasPlan: true, hasRequests: true };
const r = (screen: Route['screen']): Route => ['question', 'request', 'sharing', 'invite', 'review'].includes(screen) ? { role: 'r', screen, id: 'sample-id' } as Route : { role: 'r', screen } as Route;
describe('pure navigation layout contract', () => {
  it('defines the exact en/es resident tabs, and a single settings entry for each new layout', () => {
    const expected = {
      current: [['Home', 'Check', 'Plan', 'Help', 'More'], ['Inicio', 'Revisar', 'Plan', 'Ayuda', 'Más']],
      three: [['Home', 'Rooms', 'Requests'], ['Inicio', 'Habitaciones', 'Solicitudes']],
      four: [['Home', 'Rooms', 'Fix list', 'Requests'], ['Inicio', 'Habitaciones', 'Lista de arreglos', 'Solicitudes']],
    };
    for (const layout of navigationLayouts) {
      const tabs = navigationTabs(layout, 'resident', all);
      expect(tabs.map((t) => en[t.label])).toEqual(expected[layout][0]); expect(tabs.map((t) => es[t.label])).toEqual(expected[layout][1]);
      expect(hasSettingsEntry(layout, 'resident')).toBe(layout !== 'current'); expect(hasSettingsEntry(layout, 'family_helper')).toBe(layout !== 'current');
      for (const tab of tabs) { expect(parseRoute(routeHash(tab.route))).toEqual(tab.route); expect(isTabRoot(tab.route, layout)).toBe(true); }
    }
  });
  it.each(navigationLayouts)('preserves volunteer tabs, labels, gating and selected tab in %s', (layout) => {
    const tabs = navigationTabs(layout, 'volunteer', { hasChecklist: false, hasPlan: false, hasRequests: false });
    expect(tabs).toEqual(navigationTabs('current', 'volunteer', all)); expect(tabs.map((t) => en[t.label])).toEqual(['Home', 'Tasks', 'Profile']);
    expect(tabs.map((t) => es[t.label])).toEqual(['Inicio', 'Tareas', 'Perfil']); expect(hasSettingsEntry(layout, 'volunteer')).toBe(false);
    for (const tab of tabs) expect(navigationActiveTab(layout, tab.route)).toBe(tab.screen);
    expect(navigationActiveTab(layout, { role: 'v', screen: 'task', id: 'sample-id' })).toBe('tasks'); expect(navigationTitleKey(layout, { role: 'v', screen: 'home' })).toBeUndefined();
  });
  it.each(['three', 'four'] as const)('maps every nested destination and settings screen in %s', (layout) => {
    for (const screen of ['check', 'question', 'scan'] as const) expect(navigationActiveTab(layout, r(screen))).toBe('check');
    for (const screen of ['requests', 'request', 'sharing', 'invite', 'review', 'resources'] as const) expect(navigationActiveTab(layout, r(screen), r('plan'))).toBe('requests');
    for (const screen of ['more', 'help', 'access', 'language', 'report', 'about'] as const) expect(navigationActiveTab(layout, r(screen))).toBeNull();
    expect(navigationActiveTab(layout, r('plan'))).toBe(layout === 'three' ? 'home' : 'plan'); expect(navigationActiveTab(layout, r('home'))).toBe('home');
    for (const screen of ['people', 'guide', 'start'] as const) expect(navigationActiveTab(layout, { screen })).toBeNull();
    expect(parentRoute(r('scan'), 'resident', null, layout)).toEqual(r('check')); expect(parentRoute(r('question'), 'resident', null, layout)).toEqual(r('check'));
    expect(parentRoute(r('resources'), 'resident', null, layout)).toEqual(r('requests')); expect(parentRoute(r('resources'), 'resident', r('request'), layout)).toEqual(r('request'));
    expect(parentRoute(r('request'), 'resident', null, layout)).toEqual(r('requests')); expect(parentRoute(r('more'), 'resident', null, layout)).toEqual(r('home'));
    expect(isTabRoot(r('requests'), layout)).toBe(true); expect(isTabRoot(r('more'), layout)).toBe(false); expect(isTabRoot(r('plan'), layout)).toBe(layout === 'four');
    if (layout === 'three') expect(parentRoute(r('plan'), 'resident', null, layout)).toEqual(r('home'));
  });
  it('preserves the entire current route-to-tab map, including contextual resources', () => {
    const mapping = { home: 'home', check: 'check', question: 'check', plan: 'plan', requests: 'home', request: 'home', sharing: 'home', invite: 'home', review: 'home', scan: 'more', more: 'more', help: 'help', report: 'more', access: 'more', language: 'more', about: 'more' } as const;
    for (const [screen, tab] of Object.entries(mapping)) expect(navigationActiveTab('current', r(screen as Route['screen']))).toBe(tab);
    expect(navigationActiveTab('current', r('resources'))).toBe('help'); expect(navigationActiveTab('current', r('resources'), r('plan'))).toBe('plan');
  });
  it.each(navigationLayouts)('uses real helper capabilities without broadening any grant in %s', (layout) => {
    for (let bits = 0; bits < 8; bits++) {
      const scopes = (['checklist', 'confirm', 'requests'] as DelegationScope[]).filter((_, i) => bits & 1 << i);
      const state = run(createInitialState(scenario), scopes.length ? { type: 'grant_delegation', personId: 'sam', scopes } : { type: 'revoke_delegation', personId: 'sam' });
      const view = visibleHouseholdFor(scenario, state, 'sam'), caps = { hasChecklist: hasScope(state, 'sam', 'checklist'), hasPlan: !!view?.plan, hasRequests: !!view?.requests };
      const tabs = navigationTabs(layout, 'family_helper', caps);
      expect(tabs.find((t) => t.screen === 'check')?.disabled).toBe(!scopes.includes('checklist'));
      if (layout !== 'three') expect(tabs.find((t) => t.screen === 'plan')?.disabled).toBe(!scopes.includes('confirm') && !scopes.includes('requests'));
      if (layout !== 'current') expect(tabs.find((t) => t.screen === 'requests')?.disabled).toBe(!scopes.includes('requests'));
      expect(tabs.find((t) => t.screen === 'home')?.disabled).toBe(false);
    }
  });
  it.each(navigationLayouts)('accepts a single exact launch value %s and consumes it when navigating', (layout) => {
    expect(navigationLayoutParameter(`?keep=yes&nav=${layout}`)).toBe(layout);
    const url = navigationUrl(`https://fixlist.test/?keep=yes&nav=${layout}&localScan=sample#/r/scan`, r('more'));
    expect(url.search).toBe('?keep=yes'); expect(url.hash).toBe('#/r/more');
  });
  it.each(['', '?nav=', '?nav=five', '?nav=THREE', '?nav=three&nav=four', '?nav[]=three', '?nav=__proto__'])('ignores invalid/ambiguous launch parameters %s', (search) => expect(navigationLayoutParameter(search)).toBeNull());
});
