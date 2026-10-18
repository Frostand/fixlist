# Fact profiles and expanded catalog report

Implemented October 17, 2026 as Task 2 after primary acceptance of the isolated fact engine. This task changes the typed fixture/domain, browser sections, shared screen/report components, stylesheet, relevant tests and this report. Storage work belongs to the separate worker; `src/lib/print.ts` did not need a change. No dependency, backend, external send, commit or deployment was added.

## Stable state, fixture and command interfaces

`DemoState` now has exactly these fields:

```ts
interface DemoState {
  readonly schemaVersion: 2;
  readonly scenarioId: string;
  readonly checklistAnswers: Record<string, 'unknown' | 'yes' | 'no'>;
  readonly confirmations: Record<string, HumanConfirmation>;
  readonly profileId: string;
  readonly requests: readonly FamilyRequest[];
}
```

`createInitialState(scenario)` initializes all eight answers unknown, every concern unconfirmed, `profileId: 'unknown-profile'`, and no requests. State contains no facts, profile objects, sources, rule trees, criterion answers or derived results. The new command is `{type:'select_profile',profileId:string}`; unknown IDs fail. The old `answer_criterion` command is removed and rejected at runtime. Existing checklist, confirmation and local-request command contracts and attribution constants are preserved.

Scenario ID remains `fictional-maple-house`. Fixture schema version is 2. These identities were published as stable before the storage worker began:

| Room | Checklist ID | Concern ID | Evidence ID | Action ID |
| --- | --- | --- | --- | --- |
| living-room | rug-check | rug-concern | rug-observation | review-rug |
| hallway | cord-check | cord-concern | cord-observation | review-cord |
| stairs | stair-clutter-check | stair-clutter-concern | stair-clutter-observation | review-stair-clutter |
| stairs | handrail-check | handrail-concern | handrail-observation | review-handrail |
| stairs | stair-lighting-check | stair-lighting-concern | stair-lighting-observation | review-stair-lighting |
| bedroom | night-lighting-check | night-lighting-concern | night-lighting-observation | review-night-lighting |
| bathroom | shower-surface-check | shower-surface-concern | shower-surface-observation | review-shower-surface |
| bathroom | bathroom-support-check | bathroom-support-concern | bathroom-support-observation | review-bathroom-support |

`ChecklistItem` adds `roomId`. `ReferenceAction` adds `guidance:{title,url,section,reviewedOn}`, nonempty `fundingTags`, `helpRouting:{kind:'family_review'|'professional_review',explanation}`, and `cost:{status:'unknown',explanation}`. Funding tags are exactly `general_repair | railing | bathroom_support | lighting`. Handrail, stair electrical lighting and bathroom support use professional review. Other actions use family discussion/review. Neither routing choice authorizes repairs or establishes qualifications.

The existing rug and cord IDs, prompts, observations, action titles and meanings are preserved. The eight action catalog positions remain authored review order, never a validated risk score. All costs are unknown. Confirmation/withdrawal and retained-history behavior remain enforced; family-reported completion never removes an action or verifies a repair.

## Profiles and screening queries

`scenario.factDefinitions` is the fixed allowlist `ageYears` (integer 0–120 years), `annualIncomeUsd` (integer 0–1,000,000 USD/year), `area` (`maple|cedar`), `homeowner` (boolean), and `resident` (boolean). `scenario.profiles` contains `FictionalProfile = {id,label,fictional:true,facts:FactValues}`. Every displayed profile name explicitly says fictional.

| Profile ID | Facts / variation | Support result | Lighting result |
| --- | --- | --- | --- |
| unknown-profile | No facts supplied | needs_information | needs_information |
| maple-owner | age 70; income 20,000; maple; homeowner/resident true | criteria_matched | criteria_matched |
| maple-renter | Owner profile with homeowner false | known_criterion_not_met | criteria_matched |
| incomplete-maple | Owner profile with homeowner/resident null | needs_information | needs_information |
| outside-area | Owner profile with area cedar | known_criterion_not_met | known_criterion_not_met |
| over-income | Owner profile with income 60,000 | known_criterion_not_met | known_criterion_not_met |
| boundary-maple | Owner profile with age 65; income 30,000 | criteria_matched | criteria_matched |

