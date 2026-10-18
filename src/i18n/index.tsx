import { useContext, type ReactNode } from 'react';
import type { Language } from '../domain/roles';
import { en, type MessageKey } from './en';
import { es, reviewed } from './es';
import { LanguageContext } from './context';
export { reviewed };
export type { MessageKey };
export type Values = Readonly<Record<string, string | number | undefined>>;
export type Translator = (key: MessageKey, values?: Values) => string;
export function translate(language: Language, key: MessageKey, values: Values = {}): string {
  return (language === 'es' ? es[key] : en[key]).replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}
export function useT(): Translator {
  const language = useContext(LanguageContext);
  return (key, values) => translate(language, key, values);
}
export function useLanguage() { return useContext(LanguageContext); }
/** For a class error boundary that cannot use hooks. */
export function Copy({ id }: { id: MessageKey }) { const t = useT(); return <>{t(id)}</>; }
