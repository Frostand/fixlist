# FixList core workflow implementation plan

> **For agentic workers:** Use subagent-driven-development task by task. Andrew authorized implementation and delegation. The primary performs specification/code/evidence review; do not create review agents by default. Do not commit, push, deploy, or send anything. Work on the current local working branch and preserve owner files.

**Goal:** Turn the scaffold into a repeatable, tested local demonstration of evidence, explicit confirmation, computed actions, transparent screening, and family-reported follow-through.

**Architecture:** Keep the existing React/TypeScript/Vite app. Implement the business rules as pure functions, with a small state-command boundary and a separate runtime-validated storage adapter. React renders computed results; no plan, eligibility result, or completion claim is stored as authoritative derived data.

**Tech stack:** Existing exact dependencies; Node 24.18.0, npm 11, TypeScript, React, Vitest, browser storage and native print.

## Global constraints and decisions

- Preserve `assets/icon.svg`, the body of `fixlist-plan.md`, and owner `.claude/` files. No commits, branch promotion, PR, deployment, external send, upload, or dependency additions.
- No server, accounts, database, native capture, 3D, automatic assessment, or external API. Focus on business logic and actual software behavior, with minimal semantic UI using the existing CSS approach.
- Synthetic data only. No free-text fields accepting household details. Use fixed fictional family/helper labels; persist only known IDs, enums, booleans and validated timestamps.
- Checklist answers are `unknown | yes | no`. An answer does not constitute confirmation. Confirmation requires `yes` for every checklist item backing the concern. Changing an answer away from `yes` revokes dependent confirmations in the same transition.
- Only explicitly confirmed concerns enter the computed plan. Group multiple concerns for one reference action. Order by authored reference-action catalog position, then stable IDs; describe this as demonstration review order, not a validated risk score. Include evidence and an explanation of selection/order.
- Missing assistance facts remain `unknown`. Any `not_met` takes precedence over unknown, then unknown over all-met. Empty criteria produce `needs_information`. Keep all criterion explanations visible even when one failure determines the overall result. `criteria_matched` never means approval or guaranteed funding.
- Requests are records only. Only active plan actions can have requests created/updated. Creation produces a draft and unconfirmed completion. Allow draft → requested → in progress, with explicit family-report attribution. Completion requires requested/in-progress, a separate explicit command, and family attribution/time. Reopening clears completion. No action silently sends anything.
- Retain request history when its action leaves the plan; derive an inactive label and disallow updates until the action is active again. A retained family report never proves a newly confirmed concern is resolved. Print must expose this history boundary if included.
- Storage key exactly `fixlist:demo:v1`; schema version 1. Strictly validate the entire envelope and cross-field invariants before loading. Reject unknown versions, IDs, keys, duplicate request/action IDs, unexpected strings, impossible confirmations, unsupported dates/statuses, and oversize data. Never load catalog/evidence/markup from saved state. Reconstruct trusted data from fixtures.
- Catch storage read/write/remove errors and show truthful in-memory fallback. Reset removes only this key and resets in-memory state even if removal fails; show when reload could restore old data. Do not auto-write on mount or after failed reset. Never call `localStorage.clear()`.
- Use native `window.print()` with dedicated printable markup and `@media print`. Include synthetic/provenance labels, confirmed actions, screening uncertainty, family report attribution, generation timestamp, and the app's evidence limits. Printing is distinct from verification of PDF output.
- Required checks: meaningful domain/storage tests, strict typecheck, build, actual wide/narrow/keyboard browser journey, persistence/reload/reset/error recovery, and print inspection if supported. Review initial JS against 250 KiB gzip budget. No clinical, security certification, user outcome, or latency claims.

## Shared interfaces

