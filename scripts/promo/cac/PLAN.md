# CAC render implementation plan

Goal: reproducible 172-second local video from parent-recorded Simulator clips and existing Kokoro WAVs. No app source, iOS project, dependencies, Git history or external services change.

Architecture: a static scene specification feeds HTML cards/caption sprites, normalized 30 fps app clips, a transparent device/tap overlay, ffmpeg assembly, two-pass narration normalization, and deterministic checks. HTML renders require the existing headless Chromium executable; that executable is blocked by this worker sandbox's Mach service restriction, so the parent must run the card step in its existing authorized environment. No sandbox workaround.

- [x] Implement scene metadata, source-backed code cards, captions and standalone HTML renderer in `scripts/promo/cac/`.
- [x] Implement build from raw clips/sidecars, real trim ledger, post zoom, stand-in mode, silence variant, SRT, thumbnail and contact sheet.
- [x] Run existing Vitest, retain actual results; use explicitly authorized parent numbers only when localhost is blocked.
- [x] Exercise stand-in pipeline without writing final deliverable paths.
- [x] Ingest all five real clips, inspect event timings, render final outputs; no stand-ins permitted in final mode.
- [x] Check specs, full decode, audio loudness/peak, faststart, caption/card vocabulary and geometry; inspect scene stills and contact sheet.
- [x] Write REVIEW with source hashes, exact edit/scene times, evidence and unresolved items. Parent owns final acceptance.

Validation: `node scripts/promo/cac/build.mjs --standins`; `node scripts/promo/cac/build.mjs`; `node scripts/promo/cac/verify.mjs`. Pipeline uses no app rebuild because the installed filming build is final. Preserve existing `scripts/promo/` files. No commits, upload, deployment, publication, Simulator operation or delegation.
