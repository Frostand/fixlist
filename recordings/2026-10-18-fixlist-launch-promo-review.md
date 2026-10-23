# FixList launch promo review

Completed local media, October 18, 2026.

- Video: `recordings/2026-10-18-fixlist-launch-promo.mp4`
- Poster: `recordings/2026-10-18-fixlist-launch-promo-poster.png`
- Contact sheet: `recordings/2026-10-18-fixlist-launch-promo-contact.png`
- Narration subtitles: `recordings/2026-10-18-fixlist-launch-promo.srt`
- Raw capture directory: `recordings/promo-raw/`
- Duration: **116.70 seconds (01:56.70)**. H.264, yuv420p, 1920×1080, 30 fps; AAC stereo, 48 kHz; fast-start metadata.

All 16 requested storyboard scenes are present. No storyboard feature was left uncaptured. App screens are genuine Simulator recordings; the title, problem and end cards are graphics as requested. Static holds extend genuine captured frames. Navigation is trimmed and sped up where specified in the storyboard; scan motion is retained. No music.

## Scene timeline

The 0.4-second crossfades make adjacent ranges overlap. Narration begins 0.45 seconds after each scene begins. Exact shot sources, trim points, speeds and captions are in `scripts/promo/storyboard.json`; measured voice timings are in `recordings/promo-work/timings.json`.

| Scene | Time | Content |
| --- | --- | --- |
| 01 | 00:00.00–00:05.30 | Meet FixList |
| 02 | 00:04.90–00:12.90 | The small things |
| 03 | 00:12.50–00:18.50 | Language and profile |
| 04 | 00:18.10–00:29.10 | One app, three views |
| 05 | 00:28.70–00:34.20 | One question at a time |
| 06 | 00:33.80–00:43.60 | Confirm and plan |
| 07 | 00:43.20–00:52.30 | Choose what to share |
| 08 | 00:51.90–00:57.40 | Same request, different view |
| 09 | 00:57.00–01:07.20 | Volunteer follow-through |
| 10 | 01:06.80–01:14.20 | Margaret reviews completion |
| 11 | 01:13.80–01:22.00 | Family permission |
| 12 | 01:21.60–01:36.00 | Optional room and AI reference |
| 13 | 01:35.60–01:40.40 | Real local-help resource |
| 14 | 01:40.00–01:44.00 | Spanish |
| 15 | 01:43.60–01:49.10 | Native print preview |
| 16 | 01:48.70–01:56.70 | Closing and credits |

## Validation

- Before filming: **1,116 tests in 28 files passed**, strict typecheck passed, Vite build passed through `npm run ios:demo`, Xcode Debug Simulator build succeeded. Logs are in `recordings/promo-*.log`.
- Clean-installed and recorded on iPhone 17 Pro Simulator, iOS 26.5, bundle `app.fixlist.demo`.
- Full final MP4 decoded without errors. All 27 card layouts have captions inside the 5% safe margins; triple-role labels do not overlap the headline or phone frames.
- 265 phone-content samples at 2 fps passed the blank-content guard. The 4-second contact sheet and targeted key frames were visually inspected.
- All voiceovers fit their scenes with no overlaps. Integrated narration: **-17.27 LUFS**; true peak **-4.61 dBTP**. No music.
- The video shows explicit concern confirmation, the CDC source line, self-reported volunteer skills, granular sharing, acceptance/time proposal/update/report-done, Margaret's time agreement and completion review, Sam's granted checklist view and revocation, the bundled scan's orbit controls, its experimental score and Show in 3D, Eldercare Locator, the Spanish disclosure banner, and the native iOS print sheet with an eight-page preview.
- Only fictional demo people/household and `viennese-v2` were captured. No playroom, private household media, desktop, notifications, browser chrome or local file paths are shown. The public Eldercare Locator phone/link and source/license URLs are intentional.
- Status-bar override was cleared after capture. No tracked app source was changed; no commit, upload or publication occurred. Existing `.claude/` owner files were preserved.
- Source hashes, output SHA-256, codecs, audio measurement, caption checks and phone samples: `recordings/promo-work/verification.json`.

## Rebuild

From the repository root:

```sh
node scripts/promo/build-video.mjs
node scripts/promo/verify-video.mjs
```

Prerequisites and capture notes: `scripts/promo/README.md`. The build is deterministic from the retained raw clips, storyboard and installed tool versions. Native voice synthesis/encoding can vary across OS/tool versions.
