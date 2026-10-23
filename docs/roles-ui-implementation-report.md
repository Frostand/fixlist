# FixList phone UI implementation handoff — 2026-10-18

Implementation worker: the running `gpt-6.1-sol` at xhigh. No child agents. Parent review and acceptance are pending. Work is uncommitted on `codex/fixlist-core-2026-10-17`. The existing `.claude/` owner files were preserved. No edits to `scan/`, `ios/`, `src/domain`, manifests/lockfile or Capacitor configuration; no dependency, external send, upload, PR or deployment.

## Implemented

- Typed, bounded hash routes, safe malformed-hash fallback, working `?localScan=…` launch routing and subsequent tab navigation. Phone shell with role tabs, person switching, contextual Help, Back, heading focus, safe areas, native controls, 48 px minimum button/link targets, reduced motion and visible focus. Atkinson/body type and existing color tokens are retained. At 320 px the enlarged header can scroll away; at the target iPhone width the app bar stays above scrolled content.
- English/Spanish typed dictionaries, key/interpolation parity, `useT`, stable-ID catalog translations, precise translated photo questions and their limitations, translated screening explanations and report. Spanish exports `reviewed: false` and shows the required banner. User names, skills, availability, visit text, area notes and updates retain their original writing, with attribution when shown to someone else. The context identity lives outside the Fast Refresh component module after a stale development context was observed and corrected.
- First-launch language/person selection, profile creation, remembered per-person languages/checklist positions, four-card guides, skip/back/next, resume and replay. Family-helper guides explicitly explain acting for Margaret.
- Resident home/next step, room picker, one-question walkthrough, separate confirmation, autosave state, photo input/re-encoding/IndexedDB/thumbnails/removal, optional AI review chip, effort-grouped plan, cited next steps, professional routing, local help resources and retained fictional fact screening.
- Resident sharing approval, concrete invitation review, volunteer choice with self-reported labels, request status/attribution/history, time agreement, updates, completion review/reopening, cancellation/reassignment and granular revocation with the exact notice. Sam's scopes can be granted/revoked; helper controls follow grants. A confirm-only helper can review eligible concerns from Plan without receiving checklist answers.
- Volunteer home/tasks accept only `VolunteerRequestView` plus public names and an individually resolved shared pin image. No household object reaches the volunteer screen module. Accept/decline, proposal, 280-character updates, reporting done and withdrawal are connected to actor/revision-carrying commands. Profile/availability, language, guide and boundaries are implemented.
- Translated printable report includes checklist answers/attribution, confirmed work/source/cost/effort context, all current photos as images, scan notes, full fictional screening, requests/coordination/completion attribution, shared/unshared fields and original updates. In browsers it waits for local photos to load/decode before invoking printing. The native iOS demo explicitly explains that printing is unavailable and disables that button after the Simulator test showed no print sheet. Print output remains distinct from independently verified work.
- Shared UI dispatcher uses the active person, never a resident fallback. Photo metadata requires durable saving. Failed adds remove the new blob; failed removals restore the original blob while its metadata still exists. A tested reset race does not resurrect a removed photo after metadata was reset.

## Deterministic evidence

Node 24.18.0 / npm 11.16.0. `npm ci` completed with the existing lockfile (npm reported three moderate audit findings; dependencies were not changed).

- `npm run typecheck`: passed.
- `npm test`: **953 passed in 25 files**, up from 913. New coverage: malformed/valid routes and scan launches; dictionary/catalog/interpolation parity and an AST scan of all application TSX for obvious hardcoded sentences; language/guide persistence; next-step mapping; role controls and domain denials; projection output privacy; translated report/original user writing; revocation notice; eight photo success/failure/reset cases; and the full milestone through the dispatcher shared by actual UI handlers. The browser journey separately exercised the real controls.
- `npm run build`: passed. Initial JS **511.86 kB raw / 150.27 kB gzip**, below 250 KiB gzip. CSS **42.04 kB / 9.57 kB gzip**. Generated sample chunk **0.69 kB gzip**; existing lazy ScanViewer **1,036.47 kB gzip**. Vite still warns about the large lazy viewer. No latency/performance improvement claim.
- `git diff --check`: passed. Protected paths have no diff. No commit.

