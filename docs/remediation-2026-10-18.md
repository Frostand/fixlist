# Backlog remediation record — 2026-10-18

Status of `docs/consolidated-review-backlog-2026-10-18.md` after the first remediation pass on top of `18bb3ac`. All changes are uncommitted. Implementation was AI-assisted: bounded Codex workers (`gpt-6.1-sol`) wrote the code and tests in separate worktrees; the Claude orchestrator merged, resolved conflicts and ran the checks below. Worker evidence: `scan/REPAIR-2026-10-18.md`, `scan/FOLLOWUP-2026-10-18.md`, `docs/routing-navigation-implementation-report-2026-10-18.md`.

## Verification actually run

- `npm run typecheck`, `npm run build`, `git diff --check`: pass. Initial JS 168.43 kB gzip (was 151.16), within the 250 KiB budget; lazy viewer chunk unchanged at 1,036.56 kB gzip.
- `npm test`: 1,304 tests in 43 files pass, including the localhost HTTP boundary suite.
- `scan/venv-python -m unittest discover -s scan/tests`: 129 tests pass (was 98 with 2 failures and 14 errors).
- Browser (Chromium, 390 px, clean incognito profile): fresh-install deep link → language → person → guide skip → intended destination; skip link focuses content without changing the route; Help and reset dialog return focus to their triggers; Resources Back returns to its entry tab; a stale second tab is refused with a refresh prompt; local scan loads with its scene-bound suggestions and restores after reload; manual pins produce a marked crop for review before saving.
- iOS: `npm run ios:demo` (stage → build/sync → install) and a Simulator build/launch on iPhone 17 Pro reach the language screen. No deeper Simulator journey, VoiceOver, print/PDF or physical-device check was run.

## Item status

| Area | Fixed | Partial | Not started |
| --- | --- | --- | --- |
| A. Data and lifecycle | D01, D03–D15 | D02 (a stale tab is refused, but `saveDemoState` compares the stored revision and then writes in separate steps; two tabs reading the same revision at the same moment could still overwrite each other. Not reproduced; a cross-tab lock such as Web Locks is the likely fix) | — |
| B. Routing and interaction | N01–N10, N12, N13, N15 | N11 (needs VoiceOver checks), N14 (needs device camera/library checks) | — |
| C. Scan pipeline | S01, S02, S04–S07, S09, S14, S16 | S03 (`cap sync` itself is still non-atomic), S08 (harness guard only; device not measured), S10 (lower caps and preflight; no phone memory measurement), S12 (marked crops for new pins; older unmarked images are withheld from sharing until re-prepared) | S11, S13, S15 |
| D. IA, design, accessibility | — | U07 (code part: guides outside the tab shell, skip/resume) | U01–U06, U08–U12 |
| E. Capture | — | — | C01–C09 |
| F. Model evaluation | — | M08 (code: byte/model pins and resume invalidation) | M01–M07, M09, M10 |
| G. Accounts | — | — | A01–A10 (outside the current no-backend scope) |
| H. Product | — | F05 (D09 adds a minimal local professional-help record) | F01–F04, F06–F10 |
| I. Engineering | E01 (CI workflow added; not yet run on GitHub) | E02 (regression tests, no mounted browser journeys), E06 (architecture.md and src/lib/README.md updated) | E03–E05, E07–E13 |

## Behavior changes to review

1. **Saved state is schema 5** inside a revisioned envelope (same `fixlist:demo:v1` key). Versions 1–4 migrate in memory and are rewritten only on the next save. Navigation drafts use a separate `fixlist:navigation:v1` key.
2. **Fail-closed persistence.** If storage is unavailable, or saved data needs recovery, edits are refused rather than kept only in memory. Stale-tab writes are refused with a refresh prompt.
3. **Scene identity is required for model suggestions.** Unbound legacy `suggestions.json` files are rejected for display and pins. The two Viennese runs in `private-captures/` were bound with `scan/bind_scene_identity.py --write`; their originals were kept as `suggestions.unbound-*.json.bak`. That binding is explicitly labeled post hoc. `playroom-video-150` has no suggestions file.
4. **The historical calibration is refused for new calibrated output** because it has no pins for model weights or runtime. The default think mode now matches it (`never`), but new calibrated scores need the rescore/refit sequence in `scan/README.md`. `--no-calibration` still produces scores labeled experimental. Existing suggestion files keep their recorded scores.
5. **Import limits:** 64 MiB and 1.5 million splats. `.splat` and bounded scalar-vertex `.ply` only; compressed SPZ/KSPLAT are refused until bounded decoders exist.
6. **Completion ends a volunteer's evidence access**; task history remains. Confirmation needs both confirmation and checklist grants.
7. **Model-suggested pins** save a marked crop only when the location is visible from the current view. Otherwise the person can save the note without an image. The full source frame is no longer exported.
