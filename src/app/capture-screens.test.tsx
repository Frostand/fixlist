import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import bundle from '../../scan/tests/capture-parity/valid-bundle.json';
import fixtureFlags from '../../scan/tests/capture-parity/valid-flags.json';
import { demoScenario as scenario } from '../data/demo-scenario';
import { createInitialState } from '../domain/workflow';
import { I18nProvider, translate } from '../i18n';
import { validateCaptureManifest } from '../lib/capture-model';
import { NATIVE_CAPTURE_STRING_KEYS } from '../lib/capture-types';
import { validateCaptureSuggestions } from '../lib/capture-suggestions';
import { canUseCaptures, capturePrompts, CaptureFlow, GuidedPhotoTour, RoomCaptureContent, RoomPage } from './CaptureScreens';
import { RoomList } from './ResidentScreens';
import { visibleHouseholdFor } from '../domain/role-views';
import { activeTab, parentRoute, parseRoute } from './routes';

describe('capture screens preserve roles and human decisions', () => {
  it.each(['en', 'es'] as const)('labels separate camera/library inputs and includes every native string in %s', (language) => {
    const prompts = capturePrompts(scenario, 'bathroom', (key, values) => translate(language, key, values));
    expect(prompts.map((p) => p.checklistItemId)).toEqual([null, 'shower-surface-check', 'bathroom-support-check']);
    const html = renderToStaticMarkup(<I18nProvider language={language}><GuidedPhotoTour prompts={prompts} onSave={async () => {}} onCancel={() => {}} /></I18nProvider>);
    expect(html.match(/capture="environment"/g)).toHaveLength(1); expect(html.match(/accept="image\/\*"/g)).toHaveLength(2);
    expect(html).toContain('aria-label='); expect(html).toContain('disabled=""');
    for (const key of NATIVE_CAPTURE_STRING_KEYS) expect(translate(language, `capture.native.${key}`).length).toBeGreaterThan(2);
  });
  it('never mounts capture screens for a volunteer or an ungranted helper', () => {
    let state = createInitialState(scenario); state = { ...state, delegations: [] };
    for (const person of state.people.filter((p) => p.role !== 'resident')) {
      const props = { scenario, state, person, roomId: 'living-room', navigate: () => {} };
      expect(canUseCaptures(state, person)).toBe(false);
      for (const element of [<RoomPage {...props} />, <CaptureFlow {...props} />]) {
        const html = renderToStaticMarkup(element); expect(html).toContain(translate('en', 'person.noGrant')); expect(html).not.toContain('type="file"'); expect(html).not.toContain('Start walk-through');
      }
    }
    expect(canUseCaptures(state, state.people.find((p) => p.role === 'resident')!)).toBe(true);
    state = { ...state, delegations: [{ personId: 'sam', scopes: ['checklist'], updatedBy: { actorId: 'margaret', at: '2026-10-18T18:00:00.000Z' } }] };
    expect(canUseCaptures(state, state.people.find((p) => p.id === 'sam')!)).toBe(true);
  });
  it('shows per-room capture links only under checklist permission', () => {
    const state = createInitialState(scenario), person = state.people[0]!;
    const html = renderToStaticMarkup(<RoomList scenario={scenario} state={state} person={person} household={visibleHouseholdFor(scenario, state, person.id)!} dispatch={async () => ({ ok: true })} navigate={() => {}} />);
    expect(html.match(/Walk-through and photos/g)).toHaveLength(scenario.rooms.length);
  });
  it('renders only review flags with original question, limitation and experimental score, without answer controls', () => {
    const parsed = validateCaptureManifest({ ...bundle, photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => p) }); if (!parsed.ok) throw new Error(parsed.error);
    const flags = validateCaptureSuggestions(fixtureFlags, parsed.value); if (!flags.ok) throw new Error(flags.error);
    const render = (closed: boolean | null) => renderToStaticMarkup(<RoomCaptureContent record={{ manifest: { ...parsed.value, outline: closed === null ? null : { ...parsed.value.outline!, closed } }, flags: flags.value, photos: new Map() }} photoUrls={new Map([['p01', 'blob:synthetic']])} selectedId="rug-check" onSelect={() => {}} mode="plan" onMode={() => {}} navigate={() => {}} />);
    const html = render(true);
    expect(html).toContain(fixtureFlags.items[0]!.question); expect(html).toContain(fixtureFlags.items[0]!.limitation);
    expect(html).toContain('Experimental model score 0.77 (uncalibrated; not a probability)'); expect(html).toContain('Not a finding');
    expect(html).toContain('#/r/question/rug-check'); expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Room sketch view'); expect(render(false)).not.toContain('Room sketch view'); expect(render(null)).toContain('No room outline. Photos only.');
    expect(html).not.toContain('Confirm concern'); expect(html).not.toContain('type="radio"'); expect(html).not.toContain('% likely'); expect(html).not.toContain('handrail-check');
  });
  it('bounds catalog room routes and assigns their room tab in every layout', () => {
    for (const screen of ['room', 'capture'] as const) {
      expect(parseRoute(`#/r/${screen}/living-room`)).toEqual({ role: 'r', screen, id: 'living-room' });
      expect(parseRoute(`#/r/${screen}/unknown`)).toEqual({ screen: 'start' }); expect(parseRoute(`#/v/${screen}/living-room`)).toEqual({ screen: 'start' });
      for (const layout of ['current', 'three', 'four'] as const) expect(activeTab({ role: 'r', screen, id: 'bathroom' }, null, layout)).toBe('check');
    }
    expect(parentRoute({ role: 'r', screen: 'capture', id: 'bathroom' }, 'resident')).toEqual({ role: 'r', screen: 'room', id: 'bathroom' });
  });
});
