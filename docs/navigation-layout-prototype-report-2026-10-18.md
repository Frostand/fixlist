# Navigation layout prototype — worker evidence, 2026-10-18

Implemented U02 and the U03 single account entry in the parent-provided detached `nav` worktree. Changes are uncommitted; parent acceptance remains pending. This is a comparison prototype, with no intended-user usability finding yet.

## Exact tab labels

| Layout | English | Spanish |
| --- | --- | --- |
| `current` (default) | Home / Check / Plan / Help / More | Inicio / Revisar / Plan / Ayuda / Más |
| `three` | Home / Rooms / Requests | Inicio / Habitaciones / Solicitudes |
| `four` | Home / Rooms / Fix list / Requests | Inicio / Habitaciones / Lista de arreglos / Solicitudes |
| Volunteer (all layouts) | Home / Tasks / Profile | Inicio / Tareas / Perfil |

Spanish retains the existing machine-translation/unreviewed disclosure and typed dictionary parity.

## Behavior and destination inventory

Choose **Navigation layout (prototype)** in More/settings, or launch with `?nav=current`, `?nav=three` or `?nav=four` before the hash. The choice is a validated `layout` field in `fixlist:navigation:v1`, alongside existing invitation drafts, dismissed guides and pending destination. A valid older navigation record defaults to current without being rewritten on read. Invalid or duplicate launch values do not override saved preferences. The launch parameter is consumed so later settings changes/reset survive reload. Reset already removes this key and returns the in-memory layout to current.

Current shell, Home, Rooms and Plan preserve their existing rendering/behavior; the requested prototype selector is the deliberate addition to the current More screen. Volunteer screens and shell remain unchanged. No new routes were introduced.

Three-tab Home keeps the next-step card, displays only confirmed plan actions in compact cards with the shared primary request action, links to the full plan, then displays updates. Four-tab Home keeps the next-step card, a short fix-list summary/link and updates; the full existing Plan screen has its own tab. Both use the existing domain-derived plan and async durable dispatch.

| Former More/Help destination | Location in both new layouts | Existing route / limits |
| --- | --- | --- |
| Switch person | Header **Account and settings** → Switch person | `#/people`; header no longer switches people directly |
| Language | Account and settings → Language | `#/r/language` |
| Family access | Account and settings → Family access | `#/r/access`; resident only |
| Printable report | Account and settings → Printable report | `#/r/report`; resident only |
| About | Account and settings → About | `#/r/about` |
| Guide replay/resume | Account and settings → existing replay/resume button | `#/guide`; existing saved guide progress and replay logic |
| Reset | Account and settings → existing reset confirmation | Resident only; owned-key/store reset unchanged |
| Help body/disclosure | Account and settings directly, plus **Using FixList** link | `#/r/help` stays reachable; no duplicate guide button added to settings |
| Find local help | Requests → Find local help | `#/r/resources`; also reachable through Using FixList when request access is absent |
| Room scan | Rooms → **Room scan (3D)** | `#/r/scan`; existing scan capability required |
| Contextual help | Existing header button renamed **Using this screen** | Existing expandable panel, Escape/close and focus targets retained |

The header entry is **Account and settings** / **Cuenta y ajustes**; the contextual help label is **Using this screen** / **Cómo usar esta pantalla**. The local-assistance link remains **Find local help** / **Busca ayuda local**.

Question and scan routes select Rooms. Request, sharing, invite, review and resources routes select Requests. Plan selects Home in three and Fix list in four. Settings/help screens select no bottom tab and mark the header settings entry current. Back from scan goes to Rooms; Back from the nested three-tab plan goes Home. Resources retains the actual entry route for Back, with Requests as its direct-link fallback in new layouts.

Rooms/Check and Fix list/Plan retain existing checklist/plan capability gates. The new Requests tab is disabled without request access. A helper without that grant can still find public resources through settings → Using FixList; this does not expose household request records or resident screening facts. Full and compact plan buttons share one handler: resident household work opens sharing after successful creation, professional work and helper drafts open the existing request flow, and failed dispatch never navigates. Existing professional-work restrictions and volunteer field projections remain in the domain.

## Files changed

- `src/app/navigation-layouts.ts`: pure tabs, labels, gates, selected-tab mapping, prototype titles, launch-value validation and settings-entry definition; reusable by the parent's comparison script.
- `src/app/navigation-state.ts`, `routes.ts`: separately stored preference, backward-compatible validation and layout-aware route selection/Back/root behavior.
- `src/app/App.tsx`, `PhoneShell.tsx`: startup/toggle persistence, layout wiring, single settings header entry and contextual-help label.
- `src/app/ResidentScreens.tsx`, `RequestScreens.tsx`, `SettingsScreens.tsx`: Home variants, shared plan action, scan/resources entries, settings selector/help/disclosure.
- `src/i18n/en.ts`, `src/i18n/es.ts`: typed prototype labels and save-failure wording.
- `src/app/navigation-layouts.test.ts`, `navigation-layouts-ui.test.tsx`, `navigation-state.test.ts`: layout, rendering/callback, permission, persistence/deep-link and reset coverage. Existing tests remain unchanged in intent.
- `docs/architecture.md`, `ai-disclosures.md`, this report and `superpowers/plans/2026-10-18-navigation-layout-prototype.md`: scope, actual assistance, plan and evidence.

No dependencies, lockfile, household schema/domain, scan pipeline, iOS source, Capacitor configuration, public/private assets, icon, preserved plan body or Git history changed.

## Executed validation

Node 24.18.0, npm 11.16.0; existing installed dependencies used, with no install.

- `npm run typecheck`: passed after the final test additions.
- `npm run build`: passed. Initial JS **170.80 kB gzip** (about **166.8 KiB**, below the 250 KiB budget). The scan viewer stays lazy: **1,036.56 kB gzip**; Vite still reports large chunks. These sizes do not establish latency or phone performance.
- `npm test`: attempted; **1,214 tests passed**, **156 skipped**, **one suite failed** because `src/lib/local-scans-boundary.test.ts` could not bind `127.0.0.1` (`listen EPERM`). That run is incomplete, not a full green suite.
- Authorized fallback `npx vitest run --exclude src/lib/local-scans-boundary.test.ts`: **1,222 tests passed in 45 files, 0 failures, 0 skipped**, after all test additions. The HTTP suite did not run in this successful check.
- `git diff --check`: passed. Source diff inspected for scope and permission invariants.

Coverage includes exact en/es labels; every resident top-level entry and allowed helper entries; settings/room/account native-button callbacks; all eight helper grant combinations; nested rendered selected tabs and pure active mapping; unchanged volunteer shell markup; old/malformed preference records; selector callback persistence; launch override precedence and deep-link rendering in the actual App server render; saved-choice reload; reset; confirmed-only inline actions; professional/helper/success/failure primary-action routing. Server rendering and captured callbacks are not mounted browser interaction evidence.

## Remaining parent checks

Run the five intended comparison tasks in each layout in a mounted browser and the iOS Simulator: find a room, review evidence, confirm separately, request help, review completion. Include actual startup/toggle/reload/reset effects, deep links, browser/OS Back, guide skip/resume and person switching. Inspect English/Spanish at 320 px, text zoom, keyboard/VoiceOver focus, contextual-help return focus, long translated tabs/account labels and native printing after navigation. Do not infer these results from static rendering or the build. No browser/Simulator, print sheet, physical-device or intended-resident usability result was produced in this bounded worker run. The parent also needs the HTTP boundary suite in an environment that permits localhost binding.
