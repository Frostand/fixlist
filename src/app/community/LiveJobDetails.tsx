import { useState } from 'react';
import type { LiveJobDetails as Details } from '../../community/ports';
import type { Language } from '../../community/types';
import { liveText } from '../../community/live-validation';
import type { LiveCommunityController, LiveViewState } from './live-controller';
import { Button } from './UI';
import { liveError, liveStatus, liveCopy as l } from './live-copy';

export function LiveJobDetails({ details: d, state, controller: c, language }: { details: Details; state: LiveViewState; controller: LiveCommunityController; language: Language }) {
    const [message, setMessage] = useState(''), [stars, setStars] = useState<1 | 2 | 3 | 4 | 5>(5), [note, setNote] = useState('');
    const [confirm, setConfirm] = useState(false), [cancel, setCancel] = useState(false);
    const locked = !!state.pending, job = d.job, elder = state.access.value?.role === 'elder' && job.elderId === c.port.identity.userId;
    const volunteer = state.access.value?.role === 'volunteer' && job.volunteerId === c.port.identity.userId;
    const messaging = ['accepted', 'on-the-way', 'arrived', 'reported-done'].includes(job.status);
    const next = job.status === 'accepted' ? 'on-the-way' : job.status === 'on-the-way' ? 'arrived' : job.status === 'arrived' ? 'reported-done' : null;
    // Backend pages are newest first by numeric ordinal (timestamps may tie).
    const messages = [...state.messages.value?.items ?? []].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
    return <article className="fl-live-card c-stack" aria-label={l.privateDetails}>
        <h2 lang={d.analysis.language} dir="auto">{d.analysis.title}</h2><p role="status">{liveStatus[job.status]}</p>
        <p lang={d.analysis.language} dir="auto">{d.analysis.summary}</p>
        <p>{l.original} <bdi>{d.originalText}</bdi></p><p>{l.addressLabel} <bdi>{d.address}</bdi></p>
        <p>{l.resident} <bdi>{d.elderName}</bdi> · {l.helper} <bdi>{d.volunteerName ?? l.unassigned}</bdi></p>
        <ul>{d.analysis.safetyNotes.map(s => <li key={s}>{s}</li>)}</ul>
        <details><summary>{l.history}</summary><ol>{d.events.map(event => <li key={event.id}>{event.type} · <time dateTime={event.at}>{new Date(event.at).toLocaleString(language)}</time></li>)}</ol></details>
        {volunteer && next ? <Button disabled={locked} onClick={() => { void c.execute({ kind: 'advance', jobId: job.id, step: next }); }}>{next === 'on-the-way' ? l.onWay : next === 'arrived' ? l.arrived : l.report}</Button> : null}
        {elder && job.status === 'reported-done' ? <div className="c-stack"><label className="fl-live-check"><input type="checkbox" disabled={locked} checked={confirm} onChange={e => setConfirm(e.target.checked)}/>{l.confirmCheck}</label><Button disabled={locked || !confirm} onClick={() => { void c.execute({ kind: 'confirm', jobId: job.id }); }}>{l.confirmDone}</Button></div> : null}
        {elder && !['completed', 'cancelled'].includes(job.status) ? <div className="c-stack"><label className="fl-live-check"><input type="checkbox" disabled={locked} checked={cancel} onChange={e => setCancel(e.target.checked)}/>{l.cancelCheck}</label><Button kind="secondary" disabled={locked || !cancel} onClick={() => { void c.execute({ kind: 'cancel', jobId: job.id }); }}>{l.cancel}</Button></div> : null}
        {elder && job.status === 'completed' && !d.rating ? <form className="c-stack" onSubmit={e => { e.preventDefault(); if (!locked && liveText(note, 1000, true)) void c.execute({ kind: 'rate', jobId: job.id, stars, note }); }}><h3>{l.rate}</h3><label className="c-field">{l.stars}<select disabled={locked} value={stars} onChange={e => setStars(Number(e.target.value) as typeof stars)}>{[1, 2, 3, 4, 5].map(s => <option key={s} value={s}>{s}</option>)}</select></label><label className="c-field">{l.ratingNote}<textarea disabled={locked} dir="auto" maxLength={1000} value={note} onChange={e => setNote(e.target.value)}/></label><Button type="submit" disabled={locked || !liveText(note, 1000, true)}>{l.saveRating}</Button></form> : null}
        {d.rating ? <p>{l.savedRating} {d.rating.stars}/5 · <bdi>{d.rating.note}</bdi></p> : null}
        <section className="c-stack" aria-label={l.messagesLabel}><h3>{l.messages}</h3>
            <Button kind="secondary" disabled={state.messages.loading} onClick={() => { void c.loadMessages(); }}>{l.refreshMessages}</Button>
            {state.messages.loading ? <p role="status">{l.loadingMessages}</p> : null}
            {state.messages.error ? <p role="alert">{liveError[state.messages.error]}</p> : null}
            {state.messages.value && !messages.length ? <p>{l.noMessages}</p> : null}
            <ol className="fl-live-messages">{messages.map(m => <li key={m.id}><span>{m.fromId === c.port.identity.userId ? l.you : l.other}</span> · <time dateTime={m.at}>{new Date(m.at).toLocaleString(language)}</time><p lang={m.language} dir="auto">{m.text}</p></li>)}</ol>
            {state.messages.value?.nextCursor ? <Button kind="secondary" disabled={state.messages.loading} onClick={() => { void c.loadMessages(true); }}>{l.olderMessages}</Button> : null}
            {messaging && (elder || volunteer) ? <form className="c-stack" onSubmit={e => { e.preventDefault(); if (!locked && liveText(message, 2000)) void (async () => { if (await c.execute({ kind: 'message', jobId: job.id, text: message, language })) setMessage(''); })(); }}><label className="c-field">{l.message}<textarea lang={language} dir="auto" maxLength={2000} required disabled={locked} value={message} onChange={e => setMessage(e.target.value)}/></label><Button type="submit" disabled={locked || !liveText(message, 2000)}>{l.send}</Button></form> : <p className="c-small">{l.messageLimit}</p>}
        </section>
    </article>;
}
