# Sample walk-through implementation plan

> **For agentic workers:** Execute inline under the delegated worker boundary; no further delegation or Git operations.

**Goal:** Produce one licensed rendered sample capture, validate its real COLMAP geometry, and load/stage it through existing capture boundaries.

**Architecture:** A deterministic Python generator reads only the Viennese-v2 COLMAP reconstruction and selected licensed frames. A small TypeScript loader calls existing bundle, storage and hash-bound flags validators. Native staging snapshots the optional sample before sync; Vite serves only exact sample filenames through its existing local/private boundary.

**Tech Stack:** Existing Python/Pillow/numpy/pycolmap; TypeScript/Vitest; Node/Vite. No dependency changes.

## Global constraints

- No edits to src/app, src/styles, src/i18n, assets/icon.svg, fixlist-plan.md, package dependencies or lockfile.
- No Git operations, nested models, live inference, server startup, external messages or publishing.
- Sample is a CC BY-SA 4.0 photoreal render, not a real home or ARKit recording. Arbitrary reconstruction scale and outline are drawing aids, never measurements.
- No flags are fabricated; parent runs the exact local inference command. Checklist answers and confirmation stay untouched.

## Execution

- [ ] Generator: select 4–6 bedroom frames including 000225; fit a floor to visible sparse floor observations, apply one world similarity and COLMAP-to-OpenGL axis conversion, resize entire upright images and update intrinsics; bound reprojection residuals. Write exact-key bundle, provenance README and geometry evidence under private-captures/sample-walkthrough. Always-run conversion tests and optional generated-file TypeScript validation.
- [ ] Loader: fetch only fixed local paths, bound reads, validate bundle and optional flags before changing storage, enforce a live actor/checklist scope predicate and capture-specific replacement consent, bind operations to the existing store/reset generation. Test permissions, mismatches, failed fetches, replacement races and reset races.
- [ ] Packaging: preserve existing scan stages/tests and snapshot optional sample bundle, flags and attribution; validate hashes and strict schemas before atomic native installation. Add explicit absence reporting. Extend Vite allowlist for exactly these sample files; check same-origin, methods and symlink boundary.
- [ ] Validation: Node 24.18.0, npm run typecheck, npm test, npm run build, scan/venv-python -m unittest discover -s scan/tests; generated bundle passes Python and real TypeScript validators. Report exact parent inference command and unexercised Simulator/model gates.
