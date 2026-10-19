# Core engine implementation evidence

Task 1 is implemented locally. This report covers pure domain behavior only; the primary still owns independent acceptance and browser/storage integration.

## Changes and public API

`src/domain/workflow.ts` is the shared import surface. It exports:

- Types: `ChecklistAnswer`, `DemoState`, `DemoCommand`, `CommandResult`, `PlanItem`, `CriterionResult`, `ScreeningResult`, and `RequestView`.
- Main functions: `createInitialState(scenario)`, `applyCommand(scenario, state, command)`, `computePlan(scenario, state)`, `screenProgram(program, answers)`, and `getRequestViews(scenario, state)`.
- Shared validation/identity helpers: `canConfirmConcern`, `getRequiredChecklistItemIds`, `isConfirmedConcern`, `isChecklistAnswer`, `isCriterionStatus`, `isIsoTimestamp`, and `requestIdForAction`.
- Fixed synthetic constants: `FAMILY_LABEL`, `HELPER_LABEL`, `REQUEST_NOTE`, `REQUEST_SOURCE`, and `REQUEST_HISTORY_NOTICE`.

`DemoState` contains only the specified version/scenario IDs, checklist answers, confirmations, criterion answers, and family requests. There is no authoritative stored plan or screening result.

`PlanItem` has `referenceActionId`, `referenceAction`, `concernIds`, `evidence`, `catalogPosition`, `selectionExplanation`, and `orderExplanation`. Catalog position is one-based demonstration review order. Confirmed concerns group under their reference action; concern/evidence IDs sort deterministically and evidence is deduplicated. Selection requires a nonempty evidence chain, existing evidence/checklist/action IDs, matching checklist/action references, all backing answers of yes, and explicit fixed-family confirmation with a valid supplied timestamp.

`ScreeningResult` has `programId`, `status`, `criteria`, `explanation`, and `disclaimer`. Each criterion has `criterionId`, `description`, `status`, and `explanation`. Failure takes precedence over unknown, unknown over all-met; no criteria means information is needed. Missing answers always remain unknown, even when the authored program contains a sample default.

`RequestView` has `request`, `active`, `activityLabel`, and `historyNotice`. It is derived without modifying the stored request. Completion never removes a plan action or resolves a concern, including after reactivation.

## Transition decisions

- Initial checklist answers are unknown, all confirmations are false, and workflow requests are empty. Authored criterion sample statuses are copied into fresh answer maps. The authored request draft remains reference data only.
- Checklist yes does not confirm anything. Confirmation is a separate command. Changing a backing answer to no/unknown clears dependent confirmation in the same transition; returning to yes requires another explicit confirmation.
- Request IDs are `request-${referenceActionId}`. One retained request exists per action, including inactive history. New records contain only the fixed fictional labels, note, synthetic source, draft status, and unconfirmed completion.
- Status moves only draft → family-reported requested → family-reported in progress. Completion requires requested/in-progress plus an explicit command/time. Reopening clears completion and preserves the current request status. Completed requests must be reopened before other updates. Inactive history cannot be updated until its action is active again.
- Domain commands require canonical UTC timestamps of the form `YYYY-MM-DDTHH:mm:ss.sssZ`. Timestamp validation converts only supplied values; no function reads the current clock or uses browser APIs.
- Commands return descriptive errors for invalid IDs, answers, lifecycle edges, and timestamps. Inputs are not mutated. The command interface expects validated state; untrusted saved JSON requires Task 2's full validator.

## Executed validation

Environment: Node 24.18.0, npm 11.16.0. No dependencies were added and the lockfile was unchanged.

- Initial test execution failed because `workflow.ts` had not yet been implemented.
- Final `npm test -- src/domain`: **1 file, 50 tests passed**.
- Final `npm run typecheck`: **passed**.
- `git diff --check`: **passed** for tracked changes.

The tests cover empty/reset-ready start, fresh state allocation, separate confirmation, all backing checklist preconditions, independent changes, revocation, deterministic grouping/evidence/order/explanations, malformed trusted catalogs, all nine two-criterion status combinations, empty/missing criteria, local request lifecycle/completion/reopen/inactive history, invalid IDs/timestamps/enums, and every successful command against recursively frozen inputs. Self-review found a terminal-state `null` marker could accept an invalid runtime null status; a focused regression test reproduced the failure before the guard was corrected, and the final suite includes that case.

## Limits and handoff

No browser flow, persistence, print output, deployment, real-program applicability, independent repair verification, or outcome measurement was tested by this task. The engine does not validate arbitrary catalog ingestion or the entire runtime state; catalogs are trusted authored inputs, with focused fail-closed chain handling, and saved state must pass the separate storage validator. Runtime command object shape validation beyond the typed interface and selected defensive guards belongs at any future untrusted command boundary.

The only existing-file changes are the temporary empty-suite flag removal in `package.json` and two now-current type comments. Domain modules/tests and this report are new files. No fixture edits, commits, uploads, or external actions occurred; owner `.claude/`, `assets/icon.svg`, and `fixlist-plan.md` were not edited.
