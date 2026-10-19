import { shareableScanPins } from '../lib/scan-image';
import { printCurrentPage } from '../lib/native-print';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { demoScenario as scenario } from '../data/demo-scenario';
import { elderNextStep, helperNextStep, volunteerNextStep, visibleRequestsFor, visibleHouseholdFor, hasScope, validateCatalog, type Language, type VolunteerRequestView } from '../domain/workflow';
import { DEMO_STORAGE_KEY, getBrowserStorage, loadDemoState, resetFixListData } from '../lib/demo-storage';
import { createPrintSnapshot, waitForPrintReady } from '../lib/print';
import type { ScanPin } from '../lib/scan-model';
import { loadScan, getScanStore } from '../lib/scan-storage';
import { createSuggestionCatalog, type ScanSuggestionLayer } from '../lib/scan-suggestions';
import { I18nProvider, useT, type MessageKey } from '../i18n';
import type { OperationFailure } from '../domain/failures';
import { createUiDispatch } from './ui-controller';
import { guideProgress } from './view-model';
import { authorizedDestination, homeRoute, launchNavigation, navigationUrl, parseRoute, personDestination, resourceReturnTo, routeHash, usesTabShell, type Route } from './routes';
import { PhoneShell, StartShell, type Navigate } from './PhoneShell';
import { GuideScreen, LanguagePicker, PeopleScreen } from './PeopleScreens';
import { ChecklistQuestion, ResidentHome, ResidentPlan, RoomList } from './ResidentScreens';
import { InvitationReview, ResidentRequest, RequestList, SharingScreen, VolunteerChooser } from './RequestScreens';
import { VolunteerHome, VolunteerTask, VolunteerTasks } from './VolunteerScreens';
import { AccessScreen, HelpScreen, MoreScreen, RecoveryNotice, ResetConfirmation, ResourcesScreen, VolunteerProfile } from './SettingsScreens';
import { RoomPage, CaptureFlow } from './CaptureScreens';
import { ScanPanel } from './ScanPanel';
import { PrintReport } from './PrintReport';
import { createInvitationDraft, emptyNavigationState, loadNavigationState, updateNavigationState, selectedInvitationVolunteer, type NavigationState } from './navigation-state';
import { navigationLayoutParameter, navigationTitleKey } from './navigation-layouts';

/** Equivalent popstate/hashchange events share an epoch; leaving and returning never revives old work. */
export function createCaptureRouteEpoch(initialRoute: Route) {
  let key = routeHash(initialRoute), epoch = 0;
  return {
    move(next: Route) { const nextKey = routeHash(next); if (nextKey !== key) { key = nextKey; epoch++; } },
    capture() { const started = epoch; return () => epoch === started; },
  };
}

