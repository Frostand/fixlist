# FixList CAC demo — local worker evidence

Video duration: **172.00 seconds**. Final files are local only; no commit, upload or publication. Parent owns final acceptance.

## Timeline

| Scene | Actual time | Content | Source |
| --- | --- | --- | --- |
| 01 | 00:00.00–00:07.50 | A room rebuilt in 3D | s01-hook.mp4 |
| 02 | 00:07.50–00:24.00 | Meet FixList | HTML source/code/credits card |
| 03 | 00:24.00–00:36.00 | Why follow-through matters | HTML source/code/credits card |
| 04 | 00:36.00–00:58.00 | A Yes is only the first step. | s04-check.mp4 |
| 05 | 00:58.00–01:37.00 | Margaret stays in control. | s05-help.mp4 |
| 06 | 01:37.00–02:01.50 | A photo question. A person decides. | s06-scan.mp4 |
| 07 | 02:01.50–02:12.00 | Take the next step together. | s07-report.mp4 |
| 08 | 02:12.00–02:35.00 | The rules live in the core. | HTML source/code/credits card |
| 09 | 02:35.00–02:52.00 | Fix what matters at home, together. | HTML source/code/credits card |

All app pixels come from the parent's current-build iPhone 17 Pro / iOS 26.5 Simulator recordings. Footage was normalized to 30 fps before any trim. Idle navigation was cut, genuine frames were slowed/held where needed, and event-sidecar taps were mapped through each cut. The enlarged model photo is a labelled post-production crop of a recorded app frame. HTML cards and captions use existing project fonts/logo. No synthetic test footage enters these exports.

## Clip provenance and edits

- Scene 01, `s01-hook.mp4` (SHA-256 `b0630ef44f9a71bd698d450f7e272b813d67787846257c2d0b08e6c854445b8b`): 0.30–8.00 s → 0.00–7.50 s in scene (1.03×).
- Scene 04, `s04-check.mp4` (SHA-256 `e65636f4b81fdb391fccaf80cb69f635389da67cc7d7f423dd927851eedeedfe`): 0.50–7.82 s → 0.00–5.20 s in scene (1.41×); 35.45–39.25 s → 5.20–8.20 s in scene (1.27×); 39.25–45.12 s → 8.20–22.00 s in scene (0.43×).
- Scene 05, `s05-help.mp4` (SHA-256 `02371307a593637661dc4f149dcc1b8dbd7bb5f8fd3f2d69023fc4966d04bd45`): 2.50–7.40 s → 0.00–3.50 s in scene (1.40×); 11.10–15.80 s → 3.50–6.80 s in scene (1.42×); 20.05–21.60 s → 6.80–8.00 s in scene (1.29×); 101.10–104.80 s → 8.00–9.80 s in scene (2.06×); 106.85–111.50 s → 9.80–13.80 s in scene (1.16×); 119.80–122.00 s → 13.80–16.50 s in scene (0.81×); 203.60–207.80 s → 16.50–18.40 s in scene (2.21×); 291.40–293.65 s → 18.40–19.60 s in scene (1.88×); 313.00–313.90 s → 19.60–21.10 s in scene (0.60×); 340.10–341.50 s → 21.10–22.80 s in scene (0.82×); 349.65–351.10 s → 22.80–24.70 s in scene (0.76×); 449.30–451.00 s → 24.70–27.00 s in scene (0.74×); 454.60–456.30 s → 27.00–30.20 s in scene (0.53×); 459.40–463.50 s → 30.20–39.00 s in scene (0.47×).
- Scene 06, `s06-scan.mp4` (SHA-256 `99199a175a885b393f0b5944a58d34b4c92dc0753c0b1e8e466e2be5a480ffad`): 0.80–7.80 s → 0.00–7.00 s in scene (1.00×); 15.50–21.70 s → 7.00–12.00 s in scene (1.24×); 21.70–28.00 s → 12.00–24.50 s in scene (0.50×). Model photo zoom: original clip 22s, logical crop 320, 360, 65, 110, appears 12.2s into scene.
- Scene 07, `s07-report.mp4` (SHA-256 `c05467db45e9add1083ae0d0df279196e4a0367622a6c37a4a9c4533d0de7bd1`): 11.90–12.85 s → 0.00–1.60 s in scene (0.59×); 13.30–13.48 s → 1.60–5.80 s in scene (0.04×); 40.05–40.80 s → 5.80–6.90 s in scene (0.68×); 119.35–123.30 s → 6.90–10.50 s in scene (1.10×).

