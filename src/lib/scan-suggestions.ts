import type { DemoScenario } from '../domain/types';
import { point3, type Point3, type ScanAsset, type ScanResult } from './scan-model';

export const MAX_SUGGESTIONS_BYTES = 4 * 1024 * 1024;
export const MAX_SUGGESTION_ITEMS = 64;
export const MAX_SUGGESTION_FRAMES = 240;
export const MAX_THUMBNAIL_LENGTH = 128 * 1024;
export type SuggestionCatalog = ReadonlyMap<string, { question: string; concernIds: ReadonlySet<string> }>;
export interface ScanSuggestion {
  checklistItemId: string; concernId: string; question: string;
  maxProbability: number; meanProbability: number; framesAboveThreshold: number; suggested: boolean;
  bestFrame: string | null; position: Point3 | null; thumbnail: string | null;
  /** Camera centre of the frame the model looked at, in the same scan-local frame (optional). */
  viewpoint: Point3 | null;
  perFrame: { frame: string; probability: number }[];
}
export interface ScanSuggestions {
  format: 'fixlist-scan-suggestions'; version: 1; createdAt: string;
  model: { name: string; backend: 'mlx'; engine: 'startlux-decision'; license: string };
  scan: { splatCount: number; framesAnalyzed: number; keyframes: string[] };
  thresholds: Record<string, number>; notice: string; items: ScanSuggestion[]; timing: Record<string, number>;
}
export interface ScanSuggestionLayer {
  data: ScanSuggestions; dismissed: string[]; pinned: string[]; droppedItems: number;
}
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
function iso(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const date = new Date(value), calendar = new Date(`${value.slice(0, 19)}Z`);
  return Number.isFinite(date.getTime()) && Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 19) === value.slice(0, 19);
}
function thumbnail(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > MAX_THUMBNAIL_LENGTH) return false;
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || !match[2] || match[2].length % 4 !== 0) return false;
  try {
    const bytes = atob(match[2]);
    return match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff') : bytes.startsWith('\x89PNG\r\n\x1a\n');
  } catch { return false; }
}

export function createSuggestionCatalog(scenario: DemoScenario): SuggestionCatalog {
  return new Map(scenario.checklist.map((item) => [item.id, { question: item.prompt,
    concernIds: new Set(scenario.concerns.filter((concern) => concern.evidenceIds.some((id) => scenario.evidence.some((evidence) => evidence.id === id && evidence.checklistItemId === item.id))).map((concern) => concern.id)),
  }]));
}
export function suggestionId(item: Pick<ScanSuggestion, 'checklistItemId' | 'concernId'>): string {
  return `${encodeURIComponent(item.checklistItemId)}:${encodeURIComponent(item.concernId)}`;
}
export function suggestionAnchor(item: Pick<ScanSuggestion, 'checklistItemId' | 'concernId'>): string { return `scan-suggestion-${suggestionId(item)}`; }
export function suggestionPercent(item: ScanSuggestion): number { return Math.round(item.maxProbability * 100); }
export function visibleSuggestionMarkers(layer: ScanSuggestionLayer | null): ScanSuggestion[] {
  return layer?.data.items.filter((item) => item.suggested && item.position !== null && !layer.dismissed.includes(suggestionId(item)) && !layer.pinned.includes(suggestionId(item))) ?? [];
}
/** Only items the model actually flagged (`suggested`) earn a checklist chip; low estimates stay in the panel list. */
export function suggestionForChecklist(layer: ScanSuggestionLayer | null, checklistItemId: string): ScanSuggestion | undefined {
  return layer?.data.items.filter((item) => item.checklistItemId === checklistItemId && item.suggested && !layer.dismissed.includes(suggestionId(item)))
    .sort((a, b) => b.maxProbability - a.maxProbability)[0];
}
export function suggestionCountMatches(asset: ScanAsset, count: number): boolean {
  if (asset.name.toLowerCase().endsWith('.splat')) return asset.blob.size / 32 === count;
  return asset.metadata === null || asset.metadata.splatCount === count;
}

