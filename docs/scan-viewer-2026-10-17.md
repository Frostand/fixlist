# Optional room viewer — October 17, 2026

Authorized extension: local Gaussian-splat viewing and family-placed links to the existing synthetic concerns. The parent owns acceptance and updates to the broader scope/assistance documentation. No edits to `scan/`, `public/`, dependency manifests, workflow state/schema or existing tests; no commits or external actions.

Implementation plan (executed in this worker):

- [x] Add strict scan metadata, file and pin contracts; test malformed input, catalog filtering and count/size limits.
- [x] Add a separate IndexedDB adapter with injectable persistence operations, serialized writes/reset, truthful failure results and tests.
- [x] Add a deterministic in-memory generated room and test the 32-byte `.splat` layout.
- [x] Insert a light screen-only panel after Step 1 coverage. Lazy-load the renderer on explicit import/sample/open, preserve confirmation semantics and clear the scan on demo reset.
- [x] Implement Spark native ray hits, projected markers, accessible pin navigation/removal, keyboard camera controls, upright toggle, framing and disposal. Use the established ink/plaster/sheet tokens, no hatching, and yellow only on explicitly confirmed concerns.
- [x] Run typecheck, all tests and production build; record chunk sizes and browser checks left to the parent.

The renderer uses the installed Spark 2.3.1 declarations/source and [Spark's SplatMesh documentation](https://sparkjs.dev/docs/splat-mesh/). Imported bytes are supplied directly to the decoder, with no upload or URL fetch. Pipeline metadata uses identity y-up orientation; Flip upright rotates the mesh 180 degrees about X and persists with it. Pins use scan-local coordinates, so the rotation carries both scene and pins together. Pin placement uses a CPU pick index (`src/lib/scan-pick.ts`) built on the first placement: the nearest splat with opacity ≥ 0.3 whose center lies within about 6 pixels of the click ray (or within its own capped radius). The pin is placed on the click ray at that depth, so it always lands under the cursor. Spark's built-in splat raycast was replaced because it missed thin, flat Gaussians (rugs, floors) in a real trained scan and could return hidden points. Picking runs only on explicit placement, never every frame; no ground-plane guesses or automatic hazard detection.

Validation: Node 24.18.0 / npm 11.16.0; `npm run typecheck`, `npm test` (481 passing in eight files: 387 existing unchanged + 94 new), `npm run build`, and `git diff --check` passed. An initial full-suite run timed out because the new sample tests used hundreds of thousands of individual assertions and an expensive byte-array matcher. The new tests now inspect all records using aggregate checks and an efficient byte comparison; existing tests/timeouts/config were not changed. The generated room contains **40,137 splats / 1,284,384 bytes**, with no fabricated scan provenance or binary asset.

Vite production JavaScript (decimal kB):

| Chunk | Minified | Gzip |
| --- | ---: | ---: |
| Initial app | 313.53 kB | 94.79 kB |
| Lazy Three/Spark viewer | 3,077.36 kB | 1,036.09 kB |
| Lazy sample generator | 1.34 kB | 0.69 kB |

Initial JS remains below the 250 KiB gzip budget. Vite warns about the large **lazy** viewer chunk; this is not a latency measurement. Saved scans require an explicit Open action to load that chunk too.

Persistence is IndexedDB `fixlist-scan`, version 1, store `local-scan`, key `current`. Validation limits metadata to 64 KiB, binaries to 300 MiB, decoded splats to 10 million and pins to 200. Pin coordinates are finite triples capped at absolute 100 million. Metadata accepts ISO timestamps with explicit timezone, including Python microseconds/UTC offsets. Reads do not rewrite invalid data; retired concern pins are filtered with a visible notice. Failed save/reset results report memory-only or reload-restoration limits. Closed-view pin removal and upright edits also save. Reset synchronously unmounts the viewer before queueing store clearance so a late decoder cannot save afterward; failed reset does not reopen the old scan in the current view. Other browser data and the existing localStorage schema are untouched.

Renderer cleanup cancels scheduled drawing, disconnects resize observation, removes event listeners and disposes controls, mesh data, Spark geometry/material/render targets/workers, and the WebGL renderer/context. A decode already in progress is allowed to settle and its mesh is then disposed; Spark does not expose cancellation for that decoder. There is no animation or auto-rotation. Mouse drag is distinguished from pin placement; arrows, zoom buttons, Home/Reset view and center-of-view placement provide keyboard alternatives. Markers are projected overlays; they do not establish occlusion, measurement accuracy or room-to-concern correspondence.

Changed files: `src/app/ScanPanel.tsx`, `ScanViewer.tsx`, minimal integration in `App.tsx`/`WorkflowSections.tsx`, `src/lib/scan-model.ts`, `scan-storage.ts`, `scan-sample.ts` and their three new test files, `src/styles/base.css`, and this note. No worker edits to `scan/`, `public/`, dependency manifests, domain/storage schemas or existing tests. No commits or external actions.

**Browser checks run by the parent (October 17, 2026, production preview, desktop Chrome-based tab):** the generated sample (40,137 splats) and a real pipeline scan (192,508 splats, `scene.splat` + `scene.json`) both rendered with no console errors; the real scan rendered upright from its metadata camera. Click and center-of-view pin placement landed on the clicked pixel (8 of 9 sampled points hit after the CPU-picking change, including the rug Spark had missed). Arrow-key orbit re-projected markers; a pin turned yellow when its concern was confirmed and changing it did not alter plan state; Reset cleared both `fixlist:demo:v1` and the scan store. At 320px with the viewer open there was no horizontal overflow and no control under 44px. **Not verified:** third-party app exports (Scaniverse/Polycam/Luma `.ply`/`.spz`), IndexedDB denial in a real browser, screen-reader announcements, OS-level reduced motion, repeated-import GPU memory, physical phones, and native print output.
