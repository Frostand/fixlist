import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { run, atStage } from '../domain/roles-test-helpers';
import { createInitialState, visibleHouseholdFor, visibleRequestsFor } from '../domain/workflow';
import { I18nProvider, translate } from '../i18n';
import { en } from '../i18n/en';
import { es } from '../i18n/es';
import { ChecklistQuestion, ResidentHome, RoomList } from './ResidentScreens';
import { RoomScanIntro } from './CaptureScreens';
import { GuideScreen } from './PeopleScreens';
const noop = () => {}, send = async () => ({ ok: true as const });
function props(state = createInitialState(scenario)) { return { scenario, state, person: state.people[0]!, household: visibleHouseholdFor(scenario, state, 'margaret')!, dispatch: send, navigate: noop }; }
function question(yes: boolean) { let state = createInitialState(scenario); if (yes) state = run(state, { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' }); return <ChecklistQuestion {...props(state)} questionId="rug-check" saved suggestions={null} photoStillRecorded={() => false} onPhotoError={noop} />; }
describe('second-pass screen polish', () => {
  it('puts separate confirmation first and makes Next secondary after an unconfirmed Yes', () => {
    const html = renderToStaticMarkup(question(true));
    expect(html.indexOf('confirm-box')).toBeLessThan(html.indexOf('question-navigation'));
    expect(html).toContain('class="secondary"');
    expect(html).toMatch(/<button class=""[^>]*>Add to fix list<\/button>/);
    expect(html).toMatch(/<button class="secondary"[^>]*>Next question<\/button>/);
    expect(renderToStaticMarkup(question(false))).toContain('class="answer-status"');
  });
  it('uses an explicit floor-view label and fix-list wording throughout translated copy', () => {
    // The sketch fallback describes a geometric room plan, not an action plan.
    for (const dictionary of [en, es]) for (const [key, value] of Object.entries(dictionary)) if (key !== 'sketch.unavailable') expect(value).not.toMatch(/\bplan(?:es)?\b/i);
  });
  it('separates the room name from the scan title and keeps three preparation steps without repeated illustration', () => {
    const html = renderToStaticMarkup(<RoomScanIntro roomName="Living room" arAvailable onStart={noop} />);
    expect(html).toContain('<p class="eyebrow">Living room</p>'); expect(html).toContain('<h2>Scan this room</h2>');
    expect(html.match(/class="tip-number"/g)).toHaveLength(3); expect(html).not.toContain('guide-illustration');
    expect(html).toContain('Tap each corner of the floor, then tap Done.');
  });
  it('gives each authored room a distinct icon', () => {
    const html = renderToStaticMarkup(<RoomList {...props()} />);
    for (const name of ['sofa', 'hallway', 'stairs', 'bed', 'bath']) expect(html).toContain(`data-icon="${name}"`);
  });
  it('shows updates only when a person has posted one, retaining the update title', () => {
    const p = props(), empty = renderToStaticMarkup(<ResidentHome {...p} requests={[]} next={null} />);
    expect(empty).not.toContain('class="muted home-updates-empty"'); expect(empty).not.toContain('class="card home-updates"');
    const state = atStage('in_progress'), requests = visibleRequestsFor(scenario, state, 'margaret');
    const active = renderToStaticMarkup(<ResidentHome {...props(state)} requests={requests} next={null} />);
    expect(active).toContain('class="card home-updates"'); expect(active).toContain('class="card-title"');
  });
  it.each(['en', 'es'] as const)('names the privacy step in %s without changing its completion action', (language) => {
    const state = run(createInitialState(scenario), { type: 'set_onboarding', guideId: 'resident-guide', stepIndex: 3, completed: false });
    const html = renderToStaticMarkup(<I18nProvider language={language}><GuideScreen person={state.people[0]!} residentName="Margaret" dispatch={send} onExit={noop} /></I18nProvider>);
    expect(html).toContain(`tabindex="-1">${language === 'en' ? 'Privacy' : 'Privacidad'}</h1>`);
    expect(html).toContain('class="setup-step-row"'); expect(html).toContain(translate(language, 'setup.firstScan'));
  });
});
