# Core workflow validation — October 17, 2026

Astra accepted the bounded synthetic software journey after source review and the checks below. This report distinguishes deterministic checks, interactive observations and untested product claims. It does not establish production or submission readiness.

## Baseline and preserved files

- Starting commit: `3ecf2bc` (`Set up demo-focused FixList scaffold and technical plan`). Work is local on `codex/fixlist-core-2026-10-17`; no commit, push, deployment, or upload is authorized for this task.
- Node `v24.18.0`, npm `11.16.0`. `npm ci` installed 47 packages; audit reported zero vulnerabilities in that resolved graph. This is package-manager output, not a security audit.
- Baseline typecheck/build passed. Baseline `npm test` found no tests and succeeded only through `--passWithNoTests`.
- Baseline build: JavaScript 223.82 kB raw / 70.12 kB gzip, CSS 0.30 kB raw / 0.22 kB gzip (Vite output). These are bundle sizes, not latency measurements.
- T3 browser loaded the scaffold at `http://127.0.0.1:5173/` with no error in the captured console. There were no interactive controls yet.
- Pre-existing untracked `.claude/` content belongs to the owner and is untouched.

Preservation SHA-256 values recorded before implementation:

```text
assets/icon.svg    9d71defdbacedffba4aac553ba7e23b7ccd8076781f8ae1ec79f5d74e973f62d
fixlist-plan.md    277d2e3f063c07b205e578caad88f3a5ff4782c8bc54276255b4917bbb9acb1a
package-lock.json b59e098c292344e366fb8ae0cf8e781f3bb6b43cf8b952fd6c18ac3a22d6374d
```

## Acceptance ledger

| Boundary | Required evidence | Current status |
| --- | --- | --- |
| Domain engine | Confirmation, revocation, deterministic grouping/order, ternary screening, request lifecycle tests and primary code review | Passed: 50 tests, primary source/test review and independent execution |
| Persistence | Strict schema and invariant rejection, valid round-trip, denied/quota/read/reset failures, unrelated-key survival | Passed: 96 tests, primary review/execution; includes 5,184 composed fixture states |
| Browser journey | Real control interactions; computed results change correctly; reload/reset; no unexpected console errors | Passed for the exercised production-build journey, including controlled storage faults |
| Narrow/keyboard | No horizontal overflow; reachable labeled controls; independent keyboard interaction; visible focus | Passed for 1280px desktop and 390px/320px inspection and exercised native keyboard controls; not a full accessibility audit |
| Print | Actual native preview, preserved uncertainty/provenance and usable pagination; PDF inspection where supported | Passed visually: two-page native PDF, current-state refresh, uncertainty and retained history; text extraction/accessibility limitation below |
| iOS browser | Actual Safari simulator interaction, independent of desktop CSS viewport | Passed bounded iPhone 17 Pro / iOS 26.5 Safari check: native answer, explicit confirmation, plan, reload and withdrawal |
| Android | Emulator tooling | Unavailable: Android SDK command-line tools missing; no installation attempted |
| Product usefulness | Controlled comparison with people | Not conducted |
| Real programs/actions | Current sources, local applicability and professional review as appropriate | Not implemented; examples remain fictional |
| CAC submission readiness | Student contributions/understanding, disclosures and final rule check | Not established |

## Adversarial interactive checklist

1. Fresh start: no confirmed concerns, no computed actions, no mutable requests. Supplied sample criterion answers are identified as synthetic.
2. Answer yes without confirmation: plan stays empty. Explicitly confirm one concern: only its action enters. Answer no/unknown: dependent confirmation and action disappear together.
3. Confirm both concerns in reverse order: review order remains documented catalog order, not click order or a risk score.
4. Assistance: unknown remains unknown; all met is a criteria-only match; failed plus unknown retains both explanations and shows a known failure.
5. Create a request only from an active plan action. Completion is unavailable for a draft. Advance requested/in-progress, explicitly report completion, then reopen. A report never removes a plan item.
6. Remove the underlying concern: request history becomes inactive and cannot be changed. Reconfirmation must not silently claim the concern resolved.
7. Reload after edits: saved state restores the same derived result. Corrupt stored JSON: fresh usable demo with a visible rejection message.
8. Deny writes: controls still work in memory and the status must not claim a save. Deny reset deletion: memory resets with a warning that reload may restore the old state.
9. Seed an unrelated storage key, reset, and verify that key survives while FixList's key is removed.
10. Open the native print view with confirmed actions, criterion unknowns, and a family report. Inspect provenance, attribution, and generation date. Do not call a print function invocation a verified PDF.

