# FixList iOS launch promo

Rebuild the 1920×1080 promo from **real iOS Simulator recordings**:

```sh
node scripts/promo/build-video.mjs
node scripts/promo/verify-video.mjs
```

Requires the installed project fonts/logo, Node 24, FFmpeg/ffprobe with libx264,
macOS `say` with Samantha, and headless Chromium. Set `PROMO_CHROMIUM` to override
the default local Chromium executable. No dependencies are installed by these scripts.

`storyboard.json` is the editing source: scene order, minimum shot durations,
captions, narration, native clip filenames, in/out points and speeds. Narration
can extend the last shot of a scene if needed. Generated timings live in
`recordings/promo-work/timings.json`. Every join uses a 0.4 second crossfade.
Cards have a gentle scale; app footage is never redrawn or mocked up.

All generated HTML, PNG, AIFF/WAV, intermediate MP4 and final media are written
under ignored `recordings/`. Nothing is uploaded. The raw recordings must remain
in `recordings/promo-raw/` to rebuild. The output paths are:

- `recordings/2026-10-18-fixlist-launch-promo.mp4`
- `recordings/2026-10-18-fixlist-launch-promo-poster.png`
- `recordings/2026-10-18-fixlist-launch-promo-contact.png`

The contact sheet samples every 4 seconds, including timestamp labels. The poster
is a frame of the real three-role comparison. H.264/yuv420p/30 fps, AAC 48 kHz,
fast-start MP4. Narration is normalized with short fades. There is no music.

## Capture provenance

Recorded on the iPhone 17 Pro Simulator, iOS 26.5, bundle `app.fixlist.demo`.
Built with `npm run ios:demo` and Xcode, then clean-installed. Only the built-in
fictional profiles/household and bundled `viennese-v2` scan were used. Raw files
come from `xcrun simctl io … recordVideo --codec=h264`, never a desktop recorder.

`capture.mjs start NAME` / `capture.mjs stop` wraps Simulator recording. The default
UDID can be overridden with `PROMO_UDID`. Set the Simulator status bar before
filming and **clear it afterwards**. Do not record private captures, the playroom
scan, the Mac desktop, notifications, filenames containing personal information,
or any external account.

Simulator captures are variable-frame-rate: static takes can contain only one
frame and tiny encoded durations. The build first normalizes to 30 fps and extends
the genuine last captured frame. **Normalization precedes trimming**, so a trim
inside a static timestamp gap cannot produce a blank phone. Key screens use real
captured frame holds. A 1× or slower camera move is identified in the storyboard;
navigation excerpts use the recorded in/out points and speed.

## Review and evidence limits

Run verification after editing. It checks output codecs/dimensions/duration,
decodes the whole video, checks voice timing, samples every phone at 2 fps for
blank content, and records integrated audio loudness. Inspect the contact sheet,
scene transitions and key frames as well: a codec check cannot verify copy,
privacy, permissions, readability or the app's behavior.

The promo is a fictional local demo. No real accounts, messages, visits, repairs,
vetting, validated AI or independent repair verification are established. The
licensed apartment reconstruction uses arbitrary units. Spanish is unreviewed
machine translation. The final card carries the source, license and tool credits.

Default command output is reproducible from these raw clips and the installed
versions; byte-identical encodes/voice synthesis across different macOS or FFmpeg
versions are not promised. No app source edits, commit, publication or upload are
part of this workflow.

## 45-second launch ad (`ad/`)

A motion-designed ad built by Claude Opus directly: `ad/ad.html` is a timeline (every frame is a pure function of `t`) composed from real simulator stills in `recordings/ad/shots/` and a cropped 3D-orbit sequence in `recordings/ad/orbit/` (both extracted from `recordings/promo-raw/`). `ad/music.py` synthesizes an original 120 BPM music bed with numpy (no samples or licensed music).

```sh
scan/venv-python -I scripts/promo/ad/music.py recordings/ad/music.wav
ffmpeg -y -i recordings/ad/music.wav -af "loudnorm=I=-14:TP=-1.5:LRA=11" -ar 48000 recordings/ad/music-norm.wav
node scripts/promo/ad/render.mjs --stills 9.8,19.6,26.6 --out /tmp/ad-stills   # spot-check frames
node scripts/promo/ad/render.mjs --video recordings/2026-10-18-fixlist-ad-45s.mp4 --audio recordings/ad/music-norm.wav
```
