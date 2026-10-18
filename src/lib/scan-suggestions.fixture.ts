import { demoScenario } from '../data/demo-scenario';
import type { ScanDocumentV2 } from './scan-model';
import { createSuggestionCatalog, type ScanSuggestions, type ScanSuggestionLayer } from './scan-suggestions';

/** Synthetic in-memory fixture; no household imagery or trained-model result. */
export const suggestionCatalogFixture = createSuggestionCatalog(demoScenario);
export function suggestionsFixture(): ScanSuggestions {
  return { format: 'fixlist-scan-suggestions', version: 1, createdAt: '2026-10-17T14:00:00.000Z',
    model: { name: 'Synthetic test model', backend: 'mlx', engine: 'startlux-decision', license: 'Synthetic test license' },
    scan: { splatCount: 1, framesAnalyzed: 2, keyframes: ['frame-1.jpg', 'frame-2.jpg'] },
    thresholds: { probability: 0.7, minimum_frames: 1 }, notice: 'Synthetic test output, not a model finding.', timing: { total_seconds: 1.5 },
    items: [{ checklistItemId: 'rug-check', concernId: 'rug-concern', question: 'Imported model wording', maxProbability: 0.856, meanProbability: 0.6,
      framesAboveThreshold: 1, suggested: true, bestFrame: 'frame-1.jpg', position: [1, 0, -1], viewpoint: [2, 1, 1], thumbnail: 'data:image/jpeg;base64,/9j/4A==',
      perFrame: [{ frame: 'frame-1.jpg', probability: 0.856 }, { frame: 'frame-2.jpg', probability: 0.344 }] }],
  };
}
export function suggestionLayerFixture(): ScanSuggestionLayer { return { data: suggestionsFixture(), dismissed: [], pinned: [], droppedItems: 0 }; }
export function suggestionDocumentFixture(): ScanDocumentV2 {
  return { version: 2, asset: { name: 'scene.splat', blob: new Blob([new Uint8Array(32)]), kind: 'imported', metadata: null }, flipUpright: true, pins: [], suggestions: suggestionLayerFixture() };
}
