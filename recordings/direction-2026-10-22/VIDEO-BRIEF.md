# FixList CAC 2026 demo video: production brief

You are producing the final Congressional App Challenge demonstration video for FixList (solo entry by Andrew Lieu). It is the most important part of the submission. Work autonomously; do not ask the user questions. Do not upload or publish anything.

## Read first
- `recordings/direction-2026-10-22/NARRATION.md`: scene table with on-screen content and narration (binding script; small wording trims allowed only to fit timing; never add claims).
- `recordings/direction-2026-10-22/PLAN.md` (decisions; "Revision after Astra challenge").
- `scripts/promo/README.md`, `scripts/promo/build-video.mjs`, `scripts/promo/render-cards.mjs`, `scripts/promo/verify-video.mjs`, `scripts/promo/capture.mjs`, `scripts/promo/storyboard.json`: an existing, working pipeline (real Simulator clips + HTML cards rendered with headless Chromium + ffmpeg). Reuse it: copy into new files (e.g. `scripts/promo/cac/…`) rather than breaking the old promo. `scripts/promo/ad/` shows a more motion-designed HTML timeline approach with the same fonts/palette; borrow its look for cards if useful.
- `recordings/2026-10-18-fixlist-launch-promo-contact.png` and `recordings/2026-10-18-fixlist-ad-45s.mp4` (frames) for the visual language. The old promo's phones were too small to read; this video must make the app readable.
- `AGENTS.md` honesty rules.

## Hard requirements (official 2026 rules)
- Length 1–3 min. Target 2:45–2:52; hard maximum 2:55.
- Must show: participant name (Andrew Lieu), app name (FixList), purpose in one sentence, target audience, tools and coding languages, functionality showcase. Name/app/purpose/audience by 0:24; tools/languages visible on screen in the title card and again in the "under the hood" scene.
- 1920×1080, 30 fps, H.264 yuv420p, AAC 48 kHz stereo, faststart. Narration loudness about −16 LUFS integrated, true peak ≤ −1.5 dBTP.

## Footage
- All app footage must be **real iOS Simulator recordings of the current build** (`xcrun simctl io <udid> recordVideo --codec=h264`; see capture.mjs). Simulator: iPhone 17 Pro, iOS 26.5, UDID 133B41A2-044F-479A-AFC6-B6E3865F056C, bundle `app.fixlist.demo`. The parent has already built and installed the current app (`npm run ios:demo` + xcodebuild into /tmp/fixlist-demo-build). Do not rebuild unless the parent tells you; do not edit app source.
- Drive the Simulator with the wrapper `/tmp/ad.sh` (agent-device CLI: `snapshot -i`, `click @eN`, `fill`, `scroll down`, `open app.fixlist.demo`) and `/tmp/tap.sh "<regex>"` (taps the first matching element). Clean state: terminate, uninstall, reinstall `/tmp/fixlist-demo-build/Build/Products/Debug-iphonesimulator/App.app`, then open.
- Before filming: `xcrun simctl status_bar 133B41A2-044F-479A-AFC6-B6E3865F056C override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularMode notSupported`; clear it afterwards with `status_bar … clear`. Turn the hardware keyboard off if the accessory bar appears. Skip the first-run guides off camera.
- Never tap the CDC source link on camera (it opens Safari and leaves "◀ Safari" in the status bar). Avoid typing scenes. Never show the playroom scan, the Mac desktop, file paths, notifications, or any real personal data. Only the fictional Margaret / Alex / Sam profiles and the bundled sample apartment.
- Record each scene as its own clip with generous head/tail. Simulator recordings are variable frame rate: normalize to 30 fps before trimming (the old pipeline does this; keep that order).
- Taps should read clearly: either keep a short pause after each tap, or add a subtle tap indicator in post at the tap coordinates you used (agent-device gives element boxes). Don't fake UI.
- The phone must be large: about 940–1000 px tall in a 1080p frame, inside a clean device frame (as in the old promo), with headline/caption text beside it. Scene 6 may zoom (in post) into the AI card's model photo so the bathtub through the doorway is visible; label it "model's photo (zoomed)".

