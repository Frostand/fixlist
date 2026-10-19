import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoScenario as scenario } from '../data/demo-scenario';
import { helperNextStep, visibleHouseholdFor } from '../domain/role-views';
import { atStage, run, at } from '../domain/roles-test-helpers';
import { App } from './App';
import { createInitialState } from '../domain/workflow';
import { RecoveryNotice } from './SettingsScreens';
import { ChecklistQuestion, ResidentHome } from './ResidentScreens';
import { latestUpdates, nextStepCard } from './view-model';
import { I18nProvider } from '../i18n';
import { en } from '../i18n/en';
import { es } from '../i18n/es';

describe('recovery and role-specific next actions', () => {
  it.each(['en', 'es'] as const)('D11 discloses truncated photo-deletion attribution on the photo screen in %s', (language) => {
    const state = { ...createInitialState(scenario), removedPhotoHistoryTruncated: true };
    const html = renderToStaticMarkup(<I18nProvider language={language}><ChecklistQuestion scenario={scenario} state={state} person={state.people[0]!} household={visibleHouseholdFor(scenario, state, 'margaret')!} dispatch={async () => ({ ok: true })} navigate={() => {}} questionId="rug-check" saved suggestions={null} photoStillRecorded={() => false} onPhotoError={() => {}} /></I18nProvider>);
    expect(html).toContain(language === 'en' ? en['data.photoHistoryTruncated'] : es['data.photoHistoryTruncated']);
  });
  it('D05 surfaces the actual recovery and migration explanations plus deliberate choices', () => {
    for (const status of ['invalid', 'migrated'] as const) {
      const message = status === 'invalid' ? 'Saved demo data exceeds the 64 KiB limit. Saved data was not changed.' : 'Saved version 3 data migrated in memory; historical records are retained.';
      const html = renderToStaticMarkup(<RecoveryNotice status={status} message={message} onExport={() => {}} onReset={() => {}} onRefresh={() => {}} />);
      expect(html).toContain(message); expect(html).toContain('Export saved bytes'); expect(html).toContain('Reset FixList data'); expect(html).toContain('Refresh saved data');
    }
  });
  it('N06 helpers Continue to a granted pending task with matching copy and destination', () => {
    let state = run(atStage('draft'), { type: 'grant_delegation', personId: 'sam', scopes: ['checklist', 'confirm'] });
    state = run(state, { type: 'answer_checklist', checklistItemId: 'cord-check', answer: 'unknown' });
    const next = helperNextStep(scenario, state, 'sam')!;
    expect(next).toEqual({ kind: 'answer_checklist', checklistItemId: 'cord-check' });
    const card = nextStepCard(next, state, false);
    expect(card.key).toBe('next.answer_checklist'); expect(card.route).toEqual({ role: 'r', screen: 'question', id: 'cord-check' });
    const html = renderToStaticMarkup(<ResidentHome scenario={scenario} state={state} person={state.people[1]!} household={visibleHouseholdFor(scenario, state, 'sam')!} requests={[]} next={next} dispatch={async () => ({ ok: true })} navigate={() => {}} />);
    expect(html).toContain(en['next.reviewNotSure']);
    state = run(state, { type: 'grant_delegation', personId: 'sam', scopes: ['confirm'] });
    expect(helperNextStep(scenario, state, 'sam')).toEqual({ kind: 'helper_evidence' });
    expect(nextStepCard(helperNextStep(scenario, state, 'sam'), state, false).route).toEqual({ role: 'r', screen: 'help' });
  });
  it('D13 latest updates are chronological across requests with deterministic ties and invalid dates excluded', () => {
    const requests = [{ request: { id: 'request-z', updates: [{ actorId: 'alex', at: '2026-10-18T13:00:00.000Z', text: 'latest' }, { actorId: 'alex', at: 'not-a-date', text: 'invalid' }] } }, { request: { id: 'request-a', updates: [{ actorId: 'alex', at, text: 'first tie' }, { actorId: 'alex', at, text: 'second tie' }, { actorId: 'alex', at: '2026-10-17T12:00:00.000Z', text: 'oldest' }] } }];
    expect(latestUpdates(requests).map((u) => u.text)).toEqual(['latest', 'second tie', 'first tie']);
    expect(latestUpdates([...requests].reverse())).toEqual(latestUpdates(requests));
  });
  it('D15 each typed failure has actionable English and Spanish copy', () => {
    for (const code of ['stale_revision', 'permission_denied', 'storage_capacity', 'storage_unavailable', 'invalid_media', 'cancelled', 'processing_failure'] as const) {
      expect(en[`failure.${code}`].length).toBeGreaterThan(30); expect(es[`failure.${code}`]).not.toBe(en[`failure.${code}`]);
    }
    const html = renderToStaticMarkup(<I18nProvider language="es"><RecoveryNotice status="invalid" message="Saved bytes retained." onExport={() => {}} onReset={() => {}} onRefresh={() => {}} /></I18nProvider>);
    expect(html).toContain('Exportar los datos guardados');
  });
});

it('D05 recovery never offers a whole-household export or reset to a helper or volunteer', () => {
  const html = renderToStaticMarkup(<RecoveryNotice status="migrated" message="Migration details" canManage={false} onExport={() => {}} onReset={() => {}} onRefresh={() => {}} />);
  expect(html).not.toContain('Export saved bytes'); expect(html).not.toContain('Reset FixList data');
  expect(html).toContain('Ask the resident to export or reset household data.'); expect(html).toContain('Refresh saved data');
});

it('N06 a requests-only helper continues to the particular pending request without resident controls', () => {
  const state = run(atStage('volunteer_reported_done'), { type: 'grant_delegation', personId: 'sam', scopes: ['requests'] });
  const next = helperNextStep(scenario, state, 'sam');
  expect(next).toEqual({ kind: 'helper_wait', requestId: state.requests[0]!.id });
  expect(nextStepCard(next, state, false)).toEqual({ key: 'next.helper_wait', route: { role: 'r', screen: 'request', id: state.requests[0]!.id } });
});

it('N10 the actual question screen retains save feedback in one live status region', () => {
  const state = createInitialState(scenario);
  state.people[0]!.onboarding['resident-guide'] = { stepIndex: 3, completed: true };
  const bytes = JSON.stringify(state);
  vi.stubGlobal('window', { location: { hash: '#/r/question/rug-check', search: '' }, localStorage: { getItem: () => bytes, setItem() {}, removeItem() {} } });
  try {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain(en['check.saved']);
    expect(html).toContain('answer-choices');
    expect(html.match(/role="status"/g)).toHaveLength(1);
  } finally { vi.unstubAllGlobals(); }
});
