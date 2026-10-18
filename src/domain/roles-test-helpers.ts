import { demoScenario } from '../data/demo-scenario';
import { applyCommand, createInitialState, type DemoCommand, type DemoState, type ResidentCommandInput } from './workflow';
import type { HelpRequestStatus } from './roles';
export const at = '2026-10-18T12:00:00.000Z';
export const requestId = 'request-review-rug';
export function run(state: DemoState, command: ResidentCommandInput, actorId = 'margaret'): DemoState {
  const result = applyCommand(demoScenario, state, { ...command, actorId, at: command.at ?? at } as DemoCommand);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
export function target(state: DemoState) { return { requestId, expectedRevision: state.requests.find((r) => r.id === requestId)!.revision }; }
export function activeState(): DemoState {
  let s = createInitialState(demoScenario);
  for (const c of demoScenario.checklist) s = run(s, { type: 'answer_checklist', checklistItemId: c.id, answer: c.id === 'rug-check' ? 'yes' : 'no' });
  return run(s, { type: 'confirm_concern', concernId: 'rug-concern' });
}
export function atStage(status: HelpRequestStatus = 'draft'): DemoState {
  let s = run(activeState(), { type: 'create_request', referenceActionId: 'review-rug', expectedRevision: 0 });
  if (status === 'draft') return s;
  s = run(s, { type: 'invite_volunteer', ...target(s), volunteerId: 'alex' });
  if (status === 'invited') return s;
  if (status === 'declined') return run(s, { type: 'decline_invitation', ...target(s), reason: 'Unavailable' }, 'alex');
  if (status === 'cancelled') return run(s, { type: 'cancel_request', ...target(s) });
  s = run(s, { type: 'accept_invitation', ...target(s) }, 'alex');
  if (status === 'accepted') return s;
  s = run(s, { type: 'propose_time', ...target(s), text: 'Saturday at 10 am' }, 'alex');
  s = run(s, { type: 'agree_time', ...target(s) });
  if (status === 'scheduled') return s;
  s = run(s, { type: 'post_update', ...target(s), text: 'Starting the agreed task.' }, 'alex');
  if (status === 'in_progress') return s;
  s = run(s, { type: 'report_done', ...target(s) }, 'alex');
  if (status === 'volunteer_reported_done') return s;
  return run(s, { type: 'confirm_done', ...target(s) });
}
