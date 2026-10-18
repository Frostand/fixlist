import { isSmallScanImage } from './scan-image';
import { validateSuggestionLayer, type ScanSuggestionLayer, type SuggestionCatalog } from './scan-suggestions';

/** Local-only scan contracts. These never enter the workflow state or its storage key. */
export type Point3 = [number, number, number];
export const MAX_SCAN_BYTES = 64 * 1024 * 1024;
export const MAX_METADATA_BYTES = 64 * 1024;
export const MAX_SCAN_PINS = 200;
export const MAX_SPLATS = 1_500_000;
export const SCAN_EXTENSIONS = ['splat', 'ply', 'spz', 'ksplat'] as const;
export type ScanExtension = (typeof SCAN_EXTENSIONS)[number];

export interface ScanMetadata {
  format: 'fixlist-scan-metadata';
  version: 1;
  splatFile: string;
  splatCount: number;
  coordinateSystem: 'y-up-right-handed';
  units: 'arbitrary';
  bounds: { min: Point3; max: Point3 };
  initialCamera: { position: Point3; target: Point3 };
  source: { inputFrames: number; registeredFrames: number; createdAt: string; pipeline: string; trainingSteps: number };
}
export interface ScanPin { id: string; concernId: string; position: Point3; createdAt: string; origin?: 'family' | 'ai-suggestion'; image?: string | null }
export interface ScanAsset { name: string; blob: Blob; metadata: ScanMetadata | null; kind: 'imported' | 'generated' }
interface ScanDocumentBase { asset: ScanAsset; flipUpright: boolean; pins: ScanPin[] }
/** The legacy shape remains accepted at the old API boundary; the app always uses v2. */
export interface ScanDocumentV1 extends ScanDocumentBase { version: 1 }
export interface ScanDocumentV2 extends ScanDocumentBase { version: 2; suggestions: ScanSuggestionLayer | null }
export type ScanDocument = ScanDocumentV1 | ScanDocumentV2;
export function upgradeScanDocument(document: ScanDocument): ScanDocumentV2 {
  return document.version === 1 ? { ...document, version: 2, suggestions: null } : document;
}
export type ScanErrorCode = 'SCENE_IDENTITY_MISSING' | 'SCENE_IDENTITY_UNVERIFIED' | 'SCENE_IDENTITY_MISMATCH' | 'SCAN_COMPLEXITY';
export type ScanResult<T> = { ok: true; value: T } | { ok: false; error: string; code?: ScanErrorCode };
const fail = (error: string, code?: ScanErrorCode): { ok: false; error: string; code?: ScanErrorCode } => ({ ok: false, error, ...(code ? { code } : {}) });

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function shape(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 32) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function metadataTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const date = new Date(value);
  // Check calendar/time components separately: Date otherwise normalizes February 30.
  const local = value.slice(0, 19), calendar = new Date(`${local}Z`);
  return Number.isFinite(date.getTime()) && Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 19) === local;
}
export function point3(value: unknown): Point3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z]: unknown[] = value;
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
    && typeof z === 'number' && Number.isFinite(z) && Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 1e8
    ? [x, y, z] : null;
}
export function scanExtension(name: string): ScanExtension | null {
  const extension = name.split('.').at(-1)?.toLowerCase();
  return SCAN_EXTENSIONS.find((candidate) => candidate === extension) ?? null;
}
function fileName(value: unknown): value is string {
  return text(value, 255) && !/[\\/]/.test(value) && scanExtension(value) !== null;
}

