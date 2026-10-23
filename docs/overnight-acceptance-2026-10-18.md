# Overnight prototype acceptance — October 18, 2026

Mission: finish the already-approved local rough prototype, without new product scope, publication, purchases, external messages, or physical-device operation. This is a technical acceptance record, not a claim of model validity, home safety, funding, helper vetting, or physical qualification.

## Recovered baseline and workers

- Main checkout: `/Users/al1234/.t3-custom/projects/fixlist`, branch `codex/fixlist-core-2026-10-17`, starting HEAD `effdb6853e8fe9ab486fb24cafa5982bd4627cde`. Owner's untracked `.claude/` retained.
- Native worker: `d6181b32fbe792aa6cb2fc2fa7c8e99517e6f5b2`, branch `t3/ios-native-room-capture`, worktree `/Users/al1234/.t3-nightly-v2/worktrees/fixlist/t3-2d29bb48`.
- Web worker: `50a7b2834682c73056000c2ab9e2509f021fc8ee`, branch `t3/19c0b7d5`, worktree `/Users/al1234/.t3-nightly-v2/worktrees/fixlist/t3-19c0b7d5`.
- The prior parent announced three workers, but its durable timeline and worktree inventory contain only those two launches. The sketch worker never launched before the rate limit. No third output was assumed or fabricated.
- The two completed patches were applied without committing or changing branches. Original worktrees and commits remain intact. Worker-reported checks are recorded in their existing reports; integrated checks below are separate.
- Active routing: GPT-6-Astra Extra High primary (runtime verified); GPT-6.1-Sol Extra High explicitly selected for three non-overlapping implementation workers: sketch, Mac pipeline, integration defects. No model substitution.

## Finite checklist

- [x] Recover the approved capture contract, current household architecture, and actual prior worker outputs.
- [x] Apply completed native and web patches while preserving owner/protected files.
- [x] Finish approximate 2D room sketch and optional lazy 3D view, with photo-only fallback.
- [x] Complete local bundle validation and Mac flags producer with deterministic round-trip evidence.
- [x] Reconcile native/web prompt types and room identity; test realistic bridge inputs.
- [x] Finish explicit resident decisions and helper handoff without automatic confirmation or external contact.
- [x] Verify capture storage, replacement/deletion, reset invalidation, stale writes, permissions and strict flags binding.
- [x] Pass integrated typecheck, build, meaningful web tests, Python capture tests and relevant pipeline regression checks.
- [x] Exercise browser photo tour, export, flags import/refusal, decisions, persistence/reset, narrow/keyboard layout and core request lifecycle.
- [x] Build Simulator and unsigned generic iOS targets; exercise integrated app, fallback, share and print sheets.
- [x] Inspect diffs, preserve protected hashes, and record exact evidence and unresolved device gates.

Explicitly excluded: accounts/backend/sync, new resource catalogs, real model-accuracy/calibration studies, photoreal reconstruction expansion, final contest recording/submission or deployment. Existing release gates remain in force.

## Evidence location

Local artifacts and logs: `recordings/overnight-2026-10-18/` (ignored). Protected baseline hashes and starting HEAD are recorded there. The commands/results and unresolved physical-device gates are recorded below.

## Physical-device gates

A real iPhone capture, camera permission/recovery behavior, AR image/pose alignment, AirDrop delivery, VoiceOver and real-device memory/performance remain separate. The available standard iPhone 17 Simulator uses iOS 26.5; it cannot run ARKit world tracking and does not establish behavior on Andrew's physical iPhone running iOS 27. No physical-device action is authorized by this mission.


## Acceptance decision

**Pass for the scoped local synthetic rough prototype.** The completed prior patches and the missing sketch/Mac/integration work are present in the main checkout, reviewed and demonstrated. This is not physical AR qualification, model validation, release approval or contest readiness. The two prior worktrees remain untouched; the main branch and HEAD are unchanged, and all overnight changes are uncommitted. No remaining known digital defect blocks the exercised journey.

