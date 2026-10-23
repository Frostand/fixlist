# Facts and catalog acceptance — October 17, 2026

Accepted local scope: fact-based screening using fixed fictional profiles, then an expanded concern/action catalog. This report supersedes the earlier core report only for changed behavior; `validation-2026-10-17.md` remains historical evidence. No real-world safety, program approval, usefulness, independent student authorship or deployment claim follows from these checks.

## Primary review and deterministic evidence

Astra inspected the rule evaluator and validators, fixtures, workflow changes, coverage/relevance, shared screen/print components, strict storage and legacy migration, and the corresponding tests. Baseline source/docs were preserved at `/tmp/fixlist-facts-baseline-2026-10-17` before implementation. Work remained in the existing dirty feature checkout; owner files and earlier accepted work were preserved.

Node 24.18.0; npm 11.16.0. Existing exact dependencies and lockfile are unchanged by this increment.

| Check | Result |
| --- | --- |
| `npm test` | 387 tests passed in 5 files; final primary run after the print-only revision at 09:04 local. |
| Fact-rule engine | 138 tests: complete all/any truth tables; nested unknowns; inclusive comparisons; false/zero; missing/null; full malformed-data validation; duplicate IDs; hidden branches; depth/node/cycle limits; immutability. |
| Catalog and workflow | 112 tests combined: every concern's confirmation/revocation, authored order/grouping, references/routing/unknown cost, all profile/program outcomes, coverage, relevance independent of screening, invalid catalog data and preserved request invariants. |
| Storage | 132 tests, including 4,032 current composed states, 144 legacy history/activity combinations, all legacy criterion pairs, all eight concern round trips, exact original browser fixture, byte limits and failures. |
| Server rendering | 5 checks for complete screen/print content, unknowns, failed conditions, independent relevance and professional/inactive history context. These are omission checks, not browser or pagination proof. |
| `npm run typecheck`, `npm run build` | Passed. Build includes strict TypeScript validation. |
| Vite output | JavaScript 284.63 kB / 85.63 kB gzip; CSS 5.54 kB / 1.76 kB gzip. JS is below the 250 KiB gzip budget. No user-latency claim. |
| `git diff --check` | Passed. New source was also inspected directly; Git's tracked diff alone does not include untracked files. |

The final test count is not a substitute for these cases. During self-review, array-valued Vitest table rows were wrapped so they tested actual malformed registry arrays rather than a spread first element. No behavior is accepted solely from a worker completion message.

## Built-browser execution

T3's collaborative Chromium preview served the production build at `http://127.0.0.1:4173/`, 1280×800 and 320×844 CSS viewports. The old preview process had stopped; its first new navigation returned connection refused. Starting `npm run preview` restored the built app. No app console errors were observed in the current production checks; older development errors in retained tool history were not treated as current failures.

- Repeatedly focused the native profile select and used keyboard typeahead/Tab to exercise all seven fixed fictional profiles. Observed support/lighting outcomes: unknown → needs information/needs information; owner → match/match; renter → failure/match; incomplete → needs information/needs information; outside area → failure/failure; over-income → failure/failure; exact boundaries → match/match. No status editor or real household input exists.
- With a confirmed rug and an owner profile, both programs matched their fictional criteria, but only support's work categories overlapped. With the renter profile, support's ownership condition failed while work remained relevant. Nested lighting conditions displayed the failed ownership and met residency branches. All branch explanations stayed available.
- Used native checklist keyboard controls for all eight concerns. Eight yes answers left only the previously confirmed rug action in the plan. Separate button confirmations then produced all eight actions in authored order. Every cost remained unknown; exactly three actions showed professional review.
- Created a handrail family record, recorded requested and completion, removed confirmation, and observed retained completed inactive history with disabled mutation controls. Reconfirmed, reopened, and reloaded; completion returned to unconfirmed. Professional context explicitly says the record seeks appropriate help and does not authorize repair or establish qualifications. The original rug completion survived independently.
- At 320px, all nine selects had explicit labels and 44px height. The profile and nested rule tree were visually inspected, and DOM bounds across the page found no horizontal overflow. This is narrow desktop layout evidence, not a comprehensive assistive-technology audit or physical-device qualification.

