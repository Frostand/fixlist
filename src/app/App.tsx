import { printCurrentPage } from '../lib/native-print';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { demoScenario as scenario } from '../data/demo-scenario';
import { elderNextStep, volunteerNextStep, visibleRequestsFor, visibleHouseholdFor, hasScope, validateCatalog, type Language, type VolunteerRequestView } from '../domain/workflow';
import { getBrowserStorage, loadDemoState, resetFixListData } from '../lib/demo-storage';
import { createPrintSnapshot } from '../lib/print';
import type { ScanPin } from '../lib/scan-model';
import { loadScan, getScanStore } from '../lib/scan-storage';
import { createSuggestionCatalog, type ScanSuggestionLayer } from '../lib/scan-suggestions';
import { I18nProvider, useT, type MessageKey } from '../i18n';
import { createUiDispatch } from './ui-controller';
import { domainErrorKey, guideProgress } from './view-model';
import { homeRoute, parseRoute, type Route } from './routes';
import { PhoneShell, StartShell, type Navigate } from './PhoneShell';
import { GuideScreen, LanguagePicker, PeopleScreen } from './PeopleScreens';
import { ChecklistQuestion, ResidentHome, ResidentPlan, RoomList } from './ResidentScreens';
import { InvitationReview, ResidentRequest, RequestList, SharingScreen, VolunteerChooser } from './RequestScreens';
import { VolunteerHome, VolunteerTask, VolunteerTasks } from './VolunteerScreens';
import { AccessScreen, HelpScreen, MoreScreen, ResourcesScreen, VolunteerProfile } from './SettingsScreens';
import { ScanPanel } from './ScanPanel';
import { PrintReport } from './PrintReport';

