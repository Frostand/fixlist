<img src="assets/icon.svg" width="64" height="64" alt="">

# FixList

A local browser demonstration that turns **explicitly confirmed fictional concerns** into an explained action plan. Eight concerns across five rooms connect to reference guidance, fact-based fictional program screening, and a local family follow-through record. Native printing carries the evidence, unknowns and screening explanations into a report.

This synthetic prototype does not assess a real home, determine real eligibility, contact a helper, or verify a repair.

Use Node **24.18.0** (`.nvmrc`) and npm **11**:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The development server uses a fixed port and stops if it is occupied.

React, TypeScript, Vite, Vitest and plain CSS use exact versions in [package.json](package.json) and [package-lock.json](package-lock.json). Business logic runs locally through immutable commands and pure queries. No server, account, database or external API is required.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development on port 5173. |
| `npm run typecheck` | Strict app and tooling TypeScript checks. |
| `npm run build` | Typecheck and produce the static build in `dist/`. |
| `npm run preview` | Serve the build on port 4173; build first. |
| `npm test` | Domain, catalog, screening, workflow and storage/migration tests. |
| `npm run test:watch` | Run Vitest interactively. |

## Try the working journey

1. Reset the demo. Answer **Yes** for the rug question: the plan stays empty. Separately confirm the concern to add an action. Inspect its source, routing and unknown cost.
2. Choose a fixed fictional profile. The Maple owner matches both fictional programs; the Maple renter fails the support ownership condition but matches lighting through residency. Incomplete facts remain unknown. The boundary profile demonstrates inclusive thresholds.
3. Compare program criteria with **work relevance**. A profile can match a program whose work categories do not cover the confirmed rug action. Confirm a lighting concern to see relevance change without changing profile facts.
4. Review the expanded checklist and coverage. Eight answered questions only complete this sample checklist; they never establish that a home is safe. Answers require separate confirmation before entering the plan.
5. Create a local request, record requested/in-progress, then explicitly record family-reported completion. Remove the concern's confirmation to see retained inactive history. Completion neither verifies repair nor resolves the concern.
6. Reload, inspect the current report and use native printing. Reset clears only this demo's saved key. Ports 5173 and 4173 have independent storage.

Only the selected fictional profile ID is saved, alongside answers, confirmations and request history. The key remains `fixlist:demo:v1` with a version-2 payload. Exact old version-1 data migrates in memory: history is preserved, new questions start unknown, and old manually selected screening statuses are discarded with an explanation. Loading never silently rewrites saved data.

[Current acceptance evidence](docs/validation-facts-catalog-2026-10-17.md) records checks for these additions. [Earlier core validation](docs/validation-2026-10-17.md) preserves the previous browser/print/iOS evidence; it is not proof of the new features on iOS. [Architecture](docs/architecture.md), [handoff](docs/handoff-2026-10-17.md), [AI disclosures](docs/ai-disclosures.md) and [video shot list](docs/video-shot-list.md) give the technical and recording boundaries.

All household examples, profiles, programs and helper identities are fictional. The CDC checklist is separately attributed reference material; it does not validate the authored costs, review routing or fictional observations. Do not enter private household data. Student technical contributions, understanding, usefulness testing and final submission disclosures remain open.

The [plan integration review](docs/plan-integration-review.md) identifies the implemented increments and later gates. The [original product plan](fixlist-plan.md) is preserved as background. Capture/3D, vision, real program eligibility, a volunteer marketplace and production infrastructure remain deferred.

Created in [T3 Code](https://t3.codes).
