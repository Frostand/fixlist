import photoQuestions from '../../scan/hazard-questions.json';
import { demoScenario } from '../data/demo-scenario';
import { CAPTURE_FLAG_EXCLUDED, type CaptureManifest, type CaptureSuggestionItem, type CaptureSuggestionsFile, type CaptureSuggestionRow } from './capture-types';
import { captureDate, captureFail, exactKeys, plainRecord, sha256String, unitProbability, type CaptureResult } from './capture-model';
import { createSuggestionCatalog, plattProbability, TRUSTED_MODEL_LICENSE, TRUSTED_SUGGESTION_NOTICE, validateSuggestionCalibration, type SuggestionCatalog } from './scan-suggestions';

export const MAX_CAPTURE_FLAGS_BYTES = 4 * 1024 * 1024;
export const CAPTURE_MISMATCH_MESSAGE = 'These flags belong to a different capture.';
export function validateCaptureSuggestions(value: unknown, capture: CaptureManifest, catalog: SuggestionCatalog = createSuggestionCatalog(demoScenario)): CaptureResult<CaptureSuggestionsFile> {
  if (!plainRecord(value) || !exactKeys(value, ['format', 'version', 'createdAt', 'capture', 'model', 'thresholds', 'calibration', 'notice', 'items'])
    || value.format !== 'fixlist-capture-suggestions' || value.version !== 1 || !captureDate(value.createdAt) || value.notice !== TRUSTED_SUGGESTION_NOTICE) return captureFail('Invalid flags fields or trusted notice.');
  const binding = value.capture;
  if (!plainRecord(binding) || !exactKeys(binding, ['captureId', 'roomId', 'photos']) || !Array.isArray(binding.photos)
    || binding.photos.some((p) => !plainRecord(p) || !exactKeys(p, ['photoId', 'sha256']) || !sha256String(p.sha256) || typeof p.photoId !== 'string')) return captureFail('Invalid flags capture binding.');
  if (binding.captureId !== capture.captureId || binding.roomId !== capture.roomId || binding.photos.length !== capture.photos.length
    || binding.photos.some((p, i) => p.photoId !== capture.photos[i]!.photoId || p.sha256 !== capture.photos[i]!.sha256)) return captureFail(CAPTURE_MISMATCH_MESSAGE, 'CAPTURE_MISMATCH');
  const model = value.model, thresholds = value.thresholds;
  if (!plainRecord(model) || !exactKeys(model, ['name', 'backend', 'engine', 'license', 'identity']) || typeof model.name !== 'string' || !model.name.length || model.name.length > 200 || /[\u0000-\u001f\u007f]/.test(model.name)
    || model.backend !== 'mlx' || model.engine !== 'startlux-decision' || model.license !== TRUSTED_MODEL_LICENSE) return captureFail('Invalid trusted model/license tuple.');
  if (model.identity !== null && (!plainRecord(model.identity) || !exactKeys(model.identity, ['version', 'weightsSHA256', 'runtimeSHA256']) || model.identity.version !== 1
    || !sha256String(model.identity.weightsSHA256) || !sha256String(model.identity.runtimeSHA256))) return captureFail('Invalid model content identity.');
  if (!plainRecord(thresholds) || !exactKeys(thresholds, ['suggestion', 'relevance', 'location']) || !Object.values(thresholds).every(unitProbability)) return captureFail('Invalid flags thresholds.');
  const fitted = validateSuggestionCalibration(value.calibration);
  if (fitted === false) return captureFail('Invalid calibration provenance or Platt parameters.');
  if (!Array.isArray(value.items) || value.items.length !== photoQuestions.items.length) return captureFail('Flags require every photo question in catalog order.');
  const items: CaptureSuggestionItem[] = [];
  for (const [i, item] of value.items.entries()) {
    const trusted = photoQuestions.items[i]!;
    if (!plainRecord(item) || !exactKeys(item, ['checklistItemId', 'concernId', 'question', 'relevanceQuestion', 'limitation', 'status', 'score', 'bestPhotoId', 'perPhoto', 'point'])
      || !(['checklistItemId', 'concernId', 'question', 'relevanceQuestion', 'limitation'] as const).every((key) => item[key] === trusted[key])
      || !catalog.get(trusted.checklistItemId)?.concernIds.has(trusted.concernId) || !Array.isArray(item.perPhoto) || item.perPhoto.length !== capture.photos.length) return captureFail('Flags question, limitation, order or photo rows disagree with the catalog.');
    const rows: CaptureSuggestionRow[] = [];
    for (const [j, row] of item.perPhoto.entries()) {
      if (!plainRecord(row) || !exactKeys(row, ['photoId', 'rawProbability', 'probability', 'relevanceProbability']) || row.photoId !== capture.photos[j]!.photoId
        || !unitProbability(row.rawProbability) || !unitProbability(row.probability) || !unitProbability(row.relevanceProbability)) return captureFail('Invalid flags photo evidence.');
      const param = fitted?.parameters[trusted.checklistItemId], expected = param ? plattProbability(row.rawProbability, param.a, param.b) : row.rawProbability;
      if (fitted ? Math.abs(row.probability - expected) > 1e-9 : row.probability !== expected) return captureFail('Flags probability disagrees with raw evidence/calibration.');
      rows.push({ photoId: row.photoId as string, rawProbability: row.rawProbability, probability: row.probability, relevanceProbability: row.relevanceProbability });
    }
    const relevant = rows.filter((r) => r.relevanceProbability >= (thresholds.relevance as number));
    const best = relevant.reduce<CaptureSuggestionRow | null>((b, r) => !b || r.probability > b.probability ? r : b, null);
    const score = best?.probability ?? null, status = score === null ? 'not-visible' : score >= (thresholds.suggestion as number) ? 'suggested' : 'below-threshold';
    if (item.score !== score || item.bestPhotoId !== (best?.photoId ?? null) || item.status !== status) return captureFail('Flags derivation disagrees with photo evidence and thresholds.');
    if (item.point !== null) {
      const photo = capture.photos.find((p) => p.photoId === best?.photoId);
      if (!plainRecord(item.point) || !exactKeys(item.point, ['u', 'v']) || !photo || status !== 'suggested' || score === null || score < (thresholds.location as number)
        || typeof item.point.u !== 'number' || !Number.isFinite(item.point.u) || item.point.u < 0 || item.point.u >= photo.width
        || typeof item.point.v !== 'number' || !Number.isFinite(item.point.v) || item.point.v < 0 || item.point.v >= photo.height) return captureFail('Flag point is outside its photo or unsupported by the location threshold.');
      // The producer chooses one of the conservative 3 x 3 grid's cell centres.
      // Its confidence/mass/margin/none evidence is not present in the v1 file.
      const centre = (pixel: number, edge: number) => [0, 1, 2].some((i) => Math.abs(pixel - (i + .5) * edge / 3) <= 1e-6);
      if (!centre(item.point.u, photo.width) || !centre(item.point.v, photo.height)) return captureFail('Flag point is not a review-grid cell centre.');
    }
    items.push({ checklistItemId: trusted.checklistItemId, concernId: trusted.concernId, question: trusted.question, relevanceQuestion: trusted.relevanceQuestion, limitation: trusted.limitation,
      status, score, bestPhotoId: best?.photoId ?? null, perPhoto: rows, point: item.point === null ? null : { u: item.point.u as number, v: item.point.v as number } });
  }
  return { ok: true, value: { format: 'fixlist-capture-suggestions', version: 1, createdAt: value.createdAt, capture: { captureId: capture.captureId, roomId: capture.roomId, photos: capture.photos.map(({ photoId, sha256 }) => ({ photoId, sha256 })) },
    model: { name: model.name, backend: 'mlx', engine: 'startlux-decision', license: TRUSTED_MODEL_LICENSE, identity: model.identity === null ? null : { version: 1, weightsSHA256: model.identity.weightsSHA256 as string, runtimeSHA256: model.identity.runtimeSHA256 as string } },
    thresholds: { suggestion: thresholds.suggestion as number, relevance: thresholds.relevance as number, location: thresholds.location as number }, calibration: fitted ? { ...fitted } : null, notice: TRUSTED_SUGGESTION_NOTICE, items } };
}
export function parseCaptureSuggestions(text: string, capture: CaptureManifest): CaptureResult<CaptureSuggestionsFile> {
  if (new Blob([text]).size > MAX_CAPTURE_FLAGS_BYTES) return captureFail('Flags file exceeds 4 MiB.');
  try { return validateCaptureSuggestions(JSON.parse(text), capture); } catch { return captureFail('Flags file is not valid JSON.'); }
}
export function displayFlags(file: CaptureSuggestionsFile | null): CaptureSuggestionItem[] { return file?.items.filter((i) => i.status === 'suggested' && !CAPTURE_FLAG_EXCLUDED.has(i.checklistItemId)) ?? []; }
