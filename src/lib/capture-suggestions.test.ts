import { describe, expect, it } from 'vitest';
import bundle from '../../scan/tests/capture-parity/valid-bundle.json';
import fixture from '../../scan/tests/capture-parity/valid-flags.json';
import { validateCaptureManifest } from './capture-model';
import { displayFlags, parseCaptureSuggestions, validateCaptureSuggestions } from './capture-suggestions';
import { plattProbability, trustedPhotoQuestions } from './scan-suggestions';
function capture() { const result = validateCaptureManifest({ ...bundle, photos: bundle.photos.map(({ jpeg: _jpeg, ...p }) => p) }); if (!result.ok) throw new Error(result.error); return result.value; }
describe('capture flags evidence and disclosures', () => {
  it('binds capture ID, room and every ordered photo hash with a typed error', () => {
    for (const patch of [{ captureId: 'cap-another-0001' }, { roomId: 'bathroom' }, { photos: [...fixture.capture.photos].reverse() }, { photos: fixture.capture.photos.slice(1) }]) expect(validateCaptureSuggestions({ ...fixture, capture: { ...fixture.capture, ...patch } }, capture())).toMatchObject({ ok: false, code: 'CAPTURE_MISMATCH', error: 'These flags belong to a different capture.' });
  });
  it.each(['question', 'relevanceQuestion', 'limitation', 'concernId', 'checklistItemId'])('rejects catalog substitution of %s', (key) => {
    const f = structuredClone(fixture); Object.assign(f.items[0]!, { [key]: 'substitute' }); expect(validateCaptureSuggestions(f, capture()).ok).toBe(false);
  });
  it('recomputes first-on-ties, relevance, score and all statuses', () => {
    const f = structuredClone(fixture), first = f.items[0]!;
    first.perPhoto[1]!.rawProbability = first.perPhoto[1]!.probability = .77;
    expect(validateCaptureSuggestions(f, capture()).ok).toBe(true);
    first.bestPhotoId = 'p02'; expect(validateCaptureSuggestions(f, capture()).ok).toBe(false);
    first.perPhoto.forEach((r) => { r.relevanceProbability = .1; });
    Object.assign(first, { bestPhotoId: null, score: null, status: 'not-visible', point: null }); expect(validateCaptureSuggestions(f, capture()).ok).toBe(true);
    first.status = 'below-threshold'; expect(validateCaptureSuggestions(f, capture()).ok).toBe(false);
  });
  it('refuses unknown keys, rows out of order, altered raw evidence, out-of-bounds points and unsupported licenses', () => {
    for (const mutate of [
      (f: typeof fixture) => Object.assign(f, { extra: true }),
      (f: typeof fixture) => f.items.reverse(),
      (f: typeof fixture) => f.items[0]!.perPhoto.reverse(),
      (f: typeof fixture) => { f.items[0]!.perPhoto[0]!.probability = .9; },
      (f: typeof fixture) => { f.items[0]!.point = { u: 16, v: 8 }; },
      (f: typeof fixture) => { f.items[0]!.point = { u: -1, v: 8 }; },
      (f: typeof fixture) => { f.items[1]!.point = { u: 8, v: 8 }; },
      (f: typeof fixture) => { f.model.license = 'free'; },
      (f: typeof fixture) => { f.thresholds.location = 2; },
    ]) { const f = structuredClone(fixture); mutate(f); expect(validateCaptureSuggestions(f, capture()).ok).toBe(false); }
  });
  it('uses the v2 calibration schema and mapping, rejecting claimed adjustments', () => {
    const f = structuredClone(fixture), parameters = Object.fromEntries(trustedPhotoQuestions.map((q) => [q.checklistItemId, { a: 1.2, b: -.1 }]));
    const calibration = { method: 'platt', parameters, fittedAt: '2026-10-18T18:00:00.000Z', labelSource: 'Synthetic AI-labeled fixture', trainExamples: 10, heldOutExamples: 5, heldOutBrierRaw: .2, heldOutBrierCalibrated: .19 };
    for (const item of f.items) { for (const r of item.perPhoto) r.probability = plattProbability(r.rawProbability, 1.2, -.1); item.score = item.perPhoto[0]!.probability; }
    expect(validateCaptureSuggestions({ ...f, calibration }, capture()).ok).toBe(true);
    f.items[0]!.perPhoto[0]!.probability = .99; expect(validateCaptureSuggestions({ ...f, calibration }, capture()).ok).toBe(false);
    expect(validateCaptureSuggestions({ ...fixture, calibration: { ...calibration, parameters: { other: { a: 1, b: 0 } } } }, capture()).ok).toBe(false);
  });
  it('displays suggested entries only, always excluding zero-positive questions', () => {
    const f = structuredClone(fixture);
    for (const item of f.items) { item.perPhoto.forEach((r) => { r.rawProbability = r.probability = .77; }); item.score = .77; item.status = 'suggested'; }
    const parsed = validateCaptureSuggestions(f, capture()); if (!parsed.ok) throw new Error(parsed.error);
    expect(displayFlags(parsed.value)).toHaveLength(6); expect(displayFlags(parsed.value).some((i) => ['handrail-check', 'stair-lighting-check'].includes(i.checklistItemId))).toBe(false);
    expect(displayFlags(null)).toEqual([]);
  });
  it('bounds parsing and reports malformed JSON', () => { expect(parseCaptureSuggestions('{', capture()).ok).toBe(false); expect(parseCaptureSuggestions(' '.repeat(4 * 1024 * 1024 + 1), capture()).ok).toBe(false); });
});
