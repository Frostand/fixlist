# Scan suggestions and iOS readiness — October 17, 2026

Bounded implementation plan (inline execution; no delegation, commits, dependency changes, or edits to `scan/` or `public/`):

- [x] Validate bounded suggestions against the current checklist/concern relationships; add a v2 scan document and read-only v1 migration. Keep legacy no-catalog APIs compatible with existing tests.
- [x] Route manual and local-demo selections through one importer. Serve only the three approved files through Vite dev/preview middleware with path, symlink and request checks; provide no build hook.
- [x] Add an accessible suggestion list, independent dismissal/pin actions, checklist links and dashed ink AI markers. Keep workflow commands/state untouched.
- [x] Relax iOS picker filtering while keeping importer validation; distinguish taps from touch gestures, cap mobile DPR and expose recoverable context-loss errors.
- [x] Add meaningful validation, migration, middleware, import and server-render tests; run typecheck, complete tests and build; report chunk sizes and browser checks left to the parent.

Acceptance requires the supplied task's exact copy and invariants. New data stays in IndexedDB `fixlist-scan`; `fixlist:demo:v1` is unchanged. No safety, measurement, model calibration or physical-device claim follows from these changes. Browser and iOS Simulator checks are owned by the parent because this worker has no browser.

The app passes its current catalog to storage validation, migrating v1 in memory to v2 with `suggestions: null`; reads never rewrite old bytes. The original no-catalog API still accepts/returns v1 for existing callers/tests. The IndexedDB database version remains 1 because its store/key have not changed; the stored document version is 2. Suggestion state holds validated source data, dismissed/pinned IDs and a visible dropped-link count. Explicit pinning creates the same user-pin shape as manual placement and hides the AI marker even after that pin is removed.

Limits: 4 MiB suggestion JSON, 64 items, 240 analyzed/per-item frames, 128 KiB per JPEG/PNG data URI, exact field shapes, finite probabilities in [0, 1], bounded numeric threshold/timing records, and scan-local coordinates under the existing limits. Known IDs must form an authored checklist/concern link. Imported `.splat` counts are checked against byte length; other formats use metadata and the decoded viewer count. The UI uses the current checklist wording while retaining the model's original question in source data. Dismissed items can be restored with Show dismissed. Lower-probability items retain the same explicit review/pin controls.

Local serving is limited to GET, same-origin requests, safe folder names and `scene.splat`, `scene.json`, `suggestions.json`. Symlinked folders/files are rejected; responses are no-store with correct content types and nosniff. The plugin has only dev/preview hooks and no build asset hook. Production output inspection found no private scan files. There are no dependency changes or worker edits to `scan/`, `public/`, existing tests, domain/workflow logic or localStorage.

Validation (Node 24.18.0 / npm 11.16.0): typecheck, **588 tests in 14 files** (485 existing unchanged + 103 new), build and `git diff --check` passed. A test-local Node type reference fixed the initial middleware-harness typecheck failure without changing compiler config or dependencies. Build sizes (decimal kB):

| JavaScript chunk | Minified | Gzip |
| --- | ---: | ---: |
| Initial app | 330.60 kB | 99.94 kB |
| Lazy Three/Spark viewer | 3,078.77 kB | 1,036.63 kB |
| Lazy sample generator | 1.34 kB | 0.69 kB |

Initial JS is approximately 97.6 KiB gzip, under the 250 KiB budget. Vite still warns about the large lazy viewer chunk; these sizes are not latency measurements. Automated middleware tests exercised real temporary files and streaming responses, including traversal and symlink rejection. A live Vite HTTP smoke test could not bind `127.0.0.1` because this worker's sandbox returned `EPERM`; dev/preview endpoint verification remains with the parent. No browser or iOS Simulator is available here. The parent must still check rendering/marker appearance, actual file selection, tap/pinch behavior, reload/dismiss/restore persistence, camera focus, context-loss recovery, keyboard access, 320px overflow and 44px targets in desktop Chrome and the iOS Simulator.