## Browser evidence

Task dev server ran at 127.0.0.1:5173. Full English milestone was completed at **402×874** and **320×700**: answer yes → explicit confirmation → draft/share/review/invite Alex → switch → accept/propose → switch → agree → switch → update/report done → switch → resident confirms done. The saved status was `resident_confirmed_done` on both runs. Document width stayed exactly 402/320 respectively.

The 320 px run selected a generated synthetic 3200×1800 PNG through the real file-input change handler. The saved JPEG metadata was **1600×900**; its image rendered in the plan, invitation/volunteer view and report. Revoking photos immediately removed the volunteer image and showed the required notice. Removing the original photo then removed its metadata/thumbnail with no alert. No real household image was used.

Also exercised: resident guide; new Spanish helper profile; Spanish checklist/guide/report and unreviewed banner; guide reload at **2 de 4**; language switching; helper grant/revoke and resulting disabled tabs; scan-launch query opening Room scan then normal Home navigation; contextual help/focus; persistence/reload/reset; keyboard Tab, radio arrows and Enter confirmation with visible outline and heading focus. At 200% text size the body measured **40 px** and the 320 px question/report stayed within 320 px, after fixing label minimum widths and rule indentation. This is text-scaling evidence, not a physical Dynamic Type or VoiceOver certification. Final browser console capture contained no errors.

The native browser print API was invoked after loaded report images; print CSS was separately inspected on screen. No saved PDF or native pagination has been accepted from that check.

5173 was stopped (task PID 44772). Parent's 4173 preview remained listening under original PID **22732**. A final isolated incognito tab checked the built shell; parent browser data was not modified by that check. Task browser tabs were closed.

## Domain/spec decisions and limits

- Maple House has one fixed resident. Creating another resident is explicitly disabled with the domain's explanation; helper/volunteer profiles can be created. No second household or resident takeover was invented.
- Existing `elderNextStep` is deliberately checklist-first. With unanswered questions it continues the check before highlighting request coordination; Home's Help requests card remains the route to review proposals/reports. No selector priority was changed.
- New scan pins use `pin-` IDs. Some older raw UUID pins start with a digit, which the existing sharing command's `validId` rejects. Their images are excluded from sharing with a specific message to place a new pin. No legacy pin, scan file or domain rule is rewritten. This legacy-ID incompatibility remains for the parent to decide.
- Cancelled/confirmed requests remain terminal and one retained request per action is preserved. Reassignment uses the domain's draft/declined/withdrawal/cancel-invitation paths. Invitation expiry was not invented.
- Household screening profile selection/report are resident-only. Ungranted helpers can still read generic help/resources, using independent unknown fictional facts rather than exposing the resident's chosen profile. Volunteer help has no inaccessible resident-resource link.
- Spanish is machine-translated and requires native-speaker review. Physical device, VoiceOver and actual iOS Dynamic Type behavior are not qualified by these checks. Native camera/photo-picker capture remains unqualified. Native printing is a concrete blocked feature: calling `window.print()` on the existing Capacitor shell showed no print sheet. Adding an iOS printing/export bridge requires parent-authorized native/dependency work; both were protected in this task. Browser PDF pagination also remains unaccepted. Optional full scan rendering/sharing was not physically qualified in this UI task.

## Files changed

Existing: `docs/architecture.md`; `src/main.tsx`; `src/app/App.tsx`, `CatalogViews.tsx`, `FloorPlan.tsx`, `PrintReport.tsx`, `ScanPanel.tsx`, `ScanSuggestions.tsx`, `ScanViewer.tsx`, `WorkflowSections.tsx`, `display.tsx`. Retained legacy views also use dictionaries so the hardcoded-copy scan covers all application TSX, while their original English rendering tests remain valid.

