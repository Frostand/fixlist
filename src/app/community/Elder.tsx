import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Account, ChatTurn, CommunityState, Job, JobAnalysis, JobSource, ListeningSession, ScanEvidence } from '../../community/types';
import { QUICK_PICK_IDS, quickPickAnalysis, volunteerStats } from '../../community';
import { assistant } from '../../lib/assistant';
import { localeFor, useLanguage, useT } from '../../i18n';
import { Avatar, Button, Heading, Icon } from './UI';
import { DraftScreen } from './DraftScreen';
export interface Draft {
    analysis: JobAnalysis;
    source: JobSource;
    text: string;
    evidence: readonly ScanEvidence[];
}
export function ProgressTracker({ status }: {
    status: Job['status'];
}) { const t = useT(); const steps = ['open', 'accepted', 'on-the-way', 'arrived', 'reported-done', 'completed'] as const; const index = steps.indexOf(status as typeof steps[number]); if (status === 'cancelled')
    return <p className="c-status">{t('c.status.cancelled')}</p>; return <ol className="c-progress" aria-label={t('c.tracker')}>{steps.map((s, i) => <li key={s} className={i <= index ? 'c-reached' : ''} aria-current={i === index ? 'step' : undefined}><span aria-hidden="true">{i < index ? <Icon name="check" size={16}/> : i + 1}</span>{t(`c.status.${s}`)}</li>)}</ol>; }
