import { type ReactNode } from 'react';
import type { Person } from '../domain/roles';
import { useT, type MessageKey } from '../i18n';
import { activeTab, homeRoute, isTabRoot, parentRoute, routeHash, type Route } from './routes';
import { skipToContent } from './focus';
import { navigationTitleKey, navigationTabs, type NavigationLayout } from './navigation-layouts';
export type Navigate = (route: Route) => void;
export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    scan: <><path d="M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4" /><rect x="7" y="8" width="10" height="8" rx="2" /><circle cx="12" cy="12" r="2" /></>,
    camera: <><path d="m8 6 1-2h6l1 2h4v14H4V6Z" /><circle cx="12" cy="12" r="4" /></>,
    flag: <><path d="M5 22V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0" /></>,
    gear: <><path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 3-1 3 1 4-2v-4l2-2-2-4-3-1-1-3Z" /><circle cx="12" cy="11" r="3" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
    text: <><path d="M3 5h12M9 5v15M5 20h8m1-4h7m-8 4 4-11 4 11" /></>,
    printer: <><path d="M7 8V3h10v5M7 17H3V8h18v9h-4M7 14h10v7H7Z" /><path d="M17 11h.01" /></>,
    cube: <><path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10v10M3 7l9 5 9-5" /></>,
    shield: <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z" /><path d="m8 11 3 3 5-6" /></>,
    people: <><circle cx="9" cy="7" r="3" /><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6m1 4a6 6 0 0 1 4 7" /></>,
    smartphone: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 5h4m-3 14h2" /></>,
    sofa: <><path d="M5 12V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M5 17v3m14-3v3M5 13h14" /><path d="M5 10H3v7h18v-7h-2v3H5Z" /></>,
    hallway: <><path d="M3 21V3h18v18M3 3l6 5h6l6-5M9 8v13m6-13v13M3 21l6-6m6 0 6 6" /><path d="M11 18h2m-1-5v2" /></>,
    stairs: <><path d="M3 21h5v-6h5V9h5V3h3M3 12l13-9M5 11v5m6-9v4" /></>,
    bed: <><path d="M3 5v16m18-9v9M3 17h18M3 9h15a3 3 0 0 1 3 3v5M7 9v5m-4 0h18" /><path d="M7 9V6h5v3" /></>,
    bath: <><path d="M3 12h18l-2 7H5ZM6 19v3m12-3v3M5 12V5a3 3 0 0 1 6 0v1M8 7h6m-4 2v.01m3 0v.01" /></>,
    phone: <path d="M5 3h4l2 5-3 2c1 3 3 5 6 6l2-3 5 2v4c0 4-7 1-11-3S1 3 5 3Z" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    plus: <path d="M12 4v16M4 12h16" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
    tick: <path d="m5 12 4 4L19 6" />,
    'check-circle': <><circle cx="12" cy="12" r="9" /><path d="m7 12 3 3 7-7" /></>,
    home: <><path d="m3 10 9-7 9 7v11H3Z" /><path d="M9 21v-8h6v8" /></>,
    check: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="m8 10 2 2 5-5M8 16h7" /></>,
    rooms: <><path d="M3 21h18M5 21V3h14v18M8 21V6l8-2v17" /><path d="M13 12h.01" /></>,
    requests: <><circle cx="12" cy="6" r="3" /><path d="M7 15v-2a5 5 0 0 1 10 0v2M3 17l4 4h10l4-4M7 17h10" /></>,
    plan: <><path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01" /></>,
    more: <><circle cx="4" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="20" cy="12" r="1" /></>,
    profile: <><circle cx="12" cy="7" r="4" /><path d="M4 22v-3a8 8 0 0 1 16 0v3" /></>,
    tasks: <><rect x="4" y="4" width="16" height="17" rx="2" /><path d="m8 12 3 3 5-6" /></>,
    arrow: <path d="m9 5 7 7-7 7M3 12h13" />,
    back: <path d="m14 5-7 7 7 7" />,
  };
  const alias: Record<string, string> = { person: 'profile', room: 'rooms', 'list-check': 'check', hands: 'requests', 'text-size': 'text', lock: 'shield' };
  return <svg className={['back', 'arrow', 'chevron'].includes(name) ? 'directional-icon' : undefined} data-icon={name} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths[alias[name] ?? ''] ?? paths.home}</svg>;
}
export function PhoneShell({ person, route, title, navigate, children, hasChecklist, hasPlan, hasRequests = true, actingFor, returnTo = null, layout = 'current' }: { person: Person; route: Route; title: string; navigate: Navigate; children: ReactNode; hasChecklist: boolean; hasPlan: boolean; hasRequests?: boolean; actingFor?: string; returnTo?: Route | null; layout?: NavigationLayout }) {
  const t = useT(), root = isTabRoot(route, layout);
  const parent = parentRoute(route, person.role, returnTo, layout);
  const parentKey: MessageKey = navigationTitleKey(layout, parent) ?? (`nav.${parent.screen}` as MessageKey);
  const tabs = navigationTabs(layout, person.role, { hasChecklist, hasPlan, hasRequests });
  const avatar = <button className="avatar-button" onClick={() => navigate(person.role === 'volunteer' ? { role: 'v', screen: 'profile' } : { role: 'r', screen: 'more' })} aria-label={`${t('nav.account')}: ${person.name}`}><span className="avatar" aria-hidden="true">{person.name.slice(0, 1)}</span></button>;
  return <div className="phone-app">
    <a className="skip-link screen-only" href="#screen-heading" onClick={skipToContent}>{t('nav.skipContent')}</a>
    <header className="phone-bar screen-only">{root ? null : <div className="compact-bar"><button className="bar-button" onClick={() => navigate(parent)}><Icon name="back" /><span>{t(parentKey)}</span></button><h1 id="screen-heading" tabIndex={-1} className="compact-title">{title}</h1><span /></div>}</header>
    <main className="phone-main">
      {root ? <div className="large-title-header screen-only"><h1 id="screen-heading" tabIndex={-1}>{title}</h1>{avatar}</div> : null}
      {actingFor ? <p className="acting-banner screen-only">{t('person.acting', { name: actingFor })}</p> : null}
      {children}
      <DemoBanners showDemo={route.screen === 'more' || route.screen === 'about'} />
    </main>
    <nav className="tab-bar screen-only" aria-label={t('nav.tabs')} style={{ '--tab-count': tabs.length } as React.CSSProperties}>{tabs.map((tab) => {
      const active = activeTab(route, returnTo, layout) === tab.screen;
      return tab.disabled ? <span className="tab-disabled" key={tab.screen} aria-disabled="true"><Icon name={tab.icon} /><span>{t(tab.label)}</span></span> : <a key={tab.screen} href={routeHash(tab.route)} aria-current={active ? 'page' : undefined} onClick={(e) => { e.preventDefault(); navigate(tab.route); }}><Icon name={tab.icon} /><span>{t(tab.label)}</span></a>;
    })}</nav>
  </div>;
}
export function DemoBanners({ showDemo = true, printable = false }: { showDemo?: boolean; printable?: boolean }) { const t = useT(); return showDemo ? <div className={`demo-banners${printable ? '' : ' screen-only'}`}><p>{t('app.demo')}</p></div> : null; }
export function ScreenLink({ route, navigate, title, detail, icon = 'arrow' }: { route: Route; navigate: Navigate; title: string; detail?: string; icon?: string }) {
  return <a className="screen-link" href={routeHash(route)} onClick={(e) => { e.preventDefault(); navigate(route); }}><span><strong>{title}</strong>{detail ? <span className="muted">{detail}</span> : null}</span><Icon name={icon} /></a>;
}
export function StartShell({ title, children, showDemo = false }: { title: string; children: ReactNode; showDemo?: boolean }) { return <main className="start-shell"><h1 id="screen-heading" tabIndex={-1}>{title}</h1>{children}<DemoBanners showDemo={showDemo} /></main>; }
export function DefaultHomeButton({ person, navigate }: { person: Person; navigate: Navigate }) { const t = useT(); return <button onClick={() => navigate(homeRoute(person.role))}>{t('nav.home')}</button>; }
