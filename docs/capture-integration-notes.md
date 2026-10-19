# Capture integration notes (2026-10-18)

Implementation worker: Codex; the parent records the selected model through its routing controls. This records AI-assisted code and synthetic deterministic checks. Parent review, full-suite/build checks, browser acceptance and native runtime acceptance remain separate evidence. No private capture, external send, dependency, domain schema, commit or physical device operation was used by this worker.

## Native interface repair

`NativeCaptureStartOptions` now requires `roomId` and accepts `checklistItemId: string | null`. The web passes the real room identity without a type assertion. Swift requires a bounded nonempty `roomId`, accepts an explicit JSON null for an overview prompt, and rejects absent, numeric or empty checklist IDs. The existing controller emits `options.roomId`; the web rejects a mismatched native capture/room identity before reading/storing its files. This supersedes the optional/empty room identity and overview-type gaps described in the initial native/web implementation notes. The binding contract's native-options table should include `roomId` at final integration.

The Debug Simulator bridge probe now calls the actual Capacitor JavaScript plugin with an overview and a checklist prompt. It asserts that realistic input reaches the Simulator's `unavailable` result, and that three malformed prompt variants return `failed` / `invalid-options`. The synthetic share probe remains opt-in. This worker edited the probe but did not run it; no native runtime or real-phone acceptance is claimed here.

Cleanup is attempted on every started native operation. `cleanupFailed` is an optional web outcome field: a capture that saved stays `completed` if native temporary-file deletion fails. The UI explicitly says that the capture was saved and cleanup failed. Unsuccessful capture outcomes retain their status and show the separate cleanup limitation. Reset remains the retry path for native cleanup.

## Resident and helper decisions

The resident's suggested flag shows **Add to my fix list**, **Not a problem**, and **Ask <helper>**. Add navigates to the existing related checklist question with instructions to choose Yes only after checking the observation, then explicitly confirm the concern. It does not issue a command. Not a problem issues only `answer_checklist: no`; the existing domain clears any incompatible confirmation and derived plan action. Ask opens local demo-profile selection and explicitly describes handing over the device, with no message sent and existing permissions preserved. Helper names are read from existing local people, rather than invented.

A helper needs the existing checklist grant for captures/export/import/proposals. A proposal routes to the checklist; confirmation still requires the existing confirm grant. Volunteers and helpers without a checklist grant cannot mount capture routes. No answer, confirmation, request or plan action is created by viewing or importing review flags. The small resident-name repairs in `ResidentHome` and `App` read the household resident's actual local name.

## Asynchronous and storage boundaries

Each asynchronous UI action captures the dispatch revision token and a live route/actor/checklist-access predicate, and checks its mounted state. Import, delete and capture writes pass an optional predicate to storage; storage checks it inside the final synchronous mutation callback after asynchronous JPEG validation. Export checks immediately before opening a share/download action. Completed operations update/navigate only while their guard remains current. These are local demo concurrency controls, not authenticated multi-user authorization.

`writeCapture` uses the validated snapshot's room ID for replacement checks. Its new optional `expectedCaptureId` binds replacement consent to the capture seen before the tour (`null` means the room was empty). A concurrent replacement is refused inside the same transaction instead of overwriting newly saved data. Existing callers remain compatible.

A new IndexedDB capture client adopts the generation of its first successful transaction. Subsequent readonly reads do not rebase it after another client's reset. Such an old client remains unable to write retained bytes until a full reload/new store instance; a local reset invalidates its current store immediately and reconstructs the browser store after cleanup. No database version or persisted schema changed.

## Deterministic evidence from this worker

- Before fixes, focused regressions failed for missing room identity, cleanup masking a saved outcome, stale native start, and expired authorization during storage writes.
- `npm run typecheck` passed after the other worker's sketch module was present.
- `npm test -- src/app/capture-screens.test.tsx src/lib/native-capture.test.ts src/lib/capture-storage.test.ts src/app/navigation-layouts-ui.test.tsx src/app/checklist-presentation.test.tsx` passed: **76 tests in 5 files**.
- Integration follow-up: the full-suite i18n check exposed a hardcoded cancellation message in the TSX helper. It now uses the typed `capture.changed` dictionary entry; the flag-binding comparison also uses the typed English dictionary value. `npm test -- src/app/i18n.test.ts src/app/capture-screens.test.tsx` passed **13 tests in 2 files**, and the follow-up `npm run typecheck` passed after the geometry-test edits stabilized.
- `git diff --check` passed.

The targeted tests use synthetic bundle/photo fixtures, a mocked native plugin, component callbacks under React's server dispatcher, and a transactional in-memory IndexedDB harness. They verify valid/null prompt arguments at the web boundary, identity/hash rejection, cleanup outcomes, explicit decision commands, the Yes-before-confirm plan boundary, denied helper confirmation, expired guards, replacement conflicts, and independent-client reset generations. They do not establish mounted-browser layout/focus, physical AR/photo/pose behavior, native permissions, sensor accuracy, real model quality, signing or distribution readiness. Parent browser/Simulator checks must be recorded separately; real iPhone capture, permission/recovery/export and image/pose acceptance remain outstanding.

## Browser acceptance follow-up: equivalent history events

The parent reproduced a room route losing its saved capture controls after checklist confirmation followed by hash navigation. Reload restored the capture. The source cause was `routeRef.current === route`: browsers can emit `popstate` and `hashchange` for one logical route, and each parse makes a distinct route object. The room's existing mount/read effect retains the first guard because its room/store dependencies are unchanged; the second equivalent object made that guard permanently false.

Capture access now uses a semantic route epoch. Equivalent canonical route hashes keep the epoch, while genuine navigation advances it, so leaving and immediately re-entering cannot revive a retained read/save. The history handler avoids redundant route-state updates while still reading same-URL resource return context from history state. Deferred-read regressions cover both equivalent event sequences and genuine leave/re-entry cancellation. `npm test -- src/app/i18n.test.ts src/app/capture-screens.test.tsx src/app/navigation-layouts-ui.test.tsx` passed **44 tests in 3 files**; `npm run typecheck` and `git diff --check` passed. The parent owns browser re-acceptance and the final build; this worker did not drive the browser or build.
