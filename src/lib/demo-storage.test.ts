import { atStage } from '../domain/roles-test-helpers';
import { describe, expect, it } from 'vitest';
import legacyBrowserJson from './demo-storage-legacy-fixture.json?raw';
import { demoScenario } from '../data/demo-scenario';
import type { DemoScenario } from '../domain/types';
import {
  createInitialState,
  FAMILY_LABEL,
  requestIdForAction,
  type DemoState,
} from '../domain/workflow';
import {
  DEMO_STORAGE_KEY,
  getBrowserStorage,
  loadDemoState,
  MAX_SERIALIZED_BYTES,
  resetDemoState,
  saveDemoState,
  validateState,
  type DemoStorage,
} from './demo-storage';

const at = '2026-10-17T04:00:00.000Z';

class MemoryStorage implements DemoStorage {
  readonly items = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  readonly removes: string[] = [];
  failRead = false;
  failWrite = false;
  failRemove = false;

  getItem(key: string): string | null {
    this.reads.push(key);
    if (this.failRead) throw new Error('Access denied');
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes.push(key);
    if (this.failWrite) throw new Error('Quota exceeded');
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.removes.push(key);
    if (this.failRemove) throw new Error('Access denied');
    this.items.delete(key);
  }
}

function requestState(): DemoState { return atStage('resident_confirmed_done'); }
function record(value: unknown): Record<string, unknown> { return value as Record<string, unknown>; }
function firstRequest(value: Record<string, unknown>): Record<string, unknown> { return record((value.requests as unknown[])[0]); }
function legacyState(): Record<string, unknown> { return record(JSON.parse(legacyBrowserJson)); }
function legacyActiveState(): Record<string, unknown> { const value = legacyState(); record(value.confirmations)['rug-concern'] = { humanConfirmed: true, confirmedBy: FAMILY_LABEL, confirmedAt: at }; return value; }
function rejectLegacy(change: (value: Record<string, unknown>) => void): void {
 const value = legacyActiveState(); change(value); const storage = new MemoryStorage();
 const bytes = JSON.stringify(value); storage.items.set(DEMO_STORAGE_KEY, bytes);
 expect(loadDemoState(storage, demoScenario).status).toBe('invalid');
 expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(bytes); expect(storage.writes).toEqual([]); expect(storage.removes).toEqual([]);
}

