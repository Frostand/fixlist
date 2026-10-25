import { useEffect, useRef, useState } from 'react';
import { familyGrant } from '../../community/family';
import { sendMessage } from '../../community';
import type { Account, CommunityState, Job, Language } from '../../community/types';
import { assistant } from '../../lib/assistant';
import { localeFor, useT } from '../../i18n';
import type { CommunityController } from './useCommunity';
import { Button, Heading } from './UI';
export function Messages({ state, account, job, run, isCurrent = () => true, familyRevision }: {
    state: CommunityState;
    account: Account;
    job: Job;
    run: CommunityController['run'];
    isCurrent?(): boolean;
    familyRevision?: number;
}) {
    const t = useT();
    const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const authorization = useRef(isCurrent);
    authorization.current = isCurrent;
    async function send() { if (!text.trim() || busy || !alive.current || !authorization.current())
        return; const words = text.trim(); setBusy(true); setError(''); try {
        const targetIds = [job.elderId, job.volunteerId, ...state.families.filter(f => familyGrant(state, f.accountId, job.elderId)?.scopes.includes('messages')).map(f => f.accountId)];
        const languages = [...new Set(state.accounts.filter((a) => targetIds.includes(a.id) && a.language !== account.language).map((a) => a.language))];
        const translations: Partial<Record<Language, string>> = {};
        await Promise.all(languages.map(async (to) => { try {
            const translated = await assistant.translate(words, account.language, to);
            if (translated)
                translations[to] = translated;
        }
        catch { /* Send readable original if translation is unavailable. */ } }));
        if (!alive.current || !authorization.current())
            return;
        const r = run((s) => sendMessage(s, { jobId: job.id, fromId: account.id, text: words, language: account.language, translations, ...(familyRevision === undefined ? {} : { familyRevision }) }, new Date().toISOString()));
        if (r.ok)
            setText('');
    }
    catch {
        if (alive.current)
            setError(t('c.error'));
    }
    finally {
        if (alive.current)
            setBusy(false);
    } }
    const messages = state.messages.filter((m) => m.jobId === job.id);
    return <div className="c-stack"><Heading>{t('c.messages')}</Heading><p>{account.language === job.analysis.language ? job.analysis.title : job.analysis.titleEnglish}</p><div className="c-chat" role="log" aria-live="polite">{messages.length ? messages.map((m) => { const translated = m.translations[account.language]; return <article key={m.id} className={`c-bubble c-bubble-${m.fromId === account.id ? 'user' : 'assistant'}`}><span>{state.accounts.find((a) => a.id === m.fromId)?.firstName}</span><p lang={translated ? account.language : m.language}>{translated ?? m.text}</p>{translated ? <details><summary>{t('c.messages.translated')} · {t('c.messages.original')}</summary><p lang={m.language}>{m.text}</p></details> : null}<time dateTime={m.at}>{new Intl.DateTimeFormat(localeFor(account.language), { hour: 'numeric', minute: '2-digit' }).format(new Date(m.at))}</time></article>; }) : <p>{t('c.messages.empty')}</p>}</div><form className="c-stack" onSubmit={(e) => { e.preventDefault(); void send(); }}><label className="c-field">{t('c.messages.write')}<textarea maxLength={2000} value={text} disabled={busy} onChange={(e) => setText(e.target.value)}/></label><Button type="submit" icon="message" disabled={!text.trim() || busy}>{t(busy ? 'c.loading' : 'c.messages.send')}</Button></form>{error ? <p role="alert">{error}</p> : null}</div>;
}
