import { expect, it } from 'vitest';
import { decodeLocationHash } from './location';
it.each(['#%', '#%E0%A4%A', '#%FF'])('ignores malformed hash %s without throwing', (hash) => {
  expect(decodeLocationHash(hash)).toBe('');
});
it('decodes valid deep links', () => {
  expect(decodeLocationHash('#scan%2Dheading')).toBe('scan-heading');
  expect(decodeLocationHash('')).toBe('');
});

import { demoScenario } from '../data/demo-scenario';
import { scanConcernQuestions } from './location';
it.each(demoScenario.concerns)('maps $id to its own catalog question through action and evidence', (concern) => {
  const questions = scanConcernQuestions(demoScenario, concern.id);
  expect(questions, `Concern ${concern.id} needs exactly one authored question; multiple questions require an explicit choice.`).toHaveLength(1);
  expect(questions[0]!.referenceActionId).toBe(concern.referenceActionId);
  expect(demoScenario.evidence.filter((e) => concern.evidenceIds.includes(e.id)).map((e) => e.checklistItemId)).toContain(questions[0]!.id);
});
it('returns all linked questions for an explicit multi-question choice and never guesses from the room', () => {
  const concern = demoScenario.concerns[0]!, first = scanConcernQuestions(demoScenario, concern.id)[0]!;
  const second = { ...first, id: 'second-question' }, evidence = { ...demoScenario.evidence.find((e) => concern.evidenceIds.includes(e.id))!, id: 'second-evidence', checklistItemId: second.id };
  const scenario = { ...demoScenario, checklist: [second, ...demoScenario.checklist], evidence: [...demoScenario.evidence, evidence], concerns: [{ ...concern, evidenceIds: [...concern.evidenceIds, evidence.id] }] };
  expect(scanConcernQuestions(scenario, concern.id).map((q) => q.id)).toEqual([second.id, first.id]);
  expect(scanConcernQuestions(scenario, 'missing')).toEqual([]);
});
