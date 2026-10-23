# FixList demo-ready plan (Opus orchestrator, 2026-10-22 ~9 pm EDT)

Deadline: 12:00 pm EDT Mon Oct 26. Target: everything submission-ready by Sun Oct 25 evening.

## Inputs
- Simulator audit: recordings/demo-audit-2026-10-22/AUDIT.md (no broken flows; ~35 polish defects).
- Fable direction: recordings/direction-2026-10-22/FABLE-DIRECTION.md.
- Official 2026 rules (verified from PDF): video 1–3 min, public YouTube/Vimeo; name(s), app name, one-sentence purpose, audience, tools/languages, functionality. Judging: idea (creativity/originality), implementation (UX/design), coding excellence. Six written questions. AI use must be fully disclosed in submission materials.

## Decisions (with evidence)
1. Framing: family tool for after a parent's fall / hospital discharge (Fable). Do not invent a personal story for Andrew; use "a lot of families" unless he supplies one.
2. **Drop the Apple Vision room-recognition plugin.** Tested 2026-10-22: `VNClassifyImageRequest` inside the iOS 26.5 Simulator returns identical garbage ("outdoor/night_sky 0.49") for every image with CPU compute, and revision 1 fails with "Could not create inference context". It works on macOS, so it would only work on a physical iPhone, which we cannot record without Andrew. A feature we cannot show or verify is not worth shipping now.
3. The AI story uses the real local model (StartLux 9B, MLX on the Mac). The bundled viennese-v2 suggestion (bathroom support, 0.99, frame 000225) is plausible: the frame shows a bathtub through an open bathroom door with no grab bar beside it. The defect is presentation (tiny thumbnail, "Show in 3D" lands on a door edge), not the model.
4. Seeded sample walk-through: build a capture bundle from licensed Viennese frames + their real COLMAP poses + an approximate outline, run the real model on it (parent runs it; workers cannot reach 127.0.0.1:8090), load it in-app through the existing strict import/validation path, clearly labelled "Sample walk-through built from a public video".
5. Narration: synthesized voice (Kokoro-82M via mlx-audio, isolated venv) worded in third person so it never impersonates Andrew, plus a timed script so Andrew can re-record in his own voice if he wants. Credits say the narration voice is synthesized.

## Work batches
- A (Sol, running): touch hover, file inputs, keyboard/safe area, question-screen layout, jargon/hedged copy, naming, About page.
- B3 (Sol, starting): sample walk-through generator + bundle (no UI edits until A lands).
- B (Sol, after A): scan screen redesign (viewer first, large; details collapsed; compact controls; bundled-scan label; AI card with large tappable frame and short score line; provenance in details; better Show-in-3D viewpoint), demo banner only on start/people/about/report, one-screen guide, hide dev controls, seed-loader UI.
- C (Claude child with Simulator access): record clips per storyboard v2; cards; narration; render ≤ 2:55; verify (duration, decode, required elements, privacy).
- D (parent + Sonnet): submission packet (6 answers, AI disclosure, tools list, checklist, upload steps), final regression (typecheck/test/build/ios build + Simulator pass), commit as Andrew (no AI trailers on this branch per his instruction), push branch.

## Storyboard v2 (adjusted from Fable)
1. 0:00–0:08 hook: 3D splat room orbiting in the app.
2. 0:08–0:20 title: FixList · by Andrew Lieu · purpose sentence · audience.
3. 0:20–0:30 why: after a fall, families get a paper checklist; nobody tracks who fixes what; the person whose home it is gets left out.
4. 0:30–0:50 check → Yes → plan empty → confirm → plan with CDC-based next step.
5. 0:50–1:15 room walk-through: sample walk-through photos + 2D plan/3D sketch; "areas to review" from the local model; Margaret taps "Not a problem" on one / adds the other.
6. 1:15–1:30 the 3D scan + the model's photo (tub through doorway) + Show in 3D; tools caption.
7. 1:30–2:10 help request: share choices → invite Alex → Alex accepts/proposes/updates/reports done → Margaret confirms.
8. 2:10–2:22 report + iOS print sheet; Spanish toggle.
9. 2:22–2:40 how it's built (languages/tools; tests; no server).
10. 2:40–2:52 closing: name, demo disclosure, credits.

## Revision after Astra challenge (2026-10-22 ~9:40 pm)
- **B3 cut.** Capture contract allows geometry only in `arkit` mode; COLMAP-derived poses would masquerade as ARKit capture. Worker cancelled before writing files.
- **Batch B reduced:** scan screen (viewer first, large; clear sample label "architectural visualization render, not a real home"; details collapsed; compact controls; readable model photo + question + short score line; provenance in details; Show in 3D uses the frame's own viewpoint or is dropped), demo banner limited to start/people/about/report, rename dev scan button, hide dev controls. No onboarding/sketch decoration.
- **Storyboard (Astra 2:50):** 0:00–0:20 scan hook + name/app/purpose/audience + tools caption; 0:20–0:45 answer → pending → confirm → plan; 0:45–1:30 share → Alex restricted view → reported done → resident confirms; 1:30–1:52 scan + enlarged model photo/question, Mac-local processing + explicit export; 1:52–2:05 report/print (+Spanish if readable); 2:05–2:30 one concrete permission/hash guard + its test (code on screen); 2:30–2:50 limits, AI disclosure, credits. 350–375 narration words.
- Wording: "Mac-local AI model", never "on-device AI".
- Video license: CC BY-SA 4.0 stated in description and end card (ShareAlike from the Viennese adaptation).
- Student contribution statement remains Andrew's to write; flagged, not blocking.
