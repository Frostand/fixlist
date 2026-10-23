
## Batch A worker handoff — 2026-10-22

Implementation evidence only; the local parent owns acceptance and iOS Simulator verification. No commits, branch changes, tool/dependency installs, native configuration changes, uploads, or external sends.

| Audit item | Status | Change / remaining work |
| --- | --- | --- |
| D1 | Done | All nine CSS hover rules require `(hover: hover) and (pointer: fine)`, including room sketch. Person chip and header buttons have explicit readable hover colours. Selected-marker styling remains available on touch. |
| D2 | Done | Photo tour reuses the styled camera/library buttons from Photos; hidden inputs retain file reset and busy guards. AI-results import uses a styled trigger and hidden input. |
| D6 | Partial | The viewport-height shell keeps scrolling inside `.phone-main`, leaving the header outside task/keyboard scrolling with safe-area top padding. Route changes reset the inner scroll. Native keyboard result is unverified; no Capacitor config change. |
| D9 | Done | Empty Invitations/My tasks groups are hidden. Existing invitations and the no-tasks message remain. |
| D10 | Partial | Explicit Next sits immediately below the answer options; previous question is an accessible icon button. Compact spacing preserves 48px controls. Photos/storage metadata and whole-check progress are in a disclosure below navigation. No auto-advance. DOM/callback tests pass; 402×874 visual fit is unverified. |
| D11 | Done | Confirmation button says “Add to my plan”. |
| D12 | Not done | The replacing control is owned by protected `src/app/ScanPanel.tsx:235`. Parent should hide it when `document` exists or add confirmation in the scan-owning batch. |
| D13 | Done, runtime pending | Reset dialog top and maximum height account for the top safe area. Native notch clearance still needs Simulator inspection. |
| D14 | Done, runtime pending | Tab labels use normal wrapping, keep-all and no hyphenation. Content-sized grid columns allow horizontal scrolling rather than splitting words at large text sizes. Native AX Large remains unverified. |
| J5 | Done | Report observations say “Sample note … (fictional)”; source text says fictional example, not synthetic fixture. Exact source aliases preserve unchanged authored fixtures and Spanish translation. |
| J6 | Done | UI renders requirements and profile answers from validated rule structures. Currency is formatted as “$20,000 a year”. Nested statuses, failures, missing facts and thresholds remain unchanged. |
| J7 | Done | Finished-request copy uses request instead of episode. |
| J8 | Done | More hides the prototype selector by default. A launch with a `nav` parameter enables it for that app session; existing saved layout handling, selector and tests remain. |
| J9 | Done | Professional-note actions and the professional helper label use shorter wording. No contact is performed. |
| J10 | Done | Plan tags and report attribution say “Confirmed”. |
| C1 | Done | Pending plan cards share one confirmation explanation above the group. |
| C2 | Done | Verification limits appear once in the request timeline/footer in regular muted text, rather than a repeated callout. |
| C3 | Not done | Removing the adjacent scan disclaimer requires protected `src/app/ScanSuggestions.tsx:61-63`. Left for the scan-owning batch so all existing unverified-output disclosures remain. |
| C4 | Done | Plain checklist questions and room names omit the heavy sample prefix. Bathroom-support wording retains negative polarity so Yes still means a concern. The visible banner and report clearly identify the fictional household. |
| C5 | Done | Progress shows answered/total and adds a Not sure count only when nonzero; missing and explicit uncertainty stay distinct. |
| C6 | Done | Sharing lifetime copy directly explains access until completion and retained request history. |
| C7 | Done | About starts with purpose, then a React/Capacitor/AI-assistance credits line. Existing honest limitations remain. |
| C9 | Done | A photos-only view has one no-outline line and no phantom approximate-sketch warning. Drawn outlines retain their limits. |
| Naming: photo counts | Done | Singular “1 photo” and plural counts in saved walk-throughs and tour status; Spanish updated too. |
| Naming: attribution | Done | “Added by …” is consistent; agreed time separately identifies who agreed instead of implying that person wrote the proposed time. |
| Naming: Help | Done | Header/start-screen tip toggle says Tips; the Help navigation tab remains Help. |
| Naming: shared section | Done | Resident request heading says “What Alex can see” (using the actual selected name), or Shared details before assignment. |
| Naming: active tab | Done | Request/sharing/invitation navigation retains its entry context, including Plan; route tests cover the sequence. |
| Naming: final question | Done | Final primary action says “See my plan”. |

