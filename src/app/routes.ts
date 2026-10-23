import { demoScenario } from '../data/demo-scenario';
import type { PersonRole } from '../domain/roles';
import { navigationActiveTab, NAVIGATION_LAYOUTS, type NavigationLayout } from './navigation-layouts';
export type ResidentScreen = 'display' | 'home' | 'check' | 'plan' | 'help' | 'more' | 'resources' | 'scan' | 'report' | 'access' | 'language' | 'about' | 'requests';
export type Route = { screen: 'start' | 'people' | 'guide' } | { screen: ResidentScreen; role: 'r' } | { screen: 'question' | 'room' | 'capture'; role: 'r'; id: string } | { screen: 'request' | 'sharing' | 'invite' | 'review'; role: 'r'; id: string } | { screen: 'home' | 'tasks' | 'profile'; role: 'v' } | { screen: 'task'; role: 'v'; id: string };
const residentScreens: readonly string[] = ['display', 'home', 'check', 'plan', 'help', 'more', 'resources', 'scan', 'report', 'access', 'language', 'about', 'requests'];
const validPart = (v: string | undefined): v is string => !!v && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v);
export function parseRoute(hash: string, search = '', fallback: Route = { screen: 'start' }): Route {
  if (new URLSearchParams(search).has('localScan')) return { role: 'r', screen: 'scan' };
  // Content anchors and malformed fragments are not navigation instructions.
  if (!hash.startsWith('#/')) return fallback;
  let parts: string[];
  try { parts = decodeURIComponent(hash.replace(/^#/, '')).split('/').filter(Boolean); } catch { return fallback; }
  if (parts.length === 1 && ['start', 'people', 'guide'].includes(parts[0]!)) return { screen: parts[0] as 'start' | 'people' | 'guide' };
  const [role, screen, id] = parts;
  if (role === 'r' && parts.length === 2 && residentScreens.includes(screen!)) return { role, screen: screen as ResidentScreen };
  if (role === 'v' && parts.length === 2 && ['home', 'tasks', 'profile'].includes(screen!)) return { role, screen: screen as 'home' | 'tasks' | 'profile' };
  if (parts.length === 3 && validPart(id)) {
    if (role === 'r' && ['room', 'capture'].includes(screen!) && demoScenario.rooms.some((room) => room.id === id)) return { role, screen: screen as 'room' | 'capture', id };
    if (role === 'r' && ['question', 'request', 'sharing', 'invite', 'review'].includes(screen!)) return { role, screen: screen as 'question' | 'request' | 'sharing' | 'invite' | 'review', id };
    if (role === 'v' && screen === 'task') return { role, screen, id };
  }
  return fallback;
}
export function routeHash(route: Route): string { return `#/${'role' in route ? `${route.role}/` : ''}${route.screen}${'id' in route ? `/${encodeURIComponent(route.id)}` : ''}`; }
export function homeRoute(role: PersonRole): Route { return { role: role === 'volunteer' ? 'v' : 'r', screen: 'home' }; }
export function isTabRoot(route: Route, layout: NavigationLayout = 'current'): boolean { return 'role' in route && (route.role === 'v' ? ['home', 'tasks', 'profile'] : NAVIGATION_LAYOUTS[layout].tabs.map((t) => t.screen)).includes(route.screen); }
export function parentRoute(route: Route, role: PersonRole, returnTo: Route | null = null, _layout: NavigationLayout = 'current'): Route {
  if (route.screen === 'resources') return returnTo ?? { role: 'r', screen: 'requests' };
  if (route.screen === 'more') return returnTo ?? homeRoute(role);
  if (route.screen === 'scan') return { role: 'r', screen: 'more' };
  if (route.screen === 'help') return { role: 'r', screen: 'requests' };
  if (!('role' in route)) return { screen: 'people' };
  if (route.role === 'v') return route.screen === 'task' ? { role: 'v', screen: 'tasks' } : homeRoute(role);
  if (['sharing', 'invite', 'review'].includes(route.screen) && 'id' in route) return { role: 'r', screen: 'request', id: route.id };
  if (route.screen === 'capture') return { role: 'r', screen: 'room', id: route.id };
  if (route.screen === 'question') return returnTo?.screen === 'room' ? returnTo : { role: 'r', screen: 'check' };
  if (route.screen === 'room') return { role: 'r', screen: 'check' };
  if (route.screen === 'request') return { role: 'r', screen: 'requests' };
  return { role: 'r', screen: 'more' };
}

export function navigationUrl(href: string, route: Route): URL {
  const url = new URL(href); url.searchParams.delete('localScan'); url.searchParams.delete('nav'); url.hash = routeHash(route); return url;
}
export function resourceReturnTo(next: Route, previous: Route, returnTo: Route | null): Route | null {
  if (next.screen === 'more') return isTabRoot(previous) ? previous : returnTo;
  if (['access', 'display', 'language', 'report', 'about', 'scan'].includes(next.screen)) return returnTo;
  if (next.screen === 'question' && previous.screen === 'room') return previous;
  if (next.screen === 'question' && previous.screen === 'question' && returnTo?.screen === 'room') return returnTo;
  if (next.screen === 'resources') return previous.screen === 'resources' ? returnTo : 'role' in previous ? previous : null;
  const flow = ['request', 'sharing', 'invite', 'review'];
  if ('role' in next && next.role === 'r' && flow.includes(next.screen)) {
    if (flow.includes(previous.screen)) return returnTo;
    return 'role' in previous && previous.role === 'r' ? previous : null;
  }
  return null;
}
export function activeTab(route: Route, returnTo: Route | null = null, layout: NavigationLayout = 'current'): string | null { return navigationActiveTab(layout, route, returnTo); }
export function authorizedDestination(role: PersonRole, intended: Route | null): Route {
  return intended && 'role' in intended && intended.role === (role === 'volunteer' ? 'v' : 'r') ? intended : homeRoute(role);
}
export function launchNavigation(hash: string, search: string, resume: Route | null, pending: Route | null = null): { route: Route; pending: Route | null } {
  const route = parseRoute(hash, search, resume ?? { screen: 'start' });
  if (!resume && !new URLSearchParams(search).has('localScan')) return { route: { screen: 'start' }, pending: 'role' in route ? route : pending };
  return { route, pending };
}
export function personDestination(role: PersonRole, guideCompleted: boolean, guideDismissed: boolean, intended: Route | null): Route {
  return guideCompleted || guideDismissed ? authorizedDestination(role, intended) : { screen: 'guide' };
}
export function usesTabShell(route: Route): boolean { return 'role' in route; }
