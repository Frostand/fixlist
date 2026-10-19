# Room capture version 1 contract (2026-10-18)

Single source of truth for the native capture plugin (`ios/App/App/FixListCapturePlugin.swift`), the web capture layer (`src/lib/capture-*.ts`), the room sketch and flag placement (`src/lib/room-geometry.ts`, `src/app/RoomSketch.tsx`) and the Mac-side model step (`scan/suggest_capture.py`). Approved plan: an ARKit posed photo tour plus a tapped room outline on a standard iPhone 17 (no LiDAR), a resident/helper split, and a manual AirDrop round trip to the user's own Mac for model review. No LiDAR, RoomPlan, sceneDepth, server, upload or sign-in.

Everything here is approximate. ARKit world tracking gives metre-scale camera poses and a gravity-aligned floor plane; tapped corners are imprecise. The UI says "approximate" and never shows a dimension, area or accuracy claim.

## Coordinate conventions (all components)

- **World:** ARKit world with `worldAlignment = .gravity`: right-handed, **+Y up**, units are metres (approximate). Origin and heading are arbitrary per session; nothing is shared across captures.
- **Floor:** the y value of the detected horizontal floor plane, `floorY`.
- **Outline and doors:** 2D floor points `[x, z]` in world metres (the y is `floorY`).
- **Photos:** each stored JPEG is **upright as the person saw it** (portrait capture). `camera.transform` is the 4×4 **camera-to-world** matrix for that upright image, **column-major** (16 numbers, `m[12..14]` is the camera centre), with OpenGL camera axes: **+X = image right, +Y = image up, −Z = viewing direction** (the same convention as the existing nerfstudio `transforms.json` import in `scan/reconstruct.py`).
- **Intrinsics** `[fx, fy, cx, cy]` are in pixels of the stored JPEG (after any resize and rotation). Pixel `(u, v)` has its origin at the top-left corner, `u` rightward, `v` downward; pixel centres are at `+0.5`.
- **Pixel → ray:** camera-space direction `d = ((u − cx) / fx, −(v − cy) / fy, −1)`; world direction `R·d` normalised, where `R` is the upper-left 3×3 of `transform`; origin is the camera centre.
- **World → pixel** (inverse, for self-checks): `p_cam = transform⁻¹ · p_world`; visible only when `p_cam.z < 0`; `u = cx + fx · p_cam.x / −p_cam.z`, `v = cy − fy · p_cam.y / −p_cam.z`.

ARKit's `capturedImage` is landscape (sensor orientation). The native side must rotate the pixels upright and adjust intrinsics and camera axes to match. It must self-check this in Debug builds: compare `ARCamera.projectPoint(_:orientation: .portrait, viewportSize:)` for a point 1 m in front of the camera against the world → pixel formula above. Log any disagreement above 2 px; never write a wrong transform silently.

## Native plugin `FixListCapture` (Capacitor, registered like `FixListPrint`)

| Method | Arguments | Result |
| --- | --- | --- |
| `availability()` | — | `{ arkit: boolean, camera: "authorized" \| "denied" \| "restricted" \| "not-determined" }`. `arkit` is `ARWorldTrackingConfiguration.isSupported` (false in the Simulator). |
| `start(options)` | `{ captureId, roomId, roomName, language: "en" \| "es", prompts: [{ checklistItemId: string | null, text }], strings: { …all on-screen text… } }` | Presents a full-screen portrait capture screen. Resolves once when it closes: `{ status: "completed" \| "cancelled" \| "unavailable" \| "denied" \| "failed", reason?: string, capture?: NativeCaptureResult }`. Never rejects for user cancellation. |
| `discard({ captureId })` | — | Deletes that capture's native temporary folder. Idempotent. |
| `discardAll()` | — | Deletes every native capture folder (called by reset). |
| `shareFile({ fileName, text })` | UTF-8 text; `fileName` matches `^[A-Za-z0-9._-]{1,80}$` | Writes to the temporary directory and presents `UIActivityViewController` (AirDrop, Save to Files). Resolves `{ completed: boolean }`, then deletes the temporary file. |

All on-screen native text comes from `strings` (the web app owns English and Spanish). The web passes `prompts` in display order: an overview with explicit `checklistItemId: null`, followed by the guided photo requests for that room. `roomId` is required and echoed in the result; the web validates the catalog identity before reading native files. Missing, numeric or empty checklist IDs are invalid.

**Capture screen flow:** (1) "Point the phone at the floor and move it slowly" until a horizontal plane is found (status text and haptic when found); (2) "Tap each corner of the room on the floor", with tap → raycast to the floor plane and a marker line drawn; "Undo", "Close outline" (≥ 3 corners), and an optional "Mark a door" mode for floor taps at doorways; "Skip outline" is allowed; (3) one guided photo per prompt, with the prompt text, a shutter button, "Retake" and "Skip"; (4) "Done". "Cancel" is available throughout and asks for confirmation once at least one photo exists. Lost or limited tracking shows a plain message ("Move slowly; point at something with texture") and disables corner taps. Backgrounding pauses the session. Every control has a VoiceOver label; there are no time limits. No audio is recorded and no microphone permission is requested.

