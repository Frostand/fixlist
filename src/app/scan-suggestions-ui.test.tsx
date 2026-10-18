import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { computePlan, createInitialState } from '../domain/workflow';
import { suggestionCatalogFixture as catalog, suggestionLayerFixture as layer, suggestionsV2Fixture } from '../lib/scan-suggestions.fixture';
import { suggestionAnchor, suggestionId } from '../lib/scan-suggestions';
import { ChecklistSection } from './WorkflowSections';
import { ScanSuggestions } from './ScanSuggestions';

describe('accessible suggestion review path with no workflow mutation', () => {
  it('renders a compact checklist link while every answer and confirmation remains untouched', () => {
    const state = createInitialState(demoScenario), before = structuredClone(state), onCommand = vi.fn();
    const suggestions = layer(), item = suggestions.data.items[0]!;
    const html = renderToStaticMarkup(<ChecklistSection scenario={demoScenario} state={state} onCommand={onCommand} scanSuggestions={suggestions} />);
    expect(html).toContain(`href="#${suggestionAnchor(item)}"`);
    expect(html).toContain('AI review suggested · score 0.86');
    expect(html).toContain('0 of 8 answered; 8 unknown');
    expect(html).toContain('Confirmation is enabled only when every backing checklist answer is yes');
    expect(onCommand).not.toHaveBeenCalled();
    expect(state).toEqual(before);
    expect(computePlan(demoScenario, state)).toEqual([]);
    expect(Object.values(state.checklistAnswers).every((answer) => answer === 'unknown')).toBe(true);
    expect(state.requests).toEqual([]);
  });
  it('does not render chips for dismissed suggestions or during scan reset', () => {
    const suggestions = layer(); suggestions.dismissed = [suggestionId(suggestions.data.items[0]!)];
    const props = { scenario: demoScenario, state: createInitialState(demoScenario), onCommand: vi.fn() };
    expect(renderToStaticMarkup(<ChecklistSection {...props} scanSuggestions={suggestions} />)).not.toContain('AI review suggested');
    expect(renderToStaticMarkup(<ChecklistSection {...props} scanSuggestions={layer()} scanResetting />)).not.toContain('AI review suggested');
  });
  it('labels probabilities and thumbnails as model evidence, supplies disabled reasons and uses the canonical question', () => {
    const html = renderToStaticMarkup(<ScanSuggestions layer={layer()} catalog={catalog} viewerReady={false} canAddPin onShow={vi.fn()} onPin={vi.fn()} onDismiss={vi.fn()} />);
    expect(html).toContain('Suggested by a local AI model (StartLux-Decision). Areas to review — not findings. They never answer or confirm the checklist.');
    expect(html).toContain('Experimental model score 0.86 (uncalibrated; not a probability)');
    expect(html).toContain('1 of 2 frames above threshold');
    expect(html).toContain('Frame the local AI model looked at when suggesting review');
    expect(html).toContain(`<h5>${catalog.get('rug-check')!.question}</h5>`);
    expect(html).toContain(catalog.get('rug-check')!.limitation);
    expect(html).toContain('Related checklist question: Does a rug edge obstruct the walking route?');
    expect(html).not.toMatch(/likely|%/i);
    expect(html).not.toContain('Imported model wording');
    expect(html).toContain('Open the viewer and wait for the room to load');
    expect(html).toContain('Show in 3D'); expect(html).toContain('Add as pin'); expect(html).toContain('Dismiss');
  });
  it('puts lower estimates behind a details element and retains a way to restore dismissed items', () => {
    const suggestions = layer(), first = suggestions.data.items[0]!;
    suggestions.data.items.push({ ...first, checklistItemId: 'cord-check', concernId: 'cord-concern', suggested: false });
    suggestions.dismissed = [suggestionId(first)];
    const html = renderToStaticMarkup(<ScanSuggestions layer={suggestions} catalog={catalog} viewerReady canAddPin onShow={vi.fn()} onPin={vi.fn()} onDismiss={vi.fn()} />);
    expect(html).toContain('<details'); expect(html).toContain('Not suggested (1)');
    expect(html).toContain('Show dismissed');
    expect(html).not.toContain(`id="${suggestionAnchor(first)}"`);
  });
  it('surfaces dropped links and missing positions with an explicit reason', () => {
    const suggestions = layer(); suggestions.droppedItems = 2; suggestions.data.items[0]!.position = null;
    const html = renderToStaticMarkup(<ScanSuggestions layer={suggestions} catalog={catalog} viewerReady canAddPin onShow={vi.fn()} onPin={vi.fn()} onDismiss={vi.fn()} />);
    expect(html).toContain('2 model suggestion(s) were dropped');
    expect(html).toContain('No 3D location was provided by the model.');
  });
});

