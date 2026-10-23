import type { DemoScenario } from '../domain/types';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { applyCommand as applyDomainCommand, createInitialState, computePlan, type ResidentCommandInput as DemoCommand, type DemoState } from '../domain/workflow';
import { ProgramDetails } from './CatalogViews';
import { PrintReport } from './PrintReport';
import { AssistanceSection, ChecklistSection, PlanSection, RequestsSection } from './WorkflowSections';

const at = '2026-10-17T12:00:00.000Z';
function applyCommand(scenario: DemoScenario, state: DemoState, value: DemoCommand) { return applyDomainCommand(scenario, state, { actorId: 'margaret', at, ...value }); }

const noop = () => {};

function command(state: DemoState, value: DemoCommand): DemoState {
  const result = applyCommand(demoScenario, state, value);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function confirmedState(): DemoState {
  let state = createInitialState(demoScenario);
  for (const item of demoScenario.checklist) state = command(state, { type: 'answer_checklist', checklistItemId: item.id, answer: 'yes' });
  for (const concern of demoScenario.concerns) state = command(state, { type: 'confirm_concern', concernId: concern.id, at });
  return state;
}

describe('screen and printable catalog content', () => {
  it('shows incomplete initial coverage, unknown facts, and computed explanations with one profile control', () => {
    const state = createInitialState(demoScenario);
    const checklist = renderToStaticMarkup(<ChecklistSection scenario={demoScenario} state={state} onCommand={noop} />);
    const plan = renderToStaticMarkup(<PlanSection scenario={demoScenario} state={state} onCommand={noop} />);
    const assistance = renderToStaticMarkup(<AssistanceSection scenario={demoScenario} state={state} onCommand={noop} />);
    expect(checklist).toContain('0 of 8 answered');
    expect(checklist).toContain('Stairs: 0 of 3 answered');
    expect(plan).toContain('0 of 8 answered');
    expect(plan).toContain('An empty fix list does not certify safety');
    expect(assistance.match(/<select/g)).toHaveLength(1);
    expect(assistance).toContain('id="fictional-profile"');
    expect(assistance).toContain('Unknown / not supplied');
    expect(assistance).toContain('No confirmed work to compare');
    expect(assistance).toContain('At least one of 2 conditions is required');
    expect(assistance).toContain('Requirements this demo does not evaluate');
    expect(assistance).not.toContain('Fictional criteria matched');
  });

  it('prints selected facts, every action context, nested conditions, relevance and references', () => {
    const state = command(confirmedState(), { type: 'select_profile', profileId: 'boundary-maple' });
    const html = renderToStaticMarkup(<PrintReport scenario={demoScenario} snapshot={{ state, generatedAt: at, scanPins: [] }} />);
    expect(html).toContain('8 of 8 answered');
    expect(html).toContain('Fictional: exact age and income boundaries');
    expect(html).toContain('65 years');
    expect(html).toContain('$30,000 a year');
    for (const action of demoScenario.referenceActions) {
      expect(html).toContain(action.title);
      expect(html).toContain(action.guidance.section);
    }
    expect(html.match(/Cost estimate: Unknown/g)).toHaveLength(8);
    expect(html).toContain('Professional review');
    expect(html).toContain('Family review');
    expect(html).toContain('reference material; it does not validate');
    expect(html).toContain('read 2026-10-17');
    expect(html).toContain('Fictional resident condition');
    expect(html).toContain('Work categories overlap');
    expect(html).toContain('approval, or guaranteed funding');
    expect(html).toContain('does not resolve any current or newly confirmed concern');
  });

  it('keeps professional-review context beside an inactive completed family record on screen and print', () => {
    let state = confirmedState();
    state = command(state, { type: 'create_request', referenceActionId: 'review-handrail', expectedRevision: 0 });
    state = command(state, { type: 'unconfirm_concern', concernId: 'handrail-concern' });
    const screen = renderToStaticMarkup(<RequestsSection scenario={demoScenario} state={state} onCommand={noop} />);
    const printed = renderToStaticMarkup(<PrintReport scenario={demoScenario} snapshot={{ state, generatedAt: at, scanPins: [] }} />);
    for (const html of [screen, printed]) {
      expect(html).toContain('Inactive history');
      expect(html).toContain('Local draft');
      expect(html).toContain('professional review');
      expect(html).toContain('not authorization to perform repairs');
      expect(html).toContain('fictional helper label does not establish qualifications');
      expect(html).toContain('Margaret (resident)');
    }
    expect(screen).toContain('Independent verification:');
  });

  it('shows relevant confirmed work together with a failed homeowner condition', () => {
    const state = command(confirmedState(), { type: 'select_profile', profileId: 'maple-renter' });
    const html = renderToStaticMarkup(<AssistanceSection scenario={demoScenario} state={state} onCommand={noop} />);
    expect(html).toContain('A known criterion is not met');
    expect(html).toContain('Fictional homeowner condition: Condition not met');
    expect(html).toContain('Work categories overlap');
    expect(html).toContain('Fictional criteria matched');
  });

  it('makes invalid evaluation visibly unavailable without rendering a match', () => {
    const state = command(createInitialState(demoScenario), { type: 'select_profile', profileId: 'maple-owner' });
    const program = { ...demoScenario.programs[0]!, rule: { id: 'empty', label: 'Empty', op: 'all' as const, children: [] } };
    const html = renderToStaticMarkup(<ProgramDetails program={program} scenario={demoScenario} state={state} plan={computePlan(demoScenario, state)} />);
    expect(html).toContain('Screening unavailable');
    expect(html).toContain('children must not be empty');
    expect(html).not.toContain('Fictional criteria matched');
  });
});
