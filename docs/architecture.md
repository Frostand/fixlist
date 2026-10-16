# Current demo architecture

This document is the technical authority for the demo scope as of October 15, 2026. The earlier `fixlist-plan.md` is preserved background; its API, database, accounts, native capture, reconstruction, and optional 3D systems are outside this scaffold and recording plan.

## Objective and current state

Create a small local browser demo with enough working behavior to record an honest 1–3 minute video. Start with a synthetic room, explicit concern confirmation, a genuinely computed action plan, transparent assistance screening, a family-recorded request log, and printable output. A video is the delivery focus, but the demonstrated features must actually work.

Implemented now: one Vite app, strict TypeScript configuration, domain contracts, a compile-checked synthetic scenario, minimal semantic setup page, and documentation. No checklist interaction, plan computation, screening, storage, request workflow, printing, or room images exist yet. Vitest is configured without tests; `--passWithNoTests` is temporary and supplies no behavioral evidence.

## Stack decisions

| Component | Exact version | Reason and boundary |
| --- | --- | --- |
| React / React DOM | 19.3.1 | Compose the later interactive demo in one browser application. |
| TypeScript | 7.0.2 | Strict domain contracts and fixture checks; not runtime data validation. |
| Vite | 8.3.4 | Local development and a static production bundle; no server application. |
| Vite React plugin | 6.1.2 | React development integration. Optional Babel/React Compiler peers are not required. |
| Vitest | 5.0.5 | Later tests of actual domain rules and storage failure behavior. |
| React / React DOM types | 19.3.0 | Type checking for the selected React major. |
| Node types | 24.19.2 | Tooling configuration on Node 24. |
| Node / npm | 24.18.0 / 11 | Local toolchain; `.nvmrc` pins Node and package engines constrain supported majors. |
| CSS / storage / print | Browser APIs | Plain CSS now; versioned `localStorage` and native printing later. |

`package.json` pins direct dependencies; `package-lock.json` records the resolved graph. No UI component library, router, state library, PDF package, 3D engine, backend, database, or API is required for the selected journey. Reconsider a dependency only after demonstrating a concrete need. The initial JavaScript budget is 250 KiB gzip; inspect build output before adding dependencies. No startup, interaction-speed, or user-outcome measurements have been made.

## Folder ownership

| Location | Responsibility |
| --- | --- |
| `src/main.tsx` | React root and global stylesheet. |
| `src/app/App.tsx` | Current setup page; later the small journey and view composition. |
| `src/domain/types.ts` | Concern evidence, separate human confirmation, program criteria, and family-request contracts. |
| `src/domain/` (later) | Pure functions for confirmed-concern selection, explained plan generation, and screening. Add modules when behavior exists. |
| `src/data/demo-scenario.ts` | Authored synthetic scenario checked with `satisfies DemoScenario`. |
| `src/data/` (later) | Source-backed program records kept distinguishable from fictional fixtures. |
| `src/lib/` (later) | Small validated-storage and print integrations; no empty service abstractions. |
| `src/styles/` | Minimal base CSS now; journey and print styles later. |
| `public/demo/` | Publishable synthetic or consented assets and provenance guidance. No images currently. |
| `docs/` | Current architecture, recording evidence, assistance disclosures, implementation plans. |
| `recordings/` | Local video/PDF exports ignored by Git; tracked operating instructions. |

## Data and behavior boundaries

The sample scenario is entirely fictional. Each program is labeled fictional and has source status `synthetic`, no source URL, and no verification date. Null image paths mean no image exists. A fixture is authored input; it is not live observation, detection, verification, a generated result, or evidence of product effectiveness.

An observation is `ConcernEvidence`. Human confirmation is a separate `HumanConfirmation` record, initially `humanConfirmed: false`. Only explicit confirmation may admit a concern to a future action plan. Reference actions are currently example text; no prioritization or plan computation is implemented. Confirming one concern must not confirm another or imply that all hazards were found.

`CriterionStatus` is exactly `met | not_met | unknown`. `ScreeningStatus` is exactly `criteria_matched | needs_information | known_criterion_not_met`. A later pure screening function must preserve unanswered facts and explain its output. Define and test mixed-failure/unknown precedence before implementation. Even fully matched recorded criteria cannot establish final eligibility, current availability, funding, or approval.

