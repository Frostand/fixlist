import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as domain from '../../community';
import { I18nProvider } from '../../i18n';
import type { Language } from '../../community/types';
import { AskScreen, ElderHome } from './Elder';
import { NearbyList, ScheduleChoices, VolunteerJob, VolunteerProfileScreen } from './Volunteer';
import { MatchChips } from './UI';
vi.mock('./NearbyMap', () => ({ default: () => <div data-mini-map /> }));
const NOW = '2026-10-23T12:00:00.000Z';
const noop = () => {};
function html(node: React.ReactNode, language: Language = 'en') { return renderToStaticMarkup(<I18nProvider language={language}>{node}</I18nProvider>); }
afterEach(() => vi.useRealTimers());
describe('community polish regressions', () => {
  it('shows the requester, their needs and the original language on nearby jobs', () => {
    const state = domain.createSeedState(NOW);
    const view = html(<NearbyList state={state} matches={domain.matchesForVolunteer(state, 'volunteer-jordan', NOW)} onOpen={noop}/>);
    expect(view).toContain('Soon-ja'); expect(view).toContain('Suwanee, GA');
    expect(view).toContain('Recovering from a knee injury'); expect(view).toContain('Asked in'); expect(view).toContain('한국어');
  });
  it('uses sentence case and natural reason chips', () => {
    const view = html(<MatchChips reasons={[{ kind: 'tool', tool: 'ladder' }, { kind: 'available', slot: { day: 6, part: 'morning' } }, { kind: 'rating', stars: 4.5 }]} gaps={[{ kind: 'too-far', miles: 18 }]} />);
    expect(view).toContain('Has a ladder'); expect(view).toContain('Free Sat morning'); expect(view).toContain('4.5★ rating'); expect(view).toContain('Outside your 10 mi range');
  });
  it('formats shared slots with a concrete date and localized time', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
    const slot = { day: 6, part: 'morning' } as const;
    const view = html(<ScheduleChoices slots={[slot]} chosen={slot} customDate="" onChosen={noop} onCustomDate={noop} onAccept={noop}/>);
    expect(view).toContain('Sat, Oct 24'); expect(view).toContain('9:00 AM');
  });
  it('puts trip controls first and collapses job details after acceptance', () => {
    const state = domain.createSeedState(NOW), job = state.jobs.find(j => j.id === 'job-open-soonja-bulb')!;
    const elder = state.accounts.find(a => a.id === job.elderId)!, profile = state.volunteers.find(p => p.accountId === 'volunteer-jordan')!;
    const view = html(<VolunteerJob job={{ ...job, status: 'accepted', volunteerId: profile.accountId }} elder={elder} address="Fictional destination" profile={profile} match={null} onAccept={() => true} onStep={() => true} onMessages={noop}/>);
    expect(view).toContain('You&#x27;re helping Soon-ja');
    expect(view.indexOf('Fictional destination')).toBeLessThan(view.indexOf('c-job-card'));
    expect(view).toContain('<summary>Job details</summary>');
  });
  it('shows volunteer résumé details and newest thank-you notes', () => {
    const state = domain.createSeedState(NOW), account = state.accounts.find(a => a.id === 'volunteer-jordan')!;
    const view = html(<VolunteerProfileScreen state={state} account={account} onEdit={noop} onLog={noop}/>);
    expect(view).toContain('c-avatar'); expect(view).toContain('Lambert High School'); expect(view).toContain('Thank-you notes');
    const notes = state.jobs.filter(j => j.volunteerId === account.id && j.status === 'completed' && j.rating?.note).sort((a,b) => b.rating!.at.localeCompare(a.rating!.at));
    expect(notes.length).toBeGreaterThan(0); expect(view).toContain(notes[0]!.rating!.note!);
    if (notes.length > 1) expect(view.indexOf(notes[0]!.rating!.note!)).toBeLessThan(view.indexOf(notes[1]!.rating!.note!));
    expect(view).toContain(domain.volunteerStats(state, account.id).hours.toFixed(1));
  });
  it('never claims to listen before microphone input starts', () => {
    const account = domain.createSeedState(NOW).accounts[0]!;
    const view = html(<AskScreen talk account={account} onDraft={noop}/>);
    expect(view).not.toContain('I’m listening'); expect(view).toContain('Tap to talk'); expect(view).toContain('Type instead');
  });
  it.each(['en', 'es', 'ar'] as const)('renders the touched volunteer and Talk screens in %s without unresolved copy', language => {
    const state = domain.createSeedState(NOW), account = state.accounts.find(a => a.id === 'volunteer-jordan')!, profile = state.volunteers[0]!;
    const source = state.jobs.find(j => j.id === 'job-open-soonja-bulb')!, elder = state.accounts.find(a => a.id === source.elderId)!;
    const view = html(<div dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <VolunteerJob job={{ ...source, status: 'accepted', volunteerId: account.id }} elder={elder} needs={state.elders.find(p => p.accountId === elder.id)!.needs} address="Fictional destination" profile={profile} match={null} onAccept={() => true} onStep={() => true} onMessages={noop}/>
      <VolunteerProfileScreen state={state} account={account} onEdit={noop} onLog={noop}/>
      <AskScreen talk account={elder} onDraft={noop}/>
      <ScheduleChoices slots={[{ day: 6, part: 'morning' }]} chosen={null} customDate="" onChosen={noop} onCustomDate={noop} onAccept={noop}/>
    </div>, language);
    expect(view).not.toMatch(/\{(?:name|date|language|stars)\}|>c\.[a-z]/);
    expect(view).toContain(language === 'ar' ? 'dir="rtl"' : 'dir="ltr"'); expect(view).toContain('한국어');
  });
  it.each(['en', 'es', 'ar'] as const)('renders elder and family active tracking before home actions in %s', language => {
    const state = domain.createSeedState(NOW), elder = state.accounts[0]!, family = state.accounts.find(a => a.id === 'family-alex')!;
    const open = state.jobs.find(j => j.elderId === elder.id)!;
    const jobs = [{ ...open, status: 'reported-done' as const, volunteerId: 'volunteer-jordan' }];
    for (const account of [elder, family]) {
      const view = html(<ElderHome state={state} elder={elder} account={account} jobs={jobs} onNavigate={noop} onDraft={noop}/>, language);
      expect(view).toContain('c-active-request'); expect(view).toContain('Jordan'); expect(view).toContain('aria-current="step"');
      if (account.role === 'elder') expect(view.indexOf('c-active-request')).toBeLessThan(view.indexOf('c-talk-home'));
    }
  });
});
