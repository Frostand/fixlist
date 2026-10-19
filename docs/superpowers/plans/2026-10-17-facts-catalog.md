# Fact screening and concern catalog implementation plan

> **For agentic workers:** Use subagent-driven-development. Andrew explicitly authorized implementation. The primary performs specification, code and evidence review. Work in the existing feature branch with its uncommitted accepted core; no commits or new worktree. Preserve owner files. Do not substitute skill defaults for these instructions.

**Goal:** Replace manually assigned fictional criterion statuses with explainable facts-to-rules screening, then expand the synthetic scenario to eight concerns with useful provenance, coverage and work-relevance information.

**Architecture:** Extend the existing pure TypeScript domain; evaluate trusted fictional programs against allowlisted fictional profile facts. Persist editable workflow state and a profile ID only. Strictly migrate the exact old two-concern schema in memory to the new eight-concern schema; render the same derived results on screen and in native print.

**Tech Stack:** Existing React/TypeScript/Vite/Vitest, native controls, browser storage and printing. Node 24.18.0/npm 11. No added dependencies.

## Global constraints

- Preserve `assets/icon.svg`, all of `fixlist-plan.md`, npm lockfile and owner `.claude/` content. No commit, branch promotion, PR, deploy, upload or external contact.
- Keep one local synthetic browser app; no server, authentication, real household input, real programs, medical/financial outcome claims, hardware capture or vision.
- Only explicitly confirmed concerns enter plans. Answers away from yes revoke confirmation. Family completion never verifies repair or removes a plan action. Inactive history stays read-only.
- Storage key stays exactly `fixlist:demo:v1`; new envelope `schemaVersion: 2`. No persisted facts, source text, profile objects or derived screening results. Strict 64 KiB boundary, exact shapes/IDs, known fictional profile ID, trusted reconstruction, read-only load/migration, truthful errors, and reset only this key.
- All/any preserve unknown and all child explanations. Malformed definitions/facts cannot produce a match. No empty logical group is accepted.
- Fictional observations/programs retain synthetic source status and no verification date. Separately attribute the CDC checklist as reference material; do not imply it validates invented costs, routing policy, rankings or observations.
- All cost estimates remain explicitly unknown. Review order remains authored, not a validated risk score. Help-routing is conservative context, not certification.
- Native print must preserve coverage, selected fictional profile, rule explanations, work relevance, sources and retained-history limits. Initial JS budget remains 250 KiB gzip.

## Task 1: Pure fact rule engine

Owner: Sol. Files: new `src/domain/fact-screening.ts` (split validator if justified), `src/domain/fact-screening.test.ts`, `docs/facts-engine-report.md`. Do not edit existing workflow/types/UI/storage yet.

Interface to produce: exported typed `FactDefinition`, `FactValues`, `FactRule`, `RuleResult`, and `evaluateFactRule(rule: unknown, definitions: readonly FactDefinition[], facts: unknown)` returning `{ok:true,result:RuleResult}` or `{ok:false,error:string}`. `RuleResult` includes rule ID/label, `met|not_met|unknown`, explanation and every child result. Rules use stable IDs, labels, `eq/gte/lte` leaves with `factId` and typed value, or `all/any` groups with children. Definitions support boolean, bounded finite number (label and unit, integer option), and enum (allowlisted strings). Facts are plain data objects of known keys with typed values or null; missing/null is unknown. Unknown keys, wrong types, nonfinite/out-of-bounds numbers are invalid inputs. No arbitrary expression execution.

- [x] Write meaningful tests for all nine ternary pairs per group, nested groups, inclusive numeric boundaries, false/zero preservation, missing vs null, wrong type/key/range, empty/invalid groups, invalid hidden branches, duplicate IDs, unknown fact references, immutability and deterministic explanation trees.
- [x] Validate full registry and full rule tree before evaluation; exact supported shapes, bounded labels/IDs, max depth 8 (root depth 1) and max 64 nodes, reject cycles. Validate compatible operators/value types. Return errors rather than throwing for malformed ordinary JS/JSON inputs; reject accessors/prototype-bearing objects without invoking getters. Proxy objects are outside the JSON boundary.
- [x] Implement all: any not_met wins, then unknown, else met. Any: any met wins, then unknown, else not_met. Evaluate all children, retaining unknowns even when siblings determine the group.
- [x] Run `npm test -- src/domain/fact-screening.test.ts` and `npm run typecheck`. Report exact API and findings in the report file. Primary reviews before next phase.

