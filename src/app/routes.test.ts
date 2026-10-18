import { describe, expect, it } from 'vitest';
import { activeTab, authorizedDestination, homeRoute, isTabRoot, launchNavigation, navigationUrl, parentRoute, parseRoute, personDestination, resourceReturnTo, routeHash, usesTabShell, type Route } from './routes';
describe('bounded hash routes', () => {
  it.each(['', '#', '#/%', '#/%E0%A4%A', '#/r', '#/v/scan', '#/r/question', '#/r/question/a/b', '#/r/question/%3Cscript%3E', '#/unknown', '#/r/question/__proto__'])('safely falls back for %s', (hash) => expect(parseRoute(hash)).toEqual({ screen: 'start' }));
  it.each<Route>([{ screen: 'people' }, { screen: 'guide' }, { role: 'r', screen: 'home' }, { role: 'r', screen: 'question', id: 'rug-check' }, { role: 'r', screen: 'sharing', id: 'request-review-rug' }, { role: 'v', screen: 'task', id: 'request-review-rug' }])('round trips $screen', (r) => expect(parseRoute(routeHash(r))).toEqual(r));
  it('honors the scan launch query but lets later hash navigation work without it', () => { expect(parseRoute('#/start', '?localScan=viennese-v2')).toEqual({ role: 'r', screen: 'scan' }); expect(parseRoute('#/r/home')).toEqual(homeRoute('resident')); });
  it('defines tab roots and parents without browser history assumptions', () => { expect(isTabRoot(homeRoute('volunteer'))).toBe(true); expect(isTabRoot({ role: 'r', screen: 'sharing', id: 'a' })).toBe(false); expect(parentRoute({ role: 'r', screen: 'question', id: 'a' }, 'resident')).toEqual({ role: 'r', screen: 'check' }); });
});

describe('navigation regression decisions', () => {
  const question: Route = { role: 'r', screen: 'question', id: 'rug-check' }, resources: Route = { role: 'r', screen: 'resources' };
  it.each(['#screen-heading', '#report-title', '#/%', '#/unknown', ''])('ignores nonroutes without replacing the current screen: %s', (fragment) => {
    expect(parseRoute(fragment, '', question)).toBe(question);
  });
  it('serializes navigation through the shared encoder and removes only the developer launch parameter', () => {
    const route: Route = { role: 'r', screen: 'question', id: 'rug-check' };
    const url = navigationUrl('https://fixlist.test/?localScan=private&keep=yes#/r/scan', route);
    expect(url.hash).toBe(routeHash(route)); expect(url.search).toBe('?keep=yes'); expect(parseRoute(url.hash)).toEqual(route);
    expect(navigationUrl('https://fixlist.test/', { role: 'r', screen: 'question', id: 'a/b' }).hash).toBe('#/r/question/a%2Fb');
  });
  it('gates a fresh deep link through language, person selection and the guide, then restores the destination', () => {
    const launch = launchNavigation(routeHash(question), '', null);
    expect(launch).toEqual({ route: { screen: 'start' }, pending: question });
    const afterLanguage = launchNavigation('#/people', '', null, launch.pending);
    expect(afterLanguage.pending).toEqual(question);
    expect(personDestination('resident', false, false, afterLanguage.pending)).toEqual({ screen: 'guide' });
    expect(authorizedDestination('resident', afterLanguage.pending)).toEqual(question);
    expect(personDestination('resident', true, false, afterLanguage.pending)).toEqual(question);
    expect(personDestination('resident', false, true, afterLanguage.pending)).toEqual(question);
    expect(personDestination('volunteer', true, false, afterLanguage.pending)).toEqual(homeRoute('volunteer'));
  });
  it('does not force guides on a saved session and preserves the deliberate scan launch exception', () => {
    expect(launchNavigation('', '', homeRoute('resident')).route).toEqual(homeRoute('resident'));
    expect(launchNavigation('', '?localScan=sample', null).route).toEqual({ role: 'r', screen: 'scan' });
  });
  it.each<Route>([{ role: 'r', screen: 'home' }, { role: 'r', screen: 'plan' }, { role: 'r', screen: 'help' }])('returns resources to $screen and keeps that tab active', (entry) => {
    const context = resourceReturnTo(resources, entry, null);
    expect(parentRoute(resources, 'resident', context)).toEqual(entry); expect(activeTab(resources, context)).toBe(entry.screen);
    expect(resourceReturnTo(resources, resources, context)).toBe(context);
  });
  it('gives a direct resources link a useful parent and active tab', () => {
    expect(parentRoute(resources, 'family_helper')).toEqual({ role: 'r', screen: 'help' }); expect(activeTab(resources)).toBe('help');
  });
  it('keeps the guide outside the regular tab shell', () => {
    expect(usesTabShell({ screen: 'guide' })).toBe(false); expect(usesTabShell(question)).toBe(true);
  });
});
