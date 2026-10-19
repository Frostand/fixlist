# FixList consolidated review and work backlog

Compiled October 18, 2026 from the project review, Andrew's feedback, the additional app/scan reviews, and the subsequent corrections. Reviewed code baseline: `18bb3ac`.

This is a review and planning document. All work items are open. Creating this document does not implement the proposals, authorize uploads or external services, or change the current project scope. Application code, project instructions, and existing plans were not changed for this compilation.

## Product judgment and intended outcome

The current build is a local synthetic prototype with useful domain rules. It does not yet deliver the requested integrated product: recording a home inside the app, producing a useful room representation, reviewing model-flagged concerns, and coordinating actual help between people on different devices.

The strongest product promise is: **help residents and trusted helpers identify things worth reviewing, decide what to address, and follow each fix through to completion.**

The intended journey is:

1. Create or join a household and choose a room.
2. Capture a guided walkthrough or photos inside the app.
3. Review the captured evidence and room representation.
4. Review model suggestions with their original photos and uncertainty.
5. Answer relevant questions and explicitly confirm concerns.
6. Build a fix list, do the work yourself, request a helper, or track a professional referral.
7. Schedule, record progress, review completion, and reopen a recurring problem.

Rendering 3D and identifying a concern are separate problems. Photos remain primary evidence; 3D helps locate and explain that evidence. A visually convincing model is not a safety assessment.

Preserve the existing strengths: pure domain commands, explicit confirmation separate from answers and model output, volunteer projections containing only shared fields, restrictions on professional work, unknown assistance criteria, and truthful completion/source labels. Improve these foundations rather than assuming a complete rewrite is necessary.

## Evidence and priority conventions

- **Reproduced:** exercised in the browser or with a focused harness using the actual implementation. Synthetic filesystem or concurrency reproductions do not establish a current real-data disclosure or physical-device failure.
- **Code-confirmed:** the source establishes the behavior or missing mechanism; the complete user/device path was not necessarily exercised.
- **Risk:** a credible source-derived failure/performance concern whose frequency or hardware impact remains unmeasured.
- **Gap:** a missing product capability or proposed improvement, not a claim that existing code violates its original demo specification.
- **Verify:** a claim needing physical-device, assistive-technology, user, or further runtime evidence.

**P1:** integrity/privacy defects and broken core lifecycle paths to fix first. **P2:** important demo functionality, usability, and reliability. **P3:** broader product capabilities and architectural expansion. **P4:** polish or lower-impact hardening. Priority is not an effort estimate. A P3 feasibility investigation can happen early when it reduces a major architectural risk.

The findings below consolidate prior verification; unchanged suites were not rerun merely to compile this document. A finite audit cannot establish that every possible defect has been found.

## Verified baseline and limits

- `npm run typecheck`: passed.
- `npm test`: 1,116 tests across 28 files passed.
- `npm run build`: passed.
- `PYTHONDONTWRITEBYTECODE=1 scan/venv-python -m unittest discover -s scan/tests`: 98 tests, 2 failures, 14 errors in the reviewed environment. The default calibration/think-mode mismatch is a central failure source. Do not preserve stale claims of 92 passing Python tests.
- Initial JavaScript: 151.16 kB gzip, within the 250 KiB project budget. Lazy scan chunk: 3,079.13 kB raw / 1,036.47 kB gzip. These are bundle measurements, not startup or interaction latency.
- Audit reported three moderate affected-package entries in one development-tool chain: `@capacitor/cli -> xcode -> uuid`. No production-app exploit was demonstrated.
- Browser review included narrow layouts and the generated sample viewer. The sample rendered without observed console errors. Some tested screens had no horizontal overflow; this is not a whole-app accessibility pass.
- Browser measurements varied by viewport, state, language, and expanded content. A 390px sample scan screen measured about 2,854px tall with a roughly 328 x 205px canvas; another supplied review observed about 4,226px. Resources measured about 6,166px at 320px and about 5,151px in the supplied 390px review. Treat these as state-specific observations, not fixed properties of every visit.
- A fresh native/physical-device acceptance run was not completed in the primary audit. Simulator, actual iPhone capture, VoiceOver, native print pagination, and real-home model performance remain separate gates.
- The stale-tab and symlink findings below were reproduced in the primary review. Another reviewer not rerunning those harnesses does not downgrade that evidence.

## A. Data, privacy, permissions, and request lifecycle

- [ ] **D01 · P1 · Reproduced — Reset can restore old metadata.** An in-flight photo removal can dispatch against old state after localStorage is cleared and before IndexedDB reset finishes. Invalidate outstanding operations and prevent stale publication/persistence during reset. **Accept:** delayed add/remove operations cannot restore answers, confirmations, media metadata, or blobs after reset and reload; partial reset failures are explained.

- [ ] **D02 · P1 · Reproduced — A stale tab can restore revoked sharing.** Whole-state writes have no cross-tab version/conflict check. One tab's language change restored another tab's previously revoked photo-sharing flag. **Accept:** stale edits cannot overwrite newer revocations or household state; users receive a deliberate refresh/conflict result.

- [ ] **D03 · P1 · Code-confirmed — Scan reset coordination stops at a tab boundary.** `serializeScanStore` orders operations in one JavaScript instance only. A second tab retaining an old document can write it back after reset. **Accept:** use a durable reset/version boundary or equivalent coordination; exercise two independently instantiated clients against the same store.

- [ ] **D04 · P1 · Reproduced — Allowed input can exceed the 64 KiB saved-state limit.** Legal multibyte updates produced 66,407 bytes; subsequent commands continued in memory without persistence. History counts do not reserve bytes. **Accept:** reject or safely restructure oversized changes before publishing success, retain the last durable state, and preserve capacity for revocation, cancellation, and rejecting completion.

- [ ] **D05 · P1 · Code-confirmed — Recovery and migration explanations are dropped.** The storage layer supplies useful messages, but the app uses only status; a later person selection can overwrite rejected saved data with a fresh fallback. **Accept:** display the actual recovery/migration state, preserve recoverable bytes, and offer deliberate recovery/export/reset choices before replacement.

- [ ] **D06 · P1 · Reproduced — Cancellation and recurrence need separate request episodes.** A retained cancelled request blocks another request for the action; a reconfirmed recurring concern inherits an old completed request and can make Home say done. **Accept:** explicit reopen/new-episode behavior preserves history without treating old completion as current completion. Also replace the incorrect inactive copy with distinct reasons for cancelled, unconfirmed, completed, or superseded work.

- [ ] **D07 · P1 · Reproduced — History exhaustion permits acceptance but blocks rejection of completion.** `confirm_done` uses the reserve; `not_done_yet` does not. **Accept:** both decisions remain available at capacity, with all remaining privacy exits still possible and persisted.

- [ ] **D08 · P1 · Reproduced — Completed assignments can disclose future photos.** Completed requests remain in volunteer projections and select matching resident photos live. **Accept:** define explicit sharing lifetime and a deliberate evidence snapshot/update policy; new photos are not automatically visible to a former assignee. Retained history and future access are separate decisions.