export function validateScanMetadata(value: unknown): ScanResult<ScanMetadata> {
  if (!record(value) || !shape(value, ['format', 'version', 'splatFile', 'splatCount', 'coordinateSystem', 'units', 'bounds', 'initialCamera', 'source'])) return fail('scene.json must contain exactly the version 1 metadata fields.');
  if (value.format !== 'fixlist-scan-metadata' || value.version !== 1) return fail('scene.json must use fixlist-scan-metadata version 1.');
  if (!fileName(value.splatFile)) return fail('scene.json splatFile must be a local .splat, .ply, .spz or .ksplat filename.');
  if (!integer(value.splatCount, 1, MAX_SPLATS)) return fail(`scene.json splatCount must be an integer from 1 to ${MAX_SPLATS}.`);
  if (value.coordinateSystem !== 'y-up-right-handed' || value.units !== 'arbitrary') return fail('scene.json must declare y-up-right-handed coordinates and arbitrary units.');
  if (!record(value.bounds) || !shape(value.bounds, ['min', 'max'])) return fail('scene.json bounds must have min and max vectors.');
  const min = point3(value.bounds.min), max = point3(value.bounds.max);
  if (!min || !max || min.some((n, i) => n > (max[i] ?? -Infinity)) || min.every((n, i) => n === max[i])) return fail('scene.json bounds must be ordered, nonempty vectors of three finite coordinates (absolute value ≤ 100 million).');
  if (!record(value.initialCamera) || !shape(value.initialCamera, ['position', 'target'])) return fail('scene.json initialCamera must have position and target vectors.');
  const position = point3(value.initialCamera.position), target = point3(value.initialCamera.target);
  if (!position || !target || position.every((n, i) => n === target[i])) return fail('scene.json camera requires distinct position and target vectors of three finite coordinates (absolute value ≤ 100 million).');
  const source = value.source;
  if (!record(source) || !shape(source, ['inputFrames', 'registeredFrames', 'createdAt', 'pipeline', 'trainingSteps'])) return fail('scene.json source fields are incomplete or unsupported.');
  if (!integer(source.inputFrames, 1) || !integer(source.registeredFrames, 1) || source.registeredFrames > source.inputFrames || !integer(source.trainingSteps)) return fail('scene.json source requires positive frame counts, registeredFrames ≤ inputFrames, and nonnegative integer trainingSteps.');
  if (!metadataTimestamp(source.createdAt) || !text(source.pipeline, 200)) return fail('scene.json source requires an ISO createdAt timestamp with timezone and a pipeline label of 1–200 characters.');
  return { ok: true, value: {
    format: 'fixlist-scan-metadata', version: 1, splatFile: value.splatFile, splatCount: value.splatCount,
    coordinateSystem: 'y-up-right-handed', units: 'arbitrary', bounds: { min, max }, initialCamera: { position, target },
    source: { inputFrames: source.inputFrames, registeredFrames: source.registeredFrames, createdAt: source.createdAt, pipeline: source.pipeline, trainingSteps: source.trainingSteps },
  } };
}
export function parseScanMetadata(json: string): ScanResult<ScanMetadata> {
  if (new Blob([json]).size > MAX_METADATA_BYTES) return fail('scene.json exceeds the 64 KiB metadata limit.');
  let value: unknown;
  try { value = JSON.parse(json); } catch { return fail('scene.json is not valid JSON.'); }
  return validateScanMetadata(value);
}

export function validateScanPins(value: unknown, concernIds: ReadonlySet<string>): ScanResult<{ pins: ScanPin[]; dropped: number }> {
  if (!Array.isArray(value) || value.length > MAX_SCAN_PINS) return fail(`Saved pins must be a list of at most ${MAX_SCAN_PINS} pins.`);
  const pins: ScanPin[] = [], ids = new Set<string>();
  let dropped = 0;
  for (const entry of value) {
    if (!record(entry) || !shape(entry, ['id', 'concernId', 'position', 'createdAt', ...('origin' in entry ? ['origin'] : []), ...('image' in entry ? ['image'] : [])]) || !text(entry.id, 100) || !text(entry.concernId, 100) || !timestamp(entry.createdAt)) return fail('A saved pin has invalid fields, IDs or creation time.');
    if (('origin' in entry && entry.origin !== 'family' && entry.origin !== 'ai-suggestion') || ('image' in entry && entry.image !== null && !isSmallScanImage(entry.image))) return fail('A saved pin has an invalid image or origin.');
    const position = point3(entry.position);
    if (!position || ids.has(entry.id)) return fail('Saved pin coordinates must be three finite values (absolute value ≤ 100 million) and pin IDs must be unique.');
    ids.add(entry.id);
    if (!concernIds.has(entry.concernId)) { dropped++; continue; }
    pins.push({ id: entry.id, concernId: entry.concernId, position, createdAt: entry.createdAt,
      ...('origin' in entry ? { origin: entry.origin as 'family' | 'ai-suggestion' } : {}), ...('image' in entry ? { image: entry.image as string | null } : {}) });
  }
  return { ok: true, value: { pins, dropped } };
}

