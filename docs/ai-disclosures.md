
# FixList: AI use, tools and media record

*Prepared for the Congressional App Challenge (CAC) 2026 submission, last updated 2026-10-18. Items marked **TODO** are for Andrew to complete. Nothing here should be submitted until every TODO is resolved or deleted.*

## Summary (paste into the CAC AI disclosure)

FixList is an iOS app, built as a Capacitor wrapper around a React/TypeScript web app, that helps older adults check their home, confirm what to fix, and ask family or volunteers for help. AI was used heavily in building it, and this is a full disclosure. Claude Code with Claude Opus 5.5 helped with design specs, review, integration and some code. OpenAI Codex workers (GPT-6.1 Sol and GPT-6 Luna) wrote most of the implementation: the scan-suggestion pipeline, the roles and permissions logic, the phone screens and the English and Spanish text. They also collected and labeled evaluation photos. Claude Sonnet 5.5 helped draft documentation. A separate AI review that Andrew ran produced an October 18 feedback list (tool and model not recorded here: TODO Andrew). The Spanish text is machine-translated and has not been reviewed by a person. Inside the app, a locally run model (StartLux-Decision v1.1 9B, 4-bit MLX) scores narrow photo questions on room-scan frames. Its output is labeled as unverified "areas to review" and never answers the checklist. The first two commits (October 15, 2026) carry no AI co-author trailer; every commit from October 17 onward does. **TODO Andrew: write 2 to 4 honest sentences on what you personally designed, wrote, decided and tested (see "Student contributions"), and state whether any AI helped with the October 15 commits.** Open-source libraries, media and licenses are listed in this document.

## Development assistance

| Tool / model | Role | What it produced | How it was checked |
| --- | --- | --- | --- |
| Claude Code, Claude Opus 5.5 | Orchestration, design specs, review, integration, some code | Specs (e.g. `docs/roles-journey-spec.md`), integration, some code; co-author on every commit from 2026-10-17 | Tests, typecheck, build, Simulator runs; **TODO Andrew: describe your own review** |
| OpenAI Codex via T3 Code: GPT-6.1 Sol | Most implementation | Suggestion pipeline v2 and calibration tooling, app fixes, roles domain with enforced permissions, phone UI, English and Spanish dictionaries, tests | Automated tests and browser/Simulator runs recorded in its reports (e.g. `docs/roles-ui-implementation-report.md`); Claude Opus 5.5 re-ran typecheck/tests and reviewed key code before each commit |
| OpenAI Codex via T3 Code: GPT-6 Luna | Narrow data work | Collected license-clear evaluation photos; labeled them by viewing them | Labels are AI judgments, not expert ground truth (see below) |
| OpenAI Codex bounded implementation worker, 2026-10-18 | Navigation comparison prototype (U02 and single account entry from U03) | Pure layout definitions, three/four-tab screen composition, navigation preference storage, English/Spanish labels and regression tests | Worker ran typecheck/build and its permitted tests; Claude Opus 5.5 merged it, ran the full suite, and ran the five tasks scripted in Chromium and the iOS Simulator |
| OpenAI Codex bounded implementation worker, 2026-10-18 follow-up | U09 display distinction and prototype tab icons | Attribution-based unanswered/Not sure presentation, progress/print/resume checks, English/Spanish copy and door/person stroke icons; no domain/schema changes | Worker ran typecheck/build and its permitted tests; Claude Opus 5.5 merged it, ran the full suite, and checked the screens, printed PDF and Simulator runs |
| Separate AI review (tool/model not recorded: **TODO Andrew**) | Evidence review | The October 18 consolidated feedback list | Andrew ran it and pasted the result into the session |
| Claude Sonnet 5.5 | Documentation | Drafts of the 2.0 plan, these two documents, and the navigation session guide (setup steps corrected by Claude Opus 5.5) | **TODO Andrew: confirm you reviewed and edited the text** |

Passing tests show the code does what the tests say. They do not show that the AI-written code is what you would have written or that you can explain it.

## AI inside the app

