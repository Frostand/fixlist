import { liveCopy as l, liveError } from './live-copy';
import { useState } from 'react';
import { analyzeTaskWithRules } from '../../community/task-rules';
import { liveText, postInput } from '../../community/live-validation';
import type { Language } from '../../community/types';
import type { LiveCommunityController } from './live-controller';
import { Button, skillLabel, toolLabel } from './UI';
import { useT } from '../../i18n';

/** Typed user words are the only provenance. No capture/assistant/storage imports. */
export function LiveRequestDraft({ controller: c, language, locked }: { controller: LiveCommunityController; language: Language; locked: boolean }) {
    const [text, setText] = useState(''), [address, setAddress] = useState(''), [review, setReview] = useState(false), [agreed, setAgreed] = useState(false), [error, setError] = useState('');
    const t = useT(), analysis = analyzeTaskWithRules(text, language);
    const valid = liveText(text, 4000) && liveText(address, 500), team = analysis.peopleNeeded > 1;
    async function post() {
        if (locked || !valid || !agreed || team) return;
        const input = { requestId: crypto.randomUUID(), source: 'typed' as const, originalText: text, analysis, address: address.trim() };
        if (!postInput(input)) { setError(l.invalidPost); return; }
        if (await c.execute({ kind: 'post', input })) { setText(''); setAddress(''); setReview(false); setAgreed(false); }
    }
    return <section className="fl-live-card c-stack" aria-label={l.draftLabel}>
        <h2>{l.askOne}</h2><p className="c-small">{l.draftNotice}</p>
        <fieldset disabled={locked} className="c-stack">
            <label className="c-field">{l.request}<textarea lang={language} dir="auto" maxLength={4000} required value={text} onChange={e => { setText(e.target.value); setReview(false); setAgreed(false); }}/></label>
            <label className="c-field">{l.address}<textarea dir="auto" autoComplete="street-address" maxLength={500} required value={address} onChange={e => { setAddress(e.target.value); setReview(false); setAgreed(false); }}/></label>
            <Button kind="secondary" disabled={!valid} onClick={() => { setReview(true); setError(''); }}>{l.review}</Button>
            {text && !valid ? <p className="c-small">{l.invalidDraft}</p> : null}
            {review ? <div className="c-stack" aria-label={l.reviewLabel}>
                <div lang={language} dir="auto"><h3>{analysis.title}</h3><p>{analysis.summary}</p></div>
                <p>{l.category} {analysis.category} · {l.people} {analysis.peopleNeeded}</p>
                <p lang={language} dir="auto">{analysis.skills.map(s => skillLabel(t, s)).join(', ')}{analysis.tools.length ? ` · ${analysis.tools.map(s => toolLabel(t, s)).join(', ')}` : ''}</p>
                <p className="c-small">{l.estimate} {analysis.estimatedMinutes} {l.estimateAfter}</p>
                <ul>{analysis.safetyNotes.map(note => <li key={note}>{note}</li>)}</ul>
                <p>{l.sharedAddress} <bdi>{address.trim()}</bdi></p>
                <p>{l.privacy}</p>
                {team ? <p role="alert">{liveError.unsupported_team}</p> : null}
                <label className="fl-live-check"><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}/>{l.reviewed}</label>
                <Button disabled={!agreed || team || !valid} onClick={() => { void post(); }}>{l.post}</Button>
            </div> : null}
        </fieldset>
        {error ? <p role="alert">{error}</p> : null}
    </section>;
}
