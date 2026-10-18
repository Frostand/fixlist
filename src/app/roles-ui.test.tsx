import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { applyCommand, createInitialState, visibleHouseholdFor, visibleRequestsFor, SHARING_REVOCATION_NOTICE, noSharing, type DemoState, type VolunteerRequestView } from '../domain/workflow';
import { DEMO_STORAGE_KEY, loadDemoState } from '../lib/demo-storage';
import { I18nProvider } from '../i18n';
import { en } from '../i18n/en';
import { createUiDispatch, type UiCommand } from './ui-controller';
import { guideProgress, nextStepCard } from './view-model';
import { PhoneShell } from './PhoneShell';
import { ResidentRequest, SharingSummary } from './RequestScreens';
import { VolunteerTask, VolunteerTasks } from './VolunteerScreens';
import { ResidentPlan } from './ResidentScreens';
import { PrintReport } from './PrintReport';
const at = '2026-10-18T15:00:00.000Z', noop = () => {};
function harness() {
  let state = createInitialState(scenario); const bytes = new Map<string, string>(), errors: string[] = [];
  const storage = { getItem: (k: string) => bytes.get(k) ?? null, setItem: (k: string, v: string) => { bytes.set(k, v); }, removeItem: (k: string) => { bytes.delete(k); } };
  const dispatch = createUiDispatch({ scenario, getState: () => state, storage, publish: (next) => { state = next; }, clock: () => at, onError: (e) => errors.push(e) });
  const run = async (command: UiCommand) => { const result = await dispatch(command); expect(result, errors.at(-1)).toEqual({ ok: true }); };
  const request = () => state.requests[0]!;
  const transition = (type: 'accept_invitation' | 'agree_time' | 'report_done' | 'confirm_done' | 'withdraw' | 'not_done_yet') => run({ type, requestId: request().id, expectedRevision: request().revision });
  return { get state() { return state; }, storage, bytes, dispatch, run, request, transition, errors };
}
async function confirmed(h: ReturnType<typeof harness>) { await h.run({ type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' }); expect(h.state.confirmations['rug-concern']?.humanConfirmed).toBe(false); await h.run({ type: 'confirm_concern', concernId: 'rug-concern' }); await h.run({ type: 'create_request', referenceActionId: 'review-rug', expectedRevision: 0 }); }
async function invited(h: ReturnType<typeof harness>, sharing = noSharing()) { await confirmed(h); await h.run({ type: 'set_sharing', requestId: h.request().id, expectedRevision: h.request().revision, sharing, visitTimes: 'Private Tuesday', areaLabel: 'Private area', scanLocation: null }); await h.run({ type: 'invite_volunteer', requestId: h.request().id, expectedRevision: h.request().revision, volunteerId: 'alex' }); }
const projection = (state: DemoState) => visibleRequestsFor(scenario, state, 'alex').find((v): v is VolunteerRequestView => v.kind === 'volunteer')!;
describe('UI controller and role screens', () => {
  it('drives the complete milestone through the dispatcher shared by UI handlers and persists every role transition', async () => {
    const h = harness(); await invited(h, { ...noSharing(), roomName: true });
    await h.run({ type: 'select_person', personId: 'alex' });
    let html = renderToStaticMarkup(<VolunteerTask request={projection(h.state)} people={h.state.people} dispatch={h.dispatch} />);
    expect(html).toContain('Accept invitation'); expect(html).not.toContain('Confirm this');
    await h.transition('accept_invitation'); await h.run({ type: 'propose_time', requestId: h.request().id, expectedRevision: h.request().revision, text: 'Saturday at 10' });
    await h.run({ type: 'select_person', personId: 'margaret' }); await h.transition('agree_time');
    await h.run({ type: 'select_person', personId: 'alex' }); await h.run({ type: 'post_update', requestId: h.request().id, expectedRevision: h.request().revision, text: 'Rug moved with permission.' }); await h.transition('report_done');
    await h.run({ type: 'select_person', personId: 'margaret' });
    const view = visibleRequestsFor(scenario, h.state, 'margaret')[0]!;
    if (view.kind !== 'household') throw Error('wrong projection');
    html = renderToStaticMarkup(<ResidentRequest view={view} state={h.state} person={h.state.people[0]!} scenario={scenario} dispatch={h.dispatch} navigate={noop} />);
    expect(html).toContain('Yes, it&#x27;s done'); expect(html).toContain('Written by Alex');
    await h.transition('confirm_done'); expect(h.request().status).toBe('resident_confirmed_done');
    expect(h.request().independentVerification).toBe('not available in this demo');
    const loaded = loadDemoState(h.storage, scenario); expect(loaded.status).toBe('loaded'); expect(loaded.state).toEqual(h.state); expect(h.bytes.has(DEMO_STORAGE_KEY)).toBe(true);
  });
  it('remembers individual languages, guide progress and checklist position without changing other people', async () => {
    const h = harness(); await h.run({ type: 'set_language', language: 'es' }); await h.run({ type: 'set_onboarding', guideId: 'resident-guide', stepIndex: 2, completed: false }); await h.run({ type: 'set_checklist_position', position: 3 });
    await h.run({ type: 'select_person', personId: 'alex' }); await h.run({ type: 'set_onboarding', guideId: 'volunteer-guide', stepIndex: 1, completed: false });
    const loaded = loadDemoState(h.storage, scenario).state;
    expect(loaded.people[0]!.language).toBe('es'); expect(guideProgress(loaded.people[0]!)).toEqual({ stepIndex: 2, completed: false }); expect(loaded.people[0]!.checklistPosition).toBe(3);
    expect(loaded.people[2]!.language).toBe('en'); expect(guideProgress(loaded.people[2]!).stepIndex).toBe(1);
  });
  it('maps actionable next steps to stable screen routes', () => {
    const state = createInitialState(scenario);
    expect(nextStepCard({ kind: 'answer_checklist', checklistItemId: 'rug-check' }, state, false).route).toEqual({ role: 'r', screen: 'question', id: 'rug-check' });
    expect(nextStepCard({ kind: 'agree_time', requestId: 'req' }, state, false).route).toEqual({ role: 'r', screen: 'request', id: 'req' });
    expect(nextStepCard({ kind: 'propose_time', requestId: 'req' }, state, true).key).toBe('next.propose_time');
  });
  it('hides resident controls from volunteers and ungranted helpers while the domain rejects the same commands', async () => {
    const h = harness(); await invited(h);
    for (const personId of ['alex', 'sam']) {
      await h.run({ type: 'select_person', personId }); expect(visibleHouseholdFor(scenario, h.state, personId)).toBeNull();
      expect((await h.dispatch({ type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'no' })).ok).toBe(false);
      expect((await h.dispatch({ type: 'confirm_done', requestId: h.request().id, expectedRevision: h.request().revision })).ok).toBe(false);
      const person = h.state.people.find((p) => p.id === personId)!;
      const html = renderToStaticMarkup(<PhoneShell person={person} route={{ role: personId === 'alex' ? 'v' : 'r', screen: 'home' }} title="Home" navigate={noop} hasChecklist={false} hasPlan={false}><p /></PhoneShell>);
      expect(html).not.toContain('href="#/r/check"'); expect(html).not.toContain('href="#/r/plan"');
    }
  });
  it('lets a requests-granted helper draft but never approve sharing or completion', async () => {
    const h = harness(); await invited(h); await h.run({ type: 'grant_delegation', personId: 'sam', scopes: ['requests'] }); await h.run({ type: 'select_person', personId: 'sam' });
    const view = visibleRequestsFor(scenario, h.state, 'sam')[0]!; if (view.kind !== 'household') throw Error('wrong view');
    const html = renderToStaticMarkup(<ResidentRequest view={view} state={h.state} person={h.state.people[1]!} scenario={scenario} dispatch={h.dispatch} navigate={noop} />);
    expect(html).not.toContain('<button'); expect((await h.dispatch({ type: 'set_sharing', requestId: h.request().id, expectedRevision: h.request().revision, sharing: noSharing(), visitTimes: '', areaLabel: '', scanLocation: null })).ok).toBe(false);
  });
  it('renders volunteer tasks exclusively from projections; unshared values, photos and scan images stay absent', async () => {
    const h = harness(); await invited(h); const v = projection(h.state);
    const html = renderToStaticMarkup(<VolunteerTask request={v} people={[{ id: 'alex', name: 'Alex' }]} scanImage="data:image/jpeg;secret-image" dispatch={h.dispatch} />);
    for (const secret of ['Private Tuesday', 'Private area', 'Sample living room', 'secret-image', 'rug-check']) expect(html).not.toContain(secret);
    const source = readFileSync('src/app/VolunteerScreens.tsx', 'utf8'); expect(source).not.toMatch(/state\.(household|checklistAnswers|photos|requests)|getRequestViews\(|computePlan\(/);
    expect(source).toContain('request: VolunteerRequestView');
  });
  it('revokes future projection access immediately, preserving the exact notice and original user writing in Spanish', async () => {
    const h = harness(); await invited(h, { ...noSharing(), visitTimes: true });
    expect(renderToStaticMarkup(<VolunteerTask request={projection(h.state)} people={h.state.people} dispatch={h.dispatch} />)).toContain('Private Tuesday');
    await h.run({ type: 'revoke_shared_field', requestId: h.request().id, expectedRevision: h.request().revision, field: 'visitTimes' }); expect(projection(h.state)).not.toHaveProperty('visitTimes');
    expect(en['sharing.notice']).toBe(SHARING_REVOCATION_NOTICE);
    const html = renderToStaticMarkup(<I18nProvider language="es"><SharingSummary request={h.request()} /><VolunteerTasks requests={[projection(h.state)]} navigate={noop} /></I18nProvider>);
    expect(html).toContain('No compartido');
  });
  it('localizes the rendered report and retains user writing with attribution', async () => {
    const h = harness(); await invited(h); await h.run({ type: 'select_person', personId: 'alex' }); await h.transition('accept_invitation'); await h.run({ type: 'propose_time', requestId: h.request().id, expectedRevision: h.request().revision, text: 'My original English time' }); await h.run({ type: 'select_person', personId: 'margaret' }); await h.transition('agree_time'); await h.run({ type: 'select_person', personId: 'alex' }); await h.run({ type: 'post_update', requestId: h.request().id, expectedRevision: h.request().revision, text: 'Keep this writing in English.' });
    const html = renderToStaticMarkup(<I18nProvider language="es"><PrintReport scenario={scenario} snapshot={{ state: h.state, scanPins: [], generatedAt: at }} /></I18nProvider>);
    expect(html).toContain('Se necesita información'); expect(html).not.toContain('Needs information'); expect(html).toContain('Keep this writing in English.'); expect(html).toContain('Escrito por Alex'); expect(html).toContain('No compartido');
  });
  it('only exposes permitted confirmation controls for a confirm-only helper', async () => {
    const h = harness(); await h.run({ type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' }); await h.run({ type: 'grant_delegation', personId: 'sam', scopes: ['confirm'] }); await h.run({ type: 'select_person', personId: 'sam' });
    const household = visibleHouseholdFor(scenario, h.state, 'sam')!;
    const html = renderToStaticMarkup(<ResidentPlan scenario={scenario} state={h.state} person={h.state.people[1]!} household={household} dispatch={h.dispatch} navigate={noop} />);
    expect(html).not.toContain('Confirm this is something to fix'); expect(html).toContain('Confirmation also requires checklist access'); expect(html).not.toContain('Ask for help'); expect(household).not.toHaveProperty('checklistAnswers');
    const rejected = applyCommand(scenario, h.state, { type: 'create_request', referenceActionId: 'review-rug', expectedRevision: 0, actorId: 'sam', at }); expect(rejected.ok).toBe(false);
  });
});