- [ ] **D09 · P2 · Code-confirmed — Professional work can loop between Home, Plan, and resources.** The next-step selector requests creation, but the professional button opens resources without creating a tracked referral. **Accept:** the user can record and advance a professional-help task without assigning prohibited work to volunteers; Home reflects its actual state. See F04.

- [ ] **D10 · P2 · Code-confirmed — Confirmation-only helpers can lack the evidence to decide.** Confirmation and plan access do not imply access to the supporting answers/photos. **Accept:** provide a minimal, explicitly authorized evidence projection or prevent unsupported confirmation; do not grant the entire household implicitly.

- [ ] **D11 · P2 · Code-confirmed — Photo ownership can prevent cleanup.** Residents cannot delete helper-owned photos, and revoked helpers may lack the scope to remove their own. **Accept:** distinguish contributor attribution from household control, define deletion/revocation rights, and test cleanup after access changes without erasing attribution history.

- [ ] **D12 · P2 · Code-confirmed — Next-step ordering can hide pending human decisions.** Unanswered questions precede completion review and visit proposals. **Accept:** prioritize actionable pending decisions appropriately, distinguish waiting from done, and preserve checklist resume without making it block all other work.

- [ ] **D13 · P2 · Code-confirmed — Home's latest updates are not sorted chronologically.** Updates are flattened by request and sliced. **Accept:** sort by validated timestamps with a deterministic tie-breaker before taking the latest entries.

- [ ] **D14 · P4 · Reproduced with hand-edited data — Aggregate records can disagree with event history.** Some update/proposal and timestamp inconsistencies survive saved-state validation. **Accept:** specify the authoritative representation, reject impossible sequences or reconstruct from trusted events. This is lower priority than failures reachable through ordinary commands.

- [ ] **D15 · P2 · Code-confirmed — Failures need typed, actionable outcomes.** String-based error mapping collapses distinct problems. **Accept:** distinguish stale revision, permission denial, storage capacity, unavailable storage, invalid media, cancelled work, and processing failure; never imply durable success for a failed save.

Sources: [UI dispatcher and photo operations](../src/app/ui-controller.ts), [application/reset](../src/app/App.tsx), [workflow](../src/domain/workflow.ts), [role projections and next steps](../src/domain/role-views.ts), [metadata storage](../src/lib/demo-storage.ts), [state validation](../src/lib/state-validation.ts), [scan storage](../src/lib/scan-storage.ts).

## B. Routing, interactions, and smaller functional defects

- [ ] **N01 · P2 · Reproduced — Skip-to-content changes the application route.** `#screen-heading` is parsed as an unknown route and returns to language selection. **Accept:** keyboard activation focuses the heading/content without changing screens or losing state.

- [ ] **N02 · P2 · Reproduced — Scan pins open the first question in a room, not their own question.** Examples include handrail/stair-lighting pins opening stair clutter and bathroom-support pins opening shower surface. **Accept:** follow the concern/action/evidence relationship and verify every catalog mapping, including future multi-question concerns.

- [ ] **N03 · P2 · Reproduced — Removing an AI pin prevents re-adding it.** The pin disappears but its suggestion ID remains in `pinned`. **Accept:** pin removal updates both records consistently; re-add, dismissal, undo, save, and reload retain coherent state.

- [ ] **N04 · P2 · Code-confirmed — The 3D Home key fails in Spanish.** Physical keyboard keys are compared against translated navigation text. **Accept:** use stable key values, with localized labels independent of event handling.

- [ ] **N05 · P2 · Code-confirmed — Reload loses the selected volunteer on invitation review.** Selection lives only in React state. **Accept:** a durable/versioned draft or safely recoverable route context survives refresh and app termination; revalidate the selected person's eligibility before sending an invitation.

- [ ] **N06 · P2 · Code-confirmed — The helper Continue action is a generic section shortcut.** It routes to Check, Plan, or Help rather than a helper-specific pending task. The resident next-step selector currently returns null for helpers, so merely removing the override is insufficient. **Accept:** a capability-aware helper next-step function and matching destination/copy.

- [ ] **N07 · P2 · Code-confirmed — Helpers see assistance results based on empty fallback facts.** Resources substitutes initial state for non-residents. **Accept:** show general resources with a clear limitation, or introduce a specific facts-sharing permission. Do not fix the confusing display by exposing the resident's complete fact record.

- [ ] **N08 · P2 · Code-confirmed — Deep links bypass first-run language/person selection.** A fresh install with a recognized hash can enter the default person's screen. **Accept:** preserve the intended destination while completing required onboarding/account selection, then apply role authorization; retain deliberately documented developer launch paths separately.

- [ ] **N09 · P2 · Code-confirmed — The checklist assumes a corresponding concern exists.** A non-null assertion can fail when the catalog is extended; catalog validation does not enforce this particular relationship. **Accept:** support questions without concerns or reject the catalog explicitly before rendering, with an appropriate test.

- [ ] **N10 · P2 · Code-confirmed / Verify — Answer handling duplicates writes and may over-announce.** Each answer dispatches an answer and a position command; the app also has global and local save-status regions. **Accept:** one coherent durable transition where appropriate, no partial-success masking, and concise tested assistive feedback. Two dispatches establish two writes, not necessarily two VoiceOver announcements because React can batch rendering.

- [ ] **N11 · P2 · Reproduced — Help close and reset confirmation lack adequate focus handling.** Closing Help left focus on the document body; reset confirmation appeared without useful focus transfer and extended below the tested viewport. **Accept:** focus moves intentionally, remains visible, returns to the trigger, and works with keyboard/VoiceOver and the fixed tab bar.

- [ ] **N12 · P2 · Reproduced / Code-confirmed — Back behavior and navigation context are inconsistent.** Hardcoded parents can return resources to More rather than its entry point; two Back controls on a question perform different actions; resources has no active tab. **Accept:** distinguish previous question from screen navigation, preserve useful return context, and identify the active destination consistently.

- [ ] **N13 · P2 · Code-confirmed — Dates ignore the selected app language.** Timeline formatting uses the browser locale. **Accept:** format dates/numbers with the app locale and appropriate timezone context while preserving original user-authored text.

- [ ] **N14 · P2 · Verify — Camera/library choice is not guaranteed by the current input.** `capture="environment"` requests capture behavior while copy promises camera or photo library. **Accept:** explicit Take photo and Choose existing photo paths, both tested in the actual Capacitor app with permissions denied/limited and camera unavailable. Do not claim universal iOS picker behavior from the attribute alone.

- [ ] **N15 · P4 · Code-confirmed — Print readiness and route construction need cleaner interfaces.** Printing polls photo DOM attributes asynchronously every 50 ms for up to 8 seconds; it is not a main-thread busy-wait. `navigate` also assembles route strings separately from the encoding helper. **Accept:** explicit print readiness/error/cancellation and shared route serialization. Current allowlisted IDs limit the immediate encoding risk; preserve usable print output and link parsing.

