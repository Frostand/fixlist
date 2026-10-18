import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { createInitialState } from '../domain/workflow';
import { I18nProvider, translate } from '../i18n';
import { scanFailureMessage } from '../i18n/authored';
import { prepareScanAsset } from '../lib/scan-model';
import { suggestionCatalogFixture as catalog, suggestionDocumentFixture, suggestionsV2Fixture } from '../lib/scan-suggestions.fixture';
import { ScanPanel } from './ScanPanel';
import { ScanSuggestions } from './ScanSuggestions';
import { ResetConfirmation } from './SettingsScreens';

describe('scan integration disclosures and display boundary', () => {
  it.each(['en', 'es'] as const)('maps typed scene/storage failures in %s without publishing raw library text', (language) => {
    const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
    for (const code of ['SCENE_IDENTITY_MISSING', 'SCENE_IDENTITY_UNVERIFIED', 'SCENE_IDENTITY_MISMATCH', 'SCAN_COMPLEXITY', 'storage_unavailable', 'storage_capacity', 'stale_revision', 'permission_denied', 'invalid_media', 'cancelled', 'processing_failure', 'invalid_state', 'recovery_required'] as const) {
      const message = scanFailureMessage(t, { code, message: 'Raw implementation detail' });
      expect(message).not.toContain('Raw implementation detail'); expect(message.length).toBeGreaterThan(20);
      if (language === 'es') expect(message).not.toBe(scanFailureMessage((key) => translate('en', key), { code, message: '' }));
    }
    expect(scanFailureMessage(t, { code: 'SCENE_IDENTITY_MISSING', message: '' })).toContain('scan/bind_scene_identity.py');
  });
  it.each(['en', 'es'] as const)('renders enforced import limits and reset scope in %s', (language) => {
    const render = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider language={language}>{node}</I18nProvider>);
    const html = render(<ScanPanel scenario={demoScenario} state={createInitialState(demoScenario)} restoreSaved={false} />);
    expect(html).toContain('64 MiB'); expect(html).toMatch(/1[.,]5/); expect(html).not.toContain('300 MiB');
    expect(html).toContain('accept=".splat,.ply,.json"');
    expect(html).toContain(translate(language, 'legacy.scanpanel.18'));
    const reset = render(<ResetConfirmation onReset={vi.fn()} onCancel={vi.fn()} />);
    expect(reset).toContain(translate(language, 'more.resetBody'));
    expect(reset).toContain(translate(language, 'scan.bundledReset'));
  });
  it('refuses an assembled equal-count wrong-scene layer for display', async () => {
    const document = suggestionDocumentFixture(), asset = { ...document.asset, blob: new Blob([new Uint8Array(32).fill(1)]) };
    expect((await prepareScanAsset(asset)).ok).toBe(true);
    const html = renderToStaticMarkup(<ScanSuggestions asset={asset} layer={document.suggestions} catalog={catalog} viewerReady canAddPin onShow={vi.fn()} onPin={vi.fn()} onDismiss={vi.fn()} />);
    expect(html).toContain('role="alert"'); expect(html).toContain(translate('en', 'scan.failure.sceneMismatch'));
    expect(html).not.toContain('Suggested for review'); expect(html).not.toContain(document.suggestions.data.items[0]!.thumbnail!);
  });
  it.each(['en', 'es'] as const)('labels approximate placements and keeps photo-only suggestions out of 3D in %s', (language) => {
    const data = suggestionsV2Fixture(); data.items = [data.items[0]!];
    const item = data.items[0]!;
    item.localization = { method: 'grid-sparse-depth', status: 'approximate', reason: 'coarse-grid-depth-proxy', support: 3, maxAngleDegrees: 1, relativeDepthSpread: 0.1 };
    const render = () => renderToStaticMarkup(<I18nProvider language={language}><ScanSuggestions asset={suggestionDocumentFixture().asset} layer={{ data, dismissed: [], pinned: [], droppedItems: 0 }} catalog={catalog} viewerReady canAddPin onShow={vi.fn()} onPin={vi.fn()} onDismiss={vi.fn()} /></I18nProvider>);
    expect(render()).toContain(translate(language, 'scan.localization.approximate'));
    expect(render()).toContain(translate(language, 'scan.localization.reason.coarse-grid-depth-proxy'));
    item.position = null; item.localization = { ...item.localization, status: 'photo-only', reason: 'insufficient-support', support: 0, maxAngleDegrees: null, relativeDepthSpread: null };
    const html = render();
    expect(html).toContain(translate(language, 'scan.localization.photo-only'));
    expect(html).toContain(translate(language, 'scan.localization.reason.insufficient-support'));
    expect(html).not.toContain(translate(language, 'legacy.scansuggestions.19')); expect(html).not.toContain(translate(language, 'legacy.scansuggestions.22'));
  });
});
