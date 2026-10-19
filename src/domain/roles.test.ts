import { describe, expect, it } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { applyCommand, createInitialState, computePlan, getRequestViews, hasScope, noSharing, groupPlanByEffort, isIsoTimestamp, type DemoCommand, type DemoState, type ResidentCommandInput } from './workflow';
import { visibleHouseholdFor, visibleRequestsFor, elderNextStep, volunteerNextStep } from './role-views';
import { sharingFields, type HelpRequestStatus } from './roles';
import { activeState, at, atStage, requestId, run, target } from './roles-test-helpers';
import { validateState } from '../lib/demo-storage';
const fullGrant = (s: DemoState) => run(s, { type: 'grant_delegation', personId: 'sam', scopes: ['checklist', 'confirm', 'requests'] });
const dispatch = (s: DemoState, c: ResidentCommandInput, actorId: string) => applyCommand(demoScenario, s, { ...c, actorId, at } as DemoCommand);
const permissionCases: { name: string; state: () => DemoState; command: (s: DemoState) => ResidentCommandInput; allowed: string[] }[] = [
  { name: 'answer', state: activeState, command: () => ({ type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' }), allowed: ['margaret', 'sam'] },
  { name: 'add photo', state: activeState, command: () => ({ type: 'add_photo', photoId: 'photo', checklistItemId: 'rug-check', width: 800, height: 600 }), allowed: ['margaret', 'sam'] },
  { name: 'confirm', state: activeState, command: () => ({ type: 'confirm_concern', concernId: 'rug-concern' }), allowed: ['margaret', 'sam'] },
  { name: 'unconfirm', state: activeState, command: () => ({ type: 'unconfirm_concern', concernId: 'rug-concern' }), allowed: ['margaret', 'sam'] },
  { name: 'create request', state: activeState, command: () => ({ type: 'create_request', referenceActionId: 'review-rug', expectedRevision: 0 }), allowed: ['margaret', 'sam'] },
  { name: 'select facts profile', state: activeState, command: () => ({ type: 'select_profile', profileId: 'maple-owner' }), allowed: ['margaret'] },
  { name: 'grant', state: activeState, command: () => ({ type: 'grant_delegation', personId: 'sam', scopes: ['checklist'] }), allowed: ['margaret'] },
  { name: 'revoke grant', state: activeState, command: () => ({ type: 'revoke_delegation', personId: 'sam' }), allowed: ['margaret'] },
  { name: 'sharing', state: () => atStage(), command: (s) => ({ type: 'set_sharing', ...target(s), sharing: noSharing(), visitTimes: '', areaLabel: '', scanLocation: null }), allowed: ['margaret'] },
  { name: 'revoke shared field', state: () => atStage('invited'), command: (s) => ({ type: 'revoke_shared_field', ...target(s), field: 'roomName' }), allowed: ['margaret'] },
  { name: 'invite', state: () => atStage(), command: (s) => ({ type: 'invite_volunteer', ...target(s), volunteerId: 'alex' }), allowed: ['margaret'] },
  { name: 'cancel invitation', state: () => atStage('invited'), command: (s) => ({ type: 'cancel_invitation', ...target(s) }), allowed: ['margaret'] },
  { name: 'cancel request', state: () => atStage(), command: (s) => ({ type: 'cancel_request', ...target(s) }), allowed: ['margaret'] },
  { name: 'accept', state: () => atStage('invited'), command: (s) => ({ type: 'accept_invitation', ...target(s) }), allowed: ['alex'] },
  { name: 'decline', state: () => atStage('invited'), command: (s) => ({ type: 'decline_invitation', ...target(s), reason: 'Unavailable' }), allowed: ['alex'] },
  { name: 'propose time', state: () => atStage('accepted'), command: (s) => ({ type: 'propose_time', ...target(s), text: 'Saturday morning' }), allowed: ['alex'] },
  { name: 'agree time', state: () => run(atStage('accepted'), { type: 'propose_time', ...target(atStage('accepted')), text: 'Saturday' }, 'alex'), command: (s) => ({ type: 'agree_time', ...target(s) }), allowed: ['margaret'] },
  { name: 'post update', state: () => atStage('scheduled'), command: (s) => ({ type: 'post_update', ...target(s), text: 'Starting' }), allowed: ['alex'] },
  { name: 'report done', state: () => atStage('in_progress'), command: (s) => ({ type: 'report_done', ...target(s) }), allowed: ['alex'] },
  { name: 'confirm done', state: () => atStage('volunteer_reported_done'), command: (s) => ({ type: 'confirm_done', ...target(s) }), allowed: ['margaret'] },
  { name: 'not done yet', state: () => atStage('volunteer_reported_done'), command: (s) => ({ type: 'not_done_yet', ...target(s) }), allowed: ['margaret'] },
  { name: 'withdraw', state: () => atStage('accepted'), command: (s) => ({ type: 'withdraw', ...target(s) }), allowed: ['alex'] },
];
describe('permission table: each command for resident, granted delegate, both volunteers and unknown actor', () => {
  it.each(permissionCases.flatMap((test) => ['margaret', 'sam', 'alex', 'jordan', 'unknown'].map((actorId) => ({ ...test, actorId }))))('$name / $actorId', ({ state, command, allowed, actorId }) => {
    const s = fullGrant(state()); const before = structuredClone(s);
    expect(dispatch(s, command(s), actorId).ok).toBe(allowed.includes(actorId));
    expect(s).toEqual(before);
  });
  it.each(['margaret', 'sam', 'alex', 'jordan'])('remove own photo / %s', (actorId) => {
    let s = fullGrant(activeState());
    if (actorId === 'margaret' || actorId === 'sam') s = run(s, { type: 'add_photo', photoId: 'own', checklistItemId: 'rug-check', width: 1, height: 1 }, actorId);
    expect(dispatch(s, { type: 'remove_photo', photoId: 'own' }, actorId).ok).toBe(['margaret', 'sam'].includes(actorId));
    if (actorId === 'sam') expect(dispatch(s, { type: 'remove_photo', photoId: 'own' }, 'margaret').ok).toBe(true);
  });
  it.each(permissionCases.filter((c) => c.allowed.includes('sam')))('ungranted and revoked delegate: $name', ({ state, command }) => {
    let s = state(); expect(dispatch(s, command(s), 'sam').ok).toBe(false);
    s = fullGrant(s); expect(dispatch(s, command(s), 'sam').ok).toBe(true);
    s = run(s, { type: 'revoke_delegation', personId: 'sam' });
    expect(dispatch(s, command(s), 'sam').ok).toBe(false);
  });
  it('each grant is independent and cannot be granted to volunteers', () => {
    let s = run(activeState(), { type: 'grant_delegation', personId: 'sam', scopes: ['checklist'] });
    expect(hasScope(s, 'sam', 'checklist')).toBe(true); expect(hasScope(s, 'sam', 'confirm')).toBe(false); expect(hasScope(s, 'sam', 'requests')).toBe(false);
    expect(dispatch(s, { type: 'grant_delegation', personId: 'alex', scopes: ['requests'] }, 'margaret').ok).toBe(false);
    s = run(s, { type: 'confirm_concern', concernId: 'rug-concern' });
    expect(dispatch(s, { type: 'create_request', referenceActionId: 'review-rug', expectedRevision: 0 }, 'sam').ok).toBe(false);
  });
});
const stages: HelpRequestStatus[] = ['draft', 'invited', 'declined', 'accepted', 'scheduled', 'in_progress', 'volunteer_reported_done', 'resident_confirmed_done', 'cancelled'];
const edges: { type: DemoCommand['type']; actor: string; allowed: HelpRequestStatus[]; extra?: object }[] = [
  { type: 'accept_invitation', actor: 'alex', allowed: ['invited'] },
  { type: 'decline_invitation', actor: 'alex', allowed: ['invited'], extra: { reason: 'Unavailable' } },
  { type: 'propose_time', actor: 'alex', allowed: ['accepted'], extra: { text: 'Saturday' } },
  { type: 'post_update', actor: 'alex', allowed: ['scheduled', 'in_progress'], extra: { text: 'Working' } },
  { type: 'report_done', actor: 'alex', allowed: ['in_progress'] },
  { type: 'confirm_done', actor: 'margaret', allowed: ['volunteer_reported_done'] },
  { type: 'not_done_yet', actor: 'margaret', allowed: ['volunteer_reported_done'] },
  { type: 'withdraw', actor: 'alex', allowed: ['invited', 'accepted', 'scheduled', 'in_progress', 'volunteer_reported_done'] },
  { type: 'cancel_request', actor: 'margaret', allowed: ['draft', 'invited', 'declined', 'accepted', 'scheduled', 'in_progress', 'volunteer_reported_done'] },
  { type: 'cancel_invitation', actor: 'margaret', allowed: ['invited', 'accepted', 'scheduled', 'in_progress', 'volunteer_reported_done'] },
];
describe('exact lifecycle and optimistic revisions', () => {
  it.each(edges.flatMap((edge) => stages.map((stage) => ({ ...edge, stage }))))('$type from $stage', ({ type, actor, allowed, stage, extra }) => {
    const s = atStage(stage);
    const result = dispatch(s, { type, ...target(s), ...extra } as ResidentCommandInput, actor);
    expect(result.ok).toBe(allowed.includes(stage));
    if (result.ok) expect(validateState(result.state, demoScenario)).toMatchObject({ ok: true });
  });
  it.each(permissionCases.filter((t) => !['answer', 'add photo', 'confirm', 'unconfirm', 'select facts profile', 'grant', 'revoke grant', 'create request'].includes(t.name)))('stale revision rejects $name', ({ state, command, allowed }) => {
    const s = state(); const c = command(s);
    expect(dispatch(s, { ...c, expectedRevision: 0 } as ResidentCommandInput, allowed[0]!).ok).toBe(false);
  });
  it('rejects duplicate acceptance at both stale and fresh revision', () => {
    const invited = atStage('invited'); const accepted = run(invited, { type: 'accept_invitation', ...target(invited) }, 'alex');
    expect(dispatch(accepted, { type: 'accept_invitation', ...target(invited) }, 'alex').ok).toBe(false);
    expect(dispatch(accepted, { type: 'accept_invitation', ...target(accepted) }, 'alex').ok).toBe(false);
  });
  it('proposal does not schedule until the resident agrees, reopening retains history and returns to in_progress', () => {
    let s = atStage('accepted'); expect(dispatch(s, { type: 'agree_time', ...target(s) }, 'margaret').ok).toBe(false);
    s = run(s, { type: 'propose_time', ...target(s), text: 'Saturday' }, 'alex'); expect(s.requests[0]!.status).toBe('accepted');
    s = atStage('volunteer_reported_done'); const length = s.requests[0]!.history.length;
    s = run(s, { type: 'not_done_yet', ...target(s) }); expect(s.requests[0]!.status).toBe('in_progress'); expect(s.requests[0]!.reportedDone).toBeNull(); expect(s.requests[0]!.history).toHaveLength(length + 1);
  });
  it.each(['decline_invitation', 'withdraw', 'cancel_invitation', 'cancel_request'] as const)('%s removes access and permits no old volunteer commands', (type) => {
    let s = atStage('invited'); s = run(s, { type, ...target(s), ...(type === 'decline_invitation' ? { reason: '' } : {}) } as ResidentCommandInput, type.startsWith('cancel') ? 'margaret' : 'alex');
    expect(visibleRequestsFor(demoScenario, s, 'alex')).toEqual([]);
    for (const edge of edges.filter((e) => e.actor === 'alex')) expect(dispatch(s, { type: edge.type, ...target(s), ...edge.extra } as ResidentCommandInput, 'alex').ok).toBe(false);
    if (type !== 'cancel_request') { s = run(s, { type: 'invite_volunteer', ...target(s), volunteerId: 'jordan' }); expect(visibleRequestsFor(demoScenario, s, 'alex')).toEqual([]); expect(visibleRequestsFor(demoScenario, s, 'jordan')).toHaveLength(1); }
  });
  it.each(demoScenario.referenceActions)('routing $id accepts only family/helper tasks', (action) => {
    let s = createInitialState(demoScenario); const check = demoScenario.checklist.find((c) => c.referenceActionId === action.id)!; const concern = demoScenario.concerns.find((c) => c.referenceActionId === action.id)!;
    s = run(s, { type: 'answer_checklist', checklistItemId: check.id, answer: 'yes' }); s = run(s, { type: 'confirm_concern', concernId: concern.id }); s = run(s, { type: 'create_request', referenceActionId: action.id, expectedRevision: 0 });
    const result = dispatch(s, { type: 'invite_volunteer', requestId: s.requests[0]!.id, expectedRevision: 1, volunteerId: 'alex' }, 'margaret'); expect(result.ok).toBe(action.effort !== 'professional');
    if (!result.ok) expect(result.error).toContain('qualified professional');
  });
  it('yes alone creates no plan; unconfirming retains inactive history and suspends volunteer access', () => {
    let s = atStage('in_progress'); const r = structuredClone(s.requests);
    s = run(s, { type: 'unconfirm_concern', concernId: 'rug-concern' }); expect(s.requests).toEqual(r); expect(computePlan(demoScenario, s)).toEqual([]); expect(getRequestViews(demoScenario, s)[0]!.active).toBe(false); expect(visibleRequestsFor(demoScenario, s, 'alex')).toEqual([]);
    expect(dispatch(s, { type: 'post_update', ...target(s), text: 'Update' }, 'alex').ok).toBe(false);
    s = run(s, { type: 'answer_checklist', checklistItemId: 'rug-check', answer: 'yes' }); expect(computePlan(demoScenario, s)).toEqual([]);
    s = run(s, { type: 'confirm_concern', concernId: 'rug-concern' }); expect(s.requests).toEqual(r);
  });
});

describe('privacy projections and scoped household reads', () => {
  it('volunteer projections omit every unshared field, including on serialization', () => {
    const s = atStage('invited'); const views = visibleRequestsFor(demoScenario, s, 'alex');
    expect(views).toHaveLength(1);
    expect(Object.keys(views[0]!).sort()).toEqual(['kind', 'id', 'status', 'revision', 'active', 'title', 'nextStep', 'proposedTime', 'agreedTime', 'updates', 'reportedDone', 'confirmedDone', 'independentVerification'].sort());
    for (const key of ['request', 'referenceActionId', 'history', 'legacyHistory', 'sharing', 'createdBy', ...sharingFields]) expect(Object.keys(views[0]!)).not.toContain(key);
    expect(visibleRequestsFor(demoScenario, s, 'jordan')).toEqual([]); expect(visibleRequestsFor(demoScenario, s, 'unknown')).toEqual([]);
  });
  it.each(sharingFields)('shares only %s, and revocation removes the key immediately', (field) => {
    let s = atStage('invited'); s = run(s, { type: 'set_sharing', ...target(s), sharing: { ...noSharing(), [field]: true }, visitTimes: 'Saturday', areaLabel: 'Fictional Maple area', scanLocation: 'pin-rug' });
    expect(Object.keys(visibleRequestsFor(demoScenario, s, 'alex')[0]!)).toContain(field);
    for (const other of sharingFields.filter((f) => f !== field)) expect(Object.keys(visibleRequestsFor(demoScenario, s, 'alex')[0]!)).not.toContain(other);
    s = run(s, { type: 'revoke_shared_field', ...target(s), field });
    expect(Object.keys(visibleRequestsFor(demoScenario, s, 'alex')[0]!)).not.toContain(field);
  });
  it('shares only resident photos for the requested concern, and removing a photo removes future access', () => {
    let s = fullGrant(atStage('invited'));
    for (const [photoId, checklistItemId, actorId] of [['resident-rug', 'rug-check', 'margaret'], ['resident-cord', 'cord-check', 'margaret'], ['helper-rug', 'rug-check', 'sam']]) s = run(s, { type: 'add_photo', photoId: photoId!, checklistItemId: checklistItemId!, width: 800, height: 600 }, actorId!);
    s = run(s, { type: 'set_sharing', ...target(s), sharing: { ...noSharing(), photos: true }, visitTimes: '', areaLabel: '', scanLocation: null });
    const first = visibleRequestsFor(demoScenario, s, 'alex')[0]!; if (first.kind !== 'volunteer') throw new Error('Wrong projection');
    expect(first.photos?.map((p) => p.id)).toEqual(['resident-rug']);
    s = run(s, { type: 'remove_photo', photoId: 'resident-rug' });
    const next = visibleRequestsFor(demoScenario, s, 'alex')[0]!; if (next.kind !== 'volunteer') throw new Error('Wrong projection'); expect(next.photos).toEqual([]);
  });
  it.each(['checklist', 'confirm', 'requests'] as const)('delegated %s reads are scoped and revocable', (scope) => {
    let s = run(atStage(), { type: 'grant_delegation', personId: 'sam', scopes: [scope] });
    const view = visibleHouseholdFor(demoScenario, s, 'sam')!;
    expect(Object.hasOwn(view, 'checklistAnswers')).toBe(scope === 'checklist'); expect(Object.hasOwn(view, 'photos')).toBe(scope === 'checklist'); expect(Object.hasOwn(view, 'canViewScan')).toBe(scope === 'checklist'); expect(Object.hasOwn(view, 'confirmations')).toBe(scope === 'confirm'); expect(Object.hasOwn(view, 'plan')).toBe(scope !== 'checklist');
    expect(visibleRequestsFor(demoScenario, s, 'sam')).toHaveLength(scope === 'requests' ? 1 : 0);
    s = run(s, { type: 'revoke_delegation', personId: 'sam' }); expect(visibleHouseholdFor(demoScenario, s, 'sam')).toBeNull(); expect(visibleRequestsFor(demoScenario, s, 'sam')).toEqual([]);
  });
  it.each(['alex', 'jordan', 'unknown'])('%s has no household access', (actorId) => { expect(visibleHouseholdFor(demoScenario, fullGrant(atStage()), actorId)).toBeNull(); });
  it('resident sees all household sections and history; returned projections cannot mutate source state', () => {
    const s = atStage('cancelled'); const before = structuredClone(s);
    expect(visibleRequestsFor(demoScenario, s, 'margaret')).toHaveLength(1);
    expect(Object.keys(visibleHouseholdFor(demoScenario, s, 'margaret')!)).toEqual(['checklistAnswers', 'photos', 'canViewScan', 'confirmations', 'plan', 'requests']);
    const v = visibleRequestsFor(demoScenario, s, 'margaret')[0]!;
    if (v.kind === 'household') v.request.sharing.roomName = true;
    expect(s).toEqual(before);
  });
});

describe('people, preferences, attribution and next steps', () => {
  it.each(['en', 'es'] as const)('creates a demo volunteer using %s without household grants', (language) => {
    const s = run(activeState(), { type: 'create_person', personId: 'new-person', name: 'New person', role: 'volunteer', language }, 'alex');
    const p = s.people.at(-1)!; expect(p).toMatchObject({ name: 'New person', role: 'volunteer', language, createdBy: { actorId: 'alex', at } }); expect(visibleHouseholdFor(demoScenario, s, p.id)).toBeNull();
  });
  it.each(['', ' '.repeat(2), 'x'.repeat(41), 'Bad\nname'])('rejects unsupported person name %j', (name) => { expect(dispatch(activeState(), { type: 'create_person', personId: 'new-person', name, role: 'family_helper', language: 'en' }, 'margaret').ok).toBe(false); });
  it('accepts exactly 40 chars, rejects a second resident and duplicate IDs; immutable household ownership', () => {
    const s = run(activeState(), { type: 'create_person', personId: 'new-person', name: 'x'.repeat(40), role: 'family_helper', language: 'es' });
    for (const c of [{ type: 'create_person', personId: 'new-person', name: 'A', role: 'volunteer', language: 'en' }, { type: 'create_person', personId: 'second-resident', name: 'New resident', role: 'resident', language: 'en' }]) expect(dispatch(s, c as ResidentCommandInput, 'margaret').ok).toBe(false);
    expect(s.household).toEqual({ id: 'maple-house', residentId: 'margaret' });
  });
  it.each(['margaret', 'sam', 'alex', 'jordan'])('stores %s preferences separately and labels volunteer claims unverified', (actorId) => {
    let s = activeState(); s = run(s, { type: 'set_language', language: 'es' }, actorId); s = run(s, { type: 'set_onboarding', guideId: 'setup', stepIndex: 2, completed: false }, actorId); s = run(s, { type: 'set_checklist_position', position: 3 }, actorId);
    expect(s.people.find((p) => p.id === actorId)).toMatchObject({ language: 'es', onboarding: { setup: { stepIndex: 2, completed: false } }, checklistPosition: 3, updatedBy: { actorId, at } });
    for (const p of s.people.filter((p) => p.id !== actorId)) expect(p).toMatchObject({ language: 'en', onboarding: {}, checklistPosition: 0 });
    if (actorId === 'alex' || actorId === 'jordan') s = run(s, { type: 'set_volunteer_profile', skills: ['Tidying'], availability: 'Saturday' }, actorId);
    expect(s.people.every((p) => p.selfReportLabel === 'Self-reported, not verified')).toBe(true); expect(validateState(s, demoScenario)).toMatchObject({ ok: true });
  });
  it('preserves delegate attribution after revocation and requires caller timestamps', () => {
    let s = fullGrant(activeState()); s = run(s, { type: 'confirm_concern', concernId: 'rug-concern' }, 'sam'); s = run(s, { type: 'create_request', referenceActionId: 'review-rug', expectedRevision: 0 }, 'sam');
    s = run(s, { type: 'revoke_delegation', personId: 'sam' }); expect(s.confirmations['rug-concern']).toMatchObject({ actorId: 'sam', confirmedBy: 'Sam (family helper) for Margaret', confirmedAt: at }); expect(s.requests[0]!.createdBy).toEqual({ actorId: 'sam', at }); expect(computePlan(demoScenario, s)).toHaveLength(1);
    for (const time of ['', '2026-10-18', '2026-02-30T00:00:00.000Z']) expect(applyCommand(demoScenario, s, { type: 'select_profile', profileId: 'maple-owner', actorId: 'margaret', at: time }).ok).toBe(false);
    expect(isIsoTimestamp(at)).toBe(true);
  });
  it('resumes the checklist, then confirmation, creation, invitation, proposal, report and done', () => {
    let s = createInitialState(demoScenario); s = run(s, { type: 'set_checklist_position', position: 3 }); expect(elderNextStep(demoScenario, s)).toEqual({ kind: 'answer_checklist', checklistItemId: 'handrail-check' });
    s = activeState(); s = run(s, { type: 'unconfirm_concern', concernId: 'rug-concern' }); expect(elderNextStep(demoScenario, s)).toEqual({ kind: 'confirm_concern', concernId: 'rug-concern' }); s = run(s, { type: 'confirm_concern', concernId: 'rug-concern' }); expect(elderNextStep(demoScenario, s)).toEqual({ kind: 'create_request', referenceActionId: 'review-rug' });
    expect(elderNextStep(demoScenario, atStage())).toEqual({ kind: 'invite_volunteer', requestId }); expect(elderNextStep(demoScenario, atStage('invited'))).toEqual({ kind: 'wait_for_volunteer', requestId });
    s = atStage('accepted'); s = run(s, { type: 'propose_time', ...target(s), text: 'Saturday' }, 'alex'); expect(elderNextStep(demoScenario, s)).toEqual({ kind: 'agree_time', requestId });
    expect(elderNextStep(demoScenario, atStage('volunteer_reported_done'))).toEqual({ kind: 'review_completion', requestId }); expect(elderNextStep(demoScenario, atStage('resident_confirmed_done'))).toEqual({ kind: 'done' });
    expect(elderNextStep(demoScenario, s, 'alex')).toBeNull();
  });
  it.each([['invited', 'accept_or_decline'], ['accepted', 'propose_time'], ['scheduled', 'post_update'], ['in_progress', 'report_done'], ['volunteer_reported_done', 'wait_for_resident'], ['resident_confirmed_done', 'done'], ['declined', 'done'], ['cancelled', 'done']] as const)('volunteer next step from %s is %s', (status, kind) => { expect(volunteerNextStep(demoScenario, atStage(status), 'alex')).toMatchObject({ kind }); expect(volunteerNextStep(demoScenario, atStage(status), 'sam')).toBeNull(); });
  it('groups authored efforts using the exact non-ranking explanation', () => {
    const groups = groupPlanByEffort(computePlan(demoScenario, activeState())); expect(groups.map((g) => [g.effort, g.items.length])).toEqual([['quick_fix', 1], ['helper_task', 0], ['professional', 0]]); expect(groups.every((g) => g.explanation === 'Grouped by who can usually do it — a reading aid, not a risk ranking.')).toBe(true);
  });
});

describe('boundary inputs and immutable state', () => {
  it('does not mutate frozen state/catalog, and ignores an active-person switch as household authority', () => {
    const freeze = <T,>(v: T): T => { if (v && typeof v === 'object') { Object.freeze(v); Object.values(v).forEach(freeze); } return v; };
    let s = freeze(atStage('invited')); const scenario = freeze(structuredClone(demoScenario)); const before = structuredClone(s);
    const result = applyCommand(scenario, s, { type: 'accept_invitation', ...target(s), actorId: 'alex', at }); expect(result.ok).toBe(true); expect(s).toEqual(before);
    s = run(s, { type: 'select_person', personId: 'alex' }); expect(s.activePersonId).toBe('alex');
    expect(dispatch(s, { type: 'unconfirm_concern', concernId: 'rug-concern' }, 'alex').ok).toBe(false);
  });
  it('rejects duplicate drafts, explicit bogus sharing fields and overlong volunteer updates', () => {
    const s = atStage(); expect(dispatch(s, { type: 'create_request', referenceActionId: 'review-rug', expectedRevision: 0 }, 'margaret').ok).toBe(false);
    expect(dispatch(s, { type: 'set_sharing', ...target(s), sharing: { ...noSharing(), address: true }, visitTimes: '', areaLabel: '', scanLocation: null } as ResidentCommandInput, 'margaret').ok).toBe(false);
    const progressing = atStage('in_progress'); expect(dispatch(progressing, { type: 'post_update', ...target(progressing), text: 'x'.repeat(280) }, 'alex').ok).toBe(true); expect(dispatch(progressing, { type: 'post_update', ...target(progressing), text: 'x'.repeat(281) }, 'alex').ok).toBe(false);
  });
  it('finds a professional rather than offering an invitation for a professional action', () => {
    let s = createInitialState(demoScenario); for (const check of demoScenario.checklist) s = run(s, { type: 'answer_checklist', checklistItemId: check.id, answer: check.id === 'handrail-check' ? 'yes' : 'no' });
    s = run(s, { type: 'confirm_concern', concernId: 'handrail-concern' }); s = run(s, { type: 'create_request', referenceActionId: 'review-handrail', expectedRevision: 0 }); expect(elderNextStep(demoScenario, s)).toEqual({ kind: 'find_professional', requestId: 'request-review-handrail' });
  });
});