Sources: [phone shell](../src/app/PhoneShell.tsx), [routes](../src/app/routes.ts), [resident screens](../src/app/ResidentScreens.tsx), [resources/settings](../src/app/SettingsScreens.tsx), [request screens](../src/app/RequestScreens.tsx), [scan panel](../src/app/ScanPanel.tsx), [scan viewer](../src/app/ScanViewer.tsx), [suggestion actions](../src/lib/scan-suggestion-actions.ts), [application](../src/app/App.tsx).

## C. Scan pipeline, packaging, and rendering

- [ ] **S01 · P1 · Reproduced — Default inference configuration conflicts with calibration.** `suggest.py` defaults to think-mode auto, but the adopted calibration requires never. The documented command fails before inference and the Python suite is red. **Accept:** make documented defaults and exact scoring conditions consistent, keep mismatched calibration fail-closed, and pass the full Python suite plus a representative documented invocation. Do not bypass validation just to make tests green.

- [ ] **S02 · P1 · Reproduced with synthetic files — The public-root symlink guard is incomplete.** A symlinked `public/` root is trusted after canonicalization; synthetic private bytes were copied into a production build. **Accept:** validate the root and ancestors against allowed/private boundaries before copying. No current checkout leak was observed.

- [ ] **S03 · P1 · Reproduced — iOS scan bundling destroys previous output before validating inputs.** Invalid names or missing sources can remove the usable bundle. **Accept:** preflight every input, stage a complete output, and replace atomically; failure retains the previous usable bundle.

- [ ] **S04 · P1 · Reproduced with synthetic files — Bundling follows symlinked parent directories.** Leaf-file checks do not establish source-root containment. **Accept:** canonicalize and validate all relevant ancestors and targets, reject escapes, and preserve the existing private-data boundary.

- [ ] **S05 · P2 · Reproduced — Bundling accepts invalid/empty scans.** A zero-byte file can yield a successful package whose index is rejected by the app. **Accept:** validate byte bounds, file structure, metadata, suggestions, duplicate names, and the complete index before reporting success.

- [ ] **S06 · P1 · Reproduced — Splat count does not bind suggestions to a scene.** Different rooms with equal counts can accept each other's photos/coordinates. **Accept:** versioned capture/scene identity, content hashes, coordinate conventions, and processing provenance; wrong-scene artifacts fail before display or pin creation.

- [ ] **S07 · P2 · Code-confirmed — Producer and consumer disagree on notice/license validation.** TypeScript accepts arbitrary bounded notice/license strings where Python requires fixed values. **Accept:** one documented contract with parity fixtures, trusted UI disclosures independent of imported text, and correct handling of explicitly supported model/license variants.

- [ ] **S08 · P1 · Reproduced with mocked readback — Spark can allocate after disposal.** In installed Spark 2.3.1, a pending sort resumed after disposal and created a worker and ordering texture. **Accept:** a verified lifecycle guard/upstream fix or safe integration that prevents post-disposal allocation; exercise repeated open/close and interruption on a phone. The harness proves the race, not its real-device frequency or retained-memory magnitude.

- [ ] **S09 · P2 · Code-confirmed — Local loading has no complete cancel/timeout path.** The loader accepts a signal but the UI does not forward one; navigation suppresses publication without necessarily cancelling transfer. **Accept:** cancel, timeout, retry, and cleanup states; no indefinitely busy screen or stale load publication.

- [ ] **S10 · P2 · Risk — Allowed inputs can consume too much decoded memory.** File byte size is checked before decoding; decoded splat count is checked afterward. A 300 MiB byte limit is not an adequate phone memory budget. **Accept:** preflight supported formats, bound decoded complexity where possible, use conservative device-appropriate limits, and measure peak memory. No phone out-of-memory reproduction was established.

- [ ] **S11 · P2 · Risk — Picking/occlusion work scales poorly at upper limits.** Picking retains a buffer proportional to splat count and marker visibility can require repeated scans of splat data. **Accept:** representative frame-time/memory measurements, bounded marker work, and justified spatial indexing/worker/LOD changes if needed. Existing occlusion logic is present; do not report it as missing.

- [ ] **S12 · P2 · Code-confirmed — Shared location images can omit the location marker.** Canvas capture excludes separately rendered HTML markers; an AI pin may use the full source photo. **Accept:** preview and export a clearly annotated image or crop, include the relevant point/context, and avoid unintentionally sharing a wider room than necessary.

- [ ] **S13 · P2 · Code-confirmed — ARKit pose import lacks the tracks used for location depth.** The existing pose path supplies no triangulated points, so current sparse-depth localization has no basis for positions. **Accept:** integrate depth/mesh intersections or triangulation from posed frames, with synthetic geometry tests and an actual capture. Pose capture alone does not finish the reconstruction/localization pipeline.

- [ ] **S14 · P2 · Code-confirmed / Risk — Locations look more precise than their estimation warrants.** A coarse image-grid choice and sparse median depth can be used; missing-cell depth borrows nearby directions without a strong angular constraint. Location confidence/distribution is underused. **Accept:** reject ambiguous placements, cap geometric mismatch, expose uncertainty, and retain photo-only suggestions when localization is unsupported.

- [ ] **S15 · P2 · Gap — Reconstruction success lacks a useful-scene acceptance gate.** Registration counts and finite coordinates do not prove room coverage, legibility, correct orientation, or a visible concern. **Accept:** capture-quality guidance, coverage/blur/exposure checks, human review, and rescan paths; avoid dimensions/accuracy claims without measurement.

- [ ] **S16 · P2 · Code-confirmed — Resume and reset semantics need stronger artifact boundaries.** Reconstruction resume can trust a path/stage without rechecking all input/output hashes; reset clears imported stores but not immutable scans embedded in the installed demo. **Accept:** content-based invalidation of stale stages, failed-artifact recovery, and wording distinguishing user data deletion from bundled sample availability. Model-evaluation provenance is covered in M08.

Sources: [suggestion CLI](../scan/suggest.py), [calibration](../scan/calibration.json), [reconstruction](../scan/reconstruct.py), [Python schema](../scan/suggestion_schema.py), [scan contracts](../src/lib/scan-suggestions.ts), [asset validation](../src/lib/scan-model.ts), [local loader](../src/lib/local-scan-loader.ts), [picking](../src/lib/scan-pick.ts), [viewer](../src/app/ScanViewer.tsx), [packager](../scripts/ios-demo-scan.mjs), [Vite guard](../vite.config.ts). Spark lifecycle evidence concerns installed `@sparkjsdev/spark@2.3.1`, particularly `driveSort` continuing after `dispose` while awaiting readback.

## D. Information architecture, visual design, accessibility, and wording

- [ ] **U01 · P2 · Gap — Separate actual household use from the synthetic tour.** Demo identities, sample rooms, fictional profiles, and fictional programs currently dominate ordinary screens. **Accept:** a clearly identified sample mode and a real-data journey as capabilities arrive; no invented program presented as real. Move lengthy technical disclosures to details/About while retaining essential source, model-uncertainty, and sample labels at the decision point.

