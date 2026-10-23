import { describe, expect, it } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import type { CaptureSuggestionItem, CaptureSuggestionsFile } from '../lib/capture-types';
import { roomFlags } from './capture-summary';
import { en } from '../i18n/en';

const item = (checklistItemId: string, status: CaptureSuggestionItem['status'] = 'suggested') =>
  ({ checklistItemId, concernId: '', question: '', relevanceQuestion: '', limitation: '', status, score: 0.9, bestPhotoId: 'p1', perPhoto: [], point: null }) as CaptureSuggestionItem;
const file = (items: CaptureSuggestionItem[]) => ({ items }) as unknown as CaptureSuggestionsFile;

describe('roomFlags', () => {
  it('counts only flags for the room’s own questions, so summaries match the room page', () => {
    // A living-room photo can score high for the hallway cord question; that must not count for the living room.
    const flags = file([item('cord-check'), item('rug-check', 'below-threshold'), item('night-lighting-check')]);
    expect(roomFlags(flags, demoScenario.checklist, 'living-room')).toHaveLength(0);
    expect(roomFlags(flags, demoScenario.checklist, 'hallway').map((f) => f.checklistItemId)).toEqual(['cord-check']);
    expect(roomFlags(file([item('rug-check')]), demoScenario.checklist, 'living-room')).toHaveLength(1);
    expect(roomFlags(null, demoScenario.checklist, 'hallway')).toEqual([]);
  });
  it('has singular and zero copy for room spot counts', () => {
    expect(en['rooms.scannedOne']).toBe('Scanned · 1 spot to review');
    expect(en['rooms.scannedNone']).toBe('Scanned · nothing flagged');
    expect(en['home.spotOne']).toBe('spot to review');
  });
});