**`NativeCaptureResult`** = the bundle manifest below (without `jpeg`), plus `files: { [photoId]: string }`, an absolute `file://` URL per photo inside `Library/Caches/fixlist-captures/<captureId>/`. The web reads each file with `fetch(Capacitor.convertFileSrc(url))`, stores the Blob, then calls `discard`. JPEGs are written from pixel buffers (no EXIF, GPS or maker data), long edge ≤ 1600 px, quality 0.85.

## Capture manifest (`format: "fixlist-room-capture"`, `version: 1`)

Exact keys; validators reject unknown or missing keys:

```json
{
  "format": "fixlist-room-capture",
  "version": 1,
  "captureId": "cap-<8 to 40 of [a-z0-9-]>",
  "roomId": "bathroom",
  "createdAt": "2026-10-19T14:03:11.000Z",
  "mode": "arkit",
  "floorY": -1.32,
  "outline": { "closed": true, "points": [[0.1, -2.0], [2.4, -2.1], [2.5, 0.3], [0.0, 0.4]] },
  "doors": [[1.2, 0.35]],
  "photos": [
    {
      "photoId": "p01",
      "checklistItemId": "bathroom-support-check",
      "takenAt": "2026-10-19T14:04:00.000Z",
      "width": 1200,
      "height": 1600,
      "sha256": "<64 lowercase hex of the exact JPEG bytes>",
      "camera": {
        "transform": [16 finite numbers, column-major],
        "intrinsics": [1450.2, 1450.2, 600.1, 799.8],
        "tracking": "normal"
      }
    }
  ]
}
```

Rules:

- `mode` is `"arkit"` or `"photos"`. `"photos"` is the fallback guided photo tour with no AR (browser, Simulator, or unsupported or failed tracking). In `"photos"` mode, `floorY`, `outline` and every `camera` are `null` and `doors` is `[]`.
- `roomId` is a catalog room ID. `checklistItemId` is a catalog checklist item or `null` (extra photo). `photoId` matches `^p[0-9]{2,3}$`, unique; 1 to 40 photos.
- `outline` is `null` (skipped) or has 3 to 32 finite points (|coordinate| ≤ 50) with no repeated consecutive point; `closed: false` means an open polyline that is drawn but never used for placement. `doors` has 0 to 8 points.
- `camera` is `null` or complete. `tracking` is `"normal"` or `"limited"`. The rotation part of `transform` must be orthonormal within 1e-3 with determinant +1, and the bottom row must be `0, 0, 0, 1`. Intrinsics are positive and finite, with `cx` in `(0, width)` and `cy` in `(0, height)`.
- Width and height are integers from 1 to 1600.

## Export bundle file (phone → Mac)

The file is `<captureId>.fixlist-capture.json` and contains the manifest with one extra key per photo: `jpeg`, the base64 of the exact stored JPEG bytes (whose SHA-256 is `sha256`). Maximum file size is 48 MiB. The export screen states: "This file contains the photos from this room. It stays on your devices unless you send it somewhere. Send it only to your own computer." Capture, export and flag import are available to the resident and to a family helper holding the existing `checklist` delegation scope (which already grants checklist photos and scan viewing). No new scope is added.

## Capture suggestions file (Mac → phone, `format: "fixlist-capture-suggestions"`, `version: 1`)

The file is `<captureId>.fixlist-flags.json`. Exact keys:

```json
{
  "format": "fixlist-capture-suggestions",
  "version": 1,
  "createdAt": "…Z",
  "capture": { "captureId": "…", "roomId": "…", "photos": [{ "photoId": "p01", "sha256": "…" }] },
  "model": { "name": "…", "backend": "mlx", "engine": "startlux-decision", "license": "CC BY-NC 4.0 weights", "identity": null },
  "thresholds": { "suggestion": 0.6, "relevance": 0.5, "location": 0.5 },
  "calibration": null,
  "notice": "Model suggestions are areas to review, not findings. They never answer or confirm a checklist item.",
  "items": [ one per catalog entry in scan/hazard-questions.json order ]
}
```

`calibration` is `null` or exactly the v2 calibration object (`docs/suggestions-v2-contract.md`), including the same adoption rules; raw output is labelled experimental. `model`, `notice` and the license tuple follow the v2 trusted-disclosure rules exactly.

Each item has exactly these keys: `checklistItemId`, `concernId`, `question`, `relevanceQuestion`, `limitation` (all equal to the trusted catalog), `status`, `score`, `bestPhotoId`, `perPhoto`, `point`.

