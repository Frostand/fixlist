import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { roomSketchCopy } from '../i18n/room-sketch';
import type { CaptureManifest, RoomSketchProps, SketchFlag } from '../lib/capture-types';
import { RoomSketch } from './RoomSketch';
import RoomSketch3D from './RoomSketch3D';

const capture: CaptureManifest = {
  format: 'fixlist-room-capture', version: 1, captureId: 'cap-synthetic001', roomId: 'living-room', createdAt: '2026-10-18T12:00:00.000Z', mode: 'arkit', floorY: 0,
  outline: { closed: true, points: [[0, 0], [4, 0], [4, 4], [0, 4]] }, doors: [[3, 0]],
  photos: [{ photoId: 'p01', checklistItemId: 'rug-check', takenAt: '2026-10-18T12:00:00.000Z', width: 1000, height: 1000, sha256: '0'.repeat(64),
    camera: { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 1.5, 2, 1], intrinsics: [500, 500, 500, 500], tracking: 'normal' } }],
};
const flags: readonly SketchFlag[] = [
  { id: 'placed', checklistItemId: 'rug-check', photoId: 'p01', point: { u: 500, v: 500 }, label: 'Review the rug in this photo' },
  { id: 'only-photo', checklistItemId: 'cord-check', photoId: 'p01', point: null, label: 'Review the cord in this photo' },
];
const base: RoomSketchProps = { capture, flags, photoUrls: new Map([['p01', 'blob:synthetic-photo']]), selectedId: null, onSelect: () => {}, mode: 'plan' };
function html(patch: Partial<RoomSketchProps> = {}, language: 'en' | 'es' = 'en') { return renderToStaticMarkup(<I18nProvider language={language}><RoomSketch {...base} {...patch} /></I18nProvider>); }