## Task 2: Profiles, expanded catalog and integrated workflow

Owner: reused Sol after task 1 acceptance. Files: `src/data/**`, `src/domain/types.ts`, `workflow.ts`, `screening.ts`, `plan.ts`, new catalog query/validation helpers and focused tests, `src/app/**`, necessary plain CSS. Storage files belong to the separate task 3 worker once interfaces are frozen.

Choose and publish exact interfaces before starting UI. The new state is `{schemaVersion:2,scenarioId,checklistAnswers,confirmations,profileId,requests}`. Remove the editable `criterionAnswers` and `answer_criterion` command; add `select_profile` guarded against scenario profiles. Initial/reset profile is `unknown-profile`. Profile objects, definition catalog and program rule trees are trusted fixture data, not browser state. Program screening derives from profile facts and returns its rule tree plus current ScreeningStatus and explicit unmodeled requirements.

Use these fictional fact definitions: `ageYears` integer 0..120 (years), `annualIncomeUsd` integer 0..1000000 (USD/year), `area` enum maple/cedar, `homeowner` boolean, `resident` boolean. No free-text or real household facts. Predefined profiles: unknown-profile (all missing); maple-owner (age 70, income 20000, maple, homeowner true, resident true); maple-renter (70,20000,maple,false,true); incomplete-maple (70,20000,maple,null,null); outside-area (70,20000,cedar,true,true); over-income (70,60000,maple,true,true); boundary-maple (65,30000,maple,true,true). User-facing names must clearly say fictional. Profile switches never change checklist confirmations/history.

Two fictional programs: retain `fictional-maple-support` with all(area maple, age>=65, income<=30000, homeowner true), covers general_repair/railing/bathroom_support; add `fictional-maple-lighting` with all(area maple,income<=45000,any(homeowner true,resident true)), covers lighting. Both explicitly do not exist, synthetic source/no contact/no verification date; unmodeled requirements are visible. Show coverage-tag relevance separately from criteria: `relevant|not_relevant|no_confirmed_work`, matched action IDs/tags and explanation. Relevance is only relative to the current confirmed plan; never suppress criteria failure/unknown or imply approval.

Expand to exactly 8 concerns, preserving the two original IDs and meaning. Add three rooms for a total of five: living-room, hallway, stairs, bedroom, bathroom. Keep rug/cord in existing rooms. Add stairs clutter, loose handrail, missing stair lighting, dark bed-to-bath route, slippery shower surface, missing bathroom support. Each has one checklist question, fictional observation, separate confirmation, reference next-step action, funding tags and help-routing metadata. New action IDs: review-stair-clutter, review-handrail, review-stair-lighting, review-night-lighting, review-shower-surface, review-bathroom-support. Use family_review for rug/cord/clutter/night-lighting/shower surface; professional_review for handrail/stair electrical lighting/bathroom support. Family review means discuss the next step, not permission to perform repairs. Every cost is unknown.

Source: CDC 2017 *Check for Safety*, https://www.cdc.gov/steadi/pdf/steadi-brochure-checkforsafety-508.pdf, page 2; read/checked October 17, 2026. Use precise topic labels (floors rugs/cords; stairs clutter/handrails/lighting; bedrooms night path; bathrooms slip/support) with a separate reference object `{title,url,section,reviewedOn}`. Keep synthetic SourceRecord on the authored observations/actions; rendering must distinguish reference guidance from fictional content. Action text should be a concise review/referral step, not installation instructions. No pricing or severity claims.

