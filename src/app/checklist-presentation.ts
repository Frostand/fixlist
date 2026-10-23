import type { Translator } from '../i18n';
import { computeCoverage } from '../domain/coverage';
import type { DemoState, ChecklistAnswer } from '../domain/workflow';
import type { DemoScenario } from '../domain/types';

type AnswerState = Pick<DemoState, 'checklistAnswers' | 'checklistAttribution'>;
export type DisplayAnswer = ChecklistAnswer | 'unanswered';
/** Presentation only: missing and explicit uncertainty remain unknown in the domain. */
export function displayAnswer(state: AnswerState, id: string): DisplayAnswer {
  const answer = state.checklistAnswers[id] ?? 'unknown';
  return answer === 'unknown' && !state.checklistAttribution[id] ? 'unanswered' : answer;
}
export function checklistAnswerCounts(items: readonly { id: string }[], state: AnswerState) {
  const answers = items.map((item) => displayAnswer(state, item.id));
  const unanswered = answers.filter((answer) => answer === 'unanswered').length;
  return { total: items.length, answered: items.length - unanswered, notSure: answers.filter((answer) => answer === 'unknown').length, unanswered };
}
export function firstUnanswered<T extends { id: string }>(items: readonly T[], state: AnswerState): T | undefined { return items.find((item) => displayAnswer(state, item.id) === 'unanswered'); }
export function checklistPresentation(scenario: DemoScenario, state: DemoState) {
  const coverage = computeCoverage(scenario, state);
  return { ...coverage, ...checklistAnswerCounts(scenario.checklist, state), rooms: coverage.rooms.map((room) => ({ ...room, ...checklistAnswerCounts(scenario.checklist.filter((item) => item.roomId === room.roomId), state) })) };
}

export function progressText(t: Translator, counts: { answered: number; total: number; notSure: number; unanswered: number }): string { return t(counts.notSure ? 'home.progressUncertain' : 'home.progress', counts); }