Request records are family-authored local history. The fixture contains a draft, no external contact, and `completion.status: unconfirmed`. Later completion can be recorded only as `family_reported_complete`, with attribution. This local model cannot demonstrate authenticated invitations, membership checks, vetting, trade qualifications, or a repair verified by an independent party. Those production claims are excluded.

## Storage and printing plan

Later browser persistence uses the key `fixlist:demo:v1` and a versioned envelope. Validate untrusted JSON and IDs before use, catch read/parse/write failures, show persistence failures, and provide in-memory fallback. Reset restores a fresh synthetic scenario and removes only FixList's key. Keep real personal data and media out of local storage. The exact contract and failure handling are in [`src/lib/README.md`](../src/lib/README.md).

Later printable output uses a user-triggered `window.print()` and `@media print` CSS. It must include confirmed concerns only, the reasoning behind actions, program sources or fictional labels, unanswered criteria, family-reported status, and the date the output was generated. Inspect the browser print preview and a saved PDF; do not label a page as an exported plan before this works.

## Implementation milestones and gates

| Milestone | Observable acceptance behavior | Stop or cut criterion |
| --- | --- | --- |
| 1. Room, checklist, confirmation, computed plan | Show a clearly labeled sample room; answer the checklist; confirm a concern; derive the plan from current confirmations using documented pure rules. Unconfirmed concerns stay out; undoing confirmation removes the corresponding action. Tests prove these transitions and explain ordering. | Do not film a generated plan while it is a static fixture. Cut extra rooms and visual extras if they delay this behavior. Pause plan implementation if priority rules or action provenance cannot be explained. |
| 2. Programs, family request log, print | Add only source-checked real programs with citations and verification dates, or retain conspicuously fictional examples. Display matched/unanswered/failed criteria; unknown never becomes a match. Record a local draft/status without sending. Print the plan with all uncertainty labels intact. | If real records cannot be checked, cut real-program claims and show disclosed fictional examples. Cut automated outreach, approvals, authentication, and PDF libraries. Stop recording this step if print or status labels misrepresent what happened. |
| 3. Rehearsal, tests, disclosures, video | Reset to the same starting state; complete the selected journey by keyboard and pointer; test domain rules and storage recovery/reset; review responsive and print output; run the checks; record a 1–3 minute working demonstration with accurate disclosures. | Do not film the scaffold as finished functionality. Cut extra features if the core journey cannot be repeated reliably. Do not submit without significant student technical contributions and understanding being recorded. |

Before each milestone, establish its focused implementation plan and tests. Build the smallest selected path; there is no requirement to implement the earlier full product plan. No new design system or asset generation is part of this scaffold task.

## Commands and validation

Run `npm ci` with Node 24.18.0 and npm 11, then `npm run dev` for `http://127.0.0.1:5173`. `npm run typecheck` checks the app and Vite config. `npm run build` repeats typechecking and writes `dist/`. `npm run preview` serves that build at `http://127.0.0.1:4173`. Both servers require their configured port to be free. `npm test` runs Vitest once; `npm run test:watch` watches during development.

For the scaffold, a successful typecheck/build, dependency review, honest empty-test result, and runtime preview are setup evidence only. Before filming, remove `--passWithNoTests`, add meaningful behavior tests, and exercise the actual journey, errors, reset, keyboard access, and print output. A successful build alone does not establish those behaviors, accessibility compliance, privacy controls, or competition readiness.

## Deferred systems

Defer hosted deployment, accounts, consent/access-control enforcement, real household storage, invitations, external messages, verified helpers, production audit trails, broad program directories, automatic hazard detection, native capture, GPU reconstruction, 3D, and outcome validation. They need separate requirements and evidence. This demo does not reduce the requirements for a future product; it narrows what is implemented and claimed now.

## Primary references

- [Vite guide](https://vite.dev/guide/) for development/build tooling.
- [Vitest guide](https://vitest.dev/guide/) for the test runner.
- [MDN localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) for origin-scoped storage and API limits.
- [MDN printing](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing) for print styles and native print behavior.
- [2026 Congressional App Challenge rules](https://www.congressionalappchallenge.us/wp-content/uploads/2026/05/2026-CAC-Rules.pdf), especially app functionality and technical contribution requirements, judge access to source/a working app, AI/tool disclosure, and the public 1–3 minute video. Recheck the rules before submission. A video-first build still needs actual demonstrated functionality and significant student work.
