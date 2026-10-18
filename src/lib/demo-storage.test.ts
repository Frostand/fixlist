import { describe, expect, it } from 'vitest';
import legacyBrowserJson from './demo-storage-legacy-fixture.json?raw';
import { demoScenario } from '../data/demo-scenario';
import type { DemoScenario } from '../domain/types';
import {
  applyCommand,
  computePlan,
  createInitialState,
  FAMILY_LABEL,
  getRequestViews,
  requestIdForAction,
  screenProgram,
  type DemoCommand,
  type DemoState,
} from '../domain/workflow';
import {
  DEMO_STORAGE_KEY,
  getBrowserStorage,
  loadDemoState,
  MAX_SERIALIZED_BYTES,
  resetDemoState,
  saveDemoState,
  validateState,
  type DemoStorage,
} from './demo-storage';

const at = '2026-10-17T04:00:00.000Z';
const later = '2026-10-18T05:00:00.000Z';
const requestId = requestIdForAction('review-rug');

class MemoryStorage implements DemoStorage {
  readonly items = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  readonly removes: string[] = [];
  failRead = false;
  failWrite = false;
  failRemove = false;

  getItem(key: string): string | null {
    this.reads.push(key);
    if (this.failRead) throw new Error('Access denied');
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes.push(key);
    if (this.failWrite) throw new Error('Quota exceeded');
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.removes.push(key);
    if (this.failRemove) throw new Error('Access denied');
    this.items.delete(key);
  }
}

