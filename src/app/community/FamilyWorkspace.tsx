import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import * as domain from '../../community';
import { canManageElder, familyGrant, familyScopeFailure, updateElderInformation } from '../../community/family';
import type { Account, CommunityState, ElderProfileEdit, Job } from '../../community/types';
import { useFamilyCopy } from '../../i18n/family';
import { localeFor, useLanguage, useT } from '../../i18n';
import { AskScreen, ProgressTracker, RequestList, type Draft } from './Elder';
import { DraftScreen } from './DraftScreen';
import { JobCard } from './JobCard';
import { Messages } from './Messages';
import { Availability, Button, Heading } from './UI';
import type { CommunityController } from './useCommunity';
import type { CommunityRoute } from './CommunityApp';
const RoomCapture = lazy(() => import('./RoomCapture').then(m => ({ default: m.RoomCapture })));
interface Selection { elderId: string; revision: number; serial: number; session: CommunityState['session']; resetEpoch: string }

/** One selected beneficiary and one operation scope across every private local family route. */
export function FamilyWorkspace({ controller: c, account, route, onNavigate }: {
  controller: CommunityController; account: Account; route: CommunityRoute; onNavigate(path: string): void;
}) {
  const t = useT(), f = useFamilyCopy(), language = useLanguage(), renderedState = c.state;
  const [selection, setSelection] = useState<Selection | null>(null), [draft, setDraft] = useState<{ scope: Selection; value: Draft } | null>(null);
  const latest = useRef({ state: c.state, resetEpoch: c.resetEpoch, selection }), alive = useRef(true), serial = useRef(0);
  latest.current = { state: c.state, resetEpoch: c.resetEpoch, selection };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = (state?: CommunityState) => {
    const observed = c.readScope?.() ?? latest.current;
    const s = state ?? observed.state;
    return !!selection && alive.current && latest.current.selection === selection
      && observed.resetEpoch === selection.resetEpoch && s.session === selection.session
      && canManageElder(s, account.id, selection.elderId, 'requests', selection.revision);
  };
  const selected = current(c.state) ? selection : null;
  const elder = selected ? c.state.accounts.find(a => a.id === selected.elderId && a.role === 'elder') : undefined;
  const key = JSON.stringify([account.id, selected?.elderId, c.resetEpoch, selected?.revision, selected?.serial]);
  const choices = c.state.accounts.filter(a => a.role === 'elder' && canManageElder(c.state, account.id, a.id));
  function choose(elderId: string) {
    const observed = c.readScope?.() ?? latest.current;
    const grant = familyGrant(observed.state, account.id, elderId);
    if (!alive.current || latest.current.selection !== selection || observed.state.session !== renderedState.session
      || grant?.revision !== familyGrant(renderedState, account.id, elderId)?.revision) return;
    const next: Selection | null = grant && observed.state.session.accountId === account.id && observed.resetEpoch
      ? { elderId, revision: grant.revision, serial: ++serial.current, session: observed.state.session, resetEpoch: observed.resetEpoch } : null;
    latest.current.selection = next;
    setSelection(next); setDraft(null); onNavigate('home');
  }
  const run: CommunityController['run'] = command => {
    if (!current()) return familyScopeFailure();
    const result = c.run(s => current(s) ? command(s) : familyScopeFailure());
    if (result.ok) latest.current.state = result.state;
    return result;
  };
  function navigate(path: string) { if (current()) onNavigate(path); }
  function receiveDraft(value: Draft) { if (current() && selection) { setDraft({ scope: selection, value }); onNavigate('draft'); } }
  const jobs = elder ? domain.jobsForElder(c.state, elder.id) : [];
  function post(value: Draft, preferredSlots: readonly import('../../community/types').AvailabilitySlot[], analysis: import('../../community/types').JobAnalysis) {
    if (!elder || !selected) return false;
    const result = run(s => domain.postJob(s, { actorId: account.id, elderId: elder.id, familyRevision: selected.revision,
      source: value.source, originalText: value.text, analysis, evidence: value.evidence, preferredSlots }, new Date().toISOString()));
    if (result.ok) { setDraft(null); onNavigate('help'); }
    return result.ok;
  }
  let content: ReactNode = null;
  if (elder && selected) {
    if (route.screen === 'home') content = <>
      <div className="c-home-tiles"><button onClick={() => navigate('rooms')}><strong>{t('c.home.scan')}</strong><span>{t('c.home.scanHint')}</span></button><button onClick={() => navigate('type')}><strong>{t('c.home.type')}</strong><span>{t('c.home.typeHint')}</span></button></div>
      <Button icon="mic" kind="secondary" onClick={() => navigate('talk')}>{t('c.home.talk')}</Button>
      <section><h2>{t('c.home.quick')}</h2><div className="c-chips">{domain.QUICK_PICK_IDS.slice(0, 6).map(id => { const analysis = domain.quickPickAnalysis(id, language); return <button className="c-chip" key={id} onClick={() => receiveDraft({ analysis, source: 'quick-pick', text: analysis.title, evidence: [] })}>{analysis.title}</button>; })}</div></section>
      <section><h2>{f('upcoming')}</h2><RequestList state={c.state} jobs={jobs.filter(j => ['accepted', 'on-the-way', 'arrived', 'reported-done'].includes(j.status))} onOpen={id => navigate(`job/${id}`)}/></section>
      <Button kind="secondary" onClick={() => navigate('help')}>{t('c.myHelp')}</Button>
    </>;
    else if (route.screen === 'help') content = <><Heading>{t('c.myHelp')}</Heading><RequestList state={c.state} jobs={jobs} onOpen={id => navigate(`job/${id}`)}/></>;
    else if (route.screen === 'family-messages') content = <><Heading>{t('c.messages')}</Heading><RequestList state={c.state} jobs={jobs.filter(j => j.volunteerId !== null)} onOpen={id => navigate(`messages/${id}`)}/></>;
    else if (route.screen === 'family-information') {
      content = canManageElder(c.state, account.id, elder.id, 'profile', selected.revision)
        ? <FamilyInformationEditor key={key} state={c.state} elder={elder} isCurrent={() => current()} onSave={profile => run(s => updateElderInformation(s, { actorId: account.id, elderId: elder.id, revision: selected.revision, profile })).ok}/>
        : <p>{f('editApproval', { elder: elder.firstName })}</p>;
    }
    else if (route.screen === 'rooms') content = canManageElder(c.state, account.id, elder.id, 'capture', selected.revision)
      ? <Suspense fallback={<p role="status">{t('c.loading')}</p>}><RoomCapture key={key} ownerId={elder.id} resetEpoch={selected.resetEpoch} isCurrent={() => current()} onDraft={(analysis, evidence) => receiveDraft({ analysis, source: 'scan', text: evidence.label, evidence: [evidence] })} onType={() => navigate('type')}/></Suspense> : null;
    else if (route.screen === 'talk' || route.screen === 'type') content = <AskScreen key={`${key}-${route.screen}`} account={account} talk={route.screen === 'talk'} isCurrent={() => current()} onDraft={receiveDraft} onPost={post}/>;
    else if (route.screen === 'draft' && draft?.scope === selected) content = <DraftScreen key={key} draft={draft.value} isCurrent={() => current()} onChange={value => { if (current()) setDraft({ scope: selected, value }); }} onPost={(slots, analysis) => post(draft.value, slots, analysis)}/>;
    else if (['job', 'messages', 'confirm'].includes(route.screen)) {
      const view = domain.visibleJob(c.state, route.id, account.id);
      if (view && view.elder.id === elder.id) {
        const job = view.job;
        content = route.screen === 'messages' && canManageElder(c.state, account.id, elder.id, 'messages', selected.revision)
          ? <Messages key={`${key}-${job.id}`} state={c.state} account={account} job={job} isCurrent={() => current()} familyRevision={selected.revision} run={run}/>
          : <FamilyJobDetail key={`${key}-${job.id}`} state={c.state} job={job} elder={elder} onMessages={() => navigate(`messages/${job.id}`)} onCancel={() => run(s => domain.cancelJob(s, { jobId: job.id, actorId: account.id, familyRevision: selected.revision }, new Date().toISOString())).ok}/>;
      }
    }
    if (!content) content = <p>{t('c.notFound')}</p>;
  }
  return <div className="c-stack c-family-workspace" lang={f.language} dir={f.dir}>
    <div className="c-family-scope">
      {elder ? <h1 tabIndex={-1} data-screen-heading>{f('helping', { actor: account.firstName, elder: elder.firstName })}</h1> : <p className="c-small">{f('localDemo')}</p>}
      <label className="c-field">{f('whoHelping')}<select value={selected?.elderId ?? ''} onChange={event => choose(event.target.value)}><option value="">{f('chooseElder')}</option>{choices.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {elder ? <>
        <nav className="c-family-nav" aria-label={f('workspace')}><Button kind="quiet" onClick={() => navigate('family-information')}>{f('manage')}</Button><Button kind="quiet" onClick={() => navigate('family-messages')}>{t('c.messages')}</Button></nav>
        <details><summary>{f('permissions')}</summary><p>{f('onBehalf', { actor: account.firstName, elder: elder.firstName })}</p><p className="c-small">{f('localDemo')}</p></details>
      </> : <p role="status">{f(choices.length ? 'noSelection' : 'noPermission')}</p>}
    </div>
    <div key={key} className="c-stack">{content}</div>
  </div>;
}
export function FamilyInformationEditor({ state, elder, isCurrent, onSave }: {
  state: CommunityState; elder: Account; isCurrent(): boolean; onSave(profile: ElderProfileEdit): boolean;
}) {
  const f = useFamilyCopy();
  const p = state.elders.find(e => e.accountId === elder.id)!;
  const [value, setValue] = useState<ElderProfileEdit>(() => ({ name: elder.name, area: elder.area, needs: [...p.needs], addressHint: p.addressHint,
    visitInstructions: p.visitInstructions ?? '', preferences: p.preferences ?? { contact: 'ask-first', visitTimes: [], notes: '' } }));
  const [needs, setNeeds] = useState(p.needs.join('\n')), [result, setResult] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = () => alive.current && isCurrent();
  function field(key: 'name' | 'area' | 'addressHint' | 'visitInstructions', text: string) { if (current()) { setValue(v => ({ ...v, [key]: text })); setResult(''); } }
  return <form lang={f.language} dir={f.dir} className="c-stack" onSubmit={event => { event.preventDefault(); if (!current()) return; const saved = onSave({ ...value, needs: needs.split('\n').map(n => n.trim()).filter(Boolean) }); setResult(f(saved ? 'informationSaved' : 'informationFailed')); }}>
    <Heading intro={f('informationIntro')}>{f('informationTitle', { elder: elder.firstName })}</Heading>
    <label className="c-field">{f('name')}<input required maxLength={120} value={value.name} onChange={e => field('name', e.target.value)}/></label>
    <label className="c-field">{f('area')}<input required maxLength={160} value={value.area} onChange={e => field('area', e.target.value)}/></label>
    <label className="c-field">{f('needs')}<textarea maxLength={6000} value={needs} onChange={e => { if (current()) setNeeds(e.target.value); }}/></label>
    <label className="c-field">{f('address')}<input maxLength={240} value={value.addressHint} onChange={e => field('addressHint', e.target.value)}/></label>
    <label className="c-field">{f('instructions')}<textarea maxLength={1000} value={value.visitInstructions} onChange={e => field('visitInstructions', e.target.value)}/></label>
    <label className="c-field">{f('contact')}<select value={value.preferences.contact} onChange={e => { if (current()) setValue(v => ({ ...v, preferences: { ...v.preferences, contact: e.target.value as 'messages' | 'ask-first' } })); }}><option value="ask-first">{f('askFirst')}</option><option value="messages">{f('useMessages')}</option></select></label>
    <Availability value={value.preferences.visitTimes} onChange={visitTimes => { if (current()) setValue(v => ({ ...v, preferences: { ...v.preferences, visitTimes } })); }}/>
    <label className="c-field">{f('notes')}<textarea maxLength={1000} value={value.preferences.notes} onChange={e => { if (current()) setValue(v => ({ ...v, preferences: { ...v.preferences, notes: e.target.value } })); }}/></label>
    <Button type="submit">{f('save')}</Button>{result ? <p role="status">{result}</p> : null}
  </form>;
}
function FamilyJobDetail({ state, job, elder, onMessages, onCancel }: { state: CommunityState; job: Job; elder: Account; onMessages(): void; onCancel(): boolean }) {
  const t = useT(), f = useFamilyCopy(), language = useLanguage(), [confirmCancel, setConfirmCancel] = useState(false);
  const volunteer = state.accounts.find(a => a.id === job.volunteerId), actor = state.accounts.find(a => a.id === job.createdById);
  const date = (at: string) => new Intl.DateTimeFormat(localeFor(language), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));
  return <div className="c-stack"><Heading>{t('c.job.details')}</Heading><p>{f('postedBy', { elder: elder.firstName, actor: actor?.firstName })}</p><ProgressTracker status={job.status}/><JobCard analysis={job.analysis} evidence={job.evidence} slots={job.preferredSlots}/>
    {volunteer ? <p>{t('c.volunteer.assigned', { name: volunteer.firstName })}</p> : null}{job.scheduledFor ? <p>{f('scheduled', { date: date(job.scheduledFor) })}</p> : null}
    {job.status === 'reported-done' ? <p className="c-notice">{f('awaiting', { elder: elder.firstName })}</p> : null}
    <section><h2>{f('history')}</h2><ol className="c-family-history">{job.timeline.map((event, index) => <li key={index}><strong>{state.accounts.find(a => a.id === event.actorId)?.firstName}</strong> · {event.type === 'posted' ? f('eventPosted') : event.type === 'confirmed' ? f('eventConfirmed') : event.type === 'rated' ? f('eventRated') : t(`c.status.${event.type}`)}<time dateTime={event.at}>{date(event.at)}</time>{event.note ? <p>{event.note}</p> : null}</li>)}</ol></section>
    {job.volunteerId ? <Button icon="message" onClick={onMessages}>{t('c.messages')}</Button> : null}
    {!['completed', 'cancelled'].includes(job.status) ? confirmCancel ? <div className="c-stack"><p>{t('c.job.cancelConfirm')}</p><Button onClick={() => { if (onCancel()) setConfirmCancel(false); }}>{t('c.job.cancel')}</Button><Button kind="quiet" onClick={() => setConfirmCancel(false)}>{t('c.job.keep')}</Button></div> : <Button kind="quiet" onClick={() => setConfirmCancel(true)}>{t('c.job.cancel')}</Button> : null}
  </div>;
}
