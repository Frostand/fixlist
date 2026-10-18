import photoQuestions from '../../scan/hazard-questions.json';
import type { DemoScenario } from '../domain/types';
import { point3, type Point3, type ScanAsset, type ScanResult } from './scan-model';
import { isSmallJpeg } from './scan-image';

export const MAX_SUGGESTIONS_BYTES = 4 * 1024 * 1024;
export const MAX_SUGGESTION_ITEMS = 64;
export const MAX_SUGGESTION_FRAMES = 240;
export const MAX_THUMBNAIL_LENGTH = 128 * 1024;
export const trustedPhotoQuestions = photoQuestions.items;
export type SuggestionCatalog = ReadonlyMap<string, { question: string; relevanceQuestion: string; limitation: string; checklistPrompt: string; concernIds: ReadonlySet<string> }>;
interface SuggestionBase {
  checklistItemId: string; concernId: string; question: string;
  meanProbability: number; framesAboveThreshold: number;
  bestFrame: string | null; position: Point3 | null; thumbnail: string | null; viewpoint: Point3 | null;
}
export interface ScanSuggestionV1 extends SuggestionBase {
  maxProbability: number; suggested: boolean;
  perFrame: { frame: string; probability: number }[];
}
export interface ScanSuggestionV2 extends SuggestionBase {
  relevanceQuestion: string; limitation: string; status: 'suggested' | 'not-visible' | 'below-threshold';
  score: number | null; relevantFrames: number;
  perFrame: { frame: string; rawProbability: number; probability: number; relevanceProbability: number }[];
}
export type ScanSuggestion = ScanSuggestionV1 | ScanSuggestionV2;
export interface Calibration {
  method: 'platt'; parameters: Record<string, { a: number; b: number }>; fittedAt: string; labelSource: string;
  trainExamples: number; heldOutExamples: number; heldOutBrierRaw: number; heldOutBrierCalibrated: number;
}
interface SuggestionsBase {
  format: 'fixlist-scan-suggestions'; createdAt: string;
  model: { name: string; backend: 'mlx'; engine: 'startlux-decision'; license: string };
  scan: { splatCount: number; framesAnalyzed: number; keyframes: string[] };
  notice: string; timing: Record<string, number>;
}
export interface ScanSuggestionsV1 extends SuggestionsBase { version: 1; thresholds: Record<string, number>; items: ScanSuggestionV1[] }
export interface ScanSuggestionsV2 extends SuggestionsBase {
  version: 2; thresholds: { suggestion: number; location: number; relevance: number; noneProbability: number; minFrames: number };
  calibration: Calibration | null; items: ScanSuggestionV2[];
}
export type ScanSuggestions = ScanSuggestionsV1 | ScanSuggestionsV2;
export interface ScanSuggestionLayer { data: ScanSuggestions; dismissed: string[]; pinned: string[]; droppedItems: number }
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error: `suggestions.json: ${error}` });
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function shape(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function text(value: unknown, max = 255): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function probability(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }
function numbers(value: unknown): value is Record<string, number> {
  return record(value) && Object.keys(value).length <= 32 && Object.entries(value).every(([key, number]) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)
    && typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1e15);
}
function iso(value: unknown, canonical = false): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const date = new Date(value), calendar = new Date(`${value.slice(0, 19)}Z`);
  return Number.isFinite(date.getTime()) && Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 19) === value.slice(0, 19)
    && (!canonical || date.toISOString() === value);
}
function legacyThumbnail(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > MAX_THUMBNAIL_LENGTH) return false;
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match?.[2] || match[2].length % 4 !== 0) return false;
  try {
    const bytes = atob(match[2]);
    return match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff') : bytes.startsWith('\x89PNG\r\n\x1a\n');
  } catch { return false; }
}
const close = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) <= 1e-9;
export function plattProbability(raw: number, a: number, b: number): number {
  const p = Math.max(1e-6, Math.min(1 - 1e-6, raw));
  return 1 / (1 + Math.exp(-(a * Math.log(p / (1 - p)) + b)));
}
function calibration(value: unknown): Calibration | null | false {
  if (value === null) return null;
  if (!record(value) || !shape(value, ['method', 'parameters', 'fittedAt', 'labelSource', 'trainExamples', 'heldOutExamples', 'heldOutBrierRaw', 'heldOutBrierCalibrated'])
    || value.method !== 'platt' || !record(value.parameters) || !shape(value.parameters, trustedPhotoQuestions.map((q) => q.checklistItemId))
    || !iso(value.fittedAt) || !value.fittedAt.endsWith('Z') || !text(value.labelSource, 200) || !integer(value.trainExamples) || !integer(value.heldOutExamples)
    || !probability(value.heldOutBrierRaw) || !probability(value.heldOutBrierCalibrated)) return false;
  const parameters: Calibration['parameters'] = {};
  for (const [id, param] of Object.entries(value.parameters)) {
    if (!record(param) || !shape(param, ['a', 'b']) || typeof param.a !== 'number' || !Number.isFinite(param.a) || param.a <= 0 || typeof param.b !== 'number' || !Number.isFinite(param.b)) return false;
    parameters[id] = { a: param.a, b: param.b };
  }
  return { method: 'platt', parameters, fittedAt: value.fittedAt, labelSource: value.labelSource, trainExamples: value.trainExamples, heldOutExamples: value.heldOutExamples,
    heldOutBrierRaw: value.heldOutBrierRaw, heldOutBrierCalibrated: value.heldOutBrierCalibrated };
}
export function createSuggestionCatalog(scenario: DemoScenario): SuggestionCatalog {
  return new Map(trustedPhotoQuestions.map((photo) => [photo.checklistItemId, { question: photo.question, relevanceQuestion: photo.relevanceQuestion, limitation: photo.limitation,
    checklistPrompt: scenario.checklist.find((item) => item.id === photo.checklistItemId)?.prompt ?? photo.originalQuestion,
    concernIds: new Set(scenario.concerns.filter((concern) => concern.id === photo.concernId && concern.evidenceIds.some((id) => scenario.evidence.some((evidence) => evidence.id === id && evidence.checklistItemId === photo.checklistItemId))).map((concern) => concern.id)),
  }]));
}
export function suggestionId(item: Pick<ScanSuggestion, 'checklistItemId' | 'concernId'>): string { return `${encodeURIComponent(item.checklistItemId)}:${encodeURIComponent(item.concernId)}`; }
export function suggestionAnchor(item: Pick<ScanSuggestion, 'checklistItemId' | 'concernId'>): string { return `scan-suggestion-${suggestionId(item)}`; }
export function isSuggested(item: ScanSuggestion): boolean { return 'status' in item ? item.status === 'suggested' : item.suggested; }
export function suggestionScore(item: ScanSuggestion): number | null { return 'score' in item ? item.score : item.maxProbability; }
export function suggestionScoreText(item: ScanSuggestion, data: ScanSuggestions): string {
  const score = suggestionScore(item);
  if (score === null) return 'No model score: no relevant frames';
  return data.version === 2 && data.calibration !== null
    ? `Model score ${score.toFixed(2)} (calibrated on ${data.calibration.trainExamples} labeled photos; not validated in real homes)`
    : `Experimental model score ${score.toFixed(2)} (uncalibrated; not a probability)`;
}
export function visibleSuggestionMarkers(layer: ScanSuggestionLayer | null): ScanSuggestion[] {
  return layer?.data.items.filter((item) => isSuggested(item) && item.position !== null && !layer.dismissed.includes(suggestionId(item)) && !layer.pinned.includes(suggestionId(item))) ?? [];
}
export function suggestionForChecklist(layer: ScanSuggestionLayer | null, checklistItemId: string): ScanSuggestion | undefined {
  return layer?.data.items.filter((item) => item.checklistItemId === checklistItemId && isSuggested(item) && !layer.dismissed.includes(suggestionId(item)))
    .sort((a, b) => (suggestionScore(b) ?? -1) - (suggestionScore(a) ?? -1))[0];
}
export function suggestionCountMatches(asset: ScanAsset, count: number): boolean {
  if (asset.name.toLowerCase().endsWith('.splat')) return asset.blob.size / 32 === count;
  return asset.metadata === null || asset.metadata.splatCount === count;
}