New: `src/app/PeopleScreens.tsx`, `PhoneShell.tsx`, `Photos.tsx`, `RequestScreens.tsx`, `ResidentScreens.tsx`, `SettingsScreens.tsx`, `VolunteerScreens.tsx`, `routes.ts`, `ui-controller.ts`, `view-model.ts`; `routes.test.ts`, `i18n.test.ts`, `roles-ui.test.tsx`, `photo-handlers.test.ts`; `src/i18n/en.ts`, `es.ts`, `index.tsx`, `context.ts`, `catalog.ts`, `authored.ts`; `src/styles/phone.css`; `docs/superpowers/plans/2026-10-18-roles-ui.md`; this report.

AI assistance: this worker authored the UI, translation drafts, view/controller helpers, tests and handoff, and executed the listed deterministic/browser/Simulator checks. These actions do not establish student authorship or understanding, real-user usefulness, real repairs, program approvals or CAC submission readiness.

## Saved browser evidence

- English resident Home, 402 px: `/Users/al1234/.t3-nightly-v2/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mvdvcgud-7cce7200.png`
- Spanish checklist, 320 px: `/Users/al1234/.t3-nightly-v2/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mvdv2szu-1d554ad9.png`
- English completion/update/sharing screen, 402 px: `/Users/al1234/.t3-nightly-v2/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mvduzi94-2041bc4f.png`
- On-screen print-style inspection: `/Users/al1234/.t3-nightly-v2/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mvdv6oaa-349848ec.png`

## iOS Simulator evidence

A temporary copy at `/tmp/fixlist-roles-ios-20261018` received the Vite build and was built with Xcode for iOS Simulator. Repository `ios/` was not written or synced. `xcodebuild` reported **BUILD SUCCEEDED**. A separate iPhone 17 Pro / iOS 26.5 Simulator named **FixList UI iPhone 17 Pro**, UDID `6B16BC57-E314-4AD3-93CA-6F2ADD455432`, was used because the original device was owned by another agent-device session. The initial install had succeeded on the original simulator before its open command reported `DEVICE_IN_USE`; subsequent driving used only the separate device. No simulator data reset was performed.

The bundled app ran without 5173. Actual native controls exercised English/person selection, resident guide/checklist yes, explicit confirmation, plan, sharing/review/invite Alex, switching, volunteer acceptance/time proposal, resident agreement, volunteer text entry/update/report done, and resident completion review. The final Home accessibility snapshot explicitly contained **“Help requests 1 Resident confirmed done”**. Keyboard entry read back **“The rug was moved with permission.”** and the resident saw its attribution. This verifies the local software lifecycle in WKWebView, not a real visit or repair.

Native inspection caught scrolling content entering the status area; the 402 px shell now keeps its app bar above scrolled content. At the 320 px fallback width it can scroll away so enlarged text does not leave only a narrow reading strip. Simulator automation needed slow directional scrolling to expose controls: AX sometimes returned controls clipped by the fixed bars, and an attempted tap under the app bar did not confirm completion. The confirmation was then visibly inspected and successfully tapped at its actual location; the final status above was read back afterward.

Native printing was tested by tapping the original print action. The report remained visible and **no native print sheet opened**. The final UI disables that native-only unavailable action and gives a translated explanation. No native PDF, pagination or printer output is claimed. Browser printing remains available. A native bridge/export path needs the parent's separate authorization because native files and dependencies were protected here.

Saved Simulator images: `/tmp/fixlist-ui-ios-guide.png`, `/tmp/fixlist-ui-ios-update.png`, `/tmp/fixlist-ui-ios-completion-review.png`, `/tmp/fixlist-ui-ios-complete.png`, `/tmp/fixlist-ui-ios-print.png`. These contain synthetic demo content only.

The final installed build was opened again after the print guard was added. Its native snapshot showed **Print current report [disabled]** and **“Printing is not available in this iOS demo yet. You can read the report below.”** Saved image: `/tmp/fixlist-ui-ios-print-unavailable.png`. The device was returned to Home with the completed request retained. The final initial JS size includes the existing Capacitor platform API import used for this guard; no manifest change was made.
