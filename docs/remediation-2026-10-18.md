# Backlog remediation record — 2026-10-18

Status of `docs/consolidated-review-backlog-2026-10-18.md` after two remediation passes on top of `18bb3ac` (first pass committed as `56a3814`). Implementation was AI-assisted: bounded Codex workers (`gpt-6.1-sol`) wrote the code and tests in separate worktrees; the Claude orchestrator merged, resolved conflicts and ran the checks below. Worker evidence: `scan/REPAIR-2026-10-18.md`, `scan/FOLLOWUP-2026-10-18.md`, `docs/routing-navigation-implementation-report-2026-10-18.md`.

## Verification actually run

- `npm run typecheck`, `npm run build`, `git diff --check`: pass. Initial JS 168.89 kB gzip (was 151.16), within the 250 KiB budget; lazy viewer chunk unchanged at 1,036.56 kB gzip.
- `npm test`: 1,317 tests in 44 files pass, including the localhost HTTP boundary suite.
- `scan/venv-python -m unittest discover -s scan/tests`: 129 tests pass (was 98 with 2 failures and 14 errors).
- **iOS Simulator (iPhone 17 Pro, Debug build of this code):** driven through the WebKit remote-inspector socket, evaluating JavaScript in the app's WKWebView (no tap automation was available). Passed: onboarding; rug question Yes → explicit confirmation; plan → share room name and visit times → choose Alex → reload keeps the selection → invite; Alex sees only the shared fields and not the professional handrail task; accept; resident revokes visit times and Alex no longer sees them; Home's next step prioritizes the proposed visit time; agree, update, report done, **Not done yet**, report again, **Yes, it's done**; removing and re-confirming the concern offers a new request episode; professional handrail record advances without volunteer assignment and Home no longer loops; synthetic photo added through the library input; reset dialog wording and focus, storage cleared except reset-generation markers, reload returns to language selection; bundled `viennese-v2` scan renders with its bound suggestions, five viewer open/close cycles each load and remove the canvas. `navigator.locks` is available in this WKWebView.
- **Browser (Chromium):** fresh-install deep link → language → person → guide skip → destination; skip link keeps the route; Help and reset dialog return focus; Resources Back returns to its entry tab; stale second tab refused; two tabs submitting conflicting saves at the same moment (3 runs): one save lands, the other is refused with the refresh prompt, storage holds the winner.
- **Print:** headless Chromium on the production build: Print waits until the report photo has loaded, then calls `print()` once; `Page.printToPDF` output (6 pages) shows the evidence limits, checklist coverage, confirmed actions, the photo, fictional screening and disclaimers legibly. This exposed a stale "(UTC)" label after a local time-zone time, now fixed with a regression test.
- Not run: VoiceOver, large-text, native print sheet/PDF from the iOS app, physical iPhone, real camera/permission prompts.

## Item status

| Area | Fixed | Partial | Not started |
| --- | --- | --- | --- |
| A. Data and lifecycle | D01–D15 (D02 with Web Locks; see limit below) | — | — |
| B. Routing and interaction | N01–N10, N12, N13, N15 | N11 (needs VoiceOver checks), N14 (needs device camera/library checks) | — |
| C. Scan pipeline | S01, S02, S04–S07, S09, S14, S16 | S03 (`cap sync` itself is still non-atomic), S08 (harness guard plus simulator open/close; device memory not measured), S10 (lower caps and preflight; no phone memory measurement), S12 (marked crops for new pins; older unmarked images are withheld from sharing until re-prepared) | S11, S13, S15 |
| D. IA, design, accessibility | U09 (unanswered shows no selection and reads "Not answered"; explicit Not sure stays separate in screens, progress and print) | U02/U03 (switchable three- and four-tab prototype behind "Navigation layout (prototype)" / `?nav=`; default layout unchanged; awaiting the session in `docs/navigation-comparison-session-guide.md`), U07 (code part: guides outside the tab shell, skip/resume) | U01, U04–U06, U08, U10–U12 |
| E. Capture | — | — | C01–C09 |
| F. Model evaluation | — | M08 (code: byte/model pins and resume invalidation) | M01–M07, M09, M10 |
| G. Accounts | — | — | A01–A10 (outside the current no-backend scope) |
| H. Product | — | F05 (D09 adds a minimal local professional-help record) | F01–F04, F06–F10 |
| I. Engineering | E01 (CI workflow added; not yet run on GitHub) | E02 (regression tests plus scripted simulator/browser journeys, not checked in), E06 (architecture.md and src/lib/README.md updated) | E03–E05, E07–E13 |

**D02 detail.** `src/lib/storage-lock.ts` serializes household read/compare/write, reset, refresh and navigation-draft writes under the exclusive `fixlist:demo:v1:write` Web Lock; dispatch is asynchronous and publishes only after the durable write; a repeated activation during a save is ignored. `src/app/storage-locking.test.ts` forces the interleaving deterministically: without locks it reproduces the silent revocation overwrite, with locks the second save waits and returns `stale_revision`. Limit: when `navigator.locks` is unavailable, the compare-then-write fallback keeps its cross-process window (see `architecture.md`).

## Behavior changes to review

1. **Saved state is schema 5** inside a revisioned envelope (same `fixlist:demo:v1` key). Versions 1–4 migrate in memory and are rewritten only on the next save. Navigation drafts use a separate `fixlist:navigation:v1` key.
2. **Fail-closed persistence.** If storage is unavailable, or saved data needs recovery, edits are refused rather than kept only in memory. Concurrent saves are serialized; the losing tab gets a refresh prompt.
3. **Scene identity is required for model suggestions.** Unbound legacy `suggestions.json` files are rejected for display and pins. The two Viennese runs in `private-captures/` were bound with `scan/bind_scene_identity.py --write`; their originals were kept as `suggestions.unbound-*.json.bak`. That binding is explicitly labeled post hoc. `playroom-video-150` has no suggestions file.
4. **The historical calibration is refused for new calibrated output** because it has no pins for model weights or runtime. The default think mode now matches it (`never`), but new calibrated scores need the rescore/refit sequence in `scan/README.md`. `--no-calibration` still produces scores labeled experimental. Existing suggestion files keep their recorded scores.
5. **Import limits:** 64 MiB and 1.5 million splats. `.splat` and bounded scalar-vertex `.ply` only; compressed SPZ/KSPLAT are refused until bounded decoders exist.
6. **Completion ends a volunteer's evidence access**; task history remains. Confirmation needs both confirmation and checklist grants.
7. **Model-suggested pins** save a marked crop only when the location is visible from the current view. Otherwise the person can save the note without an image. The full source frame is no longer exported.

## Known development caveat

Running `npm test` while `npm run dev` serves the same checkout replaces Vite's `node_modules/.vite/deps` cache and leaves `deps_temp_*` directories, so the running dev server stops serving dependencies until it is restarted. The cause was not isolated (a test-mode `cacheDir` did not prevent it); restart the dev server after running the suite.