The outcomes and limits of these checks are recorded below.

## Accepted engine and persistence evidence

Astra reviewed `workflow.ts`, `rules.ts`, `plan.ts`, `screening.ts`, the reconstructive storage adapter and focused test cases, then independently ran `npm test -- src/domain` (50 passed), `npm test -- src/lib` (96 passed), and strict typechecking. No new dependency was required. A worker self-review caught an invalid runtime null request status that could match a terminal-state marker; it was reproduced, guarded, and covered by a regression before acceptance.

The composition test constructs reachable states through real commands, then enumerates 4 final answer/confirmation modes for each of two concerns × 6 request-history modes for each action × 9 assistance criterion pairs: **4² × 6² × 9 = 5,184**. Every case is validated, saved, loaded, and compared against independent expected action membership, request activity, and a fixed screening truth table. This is finite synthetic-state coverage, not arbitrary-input completeness or a user/clinical study.

The storage tests also demonstrate rejected malformed/oversized/unknown-version data, rejected extra keys and arbitrary source/identity text, canonical date checks, impossible confirmation/completion rejection, memory fallback on denied reads/writes/deletes, and reset preserving an unrelated key. Fake adapters establish error-path logic; the actual browser fault injection below provides separate integration evidence.


## Final deterministic checks

Astra independently ran the full checks after the final screen/print wording fix:

| Check | Observed result |
| --- | --- |
| `npm test` | 2 files, **146 tests passed**: 50 domain and 96 storage. Includes the 5,184-state composition test described above. |
| `npm run typecheck` | Passed strict app/tooling typechecks. |
| `npm run build` | Passed; Vite emitted 26 transformed modules. |
| Initial JavaScript | **256.67 kB raw / 78.21 kB gzip** by Vite; below 250 KiB gzip budget. |
| CSS | 4.17 kB raw / 1.49 kB gzip. |
| `git diff --check` | Passed. |
| Preserved icon, full earlier plan and lockfile | All three SHA-256 values above match after implementation. |

No dependency was added. Bundle sizes and test execution times do not establish user-perceived latency or throughput. The project has no lint command and no numerical coverage-percentage claim.

## Desktop production-build observations

Executed in the T3 collaborative Chromium preview at `http://127.0.0.1:4173`, not solely against the development HMR server:

- Fresh mount left `fixlist:demo:v1` absent and both confirmations disabled. Yes alone kept the plan empty; a separate keyboard-activated confirmation added the action. Confirming cord before rug still produced catalog order (rug, cord).
- Actual native select typeahead, Tab/Shift-Tab and Enter operated checklist/confirmation controls. A focused confirmation button had a visible 3px outline. Selects had associated labels. Initial attempts to use arrow keys through a native popup did not change its value; typeahead provided a working native keyboard path. This tool behavior was not silently counted as a successful interaction.
- A request began as a draft without a completion control. Requested → in-progress → explicit family-reported completion left both plan actions present. Removing rug confirmation retained its report as read-only **Inactive history**. Reconfirmation permitted reopening; reopening cleared completion attribution/time.
- Met/met showed only **Recorded criteria matched**. Known failure plus unknown preserved both individual explanations and showed the known failure. Unknown/unknown showed **Needs information**.
- Reload restored the saved state and the same derived plan/screening. Changing a yes answer to no immediately cleared its confirmation and removed the plan action; history became inactive.
- Controlled `Storage.prototype.setItem` failure (`QuotaExceededError`) preserved the old saved string, allowed the edited in-memory plan, and showed a truthful save-failure/reload warning.
- Controlled `removeItem` failure (`SecurityError`) reset memory but retained the old saved string and warned that reload could restore it. After restoring the original method, reset removed only the FixList key. A seeded unrelated key survived both resets. Test patches and the temporary sentinel were removed.
- Corrupt JSON produced a fresh usable in-memory demo and a visible invalid-data message. Loading did not overwrite or remove the corrupt string. A previously captured valid synthetic state was restored for later print testing; no private data was introduced.
- 390px and 320px viewports had no horizontal overflow (document widths 375px and 305px respectively, excluding the scrollbar). Final completed-history content was inspected at 320px. All measured buttons/selects/navigation targets were at least 44 CSS px high, with no unlabeled selects. Wide layout was inspected at 1280px.
- Captured production-run diagnostics had no new console errors or failed network requests after integration. The tab's retained historical diagnostics include temporary Vite 500/HMR errors while new module files were being written at 04:15 UTC; these predate the completed build and were not erased or represented as a clean lifetime log.