/** Reconstruct JSON fields, including each nested object. Unknown catalog pairs are dropped only after validation. */
export function validateScanSuggestions(value: unknown, catalog: SuggestionCatalog, asset: ScanAsset): ScanResult<{ data: ScanSuggestions; dropped: number }> {
  if (!record(value) || !shape(value, ['format', 'version', 'createdAt', 'model', 'scan', 'thresholds', 'notice', 'items', 'timing'])
    || value.format !== 'fixlist-scan-suggestions' || value.version !== 1 || !iso(value.createdAt)) return fail('expected exactly the version 1 fields and an ISO createdAt timestamp.');
  const model = value.model, scan = value.scan;
  if (!record(model) || !shape(model, ['name', 'backend', 'engine', 'license']) || !text(model.name, 200) || model.backend !== 'mlx' || model.engine !== 'startlux-decision' || !text(model.license, 200)) return fail('model must identify its name, MLX backend, startlux-decision engine and license.');
  if (!record(scan) || !shape(scan, ['splatCount', 'framesAnalyzed', 'keyframes']) || !integer(scan.splatCount, 1, 10_000_000) || !integer(scan.framesAnalyzed, 1, MAX_SUGGESTION_FRAMES)
    || !Array.isArray(scan.keyframes) || scan.keyframes.length > MAX_SUGGESTION_FRAMES || !scan.keyframes.every((frame) => text(frame))
    || new Set(scan.keyframes).size !== scan.keyframes.length) return fail(`scan counts/keyframes must be bounded; at most ${MAX_SUGGESTION_FRAMES} frames.`);
  if (!suggestionCountMatches(asset, scan.splatCount)) return fail('splatCount does not match the loaded scan.');
  if (!numbers(value.thresholds) || !numbers(value.timing) || !text(value.notice, 2000)) return fail('thresholds/timing must be bounded finite nonnegative numbers and notice must be text.');
  if (!Array.isArray(value.items) || value.items.length > MAX_SUGGESTION_ITEMS) return fail(`items must be a list of at most ${MAX_SUGGESTION_ITEMS}.`);
  const items: ScanSuggestion[] = [], ids = new Set<string>();
  let dropped = 0;
  for (const item of value.items) {
    const itemKeys = ['checklistItemId', 'concernId', 'question', 'maxProbability', 'meanProbability', 'framesAboveThreshold', 'suggested', 'bestFrame', 'position', 'thumbnail', 'perFrame'];
    if (!record(item) || !(shape(item, itemKeys) || shape(item, [...itemKeys, 'viewpoint']))
      || !text(item.checklistItemId, 100) || !text(item.concernId, 100) || !text(item.question, 1000)
      || !probability(item.maxProbability) || !probability(item.meanProbability) || item.meanProbability > item.maxProbability
      || !integer(item.framesAboveThreshold, 0, scan.framesAnalyzed) || typeof item.suggested !== 'boolean'
      || (item.bestFrame !== null && !text(item.bestFrame)) || !thumbnail(item.thumbnail)
      || !Array.isArray(item.perFrame) || item.perFrame.length > MAX_SUGGESTION_FRAMES || item.perFrame.length > scan.framesAnalyzed) return fail('an item has invalid fields, probabilities, counts or thumbnail (JPEG/PNG data URI, at most 128 KiB).');
    const position = item.position === null ? null : point3(item.position);
    if (item.position !== null && position === null) return fail('item positions must be null or finite triples within the scan coordinate limits.');
    const rawViewpoint = item.viewpoint ?? null;
    const viewpoint = rawViewpoint === null ? null : point3(rawViewpoint);
    if ((rawViewpoint !== null && viewpoint === null) || (viewpoint !== null && position === null)) return fail('item viewpoints must be null or finite triples, and only accompany a position.');
    const frames: ScanSuggestion['perFrame'] = [], frameIds = new Set<string>();
    for (const frame of item.perFrame) {
      if (!record(frame) || !shape(frame, ['frame', 'probability']) || !text(frame.frame) || !probability(frame.probability) || frameIds.has(frame.frame)) return fail('perFrame entries require unique frame labels and probabilities from 0 to 1.');
      frames.push({ frame: frame.frame, probability: frame.probability }); frameIds.add(frame.frame);
    }
    if (item.framesAboveThreshold > frames.length || (item.bestFrame !== null && !frameIds.has(item.bestFrame))) return fail('frame counts or bestFrame do not match perFrame evidence.');
    // JSON encoding also handles malformed Unicode in retired IDs without throwing URIError.
    const key = JSON.stringify([item.checklistItemId, item.concernId]);
    if (ids.has(key)) return fail('duplicate checklist/concern suggestions are not supported.');
    ids.add(key);
    if (!catalog.get(item.checklistItemId)?.concernIds.has(item.concernId)) { dropped++; continue; }
    items.push({ checklistItemId: item.checklistItemId, concernId: item.concernId, question: item.question, maxProbability: item.maxProbability,
      meanProbability: item.meanProbability, framesAboveThreshold: item.framesAboveThreshold, suggested: item.suggested,
      bestFrame: item.bestFrame, position, thumbnail: item.thumbnail, viewpoint, perFrame: frames });
  }
  return { ok: true, value: { dropped, data: { format: 'fixlist-scan-suggestions', version: 1, createdAt: value.createdAt,
    model: { name: model.name, backend: 'mlx', engine: 'startlux-decision', license: model.license },
    scan: { splatCount: scan.splatCount, framesAnalyzed: scan.framesAnalyzed, keyframes: [...scan.keyframes] },
    thresholds: { ...value.thresholds }, notice: value.notice, items, timing: { ...value.timing } } } };
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
