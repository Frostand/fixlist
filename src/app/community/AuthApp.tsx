import { useEffect, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { AuthController } from '../../auth/controller';
import { readAuthConfig, type AuthConfiguration } from '../../auth/config';
import { nativeAuth, nativeAuthAvailable, nativeAuthStorage } from '../../auth/native';
import { createSupabaseGateway } from '../../auth/supabase';
import { pendingWebCallback, finishWebCallback } from '../../auth/web-callback';
import type { AuthState, ProfileInput } from '../../auth/types';
import type { Language } from '../../community/types';
import { authCopy as a } from '../../i18n/auth';
import { I18nProvider, LANGUAGES } from '../../i18n';
import { Setup, type SetupValues } from './Onboarding';
import { Button, Heading, Icon } from './UI';
import './auth.css';

interface AuthRuntime { configuration: AuthConfiguration; controller: AuthController | null }
export function createAuthRuntime(): AuthRuntime {
    const native = Capacitor.isNativePlatform();
    const configuration = readAuthConfig(import.meta.env, window.location.origin, native, nativeAuthAvailable());
    if (!configuration.config) return { configuration, controller: null };
    try {
        const storage = native ? nativeAuthStorage() : window.localStorage;
        // Probe web persistence before constructing SDK. Native Keychain errors fail in the controller.
        if (!native) { const key = `${configuration.config.storageKey}:probe`; storage.setItem(key, '1'); storage.removeItem(key); }
        return { configuration, controller: new AuthController(createSupabaseGateway(configuration.config, storage, native ? nativeAuth : null)) };
    } catch { return { configuration: { config: null, reason: 'invalid-config' }, controller: null }; }
}
// StrictMode runs state initializers twice in development; use one SDK client per page/project.
let runtimeForPage: AuthRuntime | undefined;
function pageRuntime() { return runtimeForPage ??= createAuthRuntime(); }
const initial: AuthState = { phase: 'loading', busy: false, session: null, workspace: null, profile: null, message: null };

/** Real auth is the default. Merely loading this shell never reads or creates the demo store. */
export default function AuthApp({ demo }: { demo: ReactNode }) {
    const [runtime] = useState(pageRuntime), [mode, setMode] = useState<'live' | 'demo'>('live');
    const [state, setState] = useState(initial);
    const c = runtime.controller;
    useEffect(() => { const prior = document.title; document.title = mode === 'live' ? a.realTitle : a.demoTitle; return () => { document.title = prior; }; }, [mode]);
    useEffect(() => {
        document.documentElement.dataset.community = 'true';
        return () => { delete document.documentElement.dataset.community; };
    }, []);
    useEffect(() => {
        if (!c) return;
        const unsubscribe = c.subscribe(() => setState(c.state));
        let alive = true, removeNative: (() => void) | undefined;
        const callback = async (url: string) => { if (alive) await c.callback(url); };
        const isNative = Capacitor.isNativePlatform();
        const incoming = isNative ? null : pendingWebCallback(window.location, window.history);
        const started = c.start();
        void (async () => {
            if (isNative) {
                const listener = await nativeAuth.addListener('authUrl', data => { void callback(data.url); });
                if (!alive) { await listener.remove(); return; }
                removeNative = () => { void listener.remove(); };
                const active = await nativeAuth.addListener('authActive', data => {
                    c.gateway.setForeground?.(data.active);
                    if (data.active && !c.state.busy) void c.refresh();
                });
                if (!alive) { await listener.remove(); await active.remove(); return; }
                c.gateway.setForeground?.(true);
                removeNative = () => { void listener.remove(); void active.remove(); c.gateway.setForeground?.(false); };
                const launch = await nativeAuth.getLaunchUrl(); if (launch.url) await callback(launch.url);
            } else if (incoming) { await callback(incoming); if (alive) finishWebCallback(incoming); }
            await started;
        })().catch(() => { if (alive) setState({ ...initial, phase: 'signed-out', message: 'auth-error' }); });
        return () => { alive = false; unsubscribe(); removeNative?.(); c.dispose(); };
    }, [c]);
    async function openDemo() {
        if (c) await c.signOut();
        window.location.hash = '/c/intro';
        setMode('demo');
    }
    if (mode === 'demo') return <><div className="fl-auth-demo-banner" role="status" lang="en" dir="ltr"><strong>{a.demoMode}</strong>{a.demoNotice}<button type="button" onClick={() => { setMode('live'); if (c) void c.refresh(); }}>{a.realSignIn}</button></div>{demo}</>;
    return <I18nProvider language="en"><AuthScreen key={state.workspace?.namespace ?? 'signed-out'} state={state} controller={c} configuration={runtime.configuration} onDemo={() => { void openDemo(); }}/></I18nProvider>;
}

export function AuthScreen({ state, controller: c, configuration, onDemo }: { state: AuthState; controller: AuthController | null; configuration: AuthConfiguration; onDemo(): void }) {
    const [form, setForm] = useState<'login' | 'register' | 'reset'>('login'), [email, setEmail] = useState(''), [password, setPassword] = useState('');
    const [role, setRole] = useState<ProfileInput['role'] | null>(null), [language, setLanguage] = useState<Language>('en');
    const cfg = configuration.config;
    const unavailable = !c || !cfg;
    let content: ReactNode;
    if (state.phase === 'loading' && c) content = <p role="status">{a.checking}</p>;
    else if (state.phase === 'recovery' && c) content = <><Heading>{a.recoveryTitle}</Heading><form className="c-stack" onSubmit={e => { e.preventDefault(); const next = password; setPassword(''); void c.updatePassword(next); }}><label className="c-field">{a.newPassword}<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)}/></label><Button type="submit" disabled={state.busy}>{a.savePassword}</Button></form></>;
    else if (state.phase === 'profile-error') content = <><Heading>{a.profileError}</Heading><p>{a.profileErrorBody}</p><Button disabled={state.busy} onClick={() => { void c?.refresh(); }}>{a.retry}</Button></>;
    else if (state.phase === 'onboarding' && c) content = <><p>{a.setupIntro}</p>{!role ? <><Heading>{a.setupTitle}</Heading><Button onClick={() => setRole('elder')}>{a.elder}</Button><Button kind="secondary" onClick={() => setRole('volunteer')}>{a.volunteer}</Button><p>{a.noFamily}</p></> : <I18nProvider language={language}><div lang={language} dir={LANGUAGES.find(l => l.code === language)!.dir}><fieldset className="fl-auth-setup" disabled={state.busy}><Setup key={`${state.workspace?.namespace}:${role}`} role={role} language={language} elders={[]} onLanguage={setLanguage} onBack={() => setRole(null)} onComplete={(v: SetupValues) => { const { elderId: _unused, ...preferences } = v; if (preferences.role !== 'family') void c.saveProfile({ ...preferences, role: preferences.role }); }}/></fieldset></div></I18nProvider>}</>;
    else if (state.phase === 'ready' && state.profile) content = <><Heading intro={a.saved}>{a.welcome}, {state.profile.name}</Heading><p>{a.role}: {state.profile.role === 'elder' ? a.elderRole : a.volunteerRole} · {state.profile.area}</p><section className="c-stack" aria-label={a.featuresLabel}><h2>{a.noCommunityTitle}</h2><p>{a.noCommunity}</p><p>{a.noCapture}</p></section></>;
    else content = <><Heading intro={a.intro}>{a.title}</Heading>{unavailable ? <p role="status">{configuration.reason === 'native-unavailable' ? a.missingNative : a.missingBackend}</p> : null}<form className="c-stack" onSubmit={e => {
        e.preventDefault(); if (!c || unavailable) return;
        const next = password; setPassword('');
        if (form === 'register') void c.register(email.trim(), next);
        else if (form === 'reset') void c.requestReset(email.trim());
        else void c.signIn(email.trim(), next);
    }}><h2>{form === 'register' ? a.createTitle : form === 'reset' ? a.resetTitle : a.emailLogin}</h2><label className="c-field">{a.email}<input type="email" name="email" autoComplete="email" required maxLength={254} disabled={unavailable || state.busy} value={email} onChange={e => setEmail(e.target.value)}/></label>{form !== 'reset' ? <label className="c-field">{a.password}<input type="password" name="password" autoComplete={form === 'register' ? 'new-password' : 'current-password'} required minLength={form === 'register' ? 12 : 1} maxLength={128} disabled={unavailable || state.busy} value={password} onChange={e => setPassword(e.target.value)}/></label> : null}<Button type="submit" disabled={unavailable || state.busy}>{form === 'register' ? a.create : form === 'reset' ? a.sendReset : a.login}</Button></form><div className="fl-auth-links">{(['login', 'register', 'reset'] as const).filter(v => v !== form).map(v => <Button key={v} kind="quiet" disabled={state.busy} onClick={() => { setPassword(''); setForm(v); }}>{v === 'login' ? a.emailLogin : v === 'register' ? a.create : a.forgot}</Button>)}{state.message === 'confirmation' ? <Button kind="quiet" disabled={state.busy || !email} onClick={() => { void c?.resendConfirmation(email.trim()); }}>{a.resend}</Button> : null}</div><div className="c-stack"><Button kind="secondary" disabled={unavailable || state.busy || !cfg?.google} onClick={() => { void c?.oauth('google'); }}>{a.google}{!cfg?.google ? a.unavailable : ''}</Button><Button kind="secondary" disabled={unavailable || state.busy || !(cfg?.native ? cfg.appleNative : cfg?.appleWeb)} onClick={() => { void c?.oauth('apple'); }}>{a.apple}{!(cfg?.native ? cfg.appleNative : cfg?.appleWeb) ? a.unavailable : ''}</Button></div></>;
    return <div className="community fl-auth c-elder" lang="en" dir="ltr"><main className="c-main c-narrow"><header className="c-wordmark"><Icon name="leaf"/>{a.brand}</header><p className="c-small">{a.preview}</p>{state.message ? <p role={state.message === 'auth-error' ? 'alert' : 'status'} className="c-notice">{a.messages[state.message]}</p> : null}{content}{state.busy ? <p role="status">{a.wait}</p> : null}{c && (state.busy || !state.session) ? <Button kind="quiet" onClick={() => { setPassword(''); void c.cancel(); }}>{a.cancel}</Button> : null}{state.session ? <Button kind="quiet" disabled={state.busy} onClick={() => { void c?.signOut(); }}>{a.signOut}</Button> : null}<hr/><Button kind="secondary" disabled={state.busy} onClick={onDemo}>{a.explore}</Button><p className="c-small">{a.demoExplanation}</p><p className="c-small">{a.languageLimit}</p></main></div>;
}
