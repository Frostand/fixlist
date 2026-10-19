import type { PersonRole } from '../domain/roles';
import type { MessageKey } from '../i18n';
import type { Route } from './routes';

export const navigationLayouts = ['current', 'three', 'four'] as const;
export type NavigationLayout = typeof navigationLayouts[number];
export interface NavigationCapabilities { hasChecklist: boolean; hasPlan: boolean; hasRequests: boolean }
type Gate = 'hasChecklist' | 'hasPlan' | 'hasRequests';
interface TabDefinition { screen: 'home' | 'check' | 'plan' | 'help' | 'more' | 'requests' | 'tasks' | 'profile'; label: MessageKey; icon: string; gate?: Gate }
interface LayoutDefinition { tabs: readonly TabDefinition[]; settingsEntry: boolean; active: Partial<Record<Route['screen'], string | null>> }
const home: TabDefinition = { screen: 'home', label: 'nav.home', icon: 'home' };
const rooms: TabDefinition = { screen: 'check', label: 'nav.rooms', icon: 'rooms', gate: 'hasChecklist' };
const fixes: TabDefinition = { screen: 'plan', label: 'nav.fixList', icon: 'plan', gate: 'hasPlan' };
const requests: TabDefinition = { screen: 'requests', label: 'nav.requests', icon: 'requests', gate: 'hasRequests' };
const taskRoutes = { question: 'check', room: 'check', capture: 'check', scan: 'check', requests: 'requests', request: 'requests', sharing: 'requests', invite: 'requests', review: 'requests', resources: 'requests', more: null, help: null, access: null, language: null, report: null, about: null } as const;
export const NAVIGATION_LAYOUTS: Readonly<Record<NavigationLayout, LayoutDefinition>> = {
  current: { tabs: [home, { screen: 'check', label: 'nav.check', icon: 'check', gate: 'hasChecklist' }, { screen: 'plan', label: 'nav.plan', icon: 'plan', gate: 'hasPlan' }, { screen: 'help', label: 'nav.help', icon: 'help' }, { screen: 'more', label: 'nav.more', icon: 'more' }], settingsEntry: false, active: { question: 'check', room: 'check', capture: 'check', task: 'tasks', request: 'home', requests: 'home', sharing: 'home', invite: 'home', review: 'home', scan: 'more', report: 'more', access: 'more', language: 'more', about: 'more' } },
  three: { tabs: [home, rooms, requests], settingsEntry: true, active: { ...taskRoutes, plan: 'home' } },
  four: { tabs: [home, rooms, fixes, requests], settingsEntry: true, active: { ...taskRoutes, plan: 'plan' } },
};
const volunteerTabs: readonly TabDefinition[] = [home, { screen: 'tasks', label: 'nav.tasks', icon: 'tasks' }, { screen: 'profile', label: 'nav.profile', icon: 'profile' }];
const prototypeTitles: Partial<Record<Route['screen'], MessageKey>> = { check: 'nav.rooms', question: 'nav.rooms', plan: 'nav.fixList', more: 'nav.account', help: 'nav.appHelp', requests: 'nav.requests', scan: 'nav.scan3d' };
export function navigationTitleKey(layout: NavigationLayout, route: Route): MessageKey | undefined { return layout !== 'current' && 'role' in route && route.role === 'r' ? prototypeTitles[route.screen] : undefined; }
export function isNavigationLayout(value: unknown): value is NavigationLayout { return typeof value === 'string' && navigationLayouts.includes(value as NavigationLayout); }
export function navigationLayoutParameter(search: string): NavigationLayout | null {
  const values = new URLSearchParams(search).getAll('nav');
  return values.length === 1 && isNavigationLayout(values[0]) ? values[0] : null;
}
export function navigationTabs(layout: NavigationLayout, role: PersonRole, capabilities: NavigationCapabilities) {
  return (role === 'volunteer' ? volunteerTabs : NAVIGATION_LAYOUTS[layout].tabs).map((tab) => ({ ...tab, route: { role: role === 'volunteer' ? 'v' : 'r', screen: tab.screen } as Route, disabled: !!tab.gate && !capabilities[tab.gate] }));
}
export function hasSettingsEntry(layout: NavigationLayout, role: PersonRole): boolean { return role !== 'volunteer' && NAVIGATION_LAYOUTS[layout].settingsEntry; }
export function navigationActiveTab(layout: NavigationLayout, route: Route, returnTo: Route | null = null): string | null {
  if (!('role' in route)) return null;
  if (route.role === 'v') return route.screen === 'task' ? 'tasks' : route.screen;
  if (layout === 'current' && route.screen === 'resources') return returnTo && returnTo.screen !== 'resources' ? navigationActiveTab(layout, returnTo) : 'help';
  return Object.hasOwn(NAVIGATION_LAYOUTS[layout].active, route.screen) ? NAVIGATION_LAYOUTS[layout].active[route.screen]! : route.screen;
}
