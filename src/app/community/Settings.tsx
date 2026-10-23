import { useState } from 'react';
import type { Account, CommunityState, Language } from '../../community/types';
import { useT } from '../../i18n';
import { Button, LanguageSelect, Sheet } from './UI';
export type TextSize = 'normal' | 'large' | 'larger';
export function Settings({ account, state, textSize, onSize, onLanguage, onSwitch, onSignOut, onClassic, onReset, onClose }: {
    account: Account;
    state: CommunityState;
    textSize: TextSize;
    onSize(s: TextSize): void;
    onLanguage(l: Language): void;
    onSwitch(): void;
    onSignOut(): void;
    onClassic(): void;
    onReset(): Promise<boolean>;
    onClose(): void;
}) {
    const t = useT(), [resetting, setResetting] = useState(false), [confirm, setConfirm] = useState(false), [error, setError] = useState(false);
    const linked = account.role === 'elder' ? state.elders.find((e) => e.accountId === account.id)?.familyIds ?? [] : state.families.find((f) => f.accountId === account.id)?.elderIds ?? [];
    return <Sheet title={t('c.settings.title')} onClose={onClose}><div className="c-stack"><LanguageSelect value={account.language} onChange={onLanguage}/><fieldset className="c-fieldset"><legend>{t('c.settings.size')}</legend><div className="c-chips">{(['normal', 'large', 'larger'] as const).map((s) => <button key={s} className="c-chip" aria-pressed={textSize === s} onClick={() => onSize(s)}>{t(`c.settings.${s}`)}</button>)}</div></fieldset>{account.role !== 'volunteer' ? <section><h3>{t('c.family.linked')}</h3><p>{t('c.family.access')}</p>{linked.length ? <ul>{linked.map((id) => <li key={id}>{state.accounts.find((a) => a.id === id)?.name}</li>)}</ul> : null}</section> : null}<Button kind="secondary" onClick={onClassic}>{t('c.settings.classic')}</Button><Button kind="secondary" onClick={onSwitch}>{t('c.settings.switch')}</Button><Button kind="quiet" onClick={onSignOut}>{t('c.settings.signout')}</Button><details className="c-about"><summary>{t('c.settings.about')}</summary><p>{t('c.settings.font')}</p><p>{t('c.settings.map')} <a href="https://www.openstreetmap.org/copyright">{t('c.map.credit')}</a></p><p>{t('c.settings.ai')}</p><p>{t('c.settings.people')}</p></details>{confirm ? <div className="c-reset-confirm"><p>{t('c.settings.resetAsk')}</p><Button disabled={resetting} onClick={() => { setResetting(true); void onReset().then((ok) => { if (!ok) {
        setError(true);
        setResetting(false);
    } }); }}>{t(resetting ? 'c.loading' : 'c.settings.reset')}</Button><Button kind="quiet" disabled={resetting} onClick={() => setConfirm(false)}>{t('c.cancel')}</Button></div> : <Button kind="quiet" onClick={() => setConfirm(true)}>{t('c.settings.reset')}</Button>}{error ? <p role="alert">{t('c.settings.resetFailed')}</p> : null}</div></Sheet>;
}
