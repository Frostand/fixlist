import type { DemoScenario } from './types';
import type { DemoState } from './workflow';

interface Counts { readonly total: number; readonly answered: number; readonly unknown: number; readonly yes: number; readonly no: number }
export interface ChecklistCoverage extends Counts {
  readonly rooms: readonly (Counts & { readonly roomId: string; readonly roomName: string })[];
  readonly disclaimer: string;
}

/** Answer coverage measures this sample checklist only, never household safety. */
export function computeCoverage(scenario: DemoScenario, state: DemoState): ChecklistCoverage {
  function counts(ids: readonly string[]): Counts {
    const yes = ids.filter((id) => state.checklistAnswers[id] === 'yes').length;
    const no = ids.filter((id) => state.checklistAnswers[id] === 'no').length;
    return { total: ids.length, answered: yes + no, unknown: ids.length - yes - no, yes, no };
  }
  return {
    ...counts(scenario.checklist.map((item) => item.id)),
    rooms: scenario.rooms.map((room) => ({ roomId: room.id, roomName: room.name, ...counts(scenario.checklist.filter((item) => item.roomId === room.id).map((item) => item.id)) })),
    disclaimer: 'Counts describe answers to this fictional sample checklist only. An empty plan or a fully answered sample checklist does not establish a complete home assessment or certify safety.',
  };
}