function command(state: DemoState, value: DemoCommand): DemoState {
  const result = applyCommand(demoScenario, state, value);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function requestState(): DemoState {
  return [
    { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' },
    { type: 'confirm_concern', concernId: 'rug-concern', at },
    { type: 'create_request', referenceActionId: 'review-rug' },
    { type: 'set_request_status', requestId, status: 'family_reported_requested' },
    { type: 'complete_request', requestId, at },
  ].reduce((state, value) => command(state, value as DemoCommand), createInitialState(demoScenario));
}

function expectRoundTrip(state: DemoState): void {
  const storage = new MemoryStorage();
  expect(saveDemoState(storage, demoScenario, state).status).toBe('saved');
  const loaded = loadDemoState(storage, demoScenario);
  expect(loaded.status).toBe('loaded');
  expect(loaded.state).toEqual(state);
  expect(loaded.state).not.toBe(state);
  expect(computePlan(demoScenario, loaded.state)).toEqual(computePlan(demoScenario, state));
  expect(storage.writes).toEqual([DEMO_STORAGE_KEY]);
  expect(storage.removes).toEqual([]);
}

function rejectChanged(change: (state: Record<string, unknown>) => void, initial = requestState()) {
  const value = structuredClone(initial) as unknown as Record<string, unknown>;
  change(value);
  const validation = validateState(value, demoScenario);
  expect(validation.ok).toBe(false);
  if (!validation.ok) expect(validation.error.length).toBeGreaterThan(0);
  const storage = new MemoryStorage();
  storage.items.set(DEMO_STORAGE_KEY, JSON.stringify(value));
  const loaded = loadDemoState(storage, demoScenario);
  expect(loaded.status).toBe('invalid');
  expect(loaded.state).toEqual(createInitialState(demoScenario));
  expect(storage.writes).toEqual([]);
  expect(storage.removes).toEqual([]);
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function firstRequest(state: Record<string, unknown>): Record<string, unknown> {
  return record((state.requests as unknown[])[0]);
}

/** Exact browser-generated synthetic v1 bytes captured before this migration. */
function legacyState(): Record<string, unknown> {
  return record(JSON.parse(legacyBrowserJson));
}

function legacyActiveState(): Record<string, unknown> {
  const value = legacyState();
  record(value.confirmations)['rug-concern'] = { humanConfirmed: true, confirmedBy: FAMILY_LABEL, confirmedAt: at };
  return value;
}

function rejectLegacy(change: (value: Record<string, unknown>) => void): void {
  const value = legacyActiveState();
  change(value);
  const storage = new MemoryStorage();
  const serialized = JSON.stringify(value);
  storage.items.set(DEMO_STORAGE_KEY, serialized);
  storage.items.set('another-app', 'keep me');
  for (let index = 0; index < 2; index += 1) {
    const result = loadDemoState(storage, demoScenario);
    expect(result.status).toBe('invalid');
    expect(result.state).toEqual(createInitialState(demoScenario));
  }
  expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(serialized);
  expect(storage.items.get('another-app')).toBe('keep me');
  expect(storage.writes).toEqual([]);
  expect(storage.removes).toEqual([]);
}

describe('runtime state validation and reachable-state round trips', () => {
  it('round trips a fresh state and reconstructs all nested mutable records', () => {
    const start = createInitialState(demoScenario);
    expectRoundTrip(start);
    const result = validateState(start, demoScenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.checklistAnswers).not.toBe(start.checklistAnswers);
    expect(result.state.confirmations).not.toBe(start.confirmations);
    expect(result.state.confirmations['rug-concern']).not.toBe(start.confirmations['rug-concern']);
    expect(result.state.profileId).toBe('unknown-profile');
    expect(result.state.requests).not.toBe(start.requests);
  });

  it('accepts every state in a composed confirmation, request, completion, history and reopening journey', () => {
    const commands: DemoCommand[] = [
      { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' },
      { type: 'confirm_concern', concernId: 'rug-concern', at },
      { type: 'select_profile', profileId: 'maple-owner' },
      { type: 'select_profile', profileId: 'maple-renter' },
      { type: 'create_request', referenceActionId: 'review-rug' },
      { type: 'set_request_status', requestId, status: 'family_reported_requested' },
      { type: 'complete_request', requestId, at },
      { type: 'unconfirm_concern', concernId: 'rug-concern' },
      { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'no' },
      { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' },
      // A new confirmation can be later than the retained completion report.
      { type: 'confirm_concern', concernId: 'rug-concern', at: later },
      { type: 'reopen_request', requestId },
      { type: 'set_request_status', requestId, status: 'family_reported_in_progress' },
      { type: 'complete_request', requestId, at: later },
      { type: 'reopen_request', requestId },
      { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'unknown' },
      { type: 'select_profile', profileId: 'incomplete-maple' },
      { type: 'select_profile', profileId: 'unknown-profile' },
      { type: 'answer_checklist', checklistItemId: 'cord-check', answer: 'yes' },
      { type: 'confirm_concern', concernId: 'cord-concern', at },
      { type: 'create_request', referenceActionId: 'review-cord' },
      { type: 'set_request_status', requestId: requestIdForAction('review-cord'), status: 'family_reported_requested' },
      { type: 'set_request_status', requestId: requestIdForAction('review-cord'), status: 'family_reported_in_progress' },
      { type: 'complete_request', requestId: requestIdForAction('review-cord'), at: later },
      { type: 'answer_checklist', checklistItemId: 'cord-check', answer: 'unknown' },
    ];
    let state = createInitialState(demoScenario);
    for (const value of commands) {
      state = command(state, value);
      expectRoundTrip(state);
    }
    const storage = new MemoryStorage();
    saveDemoState(storage, demoScenario, state);
    const loaded = loadDemoState(storage, demoScenario);
    expect(getRequestViews(demoScenario, loaded.state).map((view) => view.active)).toEqual([false, false]);
    expect(loaded.state.requests[1]?.completion.status).toBe('family_reported_complete');
  });

  it('accepts inactive draft history and preserves unconfirmed completion', () => {
    let state = createInitialState(demoScenario);
    for (const value of [
      { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' },
      { type: 'confirm_concern', concernId: 'rug-concern', at },
      { type: 'create_request', referenceActionId: 'review-rug' },
      { type: 'unconfirm_concern', concernId: 'rug-concern' },
    ] satisfies DemoCommand[]) state = command(state, value);
    expectRoundTrip(state);
    expect(state.requests[0]?.completion.status).toBe('unconfirmed');
  });

  it('round trips 4,032 two-concern/history/profile combinations while new concerns remain unknown', () => {
    const concernModes = ['unknown', 'no', 'yes_unconfirmed', 'yes_confirmed'] as const;
    const historyModes = ['none', 'draft', 'requested', 'in_progress', 'complete_requested', 'complete_in_progress'] as const;
    const profileCases = [
      ['unknown-profile', 'needs_information', 'needs_information'],
      ['maple-owner', 'criteria_matched', 'criteria_matched'],
      ['maple-renter', 'known_criterion_not_met', 'criteria_matched'],
      ['incomplete-maple', 'needs_information', 'needs_information'],
      ['outside-area', 'known_criterion_not_met', 'known_criterion_not_met'],
      ['over-income', 'known_criterion_not_met', 'known_criterion_not_met'],
      ['boundary-maple', 'criteria_matched', 'criteria_matched'],
    ] as const;
    const fixtures = [
      { checklistItemId: 'rug-check', concernId: 'rug-concern', referenceActionId: 'review-rug' },
      { checklistItemId: 'cord-check', concernId: 'cord-concern', referenceActionId: 'review-cord' },
    ] as const;
    expect(demoScenario.profiles.map((profile) => profile.id)).toEqual(profileCases.map(([id]) => id));
    let exercised = 0;
    for (const rugMode of concernModes) for (const cordMode of concernModes) {
      for (const rugHistory of historyModes) for (const cordHistory of historyModes) {
        let base = createInitialState(demoScenario);
        const modes = [rugMode, cordMode];
        const histories = [rugHistory, cordHistory];
        // Produce history through accepted commands while each action is active.
        for (const [index, fixture] of fixtures.entries()) {
          base = command(base, { type: 'answer_checklist', checklistItemId: fixture.checklistItemId, answer: 'yes' });
          base = command(base, { type: 'confirm_concern', concernId: fixture.concernId, at });
          const history = histories[index]!;
          const id = requestIdForAction(fixture.referenceActionId);
          if (history !== 'none') {
            base = command(base, { type: 'create_request', referenceActionId: fixture.referenceActionId });
            if (history !== 'draft') {
              base = command(base, { type: 'set_request_status', requestId: id, status: 'family_reported_requested' });
              if (history === 'in_progress' || history === 'complete_in_progress') {
                base = command(base, { type: 'set_request_status', requestId: id, status: 'family_reported_in_progress' });
              }
              if (history === 'complete_requested' || history === 'complete_in_progress') {
                base = command(base, { type: 'complete_request', requestId: id, at });
              }
            }
          }
          const mode = modes[index]!;
          if (mode === 'unknown' || mode === 'no') {
            base = command(base, { type: 'answer_checklist', checklistItemId: fixture.checklistItemId, answer: mode });
          } else if (mode === 'yes_unconfirmed') {
            base = command(base, { type: 'unconfirm_concern', concernId: fixture.concernId });
          }
        }
        const expectedActionIds = fixtures
          .filter((_, index) => modes[index] === 'yes_confirmed')
          .map((fixture) => fixture.referenceActionId);
        for (const [profileId, expectedSupport, expectedLighting] of profileCases) {
          const state = command(base, { type: 'select_profile', profileId });
          expect(validateState(state, demoScenario).ok).toBe(true);
          const storage = new MemoryStorage();
          expect(saveDemoState(storage, demoScenario, state).status).toBe('saved');
          const loaded = loadDemoState(storage, demoScenario);
          expect(loaded.status).toBe('loaded');
          expect(loaded.state).toEqual(state);
          expect(computePlan(demoScenario, loaded.state).map((item) => item.referenceActionId)).toEqual(expectedActionIds);
          const views = getRequestViews(demoScenario, loaded.state);
          expect(views).toHaveLength(histories.filter((history) => history !== 'none').length);
          for (const view of views) {
            expect(view.active).toBe(expectedActionIds.some((id) => id === view.request.referenceActionId));
            expect(view.activityLabel).toBe(view.active ? 'Active plan action' : 'Inactive history');
          }
          for (const item of demoScenario.checklist.slice(2)) expect(loaded.state.checklistAnswers[item.id]).toBe('unknown');
          const profile = demoScenario.profiles.find((item) => item.id === loaded.state.profileId)!;
          const screened = demoScenario.programs.map((program) => screenProgram(program, demoScenario.factDefinitions, profile.facts));
          expect(screened.map((result) => result.status)).toEqual([expectedSupport, expectedLighting]);
          exercised += 1;
        }
      }
    }
    expect(exercised).toBe(4_032);
  });

  it.each(demoScenario.concerns)('round trips confirmation and retained completion for $id', (concern) => {
    const evidence = demoScenario.evidence.find((item) => item.id === concern.evidenceIds[0])!;
    const id = requestIdForAction(concern.referenceActionId);
    let state = createInitialState(demoScenario);
    for (const value of [
      { type: 'answer_checklist', checklistItemId: evidence.checklistItemId, answer: 'yes' },
      { type: 'confirm_concern', concernId: concern.id, at },
      { type: 'create_request', referenceActionId: concern.referenceActionId },
      { type: 'set_request_status', requestId: id, status: 'family_reported_requested' },
      { type: 'complete_request', requestId: id, at },
    ] satisfies DemoCommand[]) state = command(state, value);
    expectRoundTrip(state);
    state = command(state, { type: 'answer_checklist', checklistItemId: evidence.checklistItemId, answer: 'unknown' });
    expectRoundTrip(state);
    expect(getRequestViews(demoScenario, state)[0]?.active).toBe(false);
    expect(state.requests[0]?.completion.status).toBe('family_reported_complete');
  });

  it('does not retain references to any supplied request or source records', () => {
    const state = requestState();
    const validated = validateState(state, demoScenario);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.state.requests[0]).not.toBe(state.requests[0]);
    expect(validated.state.requests[0]?.completion).not.toBe(state.requests[0]?.completion);
    expect(validated.state.requests[0]?.source).not.toBe(state.requests[0]?.source);
  });

  it.each([null, [], 'state', 1, true, undefined])('rejects a non-state value: %s', (value) => {
    expect(validateState(value, demoScenario).ok).toBe(false);
  });

  it.each(['schemaVersion', 'scenarioId', 'checklistAnswers', 'confirmations', 'profileId', 'requests'])('rejects missing root field %s', (key) => {
    rejectChanged((state) => { delete state[key]; });
  });

  it.each(['schemaVersion', 'scenarioId'])('rejects an unsupported %s', (key) => {
    rejectChanged((state) => { state[key] = key === 'schemaVersion' ? 3 : 'other-scenario'; });
  });

  it('rejects arbitrary root fields, markup, and prototype keys instead of rendering saved text', () => {
    for (const key of ['plan', 'evidence', 'address', 'markup', '__proto__', 'facts', 'profile', 'factDefinitions', 'rule', 'screening', 'criterionAnswers']) {
      rejectChanged((state) => { Object.defineProperty(state, key, { value: '<script>untrusted</script>', enumerable: true }); });
    }
  });

  it.each(['checklistAnswers', 'confirmations'])('rejects missing and unknown IDs in %s', (key) => {
    rejectChanged((state) => { delete record(state[key])[Object.keys(record(state[key]))[0]!]; });
    rejectChanged((state) => { record(state[key])['unknown-id'] = 'unknown'; });
  });

  it.each([null, [], 'yes', true])('rejects malformed checklist answer records: %s', (value) => {
    rejectChanged((state) => { state.checklistAnswers = value; });
  });

  it.each(['met', true, null, '<b>yes</b>'])('rejects unsupported checklist answer %s', (value) => {
    rejectChanged((state) => { record(state.checklistAnswers)['rug-check'] = value; });
  });

  it.each(['unknown-id', '', null, false, { id: 'maple-owner', facts: { homeowner: true } }])('rejects unknown or object profile %s', (value) => {
    rejectChanged((state) => { state.profileId = value; });
  });

  it.each([null, [], 'confirmed', { humanConfirmed: true }])('rejects malformed confirmation %s', (value) => {
    rejectChanged((state) => { record(state.confirmations)['rug-concern'] = value; });
  });

  it('rejects unexpected confirmation keys and non-boolean confirmation status', () => {
    rejectChanged((state) => { record(record(state.confirmations)['rug-concern']).note = 'untrusted'; });
    rejectChanged((state) => { record(record(state.confirmations)['rug-concern']).humanConfirmed = 'true'; });
  });

  it.each(['Someone real', null, '<img src=x>'])('rejects unknown confirmation attribution %s', (value) => {
    rejectChanged((state) => { record(record(state.confirmations)['rug-concern']).confirmedBy = value; });
  });

  it.each([
    '2026-10-17', '2026-10-17T04:00:00Z', '2026-10-17T04:00:00.000+00:00',
    '2026-02-30T04:00:00.000Z', '2026-10-17T24:00:00.000Z', 'invalid', null,
  ])('rejects noncanonical or invalid confirmation time %s', (value) => {
    rejectChanged((state) => { record(record(state.confirmations)['rug-concern']).confirmedAt = value; });
  });

  it('rejects attribution or timestamp on an unconfirmed concern', () => {
    rejectChanged((state) => { record(state.confirmations)['cord-concern'] = { humanConfirmed: false, confirmedBy: FAMILY_LABEL, confirmedAt: null }; });
    rejectChanged((state) => { record(state.confirmations)['cord-concern'] = { humanConfirmed: false, confirmedBy: null, confirmedAt: at }; });
  });

  it.each(['no', 'unknown'])('rejects confirmation without its prerequisite yes answer (%s)', (answer) => {
    rejectChanged((state) => { record(state.checklistAnswers)['rug-check'] = answer; });
  });

  it('rejects confirmation with a broken trusted evidence chain', () => {
    const scenario: DemoScenario = { ...demoScenario, evidence: [] };
    expect(validateState(requestState(), scenario).ok).toBe(false);
  });

  it.each([null, {}, 'requests'])('rejects non-array requests %s', (value) => {
    rejectChanged((state) => { state.requests = value; });
  });

  it('rejects unknown/mismatched request IDs, unknown actions, and duplicates', () => {
    rejectChanged((state) => { firstRequest(state).id = 'sample-family-draft'; });
    rejectChanged((state) => { firstRequest(state).id = requestIdForAction('review-cord'); });
    rejectChanged((state) => { firstRequest(state).referenceActionId = 'unknown-action'; });
    rejectChanged((state) => { (state.requests as unknown[]).push(structuredClone(firstRequest(state))); });
    rejectChanged((state) => { state.requests = Array.from({ length: demoScenario.referenceActions.length + 1 }, () => structuredClone(firstRequest(state))); });
  });

  it.each(['id', 'referenceActionId', 'helperLabel', 'recordedBy', 'status', 'note', 'completion', 'source'])('rejects missing request field %s', (key) => {
    rejectChanged((state) => { delete firstRequest(state)[key]; });
  });

  it('rejects unexpected request text/fields and unsupported request statuses', () => {
    rejectChanged((state) => { firstRequest(state).address = 'private text'; });
    for (const key of ['helperLabel', 'recordedBy', 'note']) {
      rejectChanged((state) => { firstRequest(state)[key] = '<p>arbitrary saved text</p>'; });
    }
    for (const status of ['requested', 'sent', 'complete', null]) {
      rejectChanged((state) => { firstRequest(state).status = status; });
    }
  });

  it.each(['status', 'label', 'citationUrl', 'verifiedAt'])('rejects changed synthetic source %s', (key) => {
    rejectChanged((state) => { record(firstRequest(state).source)[key] = 'invented verified source'; });
    rejectChanged((state) => { delete record(firstRequest(state).source)[key]; });
  });

  it('rejects malformed source and unknown source fields', () => {
    rejectChanged((state) => { firstRequest(state).source = null; });
    rejectChanged((state) => { record(firstRequest(state).source).extra = 'untrusted'; });
  });

  it('rejects completion fields with unsupported status, extra/missing fields, or a draft status', () => {
    rejectChanged((state) => { record(firstRequest(state).completion).status = 'verified_complete'; });
    rejectChanged((state) => { record(firstRequest(state).completion).extra = true; });
    rejectChanged((state) => { delete record(firstRequest(state).completion).reportedBy; });
    rejectChanged((state) => { firstRequest(state).completion = []; });
    rejectChanged((state) => { firstRequest(state).status = 'draft'; });
  });

  it('rejects incorrect completion attribution and invalid timestamps', () => {
    rejectChanged((state) => { record(firstRequest(state).completion).reportedBy = 'Real helper'; });
    rejectChanged((state) => { record(firstRequest(state).completion).reportedAt = null; });
    rejectChanged((state) => { record(firstRequest(state).completion).reportedAt = '2026-10-17T04:00:00Z'; });
    rejectChanged((state) => { record(firstRequest(state).completion).reportedAt = '2026-02-30T04:00:00.000Z'; });
  });

  it('rejects attribution/time on unconfirmed completion', () => {
    rejectChanged((state) => { record(firstRequest(state).completion).status = 'unconfirmed'; });
    rejectChanged((state) => { firstRequest(state).completion = { status: 'unconfirmed', reportedBy: FAMILY_LABEL, reportedAt: null }; });
    rejectChanged((state) => { firstRequest(state).completion = { status: 'unconfirmed', reportedBy: null, reportedAt: at }; });
  });

  it('rejects non-data properties, symbols, and class objects at the public validator boundary', () => {
    const state = createInitialState(demoScenario);
    const getter = { ...state };
    Object.defineProperty(getter, 'scenarioId', { get: () => { throw new Error('Must not run'); } });
    expect(validateState(getter, demoScenario).ok).toBe(false);
    expect(validateState({ ...state, [Symbol('extra')]: true }, demoScenario).ok).toBe(false);
    expect(validateState(Object.assign(new Date(), state), demoScenario).ok).toBe(false);
  });

  it('rejects accessor, sparse, class and extra-property request arrays without invoking getters', () => {
    const state = requestState();
    const getter = [...state.requests];
    Object.defineProperty(getter, '0', { get: () => { throw new Error('Must not run'); } });
    const sparse = new Array(1);
    const extra = Object.assign([...state.requests], { facts: { homeowner: true } });
    class Requests extends Array {}
    const subclass = new Requests();
    subclass.push(...state.requests);
    for (const requests of [getter, sparse, extra, subclass]) expect(validateState({ ...state, requests }, demoScenario).ok).toBe(false);
  });
});

describe('exact original schema-v1 migration', () => {
  it('loads the original browser fixture repeatedly in memory while preserving its exact saved bytes and inactive completed report', () => {
    const storage = new MemoryStorage();
    storage.items.set(DEMO_STORAGE_KEY, legacyBrowserJson);
    const before = legacyState();
    const first = loadDemoState(storage, demoScenario);
    const second = loadDemoState(storage, demoScenario);
    expect(first.status).toBe('migrated');
    expect(second.status).toBe('migrated');
    expect(first.message).toContain('Legacy screening statuses were not converted to facts');
    expect(first.message).toContain('select a fictional profile');
    expect(first.message).toContain('Saved data is unchanged');
    expect(first.state).toEqual(second.state);
    expect(first.state).not.toBe(second.state);
    expect(first.state.confirmations['rug-concern']).not.toBe(second.state.confirmations['rug-concern']);
    expect(first.state.schemaVersion).toBe(2);
    expect(first.state.profileId).toBe('unknown-profile');
    expect(first.state.checklistAnswers['rug-check']).toBe('yes');
    expect(first.state.checklistAnswers['cord-check']).toBe('unknown');
    for (const item of demoScenario.checklist.slice(2)) expect(first.state.checklistAnswers[item.id]).toBe('unknown');
    expect(Object.values(first.state.confirmations).every((value) => !value.humanConfirmed)).toBe(true);
    expect(first.state.requests).toEqual(before.requests);
    expect(first.state.requests[0]?.completion).toEqual({ status: 'family_reported_complete', reportedBy: FAMILY_LABEL, reportedAt: '2026-10-17T12:39:39.419Z' });
    expect(getRequestViews(demoScenario, first.state)[0]?.active).toBe(false);
    expect(computePlan(demoScenario, first.state)).toEqual([]);
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(legacyBrowserJson);
    expect(storage.writes).toEqual([]);
    expect(storage.removes).toEqual([]);
  });

  it('preserves both original concerns and every valid request status/completion as active or inactive history', () => {
    const historyModes = ['none', 'draft', 'requested', 'in_progress', 'complete_requested', 'complete_in_progress'] as const;
    const fixtures = [
      { checklistItemId: 'rug-check', concernId: 'rug-concern', referenceActionId: 'review-rug' },
      { checklistItemId: 'cord-check', concernId: 'cord-concern', referenceActionId: 'review-cord' },
    ] as const;
    let exercised = 0;
    for (const rugActive of [true, false]) for (const cordActive of [true, false]) {
      for (const rugHistory of historyModes) for (const cordHistory of historyModes) {
        let state = createInitialState(demoScenario);
        for (const [index, fixture] of fixtures.entries()) {
          const history = [rugHistory, cordHistory][index]!;
          const id = requestIdForAction(fixture.referenceActionId);
          state = command(state, { type: 'answer_checklist', checklistItemId: fixture.checklistItemId, answer: 'yes' });
          state = command(state, { type: 'confirm_concern', concernId: fixture.concernId, at });
          if (history !== 'none') {
            state = command(state, { type: 'create_request', referenceActionId: fixture.referenceActionId });
            if (history !== 'draft') {
              state = command(state, { type: 'set_request_status', requestId: id, status: 'family_reported_requested' });
              if (history === 'in_progress' || history === 'complete_in_progress') state = command(state, { type: 'set_request_status', requestId: id, status: 'family_reported_in_progress' });
              if (history === 'complete_requested' || history === 'complete_in_progress') state = command(state, { type: 'complete_request', requestId: id, at });
            }
          }
          if (![rugActive, cordActive][index]) state = command(state, { type: 'answer_checklist', checklistItemId: fixture.checklistItemId, answer: 'no' });
          else state = command(state, { type: 'confirm_concern', concernId: fixture.concernId, at: later });
        }
        const value = legacyState();
        value.checklistAnswers = Object.fromEntries(fixtures.map((fixture) => [fixture.checklistItemId, state.checklistAnswers[fixture.checklistItemId]]));
        value.confirmations = Object.fromEntries(fixtures.map((fixture) => [fixture.concernId, state.confirmations[fixture.concernId]]));
        value.requests = state.requests;
        const storage = new MemoryStorage();
        storage.items.set(DEMO_STORAGE_KEY, JSON.stringify(value));
        const migrated = loadDemoState(storage, demoScenario);
        expect(migrated.status).toBe('migrated');
        expect(migrated.state).toEqual(state);
        expect(getRequestViews(demoScenario, migrated.state)).toEqual(getRequestViews(demoScenario, state));
        expect(storage.writes).toEqual([]);
        expect(storage.removes).toEqual([]);
        exercised += 1;
      }
    }
    expect(exercised).toBe(144);
  });

  it('validates all nine old status pairs but never converts them to facts or a selected profile', () => {
    for (const first of ['met', 'not_met', 'unknown']) for (const second of ['met', 'not_met', 'unknown']) {
      const value = legacyState();
      value.criterionAnswers = { 'fictional-maple-support': { 'fictional-area': first, 'fictional-residency': second } };
      const storage = new MemoryStorage();
      storage.items.set(DEMO_STORAGE_KEY, JSON.stringify(value));
      const migrated = loadDemoState(storage, demoScenario);
      expect(migrated.status).toBe('migrated');
      expect(migrated.state.profileId).toBe('unknown-profile');
      expect(Object.keys(migrated.state)).toEqual(['schemaVersion', 'scenarioId', 'checklistAnswers', 'confirmations', 'profileId', 'requests']);
      const profile = demoScenario.profiles.find((item) => item.id === migrated.state.profileId)!;
      expect(profile.facts).toEqual({});
      for (const program of demoScenario.programs) expect(screenProgram(program, demoScenario.factDefinitions, profile.facts).status).toBe('needs_information');
    }
  });

  it('applies the exact 64 KiB serialized boundary before legacy migration', () => {
    const storage = new MemoryStorage();
    const accepted = legacyBrowserJson.padEnd(MAX_SERIALIZED_BYTES, ' ');
    storage.items.set(DEMO_STORAGE_KEY, accepted);
    expect(loadDemoState(storage, demoScenario).status).toBe('migrated');
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(accepted);
    const rejected = `${accepted} `;
    storage.items.set(DEMO_STORAGE_KEY, rejected);
    const result = loadDemoState(storage, demoScenario);
    expect(result.status).toBe('invalid');
    expect(result.message).toContain('64 KiB');
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(rejected);
    expect(storage.writes).toEqual([]);
    expect(storage.removes).toEqual([]);
  });

  it('upgrades stored bytes only after a successful explicit command save', () => {
    const storage = new MemoryStorage();
    storage.items.set(DEMO_STORAGE_KEY, legacyBrowserJson);
    const migrated = loadDemoState(storage, demoScenario);
    expect(migrated.status).toBe('migrated');
    const edited = command(migrated.state, { type: 'select_profile', profileId: 'boundary-maple' });
    expect(saveDemoState(storage, demoScenario, edited).status).toBe('saved');
    const bytes = storage.items.get(DEMO_STORAGE_KEY)!;
    expect(record(JSON.parse(bytes)).schemaVersion).toBe(2);
    expect(bytes).not.toContain('criterionAnswers');
    expect(bytes).not.toContain('facts');
    const loaded = loadDemoState(storage, demoScenario);
    expect(loaded.status).toBe('loaded');
    expect(loaded.state).toEqual(edited);
    expect(loaded.state.requests).toEqual(legacyState().requests);
  });

  it('keeps original v1 bytes when the explicit upgrade save fails', () => {
    const storage = new MemoryStorage();
    storage.items.set(DEMO_STORAGE_KEY, legacyBrowserJson);
    const migrated = loadDemoState(storage, demoScenario);
    storage.failWrite = true;
    const edited = command(migrated.state, { type: 'select_profile', profileId: 'maple-owner' });
    expect(saveDemoState(storage, demoScenario, edited).status).toBe('error');
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(legacyBrowserJson);
    expect(loadDemoState(storage, demoScenario).status).toBe('migrated');
    expect(storage.removes).toEqual([]);
  });

  it('rejects a v1 payload at the direct v2 validator/save boundary', () => {
    const storage = new MemoryStorage();
    expect(validateState(legacyState(), demoScenario).ok).toBe(false);
    expect(saveDemoState(storage, demoScenario, legacyState() as unknown as DemoState).status).toBe('invalid');
    expect(storage.writes).toEqual([]);
  });

  it.each(['schemaVersion', 'scenarioId', 'checklistAnswers', 'confirmations', 'criterionAnswers', 'requests'])('rejects missing legacy root %s without changing bytes', (key) => {
    rejectLegacy((value) => { delete value[key]; });
  });

  it.each([0, 2, 3, '1', null])('rejects unsupported or mismatched legacy version %s', (version) => {
    rejectLegacy((value) => { value.schemaVersion = version; });
  });

  it('rejects old shapes expanded to new IDs, future fields, unknown scenario, or partial current shapes', () => {
    rejectLegacy((value) => { value.scenarioId = 'unknown-scenario'; });
    for (const field of ['facts', 'profile', 'profileId', 'rule', 'screening', 'derivedPlan']) rejectLegacy((value) => { value[field] = {}; });
    rejectLegacy((value) => { record(value.checklistAnswers)['handrail-check'] = 'unknown'; });
    rejectLegacy((value) => { delete record(value.checklistAnswers)['cord-check']; });
    rejectLegacy((value) => { record(value.confirmations)['handrail-concern'] = { humanConfirmed: false, confirmedBy: null, confirmedAt: null }; });
    rejectLegacy((value) => { delete record(value.confirmations)['cord-concern']; });
    rejectLegacy((value) => { record(value.criterionAnswers)['fictional-maple-lighting'] = {}; });
    rejectLegacy((value) => { delete record(value.criterionAnswers)['fictional-maple-support']; });
    rejectLegacy((value) => { record(record(value.criterionAnswers)['fictional-maple-support'])['support-age'] = 'met'; });
    rejectLegacy((value) => { delete record(record(value.criterionAnswers)['fictional-maple-support'])['fictional-residency']; });
    rejectLegacy((value) => { firstRequest(value).id = requestIdForAction('review-handrail'); firstRequest(value).referenceActionId = 'review-handrail'; });
  });

  it.each([null, [], true, 'met'])('rejects malformed legacy criterion map %s', (answer) => {
    rejectLegacy((value) => { value.criterionAnswers = answer; });
    rejectLegacy((value) => { record(value.criterionAnswers)['fictional-maple-support'] = answer; });
  });

  it.each(['yes', false, null, { status: 'met' }])('rejects unsupported legacy criterion status %s', (answer) => {
    rejectLegacy((value) => { record(record(value.criterionAnswers)['fictional-maple-support'])['fictional-area'] = answer; });
  });

  it('fully validates legacy checklist, confirmation, attribution, and canonical date invariants', () => {
    rejectLegacy((value) => { record(value.checklistAnswers)['rug-check'] = 'met'; });
    for (const answer of ['no', 'unknown']) rejectLegacy((value) => { record(value.checklistAnswers)['rug-check'] = answer; });
    for (const confirmation of [null, [], { humanConfirmed: true }, { humanConfirmed: 'true', confirmedBy: FAMILY_LABEL, confirmedAt: at }]) rejectLegacy((value) => { record(value.confirmations)['rug-concern'] = confirmation; });
    rejectLegacy((value) => { record(record(value.confirmations)['rug-concern']).extra = true; });
    rejectLegacy((value) => { record(record(value.confirmations)['rug-concern']).confirmedBy = 'Real person'; });
    for (const timestamp of [null, '2026-10-17', '2026-10-17T04:00:00Z', '2026-02-30T04:00:00.000Z']) rejectLegacy((value) => { record(record(value.confirmations)['rug-concern']).confirmedAt = timestamp; });
    rejectLegacy((value) => { record(value.confirmations)['cord-concern'] = { humanConfirmed: false, confirmedBy: FAMILY_LABEL, confirmedAt: null }; });
    rejectLegacy((value) => { record(value.confirmations)['cord-concern'] = { humanConfirmed: false, confirmedBy: null, confirmedAt: at }; });
  });

  it('fully validates legacy request IDs, count, exact text, statuses, source and completion', () => {
    for (const requests of [null, {}, 'requests']) rejectLegacy((value) => { value.requests = requests; });
    rejectLegacy((value) => { (value.requests as unknown[]).push(structuredClone(firstRequest(value))); });
    rejectLegacy((value) => { value.requests = Array.from({ length: 3 }, () => firstRequest(value)); });
    rejectLegacy((value) => { firstRequest(value).id = 'sample-family-draft'; });
    rejectLegacy((value) => { firstRequest(value).referenceActionId = 'unknown-action'; });
    for (const key of ['id', 'referenceActionId', 'helperLabel', 'recordedBy', 'status', 'note', 'completion', 'source']) rejectLegacy((value) => { delete firstRequest(value)[key]; });
    for (const key of ['helperLabel', 'recordedBy', 'note']) rejectLegacy((value) => { firstRequest(value)[key] = '<p>arbitrary saved text</p>'; });
    rejectLegacy((value) => { firstRequest(value).address = 'private text'; });
    for (const status of ['sent', 'complete', null]) rejectLegacy((value) => { firstRequest(value).status = status; });
    for (const key of ['status', 'label', 'citationUrl', 'verifiedAt']) {
      rejectLegacy((value) => { record(firstRequest(value).source)[key] = 'invented source'; });
      rejectLegacy((value) => { delete record(firstRequest(value).source)[key]; });
    }
    rejectLegacy((value) => { firstRequest(value).source = null; });
    rejectLegacy((value) => { record(firstRequest(value).source).extra = true; });
    rejectLegacy((value) => { firstRequest(value).status = 'draft'; });
    rejectLegacy((value) => { firstRequest(value).completion = []; });
    rejectLegacy((value) => { record(firstRequest(value).completion).status = 'verified_complete'; });
    rejectLegacy((value) => { record(firstRequest(value).completion).extra = true; });
    rejectLegacy((value) => { delete record(firstRequest(value).completion).reportedBy; });
    rejectLegacy((value) => { record(firstRequest(value).completion).reportedBy = 'Real person'; });
    for (const timestamp of [null, '2026-10-17T04:00:00Z', '2026-02-30T04:00:00.000Z']) rejectLegacy((value) => { record(firstRequest(value).completion).reportedAt = timestamp; });
    rejectLegacy((value) => { firstRequest(value).completion = { status: 'unconfirmed', reportedBy: FAMILY_LABEL, reportedAt: null }; });
    rejectLegacy((value) => { firstRequest(value).completion = { status: 'unconfirmed', reportedBy: null, reportedAt: at }; });
  });
});

describe('storage read, write, and reset failure boundaries', () => {
  it('loads an absent key without writing or removing anything', () => {
    const storage = new MemoryStorage();
    const result = loadDemoState(storage, demoScenario);
    expect(result.status).toBe('empty');
    expect(result.state).toEqual(createInitialState(demoScenario));
    expect(storage.reads).toEqual([DEMO_STORAGE_KEY]);
    expect(storage.writes).toEqual([]);
    expect(storage.removes).toEqual([]);
  });

  it.each(['{', '', 'null', '[]', 'true', '"text"'])('recovers from malformed or unsupported JSON: %s', (serialized) => {
    const storage = new MemoryStorage();
    storage.items.set(DEMO_STORAGE_KEY, serialized);
    expect(loadDemoState(storage, demoScenario).status).toBe('invalid');
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(serialized);
    expect(storage.writes).toEqual([]);
    expect(storage.removes).toEqual([]);
  });

  it('accepts a serialized payload at 64 KiB and rejects one byte beyond before parsing', () => {
    const storage = new MemoryStorage();
    const serialized = JSON.stringify(createInitialState(demoScenario));
    storage.items.set(DEMO_STORAGE_KEY, serialized.padEnd(MAX_SERIALIZED_BYTES, ' '));
    expect(loadDemoState(storage, demoScenario).status).toBe('loaded');
    storage.items.set(DEMO_STORAGE_KEY, serialized.padEnd(MAX_SERIALIZED_BYTES + 1, ' '));
    const result = loadDemoState(storage, demoScenario);
    expect(result.status).toBe('invalid');
    expect(result.message).toContain('64 KiB');
    expect(storage.writes).toEqual([]);
  });

  it('bounds UTF-8 bytes, including non-ASCII text, before parsing', () => {
    const storage = new MemoryStorage();
    const serialized = JSON.stringify({ untrusted: '💡'.repeat(17_000) });
    expect(serialized.length).toBeLessThan(MAX_SERIALIZED_BYTES);
    storage.items.set(DEMO_STORAGE_KEY, serialized);
    const result = loadDemoState(storage, demoScenario);
    expect(result.status).toBe('invalid');
    expect(result.message).toContain('64 KiB');
  });

  it('rejects an oversized otherwise valid reconstructed state before saving', () => {
    const scenario: DemoScenario = {
      ...demoScenario,
      checklist: Array.from({ length: 4_000 }, (_, index) => ({ ...demoScenario.checklist[0]!, id: `known-checklist-${index}` })),
    };
    const storage = new MemoryStorage();
    const result = saveDemoState(storage, scenario, createInitialState(scenario));
    expect(result.status).toBe('invalid');
    expect(result.message).toContain('64 KiB');
    expect(storage.writes).toEqual([]);
  });

  it.each([null, undefined])('supports unavailable storage (%s) with a truthful memory fallback', (storage) => {
    const loaded = loadDemoState(storage, demoScenario);
    expect(loaded.status).toBe('unavailable');
    expect(loaded.state).toEqual(createInitialState(demoScenario));
    expect(loaded.message).toContain('memory only');
    expect(saveDemoState(storage, demoScenario, requestState()).status).toBe('unavailable');
    const reset = resetDemoState(storage, demoScenario);
    expect(reset.status).toBe('unavailable');
    expect(reset.state).toEqual(createInitialState(demoScenario));
    expect(reset.message).toContain('reloading may restore older saved data');
  });

  it('catches a denied read without changing the saved value or writing recovery state', () => {
    const storage = new MemoryStorage();
    const serialized = JSON.stringify(requestState());
    storage.items.set(DEMO_STORAGE_KEY, serialized);
    storage.failRead = true;
    const result = loadDemoState(storage, demoScenario);
    expect(result.status).toBe('error');
    expect(result.state).toEqual(createInitialState(demoScenario));
    expect(result.message).toContain('could not be read');
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(serialized);
    expect(storage.writes).toEqual([]);
    expect(storage.removes).toEqual([]);
  });

  it('catches quota/denied writes and preserves the previous saved state', () => {
    const storage = new MemoryStorage();
    const original = JSON.stringify(createInitialState(demoScenario));
    storage.items.set(DEMO_STORAGE_KEY, original);
    storage.failWrite = true;
    const state = requestState();
    const result = saveDemoState(storage, demoScenario, state);
    expect(result.status).toBe('error');
    expect(result.message).toContain('reloading may restore older saved data');
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(original);
    expect(state).toEqual(requestState());
  });

  it('validates runtime state before writing and leaves old data untouched on rejection', () => {
    const storage = new MemoryStorage();
    storage.items.set(DEMO_STORAGE_KEY, 'old value');
    const result = saveDemoState(storage, demoScenario, { ...requestState(), scenarioId: 'other' });
    expect(result.status).toBe('invalid');
    expect(storage.writes).toEqual([]);
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe('old value');
  });

  it('reset removes only its own key and returns fresh memory without confirmations or requests', () => {
    const storage = new MemoryStorage();
    storage.items.set(DEMO_STORAGE_KEY, JSON.stringify(requestState()));
    storage.items.set('another-app', 'keep me');
    const first = resetDemoState(storage, demoScenario);
    const second = resetDemoState(storage, demoScenario);
    expect(first.status).toBe('reset');
    expect(first.state).toEqual(createInitialState(demoScenario));
    expect(first.state.requests).toEqual([]);
    expect(Object.values(first.state.confirmations).every((confirmation) => !confirmation.humanConfirmed)).toBe(true);
    expect(first.state).not.toBe(second.state);
    expect(first.state.confirmations['rug-concern']).not.toBe(second.state.confirmations['rug-concern']);
    expect(storage.items.has(DEMO_STORAGE_KEY)).toBe(false);
    expect(storage.items.get('another-app')).toBe('keep me');
    expect(storage.removes).toEqual([DEMO_STORAGE_KEY, DEMO_STORAGE_KEY]);
    expect(storage.writes).toEqual([]);
    expect(storage.reads).toEqual([]);
  });

  it('resets memory even when removal is denied, preserves unrelated data, and warns about reload', () => {
    const storage = new MemoryStorage();
    const original = JSON.stringify(requestState());
    storage.items.set(DEMO_STORAGE_KEY, original);
    storage.items.set('another-app', 'keep me');
    storage.failRemove = true;
    const result = resetDemoState(storage, demoScenario);
    expect(result.status).toBe('error');
    expect(result.state).toEqual(createInitialState(demoScenario));
    expect(result.message).toContain('Reloading may restore older saved data');
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(original);
    expect(storage.items.get('another-app')).toBe('keep me');
    expect(storage.writes).toEqual([]);
    expect(storage.reads).toEqual([]);
  });

  it('guards browser storage acquisition, including a denied property getter', () => {
    const storage = new MemoryStorage();
    expect(getBrowserStorage({ localStorage: storage })).toBe(storage);
    expect(getBrowserStorage(null)).toBe(null);
    expect(getBrowserStorage()).toBe(null); // Vitest runs this suite without window.
    const denied = { get localStorage(): DemoStorage { throw new Error('Access denied'); } };
    expect(getBrowserStorage(denied)).toBe(null);
  });
});
