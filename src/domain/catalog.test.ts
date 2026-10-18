import { describe, expect, it } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { validateCatalog } from './catalog';
import { computeCoverage } from './coverage';
import { screenProgram, computeWorkRelevance } from './screening';
import type { DemoScenario } from './types';
import { applyCommand as applyDomainCommand, computePlan, createInitialState, getSelectedProfile, type ResidentCommandInput as DemoCommand, type DemoState } from './workflow';

const at = '2026-10-17T12:00:00.000Z';
function applyCommand(scenario: DemoScenario, state: DemoState, value: DemoCommand) { return applyDomainCommand(scenario, state, { actorId: 'margaret', at, ...value }); }


function command(state: DemoState, value: DemoCommand): DemoState {
  const applied = applyCommand(demoScenario, state, value);
  if (!applied.ok) throw new Error(applied.error);
  return applied.state;
}

function confirmActions(actionIds: readonly string[]): DemoState {
  let state = createInitialState(demoScenario);
  for (const actionId of actionIds) {
    const concern = demoScenario.concerns.find((item) => item.referenceActionId === actionId)!;
    const checks = demoScenario.evidence.filter((item) => concern.evidenceIds.includes(item.id)).map((item) => item.checklistItemId);
    for (const checklistItemId of checks) state = command(state, { type: 'answer_checklist', checklistItemId, answer: 'yes' });
    state = command(state, { type: 'confirm_concern', concernId: concern.id, at });
  }
  return state;
}

