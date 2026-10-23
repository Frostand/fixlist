import { authored } from './authored';
import { en, type MessageKey } from './en';
import type { Translator } from './index';
/** IDs, rather than English copy, link authored catalog content to translations. */
export function catalogText(t: Translator, kind: 'room' | 'check' | 'action' | 'photo', id: string, field?: 'title' | 'nextStep' | 'question' | 'limitation'): string {
  const key = `catalog.${kind}.${id}${field ? `.${field}` : ''}`;
  return Object.hasOwn(en, key) ? t(key as MessageKey) : t('common.unavailable');
}
/** Volunteer projections intentionally have no action ID. Match only authored public action copy. */
export function projectedCatalogText(t: Translator, text: string): string {
  const entry = Object.entries(en).find(([key, value]) => key.startsWith('catalog.') && value === text);
  return entry ? t(entry[0] as MessageKey) : text.split(', ').map((part) => authored(t, part)).join(', ');
}
