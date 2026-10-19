import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { run, atStage } from '../domain/roles-test-helpers';
import { canConfirmConcern, createInitialState, computePlan, elderNextStep, helperNextStep, visibleHouseholdFor, visibleRequestsFor, type DemoState, type Language } from '../domain/workflow';
import { I18nProvider } from '../i18n';
import { en } from '../i18n/en';
import { es } from '../i18n/es';
import { createPrintSnapshot } from '../lib/print';
import { CoverageSummary } from './CatalogViews';
import { ChecklistQuestion, ResidentHome, RoomList, type ResidentProps } from './ResidentScreens';
import { PrintReport } from './PrintReport';
import { ChecklistSection } from './WorkflowSections';
import { FloorPlan } from './FloorPlan';
import { Icon } from './PhoneShell';
import { navigationTabs, navigationLayouts } from './navigation-layouts';
import { checklistAnswerCounts, displayAnswer, firstUnanswered } from './checklist-presentation';

const noop = () => {}, dispatch = async () => ({ ok: true as const });
function html(node: ReactNode, language: Language = 'en') { return renderToStaticMarkup(<I18nProvider language={language}>{node}</I18nProvider>); }
function props(state: DemoState, id = 'margaret'): ResidentProps { return { scenario, state, person: state.people.find((p) => p.id === id)!, household: visibleHouseholdFor(scenario, state, id)!, dispatch, navigate: noop }; }
function mixed() {
  let state = createInitialState(scenario);
  for (const [index, answer] of (['yes', 'no', 'unknown'] as const).entries()) state = run(state, { type: 'answer_checklist', checklistItemId: scenario.checklist[index]!.id, answer });
  return state;
}
function question(state: DemoState, id: string, person = 'margaret') { return <ChecklistQuestion {...props(state, person)} questionId={id} saved suggestions={null} photoStillRecorded={() => false} onPhotoError={noop} />; }
function checkedValues(rendered: string) { return (rendered.match(/<input[^>]*type="radio"[^>]*>/g) ?? []).filter((input) => input.includes('checked=""')).map((input) => input.match(/value="([^"]+)"/)![1]); }
function elements(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...elements(node.props.children, type)];
}
function capture(render: () => ReactNode) { let tree: ReactNode; function Probe() { tree = render(); return tree; } html(<Probe />); return tree; }

