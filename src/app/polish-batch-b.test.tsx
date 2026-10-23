import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { demoScenario as scenario } from '../data/demo-scenario';
import { createInitialState } from '../domain/workflow';
import { I18nProvider, translate } from '../i18n';
import { en } from '../i18n/en';
import { createPrintSnapshot } from '../lib/print';
import { scanCameraKey } from '../lib/scan-device';
import { verifiedSceneHash } from '../lib/scan-model';
import { suggestionCatalogFixture as catalog, suggestionDocumentFixture, suggestionsV2Fixture } from '../lib/scan-suggestions.fixture';
import { ScanPanel, ScanSourceNote, SampleApartmentCredit, scanSourceKind, SAMPLE_APARTMENT_SCENE_SHA256 } from './ScanPanel';
import { ScanCameraControls } from './ScanViewer';
import { ScanSuggestions, SuggestionFrameDialog } from './ScanSuggestions';
import { PhoneShell, StartShell } from './PhoneShell';
import { PeopleScreen, GuideScreen } from './PeopleScreens';
import { PrintReport } from './PrintReport';
import type { Route } from './routes';

const noop = () => {}, dispatch = async () => ({ ok: true as const });
function html(node: ReactNode, language: 'en' | 'es' = 'en') { return renderToStaticMarkup(<I18nProvider language={language}>{node}</I18nProvider>); }
function elements(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...elements(node.props.children, type)];
}
function capture(render: () => ReactNode) { let tree: ReactNode; function Probe() { tree = render(); return tree; } html(<Probe />); return tree; }

