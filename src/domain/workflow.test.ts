import { describe, expect, it } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import type { DemoScenario, FamilyRequest } from './types';
import {
  applyCommand,
  computePlan,
  createInitialState,
  FAMILY_LABEL,
  getRequestViews,
  HELPER_LABEL,
  isIsoTimestamp,
  requestIdForAction,
  type DemoCommand,
  type DemoState,
} from './workflow';

const at = '2026-10-17T04:00:00.000Z';

function command(state: DemoState, value: DemoCommand, scenario: DemoScenario = demoScenario) {
  const result = applyCommand(scenario, state, value);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function confirmed(scenario: DemoScenario = demoScenario) {
  let state = createInitialState(scenario);
  for (const item of scenario.checklist) {
    state = command(state, { type: 'answer_checklist', checklistItemId: item.id, answer: 'yes' }, scenario);
  }
  const selected = scenario === demoScenario ? scenario.concerns.slice(0, 2) : scenario.concerns;
  for (const concern of selected) {
    state = command(state, { type: 'confirm_concern', concernId: concern.id, at }, scenario);
  }
  return state;
}

function requested(status: FamilyRequest['status'] = 'family_reported_requested') {
  let state = command(confirmed(), { type: 'create_request', referenceActionId: 'review-rug' });
  if (status !== 'draft') {
    state = command(state, { type: 'set_request_status', requestId: requestIdForAction('review-rug'), status: 'family_reported_requested' });
  }
  if (status === 'family_reported_in_progress') {
    state = command(state, { type: 'set_request_status', requestId: requestIdForAction('review-rug'), status });
  }
  return state;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('initial state and explicit confirmation', () => {
  it('starts without a plan, confirmations, or workflow requests', () => {
    const state = createInitialState(demoScenario);
    expect(computePlan(demoScenario, state)).toEqual([]);
    expect(Object.keys(state.checklistAnswers)).toHaveLength(8);
    expect(Object.values(state.checklistAnswers).every((answer) => answer === 'unknown')).toBe(true);
    expect(Object.values(state.confirmations).every((item) => !item.humanConfirmed)).toBe(true);
    expect(state.requests).toEqual([]);
    expect(state.profileId).toBe('unknown-profile');
    expect(state).not.toHaveProperty('criterionAnswers');
    expect(state).not.toHaveProperty('facts');
  });

  it('allocates fresh state and ignores authored confirmations and request drafts', () => {
    const scenario = structuredClone(demoScenario) as DemoScenario;
    scenario.concerns[0]!.confirmation = { humanConfirmed: true, confirmedBy: FAMILY_LABEL, confirmedAt: at };
    scenario.requests = requested('draft').requests;
    const first = createInitialState(scenario);
    const second = createInitialState(scenario);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.checklistAnswers).not.toBe(second.checklistAnswers);
    expect(first.confirmations['rug-concern']).not.toBe(second.confirmations['rug-concern']);
    expect(first.profileId).toBe('unknown-profile');
    expect(first.requests).not.toBe(second.requests);
    expect(first.confirmations['rug-concern']?.humanConfirmed).toBe(false);
  });

  it('does not treat a checklist answer as confirmation', () => {
    const state = command(createInitialState(demoScenario), {
      type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes',
    });
    expect(computePlan(demoScenario, state)).toEqual([]);
    expect(applyCommand(demoScenario, state, { type: 'confirm_concern', concernId: 'cord-concern', at }).ok).toBe(false);
  });

  it.each(['unknown', 'no'] as const)('rejects confirmation when its checklist answer is %s', (answer) => {
    const state = command(createInitialState(demoScenario), { type: 'answer_checklist', checklistItemId: 'rug-check', answer });
    expect(applyCommand(demoScenario, state, { type: 'confirm_concern', concernId: 'rug-concern', at }).ok).toBe(false);
  });

  it('records only the selected concern with fixed family attribution', () => {
    const start = command(createInitialState(demoScenario), { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' });
    const state = command(start, { type: 'confirm_concern', concernId: 'rug-concern', at });
    expect(state.confirmations['rug-concern']).toEqual({ humanConfirmed: true, confirmedBy: FAMILY_LABEL, confirmedAt: at });
    expect(state.confirmations['cord-concern']?.humanConfirmed).toBe(false);
    expect(computePlan(demoScenario, state).map((item) => item.referenceActionId)).toEqual(['review-rug']);
  });

  it('requires every backing checklist answer and rejects empty or broken evidence', () => {
    const scenario: DemoScenario = {
      ...demoScenario,
      checklist: demoScenario.checklist.map((item) => ({ ...item, referenceActionId: 'review-rug' })),
      concerns: [{ ...demoScenario.concerns[0]!, evidenceIds: ['rug-observation', 'cord-observation'] }],
    };
    let state = command(createInitialState(scenario), { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' }, scenario);
    expect(applyCommand(scenario, state, { type: 'confirm_concern', concernId: 'rug-concern', at }).ok).toBe(false);
    state = command(state, { type: 'answer_checklist', checklistItemId: 'cord-check', answer: 'yes' }, scenario);
    state = command(state, { type: 'confirm_concern', concernId: 'rug-concern', at }, scenario);
    expect(computePlan(scenario, state)).toHaveLength(1);
    for (const evidenceIds of [[], ['missing-evidence']]) {
      const broken = { ...scenario, concerns: [{ ...scenario.concerns[0]!, evidenceIds }] };
      expect(applyCommand(broken, state, { type: 'confirm_concern', concernId: 'rug-concern', at }).ok).toBe(false);
    }
  });

  it.each(['no', 'unknown'] as const)('revokes dependent confirmation immediately when changed to %s', (answer) => {
    const state = command(confirmed(), { type: 'answer_checklist', checklistItemId: 'rug-check', answer });
    expect(state.confirmations['rug-concern']).toEqual({ humanConfirmed: false, confirmedBy: null, confirmedAt: null });
    expect(state.confirmations['cord-concern']?.humanConfirmed).toBe(true);
    expect(computePlan(demoScenario, state).map((item) => item.referenceActionId)).toEqual(['review-cord']);
    const yesAgain = command(state, { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' });
    expect(yesAgain.confirmations['rug-concern']?.humanConfirmed).toBe(false);
  });

  it('unconfirms only the selected concern', () => {
    const state = command(confirmed(), { type: 'unconfirm_concern', concernId: 'rug-concern' });
    expect(computePlan(demoScenario, state).map((item) => item.referenceActionId)).toEqual(['review-cord']);
  });
});

describe('computed plan', () => {
  it('groups concerns by action and orders actions, concerns, and evidence deterministically', () => {
    const scenario: DemoScenario = {
      ...demoScenario,
      evidence: [
        ...demoScenario.evidence,
        { ...demoScenario.evidence[0]!, id: 'another-rug-observation' },
      ],
      concerns: [
        demoScenario.concerns[1]!,
        { ...demoScenario.concerns[0]!, id: 'z-rug-concern', evidenceIds: ['another-rug-observation', 'rug-observation'] },
        { ...demoScenario.concerns[0]!, id: 'a-rug-concern' },
      ],
    };
    const state = confirmed(scenario);
    const plan = computePlan(scenario, state);
    expect(plan.map((item) => item.referenceActionId)).toEqual(['review-rug', 'review-cord']);
    expect(plan[0]?.concernIds).toEqual(['a-rug-concern', 'z-rug-concern']);
    expect(plan[0]?.evidence.map((item) => item.id)).toEqual(['another-rug-observation', 'rug-observation']);
    expect(plan[0]?.referenceAction).toEqual(scenario.referenceActions[0]);
    expect(plan[0]?.selectionExplanation).toContain('2 explicitly confirmed concerns');
    expect(plan[0]?.orderExplanation).toContain('not a validated risk score');
    expect(plan.map((item) => item.catalogPosition)).toEqual([1, 2]);
    expect(computePlan(scenario, state)).toEqual(plan);
  });

  it('fails closed for dangling checklist/action IDs and mismatched backing actions', () => {
    const variants: DemoScenario[] = [
      { ...demoScenario, checklist: demoScenario.checklist.filter((item) => item.id !== 'rug-check') },
      { ...demoScenario, referenceActions: demoScenario.referenceActions.filter((item) => item.id !== 'review-rug') },
      { ...demoScenario, checklist: demoScenario.checklist.map((item) => item.id === 'rug-check' ? { ...item, referenceActionId: 'review-cord' } : item) },
      { ...demoScenario, evidence: demoScenario.evidence.map((item) => item.id === 'rug-observation' ? { ...item, checklistItemId: 'missing-check' } : item) },
    ];
    for (const scenario of variants) {
      const state = confirmed();
      expect(applyCommand(scenario, state, { type: 'confirm_concern', concernId: 'rug-concern', at }).ok).toBe(false);
      expect(computePlan(scenario, state).map((item) => item.referenceActionId)).toEqual(['review-cord']);
    }
  });

  it('does not select an impossible or forged confirmation', () => {
    const valid = confirmed();
    const missingAnswer = { ...valid, checklistAnswers: { ...valid.checklistAnswers, 'rug-check': 'unknown' as const } };
    expect(computePlan(demoScenario, missingAnswer).map((item) => item.referenceActionId)).toEqual(['review-cord']);
    const forged = {
      ...valid,
      confirmations: { ...valid.confirmations, 'rug-concern': { humanConfirmed: true as const, confirmedBy: 'Someone else', confirmedAt: at } },
    };
    expect(computePlan(demoScenario, forged).map((item) => item.referenceActionId)).toEqual(['review-cord']);
  });
});

describe('local family request lifecycle', () => {
  it('creates only for an active action, with fixed synthetic attribution and unconfirmed completion', () => {
    expect(applyCommand(demoScenario, createInitialState(demoScenario), { type: 'create_request', referenceActionId: 'review-rug' }).ok).toBe(false);
    const state = requested('draft');
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).toMatchObject({
      id: requestIdForAction('review-rug'), referenceActionId: 'review-rug', status: 'draft',
      recordedBy: FAMILY_LABEL, helperLabel: HELPER_LABEL,
      completion: { status: 'unconfirmed', reportedBy: null, reportedAt: null },
      source: { status: 'synthetic', citationUrl: null, verifiedAt: null },
    });
    expect(applyCommand(demoScenario, state, { type: 'create_request', referenceActionId: 'review-rug' }).ok).toBe(false);
  });

  it('requires draft → requested → in progress and never treats status as completion', () => {
    const draft = requested('draft');
    expect(applyCommand(demoScenario, draft, { type: 'set_request_status', requestId: requestIdForAction('review-rug'), status: 'family_reported_in_progress' }).ok).toBe(false);
    const inProgress = requested('family_reported_in_progress');
    expect(inProgress.requests[0]?.completion.status).toBe('unconfirmed');
    expect(applyCommand(demoScenario, inProgress, { type: 'set_request_status', requestId: requestIdForAction('review-rug'), status: 'family_reported_requested' }).ok).toBe(false);
    expect(applyCommand(demoScenario, inProgress, { type: 'set_request_status', requestId: requestIdForAction('review-rug'), status: 'draft' }).ok).toBe(false);
  });

  it('rejects a runtime null status rather than treating it as a terminal transition', () => {
    const value = { type: 'set_request_status', requestId: requestIdForAction('review-rug'), status: null };
    expect(applyCommand(demoScenario, requested('family_reported_in_progress'), value as unknown as DemoCommand).ok).toBe(false);
  });

  it.each(['family_reported_requested', 'family_reported_in_progress'] as const)('requires an explicit family completion command from %s', (status) => {
    const state = command(requested(status), { type: 'complete_request', requestId: requestIdForAction('review-rug'), at });
    expect(state.requests[0]?.completion).toEqual({ status: 'family_reported_complete', reportedBy: FAMILY_LABEL, reportedAt: at });
    expect(computePlan(demoScenario, state)).toHaveLength(2);
    expect(applyCommand(demoScenario, state, { type: 'complete_request', requestId: requestIdForAction('review-rug'), at }).ok).toBe(false);
    expect(applyCommand(demoScenario, state, { type: 'set_request_status', requestId: requestIdForAction('review-rug'), status: 'family_reported_in_progress' }).ok).toBe(false);
    const reopened = command(state, { type: 'reopen_request', requestId: requestIdForAction('review-rug') });
    expect(reopened.requests[0]?.completion).toEqual({ status: 'unconfirmed', reportedBy: null, reportedAt: null });
    expect(reopened.requests[0]?.status).toBe(status);
  });

  it('rejects completion of a draft and reopening an uncompleted record', () => {
    const draft = requested('draft');
    expect(applyCommand(demoScenario, draft, { type: 'complete_request', requestId: requestIdForAction('review-rug'), at }).ok).toBe(false);
    expect(applyCommand(demoScenario, draft, { type: 'reopen_request', requestId: requestIdForAction('review-rug') }).ok).toBe(false);
  });

  it('retains inactive history and blocks every mutation until the action is active again', () => {
    const complete = command(requested(), { type: 'complete_request', requestId: requestIdForAction('review-rug'), at });
    const inactive = command(complete, { type: 'unconfirm_concern', concernId: 'rug-concern' });
    expect(inactive.requests).toEqual(complete.requests);
    expect(getRequestViews(demoScenario, inactive)[0]).toMatchObject({ active: false, activityLabel: 'Inactive history' });
    for (const value of [
      { type: 'create_request', referenceActionId: 'review-rug' },
      { type: 'set_request_status', requestId: requestIdForAction('review-rug'), status: 'family_reported_in_progress' },
      { type: 'complete_request', requestId: requestIdForAction('review-rug'), at },
      { type: 'reopen_request', requestId: requestIdForAction('review-rug') },
    ] satisfies DemoCommand[]) {
      expect(applyCommand(demoScenario, inactive, value).ok).toBe(false);
    }
    const reactivated = command(inactive, { type: 'confirm_concern', concernId: 'rug-concern', at });
    expect(reactivated.requests).toEqual(complete.requests);
    expect(computePlan(demoScenario, reactivated).map((item) => item.referenceActionId)).toContain('review-rug');
    const view = getRequestViews(demoScenario, reactivated)[0]!;
    expect(view.active).toBe(true);
    expect(view.historyNotice).toContain('does not resolve');
    expect(command(reactivated, { type: 'reopen_request', requestId: requestIdForAction('review-rug') }).requests[0]?.completion.status).toBe('unconfirmed');
  });
});

describe('invalid commands, dates, and immutable transitions', () => {
  it.each([
    { type: 'answer_checklist', checklistItemId: '__proto__', answer: 'yes' },
    { type: 'confirm_concern', concernId: 'missing', at },
    { type: 'unconfirm_concern', concernId: 'missing' },
    { type: 'select_profile', profileId: 'missing' },
    { type: 'create_request', referenceActionId: 'missing' },
    { type: 'set_request_status', requestId: 'missing', status: 'draft' },
    { type: 'complete_request', requestId: 'missing', at },
    { type: 'reopen_request', requestId: 'missing' },
  ] satisfies DemoCommand[])('rejects unknown IDs in $type', (value) => {
    expect(applyCommand(demoScenario, confirmed(), value).ok).toBe(false);
  });

  it.each(['', 'yesterday', '2026-02-30T04:00:00.000Z', '2026-10-17', '2026-10-17T04:00:00Z', '2026-10-17T04:00:00.000-04:00'])('rejects noncanonical or impossible timestamp %s', (time) => {
    expect(isIsoTimestamp(time)).toBe(false);
    expect(applyCommand(demoScenario, confirmed(), { type: 'confirm_concern', concernId: 'rug-concern', at: time }).ok).toBe(false);
    expect(applyCommand(demoScenario, requested(), { type: 'complete_request', requestId: requestIdForAction('review-rug'), at: time }).ok).toBe(false);
  });

  it('accepts canonical ISO timestamps, including leap days, without a clock', () => {
    expect(isIsoTimestamp(at)).toBe(true);
    expect(isIsoTimestamp('2028-02-29T00:00:00.000Z')).toBe(true);
    expect(isIsoTimestamp(null)).toBe(false);
  });

  it('rejects unexpected enums or command types at the command boundary', () => {
    const state = confirmed();
    for (const value of [
      { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'maybe' },
      { type: 'answer_criterion', programId: 'fictional-maple-support', criterionId: 'fictional-area', answer: 'met' },
      { type: 'select_profile', profileId: 123 },
      { type: 'set_request_status', requestId: requestIdForAction('review-rug'), status: 'sent' },
      { type: 'send_message' },
    ]) {
      expect(applyCommand(demoScenario, state, value as DemoCommand).ok).toBe(false);
    }
  });

  it('does not mutate frozen scenario/state for any successful command', () => {
    const scenario = deepFreeze(structuredClone(demoScenario));
    let state = deepFreeze(createInitialState(scenario));
    const originalScenario = structuredClone(scenario);
    for (const value of [
      { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' },
      { type: 'confirm_concern', concernId: 'rug-concern', at },
      { type: 'select_profile', profileId: 'maple-owner' },
      { type: 'create_request', referenceActionId: 'review-rug' },
      { type: 'set_request_status', requestId: requestIdForAction('review-rug'), status: 'family_reported_requested' },
      { type: 'set_request_status', requestId: requestIdForAction('review-rug'), status: 'family_reported_in_progress' },
      { type: 'complete_request', requestId: requestIdForAction('review-rug'), at },
      { type: 'reopen_request', requestId: requestIdForAction('review-rug') },
      { type: 'unconfirm_concern', concernId: 'rug-concern' },
      { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'unknown' },
    ] satisfies DemoCommand[]) {
      const before = structuredClone(state);
      const next = command(state, value, scenario);
      expect(state).toEqual(before);
      expect(next).not.toBe(state);
      computePlan(scenario, state);
      getRequestViews(scenario, state);
      state = deepFreeze(next);
    }
    expect(scenario).toEqual(originalScenario);
  });
});