- [x] Update types, scenario and domain queries; report stable API for task 3. Catalog validation checks unique IDs, room/evidence/checklist/concern/action references, all funding-tag enums, routing enums and supported metadata, program/profile integrity. Do not accept unsupported catalog data silently.
- [x] Add `computeCoverage` with answered/unknown and per-room counts, derived only from current checklist answers. Always distinguish sample checklist answered from a complete home assessment; empty plan with unanswered questions remains explicitly incomplete.
- [x] Update rules tests for eight concerns, every action's derivation/revocation, metadata/routing, grouping/order, profile switching, every program/profile expected result and work relevance independent of criteria. Preserve existing meaningful invalid-command/lifecycle cases.
- [x] Replace manual criterion selects with one native labeled profile selector, a readable facts list and nested rule explanations for both programs. Render all/any meaning without technical implementation jargon. Show unknown facts, unmodeled limits and relevance. No nested selects for computed statuses.
- [x] Update screen/print coverage and action metadata (room, help routing, unknown cost, reference source). Provide initial/empty/incomplete states that never certify safety. Keep all native controls accessible and current print snapshot refresh.
- [x] Run focused domain tests, typecheck/build when storage integration permits. Report implementation and evidence in `docs/facts-catalog-report.md`; primary reviews and exercises browser.

## Task 3: Schema v2 storage and exact legacy migration

Owner: separate Sol after task 2 interfaces stabilize. Files: `src/lib/demo-storage.ts`, focused legacy schema helper if useful, storage tests/README. Do not edit domain/UI owned by task 2. Baseline original source is preserved under `/tmp/fixlist-facts-baseline-2026-10-17/src` for exact old contracts and fixture IDs.

- [x] Strictly validate schema v2 fields, eight known checklist/concern IDs, allowlisted `profileId`, exact request invariants. No criterionAnswers, facts, rule trees or arbitrary text accepted. Preserve storage/error/reset behavior.
- [x] Add exact schema-v1 validator for the original two-concern/one-program shape. Validate all old statuses/keys/confirmations/requests before migration. Preserve the rug/cord answers, confirmations and request records; initialize new answers unknown/new confirmations false and profile unknown-profile. Never infer facts from old met/not_met values. Migration result status/message must explicitly state screening answers were not converted and a fictional profile must be selected. No automatic save/remove on load; next explicit command may persist v2.
- [x] Reject malformed v1, unknown future schemas and partial shapes without overwriting saved bytes. Test repeated loads do not write, successful explicit v2 save/reload, denied save/delete/read, unrelated-key survival, oversized/extra field/profile injection and request-history preservation. Update existing meaningful cases to v2; keep composed-state coverage bounded and relevant instead of exponential 8-concern enumeration. A two-concern cross-product with other concerns unknown plus separate per-concern tests is sufficient.
- [x] Run focused storage tests and typecheck; report in `docs/facts-storage-report.md`.

## Task 4: Acceptance and current documentation

Owner: Astra. Independently inspect source/diffs against the baseline, run full test/typecheck/build/diff checks, and review bundle output. Exercise production build: unknown/boundary/owner/renter/failure profiles; all/any and relevance vs criteria; eight-concern confirmation/coverage; storage reload/reset, exact v1 migration and corrupt-data fallback; keyboard/320px; native print with expanded multi-page content. Reuse prior evidence only where unchanged behavior makes it relevant. Update README, architecture, roadmap/handoff, actual AI assistance, and dated validation with exact results and remaining limits. Original plan/icon/lockfile must retain hashes. No commits/deployment.

## Progress

- Baseline: accepted local core on `codex/fixlist-core-2026-10-17`; source/docs snapshot at `/tmp/fixlist-facts-baseline-2026-10-17`. Node 24.18.0/npm 11.16.0. Existing source and owner files preserved.

- Task 1 accepted: primary inspected engine and test source; independent focused run passed 138 tests after correcting array-valued test rows and strict typecheck. Full-tree validation, ternary semantics, numeric boundaries, malformed hidden branches and purity are covered. Task 2 is now in progress.

- Task 2 state/types and fixture IDs frozen; Task 3 storage worker started in parallel with remaining UI/catalog test work. Actual old browser state with retained completed inactive history is available for migration acceptance.

- Tasks 2 and 3 accepted after primary source/test review and independent execution: 387 tests/5 files, strict build, keyboard profile matrix, all eight concerns, migration/read-only reload/explicit upgrade, corrupt-state recovery/reset, professional request history, 320px and native PDF inspection. A print-only revision reduced the representative full report from 14 to 7 pages while preserving content and a 10pt minimum. All seven final PDF pages were visually inspected; PDFKit extracted no text, so searchable/tagged PDF accessibility is not established. See the current dated validation report.
