# What to keep from the larger FixList plan

Decision: October 17, 2026. Andrew asked to retain useful parts of the larger proposal within the current plan, not replace the local-demo scope. This document records the roadmap decision and its implementation status. The fact-based fictional screening and eight-concern catalog increments were implemented later on October 17; current acceptance evidence is in `validation-facts-catalog-2026-10-17.md`. Later milestones remain proposals. The preserved `fixlist-plan.md` is unchanged.

## Product decision

Keep the family-coordination problem: help an adult child or grandchild document a concern, confirm what needs review, understand possible next steps and missing assistance information, and retain a family follow-through record. The older resident is a participant and an important reader of the report. Volunteers and agency intake workers are potential later audiences, not established users or partners.

The proposed value is continuity between these steps. Scanning a room is neither required for that value nor a demonstrated source of advantage. Keep the working React/TypeScript app and pure rules layer; assess usefulness against the same-information worksheet in `product-validation.md` before adding infrastructure.

Update 2026-10-18: The current demo now packages as a Capacitor iOS app and includes the resident/family-helper/volunteer demo journeys, English plus machine-translated unreviewed Spanish, on-device photos, and the real Eldercare Locator alongside the fictional program examples. The role and account boundaries are in the [roles journey spec](roles-journey-spec.md) and [2.0 accounts plan](v2-accounts-plan.md).

## Keep, adapt, or defer

| Larger-plan element | Decision for the current plan | Implementation boundary |
| --- | --- | --- |
| Family member as primary user | Keep | One person operates the demo; resident-facing wording/report remains readable. No multi-user account system. |
| Room-based concern taxonomy | Add a small structured catalog | Start with 6–8 carefully scoped examples after sourcing/review, not a 30-item completeness claim. Separate the fictional observation from the source of reference guidance. |
| Rules as data, pure engines | Keep and extend | Use the existing TypeScript domain. Do not duplicate the same rules in Python or move the app into a new monorepo. |
| Human confirmation before a plan | Keep exactly | Already implemented. An answer, photo, future model proposal or measurement never substitutes for explicit confirmation. |
| Severity, traffic priority, cost and worker type | Adapt | Keep explained authored review order. Unknown cost stays unknown. A routing category can suggest seeking appropriate help; it must not certify a person or task as safe. Do not invent a validated risk score or labor estimate. |
| Funding tags on actions and programs | Add | Separate work relevance (does the program cover this kind of work?) from recorded applicant criteria. Neither proves funding availability or approval. |
| Boolean eligibility rules over facts | Highest-value next engine increment | Evaluate fixed fictional facts through typed predicates and `all`/`any`, preserving unknowns and explaining every rule. Implemented: fixed fictional profiles now produce statuses through typed predicates and nested all/any rules. |
| County program directory | Keep as a gated data milestone | Choose one county, then verify a small number of actually applicable programs. No quota of eight, invented contacts/timelines, or assumption that all listed national categories are locally available. |
| Photo evidence and pins | Optional later local-demo enhancement | Existing evidence types can support publishable synthetic/licensed images. A simple room/photo association can be useful; no private uploads, 3D coordinate requirement or backend is needed. |
| Printable plan | Keep and improve as content grows | Preserve source, unknowns, explanations, attribution and history. Use native print. Do not force one page if doing so hides evidence or makes text unreadable. |
| Family follow-through | Keep current local record | Requested/in-progress/completed remain family reports. Retraction keeps inactive history. No invitation, actual contact, verified helper or independently verified repair is implied. |
| Volunteer safety exclusions | Retain the conservative principle | A future task-routing catalog should exclude trade/structural/high-risk work from informal-helper suggestions. Rules need contextual review; a two-person rule, organization code or height cutoff alone cannot establish safety or qualifications. |
| Tests, uncertainty, performance budgets | Keep | Test invariants and boundary cases, not a target case count. Preserve current storage/browser/print checks and 250 KiB gzip budget. Hardware timing/VRAM targets remain unmeasured proposals. |
| Swift capture, splats, vision, GPU queue | Defer | Not required for the next engine/catalog work. A future isolated experiment needs real capture hardware/data and measured acceptance criteria. |
| FastAPI, auth, volunteer matching, public jobs | Defer | These add identity, authorization, consent and operational requirements beyond a local record. Current typed commands are not a production API. |
| Homelab hosting, tunnel, backups, public video | Defer until separately authorized | Do not promise 30-day expiry, deletion, access controls or backups that have not been implemented and verified. |

