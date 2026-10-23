import type { PersonRole } from '../domain/roles';
import type { MessageKey } from '../i18n';
import type { Route } from './routes';

// Old saved values remain readable. All values now render the same layout.
export type NavigationLayout = 'current' | 'three' | 'four';
export const navigationLayouts = ['current'] as const;
export interface NavigationCapabilities { hasChecklist: boolean; hasPlan: boolean; hasRequests: boolean }
type Gate = keyof NavigationCapabilities;
interface TabDefinition { screen: 'home' | 'check' | 'plan' | 'requests' | 'tasks' | 'profile'; label: MessageKey; icon: string; gate?: Gate }
const residentTabs: readonly TabDefinition[] = [
  { screen: 'home', label: 'nav.home', icon: 'home' },
  { screen: 'check', label: 'nav.rooms', icon: 'rooms', gate: 'hasChecklist' },
  { screen: 'plan', label: 'nav.fixList', icon: 'check', gate: 'hasPlan' },
  { screen: 'requests', label: 'nav.help', icon: 'requests', gate: 'hasRequests' },
];
const volunteerTabs: readonly TabDefinition[] = [
  { screen: 'home', label: 'nav.home', icon: 'home' },
  { screen: 'tasks', label: 'nav.tasks', icon: 'tasks' },
  { screen: 'profile', label: 'nav.profile', icon: 'profile' },
];
const single = { tabs: residentTabs, settingsEntry: true };
export const NAVIGATION_LAYOUTS = { current: single, three: single, four: single } as const;
const titles: Partial<Record<Route['screen'], MessageKey>> = { home: 'nav.home', check: 'nav.rooms', question: 'nav.check', room: 'room.title', capture: 'capture.title', plan: 'nav.fixList', more: 'nav.account', help: 'nav.appHelp', requests: 'nav.help', scan: 'nav.scan3d' };
export function navigationTitleKey(_layout: NavigationLayout, route: Route): MessageKey | undefined { return 'role' in route && route.role === 'r' ? titles[route.screen] : undefined; }
export function isNavigationLayout(value: unknown): value is NavigationLayout { return value === 'current' || value === 'three' || value === 'four'; }
export function navigationLayoutParameter(_search: string): NavigationLayout | null { return null; }
export function navigationTabs(_layout: NavigationLayout, role: PersonRole, capabilities: NavigationCapabilities) {
  return (role === 'volunteer' ? volunteerTabs : residentTabs).map((tab) => ({ ...tab, route: { role: role === 'volunteer' ? 'v' : 'r', screen: tab.screen } as Route, disabled: !!tab.gate && !capabilities[tab.gate] }));
}
export function hasSettingsEntry(_layout: NavigationLayout, role: PersonRole): boolean { return role !== 'volunteer'; }
export function navigationActiveTab(_layout: NavigationLayout, route: Route, _returnTo: Route | null = null): string | null {
  if (!('role' in route)) return null;
  if (route.role === 'v') return route.screen === 'task' ? 'tasks' : route.screen;
  if (['question', 'room', 'capture'].includes(route.screen)) return 'check';
  if (['request', 'sharing', 'invite', 'review', 'resources', 'help'].includes(route.screen)) return 'requests';
  return residentTabs.some((tab) => tab.screen === route.screen) ? route.screen : null;
}
