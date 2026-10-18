import { createContext } from 'react';
import type { Language } from '../domain/roles';
/** Keep context identity outside the Fast Refresh component module. */
export const LanguageContext = createContext<Language>('en');