describe('room-first scan presentation', () => {
  it.each(['en', 'es'] as const)('puts the room stage before collapsed import and scan details in %s', (language) => {
    const rendered = html(<ScanPanel scenario={scenario} state={createInitialState(scenario)} restoreSaved={false} />, language);
    expect(rendered).toContain(translate(language, 'legacy.scanpanel.14'));
    expect(rendered.indexOf('class="scan-stage"')).toBeLessThan(rendered.indexOf('class="scan-import-details'));
    expect(rendered.indexOf('class="scan-stage"')).toBeLessThan(rendered.indexOf('class="scan-details'));
    expect(rendered).toMatch(/<details class="scan-import-details[^>]*><summary>/);
    expect(rendered).toMatch(/<details class="scan-details[^>]*><summary>/);
    expect(rendered).not.toContain('<details open'); expect(rendered).not.toContain('supplied by you');
    const input = rendered.match(/<input[^>]*id="scan-file"[^>]*>/)![0];
    expect(input).toContain('hidden=""'); expect(input).toContain('accept=".splat,.ply,.json"');
  });
  it('uses verified content identity for the public sample, including a restored document, and fails closed for unknown local scans', () => {
    expect(scanSourceKind('imported', SAMPLE_APARTMENT_SCENE_SHA256, 'local')).toBe('sample');
    expect(scanSourceKind('imported', SAMPLE_APARTMENT_SCENE_SHA256, 'saved')).toBe('sample');
    const fixture = suggestionDocumentFixture();
    expect(verifiedSceneHash(fixture.asset.blob)).not.toBe(SAMPLE_APARTMENT_SCENE_SHA256);
    expect(scanSourceKind('imported', verifiedSceneHash(fixture.asset.blob), 'local')).toBe('local');
    expect(scanSourceKind('imported', undefined, 'saved')).toBe('saved');
    expect(scanSourceKind('imported', undefined, 'user')).toBe('imported');
    expect(scanSourceKind('generated', SAMPLE_APARTMENT_SCENE_SHA256, 'user')).toBe('generated');
    expect(html(<ScanSourceNote source="sample" />)).not.toContain('supplied by you');
    expect(html(<ScanSourceNote source="imported" />)).toContain('supplied by you');
  });
  it.each(['en', 'es'] as const)('retains attribution, license links, adaptation notice and not-a-real-home limits in %s', (language) => {
    const rendered = html(<><ScanSourceNote source="sample" /><details><summary>{translate(language, 'scan.details')}</summary><SampleApartmentCredit /></details></>, language);
    expect(rendered).toContain('UE4Arch.com'); expect(rendered).toContain('Wikimedia Commons'); expect(rendered).toContain('58–158');
    expect(rendered).toContain('https://commons.wikimedia.org/wiki/File:UE4Arch.com_-_Viennese_apartment.webm');
    expect(rendered).toContain('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(rendered).toContain(language === 'en' ? 'changes were made' : 'se realizaron cambios');
    expect(rendered).toContain(language === 'en' ? 'Not a real home.' : 'No es un hogar real.');
  });
  it('keeps compact reset/zoom controls, collapsed arrows, callbacks and keyboard command mappings', () => {
    const onMove = vi.fn(), onReset = vi.fn(), onCenter = vi.fn();
    const rendered = html(<ScanCameraControls loaded placing={false} onMove={onMove} onReset={onReset} onCenter={onCenter} />);
    const quick = rendered.slice(rendered.indexOf('class="scan-camera-quick"'), rendered.indexOf('</div>'));
    expect(quick.match(/<button/g)).toHaveLength(3);
    expect(rendered).toMatch(/<details class="scan-view-buttons[^>]*><summary>/);
    expect(rendered).not.toContain('<details open'); expect(rendered).toContain('id="scan-controls-help"');
    const tree = capture(() => ScanCameraControls({ loaded: true, placing: true, onMove, onReset, onCenter }));
    const buttons = elements(tree, 'button');
    for (const [label, direction] of [[en['scan.zoomIn'], 'in'], [en['scan.zoomOut'], 'out'], ['Orbit left', 'left'], ['Orbit right', 'right'], ['Orbit up', 'up'], ['Orbit down', 'down']] as const) {
      (buttons.find((button) => button.props['aria-label'] === label)!.props.onClick as () => void)(); expect(onMove).toHaveBeenLastCalledWith(direction);
    }
    (buttons.find((button) => button.props['aria-label'] === en['legacy.scanviewer.23'])!.props.onClick as () => void)(); expect(onReset).toHaveBeenCalledOnce();
    (buttons.find((button) => button.props.children === en['legacy.scanviewer.24'])!.props.onClick as () => void)(); expect(onCenter).toHaveBeenCalledOnce();
    expect(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', 'Home'].map(scanCameraKey)).toEqual(['left', 'right', 'up', 'down', 'in', 'out', 'reset']);
    const pending = html(<ScanCameraControls loaded={false} placing onMove={onMove} onReset={onReset} onCenter={onCenter} />);
    expect(pending.match(/disabled=""/g)).toHaveLength(8);
  });
});

describe('AI frames, exact questions and provenance', () => {
  it.each(['en', 'es'] as const)('keeps the exact English model question, one notice, a large frame button, score and collapsed provenance in %s', (language) => {
    const data = suggestionsV2Fixture(); data.items = [data.items[0]!]; const before = structuredClone(data);
    const rendered = html(<ScanSuggestions asset={suggestionDocumentFixture().asset} layer={{ data, dismissed: [], pinned: [], droppedItems: 0 }} catalog={catalog} viewerReady canAddPin onShow={noop} onPin={noop} onDismiss={noop} />, language);
    expect(rendered.split(translate(language, 'scan.notice'))).toHaveLength(2);
    expect(rendered).toContain(`<p lang="en">${data.items[0]!.question}</p>`);
    expect(rendered).toContain(translate(language, 'scan.asked'));
    expect(rendered).toContain('class="scan-frame-button secondary"'); expect(rendered).toContain('class="scan-suggestion-frame"');
    expect(rendered).toContain(translate(language, 'scan.experimentalScore', { score: '0.86' }));
    expect(rendered).toMatch(/<details class="scan-method[^>]*><summary>/); expect(rendered).not.toContain('<details open');
    const method = rendered.slice(rendered.indexOf('class="scan-method'), rendered.indexOf('</details>'));
    expect(method).toContain(data.model.name); expect(method).toContain(data.model.license); expect(method).toContain(translate(language, 'scan.localization.unrecorded')); expect(method).toContain('0.86');
    expect(data).toEqual(before);
  });
  it('provides a labelled native full-screen photo dialog, close callback and Escape callback', () => {
    const onClose = vi.fn(), frame = { src: suggestionDocumentFixture().suggestions.data.items[0]!.thumbnail!, alt: 'Synthetic model frame' };
    const tree = capture(() => SuggestionFrameDialog({ frame, onClose }));
    const rendered = html(<SuggestionFrameDialog frame={frame} onClose={onClose} />);
    expect(rendered).toContain('<dialog'); expect(rendered).toContain('aria-labelledby="scan-frame-title"'); expect(rendered).toContain('alt="Synthetic model frame"');
    (elements(tree, 'button')[0]!.props.onClick as () => void)(); expect(onClose).toHaveBeenCalledOnce();
    const preventDefault = vi.fn(); (elements(tree, 'dialog')[0]!.props.onCancel as (event: { preventDefault(): void }) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('demo banner placement without repeated translation notices', () => {
  const state = createInitialState(scenario), person = state.people[0]!;
  it.each(['en', 'es'] as const)('keeps demo disclosures in settings, About and print, with a short setup footnote in %s', (language) => {
    const start = html(<StartShell showDemo title="Language"><p /></StartShell>, language);
    const people = html(<PeopleScreen people={state.people} language={language} dispatch={dispatch} onChoose={noop} />, language);
    const report = html(<PrintReport scenario={scenario} snapshot={createPrintSnapshot(state, '2026-10-22T12:00:00.000Z')} />, language);
    const shell = (screen: 'home' | 'check' | 'more' | 'about') => html(<PhoneShell person={person} route={{ role: 'r', screen } as Route} title={screen} navigate={noop} hasChecklist hasPlan><p /></PhoneShell>, language);
    for (const rendered of [start, shell('more'), shell('about'), report]) expect(rendered.split(translate(language, 'app.demo'))).toHaveLength(2);
    expect(people).toContain(translate(language, 'setup.demo')); expect(people).not.toContain(translate(language, 'app.demo'));
    for (const rendered of [shell('home'), shell('check'), html(<GuideScreen person={person} residentName="Margaret" dispatch={dispatch} onExit={noop} />, language)]) expect(rendered).not.toContain(translate(language, 'app.demo'));
    for (const rendered of [shell('home'), shell('check'), shell('more'), shell('about'), report]) expect(rendered).not.toContain(translate(language, 'app.unreviewed'));
    expect(report).toMatch(/class="demo-banners"/);
  });
});
