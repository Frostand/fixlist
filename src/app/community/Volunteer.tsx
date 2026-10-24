import { lazy, Suspense, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { matchesForVolunteer, nextSlotDate, serviceLog, volunteerStats } from '../../community';
import type { Account, AvailabilitySlot, CommunityState, Job, MatchResult, VolunteerProfile } from '../../community/types';
import { SKILLS, TOOLS } from '../../community/types';
import { localeFor, useLanguage, useT } from '../../i18n';
import { printCurrentPage } from '../../lib/native-print';
import { Avatar, Availability, Button, Chips, Heading, Icon, MatchChips, Sheet, skillLabel, toolLabel } from './UI';
import { JobCard, OriginalToggle, Requester } from './JobCard';
import { ProgressTracker } from './Elder';
const NearbyMap = lazy(() => import('./NearbyMap'));
export function NearbyList({ state, matches, onOpen, maxMiles = 10 }: {
    state: CommunityState;
    matches: readonly MatchResult[];
    maxMiles?: number;
    onOpen(id: string): void;
}) { const t = useT(); return <div className="c-nearby-list">{matches.length ? matches.map((match) => { const job = state.jobs.find((j) => j.id === match.jobId), elder = state.accounts.find((a) => a.id === job?.elderId); if (!job)
    return null; return <article className="c-match-card" key={job.id} data-score={match.score}><div className="c-request-top"><strong className="c-match-score">{t('c.nearby.match', { score: match.score })}</strong></div>{elder ? <Requester elder={elder} needs={state.elders.find(e => e.accountId === elder.id)?.needs ?? []} language={job.analysis.language}/> : null}<h2>{job.analysis.titleEnglish}</h2><p>{job.analysis.summaryEnglish}</p><MatchChips reasons={match.reasons} gaps={match.gaps} maxMiles={maxMiles}/><Button kind="secondary" icon="arrow" onClick={() => onOpen(job.id)}>{t('c.nearby.view')}</Button></article>; }) : <p className="c-empty">{t('c.nearby.empty')}</p>}</div>; }
export function Nearby({ state, account, onOpen }: {
    state: CommunityState;
    account: Account;
    onOpen(id: string): void;
}) {
    const t = useT(), [filter, setFilter] = useState<'all' | 'skills' | 'today' | 'distance'>('all');
    const profile = state.volunteers.find((v) => v.accountId === account.id);
    const matches = useMemo(() => matchesForVolunteer(state, account.id, new Date().toISOString()), [state, account.id]);
    const filtered = useMemo(() => matches.filter((m) => filter === 'all' || filter === 'skills' && !m.gaps.some((g) => g.kind === 'missing-skill') || filter === 'today' && (m.sharedSlots.some((s) => s.day === new Date().getDay()) || state.jobs.find((j) => j.id === m.jobId)?.analysis.urgency === 'today') || filter === 'distance' && m.distanceMiles <= (profile?.maxMiles ?? 10)), [matches, filter, profile?.maxMiles, state.jobs]);
    const pins = useMemo(() => filtered.flatMap((m) => { const job = state.jobs.find((j) => j.id === m.jobId), elder = state.accounts.find((a) => a.id === job?.elderId); return job && elder ? [{ id: job.id, point: elder.location, score: m.score, title: job.analysis.titleEnglish }] : []; }), [filtered, state]);
    return <div className="c-stack"><Heading intro={t('c.nearby.body')}>{t('c.nearby.title')}</Heading><Suspense fallback={<div className="c-map c-map-loading" role="status">{t('c.loading')}</div>}><NearbyMap pins={pins} center={account.location} onOpen={onOpen}/></Suspense><div className="c-chips c-filters">{(['all', 'skills', 'today', 'distance'] as const).map((f) => <button className="c-chip" aria-pressed={f === filter} onClick={() => setFilter(f)} key={f}>{t(`c.nearby.${f}`)}</button>)}</div><NearbyList state={state} matches={filtered} onOpen={onOpen} maxMiles={profile?.maxMiles ?? 10}/></div>;
}
export function VolunteerJob({ job, elder, address, needs = [], profile, match, onAccept, onStep, onMessages }: {
    job: Job;
    elder: Account;
    address: string | null;
    needs?: readonly string[];
    profile: VolunteerProfile;
    match: MatchResult | null;
    onAccept(date: string): boolean;
    onStep(step: 'trip' | 'arrive' | 'done', note?: string): boolean;
    onMessages(): void;
}) {
    const t = useT(), viewerLanguage = useLanguage(), [original, setOriginal] = useState(false), [accepting, setAccepting] = useState(false);
    const [chosen, setChosen] = useState<AvailabilitySlot | null>(null), [customDate, setCustomDate] = useState(''), [note, setNote] = useState('');
    const open = job.status === 'open';
    const slots = match?.sharedSlots.length ? match.sharedSlots : profile.availability;
    const destination = `${elder.location.lat},${elder.location.lng}`;
    const pins = useMemo(() => [{ id: job.id, point: elder.location, score: 100, title: t('c.map.destination') }], [job.id, elder.location.lat, elder.location.lng, t.language]);
    const details = <>{job.analysis.language !== viewerLanguage ? <OriginalToggle language={job.analysis.language} original={original} onChange={setOriginal}/> : null}<JobCard analysis={job.analysis} evidence={job.evidence} slots={job.preferredSlots} original={original}/></>;
    return <div className="c-stack">
        <Heading>{t(open ? 'c.job.details' : 'c.volunteer.helping', { name: elder.firstName })}</Heading>
        <Requester elder={elder} needs={needs} language={job.analysis.language}/>
        {open ? <>{details}<p className="c-small"><Icon name="shield"/>{t('c.job.addressHidden')}</p>
            <section className="c-tools-check"><h2>{t('c.accept.tools', { have: job.analysis.tools.filter(x => profile.tools.includes(x)).length, total: job.analysis.tools.length })}</h2>
                <ul>{job.analysis.tools.map(x => <li key={x}><Icon name={profile.tools.includes(x) ? 'check' : 'tools'}/><span>{toolLabel(t, x)}<small>{t(profile.tools.includes(x) ? 'c.accept.have' : 'c.accept.need')}</small></span></li>)}</ul></section>
            {match ? <section><h2>{t('c.match.title')} · {t('c.nearby.match', { score: match.score })}</h2><MatchChips reasons={match.reasons} gaps={match.gaps} maxMiles={profile.maxMiles}/></section> : null}
            <Button onClick={() => { setChosen(match?.sharedSlots.length === 1 ? match.sharedSlots[0]! : null); setAccepting(true); }}>{t('c.accept.action')}</Button>
        </> : <>
            <section className="c-stack c-trip-panel">
                <ProgressTracker status={job.status}/>
                {address ? <><section className="c-address"><h2>{t('c.active.address')}</h2><p>{address}</p><p className="c-small">{elder.area}</p></section>
                    <Suspense fallback={<p role="status">{t('c.loading')}</p>}><NearbyMap pins={pins} center={elder.location} mini/></Suspense>
                    <div className="c-directions"><Button kind="secondary" icon="pin" onClick={() => { window.location.href = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios' ? `maps://?daddr=${destination}` : `https://maps.apple.com/?daddr=${destination}`; }}>{t('c.active.directions')}</Button>
                        <a href={`https://www.google.com/maps/dir/?api=1&destination=${destination}`} target="_blank" rel="noreferrer">{t('c.active.google')}</a></div></> : <p>{t('c.job.addressMissing')}</p>}
                {job.status === 'accepted' ? <Button onClick={() => onStep('trip')}>{t('c.active.trip')}</Button>
                    : job.status === 'on-the-way' ? <Button onClick={() => onStep('arrive')}>{t('c.active.arrive')}</Button>
                    : job.status === 'arrived' ? <><label className="c-field">{t('c.active.note')}<textarea maxLength={1000} value={note} onChange={e => setNote(e.target.value)}/></label><Button onClick={() => onStep('done', note)}>{t('c.active.done')}</Button></>
                    : <p className="c-notice">{t(job.status === 'completed' ? 'c.active.complete' : job.status === 'cancelled' ? 'c.job.cancelled' : 'c.active.wait')}</p>}
                <Button kind="secondary" icon="message" onClick={onMessages}>{t('c.messages')}</Button>
            </section>
            <details className="c-job-disclosure"><summary>{t('c.job.disclosure')}</summary><div className="c-stack">{details}</div></details>
        </>}
        {accepting ? <Sheet title={t('c.accept.title')} onClose={() => setAccepting(false)}><div className="c-stack">{!match?.sharedSlots.length ? <p>{t('c.accept.noSlots')}</p> : null}
            <ScheduleChoices slots={slots} chosen={chosen} customDate={customDate} onChosen={setChosen} onCustomDate={setCustomDate} onAccept={date => { if (onAccept(date)) setAccepting(false); }}/>
        </div></Sheet> : null}
    </div>;
}
export function VolunteerEditor({ profile, onSave, onBack }: {
    profile: VolunteerProfile;
    onSave(p: VolunteerProfile): boolean;
    onBack(): void;
}) { const t = useT(), [value, setValue] = useState(profile); return <div className="c-stack"><Heading>{t('c.profile.edit')}</Heading><Chips title={t('c.setup.skills')} values={SKILLS} selected={value.skills} label={(s) => skillLabel(t, s)} onChange={(skills) => setValue({ ...value, skills })}/><Chips title={t('c.setup.tools')} values={TOOLS} selected={value.tools} label={(s) => toolLabel(t, s)} onChange={(tools) => setValue({ ...value, tools })}/><Availability value={value.availability} onChange={(availability) => setValue({ ...value, availability })}/><label className="c-field">{t('c.setup.distance')} · {t('c.setup.miles', { count: value.maxMiles })}<input type="range" min={1} max={50} value={value.maxMiles} onChange={(e) => setValue({ ...value, maxMiles: Number(e.target.value) })}/></label><label className="c-field">{t('c.setup.school')}<input value={value.school ?? ''} maxLength={120} onChange={(e) => setValue({ ...value, school: e.target.value })}/></label><Button onClick={() => { if (onSave(value))
    onBack(); }}>{t('c.save')}</Button></div>; }
export function VolunteerProfileScreen({ state, account, onEdit, onLog }: {
    state: CommunityState;
    account: Account;
    onEdit(): void;
    onLog(): void;
}) {
    const t = useT(), language = useLanguage();
    const stats = volunteerStats(state, account.id), profile = state.volunteers.find(v => v.accountId === account.id);
    const jobs = state.jobs.filter(j => j.volunteerId === account.id);
    const upcoming = jobs.filter(j => ['accepted', 'on-the-way', 'arrived'].includes(j.status))
        .sort((a, b) => (a.scheduledFor ?? a.createdAt).localeCompare(b.scheduledFor ?? b.createdAt))[0];
    const notes = jobs.filter(j => j.status === 'completed' && j.rating?.note?.trim())
        .sort((a, b) => b.rating!.at.localeCompare(a.rating!.at));
    function renderNote(job: Job) {
        const rating = job.rating!, elder = state.accounts.find(a => a.id === job.elderId);
        return <li key={job.id}><div className="c-request-top"><strong>{elder?.firstName}</strong><span role="img" aria-label={t('c.profile.stars', { rating: rating.stars })} className="c-rating-stars">{'★'.repeat(rating.stars)}{'☆'.repeat(5 - rating.stars)}</span></div><blockquote>{rating.note}</blockquote></li>;
    }
    return <div className="c-stack"><Heading>{t('c.profile.title')}</Heading>
        <div className="c-profile-identity"><Avatar name={account.name} tone={account.avatarTone}/><div><h2>{account.name}</h2>{profile?.school ? <p>{profile.school}</p> : null}</div></div>
        <dl className="c-stat-list"><div><dt>{t('c.profile.rating')}</dt><dd>{stats.rating !== null ? <><span aria-hidden="true">★ </span>{stats.rating.toFixed(1)}</> : '—'}</dd></div><div><dt>{t('c.profile.jobs')}</dt><dd>{stats.jobsDone}</dd></div><div><dt>{t('c.profile.hours')}</dt><dd>{stats.hours.toFixed(1)}</dd></div></dl>
        {stats.jobsDone > 0 ? <p className="c-badge"><Icon name="leaf"/>{t('c.profile.badge')}</p> : null}
        {profile ? <><section><h2>{t('c.job.skills')}</h2><ul className="c-tags">{profile.skills.map(skill => <li key={skill}>{skillLabel(t, skill)}</li>)}</ul></section>
            <section><h2>{t('c.job.tools')}</h2><ul className="c-tags">{profile.tools.map(tool => <li key={tool}>{toolLabel(t, tool)}</li>)}</ul></section></> : null}
        {upcoming ? <section className="c-upcoming"><h2>{t('c.profile.upcoming')}</h2><p><strong>{language === upcoming.analysis.language ? upcoming.analysis.title : upcoming.analysis.titleEnglish}</strong></p><p>{state.accounts.find(a => a.id === upcoming.elderId)?.firstName}{upcoming.scheduledFor ? <> · {formatScheduledDate(upcoming.scheduledFor, language)}</> : null}</p><a className="c-button c-secondary" href={`#/c/job/${upcoming.id}`}>{t('c.home.view')}</a></section> : null}
        <section><h2>{t('c.profile.notes')}</h2>{notes.length ? <><ul className="c-thanks-list">{notes.slice(0, 3).map(renderNote)}</ul>{notes.length > 3 ? <details className="c-thanks-more"><summary>{t('c.profile.seeAll')}</summary><ul className="c-thanks-list">{notes.slice(3).map(renderNote)}</ul></details> : null}</> : <p>{t('c.profile.noNotes')}</p>}</section>
        <p className="c-small">{t('c.profile.confirmed')}</p><Button kind="secondary" icon="tools" onClick={onEdit}>{t('c.profile.edit')}</Button><Button kind="secondary" icon="print" onClick={onLog}>{t('c.profile.log')}</Button>
    </div>;
}
export function ServiceHours({ state, account }: {
    state: CommunityState;
    account: Account;
}) { const t = useT(), [error, setError] = useState(false); const rows = serviceLog(state, account.id), stats = volunteerStats(state, account.id), school = state.volunteers.find((p) => p.accountId === account.id)?.school; return <div className="c-stack c-service-log"><Heading>{t('c.profile.log')}</Heading><p><strong>{account.name}</strong>{school ? <><br />{school}</> : null}</p><p>{t('c.profile.hours')}: <strong>{stats.hours}</strong></p><p className="c-small">{t('c.profile.confirmed')}</p>{rows.length ? <ol className="c-log-list">{rows.map((r) => <li key={r.jobId}><h2>{r.title}</h2><p>{t('c.profile.hoursRow', { hours: r.hours, date: new Intl.DateTimeFormat(localeFor(account.language), { dateStyle: 'medium' }).format(new Date(r.date)) })}</p><p className="c-small">{t('c.profile.resident', { name: r.elderFirstName })}</p></li>)}</ol> : <p>{t('c.profile.logEmpty')}</p>}<Button icon="print" onClick={() => void printCurrentPage(t('c.profile.log')).catch(() => setError(true))}>{t('c.profile.print')}</Button>{error ? <p role="alert">{t('c.error')}</p> : null}<p className="c-footer">{t('c.intro.demo')}</p></div>; }
export function formatScheduledDate(date: string, language: import('../../community/types').Language) {
    const value = new Date(date), locale = localeFor(language);
    return `${new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(value)} · ${new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(value)}`;
}
export function ScheduleChoices({ slots, chosen, customDate, onChosen, onCustomDate, onAccept }: {
    slots: readonly AvailabilitySlot[];
    chosen: AvailabilitySlot | null;
    customDate: string;
    onChosen(s: AvailabilitySlot): void;
    onCustomDate(s: string): void;
    onAccept(date: string): void;
}) {
    const t = useT(), language = useLanguage();
    // Freeze the dates presented in this sheet so midnight cannot change the accepted date.
    const [now] = useState(() => new Date().toISOString());
    const selected = chosen ?? (slots.length === 1 ? slots[0]! : null);
    return <>{slots.length ? <div className="c-stack">{slots.map(s => <button className="c-slot-choice" key={`${s.day}-${s.part}`} aria-pressed={selected?.day === s.day && selected.part === s.part} onClick={() => onChosen(s)}>{formatScheduledDate(nextSlotDate(s, now), language)}{selected?.day === s.day && selected.part === s.part ? <Icon name="check"/> : null}</button>)}</div>
        : <label className="c-field">{t('c.job.when')}<input type="datetime-local" value={customDate} onChange={e => onCustomDate(e.target.value)}/></label>}
        <Button disabled={!selected && !customDate} onClick={() => { const date = selected ? nextSlotDate(selected, now) : new Date(customDate).toISOString(); onAccept(date); }}>{t('c.accept.confirm')}</Button></>;
}