Validation:

- Node 24.18.0 / npm 11.16.0 are already active. The supplied nvm source path does not exist in this worker.
- `npm run typecheck`: pass.
- `npm test`: **blocked**, not a pass: 1,372 tests passed, 156 skipped, one suite failed during setup because `listen 127.0.0.1` is rejected with EPERM (`src/lib/local-scans-boundary.test.ts`).
- `npm test -- --exclude src/lib/local-scans-boundary.test.ts`: pass, 55 files / 1,372 tests. No package-script exclusions were added.
- There are 1,528 registered tests, up from 1,517: eleven new cases; no tests were deleted. Old-copy assertions were updated while preserving permission, confirmation, uncertainty, attribution and selector behaviour checks.
- `npm run build`: pass. Initial JS: **191.65 kB gzip**, below 250 KiB. Existing large lazy-viewer chunk warning remains; this is no latency claim.
- `git diff --check`: pass. CSS ancestor audit: all nine hover rules gated correctly. Protected-path diff check: pass.
- `npm run preview`: blocked by `listen EPERM 127.0.0.1:4173`, so the requested headless browser question/request check could not run. No browser or Simulator runtime result is claimed.
- Parent: rerun the complete tests in the authorized environment; verify question fit at 402×874, keyboard/header and tab behaviour, reset notch clearance, AX Large labels, scrolling/navigation and native print output in the iOS Simulator. The print stylesheet explicitly removes the viewport-height/scroll constraints for printing, but usable printed output is unverified here.

Changed source/test files (plus this local handoff):

- `src/app/App.tsx`
- `src/app/CaptureScreens.tsx`
- `src/app/CatalogViews.tsx`
- `src/app/FloorPlan.tsx`
- `src/app/PhoneShell.tsx`
- `src/app/RequestScreens.tsx`
- `src/app/ResidentScreens.tsx`
- `src/app/RoomSketch.tsx`
- `src/app/SettingsScreens.tsx`
- `src/app/VolunteerScreens.tsx`
- `src/app/WorkflowSections.tsx`
- `src/app/capture-screens.test.tsx`
- `src/app/catalog-views.test.tsx`
- `src/app/checklist-presentation.test.tsx`
- `src/app/checklist-presentation.ts`
- `src/app/i18n.test.ts`
- `src/app/navigation-layouts-ui.test.tsx`
- `src/app/navigation-layouts.ts`
- `src/app/navigation-ui.test.tsx`
- `src/app/polish-batch-a.test.tsx`
- `src/app/roles-ui.test.tsx`
- `src/app/room-sketch.test.tsx`
- `src/app/routes.ts`
- `src/app/scan-suggestions-ui.test.tsx`
- `src/i18n/authored.ts`
- `src/i18n/catalog.ts`
- `src/i18n/en.ts`
- `src/i18n/es.ts`
- `src/styles/base.css`
- `src/styles/phone.css`
- `src/styles/room-sketch.css`

## Batch B — 2026-10-22

This section supersedes Batch A's deferred D12/C3 status. Implementation evidence; parent acceptance and iOS Simulator review remain separate.

