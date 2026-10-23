import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { atStage, run } from '../domain/roles-test-helpers';
import { createInitialState, computePlan, visibleHouseholdFor, visibleRequestsFor } from '../domain/workflow';
import { I18nProvider, translate } from '../i18n';
import { en } from '../i18n/en';
import { authored } from '../i18n/authored';
import { ChecklistQuestion, ResidentPlan } from './ResidentScreens';
import { MoreScreen } from './SettingsScreens';
import { VolunteerTasks } from './VolunteerScreens';
import { ProgramDetails, ProfileFacts } from './CatalogViews';
import { activeTab, resourceReturnTo, type Route } from './routes';

const noop = () => {}, dispatch = async () => ({ ok: true as const });
function html(node: ReactNode, language: 'en' | 'es' = 'en') { return renderToStaticMarkup(<I18nProvider language={language}>{node}</I18nProvider>); }
function props(state = createInitialState(scenario)) { return { scenario, state, person: state.people[0]!, household: visibleHouseholdFor(scenario, state, 'margaret')!, dispatch, navigate: noop }; }
function elements(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...elements(node.props.children, type)];
}
function capture(render: () => ReactNode) { let tree: ReactNode; function Probe() { tree = render(); return tree; } html(<Probe />); return tree; }

describe('batch A presentation and explicit choices', () => {
  it('puts explicit question navigation immediately after all choices and before confirmation or photos', async () => {
    const p = props(), navigate = vi.fn(), send = vi.fn(dispatch);
    const questionProps = { ...p, navigate, dispatch: send, questionId: 'rug-check', saved: true, suggestions: null, photoStillRecorded: () => false, onPhotoError: noop };
    const rendered = html(<ChecklistQuestion {...questionProps} />), before = structuredClone(p.state);
    expect(rendered).toMatch(/<\/fieldset><div class="button-row question-navigation">/);
    expect(rendered.indexOf('question-navigation')).toBeLessThan(rendered.indexOf(en['check.unanswered']));
    expect(rendered.indexOf('question-navigation')).toBeLessThan(rendered.indexOf('<details'));
    expect(rendered).not.toContain('<details open');
    const tree = capture(() => ChecklistQuestion(questionProps));
    const yes = elements(tree, 'input').find((input) => input.props.value === 'yes')!;
    await (yes.props.onChange as () => Promise<void>)();
    expect(send).toHaveBeenLastCalledWith({ type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes', position: 0 });
    expect(navigate).not.toHaveBeenCalled(); expect(p.state).toEqual(before); expect(computePlan(scenario, p.state)).toEqual([]);
    await (elements(tree, 'button').find((button) => button.props.children === en['check.next'])!.props.onClick as () => Promise<void>)();
    expect(navigate).toHaveBeenLastCalledWith({ role: 'r', screen: 'question', id: scenario.checklist[1]!.id });
  });
  it.each(['en', 'es'] as const)('uses See fix list only on the last question in %s', (language) => {
    const p = props(), shared = { ...p, saved: true, suggestions: null, photoStillRecorded: () => false, onPhotoError: noop };
    expect(html(<ChecklistQuestion {...shared} questionId={scenario.checklist.at(-1)!.id} />, language)).toContain(translate(language, 'check.seePlan'));
    expect(html(<ChecklistQuestion {...shared} questionId="rug-check" />, language)).not.toContain(translate(language, 'check.seePlan'));
  });
  it('explains confirmation once for multiple pending cards without entering them in the plan', () => {
    let state = createInitialState(scenario);
    for (const id of ['rug-check', 'cord-check']) state = run(state, { type: 'answer_checklist', checklistItemId: id, answer: 'yes' });
    const rendered = html(<ResidentPlan {...props(state)} />);
    expect(rendered.split(en['check.confirmHelp'])).toHaveLength(2);
    expect(rendered.split(en['check.confirm'] + '</button>')).toHaveLength(3);
    expect(computePlan(scenario, state)).toEqual([]);
  });
  it('hides empty volunteer groups and keeps real invitations visible', () => {
    const initial = html(<VolunteerTasks requests={[]} navigate={noop} />);
    expect(initial).toContain(en['volunteer.noTasks']); expect(initial).toContain(en['volunteer.emptyTitle']); expect(initial).not.toContain(en['volunteer.invitations']); expect(initial).not.toContain(en['volunteer.myTasks']);
    for (const stage of ['invited', 'in_progress'] as const) {
      const requests = visibleRequestsFor(scenario, atStage(stage), 'alex').filter((r) => r.kind === 'volunteer');
      const rendered = html(<VolunteerTasks requests={requests} navigate={noop} />);
      expect(rendered).toContain(en[stage === 'invited' ? 'volunteer.invitations' : 'volunteer.myTasks']);
      expect(rendered).not.toContain(en[stage === 'invited' ? 'volunteer.myTasks' : 'volunteer.invitations']);
    }
  });
  it('keeps the old layout selector inert even with its former opt-in', () => {
    const p = props(), more = { person: p.person, resident: true, canViewScan: true, navigate: noop, dispatch, onReset: noop, onLayoutChange: async () => true };
    expect(html(<MoreScreen {...more} />)).not.toContain('navigation-layout');
    expect(html(<MoreScreen {...more} showNavigationLayout />)).not.toContain('id="navigation-layout"');
  });
  it.each(['en', 'es'] as const)('keeps criteria readable, money formatted and a failed condition visible in %s', (language) => {
    const state = run(createInitialState(scenario), { type: 'select_profile', profileId: 'maple-renter' });
    const rendered = html(<><ProfileFacts scenario={scenario} state={state} /><ProgramDetails scenario={scenario} state={state} program={scenario.programs[0]!} plan={[]} /></>, language);
    expect(rendered).toContain('$20,000'); expect(rendered).toContain(language === 'en' ? 'a year' : 'al año');
    expect(rendered).toContain(language === 'en' ? 'Lives in the Maple area.' : 'Vive en la zona de Maple.');
    expect(rendered).toContain('data-status="not_met"'); expect(rendered).toContain(language === 'en' ? 'Profile answer: No.' : 'Respuesta del perfil: No.');
    expect(rendered).not.toContain('expected equal'); expect(rendered).not.toContain('USD/year'); expect(rendered).not.toContain('is false');
    const unknown = html(<ProgramDetails scenario={scenario} state={createInitialState(scenario)} program={scenario.programs[0]!} plan={[]} />, language);
    expect(unknown).toContain(translate(language, 'screen.missing')); expect(unknown).toContain('data-status="unknown"');
  });
  it('highlights Help throughout sharing and invitation, retaining the entry context', () => {
    const plan: Route = { role: 'r', screen: 'plan' };
    let previous: Route = plan, origin: Route | null = null;
    for (const screen of ['sharing', 'invite', 'review', 'request'] as const) {
      const next: Route = { role: 'r', screen, id: 'local-request' };
      origin = resourceReturnTo(next, previous, origin);
      expect(origin).toEqual(plan); expect(activeTab(next, origin)).toBe('requests'); previous = next;
    }
  });
  it.each(['en', 'es'] as const)('pluralizes a single capture photo and retains fictional source disclosure in %s', (language) => {
    const t = (key: keyof typeof en, values?: Record<string, string | number | undefined>) => translate(language, key, values);
    const photos = t('capture.photoOne'), saved = t('room.saved', { date: '2026-10-22', photos });
    expect(saved).toContain(language === 'en' ? '1 photo' : '1 foto'); expect(saved).not.toContain('1 photos');
    expect(t('capture.photoMany', { count: 2 })).toBe(language === 'en' ? '2 photos' : '2 fotos');
    expect(authored(t, scenario.evidence[0]!.observation)).toContain(language === 'en' ? '(fictional)' : '(ficticio)');
    expect(authored(t, scenario.rooms[0]!.name)).toBe(t('catalog.room.living-room'));
  });
});