describe('frozen schema-v1 rejection boundaries', () => {
  it('rejects a v1 payload at the direct v2 validator/save boundary', async () => {
    const storage = new MemoryStorage();
    expect(validateState(legacyState(), demoScenario).ok).toBe(false);
    expect((await saveDemoState(storage, demoScenario, legacyState() as unknown as DemoState)).status).toBe('invalid');
    expect(storage.writes).toEqual([]);
  });

  it.each(['schemaVersion', 'scenarioId', 'checklistAnswers', 'confirmations', 'criterionAnswers', 'requests'])('rejects missing legacy root %s without changing bytes', (key) => {
    rejectLegacy((value) => { delete value[key]; });
  });

  it.each([0, 2, 3, '1', null])('rejects unsupported or mismatched legacy version %s', (version) => {
    rejectLegacy((value) => { value.schemaVersion = version; });
  });

  it('rejects old shapes expanded to new IDs, future fields, unknown scenario, or partial current shapes', () => {
    rejectLegacy((value) => { value.scenarioId = 'unknown-scenario'; });
    for (const field of ['facts', 'profile', 'profileId', 'rule', 'screening', 'derivedPlan']) rejectLegacy((value) => { value[field] = {}; });
    rejectLegacy((value) => { record(value.checklistAnswers)['handrail-check'] = 'unknown'; });
    rejectLegacy((value) => { delete record(value.checklistAnswers)['cord-check']; });
    rejectLegacy((value) => { record(value.confirmations)['handrail-concern'] = { humanConfirmed: false, confirmedBy: null, confirmedAt: null }; });
    rejectLegacy((value) => { delete record(value.confirmations)['cord-concern']; });
    rejectLegacy((value) => { record(value.criterionAnswers)['fictional-maple-lighting'] = {}; });
    rejectLegacy((value) => { delete record(value.criterionAnswers)['fictional-maple-support']; });
    rejectLegacy((value) => { record(record(value.criterionAnswers)['fictional-maple-support'])['support-age'] = 'met'; });
    rejectLegacy((value) => { delete record(record(value.criterionAnswers)['fictional-maple-support'])['fictional-residency']; });
    rejectLegacy((value) => { firstRequest(value).id = requestIdForAction('review-handrail'); firstRequest(value).referenceActionId = 'review-handrail'; });
  });

  it.each([null, [], true, 'met'])('rejects malformed legacy criterion map %s', (answer) => {
    rejectLegacy((value) => { value.criterionAnswers = answer; });
    rejectLegacy((value) => { record(value.criterionAnswers)['fictional-maple-support'] = answer; });
  });

  it.each(['yes', false, null, { status: 'met' }])('rejects unsupported legacy criterion status %s', (answer) => {
    rejectLegacy((value) => { record(record(value.criterionAnswers)['fictional-maple-support'])['fictional-area'] = answer; });
  });

  it('fully validates legacy checklist, confirmation, attribution, and canonical date invariants', () => {
    rejectLegacy((value) => { record(value.checklistAnswers)['rug-check'] = 'met'; });
    for (const answer of ['no', 'unknown']) rejectLegacy((value) => { record(value.checklistAnswers)['rug-check'] = answer; });
    for (const confirmation of [null, [], { humanConfirmed: true }, { humanConfirmed: 'true', confirmedBy: FAMILY_LABEL, confirmedAt: at }]) rejectLegacy((value) => { record(value.confirmations)['rug-concern'] = confirmation; });
    rejectLegacy((value) => { record(record(value.confirmations)['rug-concern']).extra = true; });
    rejectLegacy((value) => { record(record(value.confirmations)['rug-concern']).confirmedBy = 'Real person'; });
    for (const timestamp of [null, '2026-10-17', '2026-10-17T04:00:00Z', '2026-02-30T04:00:00.000Z']) rejectLegacy((value) => { record(record(value.confirmations)['rug-concern']).confirmedAt = timestamp; });
    rejectLegacy((value) => { record(value.confirmations)['cord-concern'] = { humanConfirmed: false, confirmedBy: FAMILY_LABEL, confirmedAt: null }; });
    rejectLegacy((value) => { record(value.confirmations)['cord-concern'] = { humanConfirmed: false, confirmedBy: null, confirmedAt: at }; });
  });

  it('fully validates legacy request IDs, count, exact text, statuses, source and completion', () => {
    for (const requests of [null, {}, 'requests']) rejectLegacy((value) => { value.requests = requests; });
    rejectLegacy((value) => { (value.requests as unknown[]).push(structuredClone(firstRequest(value))); });
    rejectLegacy((value) => { value.requests = Array.from({ length: 3 }, () => firstRequest(value)); });
    rejectLegacy((value) => { firstRequest(value).id = 'sample-family-draft'; });
    rejectLegacy((value) => { firstRequest(value).referenceActionId = 'unknown-action'; });
    for (const key of ['id', 'referenceActionId', 'helperLabel', 'recordedBy', 'status', 'note', 'completion', 'source']) rejectLegacy((value) => { delete firstRequest(value)[key]; });
    for (const key of ['helperLabel', 'recordedBy', 'note']) rejectLegacy((value) => { firstRequest(value)[key] = '<p>arbitrary saved text</p>'; });
    rejectLegacy((value) => { firstRequest(value).address = 'private text'; });
    for (const status of ['sent', 'complete', null]) rejectLegacy((value) => { firstRequest(value).status = status; });
    for (const key of ['status', 'label', 'citationUrl', 'verifiedAt']) {
      rejectLegacy((value) => { record(firstRequest(value).source)[key] = 'invented source'; });
      rejectLegacy((value) => { delete record(firstRequest(value).source)[key]; });
    }
    rejectLegacy((value) => { firstRequest(value).source = null; });
    rejectLegacy((value) => { record(firstRequest(value).source).extra = true; });
    rejectLegacy((value) => { firstRequest(value).status = 'draft'; });
    rejectLegacy((value) => { firstRequest(value).completion = []; });
    rejectLegacy((value) => { record(firstRequest(value).completion).status = 'verified_complete'; });
    rejectLegacy((value) => { record(firstRequest(value).completion).extra = true; });
    rejectLegacy((value) => { delete record(firstRequest(value).completion).reportedBy; });
    rejectLegacy((value) => { record(firstRequest(value).completion).reportedBy = 'Real person'; });
    for (const timestamp of [null, '2026-10-17T04:00:00Z', '2026-02-30T04:00:00.000Z']) rejectLegacy((value) => { record(firstRequest(value).completion).reportedAt = timestamp; });
    rejectLegacy((value) => { firstRequest(value).completion = { status: 'unconfirmed', reportedBy: FAMILY_LABEL, reportedAt: null }; });
    rejectLegacy((value) => { firstRequest(value).completion = { status: 'unconfirmed', reportedBy: null, reportedAt: at }; });
  });
});

