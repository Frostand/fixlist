import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Person } from '../domain/roles';
import { useT, reviewed, useLanguage, type MessageKey } from '../i18n';
import { homeRoute, isTabRoot, parentRoute, routeHash, type Route } from './routes';
export type Navigate = (route: Route) => void;
export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v11H3Z" /><path d="M9 21v-8h6v8" /></>,
    check: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="m8 10 2 2 5-5M8 16h7" /></>,
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
export function PhoneShell({ person, route, title, navigate, children, hasChecklist, hasPlan, actingFor }: { person: Person; route: Route; title: string; navigate: Navigate; children: ReactNode; hasChecklist: boolean; hasPlan: boolean; actingFor?: string }) {
  const t = useT(), [helpOpen, setHelpOpen] = useState(false), helpHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setHelpOpen(false); }, [route]);
  useEffect(() => { if (helpOpen) helpHeading.current?.focus(); }, [helpOpen]);
  const context: MessageKey = route.screen === 'check' || route.screen === 'question' ? 'help.context.check' : route.screen === 'plan' ? 'help.context.plan' : ['request', 'task', 'sharing', 'invite', 'review'].includes(route.screen) ? 'help.context.request' : 'help.context.home';
  const tabs = person.role === 'volunteer' ? ['home', 'tasks', 'profile'] as const : ['home', 'check', 'plan', 'help', 'more'] as const;
  return <div className="phone-app">
    <a className="skip-link screen-only" href="#screen-heading">{t('nav.skipContent')}</a>
    <header className="phone-bar screen-only">
      <div className="bar-top">{isTabRoot(route) ? <span className="wordmark">{title}</span> : <button className="bar-button" onClick={() => navigate(parentRoute(route, person.role))}><Icon name="back" />{t('nav.back')}</button>}<button className="bar-button" onClick={() => setHelpOpen(!helpOpen)} aria-expanded={helpOpen} aria-controls="context-help"><Icon name="help" />{t('nav.help')}</button></div>
      <button className="person-chip" onClick={() => navigate({ screen: 'people' })} aria-label={`${t('nav.switch')}: ${person.name}`}><span className="avatar" aria-hidden="true">{person.name.slice(0, 1)}</span>{t('person.chip', { name: person.name, role: t(`role.${person.role}`) })}<span aria-hidden="true">⌄</span></button>
    </header>
    <main className="phone-main">
      <DemoBanners />
      {helpOpen ? <section id="context-help" className="card context-help screen-only"><h2 tabIndex={-1} ref={helpHeading}>{t('nav.help')}</h2><p>{t(context)}</p><p>{t('app.local')}</p><button className="secondary" onClick={() => setHelpOpen(false)}>{t('common.close')}</button></section> : null}
      {actingFor ? <p className="acting-banner screen-only">{t('person.acting', { name: actingFor })}</p> : null}
      <h1 id="screen-heading" tabIndex={-1} className="screen-title screen-only">{title}</h1>
      {children}
    </main>
    <nav className="tab-bar screen-only" aria-label={t('nav.tabs')} style={{ '--tab-count': tabs.length } as React.CSSProperties}>{tabs.map((tab) => {
      const disabled = tab === 'check' && !hasChecklist || tab === 'plan' && !hasPlan;
      const target = { role: person.role === 'volunteer' ? 'v' : 'r', screen: tab } as Route;
      const active = 'role' in route && (route.screen === tab || tab === 'check' && route.screen === 'question' || tab === 'tasks' && route.screen === 'task' || tab === 'more' && ['scan', 'report', 'access', 'language', 'about'].includes(route.screen));
      return disabled ? <span className="tab-disabled" key={tab} aria-disabled="true"><Icon name={tab} /><span>{t(`nav.${tab}` as MessageKey)}</span></span> : <a key={tab} href={routeHash(target)} aria-current={active ? 'page' : undefined} onClick={(e) => { e.preventDefault(); navigate(target); }}><Icon name={tab} /><span>{t(`nav.${tab}` as MessageKey)}</span></a>;
    })}</nav>
  </div>;
}
export function DemoBanners() { const t = useT(), language = useLanguage(); return <div className="demo-banners screen-only"><p>{t('app.demo')}</p>{language === 'es' && !reviewed ? <p className="translation-note" lang="es">{t('app.unreviewed')}</p> : null}</div>; }
export function ScreenLink({ route, navigate, title, detail, icon = 'arrow' }: { route: Route; navigate: Navigate; title: string; detail?: string; icon?: string }) {
  return <a className="screen-link" href={routeHash(route)} onClick={(e) => { e.preventDefault(); navigate(route); }}><span><strong>{title}</strong>{detail ? <span className="muted">{detail}</span> : null}</span><Icon name={icon} /></a>;
}
export function StartShell({ title, children }: { title: string; children: ReactNode }) { const t = useT(), [help, setHelp] = useState(false); return <main className="start-shell"><div className="bar-top"><p className="wordmark">{t('app.name')}</p><button className="bar-button" aria-expanded={help} onClick={() => setHelp(!help)}>{t('nav.help')}</button></div>{help ? <p className="notice">{t('help.context.start')}</p> : null}<DemoBanners /><h1 id="screen-heading" tabIndex={-1}>{title}</h1>{children}</main>; }
export function DefaultHomeButton({ person, navigate }: { person: Person; navigate: Navigate }) { const t = useT(); return <button onClick={() => navigate(homeRoute(person.role))}>{t('nav.home')}</button>; }