describe('expanded synthetic catalog and derivation', () => {
  it('validates five rooms, eight linked concerns/actions and seven fixed fictional profiles', () => {
    expect(validateCatalog(demoScenario)).toEqual({ ok: true });
    expect(demoScenario.rooms.map((room) => room.id)).toEqual(['living-room', 'hallway', 'stairs', 'bedroom', 'bathroom']);
    for (const items of [demoScenario.concerns, demoScenario.checklist, demoScenario.evidence, demoScenario.referenceActions]) expect(items).toHaveLength(8);
    expect(demoScenario.profiles.map((profile) => profile.id)).toEqual(['unknown-profile', 'maple-owner', 'maple-renter', 'incomplete-maple', 'outside-area', 'over-income', 'boundary-maple']);
    expect(demoScenario.factDefinitions.map((definition) => definition.id)).toEqual(['ageYears', 'annualIncomeUsd', 'area', 'homeowner', 'resident']);
    expect(demoScenario.programs.map((program) => program.id)).toEqual(['fictional-maple-support', 'fictional-maple-lighting']);
    expect(demoScenario.concerns.slice(0, 2).map((concern) => concern.id)).toEqual(['rug-concern', 'cord-concern']);
    expect(demoScenario.referenceActions.slice(0, 2).map((action) => action.id)).toEqual(['review-rug', 'review-cord']);
  });

  it.each(demoScenario.concerns.flatMap((concern) => ['no', 'unknown'].map((answer) => ({ concern, answer: answer as 'no' | 'unknown' }))))('derives and revokes $concern.id on $answer without implicit confirmation', ({ concern, answer }) => {
    const evidence = demoScenario.evidence.find((item) => item.id === concern.evidenceIds[0])!;
    let state = createInitialState(demoScenario);
    expect(applyCommand(demoScenario, state, { type: 'confirm_concern', concernId: concern.id, at }).ok).toBe(false);
    state = command(state, { type: 'answer_checklist', checklistItemId: evidence.checklistItemId, answer: 'yes' });
    expect(computePlan(demoScenario, state)).toEqual([]);
    state = command(state, { type: 'confirm_concern', concernId: concern.id, at });
    const plan = computePlan(demoScenario, state);
    expect(plan.map((item) => item.referenceActionId)).toEqual([concern.referenceActionId]);
    expect(plan[0]?.evidence.map((item) => item.id)).toEqual(concern.evidenceIds);
    expect(plan[0]?.referenceAction.cost.status).toBe('unknown');
    state = command(state, { type: 'answer_checklist', checklistItemId: evidence.checklistItemId, answer });
    expect(state.confirmations[concern.id]?.humanConfirmed).toBe(false);
    expect(computePlan(demoScenario, state)).toEqual([]);
    state = command(state, { type: 'answer_checklist', checklistItemId: evidence.checklistItemId, answer: 'yes' });
    expect(computePlan(demoScenario, state)).toEqual([]);
  });

  it('preserves authored order across all eight actions independently of confirmation order', () => {
    const ids = demoScenario.referenceActions.map((action) => action.id);
    const state = confirmActions([...ids].reverse());
    const plan = computePlan(demoScenario, state);
    expect(plan.map((item) => item.referenceActionId)).toEqual(ids);
    expect(plan.map((item) => item.catalogPosition)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(plan.every((item) => item.orderExplanation.includes('not a validated risk score'))).toBe(true);
  });

  it('keeps topic references separate from invented observations, routing, coverage and unknown costs', () => {
    const professional = ['review-handrail', 'review-stair-lighting', 'review-bathroom-support'];
    for (const action of demoScenario.referenceActions) {
      expect(action.source).toMatchObject({ status: 'synthetic', citationUrl: null, verifiedAt: null });
      expect(action.guidance).toMatchObject({ title: 'CDC 2017 Check for Safety', url: 'https://www.cdc.gov/steadi/pdf/steadi-brochure-checkforsafety-508.pdf', reviewedOn: '2026-10-17' });
      expect(action.guidance.section).toMatch(/^Page 2:/);
      expect(action.helpRouting.kind).toBe(professional.includes(action.id) ? 'professional_review' : 'family_review');
      expect(action.cost.status).toBe('unknown');
      expect(action.cost).not.toHaveProperty('amount');
      expect(action.fundingTags.length).toBeGreaterThan(0);
    }
    expect(demoScenario.evidence.every((item) => item.source.status === 'synthetic' && item.source.verifiedAt === null)).toBe(true);
    expect(demoScenario.programs.every((program) => program.fictional && program.source.status === 'synthetic' && program.source.verifiedAt === null && program.contact === null)).toBe(true);
  });
});

describe('coverage measures answers only', () => {
  it('starts with eight unknown questions distributed across five rooms and no safety claim', () => {
    const coverage = computeCoverage(demoScenario, createInitialState(demoScenario));
    expect(coverage).toMatchObject({ total: 8, answered: 0, unknown: 8, yes: 0, no: 0 });
    expect(coverage.rooms.map((room) => [room.roomId, room.total, room.unknown])).toEqual([['living-room', 1, 1], ['hallway', 1, 1], ['stairs', 3, 3], ['bedroom', 1, 1], ['bathroom', 2, 2]]);
    expect(coverage.disclaimer).toContain('does not establish a complete home assessment or certify safety');
  });

  it('counts yes and no as answered without adding a plan action or relying on confirmations', () => {
    let state = command(createInitialState(demoScenario), { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' });
    state = command(state, { type: 'answer_checklist', checklistItemId: 'stair-clutter-check', answer: 'no' });
    expect(computeCoverage(demoScenario, state)).toMatchObject({ answered: 2, unknown: 6, yes: 1, no: 1 });
    expect(computePlan(demoScenario, state)).toEqual([]);
    const before = computeCoverage(demoScenario, state);
    state = command(state, { type: 'confirm_concern', concernId: 'rug-concern', at });
    expect(computeCoverage(demoScenario, state)).toEqual(before);
    state = command(state, { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'unknown' });
    expect(computeCoverage(demoScenario, state)).toMatchObject({ answered: 1, unknown: 7, yes: 0, no: 1 });
  });

  it('keeps missing answers unknown and ignores unrelated answers', () => {
    const state = { ...createInitialState(demoScenario), checklistAnswers: { extra: 'yes' as const } };
    expect(computeCoverage(demoScenario, state)).toMatchObject({ answered: 0, unknown: 8 });
  });

  it('supports an answered no-only sample with an empty plan and retained assessment limits', () => {
    let state = createInitialState(demoScenario);
    for (const item of demoScenario.checklist) state = command(state, { type: 'answer_checklist', checklistItemId: item.id, answer: 'no' });
    expect(computeCoverage(demoScenario, state)).toMatchObject({ answered: 8, unknown: 0, no: 8 });
    expect(computePlan(demoScenario, state)).toEqual([]);
    expect(computeCoverage(demoScenario, state).disclaimer).toContain('does not establish');
  });
});

describe('fact-derived fictional program screening', () => {
  const expected = [
    ['unknown-profile', 'needs_information', 'needs_information'],
    ['maple-owner', 'criteria_matched', 'criteria_matched'],
    ['maple-renter', 'known_criterion_not_met', 'criteria_matched'],
    ['incomplete-maple', 'needs_information', 'needs_information'],
    ['outside-area', 'known_criterion_not_met', 'known_criterion_not_met'],
    ['over-income', 'known_criterion_not_met', 'known_criterion_not_met'],
    ['boundary-maple', 'criteria_matched', 'criteria_matched'],
  ] as const;

  it.each(expected)('%s produces %s / %s', (profileId, support, lighting) => {
    const state = command(createInitialState(demoScenario), { type: 'select_profile', profileId });
    const profile = getSelectedProfile(demoScenario, state)!;
    const results = demoScenario.programs.map((program) => screenProgram(program, demoScenario.factDefinitions, profile.facts));
    expect(results.map((item) => item.status)).toEqual([support, lighting]);
    expect(results.every((item) => item.error === null && item.ruleResult !== null && item.unmodeledRequirements.length > 0)).toBe(true);
    expect(results.every((item) => item.disclaimer.includes('approval') && item.disclaimer.includes('funding'))).toBe(true);
    expect(state).not.toHaveProperty('criterionAnswers');
    expect(state).not.toHaveProperty('facts');
  });

  it('retains nested failed and unknown explanations when another branch meets an any condition', () => {
    const program = demoScenario.programs[1]!;
    const facts = { ageYears: 70, annualIncomeUsd: 20000, area: 'maple', homeowner: null, resident: true };
    const screened = screenProgram(program, demoScenario.factDefinitions, facts);
    expect(screened.status).toBe('criteria_matched');
    expect(screened.ruleResult?.children[2]?.children.map((child) => child.status)).toEqual(['unknown', 'met']);
    expect(screened.ruleResult?.children[2]?.children[0]?.explanation).toContain('unknown');
    const failed = screenProgram(program, demoScenario.factDefinitions, { ...facts, area: 'cedar', resident: null });
    expect(failed.status).toBe('known_criterion_not_met');
    expect(failed.ruleResult?.children[2]?.status).toBe('unknown');
  });

  it('fails visibly for invalid rule definitions and facts rather than returning a match', () => {
    const program = demoScenario.programs[0]!;
    for (const screened of [
      screenProgram({ ...program, rule: { id: 'bad', label: 'Bad', op: 'all', children: [] } }, demoScenario.factDefinitions, {}),
      screenProgram(program, demoScenario.factDefinitions, { ageYears: '70' }),
    ]) {
      expect(screened.status).toBe('needs_information');
      expect(screened.ruleResult).toBeNull();
      expect(screened.error).not.toBeNull();
      expect(screened.explanation).toContain('unavailable');
    }
  });

  it('switches profiles without changing confirmations, answers, plan or inactive completed history', () => {
    let state = confirmActions(['review-handrail']);
    state = command(state, { type: 'create_request', referenceActionId: 'review-handrail', expectedRevision: 0 });
    state = command(state, { type: 'unconfirm_concern', concernId: 'handrail-concern' });
    const before = structuredClone(state);
    for (const profile of demoScenario.profiles) {
      state = command(state, { type: 'select_profile', profileId: profile.id });
      expect(state.confirmations).toEqual(before.confirmations);
      expect(state.checklistAnswers).toEqual(before.checklistAnswers);
      expect(state.requests).toEqual(before.requests);
      expect(state.requests[0]?.status).toBe('draft');
      expect(computePlan(demoScenario, state)).toEqual([]);
    }
    expect(applyCommand(demoScenario, state, { type: 'select_profile', profileId: 'real-person' }).ok).toBe(false);
    expect(getSelectedProfile(demoScenario, { ...state, profileId: 'missing' })).toBeNull();
  });
});

describe('work relevance is independent from applicant criteria', () => {
  const support = demoScenario.programs[0]!;
  const lighting = demoScenario.programs[1]!;

  it('distinguishes no confirmed work, unrelated work and overlapping work with stable IDs/tags', () => {
    expect(computeWorkRelevance(support, [])).toMatchObject({ status: 'no_confirmed_work', matchedActionIds: [], matchedTags: [] });
    const plan = computePlan(demoScenario, confirmActions(['review-stair-lighting', 'review-night-lighting']));
    expect(computeWorkRelevance(support, plan)).toMatchObject({ status: 'not_relevant', matchedActionIds: [], matchedTags: [] });
    expect(computeWorkRelevance(lighting, plan)).toMatchObject({ status: 'relevant', matchedActionIds: ['review-stair-lighting', 'review-night-lighting'], matchedTags: ['lighting'] });
  });

  it('preserves relevant work alongside a known criterion failure or unknown profile', () => {
    const plan = computePlan(demoScenario, confirmActions(['review-handrail', 'review-rug']));
    expect(computeWorkRelevance(support, plan)).toMatchObject({ status: 'relevant', matchedActionIds: ['review-rug', 'review-handrail'], matchedTags: ['general_repair', 'railing'] });
    for (const profileId of ['maple-renter', 'unknown-profile']) {
      const profile = demoScenario.profiles.find((item) => item.id === profileId)!;
      expect(screenProgram(support, demoScenario.factDefinitions, profile.facts).status).toBe(profileId === 'maple-renter' ? 'known_criterion_not_met' : 'needs_information');
      expect(computeWorkRelevance(support, plan).status).toBe('relevant');
    }
  });

  it('withdraws relevance when confirmation is revoked and retains the original family completion rule', () => {
    let state = confirmActions(['review-handrail']);
    state = command(state, { type: 'create_request', referenceActionId: 'review-handrail', expectedRevision: 0 });
    expect(computeWorkRelevance(support, computePlan(demoScenario, state)).status).toBe('relevant');
    state = command(state, { type: 'unconfirm_concern', concernId: 'handrail-concern' });
    expect(computeWorkRelevance(support, computePlan(demoScenario, state)).status).toBe('no_confirmed_work');
    expect(state.requests[0]?.status).toBe('draft');
  });
});

describe('catalog validation rejects unsupported authored data', () => {
  const mutations: readonly { label: string; mutate: (scenario: DemoScenario) => void }[] = [
    { label: 'extra scenario field', mutate: (scenario) => { Object.assign(scenario, { unexpected: true }); } },
    { label: 'unsupported schema', mutate: (scenario) => { scenario.schemaVersion = 3 as never; } },
    { label: 'duplicate room', mutate: (scenario) => { scenario.rooms = [...scenario.rooms, scenario.rooms[0]!]; } },
    { label: 'duplicate checklist', mutate: (scenario) => { scenario.checklist = [...scenario.checklist, scenario.checklist[0]!]; } },
    { label: 'duplicate evidence', mutate: (scenario) => { scenario.evidence = [...scenario.evidence, scenario.evidence[0]!]; } },
    { label: 'duplicate concern', mutate: (scenario) => { scenario.concerns = [...scenario.concerns, scenario.concerns[0]!]; } },
    { label: 'duplicate action', mutate: (scenario) => { scenario.referenceActions = [...scenario.referenceActions, scenario.referenceActions[0]!]; } },
    { label: 'duplicate profile', mutate: (scenario) => { scenario.profiles = [...scenario.profiles, scenario.profiles[0]!]; } },
    { label: 'duplicate program', mutate: (scenario) => { scenario.programs = [...scenario.programs, scenario.programs[0]!]; } },
    { label: 'duplicate fact definition', mutate: (scenario) => { scenario.factDefinitions = [...scenario.factDefinitions, scenario.factDefinitions[0]!]; } },
    { label: 'unknown room', mutate: (scenario) => { scenario.checklist[0]!.roomId = 'missing'; } },
    { label: 'unknown checklist action', mutate: (scenario) => { scenario.checklist[0]!.referenceActionId = 'missing'; } },
    { label: 'unknown evidence room', mutate: (scenario) => { scenario.evidence[0]!.roomId = 'missing'; } },
    { label: 'unknown evidence checklist', mutate: (scenario) => { scenario.evidence[0]!.checklistItemId = 'missing'; } },
    { label: 'mismatched room', mutate: (scenario) => { scenario.evidence[0]!.roomId = 'hallway'; } },
    { label: 'unknown concern action', mutate: (scenario) => { scenario.concerns[0]!.referenceActionId = 'missing'; } },
    { label: 'unknown concern evidence', mutate: (scenario) => { scenario.concerns[0]!.evidenceIds = ['missing']; } },
    { label: 'empty concern evidence', mutate: (scenario) => { scenario.concerns[0]!.evidenceIds = []; } },
    { label: 'mismatched action', mutate: (scenario) => { scenario.concerns[0]!.referenceActionId = 'review-cord'; } },
    { label: 'unsupported funding tag', mutate: (scenario) => { scenario.referenceActions[0]!.fundingTags = ['guaranteed' as never]; } },
    { label: 'unsupported routing', mutate: (scenario) => { scenario.referenceActions[0]!.helpRouting.kind = 'self-install' as never; } },
    { label: 'known cost', mutate: (scenario) => { scenario.referenceActions[0]!.cost.status = 'estimated' as never; } },
    { label: 'extra action metadata', mutate: (scenario) => { Object.assign(scenario.referenceActions[0]!, { riskScore: 10 }); } },
    { label: 'bad reference URL', mutate: (scenario) => { scenario.referenceActions[0]!.guidance.url = 'https://example.com'; } },
    { label: 'impossible reference date', mutate: (scenario) => { scenario.referenceActions[0]!.guidance.reviewedOn = '2026-02-30'; } },
    { label: 'invented verification date', mutate: (scenario) => { scenario.referenceActions[0]!.source.verifiedAt = at; } },
    { label: 'room photo', mutate: (scenario) => { scenario.rooms[0]!.photoUrl = '/private.jpg'; } },
    { label: 'evidence photo', mutate: (scenario) => { scenario.evidence[0]!.imageUrl = '/private.jpg'; } },
    { label: 'missing default profile', mutate: (scenario) => { scenario.profiles = scenario.profiles.slice(1); } },
    { label: 'known default facts', mutate: (scenario) => { scenario.profiles[0]!.facts = { homeowner: true }; } },
    { label: 'nonfictional profile', mutate: (scenario) => { scenario.profiles[1]!.fictional = false as never; } },
    { label: 'invalid profile fact', mutate: (scenario) => { scenario.profiles[1]!.facts = { ageYears: '70' }; } },
    { label: 'unknown profile fact', mutate: (scenario) => { scenario.profiles[1]!.facts = { secret: true }; } },
    { label: 'invalid program rule', mutate: (scenario) => { scenario.programs[0]!.rule = { id: 'bad', label: 'Bad', op: 'all', children: [] }; } },
    { label: 'unmodeled requirements omitted', mutate: (scenario) => { scenario.programs[0]!.unmodeledRequirements = []; } },
    { label: 'program contact', mutate: (scenario) => { scenario.programs[0]!.contact = 'contact' as never; } },
    { label: 'unsupported program category', mutate: (scenario) => { scenario.programs[0]!.coverageTags = ['guaranteed' as never]; } },
  ];

  it.each(mutations)('rejects $label', ({ mutate }) => {
    const scenario = structuredClone(demoScenario);
    mutate(scenario);
    const validated = validateCatalog(scenario);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.error.length).toBeGreaterThan(0);
  });

  it('rejects getters without execution and checks unsupported profile facts in all profiles', () => {
    let calls = 0;
    const scenario = structuredClone(demoScenario);
    Object.defineProperty(scenario.profiles[6]!.facts, 'ageYears', { enumerable: true, get: () => { calls += 1; return 65; } });
    expect(validateCatalog(scenario).ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('accepts a frozen catalog without mutating it', () => {
    const before = structuredClone(demoScenario);
    function freeze(value: unknown) {
      if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
    }
    const frozen = structuredClone(demoScenario);
    freeze(frozen);
    expect(validateCatalog(frozen)).toEqual({ ok: true });
    expect(frozen).toEqual(before);
  });
});

describe('authored practical next steps and real resource boundary', () => {
  it.each([
    ['review-rug', 'Take up the rug, or hold it down with double-sided rug tape or a non-slip pad.', 'quick_fix'],
    ['review-cord', 'Move the cord along the wall and tape or clip it down so it does not cross the path. If you need another outlet, ask an electrician.', 'quick_fix'],
    ['review-stair-clutter', 'Clear everything off the stairs and keep the steps empty.', 'quick_fix'],
    ['review-handrail', 'Have a qualified professional fix the loose handrail. Handrails on both sides of the stairs help most.', 'professional'],
    ['review-stair-lighting', 'Ask an electrician to add a light with switches at the top and bottom of the stairs.', 'professional'],
    ['review-night-lighting', 'Put a lamp within reach of the bed and plug in night-lights along the path to the bathroom.', 'helper_task'],
    ['review-shower-surface', 'Put a non-slip rubber mat or self-stick strips on the tub or shower floor.', 'helper_task'],
    ['review-bathroom-support', 'Have a qualified installer put grab bars next to and inside the tub and next to the toilet.', 'professional'],
  ])('%s keeps the exact authored step and effort', (id, nextStep, effort) => { expect(demoScenario.referenceActions.find((a) => a.id === id)).toMatchObject({ nextStep, effort, nextStepSource: 'Based on CDC 2017 Check for Safety' }); });
  it('accepts the verified Eldercare source, while fictional programs cannot acquire its verified status', () => {
    expect(demoScenario.localHelpResources).toEqual([{ id: 'eldercare-locator', name: 'Eldercare Locator', description: 'A public service of the U.S. Administration for Community Living that connects older adults and families to local services, including Area Agencies on Aging.', url: 'https://eldercare.acl.gov/', phone: '1-800-677-1116', source: { status: 'verified', label: 'U.S. Administration for Community Living', citationUrl: 'https://eldercare.acl.gov/', verifiedAt: '2026-10-18' } }]);
    const bad = structuredClone(demoScenario); bad.programs[0]!.source = { ...bad.localHelpResources[0]!.source }; expect(validateCatalog(bad).ok).toBe(false);
  });
});
