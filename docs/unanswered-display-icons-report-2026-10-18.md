# Unanswered display and prototype icons — follow-up worker evidence

2026-10-18. Prior navigation prototype preserved in the same parent-provided worktree. This report covers only the follow-up changes. Everything remains uncommitted; parent owns final acceptance.

## Result

`src/app/checklist-presentation.ts` derives a presentation-only fourth answer value. Domain `unknown` without answer attribution displays **Not answered / Sin responder** and selects no radio. Domain `unknown` with attribution selects the existing **Not sure / No estoy seguro** option. Known Yes/No values remain answers even without attribution, preserving older migrated records. No saved values, schema, domain commands, confirmation rules, domain next-step selectors or permission projections changed.

Question screens, current Home progress, Rooms/global and per-room counts, print answer rows and print coverage, retained legacy checklist/plan and map descriptions all use the same distinction. Explicit Not sure counts as answered but is listed separately; missing answers are counted separately. Unknown room styling stays unresolved and the no-safety disclaimer remains. Example: **3 of 8 answered (1 not sure); 5 not answered**.

Phone checklist resume and room selection skip explicit Not sure to reach the first unanswered question in catalog order (globally or in that room). When none is unanswered, the existing saved position/room fallback remains available for review. Home's checklist next-step button also targets the first unanswered question; if the domain returns an uncertain question after every question has a recorded answer, its display label says **Review a Not sure answer**, preserving its route and the domain selector. Other next-step priorities are unchanged. Volunteer views do not expose checklist answers/attribution and remain unchanged.

Prototype Rooms tabs now use a simple door icon; Requests tabs use a person above supporting hands. Both are existing-style 24×24 SVG stroke paths at width 1.7 with `aria-hidden="true"`. Fix list retains the list icon. Current-layout and volunteer icon assignments/paths and visible tab labels remain unchanged.

## Exact added or changed copy

| Key | English | Spanish |
| --- | --- | --- |
| `check.unanswered` | Not answered | Sin responder |
| `home.progress` | {answered} of {total} answered ({notSure} not sure); {unanswered} not answered | {answered} de {total} respondidas ({notSure} sin certeza); {unanswered} sin responder |
| `checklist.incomplete` | Some questions are not answered. Not sure answers are recorded separately; neither state confirms a concern. | Hay preguntas sin responder. Las respuestas sin certeza se registran por separado; ninguno de estos estados confirma una inquietud. |
| `checklist.uncertain` | All sample questions have a recorded answer, including Not sure. You can review uncertain answers; confirmation remains separate. | Todas las preguntas de ejemplo tienen una respuesta registrada, incluidas las respuestas sin certeza. Puedes revisar esas respuestas; la confirmación sigue siendo un paso separado. |
| `next.reviewNotSure` | Review a Not sure answer | Revisa una respuesta sin certeza |
| `legacy.floorplan.8` | Questions not sure or not answered | Preguntas sin certeza o sin responder |
| `legacy.floorplan.9` | Answered Yes or No | Respondidas con Sí o No |
| `map.description` | {room}: {answered} of {total} answered ({notSure} not sure); {unanswered} not answered; {confirmed} confirmed concerns. | {room}: {answered} de {total} respondidas ({notSure} sin certeza); {unanswered} sin responder; {confirmed} inquietudes confirmadas. |

The existing `check.unknown` remains **Not sure / No estoy seguro**. Spanish retains its machine-translation/unreviewed marker. Exact key and interpolation parity passes.

## Follow-up files changed

- Added `src/app/checklist-presentation.ts` and `src/app/checklist-presentation.test.tsx`.
- Updated `src/app/ResidentScreens.tsx`, `CatalogViews.tsx`, `PrintReport.tsx`, `WorkflowSections.tsx`, `FloorPlan.tsx` for answer display, counts and resume/review presentation.
- Updated `src/app/PhoneShell.tsx`, `navigation-layouts.ts` for the two prototype icon paths/assignments only.
- Updated `src/i18n/en.ts`, `src/i18n/es.ts` with the copy above.
- Updated `src/app/catalog-views.test.tsx`, `scan-suggestions-ui.test.tsx`, `data-lifecycle-ui.test.tsx` to expect the corrected progress/uncertainty wording while retaining their original invariants.
- Updated `docs/architecture.md`, `ai-disclosures.md`; added this report and `docs/superpowers/plans/2026-10-18-unanswered-display.md`.

Existing navigation prototype work remains present. No dependencies, lockfile, domain files, storage/print snapshot schema, scan pipeline, native source, public/private assets, protected icon, preserved plan body or Git history changed.

## Executed validation and limits

Node 24.18.0, npm 11.16.0; existing dependencies used. Regression tests reproduced the initial selected-unknown, conflated-coverage and old-icon behaviors before the fix.

- `npm run typecheck`: passed after final test changes.
- `npm run build`: passed. Initial JS **171.48 kB gzip** (about **167.5 KiB**, under 250 KiB). Scan viewer remains lazy at **1,036.56 kB gzip**; the existing large-chunk warning remains. No latency/phone-performance claim.
- Final `npm test`: **1,239 passed**, **156 skipped**; the sole failed suite was `src/lib/local-scans-boundary.test.ts`, which cannot bind `127.0.0.1` in this sandbox (`listen EPERM`). This full command is incomplete, not fully green.
- Authorized fallback `npx vitest run --exclude src/lib/local-scans-boundary.test.ts`: **1,239 passed across 46 files, 0 failures, 0 skipped**.
- `git diff --check`: passed. No domain/lib/protected-source changes were present in the scoped diff.

The 17 new regressions cover no initial selection in en/es; explicit Not sure and Yes/No; mixed and entirely uncertain coverage; per-question printed states and counts; legacy checklist/map wording; helper display and absence of checklist fields in volunteer projections; first-unanswered global/room/Home resume; unchanged Yes-plus-confirmation behavior; prototype icon distinctions/current and volunteer invariance; and read-only classification preserving legacy Yes/No. Existing i18n, privacy, domain, navigation and storage tests pass in the permitted run.

No mounted-browser, iOS Simulator, physical-device, print-sheet or saved-PDF check was performed in this worker. Parent should recheck the reported stairs question, change Not sure → Yes/No and reload, resume with a mixture of uncertain/missing answers, inspect narrow en/es progress and icon legibility, and inspect actual printed/native output before the older-resident session. The HTTP suite still needs an environment that permits localhost binding.