describe('unanswered and explicitly uncertain presentation', () => {
  it('derives display state without rewriting stored values or reclassifying legacy Yes/No answers', () => {
    const state = mixed(), before = structuredClone(state), legacy = { ...state, checklistAttribution: {} };
    expect(checklistAnswerCounts(scenario.checklist, state)).toEqual({ total: 8, answered: 3, notSure: 1, unanswered: 5 });
    expect(displayAnswer(legacy, scenario.checklist[0]!.id)).toBe('yes'); expect(displayAnswer(legacy, scenario.checklist[1]!.id)).toBe('no');
    expect(displayAnswer(legacy, scenario.checklist[2]!.id)).toBe('unanswered'); expect(firstUnanswered(scenario.checklist, state)?.id).toBe(scenario.checklist[3]!.id);
    expect(state).toEqual(before);
  });
  it.each(['en', 'es'] as const)('shows no selected answer for an unanswered question in %s', (language) => {
    const state = createInitialState(scenario), rendered = html(question(state, 'rug-check'), language);
    expect(rendered.match(/type="radio"/g)).toHaveLength(3); expect(rendered).not.toContain('checked=""');
    expect(rendered).toContain(language === 'en' ? 'Not answered' : 'Sin responder');
    expect(rendered).not.toContain('data-selected="true"'); expect(computePlan(scenario, state)).toEqual([]);
  });
  it.each(['en', 'es'] as const)('selects explicit Not sure without showing Not answered for that question in %s', (language) => {
    const state = run(createInitialState(scenario), { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'unknown' });
    const rendered = html(question(state, 'rug-check'), language);
    expect(checkedValues(rendered)).toEqual(['unknown']);
    expect(rendered).toContain(language === 'en' ? en['check.unknown'] : es['check.unknown']);
    expect(rendered).not.toContain(language === 'en' ? '>Not answered<' : '>Sin responder<');
  });
  it.each(['yes', 'no'] as const)('keeps explicit %s selected and separate from missing answers', (answer) => {
    const state = run(createInitialState(scenario), { type: 'answer_checklist', checklistItemId: 'rug-check', answer });
    expect(checkedValues(html(question(state, 'rug-check')))).toEqual([answer]);
  });
  it.each(['en', 'es'] as const)('distinguishes all progress counts on the phone and print report in %s', (language) => {
    const state = mixed(), p = props(state), progress = language === 'en' ? '3 of 8 answered (1 not sure); 5 not answered' : '3 de 8 respondidas (1 sin certeza); 5 sin responder';
    const home = html(<ResidentHome {...p} requests={visibleRequestsFor(scenario, state, 'margaret')} next={elderNextStep(scenario, state)} />, language);
    const rooms = html(<RoomList {...p} />, language), summary = html(<CoverageSummary scenario={scenario} state={state} />, language);
    const report = html(<PrintReport scenario={scenario} snapshot={createPrintSnapshot(state, '2026-10-18T12:00:00.000Z')} />, language);
    for (const rendered of [home, rooms, html(question(state, scenario.checklist[3]!.id), language), summary, report]) expect(rendered).toContain(progress);
    const list = report.match(/<section aria-labelledby="report-coverage-heading">[\s\S]*?<\/section>/)![0];
    expect(list.match(new RegExp(`</strong>: ${language === 'en' ? 'Not answered' : 'Sin responder'}`, 'g'))).toHaveLength(5);
    expect(list.match(new RegExp(`</strong>: ${language === 'en' ? en['check.unknown'] : es['check.unknown']}`, 'g'))).toHaveLength(1);
    expect(summary).toContain('data-answer="unanswered"'); expect(summary).toContain('data-answer="unknown"');
    expect(summary).not.toContain(language === 'en' ? ' unknown' : ' desconocidas');
  });
  it('keeps all explicit Not sure answers counted but unresolved, and retains the safety disclaimer', () => {
    let state = createInitialState(scenario);
    for (const item of scenario.checklist) state = run(state, { type: 'answer_checklist', checklistItemId: item.id, answer: 'unknown' });
    const rendered = html(<CoverageSummary scenario={scenario} state={state} />);
    expect(rendered).toContain('8 of 8 answered (8 not sure); 0 not answered'); expect(rendered).not.toContain('checklist is incomplete');
    expect(rendered).toContain('certify safety'); expect(computePlan(scenario, state)).toEqual([]);
    expect(rendered).not.toContain('data-complete="true"');
    const p = props(state); expect(html(<ResidentHome {...p} requests={[]} next={elderNextStep(scenario, state)} />)).toContain('Review a Not sure answer');
  });
  it('uses the same distinction in legacy checklist and floor-plan descriptions', () => {
    const state = mixed(), checklist = html(<ChecklistSection scenario={scenario} state={state} onCommand={noop} />), floor = html(<FloorPlan scenario={scenario} state={state} />);
    expect(checklist.match(/checked=""/g)).toHaveLength(3); expect(checklist).toContain('Not answered');
    expect(checklist).toContain('3 of 8 answered (1 not sure); 5 not answered');
    expect(floor).toContain('not sure'); expect(floor).toContain('not answered'); expect(floor).not.toContain(' unknown');
  });
  it('shows granted helpers the same answer states, without adding checklist fields to volunteer projections', () => {
    let state = run(mixed(), { type: 'grant_delegation', personId: 'sam', scopes: ['checklist'] });
    expect(checkedValues(html(question(state, scenario.checklist[2]!.id, 'sam')))).toEqual(['unknown']);
    expect(html(question(state, scenario.checklist[3]!.id, 'sam'))).toContain('Not answered');
    const p = props(state, 'sam'); expect(html(<ResidentHome {...p} requests={[]} next={helperNextStep(scenario, state, 'sam')} />)).toContain('3 of 8 answered (1 not sure); 5 not answered');
    state = atStage('invited');
    for (const view of visibleRequestsFor(scenario, state, 'alex')) { expect(view.kind).toBe('volunteer'); expect(view).not.toHaveProperty('checklistAnswers'); expect(view).not.toHaveProperty('checklistAttribution'); }
  });
  it('resumes at the first unanswered question globally and within a room, skipping explicit Not sure', async () => {
    let state = run(createInitialState(scenario), { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'unknown' });
    const room = scenario.rooms.find((r) => r.id === 'stairs')!, items = scenario.checklist.filter((q) => q.roomId === room.id);
    state = run(state, { type: 'answer_checklist', checklistItemId: items[0]!.id, answer: 'unknown' });
    state = run(state, { type: 'set_checklist_position', position: scenario.checklist.length - 1 });
    const p = props(state), navigate = vi.fn(), tree = capture(() => RoomList({ ...p, navigate })), buttons = elements(tree, 'button');
    (buttons[0]!.props.onClick as () => void)(); expect(navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'question', id: scenario.checklist[1]!.id });
    await (buttons[1 + scenario.rooms.indexOf(room)]!.props.onClick as () => Promise<void>)();
    const nextInRoom = items[1]!;
    expect(navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'question', id: nextInRoom.id });
    for (const layout of navigationLayouts) {
      const home = capture(() => ResidentHome({ ...p, navigate, layout, requests: [], next: elderNextStep(scenario, state) }));
      (elements(home, 'button')[0]!.props.onClick as () => void)(); expect(navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'question', id: scenario.checklist[1]!.id });
    }
  });
  it('leaves domain confirmation unchanged: missing and Not sure cannot confirm; Yes still needs explicit confirmation', () => {
    const initial = createInitialState(scenario), uncertain = run(initial, { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'unknown' });
    expect(canConfirmConcern(scenario, initial, 'rug-concern')).toBe(false); expect(canConfirmConcern(scenario, uncertain, 'rug-concern')).toBe(false);
    expect(() => run(uncertain, { type: 'confirm_concern', concernId: 'rug-concern' })).toThrow();
    const yes = run(uncertain, { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' }); expect(canConfirmConcern(scenario, yes, 'rug-concern')).toBe(true); expect(computePlan(scenario, yes)).toEqual([]);
    expect(computePlan(scenario, run(yes, { type: 'confirm_concern', concernId: 'rug-concern' }))).toHaveLength(1);
  });
});

