import { describe, expect, it } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { atStage, run, target, at } from '../domain/roles-test-helpers';
import legacyBrowserJson from './demo-storage-legacy-fixture.json?raw';
import { loadDemoState, saveDemoState, validateState } from './demo-storage';
function storage(bytes: string) { let value: string | null = bytes; return { getItem: () => value, setItem: (_k: string, v: string) => { value = v; }, removeItem: () => { value = null; } }; }
describe('schema evolution and authoritative request events', () => {
  it('D06 the previous v3 format migrates without rewriting or inventing current completion', async () => {
    const current = atStage('resident_confirmed_done');
    const { actionEpisodes: _episodes, removedPhotos: _removed, removedPhotoHistoryTruncated: _truncated, ...previous } = current;
    const v3 = { ...previous, schemaVersion: 3, requests: previous.requests.map(({ episode: _episode, professionalReferral: _referral, ...r }) => r) };
    const bytes = JSON.stringify(v3), s = storage(bytes), loaded = loadDemoState(s, scenario);
    expect(loaded.status).toBe('migrated'); expect(loaded.state.schemaVersion).toBe(5); expect(s.getItem()).toBe(bytes);
    expect(loaded.state.requests[0]).toMatchObject({ episode: 1, professionalReferral: null, status: 'resident_confirmed_done' });
    let recurred = run(loaded.state, { type: 'unconfirm_concern', concernId: 'rug-concern' });
    recurred = run(recurred, { type: 'confirm_concern', concernId: 'rug-concern' });
    recurred = run(recurred, { type: 'create_request', referenceActionId: 'review-rug', expectedRevision: 0 });
    expect(recurred.requests[1]).toMatchObject({ episode: 2, status: 'draft', confirmedDone: null });
    expect((await saveDemoState(s, scenario, recurred)).status).toBe('saved'); expect(loadDemoState(s, scenario).state).toEqual(recurred);
  });
  it('the existing v1 browser fixture still migrates and preserves its original bytes', async () => {
    const s = storage(legacyBrowserJson), loaded = loadDemoState(s, scenario);
    expect(loaded.status).toBe('migrated'); expect(loaded.state.schemaVersion).toBe(5); expect(s.getItem()).toBe(legacyBrowserJson);
    expect((await saveDemoState(s, scenario, loaded.state)).status).toBe('saved'); expect(loadDemoState(s, scenario).state).toEqual(loaded.state);
  });
  it('D07 both completion choices at 120 history events persist along with every remaining privacy exit', async () => {
    let state = atStage('accepted');
    state = run(state, { type: 'set_sharing', ...target(state), sharing: { roomName: true, photos: true, scanLocation: true, visitTimes: true, areaLabel: true }, visitTimes: '', areaLabel: '', scanLocation: null });
    while (state.requests[0]!.history.length < 117) state = run(state, { type: 'propose_time', ...target(state), text: `Visit ${state.requests[0]!.history.length}` }, 'alex');
    state = run(state, { type: 'agree_time', ...target(state) }); state = run(state, { type: 'post_update', ...target(state), text: 'For review' }, 'alex'); state = run(state, { type: 'report_done', ...target(state) }, 'alex');
    for (const type of ['confirm_done', 'not_done_yet'] as const) {
      let next = run(state, { type, ...target(state) });
      const s = storage('');
      expect((await saveDemoState(s, scenario, next)).status).toBe('saved'); expect(loadDemoState(s, scenario).state).toEqual(next);
      for (const field of ['roomName', 'photos', 'scanLocation', 'visitTimes', 'areaLabel'] as const) { next = run(next, { type: 'revoke_shared_field', ...target(next), field }); expect((await saveDemoState(s, scenario, next)).status).toBe('saved'); }
      if (type === 'not_done_yet') { next = run(next, { type: 'cancel_invitation', ...target(next) }); next = run(next, { type: 'cancel_request', ...target(next) }); }
      expect((await saveDemoState(s, scenario, next)).status).toBe('saved'); expect(loadDemoState(s, scenario).state).toEqual(next);
    }
  });
  it('D11 removed contributor attribution survives reload without exposing a deleted photo', async () => {
    let state = run(atStage('draft'), { type: 'grant_delegation', personId: 'sam', scopes: ['checklist'] });
    state = run(state, { type: 'add_photo', photoId: 'helper-photo', checklistItemId: 'rug-check', width: 800, height: 600 }, 'sam');
    state = run(state, { type: 'revoke_delegation', personId: 'sam' }); state = run(state, { type: 'remove_photo', photoId: 'helper-photo' });
    const s = storage(''); expect((await saveDemoState(s, scenario, state)).status).toBe('saved');
    expect(loadDemoState(s, scenario).state.removedPhotos[0]).toMatchObject({ addedBy: 'sam', removedBy: { actorId: 'margaret', at } });
  });
  it('D11 deletion frees all 64 live-photo slots and keeps bounded attribution across reload', async () => {
    let state = atStage('draft');
    for (let i = 0; i < 64; i++) state = run(state, { type: 'add_photo', photoId: `photo-${i}`, checklistItemId: 'rug-check', width: 800, height: 600 });
    for (let i = 0; i < 64; i++) state = run(state, { type: 'remove_photo', photoId: `photo-${i}` });
    state = run(state, { type: 'add_photo', photoId: 'photo-next', checklistItemId: 'rug-check', width: 800, height: 600 });
    expect(state.photos.map((p) => p.id)).toEqual(['photo-next']);
    expect(state.removedPhotos).toHaveLength(32);
    expect(state.removedPhotos[0]!.id).toBe('photo-32');
    expect(state).toMatchObject({ removedPhotoHistoryTruncated: true });
    const s = storage(''); expect((await saveDemoState(s, scenario, state)).status).toBe('saved');
    const loaded = loadDemoState(s, scenario); expect(loaded.status).toBe('loaded'); expect(loaded.state).toEqual(state);
    expect(validateState(loaded.state, scenario).ok).toBe(true);
    let full = loaded.state;
    for (let i = 1; i < 64; i++) full = run(full, { type: 'add_photo', photoId: `new-photo-${i}`, checklistItemId: 'rug-check', width: 800, height: 600 });
    expect(full.photos).toHaveLength(64); expect(full.removedPhotos).toHaveLength(32);
    expect((await saveDemoState(s, scenario, full)).status).toBe('saved'); expect(loadDemoState(s, scenario).state).toEqual(full);
    const oversized = { ...loaded.state, removedPhotos: [...loaded.state.removedPhotos, { ...loaded.state.removedPhotos[0]!, id: 'extra-history' }] };
    expect(validateState(oversized, scenario).ok).toBe(false);
    expect(validateState({ ...loaded.state, removedPhotoHistoryTruncated: 'yes' }, scenario).ok).toBe(false);
  });
  it('D11 migrates schema 4 history in memory, validates dropped entries and preserves envelope revision', async () => {
    const { removedPhotoHistoryTruncated: _truncated, ...previous } = { ...atStage('draft'), removedPhotoHistoryTruncated: false };
    const removedPhotos = Array.from({ length: 64 }, (_, i) => ({ id: `old-photo-${i}`, checklistItemId: 'rug-check', addedBy: 'sam', addedAt: at, width: 800, height: 600, removedBy: { actorId: 'margaret', at } }));
    const v4 = { ...previous, schemaVersion: 4, removedPhotos };
    const bytes = JSON.stringify({ format: 'fixlist-saved-v1', revision: 17, state: v4 }), s = storage(bytes);
    const loaded = loadDemoState(s, scenario);
    expect(loaded.status).toBe('migrated'); expect(loaded.state.schemaVersion).toBe(5); expect(s.getItem()).toBe(bytes);
    expect(loaded.state.removedPhotos).toEqual(removedPhotos.slice(-32));
    expect(loaded.state).toMatchObject({ removedPhotoHistoryTruncated: true });
    expect((await saveDemoState(s, scenario, loaded.state, bytes)).status).toBe('saved');
    expect(JSON.parse(s.getItem()!).revision).toBe(18); expect(loadDemoState(s, scenario).state).toEqual(loaded.state);
    const bad = { ...v4, removedPhotos: [{ ...removedPhotos[0], addedBy: 'unknown-person' }, ...removedPhotos.slice(1)] };
    const rejectedBytes = JSON.stringify(bad), rejected = storage(rejectedBytes);
    expect(loadDemoState(rejected, scenario).status).toBe('invalid'); expect(rejected.getItem()).toBe(rejectedBytes);
    expect(loadDemoState(storage(JSON.stringify({ ...v4, removedPhotoHistoryTruncated: true })), scenario).status).toBe('invalid');
    const short = loadDemoState(storage(JSON.stringify({ ...v4, removedPhotos: removedPhotos.slice(0, 2) })), scenario);
    expect(short.status).toBe('migrated'); expect(short.state.removedPhotoHistoryTruncated).toBe(false); expect(short.state.removedPhotos).toEqual(removedPhotos.slice(0, 2));
  });
  it('D14 rejects an update that disagrees with the recorded event', () => {
    const state = structuredClone(atStage('in_progress')); (state.requests[0]!.updates[0]!).text = 'Invented text never recorded in history';
    expect(validateState(state, scenario).ok).toBe(false);
  });
  it('D14 rejects proposal and agreement timestamps that disagree with events', () => {
    const state = structuredClone(atStage('scheduled')); state.requests[0]!.proposedTime!.at = '2026-10-18T14:00:00.000Z';
    expect(validateState(state, scenario).ok).toBe(false);
  });
  it('D14 rejects request events whose timestamps run backwards', () => {
    const state = structuredClone(atStage('in_progress')); state.requests[0]!.history[2]!.at = '2026-10-18T11:00:00.000Z';
    expect(validateState(state, scenario).ok).toBe(false);
  });
});