describe('v2 score wording and relevance grouping', () => {
  const render = (data: ReturnType<typeof suggestionsV2Fixture>) => renderToStaticMarkup(<ScanSuggestions layer={{ data, dismissed: [], pinned: [], droppedItems: 0 }} catalog={catalog} viewerReady canAddPin onShow={vi.fn()} onPin={vi.fn()} onDismiss={vi.fn()} />);
  it('renders the trusted photo question and limitation rather than replacing it with the checklist prompt', () => {
    const data = suggestionsV2Fixture(), item = data.items[0]!;
    const html = render(data);
    expect(html).toContain(`<h5>${item.question}</h5>`);
    expect(html).toContain(item.limitation);
    expect(html).toContain('Related checklist question: Does a rug edge obstruct the walking route?');
    expect(html).not.toContain('<h5>Does a rug edge obstruct the walking route?</h5>');
    expect(html).toContain('Experimental model score 0.86 (uncalibrated; not a probability)');
    expect(html).not.toMatch(/likely|%/i);
  });
  it('shows calibration provenance only for a calibrated file, counting the fitting photos', () => {
    const data = suggestionsV2Fixture();
    data.calibration = { method: 'platt', parameters: {}, fittedAt: data.createdAt, labelSource: 'Synthetic test', trainExamples: 42, heldOutExamples: 8, heldOutBrierRaw: 0.2, heldOutBrierCalibrated: 0.1 };
    expect(render(data)).toContain('Model score 0.86 (adjusted on 42 example photos labeled by AI; still experimental, not validated in real homes)');
    expect(render(data)).not.toMatch(/likely|%/i);
  });
  it('groups below-threshold and not-visible items separately and explains relevance gating', () => {
    const data = suggestionsV2Fixture();
    data.items[0]!.status = 'below-threshold'; data.items[0]!.thumbnail = null;
    Object.assign(data.items[1]!, { status: 'not-visible', score: null, position: null, viewpoint: null, thumbnail: null });
    const html = render(data);
    expect(html).toContain('Suggested for review');
    expect(html).toContain('Below threshold (1)');
    expect(html).toContain('Not visible in analyzed frames (1)');
    expect(html).toContain('No analyzed frame met the model’s relevance threshold');
    expect(html).toContain('No model score: no relevant frames');
    expect(html).not.toMatch(/likely|%/i);
  });
  it('does not imply that relevance-gated items were below the score threshold', () => {
    const data = suggestionsV2Fixture(); data.items.forEach((item) => { item.status = 'not-visible'; item.score = null; item.thumbnail = null; });
    const html = render(data);
    expect(html).toContain('no analyzed frame met the relevance threshold');
    expect(html).not.toContain('No active items exceeded');
  });
  it('labels every old non-suggestion with its unknown reason', () => {
    const old = layer(); old.data.items[0]!.suggested = false; old.data.items[0]!.thumbnail = null;
    const html = renderToStaticMarkup(<ScanSuggestions layer={old} catalog={catalog} viewerReady canAddPin onShow={vi.fn()} onPin={vi.fn()} onDismiss={vi.fn()} />);
    expect(html).toContain('Not suggested (older file; reason not recorded)');
    expect(html).toContain('Not suggested (1)');
    expect(html).toContain('This older file does not record why');
    expect(html).not.toContain('Below threshold');
  });
});