**Model:** StartLux-Decision-v1.1-9B-AutoThink-MLX-4bit, run on the developer's Mac through the `startlux-decide` package (code Apache-2.0; model weights **CC BY-NC 4.0, non-commercial only**). Nothing is sent to a cloud service.

**What it does:** `scan/suggest.py` asks eight narrow photo questions (e.g. "is a cable visible across a path?") about frames from a room scan. It writes `suggestions.json`. The app shows items above a threshold as "AI review suggested · unverified model output", with the question the model answered, an "Experimental model score" and the frame it looked at.

**What it does not do:** It does not answer, confirm or pre-fill the checklist, and it never enters the plan. It is not hazard detection, a safety assessment or a validated tool. Scores are adjusted by a small calibration fitted on AI-labeled example photos and have not been tested in real homes. A missing suggestion does not mean an area is safe. Real-model runs on the demo scan used rendered imagery and were judged by one person; `scan/SUGGESTIONS.md` records one weak and two plausible results.

## Evaluation data and labels

- Photos came from Wikimedia Commons and Openverse (CC0, public domain mark, CC BY, CC BY-SA). Per-image provenance sits in a private manifest. The images are not redistributed and were used only for local evaluation.
- Labels were produced by GPT-6 Luna viewing the photos. They are **AI labels, not expert ground truth**.
- A per-item Platt calibration was fitted on 2026-10-18 with a pre-registered grouped holdout: 102 development photos and 23 held-out photos (182 photo/question pairs, 8 positives). Held-out Brier went from 0.0249 to 0.0129 (paired 95% CI −0.0246 to −0.0006), and AUROC from 0.995 to 0.993. The adoption rule passed and it was adopted (`scan/calibration.json`), but every item has fewer than 10 held-out positives. Details are in `scan/SUGGESTIONS.md`. Do not claim accuracy in real homes.
- The 9B model was not fine-tuned: with 24 positive pairs a fine-tune could not be checked fairly.

## Third-party libraries and tools

Versions are from `package.json` and `scan/README.md`. Licenses are given only where established.

