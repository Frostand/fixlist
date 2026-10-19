# Routing/navigation worker evidence — 2026-10-18

The assigned code changes are implemented. This is worker evidence for parent review. Browser, VoiceOver, usable printed output and iOS Simulator acceptance remain outstanding. No native packaging or Simulator action was performed.

| Item | Status | Implementation and regression evidence |
| --- | --- | --- |
| N01 | Fixed in code | `PhoneShell.tsx` prevents the skip anchor default and focuses/scrolls the heading through `focus.ts`. `parseRoute` takes the current route as fallback; hash/popstate ignores nonroute fragments. `routes.test.ts` tests route identity preservation; `navigation-ui.test.tsx` tests default prevention, content focus and unchanged source state. |
| N05 | Fixed in code | `navigation-state.ts` persists bounded, validated version-1 invitation drafts under **`fixlist:navigation:v1`**, outside the household schema. Drafts bind resident, request, revision and volunteer. Recovery checks current actor, active plan/request, assignment, professional-work exclusion and volunteer role; the existing domain command revalidates the actual send. Failed writes show an error on review. `navigation-state.test.ts` covers reload, untouched household bytes, invalid/oversized/version-mismatched data, storage failures, changed/removed people, stale revision, wrong actor, inactive/cancelled/assigned/professional work and an actual rejected send. |
| N07 | Fixed in code | `SettingsScreens.tsx` shows general resource links and a clear limitation for nonresidents. It constructs no fallback screening state. `navigation-ui.test.tsx` renders helpers/volunteers with a proxy that throws if private screening inputs are read, and verifies resident screening remains available. |
| N08 | Fixed in code | `launchNavigation` gates fresh deep links at language/person selection, retaining the destination durably through guide completion or explicit skip. Person/destination helpers apply role routing; existing capability guards still protect household views. Fresh-session hash changes cannot bypass selection. `?localScan=` remains an explicit developer exception. `routes.test.ts` covers selection/guide/skip/completion, incompatible volunteer role, saved-session home and scan launch; `navigation-state.test.ts` covers destination persistence. |
| N09 | Fixed in code | Four localized `ResidentScreens.tsx` changes guard a missing concern and rename question Back. `navigation-ui.test.tsx` renders a Yes answer after removing its concern: answers/photos/navigation remain available, confirmation controls are absent, and it does not crash. No domain/catalog edits. |
| N11 | Fixed in code; live checks pending | Help focuses its heading and restores its trigger on close/Escape. Reset uses a labelled native modal dialog, focuses Keep, restores the reset trigger and scrolls within a height bounded above the tab bar. `navigation-ui.test.tsx` covers target helpers and static modal labels/viewport constraints. Real keyboard/VoiceOver/large-text visibility needs runtime checks. |
| N12 | Fixed in code | Resources stores its entry in browser history state, including reload recovery. Its parent and active tab follow that entry; direct links default to Help. Question navigation says Previous question. `routes.test.ts` covers Home/Plan/Help returns and active tabs; `navigation-ui.test.tsx` covers rendered Plan selection and distinct question copy. |
| N15 | Fixed in code; print output pending | `navigationUrl` calls shared `routeHash`. `waitForPrintReady` observes photo readiness/failure, decodes images, and uses one 8-second watchdog. Explicit abort supports Cancel/unmount; cancelled preparation cannot invoke printing. Existing print markup/styles remain. `print-readiness.test.ts` covers readiness, failure, synchronous/asynchronous decode error, timeout, pre-abort, loading/decode cancellation, changed images, cleanup and browser printing. Native pagination/output remains unverified. |
| U07 (assigned code) | Fixed in code; broader qualification pending | Guides use `StartShell` outside tabs/person controls. Skip preserves incomplete progress; dismissed-guide IDs prevent repeated forced guides; Help/More offer Resume. Completed guides can replay. `navigation-ui.test.tsx` covers focused markup, explicit Skip, retained step/incomplete status, Resume without restart and completed-guide replay; `routes.test.ts` covers shell/saved-session decisions. |

## Shared-file edits

Every edit by this worker to `src/app/App.tsx`:

- Imports navigation/draft/readiness helpers and the moved reset dialog.
- Loads the separate navigation record and computes the gated launch/pending destination.
- Maintains route/resource return context; pushes shared serialized routes and return hashes into history state.
- Ignores nonroute fragments and blocks fresh-session fragments from bypassing selection.
- Selects guide versus intended destination after person choice; handles explicit guide completion/skip.
- Replaces React-only invitee state with persisted drafts and current eligibility checks before review.
- Clears this worker's navigation key in the existing reset flow. The reset/storage implementation itself was not changed.
- Excludes guides from the regular tab shell; passes Resources return context to the shell.
- Displays routing-storage errors via the existing error component.
- Moves `ResetConfirmation` to the owned settings module.
- Replaces print polling with scoped readiness, cancellation, duplicate-print protection, preparing/cancel controls and unmount abort cleanup.

`src/app/ResidentScreens.tsx`: optional concern lookup, guarded confirmed-state lookup, concern-gated confirmation controls and the Previous question key. Existing owner photo/other edits were preserved.

`src/app/RequestScreens.tsx`: **no worker edits**. `src/domain/**`: **no worker edits**. No protected storage/controller/scan/native/config/dependency file was edited by this worker. Existing concurrent changes remain.

Other modified files: `routes.ts`, `routes.test.ts`, `PhoneShell.tsx`, `PeopleScreens.tsx`, `SettingsScreens.tsx`, `lib/print.ts`, `lib/native-print.ts`, `i18n/en.ts`, `i18n/es.ts`. New files: `focus.ts`, `navigation-state.ts`, `navigation-state.test.ts`, `navigation-ui.test.tsx`, `lib/print-readiness.test.ts`, the implementation plan and this report.

New English/Spanish keys each occupy one contiguous `// routing-nav` block. Spanish is AI-authored and remains unreviewed by a native speaker; no specific uncertain term was identified.

## Validation

Node **24.18.0**, npm **11.16.0**. Existing dependencies only; no install, upgrade or lockfile change.

- `npm run typecheck`: passed.
- Targeted routing/navigation/i18n/print set: **66 passed in 5 files**.
- `npm test`: **1,047 passed; 156 skipped; 34 files passed and 1 failed suite**. HTTP boundary setup failed at `listen EPERM: operation not permitted 127.0.0.1`. This is incomplete, not a full-suite pass.
- `npm test -- --exclude src/lib/local-scans-boundary.test.ts`: **1,047 passed in 34 files**.
- `npm run build`: passed. Initial JS **157.03 KiB gzip**, within 250 KiB budget. Existing lazy ScanViewer chunk **1,036.56 KiB gzip** retains the large-chunk warning.
- `git diff --check`: passed.

Required parent/runtime checks: keyboard skip on an answered question; Help close/Escape return; reset at 320px, large text and Spanish with focus above tabs; first-install resident/volunteer deep links plus Skip/Resume; review reload/send; Resources Back/browser Back/active tab; printing with loaded/missing photos, cancellation and readable pages. Repeat relevant paths in the Capacitor iOS Simulator with VoiceOver. Native printing/pagination are not established by tests/build.

## Boundaries and assistance

This bounded Codex worker AI-authored the implementation, tests, translations, plan and report. No further agent/model runs, external sends, uploads, commits, branch/history writes or native packaging occurred. Parent acceptance remains required.

Scope mistake corrected: temporary comparison copies were briefly created under `/private/tmp/fixlist-routing-baseline`, despite the worktree-only instruction. All three copies and their directory were removed. Implementation and final review artifacts are in this worktree.
