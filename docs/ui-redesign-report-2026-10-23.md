# FixList UI redesign — bounded worker evidence, October 23, 2026

Implementation is left uncommitted in `/Users/al1234/.t3-custom/projects/fixlist-wt-ui`. This report is worker evidence, not parent acceptance, browser acceptance, iOS acceptance or submission readiness.

## Changes by screen

- Visual system: system font stack, grouped gray background, white inset lists, deep green actions, amber review markers, 34/22/17px-based type scale, scalable rem sizing, logical horizontal CSS, safe areas, wrapping labels, visible keyboard focus and reduced motion. Removed the local font imports without changing dependencies. Added reusable cards, grouped rows, buttons, segments, status pills, progress, empty states, icon tiles and native-dialog sheets.
- Navigation: one resident/helper Home / Rooms / Fix list / Help layout. Settings opens from the avatar on roots; roots use large titles and pushed screens use compact parent/back bars. Old saved layout values render the same layout; `?nav=` is inert. Stable hashes remain, with a new `#/r/display` route for text size. Settings remembers its originating tab; a room’s question can return to that room. Volunteer keeps Home / Tasks / Profile.
- Setup: welcome and a language list rendered only from `LANGUAGES`; three primary role cards plus other demo profiles; three role-specific illustrated walkthrough panels; privacy and a first-room action. Existing guide indices 0–2 now hold the three panels; index 3 holds privacy. Durable completion, dismissal, replay and per-person progress remain. An ungranted family helper gets Home plus an access explanation instead of an inaccessible scan. English/Spanish copy and key/interpolation parity pass.
- Home: greeting, local scan progress, suggested-spot/confirmed-fix/request counts, a scan hero, the existing next-step selector and volunteer updates. Capture reads require checklist access. Loading/storage failure is distinct from an unscanned room.
- Rooms: one grouped row per room with a local photo thumbnail or room tile, scan/answer status and a room destination. Sequential questions remain available below the list. Removed duplicate walk-through rows.
- Room: illustrated scan intro, numbered tips, native availability-based Start scan / Take photos instead, and a photo fallback tip. Saved rooms show the sketch, Plan/3D control where an outline exists, amber AI suggestion cards, exact photo question and experimental score under details, explicit review/Looks fine controls and inline Yes/No/Not sure answers. Full question links retain photos and separate confirmation. Scan replacement/deletion and advanced export/import remain guarded; deletion/export use sheets. Missing/unanswered remains distinct from explicit Not sure. Scores/titles are read defensively.
- Fix list: confirmed fixes in grouped rows with room/status, detail sheets and the existing request action. Pending Yes answers have a separate review section; they do not enter computed plan rows. Added a scan empty state and one plan-limit footnote.
- Help: request entry/list, the existing sourced Eldercare Locator call/site links, one fictional-programs entry and guide replay. The fictional program screen uses a profile picker and closed details for facts/rules.
- Settings: grouped person/language/display/helper access/report/sample 3D/guide/privacy entries, resident-only reset and compact dismissible migration details. Text size is explicitly session-only; it adds no storage key and resets with FixList. Spanish review disclosure remains. Ordinary screens have no permanent visible Saved line or demo banner at the top.
- Volunteer/question presentation: shared projection-only task lists and empty states reuse the visual system. Existing task commands and boundaries remain. The full question screen retains native radio controls styled as segments and explicit confirmation.

No native capture, AI generation, domain rule, dependency, upload or external-send implementation was added. The guide does not claim that an on-device model is already integrated; native/model work remains with its owning workstream.

## Changed implementation files

New: `src/app/UI.tsx`, `src/app/Illustration.tsx`, `src/app/capture-summary.ts`.

Changed: `src/app/App.tsx`, `PhoneShell.tsx`, `PeopleScreens.tsx`, `ResidentScreens.tsx`, `CaptureScreens.tsx`, `RequestScreens.tsx`, `SettingsScreens.tsx`, `VolunteerScreens.tsx`, `navigation-layouts.ts`, `navigation-state.ts`, `routes.ts`; `src/styles/base.css`, `phone.css`, `capture.css`, `room-sketch.css`; `src/i18n/en.ts`, `es.ts`; `src/main.tsx`; `tsconfig.app.json`, `tsconfig.node.json`; `docs/architecture.md`.

The TypeScript build-info paths moved from the shared `node_modules` symlink to the already ignored local `.vite/` directory. This permits the exact required typecheck in the sandbox. No package/lockfile change or install occurred.

Local documentation: this report and `docs/superpowers/plans/2026-10-23-ui-redesign.md`. New Markdown files are ignored by the existing repository policy; preserve them explicitly in a parent handoff if desired.

## Every changed test file