export function App() { return validateCatalog(scenario).ok ? <DemoApp /> : <I18nProvider language="en"><Unavailable /></I18nProvider>; }
function Unavailable() { const t = useT(); return <main><h1>{t('app.name')}</h1><p role="alert">{t('error.catalog')}</p></main>; }
function DemoApp() {
  const [initial] = useState(() => { const storage = getBrowserStorage(); return { storage, ...loadDemoState(storage, scenario) }; });
  const [state, setState] = useState(initial.state), current = useRef(initial.state);
  const [route, setRoute] = useState<Route>(() => typeof window === 'undefined' ? { screen: 'start' } : window.location.hash || window.location.search.includes('localScan=') ? parseRoute(window.location.hash, window.location.search) : initial.status === 'loaded' || initial.status === 'migrated' ? homeRoute(initial.state.people.find((p) => p.id === initial.state.activePersonId)!.role) : { screen: 'start' });
  const person = state.people.find((p) => p.id === state.activePersonId)!;
  const [launchLanguage, setLaunchLanguage] = useState<Language>(person.language), [languageChosen, setLanguageChosen] = useState(false);
  const [saved, setSaved] = useState(!['invalid', 'unavailable', 'error'].includes(initial.status)), [error, setError] = useState('');
  const [feedback, setFeedback] = useState(0), [scanPins, setScanPins] = useState<readonly ScanPin[]>([]), [suggestions, setSuggestions] = useState<ScanSuggestionLayer | null>(null);
  const [invitees, setInvitees] = useState<Record<string, string>>({}), [resetConfirm, setResetConfirm] = useState(false), [resetting, setResetting] = useState(false), [resetVersion, setResetVersion] = useState(0);
  const resettingRef = useRef(false);
  const [dispatch] = useState(() => createUiDispatch({ scenario, getState: () => current.current, storage: initial.storage, clock: () => new Date().toISOString(), onError: setError, publish: (next, persisted) => { current.current = next; setState(next); setSaved(persisted); setError(''); setFeedback((n) => n + 1); } }));
  const navigate: Navigate = useCallback((next: Route) => {
    setError(''); setResetConfirm(false);
    // A localScan query is a launch instruction only; it must not trap subsequent tab navigation.
    const url = new URL(window.location.href); url.searchParams.delete('localScan'); url.hash = `/${'role' in next ? `${next.role}/` : ''}${next.screen}${'id' in next ? `/${next.id}` : ''}`;
    window.history.pushState(null, '', url); setRoute(next);
  }, []);
  useEffect(() => {
    const update = () => { setRoute(parseRoute(window.location.hash)); setError(''); };
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
    void loadScan(getScanStore(), new Set(scenario.concerns.map((c) => c.id)), createSuggestionCatalog(scenario)).then((result) => { if (alive && !resettingRef.current) { setScanPins(result.document?.pins ?? []); setSuggestions(result.document && 'suggestions' in result.document ? result.document.suggestions : null); } });
    return () => { alive = false; };
  }, [resetVersion]);
  const onPinsChange = useCallback((pins: readonly ScanPin[]) => { if (!resettingRef.current) setScanPins(pins); }, []);
  const onSuggestionsChange = useCallback((value: ScanSuggestionLayer | null) => { if (!resettingRef.current) setSuggestions(value); }, []);
  function choosePerson(personId: string, preserveLanguage = false) {
    if (!dispatch({ type: 'select_person', personId }).ok) return;
    if (languageChosen && !preserveLanguage) dispatch({ type: 'set_language', language: launchLanguage });
    setLanguageChosen(false);
    const selected = current.current.people.find((p) => p.id === personId)!;
    setLaunchLanguage(selected.language);
    navigate(guideProgress(selected).completed ? homeRoute(selected.role) : { screen: 'guide' });
  }
  async function reset() {
    resettingRef.current = true; flushSync(() => { setResetting(true); setResetConfirm(false); });
    const result = await resetFixListData(initial.storage, scenario);
    current.current = result.state; setState(result.state); setSaved(result.status === 'reset'); setScanPins([]); setSuggestions(null); setInvitees({}); setResetVersion((v) => v + 1); setResetting(false); resettingRef.current = false;
    navigate({ screen: 'start' }); setLaunchLanguage('en');
    if (result.status !== 'reset') setError('reset-failed');
  }
  let body: ReactNode;
  const titleKey: MessageKey = route.screen === 'question' ? 'nav.check' : route.screen === 'task' ? 'nav.request' : route.screen === 'requests' ? 'home.requests' : `nav.${route.screen}` as MessageKey;
  const common = { scenario, state, person, dispatch, navigate };
  const props = household ? { ...common, household } : null;
  const request = 'id' in route ? householdRequests.find((v) => v.request.id === route.id) : null;
  const selectedVolunteer = request ? state.people.find((p) => p.id === invitees[request.request.id] && p.role === 'volunteer') : null;
  const ownRoleRoute = !('role' in route) || route.role === (person.role === 'volunteer' ? 'v' : 'r');
  const isResident = person.id === state.household.residentId;
  if (resetting) body = <Message message="more.resetBusy" />;
  else if (route.screen === 'start') body = <StartLanguage onSelect={(value) => { setLaunchLanguage(value); setLanguageChosen(true); navigate({ screen: 'people' }); }} />;
  else if (route.screen === 'people') body = <PeopleScreen people={state.people} language={launchLanguage} dispatch={dispatch} onChoose={choosePerson} />;
  else if (route.screen === 'guide') body = <GuideScreen person={person} residentName={state.people.find((p) => p.id === state.household.residentId)!.name} dispatch={dispatch} navigate={navigate} />;
  else if (!ownRoleRoute) body = <Denied />;
  else if (person.role === 'volunteer') {
    if (route.screen === 'home') body = <VolunteerHome requests={volunteerRequests} next={volunteerNextStep(scenario, state, person.id)} navigate={navigate} />;
    else if (route.screen === 'tasks') body = <VolunteerTasks requests={volunteerRequests} navigate={navigate} />;
    else if (route.screen === 'profile') body = <VolunteerProfile person={person} dispatch={dispatch} navigate={navigate} />;
    else if (route.screen === 'task') { const view = volunteerRequests.find((v) => v.id === route.id); body = view ? <VolunteerTask key={view.id} request={view} people={state.people.map(({ id, name }) => ({ id, name }))} scanImage={view.scanLocation ? scanPins.find((p) => p.id === view.scanLocation)?.image ?? null : null} dispatch={dispatch} /> : <Message message="request.empty" />; }
  } else if (route.screen === 'home') body = props ? <ResidentHome {...props} requests={requests} next={elderNextStep(scenario, state, person.id)} /> : <Denied />;
  else if (route.screen === 'check') body = props?.household.checklistAnswers ? <RoomList {...props} /> : <Denied />;
  else if (route.screen === 'question') body = props?.household.checklistAnswers ? <ChecklistQuestion key={`${person.id}-${route.id}`} {...props} questionId={route.id} saved={saved} suggestions={suggestions} photoStillRecorded={(id) => current.current.photos.some((photo) => photo.id === id)} onPhotoError={(key) => setError(key)} /> : <Denied />;
  else if (route.screen === 'plan') body = props?.household.plan ? <ResidentPlan {...props} /> : <Denied />;
  else if (route.screen === 'requests') body = household?.requests ? <RequestList requests={householdRequests} navigate={navigate} /> : <Denied />;
  else if (route.screen === 'request') body = request ? <ResidentRequest key={request.request.id} {...common} view={request} /> : <Message message="request.empty" />;
  else if (route.screen === 'sharing') body = isResident && request ? <SharingScreen key={`${request.request.id}-${request.request.revision}`} request={request.request} scenario={scenario} pins={scanPins} dispatch={dispatch} navigate={navigate} /> : <Denied />;
  else if (route.screen === 'invite') body = isResident && request ? <VolunteerChooser people={state.people} requestId={request.request.id} onChoose={(id, requestId) => { setInvitees({ ...invitees, [requestId]: id }); navigate({ role: 'r', screen: 'review', id: requestId }); }} /> : <Denied />;
  else if (route.screen === 'review') body = isResident && request && selectedVolunteer ? <InvitationReview request={request.request} volunteer={selectedVolunteer} scenario={scenario} state={state} pins={scanPins} dispatch={dispatch} navigate={navigate} /> : <BackToInvitations navigate={navigate} requestId={request?.request.id} />;
  else if (route.screen === 'scan') body = household?.canViewScan && !resetting ? <ScanPanel key={resetVersion} scenario={scenario} state={state} onSuggestionsChange={onSuggestionsChange} onPinsChange={onPinsChange} /> : <Denied />;
  else if (route.screen === 'resources') body = <ResourcesScreen {...common} />;
  else if (route.screen === 'access') body = isResident ? <AccessScreen state={state} dispatch={dispatch} /> : <Denied />;
  else if (route.screen === 'more') body = <MoreScreen person={person} resident={isResident} canViewScan={!!household?.canViewScan} navigate={navigate} dispatch={dispatch} onReset={() => setResetConfirm(true)} />;
  else if (route.screen === 'help') body = <HelpScreen person={person} navigate={navigate} dispatch={dispatch} />;
  else if (route.screen === 'about') body = <About />;
  else if (route.screen === 'language') body = <LanguagePicker onSelect={(value) => { dispatch({ type: 'set_language', language: value }); setLaunchLanguage(value); }} />;
  else if (route.screen === 'report') body = isResident ? <ReportScreen state={state} pins={scanPins} onError={() => setError('error.print')} /> : <Denied />;
  const screenBody = <><ErrorMessage error={error} /><SaveFeedback saved={saved} feedback={feedback} />{body}{resetConfirm ? <ResetConfirmation onReset={() => void reset()} onCancel={() => setResetConfirm(false)} /> : null}</>;
  return <I18nProvider language={language}>{route.screen === 'start' || route.screen === 'people' ? screenBody : <TranslatedShell person={person} route={route} titleKey={titleKey} navigate={navigate} hasChecklist={hasScope(state, person.id, 'checklist')} hasPlan={!!household?.plan} {...(person.role === 'family_helper' ? { actingFor: 'Margaret' } : {})}>{screenBody}</TranslatedShell>}</I18nProvider>;
}
function TranslatedShell({ titleKey, ...props }: Omit<Parameters<typeof PhoneShell>[0], 'title'> & { titleKey: MessageKey }) { const t = useT(); return <PhoneShell {...props} title={t(titleKey)} />; }
function StartLanguage({ onSelect }: { onSelect(language: Language): void }) { const t = useT(); return <StartShell title={t('nav.start')}><p>{t('app.tagline')}</p><LanguagePicker onSelect={onSelect} /></StartShell>; }
function Message({ message }: { message: MessageKey }) { const t = useT(); return <p className="notice">{t(message)}</p>; }
function Denied() { return <Message message="person.noGrant" />; }
function About() { const t = useT(); return <div className="stack"><p>{t('more.aboutBody')}</p><p>{t('app.disclosure')}</p><p>{t('app.local')}</p></div>; }
function ErrorMessage({ error }: { error: string }) { const t = useT(); if (!error) return null; const result = error === 'reset-failed' ? { key: 'error.reset' as const } : error.startsWith('error.') || error.startsWith('check.') ? { key: error as MessageKey } : domainErrorKey(error); return <p className="error-message" role="alert">{t(result.key, result.values)}</p>; }
function SaveFeedback({ saved, feedback }: { saved: boolean; feedback: number }) { const t = useT(); return <p className={saved ? 'sr-only screen-only' : 'notice screen-only'} role="status" aria-live="polite" key={feedback}>{t(saved ? 'check.saved' : 'check.unsaved')}</p>; }
function ResetConfirmation({ onReset, onCancel }: { onReset(): void; onCancel(): void }) { const t = useT(); return <section className="card reset-confirm" aria-label={t('more.reset')}><h2>{t('more.reset')}</h2><p>{t('more.resetBody')}</p><div className="stack"><button className="danger" onClick={onReset}>{t('more.resetConfirm')}</button><button className="secondary" onClick={onCancel}>{t('more.keep')}</button></div></section>; }
function BackToInvitations({ navigate, requestId }: { navigate: Navigate; requestId?: string | undefined }) { const t = useT(); return <button onClick={() => navigate(requestId ? { role: 'r', screen: 'invite', id: requestId } : { role: 'r', screen: 'requests' })}>{t('nav.invite')}</button>; }
function ReportScreen({ state, pins, onError }: { state: ReturnType<typeof loadDemoState>['state']; pins: readonly ScanPin[]; onError(): void }) {
  const t = useT();
  const [snapshot, setSnapshot] = useState(() => createPrintSnapshot(state, new Date().toISOString(), pins));
  async function print() {
    flushSync(() => setSnapshot(createPrintSnapshot(state, new Date().toISOString(), pins)));
    try {
      const deadline = Date.now() + 8000;
      while (document.querySelector('.print-report [data-photo-pending=true]')) { if (Date.now() > deadline) throw new Error('photo-timeout'); await new Promise((resolve) => setTimeout(resolve, 50)); }
      if (document.querySelector('.print-report [data-photo-failed=true]')) throw new Error('photo-missing');
      await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.print-report img'), (img) => img.decode())); await printCurrentPage('FixList report'); } catch { onError(); }
  }
  return <><div className="screen-only stack"><button onClick={() => void print()}>{t('report.print')}</button><p className="muted">{t('report.note')}</p></div><div className="paper"><PrintReport scenario={scenario} snapshot={snapshot} /></div></>;
}
