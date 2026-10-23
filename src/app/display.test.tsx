import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { I18nProvider, LANGUAGES, localeFor } from '../i18n';
import { LocalTime } from './display';
const iso = '2026-10-18T14:05:00Z';
it.each(LANGUAGES.map(({ code }) => code))('formats dates with app language %s and device timezone context', (language) => {
  const expected = new Date(iso).toLocaleString(localeFor(language), { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const html = renderToStaticMarkup(<I18nProvider language={language}><LocalTime iso={iso} /></I18nProvider>);
  expect(html).toContain(`dateTime="${iso}"`); expect(html).toContain(expected);
});
it('preserves unparseable authored text and shows distinct English/Spanish date wording', () => {
  const render = (language: 'en' | 'es', value = iso) => renderToStaticMarkup(<I18nProvider language={language}><LocalTime iso={value} /></I18nProvider>);
  expect(render('es', 'After lunch')).toContain('After lunch');
  expect(render('en')).not.toBe(render('es'));
});