/** Reconstruct each field from validated JSON; v1 remains v1 and loading never writes a migration. */
export function validateScanSuggestions(value: unknown, catalog: SuggestionCatalog, asset: ScanAsset): ScanResult<{ data: ScanSuggestions; dropped: number }> {
  const rootKeys = ['format', 'version', 'createdAt', 'model', 'scan', 'thresholds', 'notice', 'items', 'timing'];
  if (!record(value) || (value.version !== 1 && value.version !== 2) || !shape(value, value.version === 2 ? [...rootKeys, 'calibration'] : rootKeys)
    || value.format !== 'fixlist-scan-suggestions' || !iso(value.createdAt, value.version === 2)) return fail('expected exactly the version 1 or 2 fields and an ISO createdAt timestamp.');
  const model = value.model, scan = value.scan, thresholds = value.thresholds;
  if (!record(model) || !shape(model, ['name', 'backend', 'engine', 'license']) || !text(model.name, 200) || model.backend !== 'mlx' || model.engine !== 'startlux-decision' || !text(model.license, 200)) return fail('model must identify its name, MLX backend, startlux-decision engine and license.');
  if (!record(scan) || !shape(scan, ['splatCount', 'framesAnalyzed', 'keyframes']) || !integer(scan.splatCount, 1, 10_000_000) || !integer(scan.framesAnalyzed, 1, MAX_SUGGESTION_FRAMES)
    || !Array.isArray(scan.keyframes) || scan.keyframes.length !== scan.framesAnalyzed || !scan.keyframes.every((frame) => text(frame))
    || new Set(scan.keyframes).size !== scan.keyframes.length) return fail(`scan counts/keyframes must agree; at most ${MAX_SUGGESTION_FRAMES} frames.`);
  if (!suggestionCountMatches(asset, scan.splatCount)) return fail('splatCount does not match the loaded scan.');
  if (!numbers(thresholds) || !numbers(value.timing) || !text(value.notice, 2000)) return fail('thresholds/timing must be bounded finite nonnegative numbers and notice must be text.');
  const fitted = value.version === 2 ? calibration(value.calibration) : null;
  if (fitted === false) return fail('invalid calibration provenance or Platt parameters.');
  if (value.version === 2 && (!shape(thresholds, ['suggestion', 'location', 'relevance', 'noneProbability', 'minFrames'])
    || !['suggestion', 'location', 'relevance', 'noneProbability'].every((key) => probability(thresholds[key])) || !integer(thresholds.minFrames, 1, scan.framesAnalyzed))) return fail('invalid v2 thresholds.');
  // Older synthetic fixtures used `probability`; pipeline files use `suggestion`.
  const threshold = value.version === 1 ? thresholds.suggestion ?? thresholds.probability : thresholds.suggestion;
  if (!probability(threshold)) return fail('a suggestion threshold from 0 to 1 is required.');
  if (!Array.isArray(value.items) || value.items.length > MAX_SUGGESTION_ITEMS || (value.version === 2 && value.items.length !== trustedPhotoQuestions.length)) return fail('invalid item count for the photo-question catalog.');
  const itemsV1: ScanSuggestionV1[] = [], itemsV2: ScanSuggestionV2[] = [], ids = new Set<string>();
  let dropped = 0;
  for (const [index, item] of value.items.entries()) {
    const commonKeys = ['checklistItemId', 'concernId', 'question', 'meanProbability', 'framesAboveThreshold', 'bestFrame', 'position', 'thumbnail', 'perFrame'];
    const v1Keys = [...commonKeys, 'maxProbability', 'suggested'];
    const v2Keys = [...commonKeys, 'relevanceQuestion', 'limitation', 'status', 'score', 'relevantFrames', 'viewpoint'];
    if (!record(item) || !(value.version === 2 ? shape(item, v2Keys) : shape(item, v1Keys) || shape(item, [...v1Keys, 'viewpoint']))
      || !text(item.checklistItemId, 100) || !text(item.concernId, 100) || !text(item.question, 1000) || !probability(item.meanProbability)
      || !integer(item.framesAboveThreshold, 0, scan.framesAnalyzed) || !Array.isArray(item.perFrame) || item.perFrame.length !== scan.framesAnalyzed) return fail('an item has invalid fields or frame counts.');
    const trusted = value.version === 2 ? trustedPhotoQuestions[index] : trustedPhotoQuestions.find((q) => q.checklistItemId === item.checklistItemId);
    if ((value.version === 2 && (!trusted || item.checklistItemId !== trusted.checklistItemId || item.concernId !== trusted.concernId || item.relevanceQuestion !== trusted.relevanceQuestion || item.limitation !== trusted.limitation))
      || (trusted && item.question !== trusted.question)) return fail('photo question, limitation or catalog order does not match the trusted catalog.');
    const position = item.position === null ? null : point3(item.position), rawViewpoint = item.viewpoint ?? null;
    const viewpoint = rawViewpoint === null ? null : point3(rawViewpoint);
    if ((item.position !== null && !position) || (rawViewpoint !== null && !viewpoint) || (viewpoint && !position)) return fail('invalid position/viewpoint.');
    const frames: ScanSuggestionV2['perFrame'] = [];
    for (const [frameIndex, row] of item.perFrame.entries()) {
      if (!record(row) || !shape(row, value.version === 2 ? ['frame', 'rawProbability', 'probability', 'relevanceProbability'] : ['frame', 'probability'])
        || row.frame !== scan.keyframes[frameIndex] || !probability(row.probability)) return fail('perFrame must match keyframe order and contain bounded probabilities.');
      const raw = value.version === 2 ? row.rawProbability : row.probability, relevance = value.version === 2 ? row.relevanceProbability : 1;
      if (!probability(raw) || !probability(relevance)) return fail('invalid raw/relevance probability.');
      const param = fitted?.parameters[item.checklistItemId];
      const expected = param ? plattProbability(raw, param.a, param.b) : raw;
      if (value.version === 2 && (fitted ? !close(row.probability, expected) : row.probability !== expected)) return fail('perFrame probability disagrees with raw evidence/calibration.');
      frames.push({ frame: row.frame as string, rawProbability: raw, probability: row.probability, relevanceProbability: relevance });
    }
    const mean = frames.reduce((sum, row) => sum + row.probability, 0) / frames.length;
    if (!close(item.meanProbability, mean)) return fail('meanProbability disagrees with perFrame evidence.');
    const base = { checklistItemId: item.checklistItemId, concernId: item.concernId, question: item.question, meanProbability: item.meanProbability,
      framesAboveThreshold: item.framesAboveThreshold, position, viewpoint };
    let parsed: ScanSuggestion;
    if (value.version === 2) {
      const relevant = frames.filter((row) => row.relevanceProbability >= thresholds.relevance!);
      const best = relevant.reduce<(typeof frames)[number] | null>((current, row) => !current || row.probability > current.probability ? row : current, null);
      const above = relevant.filter((row) => row.probability >= threshold).length;
      const status = above >= thresholds.minFrames! ? 'suggested' : relevant.length === 0 ? 'not-visible' : 'below-threshold';
      if (item.relevantFrames !== relevant.length || item.framesAboveThreshold !== above || item.bestFrame !== (best?.frame ?? null)
        || item.score !== (best?.probability ?? null) || item.status !== status) return fail('v2 summaries disagree with perFrame evidence and thresholds.');
      if (position && (!best || best.probability < thresholds.location!)) return fail('position is not supported by the location threshold.');
      if (status === 'suggested' ? !isSmallJpeg(item.thumbnail) : item.thumbnail !== null) return fail('thumbnail must be a JPEG at most 320 px/128 KiB if and only if suggested.');
      parsed = { ...base, relevanceQuestion: trusted!.relevanceQuestion, limitation: trusted!.limitation, status, score: best?.probability ?? null,
        relevantFrames: relevant.length, bestFrame: best?.frame ?? null, thumbnail: item.thumbnail as string | null, perFrame: frames };
    } else {
      const best = frames.reduce((current, row) => row.probability > current.probability ? row : current);
      const above = frames.filter((row) => row.probability >= threshold).length;
      if (item.maxProbability !== best.probability || item.bestFrame !== best.frame || item.framesAboveThreshold !== above || typeof item.suggested !== 'boolean'
        || (item.suggested && best.probability < threshold) || !legacyThumbnail(item.thumbnail) || (item.thumbnail !== null) !== item.suggested) return fail('v1 summaries/thumbnail disagree with perFrame evidence.');
      parsed = { ...base, maxProbability: best.probability, suggested: item.suggested, bestFrame: best.frame, thumbnail: item.thumbnail,
        perFrame: frames.map(({ frame, probability }) => ({ frame, probability })) };
    }
    const key = JSON.stringify([item.checklistItemId, item.concernId]);
    if (ids.has(key)) return fail('duplicate checklist/concern suggestions are not supported.');
    ids.add(key);
    if (!catalog.get(item.checklistItemId)?.concernIds.has(item.concernId)) {
      if (value.version === 2) return fail('a v2 photo catalog link is unavailable in the current checklist.');
      dropped++; continue;
    }
    if ('status' in parsed) itemsV2.push(parsed); else itemsV1.push(parsed);
  }
  const base: SuggestionsBase = { format: 'fixlist-scan-suggestions', createdAt: value.createdAt,
    model: { name: model.name, backend: 'mlx', engine: 'startlux-decision', license: model.license },
    scan: { splatCount: scan.splatCount, framesAnalyzed: scan.framesAnalyzed, keyframes: [...scan.keyframes] }, notice: value.notice, timing: { ...value.timing } };
  const data: ScanSuggestions = value.version === 2 ? { ...base, version: 2, calibration: fitted, thresholds: { suggestion: threshold, location: thresholds.location!, relevance: thresholds.relevance!, noneProbability: thresholds.noneProbability!, minFrames: thresholds.minFrames! }, items: itemsV2 }
    : { ...base, version: 1, thresholds: { ...thresholds }, items: itemsV1 };
  return { ok: true, value: { dropped, data } };
}
export function parseScanSuggestions(json: string, catalog: SuggestionCatalog, asset: ScanAsset): ReturnType<typeof validateScanSuggestions> {
  if (new Blob([json]).size > MAX_SUGGESTIONS_BYTES) return fail('exceeds the 4 MiB limit.');
  let value: unknown;
  try { value = JSON.parse(json); } catch { return fail('not valid JSON.'); }
  return validateScanSuggestions(value, catalog, asset);
}
export function validateSuggestionLayer(value: unknown, catalog: SuggestionCatalog, asset: ScanAsset): ScanResult<ScanSuggestionLayer> {
  if (!record(value) || !shape(value, ['data', 'dismissed', 'pinned', 'droppedItems']) || !integer(value.droppedItems, 0, MAX_SUGGESTION_ITEMS)) return fail('saved suggestion state is invalid.');
  const result = validateScanSuggestions(value.data, catalog, asset);
  if (!result.ok) return result;
  const ids = new Set(result.value.data.items.map(suggestionId));
  const validIds = (entries: unknown): entries is string[] => Array.isArray(entries) && entries.length <= MAX_SUGGESTION_ITEMS
    && entries.every((entry) => text(entry, 620)) && new Set(entries).size === entries.length;
  if (!validIds(value.dismissed) || !validIds(value.pinned)) return fail('saved dismissed/pinned IDs are invalid.');
  return { ok: true, value: { data: result.value.data, dismissed: value.dismissed.filter((id) => ids.has(id)), pinned: value.pinned.filter((id) => ids.has(id)),
    droppedItems: Math.min(MAX_SUGGESTION_ITEMS, value.droppedItems + result.value.dropped) } };
}
