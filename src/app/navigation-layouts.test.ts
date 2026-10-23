import { describe, expect, it } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { createInitialState, hasScope, visibleHouseholdFor, type DelegationScope } from '../domain/workflow';
import { run } from '../domain/roles-test-helpers';
import { en } from '../i18n/en';
import { es } from '../i18n/es';
import { hasSettingsEntry, navigationActiveTab, navigationLayoutParameter, navigationLayouts, navigationTabs } from './navigation-layouts';
import { isTabRoot, navigationUrl, parentRoute, parseRoute, routeHash, resourceReturnTo, type Route } from './routes';
const all = { hasChecklist: true, hasPlan: true, hasRequests: true };
const r = (screen: Route['screen']): Route => ['question', 'request', 'sharing', 'invite', 'review', 'room', 'capture'].includes(screen) ? { role: 'r', screen, id: 'living-room' } as Route : { role: 'r', screen } as Route;
const aliases = ['current', 'three', 'four'] as const;
describe('single navigation layout', () => {
  it('offers exactly four resident tabs and settings, including inert saved aliases', () => {
    expect(navigationLayouts).toEqual(['current']);
    for (const layout of aliases) {
      const tabs = navigationTabs(layout, 'resident', all);
      expect(tabs.map((tab) => en[tab.label])).toEqual(['Home', 'Rooms', 'Fix list', 'Help']);
      expect(tabs.map((tab) => es[tab.label])).toEqual(['Inicio', 'Habitaciones', 'Lista de arreglos', 'Ayuda']);
      expect(hasSettingsEntry(layout, 'resident')).toBe(true); expect(hasSettingsEntry(layout, 'family_helper')).toBe(true);
      for (const tab of tabs) { expect(parseRoute(routeHash(tab.route))).toEqual(tab.route); expect(isTabRoot(tab.route, layout)).toBe(true); }
      expect(isTabRoot(r('more'), layout)).toBe(false);
    }
  });
  it.each(aliases)('preserves volunteer tabs and field-limited role navigation for %s', (layout) => {
    const tabs = navigationTabs(layout, 'volunteer', { hasChecklist: false, hasPlan: false, hasRequests: false });
    expect(tabs.map((tab) => en[tab.label])).toEqual(['Home', 'Tasks', 'Profile']);
    expect(tabs.map((tab) => es[tab.label])).toEqual(['Inicio', 'Tareas', 'Perfil']);
    expect(tabs.every((tab) => !tab.disabled && 'role' in tab.route && tab.route.role === 'v')).toBe(true);
    expect(hasSettingsEntry(layout, 'volunteer')).toBe(false);
    expect(navigationActiveTab(layout, { role: 'v', screen: 'task', id: 'sample-id' })).toBe('tasks');
  });
  it.each(aliases)('maps nested room, help and settings screens consistently in %s', (layout) => {
    for (const screen of ['check', 'question', 'room', 'capture'] as const) expect(navigationActiveTab(layout, r(screen))).toBe('check');
    for (const screen of ['requests', 'request', 'sharing', 'invite', 'review', 'resources', 'help'] as const) expect(navigationActiveTab(layout, r(screen), r('plan'))).toBe('requests');
    for (const screen of ['more', 'access', 'language', 'report', 'about', 'scan'] as const) expect(navigationActiveTab(layout, r(screen))).toBeNull();
    expect(navigationActiveTab(layout, r('plan'))).toBe('plan');
    for (const screen of ['people', 'guide', 'start'] as const) expect(navigationActiveTab(layout, { screen })).toBeNull();
  });
  it('returns to the originating tab from settings and to a room from its question', () => {
    const from = r('plan'), settings = r('more'), room = r('room');
    expect(resourceReturnTo(settings, from, null)).toEqual(from);
    expect(parentRoute(settings, 'resident', from)).toEqual(from);
    expect(resourceReturnTo(r('language'), settings, from)).toEqual(from);
    expect(parentRoute(r('language'), 'resident', from)).toEqual(settings);
    expect(resourceReturnTo(r('question'), room, null)).toEqual(room);
    expect(parentRoute(r('question'), 'resident', room)).toEqual(room);
    expect(parentRoute(r('capture'), 'resident')).toEqual(room);
    expect(parentRoute(r('request'), 'resident')).toEqual(r('requests'));
    expect(parentRoute(r('resources'), 'resident', r('request'))).toEqual(r('request'));
    expect(parentRoute(r('scan'), 'resident')).toEqual(settings);
  });
  it('keeps every helper grant gate without broadening access', () => {
    for (let bits = 0; bits < 8; bits++) {
      const scopes = (['checklist', 'confirm', 'requests'] as DelegationScope[]).filter((_, i) => bits & 1 << i);
      const state = run(createInitialState(scenario), scopes.length ? { type: 'grant_delegation', personId: 'sam', scopes } : { type: 'revoke_delegation', personId: 'sam' });
      const view = visibleHouseholdFor(scenario, state, 'sam');
      const tabs = navigationTabs('current', 'family_helper', { hasChecklist: hasScope(state, 'sam', 'checklist'), hasPlan: !!view?.plan, hasRequests: !!view?.requests });
      expect(tabs.find((tab) => tab.screen === 'check')?.disabled).toBe(!scopes.includes('checklist'));
      expect(tabs.find((tab) => tab.screen === 'plan')?.disabled).toBe(!scopes.includes('confirm') && !scopes.includes('requests'));
      expect(tabs.find((tab) => tab.screen === 'requests')?.disabled).toBe(!scopes.includes('requests'));
    }
  });
  it.each(['current', 'three', 'four', '', 'invalid'])('ignores the old launch switch %s', (value) => {
    expect(navigationLayoutParameter(`?nav=${value}`)).toBeNull();
    const url = navigationUrl(`https://fixlist.test/?keep=yes&nav=${value}&localScan=sample#/r/scan`, r('more'));
    expect(url.search).toBe('?keep=yes'); expect(url.hash).toBe('#/r/more');
  });
});