`getSelectedProfile(scenario,state): FictionalProfile|null` resolves only a trusted fixed profile. Profile selection changes only `profileId`; answers, confirmations and active/inactive family history are preserved.

`AssistanceProgram` replaces manual `criteria` with `rule:FactRule`, `coverageTags:readonly FundingTag[]` and `unmodeledRequirements:readonly string[]`. Both fictional records retain synthetic provenance, no contact, no verification date and explicit statements that they do not exist:

- `fictional-maple-support`: all(area=maple, age≥65, income≤30,000, homeowner=true), with general repair/railing/bathroom support categories.
- `fictional-maple-lighting`: all(area=maple, income≤45,000, any(homeowner=true, resident=true)), with lighting coverage.

`screenProgram(program,definitions,facts): ScreeningResult` returns `programId`, the existing `ScreeningStatus`, `ruleResult:RuleResult|null`, `error:string|null`, explanation, disclaimer and unmodeled requirements. Invalid definitions/facts produce a visible unavailable explanation, null rule result and `needs_information`, never a match. A valid tree retains every nested condition, including unknowns inside a decisive group.

`computeWorkRelevance(program,plan): ProgramWorkRelevance` returns `status:'relevant'|'not_relevant'|'no_confirmed_work'`, stable `matchedActionIds`, deduplicated `matchedTags`, and an explanation. Its inputs are the current confirmed plan and authored program categories, independent of applicant criteria. Relevant work never hides a failure/unknown or implies actual coverage/approval.

`computeCoverage(scenario,state): ChecklistCoverage` returns `total,answered,unknown,yes,no`, per-room counts with `roomId/roomName`, and the assessment-limit disclaimer. Only current yes/no answers count as answered; missing answers remain unknown. Confirmation and family completion do not affect coverage. Both empty/incomplete and fully answered sample states retain the limits of this checklist.

`validateCatalog(value:unknown): {ok:true}|{ok:false,error:string}` checks exact supported shapes, plain data properties, IDs/uniqueness, room/evidence/checklist/concern/action cross-links, funding/routing/cost metadata, source/reference separation, fixed unknown profile, all profiles' facts and every program rule. The browser app gates the journey on successful catalog validation. Empty authored request templates are required; local request records belong to state. This validator covers the trusted synthetic catalog, not a future general program ingestion API.

## Guidance provenance and screen/report behavior

Read the CDC's [2017 Check for Safety checklist](https://www.cdc.gov/steadi/pdf/steadi-brochure-checkforsafety-508.pdf), page 2, on October 17, 2026. The referenced topics are floors/rugs/cords; stairs/clutter/handrails/lighting; bedrooms/night path; and bathrooms/slippery surfaces/support. Reference objects are separate from the synthetic sources on observations/actions. These checklist topics do not validate invented observations, routing decisions, costs, ordering or fictional program categories.

One native labeled selector chooses a fictional profile; the five facts are read-only. Both programs display nested explanations, all/any meaning in ordinary language, unmodeled requirements, synthetic provenance and work relevance. Coverage is shown globally and by room. Confirmed action cards include room, review context, unknown cost and reference guidance.

`CatalogViews.tsx` shares the content across browser and native-print reports. The print report includes current coverage, selected fictional profile/facts, all rule explanations, work relevance, confirmed action metadata, sources and retained-history limits. Professional-review context also appears beside active/inactive local family records on screen and print; the unchanged fixed helper label is explicitly not qualification. Existing current-state `beforeprint` snapshot refresh remains intact. The UI treats storage's `migrated` status as informational and displays its exact message.

## Validation evidence

Environment: Node 24.18.0, npm 11.16.0. Exact dependencies and lockfile preserved.