- [ ] **U02 · P2 · Gap — Rebuild navigation around tasks.** Test three tabs such as Home / Rooms / Requests, with the fix list prominent on Home, against four tabs such as Home / Rooms / Fix list / Help requests. Avoid Home and My home competing as destinations. **Accept:** residents can find rooms, current work, and requests without coaching; capture belongs to Rooms, not a buried More utility.

- [ ] **U03 · P2 · Gap — Remove duplicated navigation and excessive chrome.** Help, person switching, repeated headings, and overlapping Home menus consume attention; question navigation and screen navigation both say Back. **Accept:** one clear account/switcher entry, distinct support versus assistance labels, deliberate Back behavior, compact chrome, and an accessible page heading without needless visual repetition. Do not remove semantic headings just to save pixels.

- [ ] **U04 · P2 · Gap — Replace the scan tool panel with a room experience.** The UI leads with Choose Files, internal capture names, model/backend/license strings, file extensions, and desktop keyboard instructions. **Accept:** a full-screen or dominant room view, touch-first controls, simple reset view, clear photo/map/3D switching, and synchronized evidence cards. Keep import/debugging and device-specific instructions in appropriate advanced paths rather than deleting useful keyboard access.

- [ ] **U05 · P2 · Gap — Replace long resources rule trees with useful assistance decisions.** Raw predicates such as expected equal to maple and seven fictional profiles are not an elder-facing discovery interface. **Accept:** a concise sourced resource entry or maintained relevant programs, a few necessary questions, plain-language unknown/match explanations, and expandable criteria/source detail. Relevant work, criteria matching, and approval remain distinct.

- [ ] **U06 · P2 · Gap — Put evidence and the next decision together.** Checklist, request, sharing, and timeline screens bury key actions under repeated status/explanation blocks. **Accept:** one clear primary action per stage, nearby evidence, progressive disclosure, and a review of exactly what will be shared. Preserve separate answering and explicit confirmation, potentially on the same screen; do not merge them into an implicit confirmation.

- [ ] **U07 · P2 · Code-confirmed / Gap — Make onboarding a deliberate flow.** Guides currently render inside the regular tab shell and can be silently left. **Accept:** focused onboarding outside the shell, explicit skip/resume, role-appropriate guidance, permission requests when needed, and safe handling of deep-link destinations. Avoid forcing the full tutorial on every launch.

- [ ] **U08 · P2 · Gap — Design distinct resident, family-helper, and volunteer experiences.** Residents primarily review, decide, and follow progress; helpers capture and coordinate within granted capabilities; volunteers see assigned work and explicitly shared context. **Accept:** each role has a coherent Home and task flow. Offer helper-led capture without making an older resident walk around holding a phone; preserve optional accessible resident use rather than an arbitrary age-based prohibition.

- [ ] **U09 · P2 · Gap — Separate unanswered, uncertain, and not-applicable states.** Current unknown conflates missing answers and a thoughtful Not sure response. **Accept:** clear progress semantics and follow-up paths; uncertainty does not trap someone in perpetual onboarding/checklist incompletion or become a false No. Completing the checklist never implies the home is safe.

- [ ] **U10 · P2 · Gap — Establish a coherent visual hierarchy.** Equal-weight bordered cards, pill buttons, slab headings, mono uppercase labels, identical house icons, raw file inputs, and browser-default progress styling feel assembled rather than designed around tasks. **Accept:** consistent typography/spacing/control hierarchy, meaningful room imagery where consented, clear selected/disabled/loading states, and accessible progress indicators. Avoid replacing the current style with another decorative template.

- [ ] **U11 · P2 · Verify — Qualify accessibility and language with intended users.** Narrow width and dictionary key parity do not prove usability. **Accept:** complete tasks at 320px and large text; exercise VoiceOver, keyboard, focus visibility, reduced motion, contrast, touch targets, long translations, and errors. Obtain human Spanish review and test with older adults and helpers. Preserve readable user-authored content and avoid unexplained terminology.

- [ ] **U12 · P4 · Gap — Add optional polish after the core journey works.** Consider dark mode, restrained transitions, meaningful haptics, clearer native-style photo controls, and better empty/loading/offline states. **Accept:** these improve comprehension or feedback, respect reduced motion/system preferences, and do not delay integrity, accessibility, or capture acceptance. Lack of haptics or dark mode alone is not a demo blocker.

Sources: [phone shell](../src/app/PhoneShell.tsx), [resident screens](../src/app/ResidentScreens.tsx), [people and onboarding](../src/app/PeopleScreens.tsx), [settings/resources](../src/app/SettingsScreens.tsx), [scan panel](../src/app/ScanPanel.tsx), [styles](../src/styles/base.css), [English](../src/i18n/en.ts), [Spanish](../src/i18n/es.ts). Functional navigation/focus/save-announcement defects are tracked in N01–N15 rather than counted again here.

## E. Integrated recording and room capture

- [ ] **C01 · P3, early feasibility test · Gap — Prove native capture on the target phone.** Add a bounded ARKit/Capacitor investigation on the standard iPhone 17: launch, permissions, world tracking, posed photos, cancellation, save, relaunch, and reopen. **Accept:** actual phone evidence before a broad implementation commitment; fall back to guided photos when tracking is unavailable. RoomPlan requires supported LiDAR hardware and is not the base-iPhone-17 solution.

- [ ] **C02 · P3 · Gap — Record inside the app.** The current still-photo picker and developer CLI are not the requested guided walkthrough. **Accept:** a room-specific capture screen with clear instructions, progress, pause/finish/cancel, original frames, poses/intrinsics/timestamps where available, and a review step before processing. Camera tracking does not by itself prove measured geometry.

- [ ] **C03 · P3 · Gap — Make room captures persistent first-class records.** One global scan cannot represent a household. **Accept:** room and capture IDs, multiple rooms and capture versions, dates, replacement/archive, associated evidence, storage budgeting, delete/export, and recovery after interrupted writes. Household/schema migration is tracked in F01.

- [ ] **C04 · P3 · Gap — Provide an immediately understandable room representation.** For the non-LiDAR route, evaluate an approximate tapped outline or available tracked geometry with a 2D map and optional 3D sketch. **Accept:** useful photo locations, clear approximation labels, upright orientation, manual correction, and a photo-only fallback. Do not infer accuracy from ARKit's coordinate units or imply the sketch reconstructs unobserved detail.

- [ ] **C05 · P3 · Gap — Decide and disclose where reconstruction runs.** An interim export to the user's Mac and import back can reuse the existing pipeline. The full product needs a measured on-device path, an explicitly disclosed companion workflow, or a separately authorized opt-in server job. **Accept:** no hidden upload or implied phone processing; clear transfer/progress/result ownership. A Mac round trip is an interim demo limitation, not completion of the fully in-app goal.

- [ ] **C06 · P3 · Gap — Build a recoverable processing-job lifecycle.** Capture, frame selection, reconstruction, inference, and import can fail independently. **Accept:** resumable/cancellable jobs, retry without duplicate results, progress tied to real stages, failure reasons, app background/foreground recovery, cleanup of partial artifacts, and no permanently busy screen.

