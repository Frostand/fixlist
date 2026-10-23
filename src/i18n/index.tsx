import { useContext, useEffect, useState, type ReactNode } from 'react';
import type { Language } from '../domain/roles';
import type { MessageKey } from './en';
import { reviewed as spanishReviewed } from './es';
import { messages, messageWithFallback, loadLanguageMessages } from './messages';
import { LanguageContext } from './context';
export type { MessageKey };
export { loadLanguageMessages } from './messages';
export type Values = Readonly<Record<string, string | number | undefined>>;
export type Translator = ((key: MessageKey, values?: Values) => string) & { readonly language?: Language };
export interface LanguageOption { code: Language; nativeName: string; locale: string; dir: 'ltr' | 'rtl' }
/** Every selectable language, in display order. UI lists render from this array only. */
export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'en', nativeName: 'English', locale: 'en-US', dir: 'ltr' },
  { code: 'es', nativeName: 'Español', locale: 'es-US', dir: 'ltr' },
  { code: 'zh', nativeName: '中文（简体）', locale: 'zh-Hans', dir: 'ltr' },
  { code: 'vi', nativeName: 'Tiếng Việt', locale: 'vi-VN', dir: 'ltr' },
  { code: 'ko', nativeName: '한국어', locale: 'ko-KR', dir: 'ltr' },
  { code: 'tl', nativeName: 'Tagalog', locale: 'fil-PH', dir: 'ltr' },
  { code: 'ru', nativeName: 'Русский', locale: 'ru-RU', dir: 'ltr' },
  { code: 'fr', nativeName: 'Français', locale: 'fr-FR', dir: 'ltr' },
  { code: 'ar', nativeName: 'العربية', locale: 'ar-u-nu-latn', dir: 'rtl' },
];
export const reviewed: Readonly<Record<Language, boolean>> = { en: true, es: spanishReviewed, zh: false, vi: false, ko: false, tl: false, ru: false, fr: false, ar: false };
export function localeFor(language: Language): string { return LANGUAGES.find((option) => option.code === language)!.locale; }
export function translate(language: Language, key: MessageKey, values: Values = {}): string {
  return messageWithFallback(messages[language], key).replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}
/** DOM update is separate so it can be exercised without a browser framework. */
export function applyDocumentLanguage(language: Language, root: Pick<HTMLElement, 'lang' | 'dir'>): void {
  root.lang = language; root.dir = LANGUAGES.find((option) => option.code === language)!.dir;
}
export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    applyDocumentLanguage(language, document.documentElement);
    let current = true;
    void loadLanguageMessages(language).then(() => { if (current) setVersion((value) => value + 1); }).catch(() => { /* English fallback remains available offline if a locale chunk cannot load. */ });
    return () => { current = false; };
  }, [language]);
  return <LanguageContext.Provider value={{ language, version }}>{children}</LanguageContext.Provider>;
}
export function useT(): Translator {
  const { language } = useContext(LanguageContext);
  return Object.assign((key: MessageKey, values?: Values) => translate(language, key, values), { language });
}
export function useLanguage() { return useContext(LanguageContext).language; }
/** For a class error boundary that cannot use hooks. */
export function Copy({ id }: { id: MessageKey }) { const t = useT(); return <>{t(id)}</>; }
