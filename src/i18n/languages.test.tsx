import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { LANGUAGE_CODES, isLanguage } from '../domain/roles';
import { createInitialState, applyCommand } from '../domain/workflow';
import { run, at } from '../domain/roles-test-helpers';
import { validateState } from '../lib/demo-storage';
import { LanguagePicker } from '../app/PeopleScreens';
import { DemoBanners, Icon } from '../app/PhoneShell';
import { applyDocumentLanguage, I18nProvider, LANGUAGES, localeFor, reviewed, translate, type Translator } from './index';
import { en, type MessageKey } from './en';
import { messages, messageWithFallback, loadLanguageMessages } from './messages';
import { roomSketchCopy } from './room-sketch';
import { catalogText } from './catalog';
import { authored, scanMessage } from './authored';
const tokens = (value: string) => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort();
describe('nine-language runtime and content', () => {
  beforeAll(async () => { await Promise.all(LANGUAGE_CODES.map(loadLanguageMessages)); });
  it('keeps selectable codes in the same order as the domain and maps actual Intl locales', () => {
    expect(LANGUAGES.map(({ code }) => code)).toEqual([...LANGUAGE_CODES]);
    expect(new Set(LANGUAGES.map(({ nativeName }) => nativeName)).size).toBe(9);
    expect(localeFor('tl')).toBe('fil-PH'); expect(localeFor('ar')).toBe('ar-u-nu-latn');
  });
  it.each(LANGUAGE_CODES)('accepts %s in commands and trusted state reconstruction', (language) => {
    expect(isLanguage(language)).toBe(true);
    const initial = createInitialState(demoScenario), state = run(initial, { type: 'set_language', language });
    expect(state.people.find((person) => person.id === 'margaret')?.language).toBe(language);
    expect(validateState(state, demoScenario).ok).toBe(true);
    const created = run(initial, { type: 'create_person', personId: 'demo-language', name: 'Language demo', role: 'family_helper', language });
    expect(validateState(created, demoScenario).ok).toBe(true);
    expect(created.people.find((person) => person.id === 'demo-language')?.language).toBe(language);
  });
  it('rejects unsupported codes even when runtime input bypasses TypeScript', () => {
    const initial = createInitialState(demoScenario);
    for (const language of ['xx', '', null, 'AR']) {
      expect(isLanguage(language)).toBe(false);
      expect(applyCommand(demoScenario, initial, { type: 'set_language', language, actorId: 'margaret', at } as never).ok).toBe(false);
    }
  });
  it.each(LANGUAGE_CODES)('sets html language/direction and Intl formatting for %s', (language) => {
    const root = { lang: '', dir: '' }; applyDocumentLanguage(language, root);
    expect(root).toEqual({ lang: language, dir: language === 'ar' ? 'rtl' : 'ltr' });
    expect(() => new Intl.NumberFormat(localeFor(language)).format(1234)).not.toThrow();
    expect(() => new Intl.DateTimeFormat(localeFor(language)).format(new Date())).not.toThrow();
  });
  it.each(LANGUAGE_CODES)('has complete translations without empty text or placeholder drift in %s, including catalog/native/sketch strings', (language) => {
    expect(Object.keys(messages[language]).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(messages[language])) {
      expect(Object.hasOwn(en, key), key).toBe(true);
      expect(value.trim(), key).not.toBe('');
      expect(tokens(value), key).toEqual(tokens(en[key as MessageKey]));
    }
  });
  it('marks only navigation arrows for RTL mirroring, preserving physical room controls', () => {
    for (const name of ['back', 'arrow', 'chevron']) expect(renderToStaticMarkup(<Icon name={name} />)).toContain('class="directional-icon"');
    for (const name of ['home', 'cube', 'camera', 'flag', 'tick']) expect(renderToStaticMarkup(<Icon name={name} />)).not.toContain('directional-icon');
  });
  it('falls back per key rather than dropping a partially translated locale or catalog', () => {
    const partial = { 'nav.home': '本地首页' };
    expect(messageWithFallback(partial, 'nav.home')).toBe('本地首页');
    expect(messageWithFallback(partial, 'person.written')).toBe(en['person.written']);
    expect(messageWithFallback(partial, 'catalog.check.rug-check')).toBe(en['catalog.check.rug-check']);
    expect(messageWithFallback(partial, 'sketch.approximate')).toBe(en['sketch.approximate']);
    for (const language of LANGUAGE_CODES) {
      const t = (key: MessageKey) => translate(language, key);
      expect(catalogText(t, 'room', 'living-room')).toBe(t('catalog.room.living-room'));
      expect(authored(t, 'Sample living room')).toBe(t('catalog.room.living-room'));
      expect(roomSketchCopy(language).approximate).toBe(t('sketch.approximate'));
      expect(scanMessage(t, t('legacy.scanpanel.6'))).toBe(t('legacy.scanpanel.6'));
      expect(scanMessage(t, en['legacy.scanpanel.6'])).toBe(t('legacy.scanpanel.6'));
      for (const key of Object.keys(en) as MessageKey[]) if (!messages[language][key]) expect(translate(language, key)).toBe(en[key]);
    }
  });
  it('translates authored explanations per key when the Yes label still falls back to English', () => {
    const partial: Translator = (key, values) => key === 'screen.all' ? `全部 ${values?.count} 项。` : translate('en', key, values);
    expect(partial('check.yes')).toBe(en['check.yes']);
    expect(authored(partial, 'All 4 conditions are required. Every condition is met.')).toBe('全部 4 项。Every condition is met.');
  });
  it.each(LANGUAGE_CODES)('shows all choices and one AI note on the %s picker, with no translation banner elsewhere', (language) => {
    const html = renderToStaticMarkup(<I18nProvider language={language}><LanguagePicker current={language} onSelect={() => {}} /></I18nProvider>);
    for (const { code, nativeName, dir } of LANGUAGES) { expect(html).toContain(`lang="${code}" dir="${dir}"`); expect(html).toContain(nativeName); }
    expect(html.split(translate(language, 'app.unreviewed'))).toHaveLength(2);
    const banner = renderToStaticMarkup(<I18nProvider language={language}><DemoBanners /></I18nProvider>);
    expect(banner).not.toContain(translate(language, 'app.unreviewed'));
    expect(reviewed[language]).toBe(language === 'en');
  });
});
