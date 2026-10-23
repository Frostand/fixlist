import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { I18nProvider, translate } from '../i18n';
import type { Language } from '../domain/roles';
import { suggestionDocumentFixture } from '../lib/scan-suggestions.fixture';
import { LanguagePicker } from './PeopleScreens';
import { SuggestionFrameDialog } from './ScanSuggestions';

function html(node: ReactNode, language: Language = 'en') { return renderToStaticMarkup(<I18nProvider language={language}>{node}</I18nProvider>); }
const buttons = (rendered: string) => rendered.match(/<button\b[\s\S]*?<\/button>/g) ?? [];

describe('language picker', () => {
  it('marks the default English row on first launch', () => {
    const [english, spanish] = buttons(html(<LanguagePicker onSelect={() => {}} />));
    expect(english).toContain('class="language-row"'); expect(spanish).toContain('class="language-row"');
    expect(english).toContain('aria-pressed="true"'); expect(spanish).toContain('aria-pressed="false"');
  });
  it.each(['en', 'es'] as const)('highlights and marks the active language (%s) in settings', (current) => {
    const [english, spanish] = buttons(html(<LanguagePicker current={current} onSelect={() => {}} />, current));
    const [active, inactive] = current === 'en' ? [english!, spanish!] : [spanish!, english!];
    expect(active).toContain('aria-pressed="true"'); expect(active).not.toContain('secondary');
    expect(inactive).toContain('aria-pressed="false"'); expect(inactive).toContain('class="language-row"');
  });
});

describe('model photo dialog', () => {
  it.each(['en', 'es'] as const)('uses a plain Close label and repeats the question with its limits in %s', (language) => {
    const frame = { src: suggestionDocumentFixture().suggestions.data.items[0]!.thumbnail!, alt: 'Synthetic model frame', caption: 'Is a cable visible across the path?' };
    const rendered = html(<SuggestionFrameDialog frame={frame} onClose={() => {}} />, language);
    expect(rendered).toContain(`>${translate(language, 'scan.frameClose')}</button>`);
    expect(rendered).not.toContain(translate(language, 'common.close'));
    expect(rendered).toContain(`${translate(language, 'scan.frameAsked')} Is a cable visible across the path?`);
    expect(rendered).toContain(translate(language, 'scan.frameNote'));
  });
  it('omits the question line when no caption is given', () => {
    const rendered = html(<SuggestionFrameDialog frame={{ src: 'data:image/png;base64,AA==', alt: 'x' }} onClose={() => {}} />);
    expect(rendered).not.toContain('scan-frame-caption');
  });
});

describe('iOS keyboard handling', () => {
  // The native shell reports the keyboard height; the CSS must use it and hide the tab bar while typing.
  const css = readFileSync(new URL('../styles/phone.css', import.meta.url), 'utf8');
  it('shrinks the app shell by the reported keyboard inset and hides the tab bar', () => {
    expect(css).toMatch(/\.keyboard-open \.phone-app \{ height: calc\(100dvh - var\(--keyboard-inset, 0px\)\); \}/);
    expect(css).toMatch(/\.keyboard-open \.tab-bar \{ display: none; \}/);
  });
  it('keeps the 3D viewer from being text-selected by a long press', () => {
    expect(css).toMatch(/\.scan-canvas-host canvas[^{]*\{[^}]*user-select: none;[^}]*-webkit-touch-callout: none;/);
  });
});
