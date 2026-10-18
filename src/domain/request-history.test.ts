import { describe, expect, it } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { applyCommand, visibleRequestsFor, type DemoState } from './workflow';
import { sharingFields } from './roles';
import { at, atStage, run, target } from './roles-test-helpers';
import { loadDemoState, saveDemoState, validateState } from '../lib/demo-storage';

function sharedState(stage: 'accepted' | 'invited' = 'accepted') {
  const state = atStage(stage);
  return run(state, { type: 'set_sharing', ...target(state),
    sharing: { roomName: true, photos: true, scanLocation: true, visitTimes: true, areaLabel: true },
    visitTimes: 'Saturday', areaLabel: 'Entry', scanLocation: 'pin-entry' });
}
function fillHistory(state: DemoState, length = 120): DemoState {
  while (state.requests[0]!.history.length < length) {
    const request = state.requests[0]!;
    state = request.status === 'accepted'
      ? run(state, { type: 'propose_time', ...target(state), text: `Visit option ${request.history.length}` }, 'alex')
      : run(state, { type: 'set_sharing', ...target(state), sharing: request.sharing,
        visitTimes: request.visitTimes, areaLabel: `Area ${request.history.length}`, scanLocation: request.scanLocation });
  }
  return state;
}
async function roundTrip(state: DemoState) {
  let saved: string | null = null;
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; }, removeItem: () => { saved = null; } };
  expect((await saveDemoState(storage, demoScenario, state)).status).toBe('saved');
  const loaded = loadDemoState(storage, demoScenario);
  expect(loaded.status).toBe('loaded');
  expect(loaded.state).toEqual(state);
}

describe('bounded request history preserves privacy and exit transitions', () => {
  it.each(['revoke_shared_field', 'cancel_invitation', 'cancel_request', 'withdraw'] as const)('%s succeeds at 120 events, removes access and round-trips', async (type) => {
    const state = fillHistory(sharedState());
    await roundTrip(state);
    expect(visibleRequestsFor(demoScenario, state, 'alex')[0]).toHaveProperty('roomName');
    const command = type === 'revoke_shared_field'
      ? { type, ...target(state), field: 'roomName' as const }
      : { type, ...target(state) };
    const next = run(state, command, type === 'withdraw' ? 'alex' : 'margaret');
    expect(next.requests[0]!.history).toHaveLength(121);
    if (type === 'revoke_shared_field') expect(visibleRequestsFor(demoScenario, next, 'alex')[0]).not.toHaveProperty('roomName');
    else expect(visibleRequestsFor(demoScenario, next, 'alex')).toEqual([]);
    await roundTrip(next);
  });
  it('reserves every field revocation, assignment cancellation and final cancellation without discarding events', async () => {
    let state = fillHistory(sharedState());
    const history = state.requests[0]!.history;
    for (const field of sharingFields) {
      state = run(state, { type: 'revoke_shared_field', ...target(state), field });
      expect(visibleRequestsFor(demoScenario, state, 'alex')[0]).not.toHaveProperty(field);
      await roundTrip(state);
    }
    state = run(state, { type: 'cancel_invitation', ...target(state) });
    await roundTrip(state);
    state = run(state, { type: 'cancel_request', ...target(state) });
    expect(state.requests[0]!.history).toHaveLength(127);
    expect(state.requests[0]!.history.slice(0, 120)).toEqual(history);
    expect(visibleRequestsFor(demoScenario, state, 'alex')).toEqual([]);
    await roundTrip(state);
  });
  it('also permits privacy-only set_sharing, decline and final completion at the ordinary limit', async () => {
    let state = fillHistory(sharedState());
    const request = state.requests[0]!;
    state = run(state, { type: 'set_sharing', ...target(state), sharing: { ...request.sharing, roomName: false }, visitTimes: request.visitTimes, areaLabel: request.areaLabel, scanLocation: request.scanLocation });
    expect(visibleRequestsFor(demoScenario, state, 'alex')[0]).not.toHaveProperty('roomName');
    await roundTrip(state);
    state = fillHistory(sharedState('invited'));
    state = run(state, { type: 'decline_invitation', ...target(state), reason: 'Unavailable' }, 'alex');
    expect(visibleRequestsFor(demoScenario, state, 'alex')).toEqual([]);
    await roundTrip(state);
    state = fillHistory(sharedState(), 117);
    state = run(state, { type: 'agree_time', ...target(state) });
    state = run(state, { type: 'post_update', ...target(state), text: 'Finished the task' }, 'alex');
    state = run(state, { type: 'report_done', ...target(state) }, 'alex');
    expect(state.requests[0]!.history).toHaveLength(120);
    state = run(state, { type: 'confirm_done', ...target(state) });
    expect(state.requests[0]!.status).toBe('resident_confirmed_done');
    await roundTrip(state);
  });
  it('does not consume history or revisions for identical proposals, sharing, revocations or updates', () => {
    let state = fillHistory(sharedState());
    const request = state.requests[0]!;
    expect(run(state, { type: 'propose_time', ...target(state), text: request.proposedTime!.text }, 'alex')).toBe(state);
    expect(run(state, { type: 'set_sharing', ...target(state), sharing: request.sharing, visitTimes: request.visitTimes, areaLabel: request.areaLabel, scanLocation: request.scanLocation })).toBe(state);
    state = run(state, { type: 'revoke_shared_field', ...target(state), field: 'roomName' });
    expect(run(state, { type: 'revoke_shared_field', ...target(state), field: 'roomName' })).toBe(state);
    state = atStage('in_progress');
    expect(run(state, { type: 'post_update', ...target(state), text: state.requests[0]!.updates.at(-1)!.text }, 'alex')).toBe(state);
  });
  it('keeps ordinary changes capped after 120 events and rejects oversized saved histories', () => {
    const state = fillHistory(sharedState());
    const result = applyCommand(demoScenario, state, { type: 'propose_time', ...target(state), text: 'A different time', actorId: 'alex', at });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('history limit') });
    const request = state.requests[0]!;
    const invalid = { ...state, requests: [{ ...request, history: [...request.history, ...Array.from({ length: 8 }, () => request.history.at(-1)!)], revision: 128 }] };
    expect(validateState(invalid, demoScenario).ok).toBe(false);
  });
  it('rejects saved histories that would consume the remaining privacy reserve', () => {
    const state = fillHistory(sharedState());
    const request = state.requests[0]!;
    const invalid = { ...state, requests: [{ ...request, history: [...request.history, request.history.at(-1)!, request.history.at(-1)!], revision: request.revision + 2 }] };
    expect(validateState(invalid, demoScenario)).toMatchObject({ ok: false, error: expect.stringContaining('privacy reserve') });
  });
});
