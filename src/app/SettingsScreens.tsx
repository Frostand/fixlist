import { authored } from '../i18n/authored';
import { computePlan, createInitialState } from '../domain/workflow';
import { useState } from 'react';
import type { DemoScenario } from '../domain/types';
import type { DemoState, Person, DelegationScope } from '../domain/workflow';
import { useT } from '../i18n';
import { ScreenLink, type Navigate } from './PhoneShell';
import { LanguagePicker } from './PeopleScreens';
import { ProgramDetails, ProfileFacts } from './CatalogViews';
import { guideIdFor } from './view-model';
import { BoundariesCard } from './VolunteerScreens';
import type { Dispatch } from './ui-controller';
export function ResourcesScreen({ scenario, state, person, dispatch }: { scenario: DemoScenario; state: DemoState; person: Person; dispatch: Dispatch }) {
  const t = useT(), resource = scenario.localHelpResources[0]!;
  const factsState = person.role === 'resident' ? state : createInitialState(scenario);
  return <div className="stack"><article className="card resource-card"><h2>{resource.name}</h2><p>{t('resource.description')}</p><p className="muted">{t('resource.verified', { date: resource.source.verifiedAt })}</p><a className="button" href={`tel:${resource.phone}`}>{t('resource.call', { phone: resource.phone })}</a><a className="source-link" href={resource.url}>{t('resource.website')}</a></article><section className="stack"><h2>{t('resource.fictional')}</h2>{person.role === 'resident' ? <label>{t('resource.profile')}<select id="fictional-profile" value={state.profileId} onChange={(e) => dispatch({ type: 'select_profile', profileId: e.target.value })}>{scenario.profiles.map((p) => <option value={p.id} key={p.id}>{authored(t, p.label)}</option>)}</select></label> : null}<ProfileFacts scenario={scenario} state={factsState} />{scenario.programs.map((p) => <article className="card" key={p.id}><h3>{authored(t, p.name)}</h3><p>{authored(t, p.description)}</p><ProgramDetails program={p} scenario={scenario} state={factsState} plan={person.role === 'resident' ? computePlan(scenario, state) : []} live /></article>)}</section></div>;
}
export function AccessScreen({ state, dispatch }: { state: DemoState; dispatch: Dispatch }) {
  const t = useT();
  return <div className="stack">{state.people.filter((p) => p.role === 'family_helper').map((helper) => <HelperAccess key={`${helper.id}-${state.delegations.find((d) => d.personId === helper.id)?.updatedBy.at}`} helper={helper} scopes={state.delegations.find((d) => d.personId === helper.id)?.scopes ?? []} dispatch={dispatch} />)}<p className="muted">{t('app.local')}</p></div>;
}
function HelperAccess({ helper, scopes, dispatch }: { helper: Person; scopes: readonly DelegationScope[]; dispatch: Dispatch }) {
  const t = useT(), [selected, setSelected] = useState(scopes);
  return <form className="card stack" onSubmit={(e) => { e.preventDefault(); dispatch(selected.length ? { type: 'grant_delegation', personId: helper.id, scopes: selected } : { type: 'revoke_delegation', personId: helper.id }); }}><h2>{helper.name}</h2><p>{t('access.intro', { name: helper.name })}</p>{(['checklist', 'confirm', 'requests'] as const).map((scope) => <label className="check-label" key={scope}><input type="checkbox" checked={selected.includes(scope)} onChange={(e) => setSelected(e.target.checked ? [...selected, scope] : selected.filter((s) => s !== scope))} /><span>{t(`access.${scope}`)}</span></label>)}<button>{t('access.save')}</button><button type="button" className="secondary" onClick={() => { if (dispatch({ type: 'revoke_delegation', personId: helper.id }).ok) setSelected([]); }}>{t('access.revoke')}</button></form>;
}
export function MoreScreen({ person, resident, canViewScan, navigate, dispatch, onReset }: { person: Person; resident: boolean; canViewScan: boolean; navigate: Navigate; dispatch: Dispatch; onReset(): void }) {
  const t = useT();
  function replay() { if (dispatch({ type: 'set_onboarding', guideId: guideIdFor(person), stepIndex: 0, completed: false }).ok) navigate({ screen: 'guide' }); }
  return <div className="stack"><div className="link-group">{canViewScan ? <ScreenLink title={t('nav.scan')} route={{ role: 'r', screen: 'scan' }} navigate={navigate} /> : null}{resident ? <><ScreenLink title={t('nav.access')} route={{ role: 'r', screen: 'access' }} navigate={navigate} /><ScreenLink title={t('nav.report')} route={{ role: 'r', screen: 'report' }} navigate={navigate} /></> : null}<ScreenLink title={t('nav.language')} route={{ role: 'r', screen: 'language' }} navigate={navigate} /><ScreenLink title={t('nav.about')} route={{ role: 'r', screen: 'about' }} navigate={navigate} /></div><button className="secondary" onClick={replay}>{t('more.replay')}</button><button className="secondary" onClick={() => navigate({ screen: 'people' })}>{t('nav.switch')}</button>{resident ? <button className="secondary danger" onClick={onReset}>{t('more.reset')}</button> : null}</div>;
}
export function HelpScreen({ person, navigate, dispatch }: { person: Person; navigate: Navigate; dispatch: Dispatch }) {
  const t = useT();
  return <div className="stack"><p>{t('more.helpBody')}</p><button onClick={() => { if (dispatch({ type: 'set_onboarding', guideId: guideIdFor(person), stepIndex: 0, completed: false }).ok) navigate({ screen: 'guide' }); }}>{t('more.replay')}</button>{person.role !== 'volunteer' ? <ScreenLink title={t('nav.resources')} route={{ role: 'r', screen: 'resources' }} navigate={navigate} /> : null}<p className="notice">{t('app.disclosure')}</p></div>;
}
export function VolunteerProfile({ person, dispatch, navigate }: { person: Person; dispatch: Dispatch; navigate: Navigate }) {
  const t = useT(), [skills, setSkills] = useState(person.skills.join('\n')), [availability, setAvailability] = useState(person.availability);
  return <div className="stack"><form className="card stack" onSubmit={(e) => { e.preventDefault(); dispatch({ type: 'set_volunteer_profile', skills: skills.split('\n').map((s) => s.trim()).filter(Boolean), availability: availability.trim() }); }}><h2>{t('volunteer.skills')}</h2><p className="label-note">{t('request.selfReport')}</p><label>{t('volunteer.skillsLabel')}<textarea value={skills} onChange={(e) => setSkills(e.target.value)} /></label><label>{t('volunteer.availability')}<textarea maxLength={280} value={availability} onChange={(e) => setAvailability(e.target.value.replace(/[\r\n]/g, ' '))} /></label><button>{t('volunteer.save')}</button></form><section className="card"><h2>{t('nav.language')}</h2><LanguagePicker onSelect={(language) => dispatch({ type: 'set_language', language })} /></section><HelpScreen person={person} dispatch={dispatch} navigate={navigate} /><BoundariesCard /><button className="secondary" onClick={() => navigate({ screen: 'people' })}>{t('nav.switch')}</button></div>;
}
