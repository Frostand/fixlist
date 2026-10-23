import { authored } from '../i18n/authored';
import { computePlan } from '../domain/workflow';
import { useEffect, useRef, useState } from 'react';
import type { DemoScenario } from '../domain/types';
import type { DemoState, Person, DelegationScope } from '../domain/workflow';
import { LANGUAGES, useLanguage, useT } from '../i18n';
import { Icon, ScreenLink, type Navigate } from './PhoneShell';
import { LanguagePicker, openGuide } from './PeopleScreens';
import { ProgramDetails, ProfileFacts } from './CatalogViews';
import { guideProgress } from './view-model';
import { BoundariesCard } from './VolunteerScreens';
import type { Dispatch } from './ui-controller';
import { focusTarget, focusVisible } from './focus';
import { RequestList } from './RequestScreens';
import type { RequestView } from '../domain/workflow';
import { ListGroup, ListRow } from './UI';
import type { NavigationLayout } from './navigation-layouts';
export function LocalServicesCard({ scenario }: { scenario: DemoScenario }) {
  const t = useT(), resource = scenario.localHelpResources[0];
  if (!resource) return null;
  return <article className="card resource-card"><div className="resource-heading"><Icon name="phone" /><h2>{resource.name}</h2></div><p className="muted">{t('resource.description')}</p><div className="button-row"><a className="button" href={`tel:${resource.phone}`}>{t('resource.call', { phone: resource.phone })}</a><a className="button secondary" href={resource.url}>{t('resource.website')}</a></div><p className="footnote">{t('resource.verified', { date: resource.source.verifiedAt })}</p></article>;
}
export function HelpHub({ scenario, person, requests, navigate, dispatch }: { scenario: DemoScenario; person: Person; requests: readonly ({ kind: 'household' } & RequestView)[]; navigate: Navigate; dispatch: Dispatch }) {
  const t = useT();
  return <div className="stack"><button onClick={() => navigate({ role: 'r', screen: 'plan' })}><Icon name="plus" />{t('help.ask')}</button><section className="stack"><h2>{t('help.yourRequests')}</h2><RequestList requests={requests} navigate={navigate} /></section><section className="stack"><h2>{t('help.services')}</h2><LocalServicesCard scenario={scenario} /></section><ListGroup><ListRow title={t('help.examples')} subtitle={t('help.fictional')} icon="check" route={{ role: 'r', screen: 'resources' }} navigate={navigate} /><ListRow title={t('setup.how')} icon="info" onClick={() => void openGuide(person, dispatch, navigate)} /></ListGroup><p className="footnote">{t('help.local')}</p></div>;
}
export function ResourcesScreen({ scenario, state, person, dispatch }: { scenario: DemoScenario; state: DemoState; person: Person; dispatch: Dispatch }) {
  const t = useT(), resident = person.id === state.household.residentId;
  return <div className="stack">{resident ? <><p className="footnote">{t('help.fictional')}</p><label>{t('resource.profile')}<select id="fictional-profile" value={state.profileId} onChange={async (event) => await dispatch({ type: 'select_profile', profileId: event.target.value })}>{scenario.profiles.map((profile) => <option value={profile.id} key={profile.id}>{authored(t, profile.label)}</option>)}</select></label><details className="card"><summary>{t('resource.profileDetails')}</summary><ProfileFacts scenario={scenario} state={state} /></details>{scenario.programs.map((program) => <article className="card" key={program.id}><h2>{authored(t, program.name)}</h2><p className="muted">{authored(t, program.description)}</p><details><summary>{t('resource.seeDetails')}</summary><ProgramDetails program={program} scenario={scenario} state={state} plan={computePlan(scenario, state)} live /></details></article>)}</> : <><LocalServicesCard scenario={scenario} /><p className="notice">{t('routing.resourcesGeneral')}</p></>}</div>;
}
export function AccessScreen({ state, dispatch }: { state: DemoState; dispatch: Dispatch }) {
  const t = useT();
  return <div className="stack">{state.people.filter((p) => p.role === 'family_helper').map((helper) => <HelperAccess key={`${helper.id}-${state.delegations.find((d) => d.personId === helper.id)?.updatedBy.at}`} helper={helper} scopes={state.delegations.find((d) => d.personId === helper.id)?.scopes ?? []} dispatch={dispatch} />)}<p className="muted">{t('app.local')}</p></div>;
}
function HelperAccess({ helper, scopes, dispatch }: { helper: Person; scopes: readonly DelegationScope[]; dispatch: Dispatch }) {
  const t = useT(), [selected, setSelected] = useState(scopes);
  return <form className="card stack" onSubmit={async (e) => { e.preventDefault(); (await dispatch(selected.length ? { type: 'grant_delegation', personId: helper.id, scopes: selected } : { type: 'revoke_delegation', personId: helper.id })); }}><h2>{helper.name}</h2><p>{t('access.intro', { name: helper.name })}</p>{(['checklist', 'confirm', 'requests'] as const).map((scope) => <label className="check-label" key={scope}><input type="checkbox" checked={selected.includes(scope)} onChange={(e) => setSelected(e.target.checked ? [...selected, scope] : selected.filter((s) => s !== scope))} /><span>{t(`access.${scope}`)}</span></label>)}<button>{t('access.save')}</button><button type="button" className="secondary" onClick={async () => { if ((await dispatch({ type: 'revoke_delegation', personId: helper.id })).ok) setSelected([]); }}>{t('access.revoke')}</button></form>;
}
export function MoreScreen({ person, resident, canViewScan, navigate, dispatch, onReset }: { person: Person; resident: boolean; canViewScan: boolean; navigate: Navigate; dispatch: Dispatch; onReset(): void; layout?: NavigationLayout; onLayoutChange?(layout: NavigationLayout): Promise<boolean>; showNavigationLayout?: boolean }) {
  const t = useT(), language = useLanguage();
  return <div className="stack settings-screen"><section className="card settings-person"><span className="avatar" aria-hidden="true">{person.name.slice(0, 1)}</span><div><h2>{person.name}</h2><p className="muted">{t(`role.${person.role}`)}</p></div><button className="plain" onClick={() => navigate({ screen: 'people' })}>{t('nav.switch')}</button></section>
    <ListGroup><ListRow title={t('nav.language')} icon="globe" trailing={LANGUAGES.find((option) => option.code === language)?.nativeName} route={{ role: 'r', screen: 'language' }} navigate={navigate} /><ListRow title={t('nav.display')} icon="text" route={{ role: 'r', screen: 'display' }} navigate={navigate} />{resident ? <><ListRow title={t('nav.access')} icon="people" route={{ role: 'r', screen: 'access' }} navigate={navigate} /><ListRow title={t('nav.report')} icon="printer" route={{ role: 'r', screen: 'report' }} navigate={navigate} /></> : null}</ListGroup>
    <ListGroup>{canViewScan ? <ListRow title={t('nav.scan3d')} icon="cube" route={{ role: 'r', screen: 'scan' }} navigate={navigate} /> : null}<ListRow title={t('setup.how')} icon="info" onClick={() => void openGuide(person, dispatch, navigate)} /><ListRow title={t('nav.about')} icon="shield" route={{ role: 'r', screen: 'about' }} navigate={navigate} /></ListGroup>
    {resident ? <button id={focusTarget('reset-close')} className="list-row destructive reset-row" onClick={onReset}><Icon name="trash" />{t('more.reset')}</button> : null}
  </div>;
}
/** Session display choice; device text size remains the default on a fresh launch. */
export function DisplayScreen() {
  const t = useT(), [size, setSize] = useState(() => typeof document === 'undefined' ? '100' : document.documentElement.style.fontSize.replace('%', '') || '100');
  return <div className="stack"><section className="card stack"><label>{t('display.textSize')}<select value={size} onChange={(event) => { setSize(event.target.value); document.documentElement.style.fontSize = `${event.target.value}%`; }}>{(['100', '112', '125'] as const).map((value) => <option key={value} value={value}>{t(`display.size.${value}`)}</option>)}</select></label><p>{t('display.preview')}</p><p className="footnote">{t('display.session')}</p></section></div>;
}
export function HelpScreen({ person, navigate, dispatch }: { person: Person; navigate: Navigate; dispatch: Dispatch }) {
  const t = useT();
  return <div className="stack"><p>{t('more.helpBody')}</p><button onClick={async () => { await openGuide(person, dispatch, navigate); }}>{t(guideProgress(person).completed ? 'more.replay' : 'routing.resumeGuide')}</button>{person.role !== 'volunteer' ? <ScreenLink title={t('nav.resources')} route={{ role: 'r', screen: 'resources' }} navigate={navigate} /> : null}<p className="notice">{t('app.disclosure')}</p></div>;
}
export function VolunteerProfile({ person, dispatch, navigate }: { person: Person; dispatch: Dispatch; navigate: Navigate }) {
  const t = useT(), [skills, setSkills] = useState(person.skills.join('\n')), [availability, setAvailability] = useState(person.availability);
  return <div className="stack"><form className="card stack" onSubmit={async (e) => { e.preventDefault(); (await dispatch({ type: 'set_volunteer_profile', skills: skills.split('\n').map((s) => s.trim()).filter(Boolean), availability: availability.trim() })); }}><h2>{t('volunteer.skills')}</h2><p className="label-note">{t('request.selfReport')}</p><label>{t('volunteer.skillsLabel')}<textarea value={skills} onChange={(e) => setSkills(e.target.value)} /></label><label>{t('volunteer.availability')}<textarea maxLength={280} value={availability} onChange={(e) => setAvailability(e.target.value.replace(/[\r\n]/g, ' '))} /></label><button>{t('volunteer.save')}</button></form><section className="card"><h2>{t('nav.language')}</h2><LanguagePicker current={person.language} onSelect={async (language) => (await dispatch({ type: 'set_language', language }))} /></section><HelpScreen person={person} dispatch={dispatch} navigate={navigate} /><BoundariesCard /><button className="secondary" onClick={() => navigate({ screen: 'people' })}>{t('nav.switch')}</button></div>;
}