This is an exercised integration path, not exhaustive browser automation, screen-reader certification, a full WCAG audit or an older-adult usability study.

## Native print and PDF inspection

The app's print button opened macOS native printing. The T3 invocation timed out while the native modal was open, but the modal appeared and a local PDF was saved through **Save as PDF**; no physical printer job was sent.

The first visual inspection found an ambiguity: a family-completed request displayed its retained “in progress” stage as though current. Sol made a narrow presentation fix in both screen and print: **Family reported complete (unverified)** leads, while the retained workflow stage is explicitly **Pre-completion stage**. Domain/storage behavior did not change. Astra inspected the changes and final native export.

A separate check changed an assistance answer after creating the on-screen snapshot. The app showed the stale-preview notice; the report still showed the old known-failure result while the live screen showed needs-information. Calling native `window.print()` directly, without the app's refresh handler, exercised `beforeprint`: the snapshot generation time changed and the report/PDF showed the current **Needs information** state. This verifies that native print-event path in this Chromium host; a specific browser-menu keyboard shortcut was not separately exercised.

The final **two-page** Letter PDF was opened with macOS PDFKit, rendered to page PNGs, and visually inspected. It contains only the confirmed cord action, its evidence and confirmation attribution, both unknown criteria, the fictional source/no-verification-date disclosures, the inactive rug family-completion report, the history boundary and AI-assistance footer. Both pages have readable text and no observed clipping or missing sections.

**Limitation:** PDFKit extracted zero text characters from this host-generated PDF despite legible rendered pages. Treat this export as visual print evidence; searchable text, PDF tagging and screen-reader accessibility are not established. The app uses semantic HTML and native printing, but cross-browser PDF semantics and iOS printing were not tested.

Local ignored artifacts (reviewed synthetic content; no upload):

- [`2026-10-17-verified-report.pdf`](../recordings/2026-10-17-verified-report.pdf)
- [`2026-10-17-print-page-1.png`](../recordings/2026-10-17-print-page-1.png) and [`page 2`](../recordings/2026-10-17-print-page-2.png)
- [`390px checklist view`](../recordings/2026-10-17-mobile-390.png)
- [`320px retained-history view`](../recordings/2026-10-17-mobile-320-history.png)

## iOS simulator check

Used the T3 Device panel and its isolated agent-device session with **iPhone 17 Pro / iOS 26.5 Safari**, served from the built app on port 4173. Selected the rug's native **Yes** option, separately tapped confirmation, and observed one computed rug action with source and selection/order explanations. A full URL reload reported saved data loaded; the same one-action plan persisted. Tapping remove confirmation removed that action. The simulator screen was visually inspected with the device screenshot tool.

The device automation's primary accessibility snapshot path was unavailable; its documented XCTest fallback produced usable element references and observed actions. This is simulator Safari compatibility evidence, not a native iOS app, physical-device validation, full iOS lifecycle coverage, iOS print validation or a performance measurement. Android SDK command-line tools are unavailable, so no Android check was claimed or installation attempted.

## Acceptance decision and next gate

**Continue with the local synthetic demo and a student-led review/contribution.** The specified engine, storage and exercised browser/print boundaries pass. No current software finding blocks rehearsing this synthetic journey. Keep the interface simple until a controlled comparison establishes that integration helps beyond the same-information worksheet.

**Do not promote this evidence to production, real-world outcome or CAC-submission acceptance.** Still open: significant student technical work and understanding, user comprehension/usefulness, sourced professional action guidance and real-program applicability, broader accessibility/device testing, and final video/disclosure/rule review. T3 recording failed to start twice (including after reopening the preview); no video was recorded, no person contacted, no application sent, no real repair verified, and no commit/push/deployment/upload occurred in this task.