The finite scope is complete: guided photo tour and native capture interface, local capture storage, approximate plan/3D rendering, explicit export, local model flags production, strict import, resident decisions, permission-limited helper/volunteer journey, recovery/reset and print. Existing navigation alternatives remain behind their original human-comparison gate; this mission did not redesign navigation or remove fictional room labels.

## Integrated fixes reviewed

- Native overview prompts now accept explicit null checklist IDs; required room identity round-trips across the bridge. Missing/numeric/empty IDs are refused.
- Import/viewing leaves household answers and confirmations unchanged. Add routes to the existing Yes then explicit confirmation sequence. Not a problem records No and clears incompatible confirmation. Ask Sam is an explicitly local device handoff.
- Capture mutations use immutable validated snapshots, commit-time actor/scope/revision/route guards, reset generations and capture-specific replacement consent. A readonly refresh cannot revive an old client after reset.
- Equivalent popstate/hashchange events previously invalidated a room's retained read guard. A semantic route epoch fixes this while still cancelling genuine leave/re-entry work. The exact browser and native reproduction now passes.
- Geometry handles invalid/open/self-crossing outlines, limited/missing poses, out-of-range rays and doorway exits conservatively. Unplaceable flags remain photo-only. Zero-positive handrail/stair-lighting display exclusions remain intact.
- 3D is lazy and draws on demand. Selection preserves its canvas/orbit; leaving 3D disposes resources. The narrow-screen flag note now stacks below the actual question instead of squeezing into a thin flex column.
- Dynamic household resident names replace hardcoded UI name usages. Current architecture, contract room identity, Mac usage and assistance disclosures are reconciled.

## Deterministic commands and results

All commands ran in the main checkout using Node **24.18.0**, npm **11.16.0**. Relevant checks were rerun after integration fixes; final changes after those checks are documentation/evidence only.

| Command | Final result | Evidence under `recordings/overnight-2026-10-18/` |
| --- | --- | --- |
| `npm ci` | Success, exact lockfile retained; 155 packages installed. Existing audit reported 3 moderate advisories; no dependency upgrade made. | Tool execution history |
| `npm run typecheck` | Pass | `typecheck.log` |
| `npm test` | **1,517 passed / 55 files**, no skips or failures | `npm-test-final.log` |
| `npm run build` | Pass; initial JS **190.05 kB gzip**, CSS **10.39 kB gzip** | `build.log` |
| `scan/venv-python -m unittest discover -s scan/tests` | **156 passed**, no skips; includes 27 capture tests and all 9 shared parity cases | `python-tests-final.log` |
| `npx cap sync ios` | Pass | `cap-sync.log` |
| Simulator `xcodebuild` below | **BUILD SUCCEEDED** | `xcode-simulator.log` |
| Generic iOS unsigned `xcodebuild` below | **BUILD SUCCEEDED** | `xcode-unsigned-device.log` |
| `git diff --check` | Pass | Tool execution history |
| Protected SHA-256 comparison | Icon, full plan, package manifest and lockfile identical to start | `protected-sha256.txt`, `protected-final-sha256.txt` |

The initial JavaScript remains below the **250 KiB gzip** budget. The lazy room-view/OrbitControls chunks and existing much larger lazy scan viewer still produce Vite's large-chunk warning. No latency, GPU-memory or physical-device performance claim is made.

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,id=1847FDB4-C847-48BD-81FE-9AF45A500F6A' \
  -derivedDataPath /tmp/fixlist-overnight-build build

xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath /tmp/fixlist-overnight-device \
  CODE_SIGNING_ALLOWED=NO build