Update 2026-10-18: Photo evidence and pins, the optional local Gaussian-splat scan pipeline/viewer, and v2 AI areas-to-review suggestions have since been implemented. They remain local and optional; suggestions are not hazard detection or safety findings, and no dimensions or accuracy are claimed. See the [scan viewer report](scan-viewer-2026-10-17.md), [suggestion UI report](scan-suggestions-ui-2026-10-17.md), [v2 contract](suggestions-v2-contract.md), and [AI disclosures](ai-disclosures.md). The real Eldercare Locator is present; a broader county program pilot and usefulness comparison remain gated.

## Corrections before reusing the pitch or specifications

**Problem statement.** CDC supports the claim that falls are the leading cause of injury-related death among adults 65 and older. Its current data page also discusses non-environmental risk factors. Retain the problem, but remove unsupported generalizations that most hazards are cheap to fix or that available money broadly goes unused. Any numerical video claim needs a named dataset, year, age group and comparable denominator; do not mix death counts, age-adjusted rates and emergency-visit estimates. [CDC older-adult falls data](https://www.cdc.gov/falls/data-research/index.html).

**Competitive positioning.** “AARP is just PDFs” is inaccurate: AARP's HomeFit AR listing describes camera/image recognition, suggested changes and a report distinguishing DIY from professional work. Use the specific proposed continuity of confirmation, assistance information and follow-through as a hypothesis to test. Do not claim that competing tools do nothing, or that FixList already fixes homes and obtains money. [AARP's app listing](https://apps.apple.com/us/app/homefit-ar/id1513619492).

**Taxonomy provenance.** CDC's *Check for Safety* is a useful source for questions about floor obstructions, cords, stairs, lighting and bathroom support. It does not establish the proposed severity weights, prices, volunteer competence, universal dimensional thresholds or effectiveness of this app. Cite each borrowed reference item; label additional policy choices separately. [CDC checklist](https://www.cdc.gov/steadi/pdf/steadi-brochure-checkforsafety-508.pdf).

**Program screening.** USDA's current national page lists a $10,000 maximum/lifetime grant and conditions beyond age and rural location, including ownership/occupancy, county income limits and affordable-credit constraints. It also describes repayment on sale within three years and funding-dependent timing. Keep this as an example of why a short rule tree must disclose omitted conditions. A checked source page is not a verified applicant or guaranteed local funding. Preserve `criteria_matched`, `needs_information`, and `known_criterion_not_met`, rather than relabeling the outputs “eligible” or “not eligible.” [USDA Section 504](https://www.rd.usda.gov/programs-services/single-family-housing-programs/single-family-housing-repair-loans-grants).

**3D loader assumption.** The inspected OpenSplat Nerfstudio loader throws when `ply_file_path` is empty and reads the referenced point set; the draft's “accept random initialization” fallback is not supported by that path. The loader also centers/scales poses and points. A future metric pipeline must trace the export/conversion back to physical units and test a known-distance fixture; ARKit units alone do not prove final viewer accuracy. This is source inspection, not an executed reconstruction. [OpenSplat loader](https://github.com/WebODM/OpenSplat/blob/main/nerfstudio.cpp).

**Measurement decision.** The proposed 10% width tolerance is too loose to justify a near-threshold clearance flag. For example, a reported 31 inches with a ±10% error allowance spans about 27.9–34.1 inches, crossing the proposed 32-inch doorway cutoff. This is arithmetic illustrating the design flaw, not an estimated device error distribution. Keep dimension-based judgments out until the threshold's applicability and the measurement uncertainty are established; use separately identified tape measurements if a future workflow needs dimensions.

**Matching formula.** The draft says out-of-radius candidates must score zero, but its formula can give them `0 + 0.3 + 0.2 = 0.5`. Required skill/radius/availability conditions must be evaluated before any ranking or organization bonus. Missing facts need an unresolved state. Even a corrected rank would not vet a volunteer. Retain this correction for future work; do not add matching now.

**Authorship and schedule.** Do not reuse “rules engine written by us,” personal inspiration, bugs encountered, hardware timings or completed repairs unless true and documented. Keep the original dates as historical planning context, not evidence of completion. Schedule new work by the gates below and retain the actual assistance log.

## Ordered next milestones

### 1. Fact-based screening with fictional data — implemented

Extend the domain with a small typed predicate tree: equality, bounded numeric comparisons, `all` and `any`. Facts have declared types/units and explicit missingness. Do not evaluate source-supplied code or expression strings. Validate unknown fact names, malformed trees and unreasonable depth/size.

For `all`, a known failure dominates, otherwise unknown dominates, otherwise all pass. For `any`, a known pass dominates, otherwise unknown dominates, otherwise all fail. Preserve every child explanation even when the parent result is determined. Empty groups are invalid definitions, not automatic matches. Keep a separate program-level warning for conditions the model does not represent.

Use two clearly fictional programs and predefined fictional profiles to demonstrate matching, failure and missing information. No real age, income, address, disability or health input is necessary. Derive criterion statuses from those facts; retain the existing aggregate result and disclosure semantics.

Acceptance: truth tables for nested groups; exact threshold boundaries; wrong-type/missing/extra facts; contradictory and invalid definitions; deterministic explanations; relevance distinct from criteria matching. Inspect the storage contract before integrating: prefer persisting only an allowlisted fictional profile ID under `fixlist:demo:v1`, and specify/test an explicit compatible migration if the schema changes. Never load an old unsupported payload by casting it.

### 2. A small structured concern/action catalog — implemented

Expand the authored data model only after its sources and intended decisions are clear. Candidate fields are stable ID, room category, question, evidence/confirmation requirements, reference next step, funding tags, help-routing category, source and review order. Cost may remain unknown; any illustrative cost band must say it is illustrative. Source provenance belongs to individual claims, not a blanket “CDC verified” badge.

An unanswered room/checklist item should appear as incomplete coverage, not “no hazards.” An empty confirmed plan can mean no concerns were selected; it must never certify a safe home. Test catalog integrity, broken references, confirmation/revocation, deterministic order, unknown metadata and exclusion of inappropriate informal-helper routing. Professional-review categories remain a routing aid, not trade instructions.

### 3. One-county resource pilot

Andrew selects the county. For each candidate program, record administrator, geography, covered work, source URL/date checked, modeled rules, omitted rules, contact/application path and known availability limitations. Verify loans and grants separately where their conditions differ. Start with one well-supported record; add others only when applicability is evidenced.

Keep applicant examples synthetic. Do not persist sensitive facts or contact anyone. Add an informative resource view before claiming automated applicant screening; any eventual criterion match must retain unmodeled requirements and administrator confirmation. Do not replace the current fictional-source contract silently.

### 4. Complete the handoff and test usefulness

Carry the new evidence, unknowns and coverage state into native print; rerun meaningful tests plus relevant browser/storage/narrow/keyboard/print checks. Compare the integrated workflow to the same-information worksheet. Preserve the existing continue/pivot/stop criteria, actual student-contribution record and submission disclosures. Expansion to a server or 3D requires a separate demonstrated need and scope decision.

## Review outcome

Keep the product's problem, audience, data-driven rules, funding-relevance idea, conservative task routing and evidence-rich handoff. The fact-based screening engine and small reference-attributed catalog are implemented and checked. Next, choose the county for a sourced resource pilot and run the planned usefulness comparison. Preserve the working implementation and keep capture, reconstruction, vision, volunteer marketplace and production infrastructure outside the current build.

Update 2026-10-18: The local scan/reconstruction/viewer and AI suggestion features named above are now part of the demo; automated hazard detection, real eligibility decisions, volunteer marketplace functions and production infrastructure remain out of scope. One real Eldercare Locator resource is integrated, while the larger county directory pilot and usefulness comparison remain future gates. See the [scan viewer report](scan-viewer-2026-10-17.md), [suggestion contract](suggestions-v2-contract.md), and [AI disclosures](ai-disclosures.md).
