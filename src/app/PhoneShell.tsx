import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Person } from '../domain/roles';
import { useT, reviewed, useLanguage, type MessageKey } from '../i18n';
import { activeTab, homeRoute, isTabRoot, parentRoute, routeHash, type Route } from './routes';
import { focusTarget, focusVisible, skipToContent } from './focus';
import { hasSettingsEntry, navigationTabs, type NavigationLayout } from './navigation-layouts';
export type Navigate = (route: Route) => void;
export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
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
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.home}</svg>;
}
export function PhoneShell({ person, route, title, navigate, children, hasChecklist, hasPlan, hasRequests = true, actingFor, returnTo = null, layout = 'current' }: { person: Person; route: Route; title: string; navigate: Navigate; children: ReactNode; hasChecklist: boolean; hasPlan: boolean; hasRequests?: boolean; actingFor?: string; returnTo?: Route | null; layout?: NavigationLayout }) {
  const t = useT(), [helpOpen, setHelpOpen] = useState(false), helpHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setHelpOpen(false); }, [route]);
  useEffect(() => { if (helpOpen) focusVisible(helpHeading.current); }, [helpOpen]);
  function closeHelp() { setHelpOpen(false); focusVisible(document.getElementById(focusTarget('help-close'))); }
  const context: MessageKey = route.screen === 'check' || route.screen === 'question' ? 'help.context.check' : route.screen === 'plan' ? 'help.context.plan' : ['request', 'task', 'sharing', 'invite', 'review'].includes(route.screen) ? 'help.context.request' : 'help.context.home';
  const tabs = navigationTabs(layout, person.role, { hasChecklist, hasPlan, hasRequests }), settings = hasSettingsEntry(layout, person.role);
  const helpLabel = t(settings ? 'nav.screenHelp' : 'nav.help');
  return <div className="phone-app">
    <a className="skip-link screen-only" href="#screen-heading" onClick={skipToContent}>{t('nav.skipContent')}</a>
    <header className="phone-bar screen-only">
      <div className="bar-top">{isTabRoot(route, layout) ? <span className="wordmark">{t('app.name')}</span> : <button className="bar-button" onClick={() => navigate(parentRoute(route, person.role, returnTo, layout))}><Icon name="back" />{t('nav.back')}</button>}<button id={focusTarget('help-close')} className="bar-button" onClick={() => helpOpen ? closeHelp() : setHelpOpen(true)} aria-expanded={helpOpen} aria-controls="context-help"><Icon name="help" />{helpLabel}</button></div>
      {settings ? <button className="person-chip" onClick={() => navigate({ role: 'r', screen: 'more' })} aria-label={`${t('nav.account')}: ${person.name}`} aria-current={['more', 'help', 'access', 'language', 'report', 'about'].includes(route.screen) ? 'page' : undefined}><Icon name="profile" /><span>{t('nav.account')} · {person.name}</span></button> : <button className="person-chip" onClick={() => navigate({ screen: 'people' })} aria-label={`${t('nav.switch')}: ${person.name}`}><span className="avatar" aria-hidden="true">{person.name.slice(0, 1)}</span>{t('person.chip', { name: person.name, role: t(`role.${person.role}`) })}<span aria-hidden="true">⌄</span></button>}
    </header>
    <main className="phone-main">
      <DemoBanners />
      {helpOpen ? <section id="context-help" className="card context-help screen-only" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeHelp(); } }}><h2 id={focusTarget('help-open')} tabIndex={-1} ref={helpHeading}>{helpLabel}</h2><p>{t(context)}</p><p>{t('app.local')}</p><button className="secondary" onClick={closeHelp}>{t('common.close')}</button></section> : null}
      {actingFor ? <p className="acting-banner screen-only">{t('person.acting', { name: actingFor })}</p> : null}
      <h1 id="screen-heading" tabIndex={-1} className="screen-title screen-only">{title}</h1>
      {children}
    </main>
    <nav className="tab-bar screen-only" aria-label={t('nav.tabs')} style={{ '--tab-count': tabs.length } as React.CSSProperties}>{tabs.map((tab) => {
      const active = activeTab(route, returnTo, layout) === tab.screen;
      return tab.disabled ? <span className="tab-disabled" key={tab.screen} aria-disabled="true"><Icon name={tab.icon} /><span>{t(tab.label)}</span></span> : <a key={tab.screen} href={routeHash(tab.route)} aria-current={active ? 'page' : undefined} onClick={(e) => { e.preventDefault(); navigate(tab.route); }}><Icon name={tab.icon} /><span>{t(tab.label)}</span></a>;
    })}</nav>
  </div>;
}
export function DemoBanners() { const t = useT(), language = useLanguage(); return <div className="demo-banners screen-only"><p>{t('app.demo')}</p>{language === 'es' && !reviewed ? <p className="translation-note" lang="es">{t('app.unreviewed')}</p> : null}</div>; }
export function ScreenLink({ route, navigate, title, detail, icon = 'arrow' }: { route: Route; navigate: Navigate; title: string; detail?: string; icon?: string }) {
  return <a className="screen-link" href={routeHash(route)} onClick={(e) => { e.preventDefault(); navigate(route); }}><span><strong>{title}</strong>{detail ? <span className="muted">{detail}</span> : null}</span><Icon name={icon} /></a>;
}
export function StartShell({ title, children }: { title: string; children: ReactNode }) { const t = useT(), [help, setHelp] = useState(false); return <main className="start-shell"><div className="bar-top"><p className="wordmark">{t('app.name')}</p><button className="bar-button" aria-expanded={help} onClick={() => setHelp(!help)}>{t('nav.help')}</button></div>{help ? <p className="notice">{t('help.context.start')}</p> : null}<DemoBanners /><h1 id="screen-heading" tabIndex={-1}>{title}</h1>{children}</main>; }
export function DefaultHomeButton({ person, navigate }: { person: Person; navigate: Navigate }) { const t = useT(); return <button onClick={() => navigate(homeRoute(person.role))}>{t('nav.home')}</button>; }
