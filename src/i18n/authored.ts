import { en, type MessageKey } from './en';
import { es } from './es';
import type { Translator } from './index';
import type { ScanFailureCode } from '../lib/scan-storage';
const translatedValues = new Set<string>(Object.values(es));
const authoredKeys = new Map<string, MessageKey>(Object.entries(en).map(([key, value]) => [value, key as MessageKey]));
const scanStorageFallbackKeys = new Map<string, MessageKey>([
  ['No saved room scan in this browser.', 'scan.storage.empty'],
  ['Saved scan and pins loaded from this browser. Open the viewer to see them.', 'scan.storage.loaded'],
  ['Scan, upright setting, pins and model suggestion choices saved in this browser only.', 'scan.storage.saved'],
  ['Scan changes are in memory only: browser storage could not save them. Reload may restore an older scan or lose these changes.', 'scan.storage.unsaved'],
  ['Saved scan and pins cleared from this browser.', 'scan.storage.cleared'],
  ['The scan was cleared from this view, but browser storage could not be cleared. Reload may restore the previous scan and pins.', 'scan.storage.clearFailed'],
]);
/** Only call for authored catalog/domain copy, never names, notes, updates or visit/area text. */
export function authored(t: Translator, input: string | number): string {
  const text = String(input);
  const key = authoredKeys.get(text);
  if (key) return t(key);
  if (t('check.yes') === en['check.yes']) return text;
  if (text === 'true' || text === 'false') return t(text === 'true' ? 'check.yes' : 'check.no');
  const group = /^(All |At least one of )(\d+) conditions (?:are|is) required\. (.*?)(?: Every child result is retained\.)?$/.exec(text);
  if (group) return t(group[1] === 'All ' ? 'screen.all' : 'screen.any', { count: group[2] }) + authored(t, group[3]!);
  const unknown = /^(.*?) is unknown; expected (.*?)\.$/.exec(text);
  if (unknown) return t('screen.unknown', { fact: authored(t, unknown[1]!), expected: authored(t, unknown[2]!) });
  const leaf = /^(.*?) is (.*?); expected (.*?)\. This condition is (met|not met)\.$/.exec(text);
  if (leaf) return t('screen.actual', { fact: authored(t, leaf[1]!), actual: authored(t, leaf[2]!), expected: authored(t, leaf[3]!), status: t(leaf[4] === 'met' ? 'screen.met' : 'screen.notMet') });
  const expected = /^(equal to |at least |at most )(.*)$/.exec(text);
  if (expected) return t(expected[1] === 'equal to ' ? 'screen.equal' : expected[1] === 'at least ' ? 'screen.least' : 'screen.most') + authored(t, expected[2]!);
  const unit = /^(\d+) (years|USD\/year)$/.exec(text);
  if (unit) return `${unit[1]} ${t(unit[2] === 'years' ? 'screen.years' : 'screen.usd')}`;
  const page = /^Page 2: (.+)$/.exec(text);
  if (page) return t('source.page', { section: authored(t, page[1]!) });
  const order = /catalog \(position (\d+)\)/.exec(text);
  if (order) return t('plan.order', { position: order[1] });
  const selection = /^Selected from (\d+) explicitly.*?; (\d+) authored/.exec(text);
  if (selection) return t('plan.selection', { count: selection[1], evidence: selection[2] });
  if (text.startsWith('Screening is unavailable because')) return t('screen.invalid', { error: t('screen.invalidDetails') });
  return text;
}

/** Scan library text is authored output, not a resident note. Unknown failures have a translated recovery path. */
export function scanMessage(t: Translator, message: string): string {
  const fallbackKey = scanStorageFallbackKeys.get(message);
  if (fallbackKey) return t(fallbackKey);
  if (t('check.yes') === en['check.yes'] || translatedValues.has(message)) return message;
  if (message.startsWith('Saved scan was not opened:')) return t('scan.storage.rejected');
  if (message.includes('dropped')) return t('scan.storage.dropped');
  const localized = authored(t, message);
  return localized !== message || !message ? localized : t('scan.storage.failed');
}

const scanFailureKeys: Record<ScanFailureCode, MessageKey> = {
  SCENE_IDENTITY_MISSING: 'scan.failure.sceneMissing', SCENE_IDENTITY_UNVERIFIED: 'scan.failure.sceneUnverified',
  SCENE_IDENTITY_MISMATCH: 'scan.failure.sceneMismatch', SCAN_COMPLEXITY: 'scan.failure.complexity',
  stale_revision: 'failure.stale_revision', permission_denied: 'failure.permission_denied', storage_capacity: 'failure.storage_capacity',
  storage_unavailable: 'scan.failure.storageUnavailable', invalid_media: 'failure.invalid_media', cancelled: 'failure.cancelled',
  processing_failure: 'failure.processing_failure', invalid_state: 'failure.invalid_state', recovery_required: 'failure.recovery_required',
};
/** Codes, rather than English library strings, select localized scan recovery instructions. */
export function scanFailureMessage(t: Translator, failure: { code?: ScanFailureCode | undefined; message: string }): string {
  return failure.code ? t(scanFailureKeys[failure.code]) : scanMessage(t, failure.message);
}