- `perPhoto` has one row per capture photo in capture order, with exact keys `photoId`, `rawProbability`, `probability`, `relevanceProbability`.
- The derivations are the v2 rules with photos instead of frames and `minFrames = 1`: a row is relevant when `relevanceProbability >= thresholds.relevance`; `bestPhotoId` is the relevant row with the highest `probability` (the first on ties) or `null`; `score` is that row's probability or `null`; `status` is `"suggested"` if `score >= thresholds.suggestion`, else `"not-visible"` if no row is relevant, else `"below-threshold"`. Both validators recompute these and reject disagreement.
- `point` is `null` or `{ "u": number, "v": number }` in the best photo's pixel space, inside the image. It may be non-null only when `status == "suggested"` and `score >= thresholds.location`, and it must come from the existing conservative grid-choice rules in `scan/suggest.py` (cell centre, with the same confidence, mass, margin and none-probability gates). Otherwise it is `null` and the flag is photo-only.

**Binding:** the app accepts a flags file only if `capture.captureId`, `roomId`, and the full ordered list of `photoId` and `sha256` pairs equal the stored capture. A mismatch is refused with "These flags belong to a different capture." Hash identity detects mixing; it is not a signature.

**Display policy (app):** only `status: "suggested"` items appear, never `handrail-check` or `stair-lighting-check` (they had zero calibration positives), and never as answers. Each flag shows the photo, the model's photo question, its limitation, "Experimental model score (not a finding)", and the resident's decision buttons. A flag never pre-fills, answers or confirms a checklist item.

## Flag placement (app, `src/lib/room-geometry.ts`)

Given an ARKit capture with a closed outline and a flag with `point` and a `camera`:

1. Build the ray for `(u, v)` with the formula above.
2. Intersect it with the floor polygon (the plane `y = floorY`, point inside the polygon) and with each wall: a vertical quad over each outline edge from `floorY` to `floorY + 2.4` m. The 2.4 m display wall height is a drawing assumption and is labelled approximate.
3. Take the nearest hit with distance between 0.2 m and 15 m. On a floor hit, place the flag there; on a wall hit, place it at that point. On no hit (for example stairs not in the sketch, or a ray out through a doorway), the flag is **photo-only**: it stays attached to its photo marker and is never placed.

Placement is a drawing aid: "Approximate spot from one photo". It is not a measurement.

## Room sketch (`src/app/RoomSketch.tsx`)

`RoomSketch` props: `{ capture: CaptureManifest; photoUrls: ReadonlyMap<string, string>; flags: readonly SketchFlag[]; selectedId: string | null; onSelect(id: string): void; mode: "plan" | "3d" }`, where `SketchFlag = { id; checklistItemId; photoId; point: { u: number; v: number } | null; label: string }`.

- **Plan (default):** an SVG top-down view, auto-fitted, with north arbitrary and the first wall horizontal. It shows the outline (dashed when open), door gaps, each photo as a numbered camera marker with a view-direction wedge, and placed flags as distinct markers. Photo-only flags show a small badge on their photo marker. Markers are buttons with accessible names, at least 44 pt targets, and no colour-only meaning. Labels are not rotated.
- **3D toggle:** a lazily loaded three.js view (the existing dependency) with walls extruded to 2.4 m, semi-transparent and back-face culled so the room interior is visible, plus the same markers. It uses an orbit, has a reset-view button, respects `prefers-reduced-motion` (no auto-rotation), and disposes all GPU resources on unmount.
- **Photo mode or no outline:** no plan is drawn; show the photo grid instead, with the text "No room outline. Photos only." This is the photo-only fallback.
- On-screen labelling: "Approximate room sketch. Not to scale for measuring."

## Storage, reset and privacy (web)

- **IndexedDB:** database `fixlist-captures`, holding the manifest plus a JPEG Blob per photo and the latest accepted flags file per capture, at most one capture per room (a new capture replaces the old after the person confirms). The demo budget is 5 rooms × 40 photos; refuse writes past 120 MiB in total, with a clear message.
- Captures stay out of `fixlist:demo:v1`; the household state is unchanged.
- Reset (`resetFixListData`) clears `fixlist-captures` and calls native `discardAll()`, using the same invalidation and generation pattern as the photo and scan stores. In-flight writes after a reset must not resurrect data.
- Privacy wording: "Room photos stay on this device unless you choose to send them to your own computer for AI review."
- `NSCameraUsageDescription` must also cover the room walk-through. No microphone or location permission is needed.

## Roles

- **Resident (older adult):** never has to run a capture. They see "Things to look at", where each suggested flag shows its photo and one plain question with **Add to my fix list** (a Yes answer followed by explicit confirmation, unchanged domain commands), **Not a problem**, and **Ask \<helper\>**. A flag never confirms anything by itself.
- **Family helper (with `checklist` scope):** runs the walk-through, the sketch, the export and import, and can propose. Anything that needs confirmation waits for the resident (the existing `confirm` scope rules; no permission changes).
- **Volunteer:** unchanged. Volunteers never see captures.