```

The earlier `npm-test.log` deliberately remains as failure evidence: its one hardcoded-English failure was fixed and is superseded by `npm-test-final.log`. A temporary Vite dependency-cache 404 during concurrent development was resolved by restarting the task's dev server; the production build and final native assets loaded successfully.

## Browser runtime acceptance

T3 collaborative browser used isolated synthetic state on ports 5197 (development) and 5198 (built preview). The owner's normal 5173 server was not replaced.

- [x] Yes without confirmation leaves the plan empty; explicit confirmation adds the action.
- [x] Resident request → explicit room sharing → local Alex invitation → volunteer acceptance/time proposal → resident agreement → update/reported done → resident Not done yet → second report → resident confirmation. Revoked room sharing disappears from the volunteer view. Final status was `resident_confirmed_done`.
- [x] Browser tour selected two generated 16 × 16 color JPEGs, saved/reloaded them, and produced an actual 2,670-byte download, retained as `browser-export.fixlist-capture.json`.
- [x] Actual local StartLux processing of that exported bundle completed, produced a valid file with zero suggested areas, and the app accepted it. The exact command is below. This verifies wiring only; solid color images establish no accuracy.
- [x] A different-capture flags file was refused. Separately marked synthetic UI flags displayed the expected question/score/disclosures while leaving household JSON byte-for-byte unchanged. No and Add/Yes/Confirm behavior was exercised.
- [x] Ungranted Sam and volunteer Alex could not mount capture content. Ask Sam opened local profile selection; no contact occurred.
- [x] Replacement consent cancelled without changing the saved capture. Explicit delete removed it.
- [x] The fixed confirmation → room navigation reproduced successfully, including duplicate popstate/hashchange events.
- [x] Synthetic AR-shaped fixture rendered the SVG plan and real WebGL room in the built app. Orbit/zoom and selection retained one canvas. Three plan/3D cycles produced canvas counts `[0,1,0,1,0,1]`; import-failure fallback also preserved plan/photos.
- [x] 320px English/Spanish and 390px layouts had no horizontal overflow. Flag note width at 320px was 267px inside its 285px button. Keyboard Tab reached a visibly outlined control; headings and confirmation text received focus. This is bounded keyboard/layout inspection, not accessibility certification.
- [x] A real IndexedDB client remained `CANCELLED` on write after another client reset and after a readonly refresh. Reset cleared household/navigation state plus photo/scan/capture payloads while preserving an unrelated localStorage sentinel and unrelated IndexedDB marker. See `browser-reset-evidence.json`.
- [x] Invalid synthetic JSON remained unchanged on load and displayed recovery/export/refresh/reset choices. Explicit recovery reset succeeded and retained the unrelated sentinel.

```sh
scan/venv-python scan/suggest_capture.py \
  recordings/overnight-2026-10-18/browser-export.fixlist-capture.json \
  --no-calibration --url http://127.0.0.1:8090 --think-mode never \
  --retries 0 --timeout 60 \
  --output recordings/overnight-2026-10-18/live-synthetic.fixlist-flags.json
