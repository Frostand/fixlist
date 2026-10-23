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
import { Icon, type Navigate } from './PhoneShell';
import { PhotoImage, PhotoInputActions } from './Photos';
import type { OperationFailure } from '../domain/failures';
import { latestUpdates, nextStepCard, personLabel } from './view-model';
import { ListGroup, ListRow, IconTile, Card, ProgressBar, EmptyState, StatusPill, Sheet } from './UI';
import { Illustration } from './Illustration';
import { useCaptureSummaries } from './capture-summary';
import type { NavigationLayout } from './navigation-layouts';
import { progressText, checklistAnswerCounts, displayAnswer, firstUnanswered } from './checklist-presentation';
type HouseholdView = NonNullable<ReturnType<typeof visibleHouseholdFor>>;
export interface ResidentProps { scenario: DemoScenario; state: DemoState; person: Person; household: HouseholdView; dispatch: Dispatch; navigate: Navigate }
export function ResidentHome(props: ResidentProps & { requests: readonly VisibleRequest[]; next: ElderNextStep | HelperNextStep | null; layout?: NavigationLayout }) {
  const { scenario, person, household, requests, next, navigate, state } = props;
  const t = useT(), card = nextStepCard(next, state, false), summaries = useCaptureSummaries(scenario.rooms, !!household.canViewScan);
  const scanned = [...summaries.rooms.values()].filter((room) => room.scanned).length;
  const spots = [...summaries.rooms.values()].reduce((count, room) => count + room.spots, 0);
  const nextRoom = scenario.rooms.find((room) => !summaries.rooms.get(room.id)?.scanned);
  const scanRoute = nextRoom && !summaries.failed ? { role: 'r' as const, screen: 'room' as const, id: nextRoom.id } : { role: 'r' as const, screen: 'check' as const };
  if (next?.kind === 'answer_checklist' && household.checklistAnswers) {
    const first = firstUnanswered(scenario.checklist, state);
    if (first) card.route = { role: 'r', screen: 'question', id: first.id }; else card.key = 'next.reviewNotSure';
  }
  const householdRequests = requests.filter((request) => request.kind === 'household');
  return <div className="stack home-screen"><p className="welcome sr-only">{t('home.greeting', { name: person.name })}</p>
    <Card className="home-progress"><div className="bar-top"><h2>{t('home.overview')}</h2><IconTile name="home" /></div>{household.canViewScan ? <><p className="muted">{t(summaries.failed ? 'rooms.unavailable' : summaries.ready ? 'home.roomsScanned' : 'common.loading', { count: scanned, total: scenario.rooms.length })}</p><ProgressBar value={scanned} max={scenario.rooms.length} label={t('home.roomsScanned', { count: scanned, total: scenario.rooms.length })} /></> : null}{household.checklistAnswers ? <p className="footnote">{progressText(t, checklistAnswerCounts(scenario.checklist, state))}</p> : null}<div className="home-stats">{household.canViewScan ? <div><strong>{summaries.ready && !summaries.failed ? spots : '—'}</strong><span>{t('home.spots')}</span></div> : null}{household.plan ? <a href="#/r/plan" onClick={(event) => { event.preventDefault(); navigate({ role: 'r', screen: 'plan' }); }}><strong>{household.plan.length}</strong><span>{t('home.fixes')}</span></a> : null}{household.requests ? <a href="#/r/requests" onClick={(event) => { event.preventDefault(); navigate({ role: 'r', screen: 'requests' }); }}><strong>{householdRequests.length}</strong><span>{t('home.helpCount')}</span></a> : null}</div></Card>
    {household.canViewScan ? <Card className="scan-hero"><Illustration kind="scan" /><div><h2>{t('home.scan')}</h2><p>{t('home.scanBody')}</p></div><button disabled={!summaries.ready} onClick={() => navigate(scanRoute)}>{t('home.scan')}<Icon name="arrow" /></button></Card> : null}
    <Card className="next-card"><p className="eyebrow">{t('home.next')}</p><h2>{t(card.key, { name: state.people.find((p) => p.id === state.household.residentId)?.name ?? '' })}</h2><button className="secondary full" onClick={() => navigate(card.route)}>{t('nav.continue')}<Icon name="arrow" /></button></Card>
    {household.requests ? latestUpdates(householdRequests).length ? <Card className="home-updates"><h2 className="card-title">{t('home.updates')}</h2>{latestUpdates(householdRequests).map((update) => <blockquote key={`${update.requestId}-${update.index}`}><p>{update.text}</p><footer>{t('person.written', { name: personLabel(state.people, update.actorId, t) })}</footer></blockquote>)}</Card> : <p className="muted home-updates-empty">{t('home.noUpdates')}</p> : null}
  </div>;
}
export function RoomList({ scenario, state, person, household, navigate }: ResidentProps & { showScanEntry?: boolean }) {
  const t = useT(), summaries = useCaptureSummaries(scenario.rooms, !!household.canViewScan);
  if (!household.checklistAnswers) return <p className="notice">{t('person.noGrant')}</p>;
  const resume = firstUnanswered(scenario.checklist, state) ?? scenario.checklist[person.checklistPosition] ?? scenario.checklist[0]!;
  return <div className="stack"><p className="muted">{t('check.intro')}</p>{summaries.failed ? <p className="notice">{t('rooms.unavailable')}</p> : null}<ListGroup>{scenario.rooms.map((room) => {
    const items = scenario.checklist.filter((item) => item.roomId === room.id), counts = checklistAnswerCounts(items, state), capture = summaries.rooms.get(room.id);
    const status = counts.unanswered === 0 ? 'rooms.answered' : summaries.failed ? 'rooms.scanUnavailable' : !summaries.ready ? 'common.loading' : capture?.scanned ? 'rooms.scanned' : 'rooms.notScanned';
    return <ListRow key={room.id} title={catalogText(t, 'room', room.id)} subtitle={t(status, { count: capture?.spots ?? 0 })} leading={capture?.thumbnail ? <img className="room-thumbnail" src={capture.thumbnail} alt="" /> : <IconTile name={({ 'living-room': 'sofa', hallway: 'hallway', stairs: 'stairs', bedroom: 'bed', bathroom: 'bath' } as Record<string, string>)[room.id] ?? 'rooms'} />} route={{ role: 'r', screen: 'room', id: room.id }} navigate={navigate} />;
  })}</ListGroup><button className="secondary full" onClick={() => navigate({ role: 'r', screen: 'question', id: resume.id })}>{t('check.resume')}</button><p className="footnote">{progressText(t, checklistAnswerCounts(scenario.checklist, state))}</p></div>;
}
export function ChecklistQuestion({ scenario, state, person, household, dispatch, navigate, questionId, saved, suggestions, photoStillRecorded, onPhotoError }: ResidentProps & { questionId: string; saved: boolean; suggestions: ScanSuggestionLayer | null; photoStillRecorded(id: string): boolean; onPhotoError(failure: OperationFailure): void }) {
  const t = useT(), language = useLanguage(), [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const index = scenario.checklist.findIndex((q) => q.id === questionId), item = scenario.checklist[index];
  if (!item || !household.checklistAnswers) return <p>{t('common.unavailable')}</p>;
  const answer = displayAnswer(state, item.id), concern = scenario.concerns.find((c) => c.referenceActionId === item.referenceActionId);
  const confirmed = concern ? household.confirmations?.[concern.id]?.humanConfirmed ?? false : false;
  const needsConfirmation = answer === 'yes' && !!concern && !confirmed && hasScope(state, person.id, 'confirm');
  const suggestion = suggestions ? suggestionForChecklist(suggestions, item.id) : null;

  async function upload(file: File) {
    setBusy(true);
    try { await addPhoto({ input: file, id: `photo-${crypto.randomUUID()}`, checklistItemId: item!.id, store: getPhotoStore(), dispatch, isCurrent: () => alive.current }); }
    catch (error) { if (alive.current) onPhotoError(operationFailure(error)); } finally { setBusy(false); }
  }
  async function move(offset: number) { const next = scenario.checklist[index + offset]; if (!next) { navigate({ role: 'r', screen: 'plan' }); return; } if ((await dispatch({ type: 'set_checklist_position', position: index + offset })).ok) navigate({ role: 'r', screen: 'question', id: next.id }); }
  return <div className="stack question-screen"><p className="eyebrow">{catalogText(t, 'room', item.roomId)} · {t('check.question', { current: index + 1, total: scenario.checklist.length })}</p><progress value={index + 1} max={scenario.checklist.length} aria-label={t('check.question', { current: index + 1, total: scenario.checklist.length })} />
    <article className="card question-card"><h2>{catalogText(t, 'check', item.id)}</h2><fieldset className="answer-choices"><legend className="sr-only">{catalogText(t, 'check', item.id)}</legend>{(['yes', 'no', 'unknown'] as readonly ChecklistAnswer[]).map((value) => <label key={value} data-selected={answer === value}><input type="radio" name={item.id} value={value} checked={answer === value} disabled={busy} onChange={async () => { (await dispatch({ type: 'answer_checklist', checklistItemId: item.id, answer: value, position: index })); }} /><span>{t(`check.${value}`)}</span></label>)}</fieldset>
    {concern && answer === 'yes' && hasScope(state, person.id, 'confirm') ? <div className="confirm-box"><p>{t('check.confirmHelp')}</p>{confirmed ? <p className="confirmed-tag">{t('check.confirmed')}</p> : null}<button className={confirmed ? 'secondary' : ''} disabled={busy || !canConfirmConcern(scenario, state, concern.id)} onClick={async () => (await dispatch({ type: confirmed ? 'unconfirm_concern' : 'confirm_concern', concernId: concern.id }))}>{t(confirmed ? 'check.unconfirm' : 'check.confirm')}</button></div> : null}
    <div className="button-row question-navigation">{index > 0 ? <button className="secondary previous-question" aria-label={t('routing.previousQuestion')} disabled={busy} onClick={() => move(-1)}><Icon name="back" /></button> : null}<button className={needsConfirmation ? 'secondary' : ''} disabled={busy} onClick={() => move(1)}>{t(index === scenario.checklist.length - 1 ? 'check.seePlan' : 'check.next')}</button></div>
    {answer === 'unanswered' ? <p className="answer-status">{t('check.unanswered')}</p> : null}{state.checklistAttribution[item.id] ? <p className="muted">{t('person.by', { name: personLabel(state.people, state.checklistAttribution[item.id]!.actorId, t) })}</p> : null}
    <p className="save-status sr-only">{t(saved ? 'check.saved' : 'check.unsaved')}</p>
    {suggestion ? <div className="ai-review"><a href="#/r/scan" onClick={(e) => { e.preventDefault(); navigate({ role: 'r', screen: 'scan' }); }}>{t('check.ai')}</a><p>{catalogText(t, 'photo', item.id, 'question')} {language === 'es' ? t('check.originalQuestion') : null}</p><p className="muted">{catalogText(t, 'photo', item.id, 'limitation')}</p></div> : null}

    </article>
    <details className="card"><summary>{t('check.photosDetails')}</summary><p>{progressText(t, checklistAnswerCounts(scenario.checklist, state))}</p><PhotoInputActions busy={busy} onPhoto={(file) => void upload(file)} /><p className="muted">{t('check.photoHelp')}</p><p className="muted">{t('data.photoControl')}</p>{state.removedPhotoHistoryTruncated ? <p className="muted">{t('data.photoHistoryTruncated')}</p> : null}{busy ? <p role="status">{t('check.photoBusy')}</p> : null}<div className="photo-grid">{household.photos?.filter((p) => p.checklistItemId === item.id).map((photo) => <figure key={photo.id}><PhotoImage photo={photo} /><figcaption>{t('person.by', { name: personLabel(state.people, photo.addedBy, t) })}</figcaption>{(person.id === state.household.residentId || photo.addedBy === person.id) ? <button className="secondary" disabled={busy} onClick={() => { setBusy(true); void removePhoto({ id: photo.id, store: getPhotoStore(), dispatch, isCurrent: () => alive.current, metadataExists: () => photoStillRecorded(photo.id) }).catch((error) => { if (alive.current) onPhotoError(operationFailure(error, 'storage_unavailable')); }).finally(() => setBusy(false)); }}>{t('check.removePhoto')}</button> : null}</figure>)}</div></details>

  </div>;
}
export function ResidentPlan(props: ResidentProps) {
  const { scenario, state, person, household, dispatch, navigate } = props;
  const t = useT(), groups = groupPlanByEffort(household.plan ?? []), [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = household.plan?.find(({ referenceAction }) => referenceAction.id === selectedId)?.referenceAction;
  const pending = hasScope(state, person.id, 'confirm') && hasScope(state, person.id, 'checklist') ? scenario.concerns.filter((concern) => !household.confirmations?.[concern.id]?.humanConfirmed && canConfirmConcern(scenario, state, concern.id)) : [];
  const inProgress = household.requests?.filter((view) => view.kind === 'household' && view.active && ['scheduled', 'in_progress'].includes(view.request.status)).length ?? 0;
  return <div className="stack"><p className="muted">{t('plan.summary', { count: household.plan?.length ?? 0, active: inProgress })}</p>
    {hasScope(state, person.id, 'confirm') && !hasScope(state, person.id, 'checklist') ? <p className="notice">{t('data.confirmEvidence')}</p> : null}
    {pending.length ? <section className="stack"><h2>{t('plan.toConfirm')}</h2><p className="footnote">{t('check.confirmHelp')}</p>{pending.map((concern) => <article className="card" key={concern.id}><h3>{catalogText(t, 'action', concern.referenceActionId, 'title')}</h3><button className="secondary full" onClick={async () => await dispatch({ type: 'confirm_concern', concernId: concern.id })}>{t('check.confirm')}</button></article>)}</section> : null}
    {!household.plan?.length ? <EmptyState icon="check" title={t('plan.emptyTitle')} body={t('plan.empty')} {...(household.canViewScan ? { action: t('home.scan'), onAction: () => navigate({ role: 'r', screen: 'check' }) } : {})} /> : null}
    {groups.filter((group) => group.items.length).map((group) => <ListGroup key={group.effort} title={t(`effort.${group.effort}`)}>{group.items.map(({ referenceAction: action }) => {
      const roomNames = [...new Set(scenario.checklist.filter((item) => item.referenceActionId === action.id).map((item) => catalogText(t, 'room', item.roomId)))].join(', ');
      const request = household.requests?.find((view) => view.kind === 'household' && view.active && view.request.referenceActionId === action.id);
      return <ListRow key={action.id} title={catalogText(t, 'action', action.id, 'title')} subtitle={roomNames} icon={group.effort === 'professional' ? 'shield' : group.effort === 'helper_task' ? 'people' : 'check'} trailing={<StatusPill tone={request ? 'green' : 'amber'}>{request?.kind === 'household' ? t(`status.${request.request.status}`) : t('check.confirmed')}</StatusPill>} onClick={() => setSelectedId(action.id)} />;
    })}</ListGroup>)}
    <p className="footnote">{t('plan.intro')}</p>
    {selected ? <Sheet title={catalogText(t, 'action', selected.id, 'title')} onClose={() => setSelectedId(null)}><p>{catalogText(t, 'action', selected.id, 'nextStep')}</p><p className="footnote">{t(`plan.who.${selected.effort}`)} {t('plan.cost')}</p><a className="source-link" href={selected.guidance.url}>{t('plan.source')}</a><div className="photo-grid">{household.photos?.filter((photo) => scenario.checklist.find((item) => item.id === photo.checklistItemId)?.referenceActionId === selected.id).map((photo) => <PhotoImage key={photo.id} photo={photo} />)}</div><PlanRequestButton {...props} action={selected} />{hasScope(state, person.id, 'confirm') && hasScope(state, person.id, 'checklist') ? scenario.concerns.filter((concern) => concern.referenceActionId === selected.id).map((concern) => <button key={concern.id} className="secondary full" onClick={async () => { if ((await dispatch({ type: 'unconfirm_concern', concernId: concern.id })).ok) setSelectedId(null); }}>{t('check.unconfirm')}</button>) : null}<button className="plain full" onClick={() => setSelectedId(null)}>{t('common.close')}</button></Sheet> : null}
  </div>;
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
