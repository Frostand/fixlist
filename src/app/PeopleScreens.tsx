import { loadLanguageMessages } from '../i18n/messages';
import { useEffect, useRef, useState } from 'react';
import type { Language, Person, PersonRole } from '../domain/roles';
import { LANGUAGES, reviewed, useT } from '../i18n';
import { guideIdFor, guideProgress } from './view-model';
import { type Dispatch } from './ui-controller';
import { Icon, StartShell, type Navigate } from './PhoneShell';
import { Illustration } from './Illustration';
import { IconTile } from './UI';
import type { Route } from './routes';
export async function openGuide(person: Person, dispatch: Dispatch, navigate: Navigate): Promise<void> {
  if (!guideProgress(person).completed || (await dispatch({ type: 'set_onboarding', guideId: guideIdFor(person), stepIndex: 0, completed: false })).ok) navigate({ screen: 'guide' });
}
export async function skipGuide(person: Person, dispatch: Dispatch, onExit: (skipped: boolean) => void): Promise<void> {
  if ((await dispatch({ type: 'set_onboarding', guideId: guideIdFor(person), stepIndex: guideProgress(person).stepIndex, completed: false })).ok) await onExit(true);
}
export function SetupProgress({ step, onBack, onSkip }: { step: number; onBack?(): void; onSkip?(): void }) {
  const t = useT();
  return <div className="setup-progress"><div className="setup-step-row">{onBack ? <button className="plain setup-back" onClick={onBack}><Icon name="back" />{t('nav.back')}</button> : <span />}<span className="footnote">{t('guide.progress', { current: step, total: 4 })}</span>{onSkip ? <button className="plain" onClick={onSkip}>{t('nav.skip')}</button> : <span />}</div><div className="progress-dots" aria-hidden="true">{[1, 2, 3, 4].map((i) => <span key={i} data-current={i === step} />)}</div></div>;
}
export function LanguagePicker({ onSelect, current = 'en' }: { onSelect(language: Language): void; current?: Language }) {
  const t = useT();
  return <div className="stack"><div className="language-choices list-group">{LANGUAGES.map(({ code, nativeName, dir }) => <button key={code} className="language-row" lang={code} dir={dir} aria-pressed={current === code} onClick={async () => { await loadLanguageMessages(code).catch(() => {}); onSelect(code); }}><span>{nativeName}</span>{current === code ? <Icon name="tick" /> : null}</button>)}</div>{LANGUAGES.some(({ code }) => !reviewed[code]) ? <p className="translation-note">{t('app.unreviewed')}</p> : null}</div>;
}
export function WelcomeScreen({ current, onSelect, onContinue }: { current: Language; onSelect(language: Language): void; onContinue(): void }) {
  const t = useT();
  const languageDetails = useRef<HTMLDetailsElement>(null), selected = LANGUAGES.find(({ code }) => code === current)!;
  return <StartShell title={t('app.name')}><SetupProgress step={1} onSkip={onContinue} /><div className="setup-welcome"><Illustration kind="brand" /><p className="setup-tagline">{t('app.tagline')}</p></div><details className="setup-language" ref={languageDetails}><summary><Icon name="globe" /><span><span className="footnote">{t('nav.language')}</span><strong lang={selected.code} dir={selected.dir}>{selected.nativeName}</strong></span><Icon name="chevron" /></summary><LanguagePicker current={current} onSelect={(language) => { onSelect(language); if (languageDetails.current) { languageDetails.current.open = false; languageDetails.current.querySelector('summary')?.focus(); } }} /></details><button className="full setup-continue" onClick={onContinue}>{t('nav.continue')}<Icon name="arrow" /></button></StartShell>;
}
export function PeopleScreen({ people, language, dispatch, onChoose, onBack }: { people: readonly Person[]; language: Language; dispatch: Dispatch; onChoose(personId: string, preserveLanguage?: boolean): void; onBack?(): void }) {
  const t = useT();
  const [creating, setCreating] = useState(false), [name, setName] = useState(''), [role, setRole] = useState<PersonRole>('family_helper'), [profileLanguage, setProfileLanguage] = useState(language);
  const roles = ['resident', 'family_helper', 'volunteer'] as const;
  const primary = roles.map((value) => people.find((person) => person.role === value)).filter((person): person is Person => !!person);
  const others = people.filter((person) => !primary.includes(person));
  return <StartShell title={t('setup.who')}><SetupProgress step={2} {...(onBack ? { onBack } : {})} /><div className="people-list">{primary.map((person) => <button key={person.id} className="role-card" onClick={() => onChoose(person.id)}><IconTile name={person.role === 'resident' ? 'home' : person.role === 'family_helper' ? 'people' : 'requests'} /><span><strong>{t(`setup.role.${person.role}`)}</strong><small>{t(`setup.role.${person.role}.body`, { name: person.name })}</small></span><Icon name="chevron" /></button>)}</div>
    {others.length ? <details className="other-profiles"><summary>{t('setup.otherProfiles')}</summary><div className="people-list">{others.map((person) => <button key={person.id} className="person-row secondary" onClick={() => onChoose(person.id)}><span className="avatar" aria-hidden="true">{person.name.slice(0, 1)}</span><span><strong>{person.name}</strong><small>{t(`role.${person.role}`)}</small></span><Icon name="chevron" /></button>)}</div></details> : null}
    <button className="plain full" onClick={() => setCreating(!creating)} aria-expanded={creating}>{t('person.create')}</button>
    {creating ? <form className="card stack" onSubmit={async (event) => { event.preventDefault(); const id = `person-${crypto.randomUUID().slice(0, 20)}`; const result = await dispatch({ type: 'create_person', personId: id, name: name.trim(), role, language: profileLanguage }); if (result.ok) await onChoose(id, true); }}>
      <label>{t('person.name')}<input value={name} maxLength={40} required onChange={(event) => setName(event.target.value)} autoComplete="off" /></label>
      <label>{t('person.role')}<select value={role} onChange={(event) => setRole(event.target.value as PersonRole)}>{roles.map((value) => <option key={value} value={value}>{t(`role.${value}`)}</option>)}</select></label>
      {role === 'resident' ? <p className="notice">{t('person.oneResident')}</p> : null}
      <label>{t('nav.language')}<select value={profileLanguage} onChange={(event) => setProfileLanguage(event.target.value as Language)}>{LANGUAGES.map(({ code, nativeName }) => <option key={code} value={code}>{nativeName}</option>)}</select></label>
      <button disabled={!name.trim() || role === 'resident'}>{t('person.createButton')}</button>
    </form> : null}<p className="footnote setup-footnote">{t('setup.demo')}</p>
  </StartShell>;
}
export function GuideScreen({ person, residentName, dispatch, onExit, onBack, canScan = true }: { person: Person; residentName: string; dispatch: Dispatch; onExit(skipped: boolean, destination?: Route): void; onBack?(): void; canScan?: boolean }) {
  const t = useT(), progress = guideProgress(person), step = progress.stepIndex, kind = person.role === 'volunteer' ? 'volunteer' : 'resident', privacy = step === 3;
  const cardHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { cardHeading.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [step]);
  async function move(next: number, completed = false, destination?: Route) {
    if ((await dispatch({ type: 'set_onboarding', guideId: guideIdFor(person), stepIndex: next, completed })).ok && completed) await onExit(false, destination);
  }
  const illustration = privacy ? 'privacy' : kind === 'volunteer' ? (['shared', 'calendar', 'done'] as const)[step as 0 | 1 | 2] : (['scan', 'review', 'help'] as const)[step as 0 | 1 | 2];
  return <StartShell title={t(privacy ? 'setup.privacy.header' : 'setup.how')}><SetupProgress step={privacy ? 4 : 3} onBack={() => step > 0 ? void move(step - 1) : onBack?.()} onSkip={() => void skipGuide(person, dispatch, onExit)} />
    <div className="guide stack"><Illustration kind={illustration} />{privacy ? <><h2 ref={cardHeading} tabIndex={-1}>{t('setup.privacy.title')}</h2><ul className="privacy-checks">{(['device', 'upload', 'erase'] as const).map((key) => <li key={key}><Icon name="check-circle" /><span>{t(`setup.privacy.${key}`)}</span></li>)}</ul>
      <button className="full" onClick={() => move(3, true, person.role === 'volunteer' ? { role: 'v', screen: 'home' } : canScan ? { role: 'r', screen: 'room', id: 'living-room' } : { role: 'r', screen: 'home' })}>{t(person.role === 'volunteer' ? 'setup.getStarted' : canScan ? 'setup.firstScan' : 'setup.goHome')}</button>{person.role === 'family_helper' && !canScan ? <p className="footnote">{t('setup.helperAccess')}</p> : null}{person.role !== 'volunteer' && canScan ? <button className="secondary full" onClick={() => move(3, true, { role: 'r', screen: 'home' })}>{t('setup.goHome')}</button> : null}</> : <><div className="panel-count footnote">{t('setup.panel', { current: step + 1, total: 3 })}</div><h2 ref={cardHeading} tabIndex={-1}>{t(`guide.${kind}.${step as 0 | 1 | 2}.title`)}</h2><p className="guide-body">{t(`guide.${kind}.${step as 0 | 1 | 2}.body`)}</p>{person.role === 'family_helper' ? <p className="footnote">{t('guide.helper', { name: residentName })}</p> : null}<button className="full" onClick={() => move(step + 1)}>{t('nav.next')}</button></>}
    </div>
  </StartShell>;
}