## Narration and captions
- Pre-generated narration WAVs (Kokoro-82M voice `af_heart`, synthesized): `recordings/cac-video/vo/vo-0N_000.wav` for scenes 01–09, from `recordings/cac-video/vo/lines.tsv`. Measured durations (s): 7.0, 16.1, 11.9, 16.6, 21.5, 23.5, 8.1, 21.8, 12.0. If you trim a line, regenerate it with:
  `VIRTUAL_ENV=$HOME/.local/share/fixlist-tts/venv PATH=$HOME/.local/share/fixlist-tts/venv/bin:$PATH python -m mlx_audio.tts.generate --model mlx-community/Kokoro-82M-bf16 --voice af_heart --lang_code a --text "…" --file_prefix vo-0N --audio_format wav`
  (run it inside recordings/cac-video/vo/).
- Burn in readable captions of the narration (bottom safe area, max two lines, ≥ 40 px, high contrast), and also write an `.srt`.
- Optional very quiet music bed: only if synthesized locally (e.g. adapt `scripts/promo/ad/music.py`), ducked well under the voice; otherwise no music.

## Code scene (scene 8)
Show real code from the repo, reformatted only for wrapping/indentation, with file path labels: (1) `src/domain/role-views.ts` `visibleRequestsFor` volunteer projection lines (the comment "Never spread a request into the volunteer projection…" and the `if (liveAssignment(r) && r.sharing.photos) view.photos = …` style lines); (2) the test title `volunteer projections omit every unshared field, including on serialization` from `src/domain/roles.test.ts`; (3) the SHA-256 binding check in `src/lib/capture-suggestions.ts` that returns `CAPTURE_MISMATCH`. Then a terminal-style card with the real output of `npx vitest run` from the repo root (actual "Test Files … passed / Tests … passed" numbers you just ran; Node via `source ~/.nvm/nvm.sh && nvm use`).

## Outputs (all under ignored `recordings/`)
- `recordings/2026-10-25-fixlist-cac-demo.mp4` (final, with narration + captions)
- `recordings/2026-10-25-fixlist-cac-demo-novoice.mp4` (same cut, captions + no narration, for Andrew to optionally record his own voice)
- `recordings/2026-10-25-fixlist-cac-demo.srt`
- `recordings/2026-10-25-fixlist-cac-thumbnail.png` (1280×720 YouTube thumbnail: FixList title + app screenshot; readable small)
- `recordings/2026-10-25-fixlist-cac-demo-contact.png` (frames every 3 s with timestamps)
- `recordings/cac-video/REVIEW.md`: scene timeline with actual timestamps, which raw clip each shot came from, verification results, and anything you could not do.

## Verification (must do, and report)
- ffprobe: duration ≤ 175 s, codecs/dimensions/fps as specified; full decode with `ffmpeg -v error -i … -f null -` shows no errors.
- Measure loudness with ffmpeg `ebur128`/`loudnorm` print.
- Look at the contact sheet and at least one frame per scene yourself: phone readable, no blank phone frames, captions inside safe area and not covering key UI, required elements present (name, app, purpose sentence, audience, tools/languages), credits readable for ≥ 6 s, no private data, no Safari back-link in status bar, status bar shows 9:41.
- Check narration and captions match, and no banned words appear anywhere (detect, finds hazards, safety assessment, validated, vetted, verified repair, prevents falls, on-device AI).

## Parent notes added 2026-10-22 ~9:50 pm (after batch B acceptance)
- The installed build (/tmp/fixlist-demo-build) is final for filming. Current test count: **57 files, 1,539 tests passed** (re-run it yourself for the terminal card).
- Room scan: More → "Room in 3D" → "Open the sample apartment" (fresh install) or "Open saved room viewer" (after reload). The viewer is ~42% of the screen; the AI card is below it.
- **Scrolling:** swipes that start on the 3D canvas orbit the scene instead of scrolling. Scroll with `/tmp/ad.sh swipe 200 705 200 330` (starts below the canvas). Use `swipe` with coordinates in points (402×874) for scene orbits too (start inside the canvas, y≈300–600).
- **Do not use "Show in 3D"** on camera: for this scan it lands on a blurry close-up of a door edge. Use the card's "Tap to enlarge" photo dialog instead (title "Photo used by the AI model", the question, "Experimental AI score · may be wrong · not a finding. You decide."). The tub is at the right edge through the doorway; zoom in post on that region and label it "model's photo (zoomed)".
- Before tapping an element with tap.sh, make sure it is fully on screen: a partially hidden element's center can land on the header's "Switch person" chip.
- First question no longer shows a disabled Previous button. Home hero reads "Check your home, one question at a time".
