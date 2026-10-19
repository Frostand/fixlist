import type { ConcernEvidence, DemoScenario, ReferenceAction } from './types';
import type { DemoState } from './workflow';
import { isConfirmedConcern } from './rules';

export interface PlanItem {
  readonly referenceActionId: string;
  readonly referenceAction: ReferenceAction;
  readonly concernIds: readonly string[];
  readonly evidence: readonly ConcernEvidence[];
  /** One-based catalog position, not an urgency or risk score. */
  readonly catalogPosition: number;
  readonly selectionExplanation: string;
  readonly orderExplanation: string;
}

export function computePlan(scenario: DemoScenario, state: DemoState): readonly PlanItem[] {
  return scenario.referenceActions.flatMap((action, index) => {
    const concerns = scenario.concerns
      .filter((concern) => concern.referenceActionId === action.id && isConfirmedConcern(scenario, state, concern.id))
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    if (concerns.length === 0) return [];
    const evidenceIds = new Set(concerns.flatMap((concern) => concern.evidenceIds));
    const evidence = scenario.evidence
      .filter((item) => evidenceIds.has(item.id))
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    const count = concerns.length;
    return [{
      referenceActionId: action.id,
      referenceAction: action,
      concernIds: concerns.map((concern) => concern.id),
      evidence,
      catalogPosition: index + 1,
      selectionExplanation: `Selected from ${count} explicitly confirmed concern${count === 1 ? '' : 's'} with all backing checklist answers recorded as yes; ${evidence.length} authored evidence record${evidence.length === 1 ? '' : 's'} included.`,
      orderExplanation: `Demonstration review order follows the authored reference-action catalog (position ${index + 1}), then stable IDs. This is not a validated risk score.`,
    }];
  });
}

export const PLAN_GROUPING_EXPLANATION = 'Grouped by who can usually do it — a reading aid, not a risk ranking.';
export function groupPlanByEffort(plan: readonly PlanItem[]) {
  return (['quick_fix', 'helper_task', 'professional'] as const).map((effort) => ({
    effort, explanation: PLAN_GROUPING_EXPLANATION, items: plan.filter((item) => item.referenceAction.effort === effort),
  }));
}