export function RequestSummary({ job, state, onOpen, tracker = false }: {
    job: Job;
    state: CommunityState;
    onOpen(): void;
    tracker?: boolean;
}) { const t = useT(), language = useLanguage(); const volunteer = state.accounts.find((a) => a.id === job.volunteerId), stats = volunteer ? volunteerStats(state, volunteer.id) : null; return <article className="c-request"><div className="c-request-top"><span className={`c-status c-status-${job.status}`}>{t(`c.status.${job.status}`)}</span>{job.scheduledFor ? <span className="c-small">{new Intl.DateTimeFormat(localeFor(language), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(job.scheduledFor))}</span> : null}</div><h2>{language === job.analysis.language ? job.analysis.title : job.analysis.titleEnglish}</h2>{volunteer ? <div className="c-neighbor-line"><Avatar name={volunteer.name} tone={volunteer.avatarTone}/><span><strong>{t('c.volunteer.assigned', { name: volunteer.firstName })}</strong><small>{stats?.rating ? t('c.volunteer.rating', { rating: stats.rating.toFixed(1) }) : t('c.volunteer.new')}</small>{job.status === 'on-the-way' ? <small>{t('c.volunteer.eta', { name: volunteer.firstName })}</small> : null}</span></div> : <p className="c-small">{t('c.volunteer.waiting')}</p>}{tracker ? <ProgressTracker status={job.status}/> : null}<Button kind="secondary" icon="arrow" onClick={onOpen}>{t('c.home.view')}</Button></article>; }
export function ActiveRequest({ state, job, onNavigate }: { state: CommunityState; job: Job; onNavigate(path: string): void }) {
    const t = useT(), language = useLanguage();
    const volunteer = state.accounts.find(a => a.id === job.volunteerId);
    if (!volunteer) return null;
    const stats = volunteerStats(state, volunteer.id);
    const date = job.scheduledFor ? new Intl.DateTimeFormat(localeFor(language), { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(job.scheduledFor)) : '';
    const key = job.status === 'accepted' ? 'c.home.coming' : job.status === 'on-the-way' ? 'c.home.onWay' : job.status === 'arrived' ? 'c.home.arrived' : 'c.home.reportedDone';
    return <article className="c-request c-active-request"><div className="c-neighbor-line"><Avatar name={volunteer.name} tone={volunteer.avatarTone}/><span><strong>{volunteer.name}</strong><small>{stats.rating !== null ? t('c.volunteer.rating', { rating: stats.rating.toFixed(1) }) : t('c.volunteer.new')}</small></span></div>
        <h2>{t(key, { name: volunteer.firstName, date })}</h2><ProgressTracker status={job.status}/>
        {job.status === 'reported-done' ? <Button icon="check" onClick={() => onNavigate(`confirm/${job.id}`)}>{t('c.home.confirm')}</Button> : null}
        <Button kind="secondary" icon="message" onClick={() => onNavigate(`messages/${job.id}`)}>{t('c.home.message')}</Button>
        <Button kind="quiet" onClick={() => onNavigate(`job/${job.id}`)}>{t('c.home.view')}</Button>
    </article>;
}
export function ElderHome({ account, elder, state, jobs, onNavigate, onDraft }: {
    account: Account;
    elder: Account;
    state: CommunityState;
    jobs: readonly Job[];
    onNavigate(path: string): void;
    onDraft(d: Draft): void;
}) {
    const t = useT(), language = useLanguage(), family = account.role === 'family';
    const active = jobs.filter(j => ['accepted', 'on-the-way', 'arrived', 'reported-done'].includes(j.status));
    const waiting = jobs.find(j => j.status === 'open');
    return <div className="c-stack"><Heading intro={family ? t('c.family.access') : t('c.home.question')}>{t(family ? 'c.family.title' : 'c.home.greeting', { name: family ? elder.firstName : account.firstName })}</Heading>
        {active.map(job => <ActiveRequest key={job.id} state={state} job={job} onNavigate={onNavigate}/>)}
        {family ? <Button icon="help" onClick={() => onNavigate('type')}>{t('c.family.ask', { name: elder.firstName })}</Button> : <>
            <div className="c-talk-home"><button className="c-mic" onClick={() => onNavigate('talk')}><Icon name="mic" size={52}/><strong>{t('c.home.talk')}</strong></button><p>{t('c.home.talkHint')}</p></div>
            <div className="c-home-tiles"><button onClick={() => onNavigate('type')}><Icon name="help" size={32}/><strong>{t('c.home.type')}</strong><span>{t('c.home.typeHint')}</span></button><button onClick={() => onNavigate('rooms')}><Icon name="room" size={32}/><strong>{t('c.home.scan')}</strong><span>{t('c.home.scanHint')}</span></button></div>
            <section><h2>{t('c.home.quick')}</h2><div className="c-chips">{QUICK_PICK_IDS.slice(0, 6).map(id => { const analysis = quickPickAnalysis(id, language); return <button className="c-chip" key={id} onClick={() => onDraft({ analysis, source: 'quick-pick', text: analysis.title, evidence: [] })}>{analysis.title}</button>; })}</div></section>
        </>}
        {family ? <RequestList state={state} jobs={jobs.filter(j => !active.includes(j))} onOpen={id => onNavigate(`job/${id}`)}/> : !active.length ? <section><h2>{t('c.home.active')}</h2>{waiting ? <RequestSummary state={state} job={waiting} onOpen={() => onNavigate(`job/${waiting.id}`)}/> : <p>{t('c.home.none')}</p>}</section> : null}
    </div>;
}
export function RequestList({ state, jobs, onOpen }: {
    state: CommunityState;
    jobs: readonly Job[];
    onOpen(id: string): void;
}) { const t = useT(); return <div className="c-stack">{jobs.length ? jobs.map((j) => <RequestSummary key={j.id} job={j} state={state} tracker onOpen={() => onOpen(j.id)}/>) : <p className="c-empty">{t('c.job.empty')}</p>}</div>; }
type TalkPhase = 'idle' | 'starting' | 'listening' | 'thinking' | 'replied';
export function AskScreen({ talk, account, onDraft, onPost }: {
    talk: boolean;
    account: Account;
    onDraft(d: Draft): void;
    onPost?(d: Draft, slots: readonly import('../../community/types').AvailabilitySlot[], analysis: JobAnalysis): boolean;
}) {
    const t = useT(), language = useLanguage(), alive = useRef(true), listening = useRef<ListeningSession | null>(null), pending = useRef(false);
    const [phase, setPhase] = useState<TalkPhase>('idle');
    const [text, setText] = useState(''), [partial, setPartial] = useState(''), [turns, setTurns] = useState<ChatTurn[]>([]);
    const [voice, setVoice] = useState<boolean | null>(null), [error, setError] = useState(''), [typing, setTyping] = useState(!talk), [draft, setDraft] = useState<Draft | null>(null);
    const typingRef = useRef<HTMLTextAreaElement>(null);
    const busy = phase === 'thinking', recording = phase === 'starting' || phase === 'listening';
    useEffect(() => {
        alive.current = true;
        void assistant.availability().then(a => { if (alive.current) setVoice(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios' && a.reason !== 'native-unavailable' && a.speechInput); }).catch(() => { if (alive.current) setVoice(false); });
        return () => { alive.current = false; listening.current?.cancel(); assistant.stopSpeaking(); };
    }, []);
    useEffect(() => { if (typing) typingRef.current?.focus(); }, [typing]);
    function speak(words: string) { assistant.stopSpeaking(); void assistant.speak(words, language).catch(() => {}); }
    async function submit(words: string, source: JobSource) {
        if (!words.trim() || pending.current) return;
        pending.current = true; setPhase('thinking'); setError(''); setText(''); setDraft(null); assistant.stopSpeaking();
        try {
            if (talk) {
                const next: ChatTurn[] = [...turns, { role: 'user', text: words.trim() }];
                setTurns(next);
                const reply = await assistant.chat(next, language, { firstName: account.firstName });
                if (!alive.current) return;
                setTurns([...next, { role: 'assistant', text: reply.text }]);
                setPhase('replied'); speak(reply.text);
                if (reply.job) setDraft({ analysis: reply.job, source, text: words.trim(), evidence: [] });
            } else {
                const analysis = await assistant.analyzeTask(words.trim(), language);
                if (alive.current) onDraft({ analysis, source, text: words.trim(), evidence: [] });
            }
        } catch {
            if (alive.current) { setError(t('c.error')); setText(words); setPhase(turns.length ? 'replied' : 'idle'); }
        } finally { pending.current = false; if (alive.current && !talk) setPhase('idle'); }
    }
    async function start() {
        if (pending.current || voice !== true || recording) return;
        setError(''); setPartial(''); setPhase('starting'); assistant.stopSpeaking();
        try {
            const session = await assistant.startListening(language, words => { if (alive.current) setPartial(words); });
            if (!alive.current) { session.cancel(); return; }
            listening.current = session; setPhase('listening');
        } catch { if (alive.current) { setVoice(false); setPhase(turns.length ? 'replied' : 'idle'); setTyping(true); } }
    }
    async function stop() {
        const session = listening.current;
        if (!session) return;
        listening.current = null; setPhase('thinking');
        try {
            const words = await session.stop();
            if (alive.current) { setPartial(''); if (words.trim()) await submit(words, 'voice'); else setPhase(turns.length ? 'replied' : 'idle'); }
        } catch { if (alive.current) { setPhase(turns.length ? 'replied' : 'idle'); setError(t('c.talk.unavailable')); setTyping(true); } }
    }
    return <div className="c-stack" data-talk-phase={phase}>
        <Heading intro={t(talk ? 'c.talk.prompt' : 'c.type.body')}>{t(talk ? 'c.talk.title' : 'c.type.title')}</Heading>
        {talk ? <>
            <div className="c-chat" aria-live="polite">{turns.map((turn, i) => <div className={`c-bubble c-bubble-${turn.role}`} key={i}><span>{t(turn.role === 'user' ? 'c.talk.you' : 'c.talk.assistant')}</span><p>{turn.text}</p>{turn.role === 'assistant' ? <Button kind="quiet" icon="replay" disabled={recording || busy} onClick={() => speak(turn.text)}>{t('c.talk.replay')}</Button> : null}</div>)}
                {phase === 'listening' && partial ? <div className="c-bubble c-bubble-user"><span>{t('c.talk.you')}</span><p>{partial}</p></div> : null}</div>
            {draft ? <section aria-label={t('c.talk.preview')}><DraftScreen embedded key={turns.length} draft={draft} onChange={setDraft} onPost={(slots, analysis) => { if (onPost) return onPost(draft, slots, analysis); onDraft({ ...draft, analysis }); return true; }}/></section> : null}
            {!draft ? busy ? <p className="c-thinking c-small" role="status">{t('c.talk.thinking')}</p> : <>
                <div className="c-talk-home"><button className={`c-mic ${phase === 'listening' ? 'c-listening' : ''}`} disabled={voice !== true || phase === 'starting'} onClick={() => phase === 'listening' ? void stop() : void start()}><Icon name="mic" size={42}/><strong>{t(phase === 'starting' ? 'c.talk.starting' : phase === 'listening' ? 'c.talk.stop' : 'c.talk.speak')}</strong></button>
                    {phase === 'listening' ? <p role="status">{t('c.talk.listening')}</p> : null}</div>
                {!recording ? <Button kind="quiet" onClick={() => { setTyping(true); typingRef.current?.focus(); }}>{t('c.talk.typeInstead')}</Button> : null}
            </> : null}
            {voice === false && !draft ? <p className="c-small" role="status">{t('c.talk.unavailable')}</p> : null}
        </> : null}
        {(!talk || typing || voice === false) && !recording && !draft ? <form className="c-stack" onSubmit={e => { e.preventDefault(); void submit(text, 'typed'); }}><label className="c-field">{t(talk ? 'c.talk.placeholder' : 'c.type.title')}<textarea ref={typingRef} rows={4} required disabled={busy} maxLength={2000} placeholder={t(talk ? 'c.talk.placeholder' : 'c.type.placeholder')} value={text} onChange={e => setText(e.target.value)}/></label><Button type="submit" disabled={!text.trim() || busy} kind={talk ? 'secondary' : 'primary'}>{t(busy ? 'c.talk.thinking' : talk ? 'c.talk.send' : 'c.type.draft')}</Button></form> : null}
        {error ? <p role="alert">{error}</p> : null}
    </div>;
}
export function Confirmation({ job, volunteerName, onConfirm, onRate, onBack }: {
    job: Job;
    volunteerName: string;
    onConfirm(): boolean;
    onRate(stars: number, note: string): boolean;
    onBack(): void;
}) { const t = useT(); const [stars, setStars] = useState(0), [note, setNote] = useState(''); return <div className="c-stack"><Heading intro={t(job.status === 'completed' ? 'c.confirm.saved' : 'c.confirm.body')}>{t(job.status === 'completed' ? 'c.confirm.thanks' : 'c.confirm.title', { name: volunteerName })}</Heading>{job.status !== 'completed' ? <><Button icon="check" onClick={onConfirm}>{t('c.confirm.yes')}</Button><Button kind="secondary" onClick={onBack}>{t('c.confirm.notYet')}</Button></> : <RatingForm stars={stars} note={note} onStars={setStars} onNote={setNote} onSubmit={() => { if (onRate(stars, note))
    onBack(); }}/>}</div>; }
export function RatingForm({ stars, note, onStars, onNote, onSubmit }: {
    stars: number;
    note: string;
    onStars(n: number): void;
    onNote(n: string): void;
    onSubmit(): void;
}) { const t = useT(); return <form className="c-stack" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}><div className="c-stars" role="group" aria-label={t('c.profile.rating')}>{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} aria-label={t('c.confirm.stars', { count: n })} aria-pressed={stars === n} onClick={() => onStars(n)}><svg width="36" height="36" viewBox="0 0 24 24" fill={stars >= n ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m12 2 3.1 6.3L22 9.4l-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3L7 14.3 2 9.4l6.9-1.1Z"/></svg><span className="c-star-label">{n}</span></button>)}</div><label className="c-field">{t('c.confirm.note')}<textarea value={note} maxLength={1000} onChange={(e) => onNote(e.target.value)}/></label><Button type="submit" disabled={stars === 0}>{t('c.confirm.rate')}</Button></form>; }