- [ ] **C07 · P2/P3 · Gap — Add capture-quality and physical-use guidance.** Include blur/exposure/coverage feedback, lost-tracking recovery, safe stopping, and targeted photos for the chosen questions. **Accept:** the user knows what needs recapturing and can complete a useful photo-only path when a room is reflective, plain, dark, cluttered, or otherwise difficult to reconstruct.

- [ ] **C08 · P3 · Gap — Make capture privacy and permissions intentional.** Do not collect audio merely because video is being captured. Strip unnecessary location/EXIF metadata from exported evidence; explain any deliberate transfer. **Accept:** camera-denied/limited/unavailable paths, preview before sharing, user-controlled deletion, bounded local retention, and permission strings matching actual behavior. Microphone usage text is required only if an audio feature uses it.

- [ ] **C09 · P3 · Gap — Distinguish 3D viewing from live AR and evaluate both.** The current splat viewer is not a live camera overlay with persistent real-world anchors. **Accept:** accurate feature names, a useful standard viewer first, and live AR only if it improves a measured task. Photoreal splats, RoomPlan on supported devices, and platform-native renderers are options to validate; none substitutes for reconstruction or concern evaluation automatically.

Sources and existing plans: [scan pipeline](../scan/README.md), [recording requirements](video-shot-list.md), [current architecture](architecture.md), [native shell/print plugin](../ios/App/App/SceneDelegate.swift), [Apple RoomPlan](https://developer.apple.com/augmented-reality/roomplan/), [iPhone 17 specifications](https://www.apple.com/iphone-17/specs/). The native capture brief remains a proposal, not evidence that these capabilities are implemented.

## F. Model reliability, evaluation, and claims

- [ ] **M01 · P2/P3 · Gap — Narrow the initial model task to visibly answerable conditions.** Select two or three conditions with explicit definitions and exceptions rather than claiming general home hazard detection. **Accept:** documented question/label meanings, representative positive/negative/uncertain cases, and manual questions for properties a photo cannot establish, such as secure installation or lighting at another time.

- [ ] **M02 · P2 · Code-confirmed — Replace AI-only labels as the acceptance ground truth.** The calibration record labels 102 development and 23 held-out photos using another model's judgments. **Accept:** a labeling guide, independent human labels, disagreement resolution, and relevant specialist review for the intended claims. AI labels can assist development but do not establish real-home safety accuracy.

- [ ] **M03 · P2 · Code-confirmed — Positive support is inadequate per condition.** The held-out set has eight positive labels total, distributed 1, 1, 2, 0, 0, 1, 1, 2 across eight questions. **Accept:** sufficient independent positive and negative households per condition for meaningful uncertainty estimates; retain insufficient-evidence states. Zero positives in this held-out split does not establish zero positives in every development dataset.

- [ ] **M04 · P2 · Code-confirmed — Pooled calibration improvement hides weaker categories.** Pooled Brier improved from about 0.02485 to 0.01293, while three categories worsened and the adoption rule still allowed them. **Accept:** category-level acceptance/abstention decisions, uncertainty intervals, and comparison against uncalibrated/simple baselines. Do not equate calibration adoption with validated home-safety probabilities.

- [ ] **M05 · P2/P3 · Gap — Evaluate the deployed capture-to-alert policy.** Single-photo evaluation does not evaluate relevance gating, max-over-many-frames aggregation, thresholds, or repeated alerts. **Accept:** hold out whole households, measure per-condition precision/recall and false alerts per room, account for missed concerns and uncertain/unobservable cases, and test the exact deployed policy. The supplied review reports a demonstration scene in the development split; verify manifests and never present that scene as independent test evidence.

- [ ] **M06 · P2/P3 · Gap — Evaluate evidence selection and localization separately.** A correct category score does not prove that the chosen photo or marker points to the concern. **Accept:** metrics for evidence usefulness, object/region localization, geometric placement, duplicates, and multi-room/multi-instance identity; unsupported locations remain photo-only. Address the implementation defects in S13–S14 first.

- [ ] **M07 · P2 · Gap — Preserve uncertainty and human control in every view.** Show a possible concern with the actual question, supporting photo, limitations, and a review decision. **Accept:** model output never answers/pre-fills/confirms the checklist, silently enters the plan, or implies a safe home when no item is suggested. Explicit answering and confirmation remain separate. Users can dismiss, defer, correct location, and ask a helper without losing provenance.

- [ ] **M08 · P2 · Code-confirmed / Gap — Strengthen reproducibility and prevent calibration transfer errors.** Pin image/capture bytes, actual model-weight identity, prompts, preprocessing, inference conditions, thresholds, calibration, and aggregation. Evaluation resume must not trust only a manifest path/model name when bytes change. **Accept:** changed inputs invalidate dependent results; a different model/runtime is independently evaluated and does not inherit calibration by assumption.

- [ ] **M09 · P3 · Verify — Establish an on-device inference option empirically.** Current StartLux execution is Mac-based; it has not been implemented/qualified on the target phone. Evaluate narrow Core ML detectors, a smaller compatible VLM/decision model, or supported platform image models against the same tasks. **Accept:** measured accuracy, memory, download size, latency, battery/thermal behavior, SDK/OS support, and interruption handling. 'The 9B model cannot run on any phone at all' is not an established result; smaller models are not proven adequate merely because they fit.

- [ ] **M10 · P3 · Gap — Resolve model licensing for the intended distribution.** StartLux code and weights have different licenses; the weights are CC BY-NC 4.0. **Accept:** a documented license/attribution inventory and a compatible license or replacement before commercial use. A public non-commercial demo is not automatically prohibited; technical feasibility and licensing remain separate decisions.

Sources: [calibration evidence and adoption rule](../scan/calibration.json), [production inference](../scan/suggest.py), [evaluation implementation](../scan/evaluate_model.py), [suggestions contract](suggestions-v2-contract.md), [StartLux license](https://github.com/StartLuxLabs/StartLux-Decision#license), [MLX Swift iOS/VLM examples](https://github.com/ml-explore/mlx-swift-examples). General MLX iOS support does not prove compatibility or acceptable performance for the specific FixList model.

## G. Accounts, shared households, and remote collaboration

- [ ] **A01 · P3 · Gap — Add actual Google and Apple sign-in.** The person switcher is a local demonstration mechanism, not authentication or multi-person coordination. **Accept:** working provider flows on the target platforms, cancellation/error handling, clear account identity, and an honest distinction between guest/sample mode and a signed-in household. Apple's guideline 4.8 has exceptions and requires an equivalent privacy-preserving option in applicable cases; Sign in with Apple is the intended option here, not a universal rule inferred from any Google button.

- [ ] **A02 · P3 · Gap — Establish trusted authentication and session infrastructure.** Select a backend/auth service against household, media, offline, deletion, and deployment requirements rather than choosing by the appearance of its login widget. Firebase/Supabase were suggestions, not an accepted architecture. **Accept:** server-verified provider tokens, correct audience/issuer/expiry handling, secure session/token storage and revocation, no client-controlled identity authority, and documented recovery behavior.

- [ ] **A03 · P3 · Gap — Enforce household permissions on the server.** Local role projections are a useful design but do not secure a connected API. **Accept:** household ownership/membership and granular delegation on every command/read; cross-household and revoked-user negative tests; professional-work restrictions preserved; no complete household object sent to volunteer clients.

- [ ] **A04 · P3 · Gap — Implement a real invitation lifecycle.** Add expiry, revocation, acceptance, wrong-account recovery, intended-household confirmation, and duplicate/expired-link handling. **Accept:** recipients join only the intended scope, possession of an email address is not treated as authority, and a stale invitation cannot recreate revoked access.

- [ ] **A05 · P3 · Gap — Handle provider linking and identity changes.** Plan for Apple private relay addresses, Google/Apple accounts belonging to one person, provider unlinking, and reauthentication for sensitive changes. **Accept:** explicit safe linking and recovery without accidental account merging or ownership transfer based only on matching email text.

- [ ] **A06 · P3 · Gap — Design guest, shared-device, logout, and offline behavior.** Preserve a useful local trial where appropriate; migrate only with explicit ownership/consent. **Accept:** account switching clears unauthorized cached views, session expiry explains what is saved, offline changes have an honest pending state, and logout/relaunch cannot expose another household's data.

- [ ] **A07 · P3 · Gap — Authorize media as carefully as metadata.** Photos, scans, thumbnails, exports, and model evidence can reveal a home. **Accept:** protected storage/download authorization, scoped links/caches, deliberate sharing previews, revocation of future access, and tests showing guessed IDs or old links cannot bypass membership. A revocation cannot make someone forget material already viewed.

- [ ] **A08 · P3 · Gap — Add account/household deletion and export.** Cover raw captures, derived geometry, suggestions, caches, invitations, and retained history, with clear ownership consequences for shared households. **Accept:** user-accessible deletion/export, documented retention behavior, deletion propagation, and verification across devices. Account creation brings an in-app deletion requirement for applicable App Store distribution.

- [ ] **A09 · P3 · Gap — Make synchronization conflict-aware.** Move revisions and permission changes to an authoritative transactional boundary; do not replicate local whole-state overwrite behavior. **Accept:** concurrent edits, offline replay, cancellation, reset/deletion tombstones, and revoked permissions cannot resurrect stale access or terminal work; conflicts are understandable to the user.

- [ ] **A10 · P3 · Gap — Define collaboration trust and operating responsibility.** Keep initial helpers invitation-based unless a separately designed marketplace is justified. **Accept:** clear self-reported skills versus verified qualifications, task boundaries, report/block/support paths, consent/privacy terms matching actual processing, and an identified process for managing real resource records and account problems. Do not describe volunteers as vetted without an actual verification process.

Sources: [existing accounts plan](v2-accounts-plan.md), [role requirements](roles-journey-spec.md), [Google backend token verification](https://developers.google.com/identity/sign-in/ios/backend-auth), [Apple login-services guideline](https://developer.apple.com/app-store/review/guidelines/#login-services), [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

The current no-backend/no-auth scope must be reconciled with the selected architecture when that implementation is authorized. Updating the documentation records the scope decision; it is not a substitute for building secure collaboration and is not itself an additional permission ceremony. This compilation does not authorize starting that work.

## H. Household, task, assistance, and product improvements

- [ ] **F01 · P3 · Gap — Generalize the fixed household with a real schema migration.** Current storage requires Maple House/Margaret and immutable fixture identities. **Accept:** validated household ownership, names, roles, rooms, migrations, and retained attribution; separate fixtures from actual user records. Do not simply remove the resident-ID check and weaken validation.

- [ ] **F02 · P3 · Gap — Separate concern types from instances and occurrences.** Eight fixed catalog concerns cannot represent two rugs, multiple bathrooms, repeated problems, or several locations of one concern. **Accept:** room-linked instances and episodes, stable IDs, independent evidence/confirmation/completion, deduplication across frames, and historical continuity without conflating current and old work.

- [ ] **F03 · P3 · Gap — Support manual room evidence and concerns.** Users need to add a room photo, caption, location note, or uncatalogued concern even when the model cannot help. **Accept:** evidence can be organized by room before it belongs to a checklist item, original/cropped/annotated versions remain understandable, and manual additions do not masquerade as model findings.

- [ ] **F04 · P2/P3 · Gap — Add a self-fix path.** Removing clutter or making a simple change should not require pretending a volunteer performed it. **Accept:** record who acted, the change, evidence, and explicit resident review without bypassing professional routing or losing the original concern.

- [ ] **F05 · P2/P3 · Gap — Track professional referral follow-through.** Support contacted, waiting for response, visit booked, quote received, and work reported complete as appropriate. **Accept:** the referral advances beyond a resource link and can be cancelled/reopened; professional work is never silently reassigned to an ordinary volunteer. Resolves the D09 loop with a real workflow.

- [ ] **F06 · P3 · Gap — Make scheduling and reminders practical.** Add availability, proposed versus accepted times, rescheduling, cancellation reasons, and optional reminders/follow-up. **Accept:** both parties understand the current appointment and pending decision; timezone/offline/notification preferences are handled; an unsent local record is not presented as a delivered message.

- [ ] **F07 · P2/P3 · Gap — Make completion review substantive.** Include before/after photos where appropriate, work summary, unresolved problems, and a resident's Not done yet decision. **Accept:** completed, reported complete, and independently verified remain distinct; recurrence opens a new episode; before/after views help rather than implying proven repair quality.

- [ ] **F08 · P3 · Gap — Replace fictional screening with maintained real assistance information.** Start with the sourced Eldercare Locator entry or a narrowly scoped verified locality; a ZIP-based handoff/search needs a real supported destination. **Accept:** source, jurisdiction, contact, last checked date, maintenance owner, missing facts, and availability caveats; no invented verification date, funding guarantee, or claim that matching equals approval.

- [ ] **F09 · P3 · Gap — Give users a manageable fix list.** Add room/status/person filters, user ordering, dates, assignees, notes, materials/cost information when actually known, and archive/reopen. **Accept:** priorities are explainable and editable; authored catalog order is not labeled a validated risk score; unknown cost and professional scope remain visible.

- [ ] **F10 · P2/P3 · Gap — Validate usefulness and differentiation.** Compare photos alone, photos plus a map, and photos plus 3D for locating a concern and explaining work. Test resident comprehension, helper coordination, time to useful next action, capture completion, and follow-through; do not infer fall reduction. **Accept:** a small documented user pilot and clear continue/pivot criteria. HomeFit AR and RASSAR are close precedents; differentiate through accessible review, selective sharing, and completed-work follow-through rather than claiming room scanning itself is novel.

Sources: [scenario/fixtures](../src/data/demo-scenario.ts), [state validation](../src/lib/state-validation.ts), [product hypothesis](product-validation.md), [real resource record](../src/data/local-help-resources.ts), [HomeFit AR](https://apps.apple.com/us/app/homefit-ar/id1513619492), [RASSAR primary paper](https://arxiv.org/abs/2404.07479).

## I. Tests, maintainability, packaging, and release quality

- [ ] **E01 · P2 · Gap — Add CI at the start of remediation.** No tracked GitHub workflow was found. **Accept:** reproducible supported Node/npm setup, typecheck, build, meaningful JavaScript and Python tests, and failures treated as failures. Preserve exact direct versions/lockfile; do not install or upgrade dependencies casually during unrelated fixes.

- [ ] **E02 · P2 · Gap — Test interactions in the mounted application.** Static rendering and pure-domain tests missed route, focus, reload, and async behavior. **Accept:** focused browser journeys for each role, the reproduced races/lifecycle failures, refresh/deep links, storage recovery, narrow layout, and keyboard interaction; native tests for native behavior. Add regression tests for actual failure modes rather than increasing counts with tests that mirror implementation.

- [ ] **E03 · P2/P4 · Code-confirmed / Gap — Remove or isolate obsolete desktop UI after an inventory.** `WorkflowSections.tsx`, `FloorPlan.tsx`, and old layout selectors such as rail/shell/stages/toast/step-nav need a usage audit; some tests exercise components not mounted in the current app. **Accept:** tests cover current flows, genuinely unused code/styles are removed or archived, and print/responsive/shared styles remain intact. 'Delete half of base.css' is not an approved mechanical operation.

- [ ] **E04 · P2 · Code-confirmed — Replace numbered legacy translation keys safely.** There are 243 `legacy.*` English keys. **Accept:** semantic names across callers and both dictionaries, typed parity, preserved meaning, a translator-readable structure, and no dead/untranslated strings. This is a rename/migration, not deletion of supported messages.

- [ ] **E05 · P2/P4 · Gap — Make control flow and formatting reviewable.** `App.tsx` has a long route branch chain and many compressed JSX lines; other screen files follow the same pattern. **Accept:** coherent navigation/persistence/feature boundaries, ordinary formatting, typed error handling, and suitable lint/format checks. Choose tools/dependencies proportionately; avoid a framework rewrite or broad abstraction solely to reduce line count.

- [ ] **E06 · P2 · Code-confirmed — Consolidate current documentation without erasing history.** README and reports have stale counts, schema/printing statements, and superseded acceptance claims. **Accept:** one current architecture/validation index, historical reports clearly dated/superseded, accurate commands, known limits, and links to evidence. Preserve the body of `fixlist-plan.md`, `assets/icon.svg`, provenance, and unrelated owner files.

- [ ] **E07 · P4 · Verified audit result — Resolve the development dependency advisory proportionately.** Three affected-package entries belong to one Capacitor/xcode/uuid chain, not three independently proven app exploits. **Accept:** assess the upstream supported fix, update only with justification, verify native tooling, and record applicability. Do not blindly run forced audit fixes or infer runtime exposure from the summary count.

- [ ] **E08 · P2 · Measured size / unproven cause — Investigate the lazy scan bundle.** The scan chunk is about 3.08 MB raw / 1.04 MB gzip while initial JS meets its budget. **Accept:** inspect actual module/worker/WASM composition, preserve lazy loading, set a justified scan budget, and measure loading on target devices. A namespace import does not itself prove all of Three.js survives tree shaking.

- [ ] **E09 · P2/P3 · Gap — Establish physical-device performance budgets.** Measure capture success/time, reconstruction/inference time, scan-open latency, interaction responsiveness, peak memory, repeated open/close, background recovery, battery, and thermal behavior on representative files. **Accept:** recorded baselines and target budgets, measured improvements, and bounded fallback behavior. Build size and a synthetic lifecycle harness do not establish real-device performance.

- [ ] **E10 · P2 · Verify — Qualify actual native printing and export.** The custom Swift print bridge now exists; older documentation saying native printing is unavailable is stale. **Accept:** inspect the native print sheet, readable pagination, a saved PDF, evidence/annotation inclusion, pending/failed-photo handling, and browser print separately. Do not substitute `window.print()` success in a browser for native acceptance.

- [ ] **E11 · P2/P3 · Code-confirmed / Verify — Clean up product metadata and test install/toolchain compatibility.** Review the synthetic-demo HTML title, version 0.0.0, obsolete armv7 capability declaration, supported orientations, and permission copy. **Accept:** correct identity/version/capabilities and a successful target-phone install/launch with the chosen signing/SDK setup. Verify compatibility before OS/Xcode upgrades; no blanket upgrade or deployment-target increase is approved by this checklist.

- [ ] **E12 · P2 · Gap — Finish provenance, assistance, and authorship records.** Resolve contribution/disclosure placeholders and asset/model licenses; keep source captures private and public demo assets deliberately publishable. **Accept:** truthful student technical contribution and understanding, actual AI/tool assistance, synthetic versus real evidence, and no private photos/addresses/tokens in Git, public assets, or recordings intended for publication.

- [ ] **E13 · P2/P3 · Gap — Make readiness a set of demonstrated gates.** Define the exact demo/product scope, recheck submission requirements when relevant, and exercise the full selected journey before recording. **Accept:** no false confirmation, misleading save/reset/completion, unauthorized sharing, or untested central capability hidden by a successful build. October 26 is a scheduling reference from the discussion, not a verified guarantee that this workload fits or a substitute for checking current official submission requirements.

Sources: [package scripts](../package.json), [old workflow UI](../src/app/WorkflowSections.tsx), [floor plan](../src/app/FloorPlan.tsx), [styles](../src/styles/base.css), [translations](../src/i18n/en.ts), [native metadata](../ios/App/App/Info.plist), [native print bridge](../ios/App/App/SceneDelegate.swift), [AI/contribution disclosures](ai-disclosures.md), [video shot list](video-shot-list.md), [uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

## Corrections that must survive into implementation briefs

These resolve disagreements in the supplied reviews; they are not additional work items.

1. The app has multiple screens today. The problem is overloaded screens and incoherent task navigation, not literally all functionality rendered on one page.
2. Remove demo scaffolding by separating/replacing synthetic features, not by concealing fictional status or model uncertainty.
3. Base iPhone 17 does not support the LiDAR-dependent RoomPlan path. Use capability checks and validate the selected ARKit/photo route on the actual phone; 'any recent iPhone' is not a substitute for supported-device/runtime checks.
4. Current StartLux inference is Mac-based and unqualified on the phone. A universal impossibility claim about running the model on phones was not established. Size, runtime compatibility, quality, and license are separate questions.
5. The file-byte limit is enforced before decoding; the decoded splat limit comes later. A phone memory risk is not an observed out-of-memory crash.
6. Spark's post-disposal allocation race is reproduced, including a worker and texture created after cleanup. Real-device leak rate and memory impact still need measurement. Existing app cleanup does not eliminate this library continuation.
7. The print preparation loop yields asynchronously; it is not busy-waiting. Native printing already has a custom bridge, while native pagination/PDF quality remain unqualified.
8. Two answer-handler commands perform two writes, but React batching and assistive technology determine actual announcement behavior. Do not remove all success feedback without user testing.
9. The photo capture attribute requests capture behavior. Separate camera/library actions and physical-device verification are the appropriate requirement; universal picker behavior is not established from source alone.
10. Apple login guideline 4.8 is conditional and has exceptions. Sign in with Apple is the chosen intended counterpart to Google, not an absolute rule applying to every app with any Google login.
11. A microphone permission is needed for an actual audio feature, not automatically for silent room video/photos.
12. The scan chunk's size has been measured; blaming it solely on a whole-library Three.js import has not been established.
13. Fixed resident IDs are intentional current-demo constraints and future product limitations. Replacing them requires a validated schema/migration, not simply deleting a guard.
14. The helper resources fallback protects ungranted facts. Correct its confusing UX without broadening access implicitly.
15. State-specific page heights differ across viewports and expanded content. They support the same overload finding and should not be treated as contradictory measurements.
16. The eight held-out positives and two zero-positive categories refer to this held-out evaluation, not every possible development example. A development/demo scene does not establish held-out model usefulness.
17. Imported and embedded sample assets have different deletion lifetimes. Privacy copy must describe those lifetimes accurately.
18. No typography choice, absent animation, or lack of dark mode is by itself proof of an unusable or unready product; task comprehension and reliable behavior matter more.
19. User-authorized scope expansion should be recorded in AGENTS/architecture/role/privacy documents when implemented. Editing those documents does not itself build accounts or authorize external transfers.
20. This backlog is not a promise that all stabilization, UI, and migration work fits before October 26. Do not replace estimates, dependencies, and physical acceptance with a calendar assertion.

## Merged order of work

### Phase 0 — Freeze the scope, establish checks, and test the riskiest assumption

Keep this reviewed baseline and select measurable acceptance scenarios. Add CI and focused journey/regression coverage early (E01–E02). In parallel with planning/stabilization, run the bounded native feasibility test C01 when implementation is authorized. Check installation, permissions, posed-photo persistence, interruption, and reopening on the real iPhone before committing to a large capture architecture.

### Phase 1 — Protect data and make core lifecycles reliable

Prioritize D01–D09, S01–S08, and the broken routing/pin behaviors N01–N05. Cover stale tabs, reset/photo races, storage capacity, cancellation/recurrence, both completion decisions, sharing lifetime, the default Python command, packaging boundaries, scene identity, and Spark disposal. Add the remaining source-confirmed interaction fixes according to impact. Acceptance comes from regression behavior and durable state, not a higher test count.

### Phase 2 — Rebuild information architecture and the essential resident/helper flows

Prototype U01–U11 and complete N06–N14. Choose task-named navigation through a quick intended-user test; make rooms/capture and requests findable; separate onboarding; reduce chrome and duplicated actions; make evidence/confirmation/share review coherent; preserve accessibility and essential disclosures. Replace or isolate fictional assistance rather than merely hiding its labels.

### Phase 3 — Generalize the local data model and remove obsolete scaffolding safely

Implement F01–F03 with schema/migration tests, then E03–E06. Replace fixed household identities, represent multiple rooms/concern instances/captures, preserve legacy history, rename translation keys, and remove genuinely unused desktop UI/styles. Do not allow cleanup to weaken validation, permissions, printing, or localization.

### Phase 4 — Complete the integrated capture-to-review path

Build C02–C09 and resolve the geometry/artifact issues S09–S16. Start with guided photos/poses and a useful approximate room representation; add optional photoreal reconstruction only after the path works. The interim Mac round trip must be visible and honestly described. Complete M01–M08 before presenting model outputs as credible alerts; assess M09–M10 before selecting/shipping on-device inference.

### Phase 5 — Make help coordination real

Implement A01–A10 alongside the relevant F04–F09 workflows. Preserve the domain's explicit human confirmation and volunteer projection boundaries while adding server-enforced identity, household membership, media access, invitations, revisions, deletion, and sync. Validate the full journey on separate devices. A local person switcher never counts as remote coordination acceptance.

### Phase 6 — Qualify, polish, document, and record the selected experience

Complete E07–E13, F10, and justified U12 polish. Test intended users, physical-device performance, accessibility/language, print/PDF, recovery, privacy, and the actual recorded journey. Update current documentation and contribution/source disclosures. Commit, publish, deploy, upload, or send externally only under the relevant authorization.

## Acceptance scenarios and continue/pivot gates

- **Durable privacy:** revoke a field, edit from a stale second client, reload both, and confirm access stays revoked. Reset with in-flight photo/scan work and verify data stays deleted. Capacity exhaustion must not prevent privacy exits.
- **Complete request lifecycle:** confirm a concern, create/cancel a request, start a new episode, complete it, report recurrence, and reject premature completion at the history limit. Home must never call unresolved work done.
- **Understandable navigation:** an intended resident can find a room, review evidence, make a confirmation decision, request help, and review completion without coaching. A helper and volunteer can find their own next action and cannot enter ungranted areas.
- **Capture resilience:** deny permission, cancel midway, lose tracking, background/terminate, relaunch, and reopen the right room. Captured evidence must survive appropriately; partial jobs must be recoverable or removable.
- **Artifact identity:** wrong-room suggestions, changed source bytes, stale resume outputs, malformed bundles, and symlink escapes must fail safely. An approximate location must not be displayed as a precise measurement.
- **Human/model separation:** suggestions never auto-answer or confirm; no suggestions never means safe. A person can defer uncertainty, add a manual concern, and understand the photo question actually evaluated.
- **Real collaboration:** resident and helper/volunteer use different devices and accounts; invitations expire/revoke; another household cannot access records/media; completion requires the intended human review.
- **Native and accessibility acceptance:** test actual phone controls, camera/library choice, VoiceOver, large text, focus, repeated 3D open/close, native printing, PDF pagination, and interruption behavior. Simulator/browser evidence remains separately labeled.
- **Continue:** the selected core journey works with trustworthy persistence and intended-user comprehension; add complexity only when it improves a measured task.
- **Pivot:** use photo-first review or a simple map when geometry, device support, performance, or capture burden prevents reliable 3D use. Keep the full 3D goal on the roadmap with an explicit unmet gate.
- **Stop a claim or rollout:** do not call the model reliable detection without the relevant evidence, do not accept real shared-household data before authorization/media boundaries work, and do not call a manual Mac round trip fully in-app processing.

## Demo scope versus product scope

A polished local demo can show one honest flow with explicitly local profiles, synthetic or consented evidence, human confirmation, a fix list, local request history, and reviewed output. It must pass the relevant integrity, accessibility, and native demonstration gates.

The broader product Andrew requested includes actual in-app capture, useful room rendering, model-assisted evidence review, and Google/Apple accounts with cross-device collaboration. Deferring capture or accounts is a scope reduction for an interim demo; it does not make those requirements disappear or establish that the full product is ready.

Keep the two scope statements separate in the video, README, and acceptance report. No fabricated processing, sign-in, contact, qualification, funding, measurement, accuracy, repair verification, or student contribution should be implied to bridge the gap.
