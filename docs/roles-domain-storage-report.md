# Roles domain and storage handoff — 2026-10-18

Implemented on `codex/fixlist-core-2026-10-17` as the requested implementation worker, using the running `gpt-6.1-sol` / xhigh harness. No child agents, new dependency, commit, branch promotion, upload, external send or deployment. Parent review/acceptance is pending. `scan/`, `package.json`, the lockfile, `ios/` and Capacitor configuration were not edited by this task. Existing unrelated owner files were left alone.

## Implemented interfaces

- `DemoCommand` always carries `actorId` and caller-supplied `at`. All request edits also require `expectedRevision`; creation uses 0, producing revision 1. `applyCommand` returns an immutable next state or a plain-language error.
- Fixed fictional Margaret/Sam/Alex/Jordan; one resident-owned Maple House; user-created demo people; individual language, onboarding, checklist position and self-reported volunteer profiles. No role-edit command exists.
- Explicit independent delegation grants, own-photo permissions, resident-only approvals, invited-volunteer-only task operations, legal lifecycle, stale-update guards and attributed request history.
- `visibleRequestsFor(scenario, state, actorId)`, `visibleHouseholdFor`, `elderNextStep`, `volunteerNextStep`, and `groupPlanByEffort`. Volunteer projections never spread the underlying request; unshared optional fields are absent keys.
- Authored exact CDC-based next-step text/effort for all eight actions; separate verified [Eldercare Locator](https://eldercare.acl.gov/) resource. The official page was read in this run; its public-service description, phone and Area Agency on Aging context support the authored resource. Fictional programs remain synthetic.
- Schema-v3 exact reconstruction and recovery; in-memory-only v1/v2 migration; per-photo metadata plus JPEG blobs in a dedicated IndexedDB store; owned-store reset.

## Migration and ambiguity decisions

All three v2 request statuses map to **unassigned draft**, revision 1, sharing off, no accepted volunteer, proposal, progress, volunteer completion or resident acknowledgment. Original status and family completion attribution/time remain under `legacyHistory`, labeled **Family record (before roles)** and explicitly inactive history. Creation time is null because v2 never stored it. Existing answers, confirmations and facts-profile selection survive. The draft follows current plan activity, while its legacy note stays historical. Load never writes; explicit subsequent save writes v3. v1 remains supported through its frozen two-question allowlist and does not infer facts from criterion statuses.

Declining retains `declined` but immediately removes volunteer access. Withdrawal/cancel-invitation returns to draft and clears current assignment/shared fields; resident reassignment then requires a new invite. Prior events stay in history. “Not done yet” applies to a volunteer completion report and returns to in_progress. Confirmed completion and request cancellation are terminal. Unconfirmation suspends volunteer visibility and normal edits; privacy reductions still work while inactive. No invitation expiry duration is invented because none is specified.

Any known demo actor may create a profile or switch person; this never grants household permissions. Household facts-profile selection is resident-only. Checklist grants expose checklist/photos/scan capability; confirmation grants expose confirmations/plan; requests grants expose plan/request details. The resident can remove only resident-owned photos, following “own photos” in the permission table. A `wait_for_volunteer` selector result distinguishes pending work from done. Scan sharing stores an opaque local pin ID; resolving its image without exposing the whole scan is a UI responsibility.

## Validation evidence

- Node 24.18.0 / npm 11.16.0; `npm ci` completed with the existing lockfile.
- `npm run typecheck`: passed.
- `npm test`: **913 passed across 21 files**. Includes permission combinations, ungranted/revoked delegation, unknown/incorrect actor roles, every lifecycle edge, duplicate acceptance, stale edits, professional routing, key-level projection privacy/revocation, selectors, frozen-state immutability, exact-shape/attribution/history validation, v2 migration without writes, v3 round trips, legacy v1 rejection boundaries and storage/reset failures.
- `npm run build`: passed. Initial index JS: **111.38 kB gzip**, below the 250 KiB budget. Existing lazy ScanViewer chunk remains large (1,037.18 kB gzip); no latency claim is made.
- `git diff --check`: passed.
- Real browser at `http://127.0.0.1:5173`: clicked rug yes (zero plan actions), explicitly confirmed (one action), created local draft (revision 1, Margaret attribution), refreshed the report and reloaded the same origin (answer/action/draft retained, no error alert). Keyboard Tab reached the print button with visible focus. At 320 px, document scroll width was 320 px. The refreshed on-screen report contained request status, attribution and verification/history boundaries. Native pagination/PDF was not revalidated in this increment.
- Real browser canvas/IndexedDB: re-encoded a synthetic 3200×1800 PNG to a **1600×900 JPEG** (9,308 bytes, no EXIF marker), wrote/read it with matching byte size, and deleted the test blob.
- Task's 5173 dev server stopped after verification. Parent's 4173 preview remained listening under the same PID, 22732.

## Changed files

Existing files: `docs/architecture.md`; `src/app/App.tsx`, `WorkflowSections.tsx`, `PrintReport.tsx`, `display.tsx`, `catalog-views.test.tsx`; `src/data/demo-scenario.ts`; `src/domain/types.ts`, `workflow.ts`, `rules.ts`, `plan.ts`, `catalog.ts`, `workflow.test.ts`, `catalog.test.ts`; `src/lib/demo-storage.ts`, `demo-storage.test.ts`.

New files: `src/data/demo-people.ts`, `local-help-resources.ts`; `src/domain/roles.ts`, `role-views.ts`, `roles.test.ts`, `roles-test-helpers.ts`; `src/lib/state-validation.ts`, `legacy-demo-state.ts`, `photo-storage.ts`, `photo-storage.test.ts`, `roles-storage.test.ts`; this report.

## Next UI task

Build profile/language selection, guides, elder/volunteer screens, sharing approval/revocation and invitation controls, visit/report/completion controls, typed English/Spanish dictionaries and error localization. Dispatch explicit actors, consume role projections, and carry request revisions from the displayed read model. Render `SHARING_REVOCATION_NOTICE` on revocation and label skills/availability and independent verification honestly.

Integrate photo input → `reencodePhoto` → `getPhotoStore().write` → metadata command; compensate for failed metadata persistence/blob writes, clean up removals, render projected photo IDs only, and prepare local photo URLs for native print. Integrate the effort grouping, local-help resource and shared scan-location image. Use `resetFixListData` for complete reset. The old resident screen remains able to answer, confirm and create drafts; obsolete family status/completion buttons were removed because they bypass the role lifecycle. New role journeys, translations, native photo/print and iOS accessibility acceptance remain pending.
