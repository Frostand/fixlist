import type { DemoScenario } from '../domain/types';

/** A malformed shared URL must not abort app startup. URLSearchParams handles search decoding. */
export function decodeLocationHash(hash: string): string {
  try { return decodeURIComponent(hash.replace(/^#/, '')); }
  catch { return ''; }
}

/** Follow authored evidence and action links, never room order. More than one question needs an explicit choice. */
export function scanConcernQuestions(scenario: DemoScenario, concernId: string) {
  const concern = scenario.concerns.find((entry) => entry.id === concernId);
  if (!concern) return [];
  const evidence = scenario.evidence.filter((entry) => concern.evidenceIds.includes(entry.id));
  return scenario.checklist.filter((question) => question.referenceActionId === concern.referenceActionId
    && evidence.some((entry) => entry.checklistItemId === question.id && entry.roomId === question.roomId));
}
