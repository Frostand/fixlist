import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import * as domain from '../../community';
import { canManageElder } from '../../community/commands';
import { completeAccountSetup } from '../../community/setup';
import type { Account, AccountRole, Language, SignInProvider } from '../../community/types';
import { applyDocumentLanguage, I18nProvider, useT } from '../../i18n';
import { discardAllNativeCaptures } from '../../lib/native-capture';
import { resetCaptureStorage } from '../../lib/capture-storage';
import { Intro, RoleChoice, Setup, SignIn, DemoAccountChoices, type SetupValues } from './Onboarding';
import { AskScreen, Confirmation, ElderHome, ProgressTracker, RequestList, type Draft } from './Elder';
import { JobCard } from './JobCard';
import { DraftScreen } from './DraftScreen';
export { DraftScreen } from './DraftScreen';
import { Messages } from './Messages';
import { Nearby, ServiceHours, VolunteerEditor, VolunteerJob, VolunteerProfileScreen } from './Volunteer';
import { Settings, type TextSize } from './Settings';
import { Avatar, Back, Button, Heading, Icon, Sheet, type IconName } from './UI';
import { useCommunity, type CommunityController } from './useCommunity';
const RoomCapture = lazy(() => import('./RoomCapture').then((m) => ({ default: m.RoomCapture })));
export interface CommunityRoute {
    screen: string;
    id: string;
}
export function parseCommunityRoute(hash: string): CommunityRoute { const parts = hash.replace(/^#\/?/, '').split('/'); return parts[0] === 'c' ? { screen: parts[1] || 'home', id: decodeSafe(parts[2] ?? '') } : { screen: 'home', id: '' }; }
function decodeSafe(value: string) { try {
    return decodeURIComponent(value);
}
catch {
    return '';
} }
export function goCommunity(path: string) { window.location.hash = `/c/${path}`; }
export function roleHome(role: AccountRole) { return role === 'volunteer' ? 'nearby' : 'home'; }
function useRoute() { const [route, setRoute] = useState(() => parseCommunityRoute(typeof window === 'undefined' ? '' : window.location.hash)); useEffect(() => { const sync = () => setRoute(parseCommunityRoute(window.location.hash)); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []); useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); document.querySelector<HTMLElement>('[data-screen-heading]')?.focus(); }, [route.screen, route.id]); return route; }
export function CommunityApp() { const controller = useCommunity(), [guestLanguage, setGuestLanguage] = useState<Language>('en'); const language = controller.account?.language ?? guestLanguage; return <I18nProvider language={language}><CommunityBody controller={controller} language={language} onGuestLanguage={setGuestLanguage}/></I18nProvider>; }
export function AccountHeader({ account, onSettings }: {
    account: Account;
    onSettings(): void;
}) { const t = useT(); return <header className="c-app-header"><a className="c-wordmark" href={`#/c/${roleHome(account.role)}`}><Icon name="leaf"/>{t('c.brand')}</a><button className="c-avatar-button" onClick={onSettings}><Avatar name={account.name} tone={account.avatarTone}/><span>{t('c.settings')}</span></button></header>; }
export function Tabs({ account, screen }: {
    account: Account;
    screen: string;
}) { const t = useT(); const tabs: readonly [
    string,
    'c.home' | 'c.myHelp' | 'c.nearby' | 'c.myJobs' | 'c.profile',
    IconName
][] = account.role === 'volunteer' ? [['nearby', 'c.nearby', 'pin'], ['jobs', 'c.myJobs', 'help'], ['profile', 'c.profile', 'person']] : [['home', 'c.home', 'home'], ['help', 'c.myHelp', 'help']]; return <nav className="c-tabs" aria-label={t('c.brand')}>{tabs.map(([path, key, icon]) => <a key={path} href={`#/c/${path}`} aria-current={screen === path ? 'page' : undefined}><Icon name={icon}/><span>{t(key)}</span></a>)}</nav>; }
export function CommunityBody({ controller: c, language, onGuestLanguage }: {
    controller: CommunityController;
    language: Language;
    onGuestLanguage(l: Language): void;
}) {
    const t = useT(), route = useRoute();
    const [settings, setSettings] = useState(false), [size, setSize] = useState<TextSize>('normal'), [provider, setProvider] = useState<SignInProvider>('email'), [draft, setDraft] = useState<Draft | null>(null), [notice, setNotice] = useState(''), [switching, setSwitching] = useState(false);
    const [setupLanguage, setSetupLanguage] = useState<Language | null>(null);
    const { state, account } = c;
    const latestState = useRef(state), mounted = useRef(true);
    latestState.current = state;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { const root = document.documentElement, oldSize = root.style.fontSize; root.dataset.community = 'true'; root.style.fontSize = size === 'normal' ? '100%' : size === 'large' ? '112.5%' : '125%'; return () => { delete root.dataset.community; root.style.fontSize = oldSize; }; }, [size]);
    useEffect(() => { setDraft(null); setSettings(false); setSetupLanguage(null); }, [account?.id, c.resetEpoch]);
    function draftJob(d: Draft) { setDraft(d); goCommunity('draft'); }
    function signIn(id: string, _provider: SignInProvider) { setNotice(''); setSwitching(false); const r = c.run((s) => domain.signIn(s, id)); if (r.ok) {
        const a = domain.currentAccount(r.state)!;
        goCommunity(r.state.session.onboarded.includes(id) ? roleHome(a.role) : `setup/${a.role}`);
    } }
    function setup(v: SetupValues) { const r = c.run((s) => completeAccountSetup(s, account?.id ?? null, v, provider, new Date().toISOString())); if (r.ok) {
        if (v.role === 'family')
            setNotice(t('c.setup.unsavedPreferences'));
        goCommunity(roleHome(v.role));
    } }
    const elderId = account?.role === 'elder' ? account.id : state.families.find((f) => f.accountId === account?.id)?.elderIds[0];
    const elder = state.accounts.find((a) => a.id === elderId);
    const elderJobs = elderId ? domain.jobsForElder(state, elderId) : [];
    let screen = route.screen;
    if (!account && !['intro', 'signin', 'role', 'setup', 'accounts'].includes(screen))
        screen = 'intro';
    if (account && (['intro', 'signin', 'role', 'accounts'].includes(screen) || account.role === 'volunteer' && screen === 'home'))
        screen = roleHome(account.role);
    if (account && (account.role === 'elder' || account.role === 'volunteer') && !state.session.onboarded.includes(account.id))
        screen = 'setup';
    // The setup provider may preview an unsaved language; restore the app locale when leaving it.
    useEffect(() => { if (screen !== 'setup') applyDocumentLanguage(language, document.documentElement); }, [screen, language]);
    const landing = screen === 'intro', firstRun = ['intro', 'signin', 'role', 'setup', 'accounts'].includes(screen);
    const mainRoute = account ? roleHome(account.role) : 'intro';
    let content: ReactNode;
    if (screen === 'intro')
        content = <Intro language={language} volunteer={domain.accountsByRole(state, 'volunteer')[0] ?? null} onLanguage={onGuestLanguage} onStart={() => goCommunity('signin')}/>;
    else if (screen === 'accounts')
        content = <Heading>{t('c.signin.choose')}</Heading>;
    else if (screen === 'signin')
        content = <SignIn groups={{ elder: domain.accountsByRole(state, 'elder'), volunteer: domain.accountsByRole(state, 'volunteer'), family: domain.accountsByRole(state, 'family') }} onSignIn={signIn} onCreate={(p) => { setProvider(p); goCommunity('role'); }} onBack={() => goCommunity('intro')}/>;
    else if (screen === 'role')
        content = <RoleChoice onSelect={(r) => goCommunity(`setup/${r}`)} onBack={() => goCommunity('signin')}/>;
    else if (screen === 'setup') {
        const role: AccountRole = account?.role ?? (['elder', 'volunteer', 'family'].includes(route.id) ? route.id as AccountRole : 'elder');
        const selectedLanguage = setupLanguage ?? language;
        content = <I18nProvider language={selectedLanguage}><Setup key={`${account?.id ?? 'new'}-${c.resetEpoch}-${role}`} role={role} language={selectedLanguage} elders={domain.accountsByRole(state, 'elder')} onLanguage={setSetupLanguage} onComplete={setup} onBack={() => {
            if (account) { const result = c.run(domain.signOut); if (result.ok) goCommunity('signin'); }
            else goCommunity('role');
        }}/></I18nProvider>;
    }
    else if (!account)
        content = null;
    else if (screen === 'draft')
        content = draft && elder ? <DraftScreen draft={draft} onChange={setDraft} onPost={(preferredSlots, analysis) => { const result = c.run((s) => domain.postJob(s, { actorId: account.id, elderId: elder.id, source: draft.source, originalText: draft.text, analysis, evidence: draft.evidence, preferredSlots }, new Date().toISOString())); if (result.ok) {
            setDraft(null);
            goCommunity('help');
        } return result.ok; }}/> : <Missing onHome={() => goCommunity(mainRoute)}/>;
    else if (screen === 'type' || screen === 'talk')
        content = elder ? <AskScreen key={`${account.id}-${c.resetEpoch}-${screen}`} talk={screen === 'talk'} account={account} onDraft={draftJob} onPost={(nextDraft, preferredSlots, analysis) => {
            const result = c.run(s => domain.postJob(s, { actorId: account.id, elderId: elder.id, source: nextDraft.source, originalText: nextDraft.text, analysis, evidence: nextDraft.evidence, preferredSlots }, new Date().toISOString()));
            if (result.ok) goCommunity('help');
            return result.ok;
        }}/> : <Missing onHome={() => goCommunity(mainRoute)}/>;
    else if (screen === 'rooms') {
        const ownerId = domain.currentAccount(state)?.id === account.id
            ? (account.role === 'elder' ? [account.id] : state.families.find(f => f.accountId === account.id)?.elderIds ?? []).find(id => canManageElder(state, account.id, id))
            : undefined;
        content = ownerId && c.resetEpoch ? <Suspense fallback={<p role="status">{t('c.loading')}</p>}><RoomCapture key={JSON.stringify([account.id, c.resetEpoch, ownerId])} ownerId={ownerId} resetEpoch={c.resetEpoch} onDraft={(analysis, evidence) => draftJob({ analysis, source: 'scan', text: evidence.label, evidence: [evidence] })} onType={() => goCommunity('type')}/></Suspense> : <Missing onHome={() => goCommunity(mainRoute)}/>;
    }
    else if (screen === 'home')
        content = elder ? <ElderHome account={account} elder={elder} state={state} jobs={elderJobs} onNavigate={goCommunity} onDraft={draftJob}/> : <><Heading>{t('c.family.title', { name: account.firstName })}</Heading><p>{t('c.family.noLink')}</p><Button onClick={() => { c.run(domain.signOut); setNotice(''); goCommunity('signin'); }}>{t('c.settings.switch')}</Button></>;
    else if (screen === 'help')
        content = <><Heading>{t('c.myHelp')}</Heading><RequestList state={state} jobs={elderJobs} onOpen={(id) => goCommunity(`job/${id}`)}/></>;
    else if (screen === 'nearby' && account.role === 'volunteer')
        content = <Suspense fallback={<p role="status">{t('c.loading')}</p>}><Nearby state={state} account={account} onOpen={(id) => goCommunity(`job/${id}`)}/></Suspense>;
    else if (screen === 'jobs' && account.role === 'volunteer')
        content = <><Heading>{t('c.myJobs')}</Heading><RequestList state={state} jobs={domain.jobsForVolunteer(state, account.id)} onOpen={(id) => goCommunity(`job/${id}`)}/></>;
    else if (screen === 'profile' && account.role === 'volunteer')
        content = <VolunteerProfileScreen state={state} account={account} onEdit={() => goCommunity('edit-profile')} onLog={() => goCommunity('log')}/>;
    else if (screen === 'edit-profile' && account.role === 'volunteer') {
        const p = state.volunteers.find((v) => v.accountId === account.id);
        content = p ? <VolunteerEditor profile={p} onSave={({ accountId: _id, ...patch }) => c.run((s) => domain.updateVolunteerProfile(s, account.id, patch)).ok} onBack={() => goCommunity('profile')}/> : null;
    }
    else if (screen === 'log' && account.role === 'volunteer')
        content = <ServiceHours state={state} account={account}/>;
    else if (['job', 'confirm', 'messages'].includes(screen))
        content = <JobRoute controller={c} account={account} screen={screen} id={route.id} onHome={() => goCommunity(mainRoute)}/>;
    else
        content = <Missing onHome={() => goCommunity(mainRoute)}/>;
    return <div className={`community ${account?.role === 'volunteer' ? 'c-volunteer' : 'c-elder'} ${landing ? 'c-is-landing' : ''}`}><a className="c-skip" href="#c-content" onClick={(e) => { e.preventDefault(); document.getElementById('c-content')?.focus(); }}>{t('c.skip')}</a>{account && !firstRun ? <AccountHeader account={account} onSettings={() => setSettings(true)}/> : null}<main id="c-content" tabIndex={-1} className={landing ? 'c-landing-main' : 'c-main'}>{!firstRun && !['home', 'help', 'nearby', 'jobs', 'profile'].includes(screen) ? <Back onClick={() => goCommunity(mainRoute)}/> : null}{c.issue ? <p className="c-notice" role="alert">{t(c.issue === 'storage' ? 'c.storageError' : c.issue === 'recovered' ? 'c.storageRecovered' : 'c.commandError')}</p> : null}{notice ? <p className="c-notice" role="status">{notice}</p> : null}{content}</main>{account && !firstRun ? <Tabs account={account} screen={screen}/> : null}{!account && (switching || screen === 'accounts') ? <Sheet title={t('c.signin.choose')} onClose={() => { setSwitching(false); goCommunity('intro'); }}><DemoAccountChoices groups={{ elder: domain.accountsByRole(state, 'elder'), volunteer: domain.accountsByRole(state, 'volunteer'), family: domain.accountsByRole(state, 'family') }} onSelect={id => signIn(id, provider)} onCreate={() => { setSwitching(false); goCommunity('role'); }}/></Sheet> : null}{settings && account ? <Settings account={account} state={state} textSize={size} onSize={setSize} onLanguage={(l) => { c.run((s) => domain.updateLanguage(s, account.id, l)); }} onClose={() => setSettings(false)} onSwitch={() => { const result = c.run(domain.signOut); if (result.ok) { setNotice(''); setSettings(false); setSwitching(true); goCommunity('accounts'); } }} onSignOut={() => { c.run(domain.signOut); setNotice(''); setSettings(false); goCommunity('intro'); }} onClassic={() => { try {
        localStorage.setItem('fixlist.mode', 'classic');
        window.location.hash = '/r/home';
        window.location.reload();
    }
    catch {
        setNotice(t('c.storageError'));
    } }} onReset={async () => {
        if (!mounted.current || latestState.current !== state) return false;
        const reset = c.reset();
        if (reset?.ok === false) return false;
        const resetState = reset?.ok ? reset.state : state;
        latestState.current = resetState;
        const isCurrent = () => mounted.current && latestState.current === resetState;
        setNotice(''); setSize('normal'); setSettings(false); goCommunity('intro');
        try {
            const cleared = await resetCaptureStorage();
            if (!isCurrent()) return false;
            const native = await discardAllNativeCaptures();
            if (!isCurrent()) return false;
            if (cleared.ok && native.ok) return true;
        } catch { /* Cleanup cannot roll back the committed community reset. */ }
        if (isCurrent()) setNotice(t('error.reset'));
        return false;
    }}/> : null}</div>;
}
export function Missing({ onHome }: {
    onHome(): void;
}) { const t = useT(); return <div className="c-stack"><Heading>{t('c.notFound')}</Heading><Button onClick={onHome}>{t('c.home')}</Button></div>; }
function JobRoute({ controller: c, account, screen, id, onHome }: {
    controller: CommunityController;
    account: Account;
    screen: string;
    id: string;
    onHome(): void;
}) {
    const t = useT(), [cancelling, setCancelling] = useState(false);
    const { state } = c;
    const visible = domain.visibleJob(state, id, account.id);
    const allowed = visible && (account.role === 'volunteer' ? (visible.job.status === 'open' || visible.job.volunteerId === account.id) : domain.jobsForElder(state, visible.elder.id).some((j) => j.id === id) && (account.id === visible.elder.id || state.families.some((f) => f.accountId === account.id && f.elderIds.includes(visible.elder.id))));
    if (!visible || !allowed)
        return <Missing onHome={onHome}/>;
    const { job, elder, address } = visible;
    const volunteer = state.accounts.find((a) => a.id === job.volunteerId);
    const participant = account.role !== 'volunteer' || job.volunteerId === account.id;
    if (screen === 'messages')
        return participant ? <Messages key={`${account.id}-${id}`} state={state} account={account} job={job} run={c.run}/> : <Missing onHome={onHome}/>;
    if (screen === 'confirm')
        return account.role !== 'volunteer' && (job.status === 'reported-done' || job.status === 'completed') ? <Confirmation job={job} volunteerName={volunteer?.firstName ?? ''} onConfirm={() => c.run((s) => domain.confirmDone(s, { jobId: id, actorId: account.id }, new Date().toISOString())).ok} onRate={(stars, note) => c.run((s) => domain.rateJob(s, { jobId: id, actorId: account.id, stars, note }, new Date().toISOString())).ok} onBack={() => goCommunity('help')}/> : <Missing onHome={onHome}/>;
    if (account.role === 'volunteer') {
        const profile = state.volunteers.find((v) => v.accountId === account.id);
        if (!profile)
            return <Missing onHome={onHome}/>;
        return <VolunteerJob key={id} job={job} elder={elder} address={address} profile={profile} needs={state.elders.find(e => e.accountId === elder.id)?.needs ?? []} match={domain.matchesForJob(state, id, new Date().toISOString()).find((m) => m.volunteerId === account.id) ?? null} onAccept={(scheduledFor) => c.run((s) => domain.acceptJob(s, { jobId: id, volunteerId: account.id, scheduledFor }, new Date().toISOString())).ok} onStep={(step, note) => c.run((s) => step === 'trip' ? domain.startTrip(s, { jobId: id, volunteerId: account.id }, new Date().toISOString()) : step === 'arrive' ? domain.arrive(s, { jobId: id, volunteerId: account.id }, new Date().toISOString()) : domain.reportDone(s, { jobId: id, volunteerId: account.id, ...(note ? { note } : {}) }, new Date().toISOString())).ok} onMessages={() => goCommunity(`messages/${id}`)}/>;
    }
    return <div className="c-stack"><Heading>{t('c.job.details')}</Heading><ProgressTracker status={job.status}/><JobCard analysis={job.analysis} evidence={job.evidence} slots={job.preferredSlots}/>{volunteer ? <p>{t('c.volunteer.assigned', { name: volunteer.firstName })}</p> : null}{job.status === 'reported-done' || job.status === 'completed' && !job.rating ? <Button onClick={() => goCommunity(`confirm/${id}`)}>{t(job.status === 'reported-done' ? 'c.confirm.title' : 'c.confirm.thanks', { name: volunteer?.firstName })}</Button> : null}{job.volunteerId ? <Button kind="secondary" icon="message" onClick={() => goCommunity(`messages/${id}`)}>{t('c.messages')}</Button> : null}{!['completed', 'cancelled'].includes(job.status) ? <Button kind="quiet" onClick={() => setCancelling(true)}>{t('c.job.cancel')}</Button> : null}{cancelling ? <Sheet title={t('c.job.cancelConfirm')} onClose={() => setCancelling(false)}><Button onClick={() => { if (c.run((s) => domain.cancelJob(s, { jobId: id, actorId: account.id }, new Date().toISOString())).ok)
        setCancelling(false); }}>{t('c.job.cancel')}</Button><Button kind="quiet" onClick={() => setCancelling(false)}>{t('c.job.keep')}</Button></Sheet> : null}</div>;
}
