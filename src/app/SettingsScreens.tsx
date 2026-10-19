import { authored } from '../i18n/authored';
import { computePlan } from '../domain/workflow';
import { useEffect, useRef, useState } from 'react';
import type { DemoScenario } from '../domain/types';
import type { DemoState, Person, DelegationScope } from '../domain/workflow';
import { useT } from '../i18n';
import { ScreenLink, type Navigate } from './PhoneShell';
import { LanguagePicker, openGuide } from './PeopleScreens';
import { ProgramDetails, ProfileFacts } from './CatalogViews';
import { guideProgress } from './view-model';
import { BoundariesCard } from './VolunteerScreens';
import type { Dispatch } from './ui-controller';
import { focusTarget, focusVisible } from './focus';
import { isNavigationLayout, navigationLayouts, type NavigationLayout } from './navigation-layouts';
export function ResourcesScreen({ scenario, state, person, dispatch }: { scenario: DemoScenario; state: DemoState; person: Person; dispatch: Dispatch }) {
  const t = useT(), resource = scenario.localHelpResources[0]!;
  const resident = person.id === state.household.residentId;
  return <div className="stack"><article className="card resource-card"><h2>{resource.name}</h2><p>{t('resource.description')}</p><p className="muted">{t('resource.verified', { date: resource.source.verifiedAt })}</p><a className="button" href={`tel:${resource.phone}`}>{t('resource.call', { phone: resource.phone })}</a><a className="source-link" href={resource.url}>{t('resource.website')}</a></article>{resident ? <section className="stack"><h2>{t('resource.fictional')}</h2><label>{t('resource.profile')}<select id="fictional-profile" value={state.profileId} onChange={async (e) => (await dispatch({ type: 'select_profile', profileId: e.target.value }))}>{scenario.profiles.map((p) => <option value={p.id} key={p.id}>{authored(t, p.label)}</option>)}</select></label><ProfileFacts scenario={scenario} state={state} />{scenario.programs.map((p) => <article className="card" key={p.id}><h3>{authored(t, p.name)}</h3><p>{authored(t, p.description)}</p><ProgramDetails program={p} scenario={scenario} state={state} plan={computePlan(scenario, state)} live /></article>)}</section> : <p className="notice">{t('routing.resourcesGeneral')}</p>}</div>;
}
export function AccessScreen({ state, dispatch }: { state: DemoState; dispatch: Dispatch }) {
  const t = useT();
  return <div className="stack">{state.people.filter((p) => p.role === 'family_helper').map((helper) => <HelperAccess key={`${helper.id}-${state.delegations.find((d) => d.personId === helper.id)?.updatedBy.at}`} helper={helper} scopes={state.delegations.find((d) => d.personId === helper.id)?.scopes ?? []} dispatch={dispatch} />)}<p className="muted">{t('app.local')}</p></div>;
}
function HelperAccess({ helper, scopes, dispatch }: { helper: Person; scopes: readonly DelegationScope[]; dispatch: Dispatch }) {
  const t = useT(), [selected, setSelected] = useState(scopes);
  return <form className="card stack" onSubmit={async (e) => { e.preventDefault(); (await dispatch(selected.length ? { type: 'grant_delegation', personId: helper.id, scopes: selected } : { type: 'revoke_delegation', personId: helper.id })); }}><h2>{helper.name}</h2><p>{t('access.intro', { name: helper.name })}</p>{(['checklist', 'confirm', 'requests'] as const).map((scope) => <label className="check-label" key={scope}><input type="checkbox" checked={selected.includes(scope)} onChange={(e) => setSelected(e.target.checked ? [...selected, scope] : selected.filter((s) => s !== scope))} /><span>{t(`access.${scope}`)}</span></label>)}<button>{t('access.save')}</button><button type="button" className="secondary" onClick={async () => { if ((await dispatch({ type: 'revoke_delegation', personId: helper.id })).ok) setSelected([]); }}>{t('access.revoke')}</button></form>;
}
export function MoreScreen({ person, resident, canViewScan, navigate, dispatch, onReset, layout = 'current', onLayoutChange }: { person: Person; resident: boolean; canViewScan: boolean; navigate: Navigate; dispatch: Dispatch; onReset(): void; layout?: NavigationLayout; onLayoutChange?(layout: NavigationLayout): Promise<boolean> }) {
  const t = useT();
  async function replay() { await openGuide(person, dispatch, navigate); }
  return <div className="stack"><div className="link-group">{canViewScan && layout === 'current' ? <ScreenLink title={t('nav.scan')} route={{ role: 'r', screen: 'scan' }} navigate={navigate} /> : null}{resident ? <><ScreenLink title={t('nav.access')} route={{ role: 'r', screen: 'access' }} navigate={navigate} /><ScreenLink title={t('nav.report')} route={{ role: 'r', screen: 'report' }} navigate={navigate} /></> : null}<ScreenLink title={t('nav.language')} route={{ role: 'r', screen: 'language' }} navigate={navigate} /><ScreenLink title={t('nav.about')} route={{ role: 'r', screen: 'about' }} navigate={navigate} />{layout !== 'current' ? <ScreenLink title={t('nav.appHelp')} route={{ role: 'r', screen: 'help' }} navigate={navigate} /> : null}</div>{layout !== 'current' ? <p>{t('more.helpBody')}</p> : null}<button className="secondary" onClick={replay}>{t(guideProgress(person).completed ? 'more.replay' : 'routing.resumeGuide')}</button><button className="secondary" onClick={() => navigate({ screen: 'people' })}>{t('nav.switch')}</button>{onLayoutChange ? <NavigationLayoutPicker layout={layout} onChange={onLayoutChange} /> : null}{layout !== 'current' ? <p className="notice">{t('app.disclosure')}</p> : null}{resident ? <button id={focusTarget('reset-close')} className="secondary danger" onClick={onReset}>{t('more.reset')}</button> : null}</div>;
}
export function NavigationLayoutPicker({ layout, onChange }: { layout: NavigationLayout; onChange(layout: NavigationLayout): Promise<boolean> }) {
  const t = useT(), [saving, setSaving] = useState(false), [failed, setFailed] = useState(false);
  return <section className="card stack"><label htmlFor="navigation-layout">{t('navigation.label')}</label><p id="navigation-layout-description" className="muted">{t('navigation.description')}</p><select id="navigation-layout" aria-describedby="navigation-layout-description" value={layout} disabled={saving} onChange={async (event) => { const next = event.target.value; if (!isNavigationLayout(next)) return; setSaving(true); setFailed(false); try { setFailed(!await onChange(next)); } catch { setFailed(true); } finally { setSaving(false); } }}>{navigationLayouts.map((value) => <option key={value} value={value}>{t(`navigation.${value}`)}</option>)}</select>{failed ? <p role="alert">{t('navigation.unsaved')}</p> : null}</section>;
}
export function HelpScreen({ person, navigate, dispatch }: { person: Person; navigate: Navigate; dispatch: Dispatch }) {
  const t = useT();
  return <div className="stack"><p>{t('more.helpBody')}</p><button onClick={async () => { await openGuide(person, dispatch, navigate); }}>{t(guideProgress(person).completed ? 'more.replay' : 'routing.resumeGuide')}</button>{person.role !== 'volunteer' ? <ScreenLink title={t('nav.resources')} route={{ role: 'r', screen: 'resources' }} navigate={navigate} /> : null}<p className="notice">{t('app.disclosure')}</p></div>;
}
export function VolunteerProfile({ person, dispatch, navigate }: { person: Person; dispatch: Dispatch; navigate: Navigate }) {
  const t = useT(), [skills, setSkills] = useState(person.skills.join('\n')), [availability, setAvailability] = useState(person.availability);
  return <div className="stack"><form className="card stack" onSubmit={async (e) => { e.preventDefault(); (await dispatch({ type: 'set_volunteer_profile', skills: skills.split('\n').map((s) => s.trim()).filter(Boolean), availability: availability.trim() })); }}><h2>{t('volunteer.skills')}</h2><p className="label-note">{t('request.selfReport')}</p><label>{t('volunteer.skillsLabel')}<textarea value={skills} onChange={(e) => setSkills(e.target.value)} /></label><label>{t('volunteer.availability')}<textarea maxLength={280} value={availability} onChange={(e) => setAvailability(e.target.value.replace(/[\r\n]/g, ' '))} /></label><button>{t('volunteer.save')}</button></form><section className="card"><h2>{t('nav.language')}</h2><LanguagePicker onSelect={async (language) => (await dispatch({ type: 'set_language', language }))} /></section><HelpScreen person={person} dispatch={dispatch} navigate={navigate} /><BoundariesCard /><button className="secondary" onClick={() => navigate({ screen: 'people' })}>{t('nav.switch')}</button></div>;
}