export function validateScanAsset(value: unknown): ScanResult<ScanAsset> {
  if (!record(value) || !shape(value, ['name', 'blob', 'metadata', 'kind']) || !fileName(value.name) || !(value.blob instanceof Blob) || (value.kind !== 'imported' && value.kind !== 'generated')) return fail('Scan must have a supported local filename, file bytes and a known source kind.');
  if (value.blob.size === 0) return fail('Scan file must be nonempty and no larger than 64 MiB.');
  if (value.blob.size > MAX_SCAN_BYTES) return fail('Scan file must be nonempty and no larger than 64 MiB.', 'SCAN_COMPLEXITY');
  if (scanExtension(value.name) === 'splat' && value.blob.size % 32 !== 0) return fail('A .splat file must contain whole 32-byte splat records.');
  if (scanExtension(value.name) === 'splat' && value.blob.size / 32 > MAX_SPLATS) return fail(`Scan exceeds the ${MAX_SPLATS} splat complexity limit.`, 'SCAN_COMPLEXITY');
  let metadata: ScanMetadata | null = null;
  if (value.metadata !== null) {
    const parsed = validateScanMetadata(value.metadata);
    if (!parsed.ok) return parsed;
    metadata = parsed.value;
    if (metadata.splatFile !== value.name) return fail('scene.json splatFile does not match the selected scan filename.');
    if (scanExtension(value.name) === 'splat' && metadata.splatCount !== value.blob.size / 32) return fail('scene.json splatCount does not match the .splat file length.');
  }
  if (value.kind !== 'imported' && value.kind !== 'generated') return fail('Scan source kind is invalid.');
  return { ok: true, value: { name: value.name, blob: value.blob, metadata, kind: value.kind } };
}

export function validateScanDocument(value: unknown, concernIds: ReadonlySet<string>, catalog?: SuggestionCatalog): ScanResult<{ document: ScanDocument; dropped: number }> {
  if (!record(value) || (value.version !== 1 && value.version !== 2)
    || !shape(value, value.version === 1 ? ['version', 'asset', 'flipUpright', 'pins'] : ['version', 'asset', 'flipUpright', 'pins', 'suggestions'])
    || typeof value.flipUpright !== 'boolean') return fail('Saved scan has an unsupported schema; import it again or reset the demo.');
  const asset = validateScanAsset(value.asset);
  if (!asset.ok) return asset;
  const pins = validateScanPins(value.pins, concernIds);
  if (!pins.ok) return pins;
  const legacy: ScanDocumentV1 = { version: 1, asset: asset.value, flipUpright: value.flipUpright, pins: pins.value.pins };
  if (value.version === 1) return { ok: true, value: { document: catalog ? upgradeScanDocument(legacy) : legacy, dropped: pins.value.dropped } };
  let suggestions: ScanSuggestionLayer | null = null;
  if (value.suggestions !== null) {
    if (!catalog) return fail('Saved model suggestions need the current checklist catalog to be validated.');
    const result = validateSuggestionLayer(value.suggestions, catalog, asset.value);
    if (!result.ok) return result;
    suggestions = result.value;
  }
  return { ok: true, value: { document: { ...legacy, version: 2, suggestions }, dropped: pins.value.dropped } };
}

/** Hydration entry point: hash actual persisted bytes before allowing suggestions. */
export async function validateScanDocumentAsync(value: unknown, concernIds: ReadonlySet<string>, catalog?: SuggestionCatalog): Promise<ReturnType<typeof validateScanDocument>> {
  if (record(value)) {
    const asset = validateScanAsset(value.asset);
    if (!asset.ok) return asset;
    const prepared = await prepareScanAsset(asset.value);
    if (!prepared.ok) return prepared;
  }
  return validateScanDocument(value, concernIds, catalog);
}

/** Validate selection before reading the large binary. Unknown JSON is reconstructed above. */
export async function importScanFiles(files: readonly File[]): Promise<ScanResult<ScanAsset>> {
  if (files.length < 1 || files.length > 2) return fail('Choose one scan file, plus an optional scene.json, together.');
  const scanFiles = files.filter((file) => scanExtension(file.name) !== null);
  const metadataFiles = files.filter((file) => file.name.toLowerCase() === 'scene.json');
  if (scanFiles.length !== 1 || scanFiles.length + metadataFiles.length !== files.length) return fail('Choose one .splat, .ply, .spz or .ksplat file and, optionally, one scene.json. Other files are not supported.');
  const file = scanFiles[0];
  if (!file) return fail('No scan file was selected.');
  const metadataFile = metadataFiles[0];
  let metadata: ScanMetadata | null = null;
  if (metadataFile) {
    if (metadataFile.size > MAX_METADATA_BYTES) return fail('scene.json exceeds the 64 KiB metadata limit.');
    let json: string;
    try { json = await metadataFile.text(); } catch { return fail('scene.json could not be read. Select the local file again.'); }
    const parsed = parseScanMetadata(json);
    if (!parsed.ok) return parsed;
    metadata = parsed.value;
  }
  const result = validateScanAsset({ name: file.name, blob: file, metadata, kind: 'imported' });
  if (!result.ok) return result;
  const checked = await prepareScanAsset(result.value);
  return checked.ok ? result : checked;
}

