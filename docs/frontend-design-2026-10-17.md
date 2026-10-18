# Frontend design — October 17, 2026

Presentation-only redesign of the local demo. Domain rules, storage schema (`fixlist:demo:v1`, payload schema 2), commands and print snapshot semantics are unchanged.

## Visual system

| Role | Value | Rule |
| --- | --- | --- |
| Plaster (page) | `#eef1ec` | Page ground. |
| Sheet (surfaces) | `#ffffff` | Rooms, cards, report paper. |
| Ink (text, primary) | `#16302b` | Body text, primary buttons, walls on the floor plan. |
| Graphite (secondary) | `#56625e` | Captions and sources; 6.3:1 on white. |
| Safety yellow | `#f4c430` | **Only** for concerns a family member explicitly confirmed (tags, map flags, item edge, logo flag). |
| Moss / Brick | `#2d6a4f` / `#a33b26` | Condition met / not met, always paired with text and a ✓/✕ marker. |
| Hatching | graphite stripes | **Only** for unknown or unanswered (rooms, coverage cells, missing facts, “needs information”, unknown rules). |

Type: Zilla Slab 600/700 for display headings, Atkinson Hyperlegible Next (variable) for body and UI, Atkinson Hyperlegible Mono for labels and counts. Atkinson was designed for low-vision readers, which matters for an older resident reading the report. Fonts are self-hosted through exact-version Fontsource packages under the SIL Open Font License; there is no runtime font CDN.

## Layout

- Desktop (≥64rem): a sticky overview rail holds the brand, the coverage floor plan, five-step navigation with live counts, browser-storage status and reset. The reading column holds the five steps.
- Narrow screens: the rail becomes a header (floor plan, two-column step nav, storage, reset), followed by the steps.
- Signature: a schematic floor plan of the fictional home. Each room is a link to its questions, hatched while any question is unanswered, with a yellow count of confirmed concerns. Its label states answered/unknown/confirmed counts for screen readers. It is a coverage aid, not a safety map, and is not drawn to scale.
- Checklist answers use a native radio group styled as a Yes / No / Unknown segmented control (arrow keys work). Confirmation remains a separate button that is disabled until every backing answer is yes.
- The family log shows a four-stage tracker (Draft → Requested → In progress → Reported complete). It labels family reports only; it does not imply verification.
- Command feedback goes to one polite live region; a non-interactive toast shows the same text visually and fades after about 5.5 s.

## Checks run on October 17, 2026

- `npm run typecheck`, `npm test` (387 passing, unchanged test files) and `npm run build`: JavaScript 88.24 kB gzip, within the 250 KiB budget. Fonts add about 107 kB of latin woff2 (not part of the JS budget).
- Production preview in a 1280–1440px browser: walk-through, confirmation tags and map flags, plan cards, renter profile (not met / matched), family log tracker and report preview inspected visually; no console errors.
- 320px viewport: no horizontal overflow; every button, select, link and segment measured ≥44px tall.
- Keyboard: arrow keys change a checklist answer, Tab reaches the enabled Confirm button, Enter confirms, and focus stays on the same button (now “Remove confirmation”) with a visible focus ring.
- Print: the `@media print` rules were switched on in the screen at A4 content width to inspect layout (the app chrome is hidden and the report is black-and-white with sources, unknowns and nested rules). **No native print dialog or PDF was produced in this pass**, so pagination and actual printed output still need a real print-preview check before recording.

Not checked: iOS Safari or a physical phone, reduced-motion behavior in a real OS setting, and screen-reader announcement order.