export function App() { return validateCatalog(scenario).ok ? <DemoApp /> : <I18nProvider language="en"><Unavailable /></I18nProvider>; }
function Unavailable() { const t = useT(); return <main><h1>{t('app.name')}</h1><p role="alert">{t('error.catalog')}</p></main>; }
function DemoApp() {
  const [initial] = useState(() => { const storage = getBrowserStorage(); return { storage, navigation: loadNavigationState(storage), ...loadDemoState(storage, scenario) }; });
  const [state, setState] = useState(initial.state), current = useRef(initial.state);
  const [launch] = useState(() => launchNavigation(typeof window === 'undefined' ? '' : window.location.hash, typeof window === 'undefined' ? '' : window.location.search, initial.status === 'loaded' || initial.status === 'migrated' ? homeRoute(initial.state.people.find((p) => p.id === initial.state.activePersonId)!.role) : null, initial.navigation.pendingDestination));
  const selectionRequired = useRef(!['loaded', 'migrated'].includes(initial.status) && !(typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('localScan')));
  const [route, setRoute] = useState<Route>(launch.route), routeRef = useRef(route); routeRef.current = route;
  const [captureRouteEpoch] = useState(() => createCaptureRouteEpoch(launch.route));
  const [returnTo, setReturnTo] = useState<Route | null>(() => { const hash = typeof window === 'undefined' ? null : window.history?.state?.fixlistReturnTo; const parsed = typeof hash === 'string' ? parseRoute(hash) : null; return parsed && 'role' in parsed ? parsed : null; });
  const returnRef = useRef(returnTo); returnRef.current = returnTo;
  const [launchLayout] = useState(() => navigationLayoutParameter(typeof window === 'undefined' ? '' : window.location.search));
  const [navigation, setNavigation] = useState<NavigationState>({ ...initial.navigation, pendingDestination: launch.pending, layout: launchLayout ?? initial.navigation.layout });
  const navigationRef = useRef(navigation); navigationRef.current = navigation;
  async function rememberNavigation(update: (saved: NavigationState) => NavigationState, errorKey: MessageKey = 'routing.draftUnsaved') {
    const current = dispatch.capture?.();
    const next = await updateNavigationState(initial.storage, (saved) => !resettingRef.current && (current?.() ?? true) ? update(saved) : null);
    if (!next) { if (!resettingRef.current && (current?.() ?? true)) setError(errorKey); return false; }
    if (resettingRef.current || !(current?.() ?? true)) return false;
    navigationRef.current = next; setNavigation(next); return true;
  }
  useEffect(() => {
    if (launch.pending || launchLayout) void rememberNavigation((saved) => ({ ...saved, pendingDestination: launch.pending, layout: launchLayout ?? saved.layout }), launchLayout ? 'navigation.unsaved' : 'routing.draftUnsaved');
    // A launch override is consumed once, so a later toggle or reset survives reload.
    if (new URLSearchParams(window.location.search).has('nav')) { const url = new URL(window.location.href); url.searchParams.delete('nav'); window.history.replaceState(window.history.state, '', url); }
  }, [initial, launch, launchLayout]);
  const person = state.people.find((p) => p.id === state.activePersonId)!;
  const [launchLanguage, setLaunchLanguage] = useState<Language>(person.language), [languageChosen, setLanguageChosen] = useState(false);
  const [saved, setSaved] = useState(!['invalid', 'unavailable', 'error'].includes(initial.status)), [error, setError] = useState<string | OperationFailure>('');
  const [recovery, setRecovery] = useState<ReturnType<typeof loadDemoState>>(initial);
  const [feedback, setFeedback] = useState(0), [scanPins, setScanPins] = useState<readonly ScanPin[]>([]), [suggestions, setSuggestions] = useState<ScanSuggestionLayer | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false), [resetting, setResetting] = useState(false), [resetVersion, setResetVersion] = useState(0);
  const resettingRef = useRef(false);
  const [dispatch] = useState(() => createUiDispatch({ scenario, getState: () => current.current, storage: initial.storage, clock: () => new Date().toISOString(), onError: () => {}, onFailure: setError, publish: (next, persisted, announce) => { current.current = next; setState(next); setSaved(persisted); setError(''); if (announce !== false) { setFeedback((n) => n + 1); setRecovery((previous) => previous.status === 'migrated' ? { status: 'loaded', state: next, message: '' } : previous); } } }));
  const navigate: Navigate = useCallback((next: Route) => {
    setError(''); setResetConfirm(false);
    const nextReturn = resourceReturnTo(next, routeRef.current, returnRef.current);
    window.history.pushState({ fixlistReturnTo: nextReturn ? routeHash(nextReturn) : null }, '', navigationUrl(window.location.href, next));
    captureRouteEpoch.move(next); routeRef.current = next; returnRef.current = nextReturn; setReturnTo(nextReturn); setRoute(next);
  }, []);
  useEffect(() => {
    const update = () => {
      const next = parseRoute(window.location.hash, '', routeRef.current);
      if (selectionRequired.current && next.screen !== 'start' && next.screen !== 'people') {
        if ('role' in next) void rememberNavigation((saved) => ({ ...saved, pendingDestination: next }));
        return;
      }
      if (routeHash(next) !== routeHash(routeRef.current)) {
        captureRouteEpoch.move(next); routeRef.current = next; setRoute(next);
      }
      // A same-URL history entry can still have a different resource return context.
      const hash = window.history.state?.fixlistReturnTo, context = typeof hash === 'string' ? parseRoute(hash) : null;
      setReturnTo(context && 'role' in context ? context : null); setError('');
    };
    window.addEventListener('hashchange', update); window.addEventListener('popstate', update);
    return () => { window.removeEventListener('hashchange', update); window.removeEventListener('popstate', update); };
  }, []);
  useEffect(() => { const frame = requestAnimationFrame(() => { document.getElementById('screen-heading')?.focus({ preventScroll: true }); window.scrollTo(0, 0); }); return () => cancelAnimationFrame(frame); }, [route]);
  const language = route.screen === 'start' || route.screen === 'people' ? launchLanguage : person.language;
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const household = visibleHouseholdFor(scenario, state, person.id), requests = visibleRequestsFor(scenario, state, person.id);
  const volunteerRequests = requests.filter((v): v is VolunteerRequestView => v.kind === 'volunteer');
  const householdRequests = requests.filter((v) => v.kind === 'household');
  useEffect(() => {
    let alive = true;
    void loadScan(getScanStore(), new Set(scenario.concerns.map((c) => c.id)), createSuggestionCatalog(scenario)).then((result) => { if (alive && !resettingRef.current) { setScanPins(shareableScanPins(result.document?.pins ?? [])); setSuggestions(result.document && 'suggestions' in result.document ? result.document.suggestions : null); } });
    return () => { alive = false; };
  }, [resetVersion]);
  const onPinsChange = useCallback((pins: readonly ScanPin[]) => { if (!resettingRef.current) setScanPins(shareableScanPins(pins)); }, []);
  const onSuggestionsChange = useCallback((value: ScanSuggestionLayer | null) => { if (!resettingRef.current) setSuggestions(value); }, []);
  async function choosePerson(personId: string, preserveLanguage = false) {
    if (!(await dispatch({ type: 'select_person', personId })).ok) return;
    if (languageChosen && !preserveLanguage && !(await dispatch({ type: 'set_language', language: launchLanguage })).ok) return;
    setLanguageChosen(false);
    selectionRequired.current = false;
    const selected = current.current.people.find((p) => p.id === personId)!;
    setLaunchLanguage(selected.language);
    const next = personDestination(selected.role, guideProgress(selected).completed, navigationRef.current.dismissedGuides.includes(selected.id), navigationRef.current.pendingDestination);
    if (next.screen !== 'guide' && !await rememberNavigation((saved) => ({ ...saved, pendingDestination: null }))) return;
    navigate(next);
  }
  async function leaveGuide(skipped: boolean) {
    const next = authorizedDestination(person.role, navigationRef.current.pendingDestination);
    if (!await rememberNavigation((saved) => ({ ...saved, pendingDestination: null, dismissedGuides: [...saved.dismissedGuides.filter((id) => id !== person.id), ...(skipped ? [person.id] : [])] }))) return;
    navigate(next);
  }
  async function reset() {
    if (resettingRef.current) return;
    if (current.current.activePersonId !== current.current.household.residentId) { setError({ code: 'permission_denied', message: 'resident-required' }); return; }
    dispatch.invalidate?.(); resettingRef.current = true; flushSync(() => { setResetting(true); setResetConfirm(false); });
    const result = await resetFixListData(initial.storage, scenario);
    current.current = result.state; setState(result.state); setSaved(result.status === 'reset'); setScanPins([]); setSuggestions(null); setNavigation(emptyNavigationState()); navigationRef.current = emptyNavigationState(); setResetVersion((v) => v + 1); setResetting(false); resettingRef.current = false;
    selectionRequired.current = true; navigate({ screen: 'start' }); setLaunchLanguage('en');
    if (result.status !== 'reset') setError('reset-failed');
    if (result.status !== 'reset') setRecovery({ status: 'error', state: result.state, message: result.message });
    else { const loaded = await (dispatch.refresh?.() ?? loadDemoState(initial.storage, scenario)); setRecovery(loaded); }
  }
  async function refreshSaved() {
    const loaded = await (dispatch.refresh?.() ?? loadDemoState(initial.storage, scenario));
    setRecovery(loaded); setError('');
    if (['loaded', 'migrated', 'empty'].includes(loaded.status)) { setResetVersion((v) => v + 1); navigate(homeRoute(loaded.state.people.find((p) => p.id === loaded.state.activePersonId)!.role)); }
  }
  function exportSaved() {
    if (current.current.activePersonId !== current.current.household.residentId) { setError({ code: 'permission_denied', message: 'resident-required' }); return; }
    try {
      const bytes = initial.storage?.getItem(DEMO_STORAGE_KEY);
      if (bytes == null) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'fixlist-saved-data.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError({ code: 'storage_unavailable', message: 'storage-export-failed' }); }
  }
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.storageArea !== initial.storage || event.key !== DEMO_STORAGE_KEY && event.key !== null) return;
      dispatch.invalidate?.('stale_revision'); setError({ code: 'stale_revision', message: 'storage-changed' });
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [dispatch, initial.storage]);
  let body: ReactNode;
  const prototypeTitle = navigationTitleKey(navigation.layout, route);
  const titleKey: MessageKey = prototypeTitle ?? (route.screen === 'room' ? 'room.title' : route.screen === 'capture' ? 'capture.title' : route.screen === 'question' ? 'nav.check' : route.screen === 'task' ? 'nav.request' : route.screen === 'requests' ? 'home.requests' : `nav.${route.screen}` as MessageKey);
  const common = { scenario, state, person, dispatch, navigate };
  const captureRouteCurrent = captureRouteEpoch.capture();
  const captureAccess = () => !resettingRef.current && captureRouteCurrent() && current.current.activePersonId === person.id && hasScope(current.current, person.id, 'checklist');
  const props = household ? { ...common, household } : null;
  const request = 'id' in route ? householdRequests.find((v) => v.request.id === route.id) : null;
  const selectedVolunteer = request ? selectedInvitationVolunteer(scenario, state, navigation.invitations, request.request.id) : null;
  const ownRoleRoute = !('role' in route) || route.role === (person.role === 'volunteer' ? 'v' : 'r');
  const isResident = person.id === state.household.residentId;
  if (resetting) body = <Message message="more.resetBusy" />;
  else if (route.screen === 'start') body = <StartLanguage onSelect={(value) => { setLaunchLanguage(value); setLanguageChosen(true); navigate({ screen: 'people' }); }} />;
  else if (route.screen === 'people') body = <PeopleScreen people={state.people} language={launchLanguage} dispatch={dispatch} onChoose={choosePerson} />;
  else if (route.screen === 'guide') body = <GuideScreen person={person} residentName={state.people.find((p) => p.id === state.household.residentId)!.name} dispatch={dispatch} onExit={leaveGuide} />;
  else if (!ownRoleRoute) body = <Denied />;
  else if (person.role === 'volunteer') {
    if (route.screen === 'home') body = <VolunteerHome requests={volunteerRequests} next={volunteerNextStep(scenario, state, person.id)} navigate={navigate} />;
    else if (route.screen === 'tasks') body = <VolunteerTasks requests={volunteerRequests} navigate={navigate} />;
    else if (route.screen === 'profile') body = <VolunteerProfile person={person} dispatch={dispatch} navigate={navigate} />;
    else if (route.screen === 'task') { const view = volunteerRequests.find((v) => v.id === route.id); body = view ? <VolunteerTask key={view.id} request={view} people={state.people.map(({ id, name }) => ({ id, name }))} scanImage={view.scanLocation ? scanPins.find((p) => p.id === view.scanLocation)?.image ?? null : null} dispatch={dispatch} /> : <Message message="request.empty" />; }
  } else if (route.screen === 'home') body = props ? <ResidentHome {...props} layout={navigation.layout} requests={requests} next={person.role === 'family_helper' ? helperNextStep(scenario, state, person.id) : elderNextStep(scenario, state, person.id)} /> : <Denied />;
  else if (route.screen === 'check') body = props?.household.checklistAnswers ? <RoomList {...props} showScanEntry={navigation.layout !== 'current'} /> : <Denied />;
  else if (route.screen === 'room' || route.screen === 'capture') body = props && hasScope(state, person.id, 'checklist') ? route.screen === 'room' ? <RoomPage key={`${person.id}-${route.id}-${resetVersion}`} {...common} canContinue={captureAccess} roomId={route.id} /> : <CaptureFlow key={`${person.id}-${route.id}-${resetVersion}`} {...common} canContinue={captureAccess} roomId={route.id} /> : <Denied />;
  else if (route.screen === 'question') body = props?.household.checklistAnswers ? <ChecklistQuestion key={`${person.id}-${route.id}`} {...props} questionId={route.id} saved={saved} suggestions={suggestions} photoStillRecorded={(id) => current.current.photos.some((photo) => photo.id === id)} onPhotoError={setError} /> : <Denied />;
  else if (route.screen === 'plan') body = props?.household.plan ? <ResidentPlan {...props} /> : <Denied />;
  else if (route.screen === 'requests') body = household?.requests ? <RequestList requests={householdRequests} navigate={navigate} showResources={navigation.layout !== 'current'} /> : <Denied />;
  else if (route.screen === 'request') body = request ? <ResidentRequest key={request.request.id} {...common} view={request} /> : <Message message="request.empty" />;
  else if (route.screen === 'sharing') body = isResident && request ? <SharingScreen key={`${request.request.id}-${request.request.revision}`} request={request.request} scenario={scenario} pins={scanPins} dispatch={dispatch} navigate={navigate} /> : <Denied />;
  else if (route.screen === 'invite') body = isResident && request ? <VolunteerChooser people={state.people} requestId={request.request.id} onChoose={async (id, requestId) => { const draft = createInvitationDraft(current.current, requestId, id); if (!draft) return; if (await rememberNavigation((saved) => ({ ...saved, invitations: [...saved.invitations.filter((d) => d.requestId !== requestId), draft] }))) navigate({ role: 'r', screen: 'review', id: requestId }); }} /> : <Denied />;
  else if (route.screen === 'review') body = isResident && request && selectedVolunteer ? <InvitationReview request={request.request} volunteer={selectedVolunteer} scenario={scenario} state={state} pins={scanPins} dispatch={dispatch} navigate={navigate} /> : <BackToInvitations navigate={navigate} requestId={request?.request.id} />;
  else if (route.screen === 'scan') body = household?.canViewScan && !resetting ? <ScanPanel key={resetVersion} scenario={scenario} state={state} onSuggestionsChange={onSuggestionsChange} onPinsChange={onPinsChange} /> : <Denied />;
  else if (route.screen === 'resources') body = <ResourcesScreen {...common} />;
  else if (route.screen === 'access') body = isResident ? <AccessScreen state={state} dispatch={dispatch} /> : <Denied />;
  else if (route.screen === 'more') body = <MoreScreen person={person} resident={isResident} canViewScan={!!household?.canViewScan} navigate={navigate} dispatch={dispatch} onReset={() => setResetConfirm(true)} layout={navigation.layout} onLayoutChange={(layout) => rememberNavigation((saved) => ({ ...saved, layout }), 'navigation.unsaved')} />;
  else if (route.screen === 'help') body = <HelpScreen person={person} navigate={navigate} dispatch={dispatch} />;
  else if (route.screen === 'about') body = <About />;
  else if (route.screen === 'language') body = <LanguagePicker onSelect={async (value) => { if ((await dispatch({ type: 'set_language', language: value })).ok) setLaunchLanguage(value); }} />;
  else if (route.screen === 'report') body = isResident ? <ReportScreen state={state} pins={scanPins} onError={() => setError('error.print')} /> : <Denied />;
  const screenBody = <><ErrorMessage error={error} />{typeof error === 'object' && error.code === 'stale_revision' ? <RefreshSaved onRefresh={refreshSaved} /> : null}{['invalid', 'error', 'unavailable', 'migrated'].includes(recovery.status) ? <RecoveryNotice status={recovery.status as 'invalid' | 'error' | 'unavailable' | 'migrated'} message={recovery.message} canManage={isResident} onExport={exportSaved} onReset={() => setResetConfirm(true)} onRefresh={refreshSaved} /> : null}<SaveFeedback saved={saved} feedback={feedback} />{body}{resetConfirm ? <ResetConfirmation onReset={() => void reset()} onCancel={() => setResetConfirm(false)} /> : null}</>;
  return <I18nProvider language={language}>{!usesTabShell(route) ? screenBody : <TranslatedShell person={person} route={route} returnTo={returnTo} layout={navigation.layout} titleKey={titleKey} navigate={navigate} hasChecklist={hasScope(state, person.id, 'checklist')} hasPlan={!!household?.plan} hasRequests={!!household?.requests} {...(person.role === 'family_helper' ? { actingFor: state.people.find((p) => p.id === state.household.residentId)?.name ?? '' } : {})}>{screenBody}</TranslatedShell>}</I18nProvider>;
}
function TranslatedShell({ titleKey, ...props }: Omit<Parameters<typeof PhoneShell>[0], 'title'> & { titleKey: MessageKey }) { const t = useT(); return <PhoneShell {...props} title={t(titleKey)} />; }
function StartLanguage({ onSelect }: { onSelect(language: Language): void }) { const t = useT(); return <StartShell title={t('nav.start')}><p>{t('app.tagline')}</p><LanguagePicker onSelect={onSelect} /></StartShell>; }
function Message({ message }: { message: MessageKey }) { const t = useT(); return <p className="notice">{t(message)}</p>; }
function Denied() { return <Message message="person.noGrant" />; }
function About() { const t = useT(); return <div className="stack"><p>{t('more.aboutBody')}</p><p>{t('app.disclosure')}</p><p>{t('app.local')}</p></div>; }
function ErrorMessage({ error }: { error: string | OperationFailure }) { const t = useT(); if (!error) return null; if (typeof error === 'object') return <p className="error-message" role="alert">{t(`failure.${error.code}`)}</p>; const result = error === 'reset-failed' ? { key: 'error.reset' as const } : error.startsWith('error.') || error.startsWith('check.') || error.startsWith('routing.') || error.startsWith('navigation.') ? { key: error as MessageKey } : { key: 'error.generic' as const }; return <p className="error-message" role="alert">{t(result.key)}</p>; }
function RefreshSaved({ onRefresh }: { onRefresh(): void }) { const t = useT(); return <button onClick={onRefresh}>{t('data.refresh')}</button>; }
function SaveFeedback({ saved, feedback }: { saved: boolean; feedback: number }) { const t = useT(); return <p className={saved ? 'sr-only screen-only' : 'notice screen-only'} role="status" aria-live="polite" key={feedback}>{t(saved ? 'check.saved' : 'check.unsaved')}</p>; }
function BackToInvitations({ navigate, requestId }: { navigate: Navigate; requestId?: string | undefined }) { const t = useT(); return <button onClick={() => navigate(requestId ? { role: 'r', screen: 'invite', id: requestId } : { role: 'r', screen: 'requests' })}>{t('nav.invite')}</button>; }
function ReportScreen({ state, pins, onError }: { state: ReturnType<typeof loadDemoState>['state']; pins: readonly ScanPin[]; onError(): void }) {
  const t = useT();
  const [snapshot, setSnapshot] = useState(() => createPrintSnapshot(state, new Date().toISOString(), pins));
  const [preparing, setPreparing] = useState(false), report = useRef<HTMLDivElement>(null), preparation = useRef<AbortController | null>(null);
  useEffect(() => () => { preparation.current?.abort(); preparation.current = null; }, []);
  async function print() {
    if (preparation.current) return;
    const controller = new AbortController(); preparation.current = controller;
    flushSync(() => { setSnapshot(createPrintSnapshot(state, new Date().toISOString(), pins)); setPreparing(true); });
    try {
      await waitForPrintReady(report.current!, { signal: controller.signal });
      await printCurrentPage('FixList report', controller.signal);
    } catch { if (!controller.signal.aborted) onError(); }
    finally { if (preparation.current === controller) { preparation.current = null; setPreparing(false); } }
  }
  return <><div className="screen-only stack"><button disabled={preparing} onClick={() => void print()}>{t('report.print')}</button>{preparing ? <><p role="status">{t('routing.printPreparing')}</p><button className="secondary" onClick={() => preparation.current?.abort()}>{t('routing.printCancel')}</button></> : null}<p className="muted">{t('report.note')}</p></div><div ref={report} className="paper"><PrintReport scenario={scenario} snapshot={snapshot} /></div></>;
}
