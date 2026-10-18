import type { PersonRole } from '../domain/roles';
export type ResidentScreen = 'home' | 'check' | 'plan' | 'help' | 'more' | 'resources' | 'scan' | 'report' | 'access' | 'language' | 'about' | 'requests';
export type Route = { screen: 'start' | 'people' | 'guide' } | { screen: ResidentScreen; role: 'r' } | { screen: 'question'; role: 'r'; id: string } | { screen: 'request' | 'sharing' | 'invite' | 'review'; role: 'r'; id: string } | { screen: 'home' | 'tasks' | 'profile'; role: 'v' } | { screen: 'task'; role: 'v'; id: string };
const residentScreens: readonly string[] = ['home', 'check', 'plan', 'help', 'more', 'resources', 'scan', 'report', 'access', 'language', 'about', 'requests'];
const validPart = (v: string | undefined): v is string => !!v && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v);
export function parseRoute(hash: string, search = ''): Route {
  if (new URLSearchParams(search).has('localScan')) return { role: 'r', screen: 'scan' };
  let parts: string[];
  try { parts = decodeURIComponent(hash.replace(/^#/, '')).split('/').filter(Boolean); } catch { return { screen: 'start' }; }
  if (parts.length === 1 && ['start', 'people', 'guide'].includes(parts[0]!)) return { screen: parts[0] as 'start' | 'people' | 'guide' };
  const [role, screen, id] = parts;
  if (role === 'r' && parts.length === 2 && residentScreens.includes(screen!)) return { role, screen: screen as ResidentScreen };
  if (role === 'v' && parts.length === 2 && ['home', 'tasks', 'profile'].includes(screen!)) return { role, screen: screen as 'home' | 'tasks' | 'profile' };
  if (parts.length === 3 && validPart(id)) {
    if (role === 'r' && ['question', 'request', 'sharing', 'invite', 'review'].includes(screen!)) return { role, screen: screen as 'question' | 'request' | 'sharing' | 'invite' | 'review', id };
    if (role === 'v' && screen === 'task') return { role, screen, id };
  }
  return { screen: 'start' };
}
export function routeHash(route: Route): string { return `#/${'role' in route ? `${route.role}/` : ''}${route.screen}${'id' in route ? `/${encodeURIComponent(route.id)}` : ''}`; }
export function homeRoute(role: PersonRole): Route { return { role: role === 'volunteer' ? 'v' : 'r', screen: 'home' }; }
export function isTabRoot(route: Route): boolean { return 'role' in route && (route.role === 'v' ? ['home', 'tasks', 'profile'] : ['home', 'check', 'plan', 'help', 'more']).includes(route.screen); }
export function parentRoute(route: Route, role: PersonRole): Route {
  if (!('role' in route)) return { screen: 'people' };
  if (route.role === 'v') return route.screen === 'task' ? { role: 'v', screen: 'tasks' } : homeRoute(role);
  if (['sharing', 'invite', 'review'].includes(route.screen) && 'id' in route) return { role: 'r', screen: 'request', id: route.id };
  if (route.screen === 'question') return { role: 'r', screen: 'check' };
  if (route.screen === 'request') return { role: 'r', screen: 'requests' };
  return { role: 'r', screen: 'more' };
}