```

The existing local server identified StartLux-Decision-v1.1-9B-AutoThink-MLX-4bit (MLX 0.32.4, mlx-vlm 0.7.8). No server was installed or started for this run. Output and log: `live-synthetic.fixlist-flags.json`, `live-model-roundtrip.log`.

## iOS Simulator runtime acceptance

Device: standard **iPhone 17**, **iOS 26.5**, UDID `1847FDB4-C847-48BD-81FE-9AF45A500F6A`. Opened in T3's Device panel. Installed final artifact: `/tmp/fixlist-overnight-build/Build/Products/Debug-iphonesimulator/App.app`, bundle `app.fixlist.demo`. Normal Vite build/sync was used without bundling a private scan.

Native controls were driven with the device tool; the pinned WKWebView inspector exercised/observed web controls and synthetic fixture input. An XCTest accessibility fallback was needed by the device driver. The evidence does not imply VoiceOver coverage.

- [x] Native startup, profile selection, checklist and capture navigation rendered. Unsupported ARKit correctly entered the photo-tour fallback.
- [x] Actual native Photo Library picker selected a synthetic color image; the app re-encoded and saved one 16 × 16 photo, which survived installation of the final app build. `native-photo-tour.json`.
- [x] Actual Capacitor bridge accepted overview-null plus checklist prompts, returned `unavailable` on the Simulator, refused all three malformed prompt variants, and allowed repeated discard. `native-bridge-probe.json`.
- [x] Native portrait-math debug self-test passed all 9 projection checks plus resize/axes/invalid input. `native-math.log`. This does not replace physical ARCamera alignment checks.
- [x] Export privacy confirmation opened the system JSON share sheet. `native-export.json`, `native-share-sheet.png`. The sheet was dismissed without a verified destination; no AirDrop or external send occurred.
- [x] Hash-bound synthetic flags were supplied to the actual native WebView file input using a test File event; import displayed the flag and kept household state unchanged. `native-flags-import.json`. This is not a completed native Files-picker transfer.
- [x] Add → Yes → separate confirmation and room return passed in the final native build. `native-confirmation-route.json`.
- [x] Complete local invitation/acceptance/proposed time/agreement/update/report/resident confirmation passed. Status was `volunteer_reported_done` before `resident_confirmed_done`. `native-core-journey.json`.
- [x] Synthetic posed geometry rendered a real WebGL room on the Simulator; zoom/selection kept the canvas, and two plan/3D cycles yielded `[0,1,0,1]`. `native-sketch.json`, `native-sketch-controls.json`, `native-synthetic-room-3d.png`. The original saved photo tour was restored afterward.
- [x] Actual native print sheet generated an **eight-page PDF**. All eight rendered pages were visually inspected, with readable text, intact disclosures and no clipping/overlap found. Some sections continue across pages. `native-print-preview.png`, `native-report.pdf`, `native-report-contact.png`, individual page PNGs and extracted text. No physical printer action occurred.

## Blocked / deliberately outside acceptance

- [ ] **Physical iPhone AR capture and recovery:** Simulator has no ARKit world tracking, and live hardware action was prohibited. Next: with Andrew present, verify camera denial/retry, portrait JPEG/pose/intrinsics alignment against physical points, floor/door taps, limited tracking, relocalization/backgrounding, cancellation and reset.
- [ ] **Actual phone↔Mac Files/AirDrop delivery:** browser download and native sheet/file processing passed; a real native destination and return through Files were not verified. Next: explicitly transfer one non-sensitive test bundle to Andrew's Mac, run the documented command, transfer/import flags, then reset both copies as desired.
- [ ] **Physical performance and accessibility:** device memory/thermal behavior, Dynamic Type/VoiceOver and target iOS 27 remain untested. No physical qualification claim.
- [ ] **AI quality, real-home safety, funding, helper vetting, effectiveness:** not established by this mission. No new calibration or accuracy study was authorized or performed.
- [ ] **Submission/release:** Andrew's own technical contribution/understanding record, human translation review, current contest-rule check, recording consent/licensing and final recording/submission remain separate gates. No commit, branch promotion, PR, deployment or upload was made.

## Supervisor handoff and reproducibility

- Main working tree: `/Users/al1234/.t3-custom/projects/fixlist`; branch `codex/fixlist-core-2026-10-17`; unchanged HEAD `effdb6853e8fe9ab486fb24cafa5982bd4627cde`. The owner `.claude/` is retained and excluded from the source patch.
- Source snapshot: `recordings/overnight-2026-10-18/integrated-source.patch`, including changed tracked files and new implementation/docs/synthetic parity fixtures. It excludes owner files, recordings, generated iOS assets and private captures. Apply only to the stated baseline after review; do not apply over the current already-modified tree.
- Source list and final status: `integration-files.txt`, `final-status.txt`; protected hashes are recorded alongside the test logs. No dependency versions or lockfile bytes changed; `src/domain` and Capacitor config remained unchanged.
- Built preview remains at `http://127.0.0.1:5198/` (task-owned process), showing synthetic sketch fixtures in the collaborative browser. Restart with `npm run preview -- --port 5198 --strictPort`. The task's dev server is stopped after acceptance; use the standard README command when developing.
- The Simulator is left on the native home screen with its saved synthetic photo tour and completed local request. Native app build paths above are ephemeral and can be rebuilt with the exact commands.
- Review this record and the source diff first. The next meaningful implementation gate is the supervised physical capture round trip, not additional product features. Any later commit/publish action still requires authorization.
