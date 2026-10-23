# CAC demo video pipeline

From the repository root:

```sh
node scripts/promo/cac/build.mjs
```

Builds the six requested local deliverables, plus retained per-scene stills, cut/voice/caption ledgers, codec/hash evidence and REVIEW.md under ignored recordings/. No upload or app rebuild. Requires the existing Node 24, ffmpeg/ffprobe with libx264, installed project fonts/logo, headless Chromium (same executable as the old promo), and scan/venv-python with its existing Pillow. No dependencies are installed. `PROMO_CHROMIUM` may select an already installed Chromium executable.

Input clips/sidecars are `recordings/cac-video/raw/s01-hook`, `s04-check`, `s05-help`, `s06-scan`, `s07-report` (`.mp4` and `.events.json`). Sidecars have recordStart Unix seconds and events with t/label/x/y in 402×874 iPhone points. Parent records real clips and writes READY. Existing WAVs and lines.tsv in cac-video/vo are binding. The build refuses missing real inputs; stand-ins cannot reach final output paths.

```sh
node scripts/promo/cac/build.mjs --standins
```

Exercises the complete 172-second encode/caption/audio flow using clearly isolated synthetic testsrc media and test image cards in cac-video/standins/. It does not claim a real app render or replace the final files.

HTML card preparation can run without Chromium:

```sh
node scripts/promo/cac/render-cards.mjs --prepare
node scripts/promo/cac/render-cards.mjs
```

The first command writes assets/render-jobs.json and the actual HTML; the second screenshots those jobs with installed headless Chromium and retains content hashes for rebuild caching. In the bounded worker sandbox Chromium fails macOS Mach-service registration, so the parent must run that step in its existing authorized environment. No sandbox workaround is provided. After those PNGs exist, the worker can encode with ffmpeg.

The scripts retain the old promo unchanged. `scenes.mjs` binds source excerpts and exact narration to the scene schedule. `edit.mjs` trims around parent event timings, removes long idle waits, maps real tap indicators, and fits footage to each scene. `edits.json` may override scene windows and scene 6's zoom. Windows contain source from/to seconds and target duration; durations must sum to the scene duration. Zoom is `{sourceTime, crop:[x,y,w,h], at}` with crop in logical iPhone points; it uses a genuine recorded frame and must be adjusted after visual inspection. Only framing, cut timing and device/tap overlays change app pixels.

No-voice has identical burned captions/video and a silent AAC track for Andrew's optional narration. The main narration receives two-pass loudnorm with a −2 dBTP margin. Captions are text-identical to lines.tsv; cue times are word-proportional estimates. They are 44 px, two lines at most, to the left of the 974 px phone, and below the body of the full-screen cards.

Verification can be rerun without rebuilding:

```sh
node scripts/promo/cac/artifacts.mjs
node scripts/promo/cac/verify.mjs
```

Inspect `work/scene-stills/*.png` and the contact sheet yourself. Record actual visual findings in cac-video/visual-review.json (`status`, `notes`), then rerun verify to include them in REVIEW. Machine checks do not prove on-screen legibility or privacy. Terminal test count is explicitly parent-run because the worker's local-scans suite cannot listen on 127.0.0.1; actual partial results/log are retained. No app or iOS source changes are needed.

## Retiming Simulator events

Simulator event wall time can diverge from recorded video time. The final build automatically calls `retime.mjs` before editing. It creates a normalized 30 fps, 402×874 analysis copy and scene-score metadata, clusters visible changes, and makes ordered proposals. Short wall deltas below 5 s are weak hints; long pauses have no assumed conversion. Scrolls and repeated idle animation can produce false candidates.

```sh
node scripts/promo/cac/retime.mjs s04-check s05-help s06-scan s07-report --inspect
node --test scripts/promo/cac/edit.node-check.mjs scripts/promo/cac/retime.node-check.mjs
```

Before/after review sheets are in `recordings/cac-video/work/retime/<clip>/review-*.png`. A source/sidecar-hash-bound entry in `retiming-review.json` must contain a reviewed videoTime, a note, and its before/after evidence. Unreviewed proposals get `videoTime: null` and no tap indicator. Typed-fill events and any mismatching tap coordinate are explicitly omitted rather than guessed. Results are written to raw/<clip>.events.retimed.json. Edit code prefers these files; null placements never fall back to wall time.

`edits.json` windows also bind their source SHA-256. A retake invalidates both event approval and old cut windows. Reinspect the new source and update both hashes/times; do not copy an old approval to a new take. `normalize.mjs` may prepare completed footage independently of final export; verified existing 30 fps CFR (including s05-help) is copied losslessly, and VFR inputs are normalized before trim. The final export still waits for raw/READY.