describe('task navigation icons', () => {
  const capabilities = { hasChecklist: true, hasPlan: true, hasRequests: true };
  it.each(['three', 'four'] as const)('uses distinct door/person icons in %s with visible labels and hidden SVGs', (layout) => {
    const tabs = navigationTabs(layout, 'resident', capabilities), rooms = tabs.find((tab) => tab.screen === 'check')!, requests = tabs.find((tab) => tab.screen === 'requests')!;
    expect(rooms.icon).toBe('rooms'); expect(requests.icon).toBe('requests');
    const door = html(<Icon name={rooms.icon} />), person = html(<Icon name={requests.icon} />);
    expect(door).not.toBe(person); expect(door).not.toBe(html(<Icon name="check" />)); expect(person).not.toBe(html(<Icon name="tasks" />));
    for (const icon of [door, person]) { expect(icon).toContain('viewBox="0 0 24 24"'); expect(icon).toContain('aria-hidden="true"'); expect(icon).toContain('stroke-width="1.7"'); }
    expect(rooms.label).toBe('nav.rooms'); expect(requests.label).toBe('nav.requests'); if (layout === 'four') expect(tabs.find((tab) => tab.screen === 'plan')!.icon).toBe('plan');
  });
  it('preserves all current and volunteer icon assignments', () => {
    expect(navigationTabs('current', 'resident', capabilities).map((tab) => tab.icon)).toEqual(['home', 'check', 'plan', 'help', 'more']);
    for (const layout of navigationLayouts) expect(navigationTabs(layout, 'volunteer', capabilities).map((tab) => tab.icon)).toEqual(['home', 'tasks', 'profile']);
  });
});
