import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { createInitialState, computePlan, visibleHouseholdFor, type DemoState } from '../domain/workflow';
import { run, activeState } from '../domain/roles-test-helpers';
import { I18nProvider, translate, type MessageKey } from '../i18n';
import { RoomScanIntro, InlineRoomQuestions } from './CaptureScreens';
import { RoomList, ResidentPlan } from './ResidentScreens';
import { MoreScreen, HelpHub, RecoveryNotice } from './SettingsScreens';
import { ListRow, SegmentedControl, Sheet } from './UI';
import { createUiDispatch } from './ui-controller';
import { DEMO_STORAGE_KEY } from '../lib/demo-storage';
function elements(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...elements(node.props.children, type)];
}
function capture(render: () => ReactNode) { let tree: ReactNode; function Probe() { tree = render(); return tree; } const html = renderToStaticMarkup(<Probe />); return { tree, html }; }
const noop = () => {}, send = async () => ({ ok: true as const });
const text = (key: MessageKey) => translate('en', key);
function props(state = createInitialState(scenario), personId = 'margaret') { return { scenario, state, person: state.people.find((person) => person.id === personId)!, household: visibleHouseholdFor(scenario, state, personId)!, dispatch: send, navigate: noop }; }
function controller(initial: DemoState) {
  let state = initial; const values = new Map([[DEMO_STORAGE_KEY, JSON.stringify(state)]]), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const dispatch = createUiDispatch({ scenario, storage, getState: () => state, publish: (next) => { state = next; }, clock: () => '2026-10-23T17:00:00.000Z', onError: noop });
  return { get state() { return state; }, dispatch };
}
describe('room review and grouped screens', () => {
  it.each(['en', 'es'] as const)('explains all three scan steps and the AR fallback in %s', (language) => {
    for (const arAvailable of [true, false, null]) {
      const html = renderToStaticMarkup(<I18nProvider language={language}><RoomScanIntro roomName="Living room" arAvailable={arAvailable} onStart={noop} /></I18nProvider>);
      expect(html.match(/class="tip-number"/g)).toHaveLength(3);
      expect(html).toContain(translate(language, arAvailable ? 'room.start' : 'room.startPhotos'));
      expect(html).toContain(translate(language, 'room.phonePrivacy'));
      expect(html.includes('disabled=""')).toBe(arAvailable === null);
    }
  });
  it('shows no selected segment for missing answers; a pressed Yes never confirms a concern', async () => {
    const c = controller(createInitialState(scenario)), navigate = vi.fn();
    const before = structuredClone(c.state), { tree, html } = capture(() => InlineRoomQuestions({ ...props(c.state), roomId: 'living-room', dispatch: c.dispatch, navigate }));
    const segment = elements(tree, SegmentedControl)[0]!; expect(segment.props.value).toBeNull();
    expect(html).not.toContain('aria-pressed="true"'); expect(c.state).toEqual(before);
    await (segment.props.onChange as (value: string) => Promise<void>)('yes');
    expect(c.state.checklistAnswers['rug-check']).toBe('yes'); expect(computePlan(scenario, c.state)).toHaveLength(0); expect(navigate).not.toHaveBeenCalled();
    expect(html).toContain('href="#/r/question/rug-check"'); expect(html).toContain(text('check.confirmHelp'));
  });
  it('an explicit No or Not sure clears a prior confirmation using the existing command', async () => {
    for (const answer of ['no', 'unknown']) {
      const c = controller(activeState()); const { tree } = capture(() => InlineRoomQuestions({ ...props(c.state), roomId: 'living-room', dispatch: c.dispatch }));
      await (elements(tree, SegmentedControl)[0]!.props.onChange as (value: string) => Promise<void>)(answer);
      expect(c.state.checklistAnswers['rug-check']).toBe(answer); expect(computePlan(scenario, c.state)).toHaveLength(0);
    }
  });
  it('expires retained inline-answer callbacks when the route guard changes', async () => {
    let current = true; const dispatch = vi.fn(send);
    const { tree } = capture(() => InlineRoomQuestions({ ...props(), roomId: 'living-room', dispatch, canContinue: () => current })); current = false;
    await (elements(tree, SegmentedControl)[0]!.props.onChange as (value: string) => Promise<void>)('yes'); expect(dispatch).not.toHaveBeenCalled();
  });
  it('keeps a failed inline answer unpublished and respects helper confirmation restrictions', async () => {
    const initial = createInitialState(scenario), before = structuredClone(initial), failed = vi.fn(async () => ({ ok: false as const, code: 'storage_unavailable' as const, error: 'blocked' }));
    const { tree } = capture(() => InlineRoomQuestions({ ...props(initial), roomId: 'living-room', dispatch: failed }));
    await (elements(tree, SegmentedControl)[0]!.props.onChange as (value: string) => Promise<void>)('yes'); expect(initial).toEqual(before); expect(computePlan(scenario, initial)).toHaveLength(0);
    const helper = run(run(initial, { type: 'grant_delegation', personId: 'sam', scopes: ['checklist'] }), { type: 'select_person', personId: 'sam' }), c = controller(helper);
    const limited = capture(() => InlineRoomQuestions({ ...props(c.state, 'sam'), roomId: 'living-room', dispatch: c.dispatch }));
    await (elements(limited.tree, SegmentedControl)[0]!.props.onChange as (value: string) => Promise<void>)('yes');
    expect(computePlan(scenario, c.state)).toHaveLength(0); expect(limited.html).not.toContain(`<button>${text('check.confirm')}</button>`);
  });
  it('keeps every room reachable with one row and denies a helper without checklist access', () => {
    const { tree, html } = capture(() => RoomList(props()));
    expect(elements(tree, ListRow)).toHaveLength(scenario.rooms.length);
    for (const room of scenario.rooms) expect(html).toContain(`href="#/r/room/${room.id}"`);
    const restricted = renderToStaticMarkup(<RoomList {...props(run(createInitialState(scenario), { type: 'grant_delegation', personId: 'sam', scopes: ['confirm'] }), 'sam')} />); expect(restricted).toContain(text('person.noGrant')); expect(restricted).not.toContain('#/r/room/');
  });
  it('renders only confirmed fixes in grouped rows and labels the plan’s limits', () => {
    const c = run(activeState(), { type: 'answer_checklist', checklistItemId: 'cord-check', answer: 'yes' });
    const { tree, html } = capture(() => ResidentPlan(props(c)));
    expect(elements(tree, ListRow)).toHaveLength(1); expect(html).toContain(text('plan.toConfirm')); expect(html).toContain(text('plan.intro'));
    expect(computePlan(scenario, c)).toHaveLength(1);
  });
  it('settings connects replay, person switching, and reset while retaining resident gates', async () => {
    const p = props(), navigate = vi.fn(), reset = vi.fn();
    const { tree, html } = capture(() => MoreScreen({ ...p, navigate, resident: true, canViewScan: true, onReset: reset }));
    for (const destination of ['language', 'display', 'access', 'report', 'scan', 'about']) expect(html).toContain(`href="#/r/${destination}"`);
    const replay = elements(tree, ListRow).find((row) => row.props.title === text('setup.how'))!; await (replay.props.onClick as () => Promise<void>)(); expect(navigate).toHaveBeenLastCalledWith({ screen: 'guide' });
    (elements(tree, 'button').find((button) => button.props.children === text('nav.switch'))!.props.onClick as () => void)(); expect(navigate).toHaveBeenLastCalledWith({ screen: 'people' });
    (elements(tree, 'button').find((button) => button.props.id === 'reset-trigger')!.props.onClick as () => void)(); expect(reset).toHaveBeenCalledOnce();
  });
  it('Help exposes the sourced service, local requests and a labelled fictional-programs entry', () => {
    const p = props(), html = renderToStaticMarkup(<HelpHub scenario={scenario} person={p.person} requests={[]} navigate={noop} dispatch={send} />);
    expect(html).toContain('Eldercare Locator'); expect(html).toContain(`href="tel:${scenario.localHelpResources[0]!.phone}"`); expect(html).toContain(text('help.fictional')); expect(html).toContain('href="#/r/resources"'); expect(html).toContain(text('help.local'));
  });
  it('uses the native dialog cancellation event for Escape on sheets', () => {
    const close = vi.fn(), preventDefault = vi.fn();
    const { tree, html } = capture(() => Sheet({ title: 'Review', children: null, onClose: close }));
    expect(html).toContain('<dialog'); expect(html).toContain('aria-labelledby="sheet-title"');
    (elements(tree, 'dialog')[0]!.props.onCancel as (event: { preventDefault(): void }) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
  it('keeps recovery actions available under closed details without permanently exposing technical text', () => {
    const html = renderToStaticMarkup(<RecoveryNotice status="migrated" message="Technical recovery record" onExport={noop} onRefresh={noop} onReset={noop} />);
    expect(html).toContain(text('data.recovery.migrated')); expect(html).toContain('<details>'); expect(html).not.toContain('<details open');
    for (const key of ['data.export', 'data.refresh', 'data.recoveryReset'] as const) expect(html).toContain(text(key));
  });
});
