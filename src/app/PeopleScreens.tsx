import { useEffect, useRef, useState } from 'react';
import type { Language, Person, PersonRole } from '../domain/roles';
import { useT } from '../i18n';
import { guideIdFor, guideProgress } from './view-model';
import { type Dispatch } from './ui-controller';
import { StartShell, type Navigate } from './PhoneShell';
export async function openGuide(person: Person, dispatch: Dispatch, navigate: Navigate): Promise<void> {
  if (!guideProgress(person).completed || (await dispatch({ type: 'set_onboarding', guideId: guideIdFor(person), stepIndex: 0, completed: false })).ok) navigate({ screen: 'guide' });
}
export async function skipGuide(person: Person, dispatch: Dispatch, onExit: (skipped: boolean) => void): Promise<void> {
  if ((await dispatch({ type: 'set_onboarding', guideId: guideIdFor(person), stepIndex: guideProgress(person).stepIndex, completed: false })).ok) await onExit(true);
}
export function LanguagePicker({ onSelect }: { onSelect(language: Language): void }) { return <div className="language-choices"><button lang="en" onClick={() => onSelect('en')}>English</button><button className="secondary" lang="es" onClick={() => onSelect('es')}>Español</button></div>; }
export function PeopleScreen({ people, language, dispatch, onChoose }: { people: readonly Person[]; language: Language; dispatch: Dispatch; onChoose(personId: string, preserveLanguage?: boolean): void }) {
  const t = useT();
  const [creating, setCreating] = useState(false), [name, setName] = useState(''), [role, setRole] = useState<PersonRole>('family_helper'), [profileLanguage, setProfileLanguage] = useState(language);
  return <StartShell title={t('nav.people')}><div className="people-list">{people.map((person) => <button key={person.id} className="person-row secondary" onClick={() => onChoose(person.id)}><span className="avatar" aria-hidden="true">{person.name.slice(0, 1)}</span><span><strong>{person.name}</strong><small>{t(`role.${person.role}`)}</small></span><span aria-hidden="true">›</span></button>)}</div>
    <button className="secondary full" onClick={() => setCreating(!creating)} aria-expanded={creating}>{t('person.create')}</button>
    {creating ? <form className="card stack" onSubmit={async (e) => { e.preventDefault(); const id = `person-${crypto.randomUUID().slice(0, 20)}`; const result = (await dispatch({ type: 'create_person', personId: id, name: name.trim(), role, language: profileLanguage })); if (result.ok) await onChoose(id, true); }}>
      <label>{t('person.name')}<input value={name} maxLength={40} required onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
      <label>{t('person.role')}<select value={role} onChange={(e) => setRole(e.target.value as PersonRole)}>{(['resident', 'family_helper', 'volunteer'] as const).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</select></label>
      {role === 'resident' ? <p className="notice">{t('person.oneResident')}</p> : null}
      <label>{t('nav.language')}<select value={profileLanguage} onChange={(e) => setProfileLanguage(e.target.value as Language)}><option value="en">English</option><option value="es">Español</option></select></label>
      <button disabled={!name.trim() || role === 'resident'}>{t('person.createButton')}</button>
    </form> : null}
  </StartShell>;
}
export function GuideScreen({ person, residentName, dispatch, onExit }: { person: Person; residentName: string; dispatch: Dispatch; onExit(skipped: boolean): void }) {
  const t = useT(), progress = guideProgress(person), step = progress.stepIndex, kind = person.role === 'volunteer' ? 'volunteer' : 'resident';
  const cardHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { cardHeading.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [step]);
  async function move(next: number, completed = false) { if ((await dispatch({ type: 'set_onboarding', guideId: guideIdFor(person), stepIndex: next, completed })).ok && completed) await onExit(false); }
  return <StartShell title={t('nav.guide')}><div className="guide stack"><p className="eyebrow">{t('guide.progress', { current: step + 1, total: 4 })}</p><div className="progress-dots" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i} data-current={i === step} />)}</div>
    <article className="card guide-card"><span className="guide-number" aria-hidden="true">{step + 1}</span><h2 ref={cardHeading} tabIndex={-1}>{t(`guide.${kind}.${step as 0 | 1 | 2 | 3}.title`)}</h2><p>{t(`guide.${kind}.${step as 0 | 1 | 2 | 3}.body`)}</p>{person.role === 'family_helper' ? <p>{t('guide.helper', { name: residentName })}</p> : null}</article>
    <div className="button-row"><button className="secondary" disabled={step === 0} onClick={() => move(step - 1)}>{t('nav.back')}</button><button onClick={() => move(Math.min(3, step + 1), step === 3)}>{t(step === 3 ? 'nav.finish' : 'nav.next')}</button></div><button className="plain" onClick={() => skipGuide(person, dispatch, onExit)}>{t('nav.skip')}</button>
  </div></StartShell>;
}
