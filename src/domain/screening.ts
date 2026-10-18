import { evaluateFactRule, type FactDefinition, type RuleResult } from './fact-screening';
import type { PlanItem } from './plan';
import type { AssistanceProgram, FundingTag, ScreeningStatus } from './types';

export interface ScreeningResult {
  readonly programId: string;
  readonly status: ScreeningStatus;
  readonly ruleResult: RuleResult | null;
  readonly error: string | null;
  readonly explanation: string;
  readonly disclaimer: string;
  readonly unmodeledRequirements: readonly string[];
}

export function screenProgram(program: AssistanceProgram, definitions: readonly FactDefinition[], facts: unknown): ScreeningResult {
  const evaluation = evaluateFactRule(program.rule, definitions, facts);
  const disclaimer = 'Criteria matching does not establish eligibility, availability, approval, or guaranteed funding. Fictional programs do not exist.';
  if (!evaluation.ok) return {
    programId: program.id, status: 'needs_information', ruleResult: null, error: evaluation.error,
    explanation: `Screening is unavailable because its definition or facts are invalid: ${evaluation.error}`,
    disclaimer, unmodeledRequirements: [...program.unmodeledRequirements],
  };
  const status: ScreeningStatus = evaluation.result.status === 'met' ? 'criteria_matched'
    : evaluation.result.status === 'not_met' ? 'known_criterion_not_met' : 'needs_information';
  return {
    programId: program.id, status, ruleResult: evaluation.result, error: null,
    explanation: status === 'criteria_matched' ? 'The selected fictional facts match these authored demonstration criteria.'
      : status === 'known_criterion_not_met' ? 'The selected fictional facts do not meet at least one required condition; unknown results remain shown.'
        : 'The selected fictional facts leave required information unknown. A match cannot be established.',
    disclaimer, unmodeledRequirements: [...program.unmodeledRequirements],
  };
}

export interface ProgramWorkRelevance {
  readonly status: 'relevant' | 'not_relevant' | 'no_confirmed_work';
  readonly matchedActionIds: readonly string[];
  readonly matchedTags: readonly FundingTag[];
  readonly explanation: string;
}

/** Authored work categories are independent of applicant criteria and approval. */
export function computeWorkRelevance(program: AssistanceProgram, plan: readonly PlanItem[]): ProgramWorkRelevance {
  const matches = plan.filter((item) => item.referenceAction.fundingTags.some((tag) => program.coverageTags.includes(tag)));
  const matchedTags = [...new Set(matches.flatMap((item) => item.referenceAction.fundingTags.filter((tag) => program.coverageTags.includes(tag))))];
  return {
    status: plan.length === 0 ? 'no_confirmed_work' : matches.length > 0 ? 'relevant' : 'not_relevant',
    matchedActionIds: matches.map((item) => item.referenceActionId), matchedTags,
    explanation: plan.length === 0 ? 'No confirmed work is in the current plan; work relevance cannot be established.'
      : matches.length > 0 ? 'Authored fictional coverage categories overlap the current confirmed work. This says nothing about applicant criteria, actual coverage, approval or funding.'
        : 'No authored fictional coverage category overlaps the current confirmed work. Applicant criteria are evaluated separately.',
  };
}
