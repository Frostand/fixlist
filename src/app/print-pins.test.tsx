import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { demoScenario } from '../data/demo-scenario';
import { createInitialState } from '../domain/workflow';
import { createPrintSnapshot } from '../lib/print';
import { testJpeg } from '../lib/scan-suggestions.fixture';
import { PrintReport } from './PrintReport';
it('prints each location with concern name, origin, local image or missing image, and note boundary', () => {
  const at = '2026-10-18T14:00:00.000Z';
  const pins = [
    { id: 'one', concernId: 'rug-concern', position: [0, 0, 0] as [number, number, number], createdAt: at, origin: 'family' as const, image: testJpeg },
    { id: 'two', concernId: 'cord-concern', position: [0, 0, 0] as [number, number, number], createdAt: at, origin: 'ai-suggestion' as const, image: testJpeg },
    { id: 'three', concernId: 'handrail-concern', position: [0, 0, 0] as [number, number, number], createdAt: at },
  ];
  const snapshot = createPrintSnapshot(createInitialState(demoScenario), at, pins);
  const html = renderToStaticMarkup(<PrintReport scenario={demoScenario} snapshot={snapshot} />);
  expect(html.match(/class="print-scan-location"/g)).toHaveLength(3);
  expect(html).toContain('Room scan location: Review the rug placement');
  expect(html).toContain('Pin placed by the family.');
  expect(html).toContain('Family-placed pin added from an AI suggestion (unverified model output).');
  expect(html).toContain('Pins are family-placed location notes, not detections.');
  expect(html).toContain('No image saved');
  expect(html.match(/<img /g)).toHaveLength(2);
  expect(html).toContain('No confirmed concerns or computed actions in this snapshot.');
});
it('labels the generated time with its own local time zone, not a stale UTC suffix', () => {
  const html = renderToStaticMarkup(<PrintReport scenario={demoScenario} snapshot={createPrintSnapshot(createInitialState(demoScenario), '2026-10-18T14:00:00.000Z', [])} />);
  expect(html).toContain('dateTime="2026-10-18T14:00:00.000Z"');
  expect(html).not.toContain('(UTC)');
});
