import { liveCopy as l, liveError } from './live-copy';
import { useEffect, useRef, useState } from 'react';
import { sendRequestTurn } from '../../lib/request-conversation';
import { assistant } from '../../lib/assistant';
import { dialogueCopy } from '../../lib/native-dialogue';
import { analyzeTaskWithRules } from '../../community/task-rules';
import { taskAnalysis } from '../../lib/assistant-conversation';
import { liveText, postInput } from '../../community/live-validation';
import type { AssistantReply, ChatTurn, Language } from '../../community/types';
import type { LiveCommunityController } from './live-controller';
import { Button, skillLabel, toolLabel } from './UI';
import { RequestPhotoEditor } from './RequestPhotos';
import { useT } from '../../i18n';

/** Conversation is transient. Address/consent/retry state remain in the live boundary. */
export function LiveRequestDraft({ controller: c, language, locked }: { controller: LiveCommunityController; language: Language; locked: boolean }) {
    const [text, setText] = useState(''), [address, setAddress] = useState(''), [review, setReview] = useState(false), [agreed, setAgreed] = useState(false), [error, setError] = useState('');
    const [viewOwner, setViewOwner] = useState({ controller: c, language });
    const currentView = viewOwner.controller === c && viewOwner.language === language;
    const [turns, setTurns] = useState<ChatTurn[]>([]), [reply, setReply] = useState<AssistantReply | null>(null), [thinking, setThinking] = useState(false);
    const [manual, setManual] = useState(false), [photos, setPhotos] = useState<readonly string[]>([]), [photosBusy, setPhotosBusy] = useState(false);
    const photosBusyRef = useRef(false);
    const scope = useRef({ controller: c, language, active: true, pending: false, revision: 0, posted: false });
    if (scope.current.controller !== c || scope.current.language !== language) scope.current = { controller: c, language, active: true, pending: false, revision: 0, posted: false };
    useEffect(() => {
        const owner = scope.current; owner.active = true; setViewOwner({ controller: c, language });
        setText(''); setAddress(''); setTurns([]); setReply(null); setReview(false); setAgreed(false); setError(''); setThinking(false); setManual(false); setPhotos([]); setPhotosBusy(false); photosBusyRef.current = false;
        return () => { owner.active = false; assistant.cancelConversation(); };
    }, [c, language]);
    const owner = scope.current, revision = owner.revision, t = useT(), analysis = reply?.job ?? null;
    const held = !!reply?.requiresResolution && !manual;
    const addressValid = liveText(address, 500), canCollect = text.trim() ? liveText(text, 4000) : addressValid && !!analysis;
    const valid = addressValid && (text.trim() ? liveText(text, 4000) : !!analysis), team = !!analysis && analysis.peopleNeeded > 1;
    function invalidate() { owner.revision++; setReview(false); setAgreed(false); }
    async function collect(retry = false) {
        if (!currentView || locked || c.state.pending || owner.pending || !owner.active || scope.current !== owner || (manual && (retry || text.trim())) || (!retry && !canCollect)) return;
        if (!retry && !text.trim()) { if (analysis) setReview(true); return; }
        owner.pending = true; invalidate(); setThinking(true); setError(''); setManual(false);
        const submittedRevision = owner.revision;
        try {
            const result = await sendRequestTurn(turns, text, language, '', retry);
            if (!owner.active || scope.current !== owner || owner.revision !== submittedRevision) return;
            setTurns(result.turns); setReply({ ...result.reply, originalText: result.originalText }); setText('');
            setReview(!!result.reply.job && addressValid);
        } catch { if (owner.active && scope.current === owner) setError(l.invalidDraft); }
        finally { if (owner.active && scope.current === owner) { owner.pending = false; setThinking(false); } }
    }
    async function post() {
        if (photosBusyRef.current || !currentView || locked || c.state.pending || owner.pending || owner.posted || owner.revision !== revision || !owner.active || scope.current !== owner
            || held || !review || !valid || !agreed || team || !analysis || text.trim() || !reply?.originalText) return;
        const input = { requestId: crypto.randomUUID(), source: 'typed' as const, originalText: reply.originalText, analysis, address: address.trim(), ...(photos.length ? { photos } : {}) };
        if (!postInput(input)) { setError(l.invalidPost); return; }
        owner.posted = true;
        if (await c.execute({ kind: 'post', input })) {
            if (owner.active && scope.current === owner) { owner.revision++; owner.posted = false; setText(''); setAddress(''); setTurns([]); setReply(null); setReview(false); setAgreed(false); setManual(false); setPhotos([]); }
        } else owner.posted = false;
    }
    if (!currentView) return <p role="status">{l.loading}</p>;
    return <section className="fl-live-card c-stack" aria-label={l.draftLabel}>
        <h2>{l.askOne}</h2><p className="c-small">{l.draftNotice}</p>
        <fieldset disabled={locked || thinking} className="c-stack">
            <label className="c-field">{l.request}<textarea lang={language} dir="auto" maxLength={4000} disabled={manual} required value={text} onChange={e => { if (!manual) { invalidate(); setText(e.target.value); } }}/></label>
            <label className="c-field">{l.address}<textarea dir="auto" autoComplete="street-address" maxLength={500} required value={address} onChange={e => { invalidate(); setAddress(e.target.value); }}/></label>
            <Button kind="secondary" disabled={!canCollect || thinking} onClick={() => { void collect(); }}>{l.review}</Button>
            {text && !canCollect ? <p className="c-small">{l.invalidDraft}</p> : null}
            <div className="c-chat" aria-live="polite">{turns.map(turn => <p key={turn.id} lang={language} dir="auto" role={reply?.conversation?.status === 'blocked' && turn === turns.at(-1) ? 'alert' : undefined}>{turn.text}</p>)}</div>
            {reply?.retryable && !manual ? <Button kind="secondary" onClick={() => { void collect(true); }}>{dialogueCopy[language].retry}</Button> : null}
            {held && reply?.dialogue && !['blocked', 'cancelled'].includes(reply.dialogue.state.status) && !reply.dialogue.exhausted ? <Button kind="secondary" onClick={() => {
                if (!currentView || locked || owner.pending || !owner.active || scope.current !== owner) return;
                invalidate(); setManual(true); setReview(addressValid); setText('');
                if (!analysis) {
                    const words = reply.originalText ?? '', base = taskAnalysis('general', language, analyzeTaskWithRules);
                    setReply({ ...reply, job: { ...base, title: words.slice(0, 120), titleEnglish: words.slice(0, 120), summary: words, summaryEnglish: words } });
                }
            }}>{dialogueCopy[language].manualAction}</Button> : null}
            {review && analysis ? <div className="c-stack" aria-label={l.reviewLabel}>
                <div lang={language} dir="auto"><h3>{analysis.title}</h3><p>{analysis.summary}</p></div>
                {manual ? <><label className="c-field">{t('c.job.title')}<input maxLength={140} value={analysis.title} onChange={e => {
                    if (!owner.active || scope.current !== owner || owner.pending || locked) return;
                    invalidate(); setReview(true); setReply({ ...reply!, job: { ...analysis, title: e.target.value, titleEnglish: e.target.value } });
                }}/></label><label className="c-field">{t('c.job.summary')}<textarea maxLength={1200} value={analysis.summary} onChange={e => {
                    if (!owner.active || scope.current !== owner || owner.pending || locked) return;
                    invalidate(); setReview(true); setReply({ ...reply!, job: { ...analysis, summary: e.target.value, summaryEnglish: e.target.value } });
                }}/></label></> : null}
                <p>{l.category} {analysis.category} · {l.people} {analysis.peopleNeeded}</p>
                <p lang={language} dir="auto">{analysis.skills.map(s => skillLabel(t, s)).join(', ')}{analysis.tools.length ? ` · ${analysis.tools.map(s => toolLabel(t, s)).join(', ')}` : ''}</p>
                <p className="c-small">{l.estimate} {analysis.estimatedMinutes} {l.estimateAfter}</p>
                <ul>{analysis.safetyNotes.map(note => <li key={note}>{note}</li>)}</ul>
                <p>{l.sharedAddress} <bdi>{address.trim()}</bdi></p>
                <p>{l.privacy}</p>
                <RequestPhotoEditor photos={photos} disabled={locked || !!c.state.pending || owner.pending || owner.posted} isCurrent={() => owner.active && scope.current === owner} onBusyChange={busy => { photosBusyRef.current = busy; setPhotosBusy(busy); }} onChange={next => { if (owner.active && scope.current === owner) { owner.revision++; setAgreed(false); setPhotos(next); } }}/>
                {team ? <p role="alert">{liveError.unsupported_team}</p> : null}
                <label className="fl-live-check"><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}/>{l.reviewed}</label>
                <Button disabled={photosBusy || held || !agreed || team || !valid} onClick={() => { void post(); }}>{l.post}</Button>
            </div> : null}
        </fieldset>
        {error ? <p role="alert">{error}</p> : null}
    </section>;
}