| Item | Status | Change / evidence limit |
| --- | --- | --- |
| 1 / D3 | Implemented; visual check pending | Room stage is first below “Room in 3D”. Canvas height is `clamp(320px, 55dvh, 560px)` at full content width; lazy-loading placeholder reserves its height. Reset/zoom form a three-button row; four orbit buttons and long keyboard/pin help remain in collapsed “Move the view with buttons”. Runtime keyboard mapping, camera movement and pin callbacks are preserved. 402×874 appearance is unverified here. |
| 1 / J1, J2 | Done | Import controls/format limits are in “Import your own scan”; a styled trigger hides the file input. Size/count/axis data, upright toggle, pin limits and viewer-close control are in “Scan details”. “Pin a concern to this room” opens compact placement tools. The sample button says “Open the sample apartment”. |
| 1 / J3 | Done | Known public-apartment bytes get the public-render/not-real-home/not-assessed label and full UE4Arch.com / Wikimedia Commons / CC BY-SA 4.0 attribution, source/license links and modification notice in details. Its verified SHA-256 matches the current scene and bound suggestions, and recognizes the sample after reload. Fresh user imports retain “supplied by you”. Unknown local/saved scans use neutral labels; no storage-schema or source-name assumption was added. Regenerated sample bytes require a newly verified source hash before receiving this attribution. |
| 1 / D12 | Done | Generated-room button is absent while a document exists; its handler also refuses to replace `current.current`, covering a retained callback. |
| 2 / J4, C3 | Done | One section notice explicitly says unverified model output, areas to review, not findings, never answers/confirms. Each item has a plain checklist heading, the exact English question actually answered, full-width tappable frame with existing alt text, short experimental-score line and existing actions. Native full-screen dialog has close/Escape handlers and focus restoration. Model/license, calibration explanation, frame counts, limitations and localization notes are in collapsed “How this was made”. Below-threshold/not-visible/older groups remain collapsed. |
| 2 / D4 | Presentation implemented; imagery/camera quality unverified | Larger frame and fullscreen view make the source photo inspectable. No camera geometry, viewpoint, orbit bounds, scan reconstruction or model output changed. Parent must judge Show in 3D and orbit quality in the Simulator; this is not a claim that the blurry camera view is fixed. |
| 3 / banner | Done | `app.demo` appears on language/person pickers, More/About and inside the printable report. It is absent from Home/Check and the guide. Spanish's machine-translation review notice remains available separately, including on Home/Check and print. English/Spanish placement tests cover the required surfaces. |
| 4 / More/settings | Done | Existing navigation-prototype picker remains gated by the Batch A `nav` flag. Reworded “Room scan” to “Room in 3D” and “Reset demo” to “Reset FixList”; kept local-demo/assistance disclosures. No other developer-only controls were found on normal resident More/settings. |

Validation:

- `npm run typecheck`: pass.
- `npm test -- --exclude src/lib/local-scans-boundary.test.ts`: **56 files, 1,383 tests passed**. Eleven new Batch B cases; total registered tests rise from 1,528 to 1,539. Updated old-heading/disclaimer assertions retain exact-question, score/calibration, uncertainty, visibility, action-label and no-workflow-mutation checks.
- `npx --no-install vitest run src/lib/local-scans-boundary.test.ts`: blocked during setup by `listen EPERM 127.0.0.1`; its 156 cases could not run. No permanent test exclusion or package-script change.
- `npm run build`: pass. Initial JS **193.80 kB gzip**, below 250 KiB. Existing large lazy-viewer chunk warning remains; no latency/quality claim.
- `git diff --check`: pass. All nine hover rules remain gated. Byte comparisons against accepted Batch A confirm `src/lib` (including scan validation/scoring), `src/domain` and `src/data` are unchanged. Dependency/lockfile/native configuration/protected-asset diff check passes.
- `npm run preview` still fails with `listen EPERM 127.0.0.1:4173`; no browser viewport check or Simulator check was possible. Parent must verify 402×874 framing, native dialog opening/closing/focus, camera/keyboard/pin controls, restoration attribution and print output.
- No commits, branch changes, installs, native sync/build, publishing, uploads or external sends.

Files changed in Batch B relative to accepted Batch A (plus this append-only handoff):

- `src/app/App.tsx`
- `src/app/PeopleScreens.tsx`
- `src/app/PhoneShell.tsx`
- `src/app/PrintReport.tsx`
- `src/app/ScanPanel.tsx`
- `src/app/ScanSuggestions.tsx`
- `src/app/ScanViewer.tsx`
- `src/app/polish-batch-b.test.tsx`
- `src/app/scan-suggestions-ui.test.tsx`
- `src/i18n/en.ts`
- `src/i18n/es.ts`
- `src/styles/base.css`
- `src/styles/phone.css`