export function ResetConfirmation({ onReset, onCancel }: { onReset(): void; onCancel(): void }) {
  const t = useT(), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.getElementById(focusTarget('reset-close'));
    dialog.current?.showModal(); focusVisible(document.getElementById(focusTarget('reset-open')));
    return () => { if (trigger?.isConnected) focusVisible(trigger); };
  }, []);
  return <dialog ref={dialog} className="card reset-confirm" aria-labelledby="reset-title" aria-describedby="reset-description reset-bundled-description" onCancel={(event) => { event.preventDefault(); onCancel(); }} style={{ position: 'fixed', insetBlockStart: 'calc(1rem + env(safe-area-inset-top))', insetBlockEnd: 'auto', marginBlock: 0, maxHeight: 'calc(100dvh - 10rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))', width: 'min(36rem, calc(100% - 2rem))', overflowY: 'auto' }}><h2 id="reset-title">{t('more.reset')}</h2><p id="reset-description">{t('more.resetBody')}</p><p id="reset-bundled-description">{t('scan.bundledReset')}</p><div className="stack"><button id={focusTarget('reset-open')} className="secondary" onClick={onCancel}>{t('more.keep')}</button><button className="danger" onClick={onReset}>{t('more.resetConfirm')}</button></div></dialog>;
}

/** Recovery is deliberate; selecting a person never replaces rejected saved bytes. */
export function RecoveryNotice({ status, message, onExport, onReset, onRefresh, canManage = true }: { status: 'invalid' | 'error' | 'unavailable' | 'migrated'; message: string; onExport(): void; onReset(): void; onRefresh(): void; canManage?: boolean }) {
  const t = useT(), [dismissed, setDismissed] = useState(false);
  if (dismissed && status === 'migrated') return null;
  return <section className="recovery-banner" aria-label={t(`data.recovery.${status}`)}><div className="bar-top"><p>{t(`data.recovery.${status}`)}</p>{status === 'migrated' ? <button className="plain" aria-label={t('common.close')} onClick={() => setDismissed(true)}>×</button> : null}</div><details><summary>{t('data.recoveryDetails')}</summary><p className="footnote" lang="en">{message}</p><div className="stack">{canManage ? <button className="secondary" onClick={onExport}>{t('data.export')}</button> : <p>{t('data.recoveryResident')}</p>}<button className="secondary" onClick={onRefresh}>{t('data.refresh')}</button>{canManage ? <button className="danger secondary" onClick={onReset}>{t('data.recoveryReset')}</button> : null}</div></details></section>;
}
