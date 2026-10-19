<img src="assets/icon.svg" width="64" height="64" alt="">

# FixList

A local iOS demo built with Capacitor 8.5.3 around the Vite/React app. On one device, resident, family-helper and volunteer demo profiles can move from checklist answers to separately confirmed concerns, an effort-grouped plan with CDC-based next steps, and help requests with granular sharing. The resource screen includes the real Eldercare Locator and two fictional programs. English and machine-translated, unreviewed Spanish are available; photos and optional room scans stay on this device.

The household and demo profiles are fictional; there are no real accounts. Imported room scans are user-provided. FixList is not a safety assessment, does not determine real eligibility or verify repairs, and its AI suggestions are unverified areas to review. See the [roles journey spec](docs/roles-journey-spec.md), [AI disclosures](docs/ai-disclosures.md), [video shot list](docs/video-shot-list.md), and [2.0 accounts plan](docs/v2-accounts-plan.md).

Use Node **24.18.0** (`.nvmrc`) and npm **11**. Build and sync the iOS demo, then open the iOS project in Xcode:

```sh
npm ci
npm run ios:demo
npx cap open ios
```

`npm run ios:demo` builds the app and bundles the local `viennese-v2` scan from `private-captures/scans/` into the ignored iOS app assets. The optional web development server is `npm run dev` at `http://127.0.0.1:5173`.

React, TypeScript, Vite, Vitest and plain CSS use exact versions in [package.json](package.json) and [package-lock.json](package-lock.json). Business logic runs locally through immutable commands and pure queries. No backend, real account, sync service or external API is required.

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
5. Create a local help request, choose what the resident shares, invite a demo volunteer, and switch profiles to record progress. The resident reviews completion; a family or volunteer report does not verify a repair or resolve the concern.
6. Reload, inspect the report and use the native print sheet. Reset removes FixList data on this device, including its local room scan, while preserving unrelated app data.
7. Optional 3D room scan: in step 1, choose **Try a generated sample room**, or import a scan you made (see below). Pick a concern, then click a surface to drop a pin. Pins turn yellow only when that concern is confirmed; placing one never confirms anything.

## 3D room scan

Record a slow walk-around video of a room, then run the local pipeline in [`scan/`](scan/README.md) on a Mac: ffmpeg picks sharp frames, pycolmap estimates camera poses, and Brush trains a Gaussian splat on the GPU. The result (`scene.splat` + `scene.json`) lands in gitignored `private-captures/scans/<name>/`; import both files in the app. Scans are saved in IndexedDB on this device and are never uploaded. Units are arbitrary, so the scan is a visual reference, not a measurement. Plain white walls: the pipeline tunes SIFT for low texture and falls back to a learned matcher (ALIKED + LightGlue); keep furniture, door frames and floor edges in view while filming. ARKit/nerfstudio `transforms.json` captures can also be imported, skipping pose estimation (not yet tested with a real iPhone capture).

**AI suggestions (optional).** With the local StartLux-Decision model served (see [scan/SUGGESTIONS.md](scan/SUGGESTIONS.md)), `scan/venv-python scan/suggest.py <name>` asks the photo-review questions from `scan/hazard-questions.json` about scan frames and writes `suggestions.json` v2. The app shows only items marked `suggested` as unverified areas to review, with the question the model actually answered. Scores are experimental and uncalibrated unless the file carries adopted calibration provenance; even then, they have not been validated in real homes. Suggestions never answer or confirm the checklist or enter the plan. See the [v2 contract](docs/suggestions-v2-contract.md) and [AI disclosures](docs/ai-disclosures.md).

**Demo shortcuts (dev/preview server only).** Scans in `private-captures/scans/` appear as "Load local demo scan" buttons, and `http://127.0.0.1:4173/?localScan=<name>#scan-heading` opens one directly for browser checks. Regular Vite builds contain no private scans; `npm run ios:demo` copies its selected scan into the gitignored iOS app assets.

Details: [scan pipeline](scan/README.md), [viewer](docs/scan-viewer-2026-10-17.md).

Demo profiles, answers, confirmations and help-request history are saved locally on this device. Photos and room scans use on-device storage and are never uploaded. Reset removes FixList data only.

[October 17 acceptance evidence](docs/validation-facts-catalog-2026-10-17.md) records its historical checks. As of October 18, 2026, the suites contain 953 app tests across 25 files and 92 Python scan tests. [Earlier core validation](docs/validation-2026-10-17.md) preserves prior browser/print/iOS evidence; it does not qualify every current feature on an iOS device. [Architecture](docs/architecture.md), [handoff](docs/handoff-2026-10-17.md), and [video shot list](docs/video-shot-list.md) give the technical and recording boundaries.

The household, demo profiles, helper identities and two sample programs are fictional; the Eldercare Locator is a real resource. The CDC checklist is separately attributed reference material; it does not validate the authored costs, review routing or fictional observations. The AI output is not hazard detection or a safety assessment. Student technical contributions, understanding, usefulness testing and final submission disclosures remain open.

The [plan integration review](docs/plan-integration-review.md) identifies the implemented increments and later gates. The [original product plan](fixlist-plan.md) is preserved as background. Automated hazard detection, real program eligibility, a volunteer marketplace and production infrastructure remain deferred.

Created in [T3 Code](https://t3.codes).


## Room walk-through prototype

Choose **Check → Walk-through and photos** for a room. A supported iPhone offers ARKit capture; the browser/Simulator uses a guided photo tour. Photos stay on the device. **Send to my computer for AI review** explicitly exports a bundle; run the local Mac command in [capture-mac-usage.md](docs/capture-mac-usage.md), then use **Add AI review results** on the same capture. Flags are unverified areas to review and never enter the plan without separate human confirmation.

The approximate 2D/3D sketch is a drawing aid, not a measurement. [Overnight acceptance](docs/overnight-acceptance-2026-10-18.md) records current commands, runtime evidence and physical-device gates. For a synthetic-only native build without bundling a private scan, use `npm run build` followed by `npx cap sync ios`, then build `ios/App/App.xcodeproj` in Xcode.
