# Room capture web implementation

Implementation worker: Codex, gpt-6.1-sol with xhigh reasoning. Andrew supplied the scope, capture contract, file boundaries and required validation. This is AI-assisted implementation, not evidence of student authorship or understanding. Parent review and integration remain required. No additional agents or models were invoked by this worker.

## Delivered

- Exact manifest/native-result validation, camera rotation/intrinsics checks, catalog IDs, SHA-256 and structural JPEG/dimension checks.
- `fixlist-captures` IndexedDB storage: one record per room containing its manifest, photo-ID-to-JPEG-Blob map and latest validated flags. Serialized operations, atomic replacement/budget enforcement, 120 MiB total budget, immediate invalidation and durable reset generations. No capture bytes or metadata enter `fixlist:demo:v1`.
- Capacitor bridge using every native string key, converted local file reads, independent hashes, native temporary-file discard and iOS share sheet/web download dispatch. Reset attempts photos, scans, captures and native `discardAll`, including after partial failure.
- 48 MiB capture-bundle exporter and validating parser; strict flags binding/catalog/derivation/calibration validation and suggested-only display filtering.
- Localized room page and guided photo tour, camera/library inputs, EXIF-stripping re-encoding, save only on Done, replacement/delete/export confirmations, flag import/photo/question/limitation/score and existing checklist link. Resident/checklist-helper access only; both routes map to Check/Rooms in every navigation layout.
- Shared parity fixtures in `scan/tests/capture-parity/`: two real 224-byte synthetic 16 × 16 JPEGs, valid ARKit rectangle/cameras, matching synthetic flags, and invalid disclosure, derivation, threshold-point, hash, unknown-key, rotation and grid-centre cases. `cases.json` identifies the file kind and expected outcome; TypeScript executes every case. No real photo or real model inference is represented.

## Interfaces for integration

- `validateCaptureManifest(value, catalog?)` and `validateNativeCaptureResult(value)` return `{ok,value}` or `{ok:false,error,code}`.
- `getCaptureStore()` supplies `read(roomId)`, `writeCapture(manifest, photos, replaceConfirmed?)`, `writeFlags(roomId, flags)`, `remove(roomId, captureId)`, `clear()` and `invalidate()`; `photos` is a `ReadonlyMap<string, Blob>`.
- `buildCaptureBundle(manifest, photos)` returns `{fileName,text}`; `parseCaptureBundle(text)` returns a checked manifest and photo map.
- `validateCaptureSuggestions(value, manifest, catalog?)`, `parseCaptureSuggestions(text, manifest)` and `displayFlags(file)` handle review results. Binding mismatch uses `code: 'CAPTURE_MISMATCH'` and exactly “These flags belong to a different capture.”
- `runNativeCapture({roomId,roomName,language,prompts,store?,replaceConfirmed?,isCurrent?})` saves completed captures and returns the native status; native temporary-folder discard is attempted in `finally`. A native cleanup rejection propagates and is shown by the flow.
- The existing scan calibration function was exported as `validateSuggestionCalibration` and reused verbatim. Scan validation behavior was not changed.

## Contract interpretations and shared-type follow-up

1. `NativeCaptureStartOptions.prompts[].checklistItemId` currently accepts only `string`; the required overview prompt has `null`. This worker did not edit the protected shared types. `CapturePrompt` locally uses `string | null`, with one documented assertion at the native call. **Needed shared change: make that field `string | null`.** Native integration must preserve null for overview photos.
2. v1 flags carry no raw grid-confidence, mass, margin or none-probability evidence. The app checks suggested status, location threshold, image bounds and the existing 3 × 3 grid cell centres (1e-6 pixel tolerance). Confidence/mass/margin/none gates remain the Mac producer's responsibility and cannot be independently established from this file. The extra invalid grid-centre fixture makes this interpretation reviewable by the Python worker.
3. A skipped outline may be null; an open outline is passed through but gets no Plan/3D toggle. Geometry with a null floor is rejected. Checklist photo links must exist in the catalog; the contract does not require every optional photo link to belong to the capture room.
4. Replacement confirmation occurs in the capture route, before capture begins. The previous saved capture and its flags remain until the new capture saves. Canceling the replacement retains them.
5. Flags link to the existing checklist decision flow. They never issue an answer/confirmation command or change the computed plan.

## Verification

Environment: Node 24.18.0, npm 11.16.0. `node_modules` was absent, so `npm ci` ran successfully with the existing lockfile. It reported three moderate dependency advisories; no dependency or lockfile was changed.

- `npm run typecheck`: passed.
- `npm test`: **1,468 passed in 53 files**.
- `npm run build`: passed; initial JavaScript **183.43 kB gzip**, CSS **9.79 kB gzip**. The existing lazy `ScanViewer` remains **1,036.56 kB gzip** and Vite still warns about large chunks. These are bundle sizes, not latency measurements.
- `git diff --check`: passed.
- Protected paths (`ios/`, `RoomSketch.tsx`, `room-geometry.ts`, `capture-types.ts`), package files, icon and preserved plan body have no worker changes.

Actual browser automation used the T3 collaborative Chromium preview against `npx vite --host 127.0.0.1 --port 5191` in this worktree:

1. Chose English and resident Margaret; skipped the guide; opened Check → living-room “Walk-through and photos” → Start.
2. Chose generated blue/yellow JPEGs for the overview and rug prompts; advanced and pressed Done. The room page showed two decoded photos and “Photos only.”
3. Opened export, observed the required privacy text, confirmed, and observed a completed **2,670-byte** `<captureId>.fixlist-capture.json` download. The final bundle parser accepted those actual downloaded/re-encoded bytes and dimensions.
4. Generated a matching synthetic flags file by binding the parity fixture to the saved capture's ID and ordered hashes, imported through the actual file input, saw the photo/question/limitation/experimental score/“Not a finding”, and followed Related checklist question to `#/r/question/rug-check`.
5. Reloaded the room URL and observed both photos and the flag persisted. Household photo metadata stayed empty, checklist attribution remained unanswered and all confirmations remained false.
6. Imported the unbound parity flags file and observed exactly “These flags belong to a different capture.” The previously accepted flag remained intact.
7. At 320 × 700, document width equalled viewport width (320), photos decoded and `screen-heading` received focus after route change. This is a layout/focus check, not a complete accessibility audit.
8. Chose helper Sam with no grants and opened the room URL; saw only the existing protected-route denial. Repeated as volunteer Alex; no capture photos or controls appeared.
9. Started a replacement, confirmed, selected a draft photo, then canceled and confirmed discard. The original capture ID, two photos and accepted flag remained.
10. Used More → Reset demo → Yes, reset FixList. Both owned localStorage keys were absent and the capture read returned null. An independent IndexedDB client retaining pre-reset state received `CANCELLED` when trying to write it back. Reselected the resident and opened the room URL; it showed no saved walk-through.

## Unverified

No iOS Simulator was used, as requested. Real ARKit capture/orientation/permissions/tracking, native `file://` paths, AirDrop/Files/share-sheet completion, actual native cleanup, real-phone memory/capacity behavior and physical accessibility remain unverified. Native bridge tests use a mocked plugin and synthetic bytes. RoomSketch/3D integration must be checked after the independent worker's implementation is combined; this worktree still contains the base photo-grid placeholder. No model accuracy, calibration validity, home-safety outcome, print output or submission readiness is claimed. No push, PR, upload or deployment occurred.
