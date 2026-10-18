import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { computePlan, createInitialState } from '../domain/workflow';
import { suggestionCatalogFixture as catalog, suggestionLayerFixture as layer } from '../lib/scan-suggestions.fixture';
import { suggestionAnchor, suggestionId } from '../lib/scan-suggestions';
import { ChecklistSection } from './WorkflowSections';
import { ScanSuggestions } from './ScanSuggestions';

describe('accessible suggestion review path with no workflow mutation', () => {
  it('renders a compact checklist link while every answer and confirmation remains untouched', () => {
    const state = createInitialState(demoScenario), before = structuredClone(state), onCommand = vi.fn();
    const suggestions = layer(), item = suggestions.data.items[0]!;
    const html = renderToStaticMarkup(<ChecklistSection scenario={demoScenario} state={state} onCommand={onCommand} scanSuggestions={suggestions} />);
    expect(html).toContain(`href="#${suggestionAnchor(item)}"`);
    expect(html).toContain('AI suggests reviewing · 86%');
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
    expect(renderToStaticMarkup(<ChecklistSection {...props} scanSuggestions={suggestions} />)).not.toContain('AI suggests reviewing');
    expect(renderToStaticMarkup(<ChecklistSection {...props} scanSuggestions={layer()} scanResetting />)).not.toContain('AI suggests reviewing');
  });
  it('labels probabilities and thumbnails as model evidence, supplies disabled reasons and uses the canonical question', () => {
    const html = renderToStaticMarkup(<ScanSuggestions layer={layer()} catalog={catalog} viewerReady={false} canAddPin onShow={vi.fn()} onPin={vi.fn()} onDismiss={vi.fn()} />);
    expect(html).toContain('Suggested by a local AI model (StartLux-Decision). Areas to review — not findings. They never answer or confirm the checklist.');
    expect(html).toContain('Model estimate: 86% likely');
    expect(html).toContain('1 of 2 frames above threshold');
    expect(html).toContain('Frame the local AI model looked at when suggesting review');
    expect(html).toContain('Does a rug edge obstruct the walking route?');
    expect(html).not.toContain('Imported model wording');
    expect(html).toContain('Open the viewer and wait for the room to load');
    expect(html).toContain('Show in 3D'); expect(html).toContain('Add as pin'); expect(html).toContain('Dismiss');
  });
  it('puts lower estimates behind a details element and retains a way to restore dismissed items', () => {
    const suggestions = layer(), first = suggestions.data.items[0]!;
    suggestions.data.items.push({ ...first, checklistItemId: 'cord-check', concernId: 'cord-concern', suggested: false });
    suggestions.dismissed = [suggestionId(first)];
    const html = renderToStaticMarkup(<ScanSuggestions layer={suggestions} catalog={catalog} viewerReady canAddPin onShow={vi.fn()} onPin={vi.fn()} onDismiss={vi.fn()} />);
    expect(html).toContain('<details'); expect(html).toContain('Lower-probability items (1)');
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