| File | Reason |
| --- | --- |
| `src/app/navigation-layouts.test.ts` | Replace obsolete comparison contracts with one four-tab layout, inert legacy aliases/query, exhaustive helper gates, settings/room parents and volunteer routing. |
| `src/app/navigation-layouts-ui.test.tsx` | Replace comparison UI cases with actual shell/avatar/back/legacy-storage integration. Retain existing request creation, professional routing and helper-denial tests. |
| `src/app/navigation-state.test.ts` | Expect normalized legacy layouts; keep household bytes, drafts, dismissal and validation checks. |
| `src/app/navigation-ui.test.tsx` | New settings-guide label, Help selection for resources and compact back chrome; retain guide persistence, reset modal, focus and grant checks. |
| `src/app/routes.test.ts` | Help is the selected resource tab while contextual back destinations stay intact. |
| `src/app/checklist-presentation.test.tsx` | Room rows now open room pages; assert inline full-question reachability and explicit uncertainty. Update four-tab icon labels. Progress, confirmation and volunteer-projection assertions remain. |
| `src/app/capture-screens.test.tsx` | One room link replaces duplicate walk-through copy; assert the new visible AI label, unverified notice and reachable details. Existing AI non-mutation, explicit No, helper, capture identity and route-epoch tests remain. |
| `src/app/polish-batch-a.test.tsx` | Update empty-state structure, remove layout opt-in, and select Help through request flows. Keep confirmation, source/fictional, criteria and explicit-choice checks. |
| `src/app/polish-batch-b.test.tsx` | Demo disclosure moves out of role setup into settings/About/print, with a short setup-specific footnote; Spanish review notice remains. |
| `src/app/polish-batch-c.test.tsx` | Language rows now contain icons and use selected-state checks instead of secondary-button styling. Photo dialog tests unchanged. |
| `src/app/setup-flow.test.tsx` (new, 7 tests) | Language enumeration, role cards, all role panels/privacy, real persisted completion, save-failure exit guard, replay/dismissal, Spanish, and ungranted-helper completion. |
| `src/app/redesign-screens.test.tsx` (new, 12 tests) | Scan/fallback copy, real inline-answer/confirmation invariants, stale callbacks, failure/grants, room links, confirmed plan rows, settings actions, sourced/fictional Help, sheet Escape cancellation and recovery controls. |

No domain, storage, reset, print, native or scan test file was deleted or edited to bypass a failing invariant. Obsolete layout-comparison cases were replaced; total test count consequently differs from the parent-supplied 1,547 baseline. Nineteen focused tests were added.

## Executed validation

Environment: Node 24.18.0, npm 11.16.0. Dependencies were already available through the supplied symlink; no install was run.

- `npx tsc -b --pretty false` and `npm run typecheck`: pass, zero errors.
- Final `npx vitest run --configLoader native --exclude src/lib/local-scans-boundary.test.ts --exclude src/lib/local-scans-packaging.test.ts`: **1,354 passed, 58 files**. Includes the application/domain/storage/print/localization tests.
- Earlier `npx vitest run --configLoader native --exclude src/lib/local-scans-boundary.test.ts`: **1,382 passed, 59 files**, including the 29 packaging tests, before the final one-test helper-guide addition.
- Last full `npx vitest run --configLoader native` attempt: **1,382 passed, 156 skipped, one failed suite**. `local-scans-boundary.test.ts` could not start its server: `listen EPERM 127.0.0.1`. That suite is unchanged.
- A subsequent `npm test -- --configLoader native --exclude src/lib/local-scans-boundary.test.ts` exposed an additional environment-dependent cache failure: **1,370 passed, 12 failed**. Packaging’s existing `validators()` creates Vite with the shared project root and `configFile: false`; refreshing `node_modules/.vite/deps` was refused with `EPERM`, alongside WebSocket listen warnings. No packaging test or script was modified. An unrestricted parent run is required; full Vitest is **not accepted as passing here**.
- The default bundled config loader also cannot write under the shared symlink’s `node_modules/.vite-temp`; `--configLoader native` avoids that config-loading write. Parent commands in a normal writable checkout may use their ordinary defaults.
- Final `npm run build -- --configLoader native`: pass. Initial JavaScript **200.35 KiB gzip**; CSS **12.61 KiB gzip**. Initial JS is below the 250 KiB budget. Vite still warns about the existing large lazy 3D chunks. No latency/performance improvement is claimed.
- `git diff --check`: pass. Protected-path diff is empty for `ios/`, protected capture libraries, `src/domain/`, manifests/lockfile, `scan/`, `scripts/promo/`, `assets/icon.svg` and `fixlist-plan.md`.

## Remaining parent gates and limits

- Vite with native config loading on `127.0.0.1:5174` failed to listen with sandbox `EPERM`. No browser screenshots were produced.
- Actual 402×874 layout, keyboard/focus behavior, 320px and large-text wrapping, RTL, native-dialog interaction, native print/preview and iOS Simulator journeys require parent verification. SSR/callback tests do not establish these outcomes.
- Full Vitest must be rerun with a writable dependency cache and allowed loopback sockets. Both environment-affected test files remain intact.
- Text-size selection is session-only and labelled accordingly. No new preference-storage or migration scheme was introduced.
- Home’s spot count counts displayed suggested flags, not a separately persisted reviewed/dismissed lifecycle. AI suggestions remain unverified; Yes and explicit confirmation are separate.
- No scan-duration claim was added without measurement. No native/physical scan, dimension, accuracy, safety or submission-readiness claim is made.

Assistance: implementation, copy and inline SVG illustrations were AI-assisted in this bounded worker. Applied local frontend-design, writing-plans and systematic-debugging guidance; read browser guidance before the blocked server attempt. No subagents, nested model routing, external messages, installs, commits, publishing or native modifications were performed. Parent review owns acceptance and student-contribution disclosure.
