import { describe, expect, it } from 'vitest';
import { homeRoute, isTabRoot, parentRoute, parseRoute, routeHash, type Route } from './routes';
describe('bounded hash routes', () => {
  it.each(['', '#', '#/%', '#/%E0%A4%A', '#/r', '#/v/scan', '#/r/question', '#/r/question/a/b', '#/r/question/%3Cscript%3E', '#/unknown', '#/r/question/__proto__'])('safely falls back for %s', (hash) => expect(parseRoute(hash)).toEqual({ screen: 'start' }));
  it.each<Route>([{ screen: 'people' }, { screen: 'guide' }, { role: 'r', screen: 'home' }, { role: 'r', screen: 'question', id: 'rug-check' }, { role: 'r', screen: 'sharing', id: 'request-review-rug' }, { role: 'v', screen: 'task', id: 'request-review-rug' }])('round trips $screen', (r) => expect(parseRoute(routeHash(r))).toEqual(r));
  it('honors the scan launch query but lets later hash navigation work without it', () => { expect(parseRoute('#/start', '?localScan=viennese-v2')).toEqual({ role: 'r', screen: 'scan' }); expect(parseRoute('#/r/home')).toEqual(homeRoute('resident')); });
  it('defines tab roots and parents without browser history assumptions', () => { expect(isTabRoot(homeRoute('volunteer'))).toBe(true); expect(isTabRoot({ role: 'r', screen: 'sharing', id: 'a' })).toBe(false); expect(parentRoute({ role: 'r', screen: 'question', id: 'a' }, 'resident')).toEqual({ role: 'r', screen: 'check' }); });
});