describe('room sketch static UI', () => {
  it('draws a labelled SVG plan, distinct selectable photo/flag markers, direction wedge and door gap', () => {
    const result = html({ selectedId: 'placed' });
    expect(result).toContain('<svg viewBox="0 0 1000 750" aria-hidden="true"');
    expect(result.match(/class="room-sketch__wall"/g)).toHaveLength(5);
    expect(result).toContain('class="room-sketch__door"'); expect(result).toContain('class="room-sketch__wedge"');
    expect(result).toContain('aria-label="Photo 1; Photo only: 1"');
    expect(result).toContain('aria-label="Review flag 1: Review the rug in this photo. Approximate spot from one photo" aria-pressed="true"');
    expect(result).toContain('class="room-sketch__badge"'); expect(result).toContain('Approximate room sketch. Not to scale for measuring.');
    expect(result).toContain('Unverified model output. Flags never answer or confirm a checklist item.');
    expect(result).not.toMatch(/\b(?:m²|metres|meters|2\.4|0\.9)\b/);
  });
  it('uses photos for absent geometry and keeps flags selectable without inventing a position', () => {
    for (const fallback of [
      { ...capture, outline: null },
      { ...capture, mode: 'photos' as const, floorY: null, outline: null, doors: [], photos: capture.photos.map((p) => ({ ...p, camera: null })) },
    ]) {
      const result = html({ capture: fallback, mode: '3d' });
      expect(result.match(/No room outline. Photos only./g)).toHaveLength(1); expect(result).not.toContain('Approximate room sketch. Not to scale for measuring.'); expect(result).not.toContain('<svg');
      expect(result).toContain('Review the rug in this photo'); expect(result).toContain('Photo only');
      expect(result).not.toContain('room-sketch__marker--flag'); expect(result).not.toContain('Loading the approximate 3D sketch');
    }
  });
  it('draws open outlines dashed with no floor fill or placed flags and no 3D load', () => {
    const result = html({ capture: { ...capture, outline: { ...capture.outline!, closed: false } }, mode: '3d' });
    expect(result).toContain('room-sketch__wall--open'); expect(result).toContain('Open outline.');
    expect(result).toContain('A closed room outline is needed for the 3D view.');
    expect(result).not.toContain('<polygon'); expect(result).not.toContain('room-sketch__marker--flag');
    expect(result).not.toContain('Loading the approximate 3D sketch');
  });
  it('rejects self-crossing or zero-area geometry in the drawing as well as placement', () => {
    for (const points of [[[0, 0], [4, 4], [0, 4], [4, 0]], [[0, 0], [1, 0], [2, 0]]] as const) {
      const result = html({ capture: { ...capture, outline: { closed: true, points } } });
      expect(result).toContain('This outline cannot be drawn reliably. Photos only.'); expect(result).not.toContain('<svg');
    }
  });
  it('labels limited tracking, missing previews and photo-only flags plainly', () => {
    const result = html({ photoUrls: new Map(), capture: { ...capture, photos: [{ ...capture.photos[0]!, camera: { ...capture.photos[0]!.camera!, tracking: 'limited' } }] } });
    expect(result).toContain('Photo preview unavailable'); expect(result).toContain('Camera tracking was limited; flags stay with this photo.');
    expect(result).toContain('aria-label="Photo 1; Photo only: 2"'); expect(result).not.toContain('room-sketch__marker--flag');
  });
  it('keeps gallery flag labels compact while preserving global numbering and full accessible detail', () => {
    const secondPhoto = { ...capture.photos[0]!, photoId: 'p02', sha256: '1'.repeat(64) };
    const secondFlag = { ...flags[0]!, id: 'second-photo-flag', photoId: 'p02', label: 'Review the distant rug in this photo' };
    const result = html({ capture: { ...capture, photos: [...capture.photos, secondPhoto] }, flags: [...flags, secondFlag] });
    const button = result.match(/<button[^>]*class="room-sketch__flag-link secondary"[^>]*title="Review the distant rug in this photo"[\s\S]*?<\/button>/)?.[0];
    expect(result).toContain(`class="room-sketch__photos" role="group" aria-label="${roomSketchCopy('en').photos}"`);
    expect(result).toContain('<span>Photo 2</span>');
    expect(button).toContain('aria-label="Review flag 3: Review the distant rug in this photo. Approximate spot from one photo"');
    expect(button).toContain('<span class="room-sketch__flag-label"><span aria-hidden="true">◆ </span>Review flag 3</span>');
    expect(button).toContain('<span class="small-text">Approximate spot from one photo</span>');
    expect(button).not.toContain('>Review the distant rug in this photo</span>');
  });
  it('filters both excluded checklist flags and flags for unknown photos defensively', () => {
    const result = html({ flags: [
      ...flags,
      { ...flags[0]!, id: 'handrail', checklistItemId: 'handrail-check', label: 'Excluded handrail flag' },
      { ...flags[0]!, id: 'lighting', checklistItemId: 'stair-lighting-check', label: 'Excluded lighting flag' },
      { ...flags[0]!, id: 'orphan', photoId: 'p99', label: 'Orphan flag' },
    ] });
    expect(result).not.toContain('Excluded'); expect(result).not.toContain('Orphan flag');
    expect(result.match(/class="room-sketch__marker room-sketch__marker--flag"/g)).toHaveLength(1);
  });
  it.each(['en', 'es'] as const)('uses current-language labels and exposes only selection callbacks in %s', (language) => {
    const copy = roomSketchCopy(language), onSelect = vi.fn();
    let tree: ReactNode;
    function Probe() { tree = RoomSketch({ ...base, onSelect }); return tree; }
    const result = renderToStaticMarkup(<I18nProvider language={language}><Probe /></I18nProvider>);
    expect(result).toContain(copy.approximate); expect(result).toContain(`${copy.photo} 1`); expect(result).toContain(copy.photoOnly);
    expect(onSelect).not.toHaveBeenCalled();
    const buttons = elements(tree, 'button');
    for (const name of [`${copy.photo} 1; ${copy.photoOnly}: 1`, `${copy.flag} 1: ${flags[0]!.label}. ${copy.spot}`]) {
      const button = buttons.find((node) => node.props['aria-label'] === name)!;
      expect(button.props.type).toBe('button'); (button.props.onClick as () => void)();
    }
    expect(onSelect.mock.calls).toEqual([['p01'], ['placed']]);
    expect(result).not.toContain('type="radio"'); expect(result).not.toContain('Confirm concern');
  });
  it.each(['en', 'es'] as const)('3D exposes keyboard instructions, named orbit buttons and reset in %s', (language) => {
    const copy = roomSketchCopy(language);
    const result = renderToStaticMarkup(<I18nProvider language={language}><RoomSketch3D {...base} mode="3d" onUnavailable={() => {}} /></I18nProvider>);
    expect(result).toContain(copy.help); expect(result).toContain(copy.reset); expect(result).toContain(`aria-label="${copy.controls}"`);
    for (const direction of ['left', 'right', 'up', 'down', 'in', 'out'] as const) expect(result).toContain(`aria-label="${copy[direction]}"`);
    expect(result.match(/disabled=""/g)).toHaveLength(7);
  });
});

function elements(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type ? [node as ReactElement<Record<string, unknown>>] : []), ...elements(node.props.children, type)];
}