export function ResetConfirmation({ onReset, onCancel }: { onReset(): void; onCancel(): void }) {
  const t = useT(), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.getElementById(focusTarget('reset-close'));
    dialog.current?.showModal(); focusVisible(document.getElementById(focusTarget('reset-open')));
    return () => { if (trigger?.isConnected) focusVisible(trigger); };
  }, []);
  return <dialog ref={dialog} className="card reset-confirm" aria-labelledby="reset-title" aria-describedby="reset-description reset-bundled-description" onCancel={(event) => { event.preventDefault(); onCancel(); }} style={{ position: 'fixed', insetBlockStart: '1rem', insetBlockEnd: 'auto', marginBlock: 0, maxHeight: 'calc(100dvh - 10rem - env(safe-area-inset-bottom))', width: 'min(36rem, calc(100% - 2rem))', overflowY: 'auto' }}><h2 id="reset-title">{t('more.reset')}</h2><p id="reset-description">{t('more.resetBody')}</p><p id="reset-bundled-description">{t('scan.bundledReset')}</p><div className="stack"><button id={focusTarget('reset-open')} className="secondary" onClick={onCancel}>{t('more.keep')}</button><button className="danger" onClick={onReset}>{t('more.resetConfirm')}</button></div></dialog>;
}

/** Recovery is deliberate; selecting a person never replaces rejected saved bytes. */
export function RecoveryNotice({ status, message, onExport, onReset, onRefresh, canManage = true }: { status: 'invalid' | 'error' | 'unavailable' | 'migrated'; message: string; onExport(): void; onReset(): void; onRefresh(): void; canManage?: boolean }) {
  const t = useT();
  return <section className="card stack" aria-label={t(`data.recovery.${status}`)}><p>{t(`data.recovery.${status}`)}</p><details open><summary>{t('data.recoveryDetails')}</summary><p lang="en">{message}</p></details>{canManage ? <button className="secondary" onClick={onExport}>{t('data.export')}</button> : <p>{t('data.recoveryResident')}</p>}<button className="secondary" onClick={onRefresh}>{t('data.refresh')}</button>{canManage ? <button className="danger secondary" onClick={onReset}>{t('data.recoveryReset')}</button> : null}</section>;
}