Keep original source/evidence types in `src/domain/types.ts`. Add workflow types in `src/domain/workflow.ts` and re-export as useful. `DemoState` contains `schemaVersion: 1`, `scenarioId`, `checklistAnswers: Record<string, ChecklistAnswer>`, `confirmations: Record<string, HumanConfirmation>`, `criterionAnswers: Record<string, Record<string, CriterionStatus>>`, and `requests: readonly FamilyRequest[]`. No stored computed plan.

```ts
createInitialState(scenario: DemoScenario): DemoState
applyCommand(scenario: DemoScenario, state: DemoState, command: DemoCommand): CommandResult
computePlan(scenario: DemoScenario, state: DemoState): readonly PlanItem[]
screenProgram(program: AssistanceProgram, answers: Readonly<Record<string, CriterionStatus>>): ScreeningResult
```

`CommandResult` is `{ ok: true; state: DemoState } | { ok: false; error: string }`. Commands are discriminated by `type`: `answer_checklist` (`checklistItemId`, `answer`), `confirm_concern` (`concernId`, `at`), `unconfirm_concern` (`concernId`), `answer_criterion` (`programId`, `criterionId`, `answer`), `create_request` (`referenceActionId`), `set_request_status` (`requestId`, `status`), `complete_request` (`requestId`, `at`), `reopen_request` (`requestId`). Family/helper identity comes only from fixed synthetic constants. Workers may refine exports once, then report the exact interface before integration starts.

## Task 1: Pure workflow engine and executable rules

**Owner:** Sol implementation worker. **Files:** `src/domain/**`, `src/data/demo-scenario.ts` only if required, `package.json` test script. No UI/storage/doc edits.

- [x] Write focused Vitest tests for empty start, answer without confirmation, confirmation preconditions, independent concern changes, revocation, action grouping/stable order, immutable transitions, invalid IDs/times, all screening combinations (including empty/missing), valid request transitions, completion/reopen, and inactive history.
- [x] Implement the shared interfaces as small pure modules. No browser dependency or hidden clock; timestamp commands receive ISO strings. Initial state is a fresh copy; fixture state remains unchanged. Reset begins with no confirmations or workflow-created requests (prefer no initial draft in mutable state; original authored fixture can remain as reference).
- [x] Ensure expected behavior can be expressed directly:

```ts
const start = createInitialState(demoScenario);
expect(computePlan(demoScenario, start)).toEqual([]);
expect(applyCommand(demoScenario, start, {
  type: 'confirm_concern', concernId: 'rug-concern', at: '2026-10-17T04:00:00.000Z'
}).ok).toBe(false);
expect(screenProgram({ ...demoScenario.programs[0]!, criteria: [] }, {}).status)
  .toBe('needs_information');
```

- [x] Remove `--passWithNoTests`. Run `npm test -- src/domain` and `npm run typecheck`; report actual counts and any negative case not covered. Write `docs/core-engine-report.md` with API summary and evidence, then notify primary. Do not commit.

## Task 2: Runtime validation and browser storage

**Owner:** Sol worker after Task 1 interface is available. **Files:** `src/lib/demo-storage.ts`, `src/lib/demo-storage.test.ts`, `src/lib/README.md`; read domain modules, do not change them without coordination.

- [x] Export `validateState(value: unknown, scenario: DemoScenario)` returning a valid reconstructed `DemoState` or a descriptive validation failure, never a cast of arbitrary JSON. Validate fixed synthetic labels/source records and every state invariant. Bound serialized input (64 KiB maximum is ample for this fixture).
- [x] Export small injected adapters `loadDemoState(storage, scenario)`, `saveDemoState(storage, scenario, state)`, `resetDemoState(storage, scenario)` with explicit result statuses/messages, supporting absent/unavailable storage and caught exceptions. A narrow `getItem/setItem/removeItem` interface permits fakes; acquisition of `window.localStorage` may itself throw and belongs in a guarded browser helper.
- [x] Test valid round trip, absent key, malformed JSON, null/arrays, unknown version/scenario/ID/key, invalid attribution/date, inconsistent confirmation/request state, oversize payload, quota errors, denied reads, denied deletes, fresh reset, and an unrelated key surviving reset.
- [x] Run `npm test -- src/lib` and typecheck; report evidence to primary in `docs/storage-report.md`. Do not commit.