| Item | Version | Use | License |
| --- | --- | --- | --- |
| React, React DOM | 19.3.1 | UI | MIT |
| TypeScript | 7.0.2 | Language | Apache-2.0 |
| Vite, @vitejs/plugin-react | 8.3.4, 6.1.2 | Build | MIT |
| Vitest | 5.0.5 | Tests | MIT |
| three.js | 0.186.1 | 3D viewer | MIT |
| Spark (@sparkjsdev/spark) | 2.3.1 | Gaussian-splat rendering | MIT |
| Capacitor (core, ios, cli) | 8.5.3 | iOS packaging | MIT |
| Atkinson Hyperlegible, Zilla Slab (Fontsource) | 5.3.0 | Fonts | SIL OFL |
| pycolmap / COLMAP | 4.2.1 | Camera poses | BSD-3-Clause |
| ffmpeg | 9.0.1 | Frame extraction (separate command-line tool, not part of the app) | GPL v3 build |
| Brush | 0.3.0 (prebuilt Apple Silicon) | Gaussian-splat training | Apache-2.0 |
| NumPy, Pillow | 2.5.4, 13.0.0 | Scan scripts | BSD-3-Clause; MIT-CMU |
| MLX, mlx-vlm, `startlux-decide` | 0.32.4, 0.7.8, 1.1.0 | Local model runtime | MIT, MIT, Apache-2.0 (StartLux weights: CC BY-NC 4.0) |
| torch, torchvision, kornia, LightGlue/ALIKED | per `scan/README.md` | Optional matching fallback; not used for the demo scan | TODO verify |
| @types/* packages | see `package.json` | Type definitions | MIT |

## Media and licensing record

| Item | Source and license | Status |
| --- | --- | --- |
| Demo apartment scan | "UE4Arch.com – Viennese apartment", Wikimedia Commons, CC BY-SA 4.0. A photoreal computer render, not a real home. Segment 58–158 s. | Used and shown. The scan and any frames are **adaptations**: give attribution, a license link and a modification notice. ShareAlike applies to the adapted footage and scan, not automatically to the whole app or video. A collection of works is treated separately (see [CC FAQ](https://creativecommons.org/faq/) and the [legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en)). TODO Andrew or an adult: confirm this reading. |
| Playroom test scan | Deep Blending "playroom" images in the Inria 3D Gaussian Splatting evaluation archive. License not established in the repo. | **Do not show in the public video. Internal testing only.** |
| Evaluation photos | Wikimedia Commons and Openverse, mixed licenses | Private, local only, not redistributed |
| App icon and launch screen | FixList house mark, `public/favicon.svg`, project-authored | Original |
| CDC "Check for Safety" checklist (2017) | Basis for the plain-language next steps; FixList paraphrases it in its own words and cites it | No CDC text or images copied |
| Eldercare Locator | Real resource (Administration for Community Living) | Cited with source and date in the app |

**Credits line for the video:**

> Source footage: "UE4Arch.com – Viennese apartment" by UE4Arch.com, Wikimedia Commons, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/), https://commons.wikimedia.org/wiki/File:UE4Arch.com_-_Viennese_apartment.webm. Trimmed to 58–158 s, frame-sampled and reconstructed into a 3D scan; changes were made.

Author, license and URL checked on the Commons file page on 2026-10-18 (original upload date 22 April 2015; source: UE4Arch on YouTube).

## Student contributions

*TODO Andrew: fill in honestly, in your own words. The CAC rules say AI "must not constitute the entirety of the technical development" and expect "significant individual contributions and technical understanding." Judges may ask for the app and source code, so be ready to explain the code you show. Leave a heading blank rather than overstate it.*

- **October 15 scaffold and plan** ("Initial commit", "Set up demo-focused FixList scaffold and technical plan"): TODO what you wrote, what was copied or generated, and what you decided.
- **What I designed** (user problem, roles, screens, journey, scope cuts): TODO
- **What I wrote** (name files or functions; run `git log --author` to check): TODO
- **What I decided** (e.g. human confirmation before the plan, volunteers see only shared fields, no "vetted" claims): TODO
- **What I tested** (people, devices, bugs found and fixed): TODO. No tests with real older adults are recorded in the repo.
- **What I can explain without notes:** TODO. Suggested list: how `applyCommand` enforces permissions, how a concern gets into the plan, how a request moves from draft to confirmed done, how storage migration works, how the scan pipeline runs.

## How to verify

```sh
git log --date=short --format='%h %ad %s'     # commit history
git log --grep='Co-Authored-By' --oneline      # AI co-authored commits
npm ci
npm run typecheck
npm test                                       # 953 tests in 25 files on 2026-10-18; rerun and record the current count
npm run build                                  # initial JS 150.27 kB gzip on 2026-10-18 (budget 250 KiB)
scan/venv-python -m unittest discover -s scan/tests -v   # 92 tests on 2026-10-18
npm run ios:demo                               # builds, syncs, bundles the private scan viennese-v2 (needs it in private-captures/)
```

Counts are from earlier reports. They are not proof of the current state until you rerun them. Passing tests do not show real-world usefulness, accessibility certification or that any home is safer.


## October 18 overnight capture integration assistance

GPT-6-Astra at Extra High recovered the two actual earlier worker outputs, reviewed and applied their changes, inspected integration diffs, ran deterministic checks and exercised browser/iOS Simulator flows. Three GPT-6.1-Sol Extra High workers implemented bounded sketch geometry/rendering, the local Mac bundle/flags pipeline, and capture integration/race fixes. The previously announced third sketch worker had not launched before the earlier rate limit; its output was not assumed to exist. Model selections were made through supported routing controls.

The overnight work is AI-assisted implementation, debugging, tests and technical acceptance documentation. Native AR capture remains physically unverified. A real local StartLux run on two tiny synthetic color images tested export/model/import wiring; it establishes no accuracy or household safety result. Separately injected synthetic flags and camera geometry tested UI and rendering only. See the overnight acceptance record for exact evidence. Andrew's significant technical contributions and understanding still need his own truthful account; this work does not fill those entries for him.