// Blob bytes are immutable. This cache is deliberately not serialized: a saved
// hash supplied by JSON must never stand in for hashing the actual selected bytes.
const verifiedSceneHashes = new WeakMap<Blob, string>();
export function verifiedSceneHash(blob: Blob): string | undefined { return verifiedSceneHashes.get(blob); }

/** Run after IndexedDB hydration, before synchronous document validation/display. */
export async function prepareScanAsset(asset: ScanAsset): Promise<ScanResult<string>> {
  const valid = validateScanAsset(asset);
  if (!valid.ok) return valid;
  const complexity = await preflightScanComplexity(asset);
  if (!complexity.ok) return complexity;
  const cached = verifiedSceneHashes.get(asset.blob);
  if (cached) return { ok: true, value: cached };
  try {
    const bytes = await asset.blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    verifiedSceneHashes.set(asset.blob, hash);
    return { ok: true, value: hash };
  } catch { return fail('Scan bytes could not be hashed. Select the local file again.'); }
}

/** Header/length gates run before Spark decoding or a full byte allocation. */
export async function preflightScanComplexity(asset: ScanAsset): Promise<ScanResult<number>> {
  const reject = (error: string): ScanResult<number> => ({ ok: false, code: 'SCAN_COMPLEXITY', error });
  const ext = scanExtension(asset.name);
  if (ext === 'splat') {
    const count = asset.blob.size / 32;
    return Number.isInteger(count) && count >= 1 && count <= MAX_SPLATS ? { ok: true, value: count } : reject('Invalid or over-limit .splat record count.');
  }
  try {
    const bytes = new Uint8Array(await asset.blob.slice(0, 64 * 1024).arrayBuffer());
    if (ext === 'ply') {
      const header = new TextDecoder().decode(bytes), end = /(?:^|\n)end_header\r?\n/.exec(header);
      if (!header.startsWith('ply\n') && !header.startsWith('ply\r\n')) return reject('Invalid PLY header.');
      if (!end) return reject('PLY header exceeds 64 KiB or is incomplete.');
      const declaration = header.slice(0, end.index);
      const lines = declaration.split(/\r?\n/);
      if (!lines.every((line, i) => i === 0 ? line === 'ply' : /^(?:format (?:ascii|binary_little_endian) 1\.0|element vertex \d+|property \w+ \w+|comment(?: .*)?|obj_info(?: .*)?)$/.test(line))
        || lines.filter((line) => line.startsWith('format ')).length !== 1) return reject('Unsupported PLY header declaration.');
      if (!/^format (?:ascii|binary_little_endian) 1\.0\r?$/m.test(declaration)
        || /^property list\b/m.test(declaration) || [...declaration.matchAll(/^element /gm)].length !== 1) return reject('Only bounded scalar-vertex PLY files are supported. Export compressed/list PLY as .splat.');
      const properties = [...declaration.matchAll(/^property (\w+) (\w+)\r?$/gm)];
      const widths: Record<string, number> = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
      if (properties.length < 3 || properties.length > 64 || properties.some((p) => !widths[p[1]!])
        || !['x', 'y', 'z'].every((name) => properties.some((p) => p[2] === name))
        || new Set(properties.map((p) => p[2])).size !== properties.length) return reject('Invalid or over-complex PLY scalar properties.');
      const counts = [...declaration.matchAll(/^element vertex (\d+)\r?$/gm)];
      const count = counts.length === 1 ? Number(counts[0]![1]) : 0;
      if (!Number.isSafeInteger(count) || count < 1 || count > MAX_SPLATS) return reject('PLY vertex count exceeds the scan complexity limit or is invalid.');
      if (/^format binary_little_endian /m.test(declaration)
        && asset.blob.size < end.index + end[0].length + count * properties.reduce((sum, p) => sum + widths[p[1]!]!, 0)) return reject('PLY body is shorter than its declared vertex data.');
      if (asset.metadata && asset.metadata.splatCount !== count) return reject('PLY vertex count disagrees with scene.json.');
      return { ok: true, value: count };
    }
    // Compressed formats cannot be safely budgeted by compressed byte size.
    // Until bounded header/decompression support exists, fail before decoding.
    return reject('Compressed .spz/.ksplat imports require bounded decompression support. Export a .splat or PLY file.');
  } catch { return reject('Scan header could not be read.'); }
}
