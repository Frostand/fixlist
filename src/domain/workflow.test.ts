import { describe, expect, it } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import type { DemoScenario } from './types';
import {
  applyCommand as applyDomainCommand,
  computePlan,
  createInitialState,
  type ResidentCommandInput as DemoCommand,
  type DemoState,
} from './workflow';

const at = '2026-10-17T04:00:00.000Z';
function applyCommand(scenario: DemoScenario, state: DemoState, value: DemoCommand) { return applyDomainCommand(scenario, state, { actorId: 'margaret', at, ...value }); }


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
    scenario.concerns[0]!.confirmation = { humanConfirmed: true, actorId: 'margaret', confirmedBy: 'Margaret (resident)', confirmedAt: at };
    scenario.requests = [];
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
    expect(state.confirmations['rug-concern']).toEqual({ humanConfirmed: true, actorId: 'margaret', confirmedBy: 'Margaret (resident)', confirmedAt: at });
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
      confirmations: { ...valid.confirmations, 'rug-concern': { humanConfirmed: true as const, actorId: 'unknown', confirmedBy: 'Someone else', confirmedAt: at } },
    };
    expect(computePlan(demoScenario, forged).map((item) => item.referenceActionId)).toEqual(['review-cord']);
  });
});
