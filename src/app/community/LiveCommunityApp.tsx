import { useEffect, useMemo, useState } from 'react';
import type { AccountProfile } from '../../auth/types';
import type { AsyncLiveCommunityPort, LiveDiscoveryJob } from '../../community/ports';
import { I18nProvider, LANGUAGES, useT } from '../../i18n';
import { Button, skillLabel } from './UI';
import { LiveCommunityController, type LiveRetryScope, type Resource } from './live-controller';
import { creditNotice, liveError, liveStatus, scopeNotice, liveCopy as l } from './live-copy';
import { LiveRequestDraft } from './LiveRequestDraft';
import { LiveJobDetails } from './LiveJobDetails';
import './live-community.css';

export interface LiveCommunityProps { port: AsyncLiveCommunityPort; profile: AccountProfile; retryScope?: LiveRetryScope | undefined; onSignOut(): void; onRecheckSession(): void }
/** Also usable by an isolated test/story entry with an injected port; no production bypass. */
export function LiveCommunityApp(props: LiveCommunityProps) {
    const namespace = JSON.stringify([props.port.identity.backendId, props.port.identity.userId]);
    if (props.profile.userId !== props.port.identity.userId) return <p role="alert">{l.profileMismatch}</p>;
    return <I18nProvider language={props.profile.language}><LiveWorkspace key={namespace} {...props}/></I18nProvider>;
}
function ReadState<T>({ resource: r, empty = false }: { resource: Resource<T>; empty?: boolean }) {
    return <>{r.loading ? <p role="status">{l.loading}</p> : null}{r.error ? <p role="alert">{liveError[r.error]}</p> : null}{r.value && empty ? <p>{l.empty}</p> : null}</>;
}
function Catalog({ job }: { job: LiveDiscoveryJob }) {
    const t = useT();
    // Deliberately project only the discovery allowlist, even with an injected port.
    return <><h3>{job.catalogTitle}</h3><p>{job.category} · <bdi>{job.coarseArea}</bdi></p><p lang={t.language} dir="auto">{job.neededSkills.map(s => skillLabel(t, s)).join(', ')}</p><p>{l.creditLabel} {job.approvedServiceCreditMinutes === null ? l.creditUnset : `${job.approvedServiceCreditMinutes} minutes`}</p></>;
}
export function LiveWorkspace({ port, profile, retryScope, onSignOut, onRecheckSession }: LiveCommunityProps) {
    const c = useMemo(() => new LiveCommunityController(port, retryScope), [port, retryScope]);
    const [view, setView] = useState({ controller: c, state: c.state });
    const state = view.controller === c ? view.state : c.state;
    useEffect(() => { const off = c.subscribe(() => setView({ controller: c, state: c.state })); void c.start(); return () => { off(); c.dispose(); }; }, [c]);
    const access = state.access.value, approved = access?.state === 'approved', locked = !!state.pending;
    const direction = LANGUAGES.find(l => l.code === profile.language)!.dir;
    return <section className="fl-live c-stack" lang="en" dir={direction} aria-label={l.realAccount}>
        <header className="c-heading"><h1>{l.welcome} <bdi>{profile.name}</bdi></h1></header>
        <p className="c-small">{l.languageLimit}</p>
        <details className="c-small"><summary>{l.about}</summary><p>{scopeNotice}</p><p>{l.leaveNotice}</p></details>
        <div className="fl-live-actions"><Button kind="secondary" disabled={state.access.loading || !!state.pending?.running} onClick={() => { void c.refresh(); }}>{l.refreshCommunity}</Button><Button kind="quiet" onClick={onSignOut}>{l.signOut}</Button></div>
        <ReadState resource={state.access}/>
        {!approved && !state.access.loading ? <section className="fl-live-card c-stack" aria-label={l.access}><h2>{access?.state === 'pending' ? l.pending : access?.state === 'revoked' ? l.revoked : l.unavailable}</h2><p>{l.noApproval}</p>{state.access.error === 'session_changed' ? <Button onClick={onRecheckSession}>{l.recheckSession}</Button> : null}</section> : null}
        {state.notice ? <p role="status">{state.notice}</p> : null}
        {state.pending ? <section className="fl-live-card c-stack" aria-label={l.receipt}><h2>{state.pending.running ? l.waiting : l.unconfirmed}</h2>{state.pending.error ? <p role="alert">{liveError[state.pending.error]}</p> : null}<p>{l.action} {state.pending.command.kind}{l.lockedInput}</p>{!state.pending.running ? <><p>{l.uncertain}</p><Button disabled={!approved} onClick={() => { void c.retry(); }}>{l.retryAction}</Button><Button kind="secondary" onClick={() => c.discardRetry()}>{l.discard}</Button><p className="c-small">{l.discardNotice}</p></> : <p role="status">{l.wait}</p>}</section> : null}
        {approved ? <>
            <p><bdi>{access.community?.label}</bdi> · <bdi>{access.community?.coarseArea}</bdi> · {l.approvedRole} {access.role}</p>
            {access.role !== profile.role ? <p role="status">{l.mismatchBefore} {access.role}{l.mismatchAfter}</p> : null}
            {access.role === 'elder' ? <LiveRequestDraft controller={c} language={profile.language} locked={locked}/> : null}
            {access.role === 'volunteer' ? <section className="c-stack" aria-label={l.discover}><h2>{l.requests}</h2><p className="c-small">{l.discoveryNotice}</p><Button kind="secondary" disabled={state.discovery.loading} onClick={() => { void c.loadList('discovery'); }}>{l.refreshDiscovery}</Button><ReadState resource={state.discovery} empty={!state.discovery.value?.items.length}/><ul className="fl-live-list">{state.discovery.value?.items.map(job => <li key={job.id} className="fl-live-card"><Catalog job={job}/><Button disabled={locked} onClick={() => { void c.execute({ kind: 'accept', jobId: job.id }); }}>{l.accept}</Button></li>)}</ul>{state.discovery.value?.nextCursor ? <Button kind="secondary" disabled={state.discovery.loading} onClick={() => { void c.loadList('discovery', true); }}>{l.moreRequests}</Button> : null}</section> : null}
            <section className="c-stack" aria-label={l.jobs}><h2>{access.role === 'elder' ? l.ownRequests : l.assigned}</h2><Button kind="secondary" disabled={state.jobs.loading} onClick={() => { void c.loadList('jobs'); }}>{l.refreshJobs}</Button><ReadState resource={state.jobs} empty={!state.jobs.value?.items.length}/><ul className="fl-live-list">{state.jobs.value?.items.map(job => <li key={job.id} className="fl-live-card"><Catalog job={job}/><p>{liveStatus[job.status]}</p><Button kind="secondary" aria-label={`Open ${job.catalogTitle} — ${liveStatus[job.status]}`} onClick={() => { void c.select(job.id); }}>{l.viewDetails}</Button></li>)}</ul>{state.jobs.value?.nextCursor ? <Button kind="secondary" disabled={state.jobs.loading} onClick={() => { void c.loadList('jobs', true); }}>{l.moreJobs}</Button> : null}</section>
            {state.selectedId ? <section className="c-stack" aria-label={l.selected}><Button kind="quiet" onClick={() => c.closeDetails()}>{l.closeDetails}</Button><Button kind="secondary" disabled={state.details.loading} onClick={() => { if (state.selectedId) void c.select(state.selectedId); }}>{l.refreshDetails}</Button><ReadState resource={state.details}/>{state.details.value ? <LiveJobDetails key={state.details.value.job.id} details={state.details.value} state={state} controller={c} language={profile.language}/> : null}</section> : null}
            {access.role === 'volunteer' ? <section className="c-stack" aria-label={l.credit}><h2>{l.credit}</h2><p>{creditNotice}</p><Button kind="secondary" disabled={state.credits.loading} onClick={() => { void c.loadList('credits'); }}>{l.creditRefresh}</Button><ReadState resource={state.credits} empty={!state.credits.value?.items.length}/><ul className="fl-live-list">{state.credits.value?.items.map(row => <li className="fl-live-card" key={row.jobId}><p>{row.approvedServiceCreditMinutes} {l.approvedMinutes}</p><p>{l.confirmed} <time dateTime={row.confirmedAt}>{new Date(row.confirmedAt).toLocaleString(profile.language)}</time></p><Button kind="secondary" onClick={() => { void c.select(row.jobId); }}>{l.viewCredit}</Button></li>)}</ul>{state.credits.value?.nextCursor ? <Button kind="secondary" disabled={state.credits.loading} onClick={() => { void c.loadList('credits', true); }}>{l.moreCredit}</Button> : null}</section> : null}
        </> : null}
    </section>;
}