Exact caption/voice timings, per-event tap mapping and cut ledger: `recordings/cac-video/work/timings.json`. Raw sidecars retain Unix event timestamps and 402×874 iPhone-point coordinates. Narration uses supplied Kokoro-82M af_heart WAVs unchanged; no music. Captions match supplied narration text. Cue boundaries are word-proportional timing estimates, not a forced transcript alignment.

## Executed checks

- Both MP4s: H.264, 1920×1080, 30/1 fps, yuv420p; AAC, 48 kHz, stereo; faststart; duration 172.00s. Both fully decoded with no ffmpeg errors.
- Final audio: **-16.01 LUFS integrated / -1.94 dBTP**. Two-pass loudnorm, with a −2 dBTP encoding margin. EBU R128 measurement retained at `work/ebur128.log`.
- Banned-word scan: captions, narration, source-backed card copy and SRT passed. Required introduction content is on screen at 00:07.50, through 0:24. Credits remain on screen for 17s.
- Worker ran `npx vitest run` with installed Node v24.18.0: **56 files passed; 1 suite blocked by listen EPERM 127.0.0.1; 1,383 tests passed / 156 skipped**. `~/.nvm/nvm.sh` is absent in this environment. Terminal card uses the brief's explicitly authorized **parent-verified 58 files / 1,547 tests passed**; it is labelled parent-run. Worker log copied to `work/vitest-worker.log`. These tests concern app logic, not real-world outcomes.
- The worker did not edit `src/` or `ios/`, rebuild the installed app, install dependencies, drive the Simulator, or delegate. Existing owner changes were preserved.
- Machine-readable codec/hash/check evidence: `work/verification.json`.

## Visual review and unresolved items

Status: **pending**

- Worker must view the current video contact sheet and scene stills; no matching output-hash-bound visual review exists.

The private export does not establish submission approval, student contribution, physical-device behavior, real repairs, model quality or real household outcomes. Andrew's authorship/contribution statement and final submission remain parent/owner gates.

## Rebuild

`node scripts/promo/cac/build.mjs`

Requires existing Node, ffmpeg/ffprobe, headless Chromium and project font dependencies; no server or install. Worker Chromium was blocked by Mach-service sandbox restrictions, so HTML rendering must run in the parent's existing authorized environment. See `scripts/promo/cac/README.md`.

## Visually checked event retiming

Simulator idle time can diverge from wall time. The automatic retimer analyzes a normalized 30 fps copy for scene changes, proposes ordered times, and uses wall-clock deltas under five seconds only as weak hints. Repeated idle animation and scrolls are candidates, never evidence of a tap. Source and original-sidecar SHA-256 hashes bind each manual visual approval. Every accepted event has before/after frames viewed by the worker. Uncertain typing events have null videoTime and no marker.

| Scene | Reviewed events | Markers retained in cut | Explicitly dropped |
| --- | --- | --- | --- |
| 01 | 0 | 0 | None |
| 04 | 4 | 4 | None |
| 05 | 20 | 16 | type: Saturday 10 am: Typing spans focus, text fill and keyboard dismissal; omit tap indicator rather than infer a tap.; type: Taped the rug edge down with a non-slip pad.: Typing spans focus, text fill and keyboard dismissal; omit tap indicator rather than infer a tap. |
| 06 | 2 | 1 | None |
| 07 | 6 | 3 | None |

Detailed reviewed placements and notes: `scripts/promo/cac/retiming-review.json`; current sidecars: `raw/*.events.retimed.json`; before/after review sheets: `work/retime/<clip>/review-*.png`. The concatenated s05-help is the sole help scene input; s05a/b/c remain unused reference originals. The scene-6 right-doorway crop and enlarged question/uncertainty text are copied from the same inspected recorded dialog frame. Existing parent-rendered cards were preserved; no card HTML changed in this follow-up.

Pipeline tests: `node --test scripts/promo/cac/edit.node-check.mjs scripts/promo/cac/retime.node-check.mjs` — 10 passed. Existing app tests retain the separately reported worker sandbox limitation above.