- `npm test -- src/domain`: **250 passed**, 3 files.
- `npm test -- src/domain src/app/catalog-views.test.tsx`: **255 passed**, 4 files after adding five bounded server-render tests.
- `npm test`: **387 passed**, 5 files with the separate storage worker's current implementation, final tool run at 08:51:33 on October 17.
- `npm run typecheck`: passed after domain/UI changes; subsequent production build also completed TypeScript compilation including the render tests.
- `npm run build`: passed. Vite 8.3.4 reported JavaScript **284.63 kB / 85.63 kB gzip**, CSS **4.63 kB / 1.62 kB gzip**. The displayed JavaScript gzip size is below the 250 KiB budget; this is not a measured latency claim.
- `git diff --check`: passed at the domain/UI validation point. New untracked source/tests require direct primary inspection in addition to Git's tracked-file diff.

Tests cover each of eight concerns deriving only after confirmation, every action's revocation to both no/unknown, authored ordering/grouping, conservative metadata, every program/profile result, nested unknown retention, invalid evaluation, profile/history independence, answer-only coverage, relevance independent of criteria, invalid catalogs and getter-free validation. Existing meaningful two-concern command, lifecycle, immutability and inactive-history cases were preserved; obsolete manual-status tests were replaced by fact-derived program cases. The existing helper intentionally confirms the two original concerns for its bounded lifecycle cases; separate tests cover every expanded concern and all-eight ordering.

Five server-render checks verify initial incomplete/unknown states with exactly one profile control, all eight printed cost/source/action contexts, selected boundary facts and nested rules, relevant work with a known failure, inactive professional-review family records, and visible invalid-screening errors. These check content, not rendered layout or native printing.

## Remaining acceptance boundary

No known focused-test, full-suite, typecheck or build failure remains. Primary review of changes and browser execution remains required: profile transitions, keyboard/narrow layout, current snapshot, native multi-page print pagination and the storage worker's exact legacy migration. Server rendering and a build do not establish those outcomes. No recording, real program verification, household assessment, helper qualification, physical repair, funding outcome or submission readiness is claimed.

## Print pagination follow-up

After the primary's successful browser checks, its native PDF with the incomplete fictional profile, eight confirmed actions and two family records showed excessive whitespace, a split profile box and a footer-only last page. This bounded follow-up changes **only the existing print media block in `src/styles/base.css`** and this report. All content, screen styles, state and browser behavior are preserved.

Exact print changes:

- Keep the root at **10 pt** and reduce line height from 1.6 to 1.35. Override the inherited smaller source notes, small text, eyebrow and footer to **1 rem / 10 pt**, preserving a 10 pt minimum.
- Compact paragraph margins to 0.35 rem; section starts to 0.8 rem; article padding/gaps to 0.4/0.6 rem; list/definition-list margins to 0.4 rem; list-item gaps and heading-after space to 0.3 rem; definition gaps to 0.35 rem. Rule paragraphs, metadata separators and bordered summary boxes have proportional compact print spacing.
- Allow action articles and list items to flow across pages instead of forcing each complete action onto a fresh page. Keep headings and rule labels with following content, and request three-line paragraph widows/orphans where the browser can honor them.
- Keep the short selected-profile box and its fact pairs together; also keep the short coverage summary together.
- Keep the footer together, reduce its preceding margin/padding to 0.5/0.4 rem, and discourage a break immediately before it. This is a pagination preference, not a guarantee of a fixed page count.

Read-only visual inspection used the existing page renders; no PDF was authored or overwritten by this worker. `npm run build` passed; `npm test -- src/app/catalog-views.test.tsx` passed **5 tests**; scoped `git diff --check` passed. Vite reported unchanged JavaScript **284.63 kB / 85.63 kB gzip** and CSS **5.54 kB / 1.76 kB gzip**. The primary must re-export the same saved state and inspect the resulting native pages before accepting this spacing/pagination change; no reduced page count is claimed from the build or render-content tests.
