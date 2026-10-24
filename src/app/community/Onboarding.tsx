import { useState } from 'react';
import type { Account, AccountRole, Language, SignInProvider } from '../../community/types';
import type { SetupValues } from '../../community/setup';
export type { SetupValues } from '../../community/setup';
import { SKILLS, TOOLS } from '../../community/types';
import { quickPickAnalysis } from '../../community';
import { useT } from '../../i18n';
import { Avatar, Availability, Back, Button, Chips, Heading, Icon, LanguageSelect, Sheet, skillLabel, toolLabel } from './UI';
export function Intro({ language, volunteer, onLanguage, onStart }: {
    language: Language;
    volunteer: Account | null;
    onLanguage(l: Language): void;
    onStart(): void;
}) {
    const t = useT();
    const example = quickPickAnalysis('light-bulb', language);
    return <div className="c-landing"><header className="c-landing-nav"><a className="c-wordmark" href="#/c/intro"><Icon name="leaf"/>{t('c.brand')}</a><Button kind="quiet" onClick={onStart}>{t('c.intro.signin')}</Button></header><section className="c-hero"><div><h1 tabIndex={-1} data-screen-heading>{t('c.intro.promise')}</h1><p>{t('c.intro.body')}</p><Button icon="arrow" onClick={onStart}>{t('c.intro.start')}</Button><LanguageSelect value={language} onChange={onLanguage}/></div><div className="c-phone-preview" aria-label={t('c.job.preview')}><span className="c-phone-speaker"/><div className="c-preview-greeting"><Icon name="leaf"/>{t('c.brand')}</div><div className="c-paper-note"><span className="c-status">{t('c.status.accepted')}</span><h2>{example.title}</h2><p>{example.summary}</p><p className="c-small"><Icon name="clock"/>{t('c.job.time', { minutes: example.estimatedMinutes })}</p><div className="c-neighbor-line"><Avatar name={volunteer?.name ?? t('c.signin.volunteer')}/><span>{t('c.volunteer.assigned', { name: volunteer?.firstName ?? t('c.signin.volunteer') })}<small>{t('c.slot.day6')} · {t('c.slot.morning')}</small></span><Icon name="check"/></div></div><p className="c-small">{t('c.intro.confirm')}</p></div></section><section className="c-how"><h2>{t('c.intro.how')}</h2><ol>{(['1', '2', '3'] as const).map((step) => <li key={step}><Icon name={step === '1' ? 'mic' : step === '2' ? 'help' : 'home'} size={32}/><h3>{t(`c.intro.step${step}`)}</h3><p>{t(`c.intro.step${step}body`)}</p></li>)}</ol></section><section className="c-volunteer-banner"><Icon name="tools" size={48}/><div><h2>{t('c.intro.volunteer')}</h2><p>{t('c.intro.volunteerBody')}</p><Button kind="secondary" onClick={onStart}>{t('c.intro.volunteerAction')}</Button></div></section><section className="c-trust"><h2>{t('c.intro.trust')}</h2>{(['private', 'address', 'confirm'] as const).map((key) => <p key={key}><Icon name="shield"/>{t(`c.intro.${key}`)}</p>)}</section><footer className="c-footer">{t('c.intro.demo')}</footer></div>;
}
function AppleMark() { return <svg width="22" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 4.1c.9-1 1.4-2.2 1.3-3.5-1.3.1-2.7.9-3.5 1.8-.8.9-1.4 2.2-1.2 3.4 1.3.1 2.6-.7 3.4-1.7ZM20.8 17.2c-.5 1.2-.8 1.8-1.5 2.8-.9 1.3-2.2 2.9-3.8 2.9-1.4 0-1.8-.9-3.7-.9s-2.3.9-3.7.9c-1.6 0-2.8-1.4-3.7-2.7C1.8 16.5 1 11.4 2.7 8.7c1.2-1.9 3-3 4.8-3 1.5 0 2.5.9 3.7.9 1.1 0 1.9-.9 3.7-.9 1.4 0 2.9.8 4 2.1-3.5 1.9-3 6.9 1.9 9.4Z"/></svg>; }
function GoogleMark() { return <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M44 24.5c0-1.5-.1-3-.4-4.5H24v8.5h11.2a9.7 9.7 0 0 1-4.2 6.4v5.3h6.8C41.8 36.5 44 31 44 24.5Z"/><path fill="#34A853" d="M24 45c5.7 0 10.5-1.9 14-5.1l-6.8-5.3c-1.9 1.3-4.2 2-7.2 2-5.5 0-10.2-3.7-11.9-8.7h-7v5.5A21 21 0 0 0 24 45Z"/><path fill="#FBBC05" d="M12.1 27.9a12.6 12.6 0 0 1 0-7.8v-5.5h-7a21 21 0 0 0 0 18.8Z"/><path fill="#EA4335" d="M24 11.4c3.1 0 5.8 1.1 8 3.1l6-6A20.1 20.1 0 0 0 24 3 21 21 0 0 0 5.1 14.6l7 5.5c1.7-5 6.4-8.7 11.9-8.7Z"/></svg>; }
export function SignIn({ groups, onSignIn, onCreate, onBack }: {
    groups: Record<AccountRole, readonly Account[]>;
    onSignIn(id: string, provider: SignInProvider): void;
    onCreate(provider: SignInProvider): void;
    onBack(): void;
}) {
    const t = useT();
    const [provider, setProvider] = useState<SignInProvider | null>(null);
    return <div className="c-narrow"><Back onClick={onBack}/><div className="c-auth-mark"><Icon name="leaf" size={48}/></div><Heading intro={t('c.signin.body')}>{t('c.signin.title')}</Heading><div className="c-stack">{(['apple', 'google', 'email'] as const).map((p) => <button type="button" className={`c-provider c-provider-${p}`} onClick={() => setProvider(p)} key={p}>{p === 'apple' ? <AppleMark /> : p === 'google' ? <GoogleMark /> : <Icon name="mail"/>}{t(`c.signin.${p}`)}</button>)}</div><p className="c-footer">{t('c.signin.demo')}</p>{provider ? <Sheet title={t('c.signin.choose')} onClose={() => setProvider(null)}><DemoAccountChoices groups={groups} onSelect={(id) => onSignIn(id, provider)} onCreate={() => onCreate(provider)}/></Sheet> : null}</div>;
}
export function RoleChoice({ onSelect, onBack }: {
    onSelect(r: AccountRole): void;
    onBack(): void;
}) { const t = useT(); return <div className="c-narrow"><Back onClick={onBack}/><Heading>{t('c.role.title')}</Heading><div className="c-stack">{(['elder', 'volunteer', 'family'] as const).map((r) => <button className="c-role-card" key={r} onClick={() => onSelect(r)}><Icon name={r === 'elder' ? 'home' : r === 'volunteer' ? 'tools' : 'person'} size={34}/><span><strong>{t(`c.role.${r}`)}</strong><small>{t(`c.role.${r}Body`)}</small></span><Icon name="arrow"/></button>)}</div></div>; }
export function Setup({ role, language, elders, onLanguage, onComplete, onBack }: {
    role: AccountRole;
    language: Language;
    elders: readonly Account[];
    onLanguage(l: Language): void;
    onComplete(v: SetupValues): void;
    onBack(): void;
}) {
    const t = useT();
    const [step, setStep] = useState(1);
    const [v, setV] = useState<SetupValues>({ name: '', role, language, area: '', needs: [], skills: [], tools: [], availability: [], maxMiles: 10, school: '', elderId: elders[0]?.id ?? '' });
    const total = role === 'volunteer' ? 3 : 2;
    const update = <K extends keyof SetupValues>(key: K, value: SetupValues[K]) => setV((old) => ({ ...old, [key]: value }));
    return <div className="c-narrow"><Back onClick={() => step > 1 ? setStep(step - 1) : onBack()}/><p className="c-small">{t('c.setup.step', { step, total })}</p><Heading>{t('c.setup.title')}</Heading><form className="c-stack" onSubmit={(e) => { e.preventDefault(); if (step < total)
        setStep(step + 1);
    else
        onComplete({ ...v, language, needs: v.needs.map(key => t(`c.setup.need.${key as 'ladders' | 'lifting' | 'walking' | 'tech' | 'bending'}`)) }); }}>{step === 1 ? <><label className="c-field">{t('c.setup.name')}<input required maxLength={80} autoComplete="name" value={v.name} onChange={(e) => update('name', e.target.value)}/></label><label className="c-field">{t('c.setup.area')}<input required maxLength={100} placeholder={t('c.setup.areaPlaceholder')} value={v.area} onChange={(e) => update('area', e.target.value)}/></label><LanguageSelect value={language} onChange={onLanguage}/></> : role === 'elder' ? <><p>{t('c.setup.needsHint')}</p><Chips title={t('c.setup.needs')} values={['ladders', 'lifting', 'walking', 'tech', 'bending'] as const} selected={v.needs} label={(key) => t(`c.setup.need.${key as 'ladders' | 'lifting' | 'walking' | 'tech' | 'bending'}`)} onChange={(x) => update('needs', x)}/></> : role === 'family' ? <label className="c-field">{t('c.setup.family')}<select value={v.elderId} onChange={(e) => update('elderId', e.target.value)}>{elders.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.area}</option>)}</select></label> : step === 2 ? <><Chips title={t('c.setup.skills')} values={SKILLS} selected={v.skills} label={(s) => skillLabel(t, s)} onChange={(x) => update('skills', x)}/><Chips title={t('c.setup.tools')} values={TOOLS} selected={v.tools} label={(x) => toolLabel(t, x)} onChange={(x) => update('tools', x)}/></> : <><Availability value={v.availability} onChange={(x) => update('availability', x)}/><label className="c-field">{t('c.setup.distance')} <strong>{t('c.setup.miles', { count: v.maxMiles })}</strong><input type="range" min="1" max="50" value={v.maxMiles} onChange={(e) => update('maxMiles', Number(e.target.value))}/></label><label className="c-field">{t('c.setup.school')}<input maxLength={120} value={v.school} onChange={(e) => update('school', e.target.value)}/></label></>}<Button type="submit">{t(step === total ? 'c.setup.finish' : 'c.continue')}</Button></form></div>;
}
export function DemoAccountChoices({ groups, onSelect, onCreate }: {
    groups: Record<AccountRole, readonly Account[]>;
    onSelect(id: string): void;
    onCreate(): void;
}) { const t = useT(); return <>{(['elder', 'volunteer', 'family'] as const).map((role) => <section className="c-account-group" key={role}><h3>{t(`c.signin.${role}`)}</h3>{groups[role].map((a) => <button className="c-account" key={a.id} onClick={() => onSelect(a.id)}><Avatar name={a.name} tone={a.avatarTone}/><span><strong>{a.name}</strong><small>{a.area}</small></span><Icon name="arrow"/></button>)}</section>)}<Button kind="secondary" icon="person" onClick={onCreate}>{t('c.signin.new')}</Button></>; }