describe('storage read, write, and reset failure boundaries', () => {
  it('loads an absent key without writing or removing anything', () => {
    const storage = new MemoryStorage();
    const result = loadDemoState(storage, demoScenario);
    expect(result.status).toBe('empty');
    expect(result.state).toEqual(createInitialState(demoScenario));
    expect(storage.reads).toEqual([DEMO_STORAGE_KEY]);
    expect(storage.writes).toEqual([]);
    expect(storage.removes).toEqual([]);
  });

  it.each(['{', '', 'null', '[]', 'true', '"text"'])('recovers from malformed or unsupported JSON: %s', (serialized) => {
    const storage = new MemoryStorage();
    storage.items.set(DEMO_STORAGE_KEY, serialized);
    expect(loadDemoState(storage, demoScenario).status).toBe('invalid');
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(serialized);
    expect(storage.writes).toEqual([]);
    expect(storage.removes).toEqual([]);
  });

  it('accepts a serialized payload at 64 KiB and rejects one byte beyond before parsing', () => {
    const storage = new MemoryStorage();
    const serialized = JSON.stringify(createInitialState(demoScenario));
    storage.items.set(DEMO_STORAGE_KEY, serialized.padEnd(MAX_SERIALIZED_BYTES, ' '));
    expect(loadDemoState(storage, demoScenario).status).toBe('loaded');
    storage.items.set(DEMO_STORAGE_KEY, serialized.padEnd(MAX_SERIALIZED_BYTES + 1, ' '));
    const result = loadDemoState(storage, demoScenario);
    expect(result.status).toBe('invalid');
    expect(result.message).toContain('64 KiB');
    expect(storage.writes).toEqual([]);
  });

  it('bounds UTF-8 bytes, including non-ASCII text, before parsing', () => {
    const storage = new MemoryStorage();
    const serialized = JSON.stringify({ untrusted: '💡'.repeat(17_000) });
    expect(serialized.length).toBeLessThan(MAX_SERIALIZED_BYTES);
    storage.items.set(DEMO_STORAGE_KEY, serialized);
    const result = loadDemoState(storage, demoScenario);
    expect(result.status).toBe('invalid');
    expect(result.message).toContain('64 KiB');
  });

  it('rejects an oversized otherwise valid reconstructed state before saving', async () => {
    const scenario: DemoScenario = {
      ...demoScenario,
      checklist: Array.from({ length: 4_000 }, (_, index) => ({ ...demoScenario.checklist[0]!, id: `known-checklist-${index}` })),
    };
    const storage = new MemoryStorage();
    const result = await saveDemoState(storage, scenario, createInitialState(scenario));
    expect(result.status).toBe('invalid');
    expect(result.message).toContain('64 KiB');
    expect(storage.writes).toEqual([]);
  });

  it.each([null, undefined])('supports unavailable storage (%s) with a truthful memory fallback', async (storage) => {
    const loaded = loadDemoState(storage, demoScenario);
    expect(loaded.status).toBe('unavailable');
    expect(loaded.state).toEqual(createInitialState(demoScenario));
    expect(loaded.message).toContain('memory only');
    expect((await saveDemoState(storage, demoScenario, requestState())).status).toBe('unavailable');
    const reset = await resetDemoState(storage, demoScenario);
    expect(reset.status).toBe('unavailable');
    expect(reset.state).toEqual(createInitialState(demoScenario));
    expect(reset.message).toContain('reloading may restore older saved data');
  });

  it('catches a denied read without changing the saved value or writing recovery state', () => {
    const storage = new MemoryStorage();
    const serialized = JSON.stringify(requestState());
    storage.items.set(DEMO_STORAGE_KEY, serialized);
    storage.failRead = true;
    const result = loadDemoState(storage, demoScenario);
    expect(result.status).toBe('error');
    expect(result.state).toEqual(createInitialState(demoScenario));
    expect(result.message).toContain('could not be read');
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(serialized);
    expect(storage.writes).toEqual([]);
    expect(storage.removes).toEqual([]);
  });

  it('catches quota/denied writes and preserves the previous saved state', async () => {
    const storage = new MemoryStorage();
    const original = JSON.stringify(createInitialState(demoScenario));
    storage.items.set(DEMO_STORAGE_KEY, original);
    storage.failWrite = true;
    const state = requestState();
    const result = await saveDemoState(storage, demoScenario, state);
    expect(result.status).toBe('error');
    expect(result.message).toContain('reloading may restore older saved data');
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(original);
    expect(state).toEqual(requestState());
  });

  it('validates runtime state before writing and leaves old data untouched on rejection', async () => {
    const storage = new MemoryStorage();
    storage.items.set(DEMO_STORAGE_KEY, 'old value');
    const result = await saveDemoState(storage, demoScenario, { ...requestState(), scenarioId: 'other' });
    expect(result.status).toBe('invalid');
    expect(storage.writes).toEqual([]);
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe('old value');
  });

  it('reset removes only its own key and returns fresh memory without confirmations or requests', async () => {
    const storage = new MemoryStorage();
    storage.items.set(DEMO_STORAGE_KEY, JSON.stringify(requestState()));
    storage.items.set('another-app', 'keep me');
    const first = await resetDemoState(storage, demoScenario);
    const second = await resetDemoState(storage, demoScenario);
    expect(first.status).toBe('reset');
    expect(first.state).toEqual(createInitialState(demoScenario));
    expect(first.state.requests).toEqual([]);
    expect(Object.values(first.state.confirmations).every((confirmation) => !confirmation.humanConfirmed)).toBe(true);
    expect(first.state).not.toBe(second.state);
    expect(first.state.confirmations['rug-concern']).not.toBe(second.state.confirmations['rug-concern']);
    expect(storage.items.has(DEMO_STORAGE_KEY)).toBe(false);
    expect(storage.items.get('another-app')).toBe('keep me');
    expect(storage.removes).toEqual([DEMO_STORAGE_KEY, 'fixlist:navigation:v1', DEMO_STORAGE_KEY, 'fixlist:navigation:v1']);
    expect(storage.writes).toEqual([]);
    expect(storage.reads).toEqual([]);
  });

  it('resets memory even when removal is denied, preserves unrelated data, and warns about reload', async () => {
    const storage = new MemoryStorage();
    const original = JSON.stringify(requestState());
    storage.items.set(DEMO_STORAGE_KEY, original);
    storage.items.set('another-app', 'keep me');
    storage.failRemove = true;
    const result = await resetDemoState(storage, demoScenario);
    expect(result.status).toBe('error');
    expect(result.state).toEqual(createInitialState(demoScenario));
    expect(result.message).toContain('Reloading may restore older saved data');
    expect(storage.items.get(DEMO_STORAGE_KEY)).toBe(original);
    expect(storage.items.get('another-app')).toBe('keep me');
    expect(storage.writes).toEqual([]);
    expect(storage.reads).toEqual([]);
  });

  it('guards browser storage acquisition, including a denied property getter', () => {
    const storage = new MemoryStorage();
    expect(getBrowserStorage({ localStorage: storage })).toBe(storage);
    expect(getBrowserStorage(null)).toBe(null);
    expect(getBrowserStorage()).toBe(null); // Vitest runs this suite without window.
    const denied = { get localStorage(): DemoStorage { throw new Error('Access denied'); } };
    expect(getBrowserStorage(denied)).toBe(null);
  });
});
