# Local journey and print implementation

Task 3 is implemented locally against the accepted domain API and the storage worker's adapter. This report records worker execution evidence; the primary owns browser, responsive, keyboard, persistence-error, and print-output acceptance.

## Changes

- `src/app/App.tsx` loads validated state through the storage adapter, renders meaningful workflow sections, and applies only successful domain commands. A synchronous current-state ref prevents rapid events from reading an obsolete render. Saving occurs in the command event handler, never in a React updater or mount effect. Loading/print preparation does not write storage; reset uses the adapter without a follow-up save. Storage recovery messages and command errors remain visible and announced.
- `src/app/WorkflowSections.tsx` supplies labeled native checklist/criterion selects, separate guarded concern confirmation, computed grouped plans with explanations, local request creation/status/completion/reopen controls, and read-only inactive history. There are no free-text inputs or real household data fields.
- `src/app/display.tsx` centralizes user-facing status labels and source notices.
- `src/lib/print.ts` clones and recursively freezes a `PrintSnapshot` with a UI-generated ISO timestamp. A snapshot is isolated from later commands.
- `src/app/PrintReport.tsx` renders a dedicated inspectable report with confirmed-plan evidence, authored order explanations, human confirmation times, fictional program/source labels, every criterion result, local family attribution, completion uncertainty, inactive history boundaries, and evidence limits.
- `src/styles/base.css` adds modest responsive layout, visible keyboard focus, readable controls, and native print styling. The original visual approach and system font remain. `index.html` now names the functioning local synthetic demo.

The print preview starts as the loaded state. Explicit changes mark it stale until refreshed. “Print current report” refreshes synchronously before `window.print()`. A cleaned-up `beforeprint` listener also refreshes the snapshot for browser-menu/keyboard printing. The report is not saved in browser storage. Opening native printing does not claim that a PDF was saved or verified.

## Executed checks

- `npm test`: **2 files, 146 tests passed** (50 domain, 96 storage).
- `npm run typecheck`: **passed** after the final markup changes.
- `npm run build`: **passed** after the final markup changes.
- Final Vite output: initial JavaScript **256.27 kB raw / 78.17 kB gzip**, CSS **4.17 kB raw / 1.49 kB gzip**. JavaScript is below the **250 KiB gzip** budget. This is bundle-size evidence, not a latency measurement.
- `git diff --check`: **passed** for tracked changes.

No dependencies, lockfile edits, commits, deployments, uploads, or external messages were added by this task. Domain/storage logic was not changed for UI integration. The `core-engine-report.md` report was completed before beginning Task 3.

## Repeatable review path and locators

1. Click **Reset synthetic demo**. Expect two unknown checklist answers, zero confirmations/actions/requests, the authored fictional first criterion met and second unknown, and a reset-specific storage message. Reset should remove only `fixlist:demo:v1`.
2. Set `#rug-check` (label **Does a rug edge obstruct the walking route?**) to value `yes`. Expect no action until clicking accessible button **Confirm concern: Review the rug placement**. The cord equivalent is `#cord-check` and **Confirm concern: Review the cord route**.
3. Inspect `#plan`: one real computed action with selection/order explanations and selected authored evidence. Use **Remove confirmation: Review the rug placement** or change `#rug-check` to `no`/`unknown` to verify removal. Returning to yes alone must not restore confirmation.
4. In `#assistance`, use `#fictional-maple-support-fictional-area` and `#fictional-maple-support-fictional-residency` with values `met`, `not_met`, or `unknown`. The second control is labeled **Has answered the fictional residency question**. Expect matched only for met/met, needs information when unknown without failure, and known criterion not met whenever any answer is not_met. Every explanation stays visible.
5. With the rug action active, click **Create local request: Review the rug placement**, then **Record requested: Review the rug placement**, optionally **Record in progress: Review the rug placement**, then **Record family-reported completion: Review the rug placement**. All are accessible button names. Completion must have the fixed family label and an explicit time, with the plan still present.
6. Remove rug confirmation. The request in `#requests` must say **Inactive history**, retain its report, and disable updates. Confirm the concern again to reactivate the action; the retained report must never imply the newly confirmed concern is resolved. **Reopen local record: Review the rug placement** clears completion.
7. Refresh/reload after successful commands to check persistence. Initial mount must not write. Test invalid/unavailable/quota/denied-removal behavior through the primary's controlled browser environment. A failed reset must still clear in-memory workflow state, warn that old data could return on reload, and must not write the reset state automatically.
8. Click **Refresh report preview**, inspect `.print-report` / article **FixList local demo report**, then make a command and confirm the stale-snapshot notice. Click **Print current report**; inspect native output for current state and fresh timestamp. Test browser-menu/keyboard print separately for `beforeprint` handling. All interactive app content is hidden in print media; the report remains.

Navigation anchors are `#checklist`, `#plan`, `#assistance`, `#requests`, and `#print-preview`. A **Skip to demo** link targets the focusable main region. Native controls follow DOM order; disabled confirmation/history controls provide visible reasons. At widths below 40rem, room cards stack and action rows become full-width buttons.

## Remaining validation and limitations

This worker did not drive a browser, iOS simulator, screen reader, native print dialog, or saved PDF. Browser console behavior, actual wide/narrow layouts, complete keyboard operation, persistence/reload/reset/error flows, and print pagination are awaiting the primary's execution evidence. The `beforeprint` path is implemented, not yet proven across browsers. The in-page report can be long; it deliberately retains all uncertainty/history disclosures.

The demo remains entirely synthetic and local. It establishes no independent repairs, real assistance applicability, authenticated helper contact, complete home assessment, public deployment, measured user outcome, or submission readiness. Student technical contributions and understanding still need to be documented truthfully before submission.

## Primary follow-up

Astra completed the separate browser/device/print checks in [validation-2026-10-17.md](validation-2026-10-17.md). Native PDF review found an ambiguous current status beside a completed report. The same worker corrected screen/report wording to lead with “Family reported complete (unverified)” and label the retained stage “Pre-completion stage”; Astra inspected the fix and final PDF. Final measured JavaScript is 78.21 kB gzip; final independent full checks passed. The earlier pending statements above describe the worker handoff, not the final acceptance state.
