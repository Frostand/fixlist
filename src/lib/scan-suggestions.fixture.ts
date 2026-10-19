import { demoScenario } from '../data/demo-scenario';
import { prepareScanAsset, type ScanDocumentV2 } from './scan-model';
import { TRUSTED_MODEL_LICENSE, TRUSTED_SUGGESTION_NOTICE } from './scan-suggestions';
import { createSuggestionCatalog, type ScanSuggestionsV1, type ScanSuggestionsV2, trustedPhotoQuestions, type ScanSuggestionLayer } from './scan-suggestions';

/** Synthetic in-memory fixture; no household imagery or trained-model result. */
export const suggestionCatalogFixture = createSuggestionCatalog(demoScenario);
const syntheticBlob = new Blob([new Uint8Array(32)]);
const prepared = await prepareScanAsset({ name: 'scene.splat', blob: syntheticBlob, kind: 'imported', metadata: null });
if (!prepared.ok) throw new Error(prepared.error);
const sceneSHA256 = prepared.value;
export function suggestionsFixture(): ScanSuggestionsV1 {
  return { format: 'fixlist-scan-suggestions', version: 1, createdAt: '2026-10-17T14:00:00.000Z',
    model: { name: 'Synthetic test model', backend: 'mlx', engine: 'startlux-decision', license: TRUSTED_MODEL_LICENSE },
    scan: { splatCount: 1, framesAnalyzed: 2, keyframes: ['frame-1.jpg', 'frame-2.jpg'],
      identity: { version: 1, sceneSHA256, coordinateSystem: 'y-up-right-handed', units: 'arbitrary', frames: [],
        processing: { producer: 'Synthetic in-memory test fixture; no reconstruction', producerSHA256: null, alignmentSHA256: null, reconstructionSHA256: null } } },
    thresholds: { probability: 0.7, minimum_frames: 1 }, notice: TRUSTED_SUGGESTION_NOTICE, timing: { total_seconds: 1.5 },
    items: [{ checklistItemId: 'rug-check', concernId: 'rug-concern', question: suggestionCatalogFixture.get('rug-check')!.question, maxProbability: 0.856, meanProbability: 0.6,
      framesAboveThreshold: 1, suggested: true, bestFrame: 'frame-1.jpg', position: [1, 0, -1], viewpoint: [2, 1, 1], thumbnail: testJpeg,
      perFrame: [{ frame: 'frame-1.jpg', probability: 0.856 }, { frame: 'frame-2.jpg', probability: 0.344 }] }],
  };
}
export function suggestionLayerFixture(): ScanSuggestionLayer & { data: ScanSuggestionsV1 } { return { data: suggestionsFixture(), dismissed: [], pinned: [], droppedItems: 0 }; }
export function suggestionDocumentFixture(): ScanDocumentV2 & { suggestions: ScanSuggestionLayer & { data: ScanSuggestionsV1 } } {
  return { version: 2, asset: { name: 'scene.splat', blob: syntheticBlob, kind: 'imported', metadata: null }, flipUpright: true, pins: [], suggestions: suggestionLayerFixture() };
}

export const testJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAxAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEsAAQEAAAAAAAAAAAAAAAAAAAAHAQEAAAAAAAAAAAAAAAAAAAAAEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAAgACAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8Av4AP/9k=';

/** Every trusted photo question, with synthetic scores only. */
export function suggestionsV2Fixture(): ScanSuggestionsV2 {
  const old = suggestionsFixture();
  return { ...old, version: 2, calibration: null,
    thresholds: { suggestion: 0.7, location: 0.8, relevance: 0.5, noneProbability: 0.1, minFrames: 1 },
    items: trustedPhotoQuestions.map((q) => ({ checklistItemId: q.checklistItemId, concernId: q.concernId, question: q.question,
      relevanceQuestion: q.relevanceQuestion, limitation: q.limitation, status: 'suggested', score: 0.856, meanProbability: 0.6,
      relevantFrames: 2, framesAboveThreshold: 1, bestFrame: old.scan.keyframes[0]!, position: [1, 0, -1], viewpoint: [2, 1, 1], thumbnail: testJpeg,
      perFrame: [{ frame: old.scan.keyframes[0]!, rawProbability: 0.856, probability: 0.856, relevanceProbability: 0.9 },
        { frame: old.scan.keyframes[1]!, rawProbability: 0.344, probability: 0.344, relevanceProbability: 0.6 }],
    })),
  };
}
