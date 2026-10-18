import { describe, expect, it } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { applyCommand, elderNextStep, getRequestViews, visibleRequestsFor } from './workflow';
import { at, atStage, run, target } from './roles-test-helpers';

describe('request lifecycle regressions', () => {
  it('D06 cancellation preserves history and permits a new request for the same action', () => {
    const cancelled = atStage('cancelled');
    const next = run(cancelled, { type: 'create_request', referenceActionId: 'review-rug', expectedRevision: 0 });
    expect(next.requests).toHaveLength(2);
    expect(next.requests[0]).toEqual(cancelled.requests[0]);
    expect(next.requests[1]!.id).not.toBe(next.requests[0]!.id);
  });
  it('D06 recurrence never inherits completion from an earlier episode', () => {
    let state = atStage('resident_confirmed_done');
    state = run(state, { type: 'unconfirm_concern', concernId: 'rug-concern' });
    state = run(state, { type: 'confirm_concern', concernId: 'rug-concern' });
    expect(elderNextStep(scenario, state)).toMatchObject({ kind: 'create_request' });
    expect(getRequestViews(scenario, state)[0]!.active).toBe(false);
  });
  it('D07 both completion decisions survive the ordinary history limit', () => {
    let state = atStage('accepted');
    while (state.requests[0]!.history.length < 117) state = run(state, { type: 'propose_time', ...target(state), text: `Visit ${state.requests[0]!.history.length}` }, 'alex');
    state = run(state, { type: 'agree_time', ...target(state) });
    state = run(state, { type: 'post_update', ...target(state), text: 'Work needs resident review' }, 'alex');
    state = run(state, { type: 'report_done', ...target(state) }, 'alex');
    expect(state.requests[0]!.history).toHaveLength(120);
    for (const type of ['confirm_done', 'not_done_yet'] as const) expect(applyCommand(scenario, state, { type, ...target(state), actorId: 'margaret', at }).ok).toBe(true);
  });
  it('D08 a completed assignment cannot see a subsequently added resident photo', () => {
    let state = atStage('volunteer_reported_done');
    state = run(state, { type: 'set_sharing', ...target(state), sharing: { roomName: false, photos: true, scanLocation: false, visitTimes: false, areaLabel: false }, visitTimes: '', areaLabel: '', scanLocation: null });
    state = run(state, { type: 'confirm_done', ...target(state) });
    state = run(state, { type: 'add_photo', photoId: 'new-private-photo', checklistItemId: 'rug-check', width: 800, height: 600 });
    expect(JSON.stringify(visibleRequestsFor(scenario, state, 'alex'))).not.toContain('new-private-photo');
  });
  it('D12 completion review precedes unanswered checklist questions', () => {
    const state = run(atStage('volunteer_reported_done'), { type: 'answer_checklist', checklistItemId: 'cord-check', answer: 'unknown' });
    expect(elderNextStep(scenario, state)).toMatchObject({ kind: 'review_completion' });
  });
  it('D10 confirmation-only helpers cannot confirm without an evidence grant', () => {
    const state = run(atStage('draft'), { type: 'grant_delegation', personId: 'sam', scopes: ['confirm'] });
    expect(applyCommand(scenario, state, { type: 'confirm_concern', concernId: 'rug-concern', actorId: 'sam', at }).ok).toBe(false);
  });
  it('D11 residents can remove helper contributions after revocation', () => {
    let state = run(atStage('draft'), { type: 'grant_delegation', personId: 'sam', scopes: ['checklist'] });
    state = run(state, { type: 'add_photo', photoId: 'helper-photo', checklistItemId: 'rug-check', width: 400, height: 300 }, 'sam');
    state = run(state, { type: 'revoke_delegation', personId: 'sam' });
    const next = applyCommand(scenario, state, { type: 'remove_photo', photoId: 'helper-photo', actorId: 'margaret', at });
    expect(next.ok).toBe(true);
  });
});

describe('remaining lifecycle defects', () => {
  it('D09 records and advances professional help without a volunteer assignment or Home loop', () => {
    let state = run(atStage('draft'), { type: 'answer_checklist', checklistItemId: 'handrail-check', answer: 'yes' });
    state = run(state, { type: 'confirm_concern', concernId: 'handrail-concern' });
    state = run(state, { type: 'create_request', referenceActionId: 'review-handrail', expectedRevision: 0 });
    const id = state.requests[1]!.id;
    for (const type of ['record_referral', 'contact_referral', 'close_referral'] as const) {
      state = run(state, { type, requestId: id, expectedRevision: state.requests[1]!.revision });
      expect(state.requests[1]!.volunteerId).toBe(null);
    }
    expect(state.requests[1]!.professionalReferral).toBe('closed');
    expect(elderNextStep(scenario, state)).not.toMatchObject({ kind: 'find_professional' });
    expect(applyCommand(scenario, state, { type: 'invite_volunteer', requestId: id, expectedRevision: state.requests[1]!.revision, volunteerId: 'alex', actorId: 'margaret', at }).ok).toBe(false);
  });
  it('D11 revoked contributors can remove their own photos and attribution survives cleanup', () => {
    let state = run(atStage('draft'), { type: 'grant_delegation', personId: 'sam', scopes: ['checklist'] });
    state = run(state, { type: 'add_photo', photoId: 'helper-photo', checklistItemId: 'rug-check', width: 400, height: 300 }, 'sam');
    state = run(state, { type: 'revoke_delegation', personId: 'sam' });
    state = run(state, { type: 'remove_photo', photoId: 'helper-photo' }, 'sam');
    expect(state.photos).toEqual([]);
    expect(state.removedPhotos[0]).toMatchObject({ id: 'helper-photo', addedBy: 'sam', addedAt: at, removedBy: { actorId: 'sam', at } });
  });
  it('D12 a visit proposal also precedes unanswered questions', () => {
    let state = atStage('accepted');
    state = run(state, { type: 'propose_time', ...target(state), text: 'Sunday afternoon' }, 'alex');
    state = run(state, { type: 'answer_checklist', checklistItemId: 'cord-check', answer: 'unknown' });
    expect(elderNextStep(scenario, state)).toMatchObject({ kind: 'agree_time' });
  });
});