## Task 3: Minimal working journey and native print

**Owner:** Sol worker after domain acceptance and storage interfaces stabilize; acceptance follows integration with the completed adapter. **Files:** `src/app/**`, `src/styles/**`, `src/lib/print.ts` if needed, `index.html` title/meta. No domain/storage changes without coordination.

- [x] Render the synthetic text rooms and existing observations with labeled native answer controls. Confirmation is a separate button, disabled until required answers are yes. Render computed plan with selected evidence, review-order explanation, and remove-confirmation controls.
- [x] Render criterion selectors and all individual/overall results with fictional labels. Provide local request buttons, allowed status transitions, explicit completion and reopen actions. Retained inactive request history must be labeled and immutable.
- [x] Load once safely, apply validated commands, persist successful edits with honest status, recover in-memory from storage errors, and expose reset without clearing unrelated keys. No arbitrary user text or real personal details.
- [x] Add native print action and dedicated print report. On narrow screens avoid horizontal scroll; use visible focus, semantic headings/labels, status announcements, and readable contrast. Keep visual design small and reuse plain CSS.
- [x] Run typecheck/build and tests. Primary drives the actual browser journey, reload/reset, narrow layout, keyboard, errors and print. Report UI limitations in `docs/journey-report.md`. Do not commit.

## Task 4: Evidence review, architecture decision and handoff

**Owner:** Astra primary. **Files:** `docs/architecture.md`, `docs/product-validation.md`, `docs/validation-2026-10-17.md`, `docs/video-shot-list.md`, `docs/ai-disclosures.md`, `README.md`, `AGENTS.md` current-state paragraphs only.

- [x] Independently inspect diffs and run required checks. Fix found failures through the appropriate worker and verify covering evidence.
- [x] Recheck close product precedents and relevant source material; document a bounded product hypothesis, strongest baseline, observable metrics, and continue/pivot/stop gate. Keep real programs out until their applicability can be established.
- [x] Use the T3 collaborative browser for desktop/mobile viewport inspection. iOS simulation is optional only if it adds evidence beyond responsive browser checks. Save local artifacts under ignored `recordings/` where supported.
- [x] Record implemented vs verified vs untested boundaries, actual assistance, remaining student work, and an exact repeatable rehearsal path. Leave no implied public release, submission, or real-world outcome.

## Progress

- Baseline: Node 24.18.0/npm 11.16.0; exact `npm ci` succeeded; test suite empty before implementation. Working branch `codex/fixlist-core-2026-10-17`; pre-existing `.claude/` is owner content.
- 2026-10-17: Plan approved for execution by the user's unattended-work instruction. Pure engine task begins first; persistence and UI follow the agreed interfaces. Acceptance remains with Astra.
- Task 1 accepted by Astra after source/test review, independent 50-case domain run, typecheck and diff check. No commit. `docs/core-engine-report.md` records the exact API. Storage and UI work now use that stable contract in disjoint files; combined browser acceptance remains pending.
- Task 2 accepted by Astra after adapter/test review, independent 96-case storage run and typecheck. The suite includes 5,184 command-built fixture combinations crossing confirmation, request history and criterion states. `docs/storage-report.md` records scope and limits. Browser fault injection is still required for UI error-message acceptance.

- Tasks 3 and 4 accepted by Astra after source review, final 146-test/typecheck/build execution, desktop state/fault/keyboard/narrow checks, actual two-page native PDF inspection, and the bounded iOS Safari confirmation/reload/withdrawal path. A completed-report wording ambiguity was corrected and rechecked. `docs/validation-2026-10-17.md` is the final evidence ledger. The broader product, student authorship and public release gates remain open.
