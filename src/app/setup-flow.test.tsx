import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { createInitialState } from '../domain/workflow';
import { run } from '../domain/roles-test-helpers';
import { I18nProvider, LANGUAGES, translate } from '../i18n';
import { GuideScreen, LanguagePicker, PeopleScreen, WelcomeScreen, skipGuide, openGuide } from './PeopleScreens';
import { createUiDispatch } from './ui-controller';
import { DEMO_STORAGE_KEY, loadDemoState } from '../lib/demo-storage';
import { guideProgress } from './view-model';
function elements(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...elements(node.props.children, type)];
}
function capture(render: () => ReactNode) { let tree: ReactNode; function Probe() { tree = render(); return tree; } const html = renderToStaticMarkup(<Probe />); return { tree, html }; }
const noop = () => {}, send = async () => ({ ok: true as const });
describe('visual four-step setup', () => {
  it('renders every language from the shared list, preserving native names and direction', async () => {
    const select = vi.fn(), { tree, html } = capture(() => LanguagePicker({ current: 'es', onSelect: select }));
    const buttons = elements(tree, 'button'); expect(buttons).toHaveLength(LANGUAGES.length);
    for (const [index, language] of LANGUAGES.entries()) {
      expect(html).toContain(language.nativeName); expect(buttons[index]!.props.dir).toBe(language.dir);
      await (buttons[index]!.props.onClick as () => Promise<void>)(); expect(select).toHaveBeenLastCalledWith(language.code);
    }
  });
  it('has a separate Continue action on welcome and three role cards with other profiles reachable', () => {
    const state = createInitialState(scenario), choose = vi.fn();
    const welcome = renderToStaticMarkup(<WelcomeScreen current="en" onSelect={noop} onContinue={noop} />);
    expect(welcome).toContain('Step 1 of 4'); expect(welcome).toContain(translate('en', 'nav.continue')); expect(welcome).toContain('brand-icon');
    const { tree, html } = capture(() => PeopleScreen({ people: state.people, language: 'en', dispatch: send, onChoose: choose }));
    const cards = elements(tree, 'button').filter((button) => button.props.className === 'role-card'); expect(cards).toHaveLength(3);
    expect(html).toContain('Step 2 of 4'); expect(html).toContain('Jordan');
    for (const [index, id] of ['margaret', 'sam', 'alex'].entries()) { (cards[index]!.props.onClick as () => void)(); expect(choose).toHaveBeenLastCalledWith(id); }
  });
  it.each(['resident', 'volunteer'] as const)('shows three illustrated %s panels then the privacy step', (role) => {
    for (let step = 0; step < 4; step++) {
      let state = createInitialState(scenario); if (role === 'volunteer') state = run(state, { type: 'select_person', personId: 'alex' });
      state = run(state, { type: 'set_onboarding', guideId: `${role}-guide`, stepIndex: step, completed: false }, role === 'volunteer' ? 'alex' : 'margaret');
      const person = state.people.find((person) => person.id === state.activePersonId)!;
      const html = renderToStaticMarkup(<GuideScreen person={person} residentName="Margaret" dispatch={send} onExit={noop} />);
      expect(html).toContain(`Step ${step === 3 ? 4 : 3} of 4`); expect(html).toContain('guide-illustration');
      expect(html).toContain(step === 3 ? translate('en', 'setup.privacy.device') : translate('en', `guide.${role}.${step as 0 | 1 | 2}.title`).replaceAll("'", '&#x27;'));
    }
  });
  it('completes durably before opening the first room, and does not exit after failed persistence', async () => {
    let state = run(createInitialState(scenario), { type: 'set_onboarding', guideId: 'resident-guide', stepIndex: 3, completed: false });
    const exit = vi.fn();
    const values = new Map<string, string>([[DEMO_STORAGE_KEY, JSON.stringify(state)]]), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const dispatch = createUiDispatch({ scenario, storage, getState: () => state, publish: (next) => { state = next; }, clock: () => '2026-10-23T17:00:00.000Z', onError: noop });
    const { tree } = capture(() => GuideScreen({ person: state.people[0]!, residentName: 'Margaret', dispatch, onExit: exit }));
    const button = elements(tree, 'button').find((button) => button.props.children === translate('en', 'setup.firstScan'))!;
    await (button.props.onClick as () => Promise<void>)();
    expect(guideProgress(state.people[0]!).completed).toBe(true); expect(guideProgress(loadDemoState(storage, scenario).state.people[0]!).completed).toBe(true); expect(exit).toHaveBeenLastCalledWith(false, { role: 'r', screen: 'room', id: 'living-room' });
    exit.mockClear();
    const failed = capture(() => GuideScreen({ person: state.people[0]!, residentName: 'Margaret', dispatch: async () => ({ ok: false, code: 'storage_unavailable', error: 'failed' }), onExit: exit }));
    await (elements(failed.tree, 'button').find((button) => button.props.children === translate('en', 'setup.firstScan'))!.props.onClick as () => Promise<void>)();
    expect(exit).not.toHaveBeenCalled();
  });
  it('takes a helper without checklist access to Home instead of an inaccessible scan', async () => {
    let state = run(createInitialState(scenario), { type: 'set_onboarding', guideId: 'resident-guide', stepIndex: 3, completed: false }, 'sam');
    state = run(state, { type: 'select_person', personId: 'sam' }); const exit = vi.fn();
    const { tree, html } = capture(() => GuideScreen({ person: state.people.find((person) => person.id === 'sam')!, residentName: 'Margaret', dispatch: send, onExit: exit, canScan: false }));
    expect(html).toContain(translate('en', 'setup.helperAccess').replaceAll('&', '&amp;')); expect(html).not.toContain(translate('en', 'setup.firstScan'));
    await (elements(tree, 'button').find((button) => button.props.children === translate('en', 'setup.goHome'))!.props.onClick as () => Promise<void>)();
    expect(exit).toHaveBeenLastCalledWith(false, { role: 'r', screen: 'home' });
  });
  it('retains dismissal and replay persistence, and translates the privacy actions into Spanish', async () => {
    const state = createInitialState(scenario), dispatch = vi.fn(send), exit = vi.fn(), navigate = vi.fn();
    await skipGuide(state.people[0]!, dispatch, exit); expect(exit).toHaveBeenCalledWith(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'set_onboarding', guideId: 'resident-guide', stepIndex: 0, completed: false });
    const completed = run(state, { type: 'set_onboarding', guideId: 'resident-guide', stepIndex: 3, completed: true });
    await openGuide(completed.people[0]!, dispatch, navigate); expect(dispatch).toHaveBeenLastCalledWith({ type: 'set_onboarding', guideId: 'resident-guide', stepIndex: 0, completed: false }); expect(navigate).toHaveBeenCalledWith({ screen: 'guide' });
    const html = renderToStaticMarkup(<I18nProvider language="es"><GuideScreen person={completed.people[0]!} residentName="Margaret" dispatch={send} onExit={noop} /></I18nProvider>);
    expect(html).toContain(translate('es', 'setup.firstScan')); expect(html).toContain(translate('es', 'setup.privacy.erase'));
  });
});
