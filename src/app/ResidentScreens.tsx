import { useEffect, useRef, useState } from 'react';
import { canConfirmConcern, currentRequestForAction, nextRequestId, hasScope, groupPlanByEffort, type DemoState, type ChecklistAnswer, type Person } from '../domain/workflow';
import type { DemoScenario } from '../domain/types';
import type { visibleHouseholdFor, VisibleRequest } from '../domain/role-views';
import type { ElderNextStep, HelperNextStep } from '../domain/role-views';
import type { ScanSuggestionLayer } from '../lib/scan-suggestions';
import { suggestionForChecklist } from '../lib/scan-suggestions';
import { getPhotoStore } from '../lib/photo-storage';
import { useT, useLanguage } from '../i18n';
import { catalogText } from '../i18n/catalog';
import { type Dispatch, addPhoto, removePhoto, operationFailure } from './ui-controller';
import { ScreenLink, Icon, type Navigate } from './PhoneShell';
import { PhotoImage, PhotoInputActions } from './Photos';
import type { OperationFailure } from '../domain/failures';
import { latestUpdates, nextStepCard, personLabel } from './view-model';
import type { NavigationLayout } from './navigation-layouts';
import { checklistAnswerCounts, displayAnswer, firstUnanswered } from './checklist-presentation';
type HouseholdView = NonNullable<ReturnType<typeof visibleHouseholdFor>>;
export interface ResidentProps { scenario: DemoScenario; state: DemoState; person: Person; household: HouseholdView; dispatch: Dispatch; navigate: Navigate }
export function ResidentHome(props: ResidentProps & { requests: readonly VisibleRequest[]; next: ElderNextStep | HelperNextStep | null; layout?: NavigationLayout }) {
  const { scenario, person, household, requests, next, navigate, state, layout = 'current' } = props;
  const t = useT(), card = nextStepCard(next, state, false), answers = household.checklistAnswers;
  const progress = answers ? checklistAnswerCounts(scenario.checklist, state) : null;
  if (next?.kind === 'answer_checklist' && answers) {
    const first = firstUnanswered(scenario.checklist, state);
    if (first) card.route = { role: 'r', screen: 'question', id: first.id };
    else card.key = 'next.reviewNotSure';
  }
  const householdRequests = requests.filter((r) => r.kind === 'household');
  const counts = Object.entries(householdRequests.reduce<Record<string, number>>((out, v) => { const label = t(v.request.professionalReferral ? `data.referral.${v.request.professionalReferral}` : `status.${v.request.status}`); out[label] = (out[label] ?? 0) + 1; return out; }, {}));
  return <div className="stack"><p className="welcome">{t('home.greeting', { name: person.name })}</p><section className="next-card"><p className="eyebrow">{t('home.next')}</p><h2>{t(card.key, { name: state.people.find((p) => p.id === state.household.residentId)?.name ?? '' })}</h2><button onClick={() => navigate(card.route)}>{t('nav.continue')}<Icon name="arrow" /></button></section>
    {layout === 'current' ? <div className="link-group">{progress ? <ScreenLink title={t('home.check')} detail={t('home.progress', progress)} route={{ role: 'r', screen: 'check' }} navigate={navigate} /> : null}{household.plan ? <ScreenLink title={t('home.plan')} detail={t('home.actions', { count: household.plan.length })} route={{ role: 'r', screen: 'plan' }} navigate={navigate} /> : null}
      {household.requests ? <ScreenLink title={t('home.requests')} detail={counts.length ? counts.map(([s, n]) => `${n} ${s}`).join(' · ') : t('home.noRequests')} route={{ role: 'r', screen: 'requests' }} navigate={navigate} /> : null}<ScreenLink title={t('nav.resources')} route={{ role: 'r', screen: 'resources' }} navigate={navigate} /></div> : <HomeFixList {...props} compact={layout === 'three'} />}
    {household.requests ? <section className="card"><h2>{t('home.updates')}</h2>{latestUpdates(householdRequests).map((u) => <blockquote key={`${u.requestId}-${u.index}`}><p>{u.text}</p><footer>{t('person.written', { name: personLabel(state.people, u.actorId, t) })}</footer></blockquote>)}{!householdRequests.some((r) => r.request.updates.length) ? <p className="muted">{t('home.noUpdates')}</p> : null}</section> : null}
  </div>;
}
export function HomeFixList(props: ResidentProps & { compact: boolean }) {
  const t = useT(), { household, navigate, compact } = props;
  if (!household.plan) return null;
  return <section className="stack"><h2>{t('nav.fixList')}</h2>{compact ? <>{!household.plan.length ? <p className="card">{t('plan.empty')}</p> : null}{household.plan.map(({ referenceAction: action }) => <article className="card" key={action.id}><span className="confirmed-tag">{t('check.confirmed')}</span><h3>{catalogText(t, 'action', action.id, 'title')}</h3><p>{catalogText(t, 'action', action.id, 'nextStep')}</p><PlanRequestButton {...props} action={action} /></article>)}</> : null}<ScreenLink title={t('navigation.fullPlan')} detail={t('home.actions', { count: household.plan.length })} route={{ role: 'r', screen: 'plan' }} navigate={navigate} /></section>;
}
export function RoomList({ scenario, state, person, household, dispatch, navigate, showScanEntry = false }: ResidentProps & { showScanEntry?: boolean }) {
  const t = useT(), progress = checklistAnswerCounts(scenario.checklist, state);
  const resume = firstUnanswered(scenario.checklist, state) ?? scenario.checklist[person.checklistPosition] ?? scenario.checklist[0]!;
  return <div className="stack"><p>{t('check.intro')}</p><p>{t('home.progress', progress)}</p><button onClick={() => navigate({ role: 'r', screen: 'question', id: resume.id })}>{t('check.resume')}</button>{showScanEntry && household.canViewScan ? <ScreenLink title={t('nav.scan3d')} route={{ role: 'r', screen: 'scan' }} navigate={navigate} /> : null}<h2>{t('check.rooms')}</h2><div className="room-picker">{scenario.rooms.map((room) => {
    const items = scenario.checklist.filter((c) => c.roomId === room.id), counts = checklistAnswerCounts(items, state);
    return <div className="room-with-capture" key={room.id}><button className="room-pick secondary" data-unknown={counts.unanswered > 0 || counts.notSure > 0} onClick={async () => { const first = firstUnanswered(items, state) ?? items[0]!; if (!(await dispatch({ type: 'set_checklist_position', position: scenario.checklist.indexOf(first) })).ok) return; navigate({ role: 'r', screen: 'question', id: first.id }); }}><Icon name="home" /><strong>{catalogText(t, 'room', room.id)}</strong><span>{t('home.progress', counts)}</span></button>{hasScope(state, person.id, 'checklist') ? <ScreenLink title={t('room.entry')} detail={catalogText(t, 'room', room.id)} route={{ role: 'r', screen: 'room', id: room.id }} navigate={navigate} /> : null}</div>;
  })}</div></div>;
}
export function ChecklistQuestion({ scenario, state, person, household, dispatch, navigate, questionId, saved, suggestions, photoStillRecorded, onPhotoError }: ResidentProps & { questionId: string; saved: boolean; suggestions: ScanSuggestionLayer | null; photoStillRecorded(id: string): boolean; onPhotoError(failure: OperationFailure): void }) {
  const t = useT(), language = useLanguage(), [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const index = scenario.checklist.findIndex((q) => q.id === questionId), item = scenario.checklist[index];
  if (!item || !household.checklistAnswers) return <p>{t('common.unavailable')}</p>;
  const answer = displayAnswer(state, item.id), concern = scenario.concerns.find((c) => c.referenceActionId === item.referenceActionId);
  const confirmed = concern ? household.confirmations?.[concern.id]?.humanConfirmed ?? false : false;
  const suggestion = suggestions ? suggestionForChecklist(suggestions, item.id) : null;

  async function upload(file: File) {
    setBusy(true);
    try { await addPhoto({ input: file, id: `photo-${crypto.randomUUID()}`, checklistItemId: item!.id, store: getPhotoStore(), dispatch, isCurrent: () => alive.current }); }
    catch (error) { if (alive.current) onPhotoError(operationFailure(error)); } finally { setBusy(false); }
  }
  async function move(offset: number) { const next = scenario.checklist[index + offset]; if (!next) { navigate({ role: 'r', screen: 'plan' }); return; } if ((await dispatch({ type: 'set_checklist_position', position: index + offset })).ok) navigate({ role: 'r', screen: 'question', id: next.id }); }
  return <div className="stack"><p className="eyebrow">{catalogText(t, 'room', item.roomId)} · {t('check.question', { current: index + 1, total: scenario.checklist.length })}</p><progress value={index + 1} max={scenario.checklist.length} aria-label={t('check.question', { current: index + 1, total: scenario.checklist.length })} /><p>{t('home.progress', checklistAnswerCounts(scenario.checklist, state))}</p>
    <article className="card question-card"><h2>{catalogText(t, 'check', item.id)}</h2><fieldset className="answer-choices"><legend className="sr-only">{catalogText(t, 'check', item.id)}</legend>{(['yes', 'no', 'unknown'] as readonly ChecklistAnswer[]).map((value) => <label key={value} data-selected={answer === value}><input type="radio" name={item.id} value={value} checked={answer === value} disabled={busy} onChange={async () => { (await dispatch({ type: 'answer_checklist', checklistItemId: item.id, answer: value, position: index })); }} /><span>{t(`check.${value}`)}</span></label>)}</fieldset>
    {answer === 'unanswered' ? <p className="notice">{t('check.unanswered')}</p> : null}{state.checklistAttribution[item.id] ? <p className="muted">{t('person.by', { name: personLabel(state.people, state.checklistAttribution[item.id]!.actorId, t) })}</p> : null}
    <p className="save-status">{t(saved ? 'check.saved' : 'check.unsaved')}</p>
    {suggestion ? <div className="ai-review"><a href="#/r/scan" onClick={(e) => { e.preventDefault(); navigate({ role: 'r', screen: 'scan' }); }}>{t('check.ai')}</a><p>{catalogText(t, 'photo', item.id, 'question')} {language === 'es' ? t('check.originalQuestion') : null}</p><p className="muted">{catalogText(t, 'photo', item.id, 'limitation')}</p></div> : null}
    {concern && answer === 'yes' && hasScope(state, person.id, 'confirm') ? <div className="confirm-box"><p>{t('check.confirmHelp')}</p>{confirmed ? <p className="confirmed-tag">{t('check.confirmed')}</p> : null}<button className={confirmed ? 'secondary' : ''} disabled={busy || !canConfirmConcern(scenario, state, concern.id)} onClick={async () => (await dispatch({ type: confirmed ? 'unconfirm_concern' : 'confirm_concern', concernId: concern.id }))}>{t(confirmed ? 'check.unconfirm' : 'check.confirm')}</button></div> : null}
    </article>
    <section className="card"><PhotoInputActions busy={busy} onPhoto={(file) => void upload(file)} /><p className="muted">{t('check.photoHelp')}</p><p className="muted">{t('data.photoControl')}</p>{state.removedPhotoHistoryTruncated ? <p className="muted">{t('data.photoHistoryTruncated')}</p> : null}{busy ? <p role="status">{t('check.photoBusy')}</p> : null}<div className="photo-grid">{household.photos?.filter((p) => p.checklistItemId === item.id).map((photo) => <figure key={photo.id}><PhotoImage photo={photo} /><figcaption>{t('person.by', { name: personLabel(state.people, photo.addedBy, t) })}</figcaption>{(person.id === state.household.residentId || photo.addedBy === person.id) ? <button className="secondary" disabled={busy} onClick={() => { setBusy(true); void removePhoto({ id: photo.id, store: getPhotoStore(), dispatch, isCurrent: () => alive.current, metadataExists: () => photoStillRecorded(photo.id) }).catch((error) => { if (alive.current) onPhotoError(operationFailure(error, 'storage_unavailable')); }).finally(() => setBusy(false)); }}>{t('check.removePhoto')}</button> : null}</figure>)}</div></section>
    <div className="button-row"><button className="secondary" disabled={index === 0 || busy} onClick={() => move(-1)}>{t('routing.previousQuestion')}</button><button disabled={busy} onClick={() => move(1)}>{t(index === scenario.checklist.length - 1 ? 'nav.plan' : 'nav.next')}</button></div>
  </div>;
}
export function ResidentPlan({ scenario, state, person, household, dispatch, navigate }: ResidentProps) {
  const t = useT(), groups = groupPlanByEffort(household.plan ?? []);
  return <div className="stack"><p>{t('plan.intro')}</p>{hasScope(state, person.id, 'confirm') && !hasScope(state, person.id, 'checklist') ? <p className="notice">{t('data.confirmEvidence')}</p> : null}{hasScope(state, person.id, 'confirm') && hasScope(state, person.id, 'checklist') ? scenario.concerns.filter((c) => !household.confirmations?.[c.id]?.humanConfirmed && canConfirmConcern(scenario, state, c.id)).map((c) => <article className="card" key={c.id}><h2>{catalogText(t, 'action', c.referenceActionId, 'title')}</h2><p>{t('check.confirmHelp')}</p><button onClick={async () => (await dispatch({ type: 'confirm_concern', concernId: c.id }))}>{t('check.confirm')}</button></article>) : null}{!household.plan?.length ? <p className="card">{t('plan.empty')}</p> : null}{groups.filter((g) => g.items.length).map((g) => <section className="stack" key={g.effort}><h2>{t(`effort.${g.effort}`)}</h2>{g.items.map(({ referenceAction: a }) => {
    return <article className="card plan-card" key={a.id}><span className="confirmed-tag">{t('check.confirmed')}</span><h3>{catalogText(t, 'action', a.id, 'title')}</h3><p>{catalogText(t, 'action', a.id, 'nextStep')}</p><p className="muted">{t(`plan.who.${a.effort}`)}</p><p className="muted">{t('plan.cost')}</p><a className="source-link" href={a.guidance.url}>{t('plan.source')}</a>{hasScope(state, person.id, 'confirm') && hasScope(state, person.id, 'checklist') ? scenario.concerns.filter((c) => c.referenceActionId === a.id).map((c) => <button key={c.id} className="secondary" onClick={async () => (await dispatch({ type: 'unconfirm_concern', concernId: c.id }))}>{t('check.unconfirm')}</button>) : null}<div className="photo-grid">{household.photos?.filter((p) => scenario.checklist.find((q) => q.id === p.checklistItemId)?.referenceActionId === a.id).map((photo) => <PhotoImage key={photo.id} photo={photo} />)}</div>
      <PlanRequestButton scenario={scenario} state={state} person={person} household={household} dispatch={dispatch} navigate={navigate} action={a} />
    </article>;
  })}</section>)}</div>;
}
export function PlanRequestButton({ state, person, household, dispatch, navigate, action }: ResidentProps & { action: DemoScenario['referenceActions'][number] }) {
  const t = useT(), currentRequest = currentRequestForAction(state, action.id);
  const request = household.requests?.find((view) => view.kind === 'household' && view.request.id === currentRequest?.id);
  if (!hasScope(state, person.id, 'requests')) return null;
  return <button onClick={() => openPlanActionRequest({ state, person, household, dispatch, navigate, action })}>{t(request ? 'plan.openRequest' : action.effort === 'professional' ? 'data.startReferral' : 'plan.ask')}</button>;
}
export async function openPlanActionRequest({ state, person, household, dispatch, navigate, action }: Pick<ResidentProps, 'state' | 'person' | 'household' | 'dispatch' | 'navigate'> & { action: DemoScenario['referenceActions'][number] }) {
  if (!hasScope(state, person.id, 'requests')) return;
  const currentRequest = currentRequestForAction(state, action.id), request = household.requests?.find((view) => view.kind === 'household' && view.request.id === currentRequest?.id);
  if (request?.kind === 'household') navigate({ role: 'r', screen: 'request', id: request.request.id });
  else { const id = nextRequestId(state, action.id); if ((await dispatch({ type: 'create_request', referenceActionId: action.id, expectedRevision: 0 })).ok) navigate({ role: 'r', screen: action.effort === 'professional' || person.role !== 'resident' ? 'request' : 'sharing', id }); }
}
