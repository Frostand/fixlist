import { useState } from 'react';
import type { Person, VolunteerRequestView } from '../domain/roles';
import type { VolunteerNextStep } from '../domain/role-views';
import { useT } from '../i18n';
import { projectedCatalogText } from '../i18n/catalog';
import { PhotoImage } from './Photos';
import { ListGroup, ListRow, StatusPill, EmptyState } from './UI';
import { Icon, type Navigate } from './PhoneShell';
import type { Dispatch } from './ui-controller';
export type PublicPerson = Pick<Person, 'id' | 'name'>;
const nameOf = (people: readonly PublicPerson[], id: string) => people.find((p) => p.id === id)?.name ?? id;
export function BoundariesCard() { const t = useT(); return <aside className="card boundaries"><h2>{t('request.boundaries')}</h2><p>{t('request.boundariesBody')}</p></aside>; }
/** The entire volunteer tree accepts projections and public names, never DemoState or a household view. */
export function VolunteerHome({ requests, next, navigate }: { requests: readonly VolunteerRequestView[]; next: VolunteerNextStep | null; navigate: Navigate }) {
  const t = useT();
  return <div className="stack"><section className="card next-card"><p className="eyebrow">{t('home.next')}</p><h2>{t(`next.${next?.kind ?? 'done'}`)}</h2><button className="secondary full" onClick={() => navigate(next && 'requestId' in next ? { role: 'v', screen: 'task', id: next.requestId } : { role: 'v', screen: 'tasks' })}>{t('nav.continue')}<Icon name="arrow" /></button></section><VolunteerTasks requests={requests} navigate={navigate} /><BoundariesCard /></div>;
}
export function VolunteerTasks({ requests, navigate }: { requests: readonly VolunteerRequestView[]; navigate: Navigate }) {
  const t = useT();
  return <div className="stack">{!requests.length ? <EmptyState icon="requests" title={t('volunteer.emptyTitle')} body={t('volunteer.noTasks')} /> : null}{(['invited', 'tasks'] as const).filter((group) => requests.some((request) => group === 'invited' ? request.status === 'invited' : request.status !== 'invited')).map((group) => <ListGroup key={group} title={t(group === 'invited' ? 'volunteer.invitations' : 'volunteer.myTasks')}>{requests.filter((request) => group === 'invited' ? request.status === 'invited' : request.status !== 'invited').map((request) => <ListRow key={request.id} title={projectedCatalogText(t, request.title)} trailing={<StatusPill>{t(`status.${request.status}`)}</StatusPill>} route={{ role: 'v', screen: 'task', id: request.id }} navigate={navigate} />)}</ListGroup>)}</div>;
}
export function VolunteerTask({ request, people, scanImage, dispatch }: { request: VolunteerRequestView; people: readonly PublicPerson[]; scanImage?: string | null; dispatch: Dispatch }) {
  const t = useT(), [reason, setReason] = useState(''), [time, setTime] = useState(''), [update, setUpdate] = useState('');
  const run = async (type: 'accept_invitation' | 'report_done' | 'withdraw') => (await dispatch({ type, requestId: request.id, expectedRevision: request.revision }));
  return <div className="stack"><article className="card"><p className="status-pill">{t(`status.${request.status}`)}</p><h2>{projectedCatalogText(t, request.title)}</h2><p>{projectedCatalogText(t, request.nextStep)}</p>
    {request.roomName !== undefined ? <p><strong>{t('sharing.roomName')}</strong>: {projectedCatalogText(t, request.roomName)}</p> : null}
    {request.visitTimes !== undefined ? <div><strong>{t('sharing.visitTimes')}</strong><p>{request.visitTimes}</p><p className="muted">{t('person.written', { name: 'Margaret' })}</p></div> : null}
    {request.areaLabel !== undefined ? <div><strong>{t('sharing.areaLabel')}</strong><p>{request.areaLabel}</p><p className="muted">{t('person.written', { name: 'Margaret' })}</p></div> : null}
    {request.photos !== undefined ? <div className="photo-grid">{request.photos.map((photo) => <figure key={photo.id}><PhotoImage photo={photo} /><figcaption>{t('person.by', { name: nameOf(people, photo.addedBy) })}</figcaption></figure>)}</div> : null}
    {request.scanLocation !== undefined && scanImage ? <figure><img src={scanImage} alt={t('sharing.scanLocation')} className="household-photo" /></figure> : null}
    {!['roomName', 'photos', 'scanLocation', 'visitTimes', 'areaLabel'].some((field) => Object.hasOwn(request, field)) ? <p className="muted">{t('request.noShared')}</p> : null}
  </article>
  {request.status === 'invited' ? <section className="card stack"><button onClick={() => run('accept_invitation')}>{t('request.accept')}</button><label>{t('request.reason')}<textarea maxLength={280} value={reason} onChange={(e) => setReason(e.target.value.replace(/[\r\n]/g, ' '))} /></label><button className="secondary" onClick={async () => (await dispatch({ type: 'decline_invitation', requestId: request.id, expectedRevision: request.revision, reason: reason.trim() }))}>{t('request.decline')}</button></section> : null}
  {request.proposedTime ? <section className="card"><h2>{t(request.agreedTime ? 'request.agreed' : 'request.proposed')}</h2><p>{request.proposedTime.text}</p><p className="muted">{t('person.written', { name: nameOf(people, request.proposedTime.actorId) })}</p>{request.agreedTime ? <p>{t('request.agreedBy', { name: nameOf(people, request.agreedTime.actorId) })}</p> : null}</section> : null}
  {request.status === 'accepted' ? <form className="card stack" onSubmit={async (e) => { e.preventDefault(); if ((await dispatch({ type: 'propose_time', requestId: request.id, expectedRevision: request.revision, text: time.trim() })).ok) setTime(''); }}><label>{t('request.time')}<input value={time} maxLength={280} required onChange={(e) => setTime(e.target.value)} /></label><button disabled={!time.trim()}>{t('request.propose')}</button></form> : null}
  {['scheduled', 'in_progress'].includes(request.status) ? <form className="card stack" onSubmit={async (e) => { e.preventDefault(); if ((await dispatch({ type: 'post_update', requestId: request.id, expectedRevision: request.revision, text: update.trim() })).ok) setUpdate(''); }}><label>{t('request.updateText')}<textarea value={update} maxLength={280} required onChange={(e) => setUpdate(e.target.value.replace(/[\r\n]/g, ' '))} /></label><p className="muted">{update.length}/280</p><button disabled={!update.trim()}>{t('request.update')}</button></form> : null}
  {request.updates.length ? <section className="card"><h2>{t('home.updates')}</h2>{request.updates.map((u, i) => <blockquote key={i}><p>{u.text}</p><footer>{t('person.written', { name: nameOf(people, u.actorId) })}</footer></blockquote>)}</section> : null}
  {request.status === 'in_progress' ? <button onClick={() => run('report_done')}>{t('request.reportDone')}</button> : null}
  <p className="muted">{t('request.verification')}</p><BoundariesCard />{request.status !== 'resident_confirmed_done' ? <button className="secondary danger" onClick={() => run('withdraw')}>{t('request.withdraw')}</button> : null}</div>;
}