## Migration, recovery and reset

Before building, the old app's real controls generated an exact v1 payload: rug yes but unconfirmed, cord unknown, both old criteria met, and a completed inactive rug request. The preserved raw fixture was used for actual browser migration.

Two new-app loads restored that history, retained the old answers/confirmation state, seeded six new questions unknown/unconfirmed, and selected `unknown-profile`. The migration notice explicitly explained that old screening statuses were not converted to facts. Raw saved bytes remained identical and schema1 across both loads. Keyboard selection of a fictional profile then saved schema2 with exactly the six allowed root fields. There were no persisted facts, rules or screening results; request history was unchanged.

Injected malformed JSON produced fresh unknown in-memory state and a truthful warning without overwriting the malformed bytes. Reset removed only the FixList key and left a separate acceptance sentinel untouched; reload did not auto-save defaults. An unsupported profile ID in otherwise valid v2 data was rejected, preserving those bytes. The accepted synthetic state was restored for print verification. At final handoff, the production preview was reset and reloaded: no saved key, unknown profile, eight unknown answers and zero actions. Unit tests additionally cover denied reads/writes/removals, oversized UTF-8 payloads, malformed legacy fields and exact old-ID boundaries.

## Native print evidence

A stale on-screen snapshot held the renter profile. After selecting the incomplete profile, native printing refreshed the report to the current profile and a fresh timestamp. The first actual macOS PDF contained all content but spanned 14 pages, with large gaps, a split profile box and orphaned footer. A bounded print-only CSS correction retained all content, set a 10pt minimum, compacted spacing, allowed action content to flow, and kept short fact/coverage boxes together.

The revised native Save as PDF export has **7 pages**, all rendered through PDFKit and visually inspected. It contains eight actions/evidence/confirmations, five-room coverage, the complete incomplete-profile facts, unknown support and nested lighting conditions, independent work overlap and matched actions, unmodeled requirements, reference dates, unknown costs, three professional routes, one completed rug record, one reopened handrail record with unconfirmed completion, and the footer. No clipped content or orphaned footer was seen. Longer action/coverage lists can continue across pages; this is a readable multipage report, not a promised one-page handoff.

Native print automation sometimes timed out while the modal was pending or unavailable to the UI tool. The acceptance evidence is the saved and inspected PDF, not a successful click response. No physical print was sent. PDFKit returned zero extracted text characters for both exports; searchable/tagged PDF accessibility remains unverified.

Ignored local artifacts:

- `recordings/2026-10-17-facts-catalog-report.pdf`
- `recordings/2026-10-17-facts-catalog-page-1.png` through `-7.png`
- `recordings/2026-10-17-facts-catalog-320px.png`

## Preservation and remaining gates

SHA-256 stayed equal to the pre-increment baseline:

- `assets/icon.svg`: `9d71defdbacedffba4aac553ba7e23b7ccd8076781f8ae1ec79f5d74e973f62d`
- `fixlist-plan.md`: `277d2e3f063c07b205e578caad88f3a5ff4782c8bc54276255b4917bbb9acb1a`
- `package-lock.json`: `b59e098c292344e366fb8ae0cf8e781f3bb6b43cf8b952fd6c18ac3a22d6374d`

The fictional programs do not exist. CDC checklist topics are separately attributed reference guidance, not validation of invented routing, costs, categories, observations or outcomes. No real program records, private data, server/auth/3D/vision, outreach, commit, push, deployment or final video was added. The earlier bounded iOS Safari test did not exercise these additions; no new iOS, Android or physical-device qualification is claimed.

Next gates: choose one county before real resource sourcing, run the same-information worksheet comparison, record actual student technical work/understanding, and satisfy the recording/submission requirements. The requested local screening/catalog increment is accepted; those later product gates remain open.
