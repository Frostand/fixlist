import type { Language } from '../domain/roles';
import { en, type MessageKey } from './en';
import { es } from './es';
export type Messages = Partial<Record<MessageKey, string>>;
/** English and the existing Spanish locale stay synchronous; additional locales load on demand. */
export const messages: Record<Language, Messages> = { en, es, zh: {}, vi: {}, ko: {}, tl: {}, ru: {}, fr: {}, ar: {} };
const loaders = {
  zh: () => import('./locales/zh.json'), vi: () => import('./locales/vi.json'), ko: () => import('./locales/ko.json'),
  tl: () => import('./locales/tl.json'), ru: () => import('./locales/ru.json'), fr: () => import('./locales/fr.json'), ar: () => import('./locales/ar.json'),
} satisfies Partial<Record<Language, () => Promise<{ default: Messages }>>>;
const loading = new Map<Language, Promise<void>>();
/** Retryable on failure. A pending or failed import continues to use per-key English fallback. */
export function loadLanguageMessages(language: Language): Promise<void> {
  if (!Object.hasOwn(loaders, language)) return Promise.resolve();
  const previous = loading.get(language);
  if (previous) return previous;
  const loader = loaders[language as keyof typeof loaders];
  const pending = loader().then((module) => { // Keep deferred community keys available through English fallback without editing locale source files.
    messages[language] = { ...en, ...module.default }; }).catch((error: unknown) => { loading.delete(language); throw error; });
  loading.set(language, pending);
  return pending;
}
/** Per-key fallback also supports partially translated catalog and authored content. */
export function messageWithFallback(locale: Messages, key: MessageKey): string { return locale[key] || en[key]; }
