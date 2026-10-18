# Local photo suggestions

`suggest.py` asks a **local** StartLux-Decision server photo questions about a
completed room scan. It produces proposed **areas to review** in that scan's
private `suggestions.json`. The family still answers each checklist item and
separately confirms a concern. This script does not change app state, answer or
confirm anything, create plan items, or certify a home as safe. It is not a
complete assessment or a validated hazard detector.

Probabilities are the model's estimates for a question about a single photo.
They are **not calibrated against labeled FixList photos**, safety probabilities,
or measured risks. Nearby frames are correlated; taking a maximum across many
frames can increase false suggestions. Low probabilities and absent suggestions
do not establish that a fixture is absent or an area is safe. Neither the
thresholds nor the question wording have received physical or family validation.

Several original questions cannot be answered from a photo. The catalog in
`hazard-questions.json` preserves their checklist/concern IDs and original text,
but asks narrower visible questions and records the limits:

| Checklist | Visible proxy | What still needs a person |
| --- | --- | --- |
| Rug | Raised, curled or bunched edge on a path | Whether it is secured and the path is used |
| Cord | Visible cable across a path | Occluded cables and actual route use |
| Stair clutter | Objects on visible treads/landing | The rest of the stairs |
| Handrail | Obvious break or detached attachment | Looseness and strength |
| Stair lighting | Indistinct tread edges in a dim photo | Normal light levels, fixtures and accessible switches |
| Night lighting | Dim visible bedside/doorway path | Actual bed-to-bathroom route and nighttime conditions |
| Shower surface | Pooled water, wet patch or loose mat | Friction and slipperiness |
| Bathroom support | Fixture/adjoining wall with no visible grab bar | Out-of-frame bars, installation and individual needs |

Each item has its own relevance question so the model can answer low when the
needed fixture or scene is outside the photo. Relevance gates suggestions using
the **same best frame**, rather than a different frame containing the fixture.

## Setup and commands

Use the existing scan environment from `scan/README.md` (pycolmap, NumPy, Pillow).
This step adds no dependency. Run from the repository root using
`scan/venv-python`. It reads pycolmap in a fresh process and **never imports
torch**. The MLX model runs in a separate server process using the existing
decision environment and already downloaded model folder:

```sh
/Users/al1234/.local/share/fixlist-scan/decide-venv/bin/startlux-decide serve --model /Users/al1234/.local/share/fixlist-scan/models/StartLux-Decision-v1.1-9B-AutoThink-MLX-4bit --backend mlx --port 8090
```

In a second terminal:

```sh
scan/venv-python scan/suggest.py playroom-video-150
```

Example with explicit controls:

```sh
scan/venv-python scan/suggest.py playroom-video-150 --url http://127.0.0.1:8090 --keyframes 32 --threshold 0.6 --location-threshold 0.5 --think-mode never --timeout 120 --retries 2
```

Defaults: 32 keyframes (1–200 allowed; capped at registered frame count),
suggestion threshold 0.6, location threshold 0.5, think mode `auto`, 120 seconds
per HTTP attempt, two retries. Relevance must be at least 0.5. A grid choice with
`none_probability >= 0.2`, or a null choice, is not localizable. `auto` may take
much longer than `never`; no real-model runtime has been measured here. A request
that times out can still be running on the server when a retry starts.

HTTP 429/500/502/503/504 and connection/timeout failures receive bounded retries
with a short backoff. Other HTTP failures (including 401 and 422) fail immediately;
there is no authentication bypass or credential handling. An unreachable-server
error prints the exact serve command above. Malformed responses, missing answers,
nonfinite probabilities and changing server model names stop the run. Failures
leave any existing `suggestions.json` intact.

### Dry run

```sh
scan/venv-python scan/suggest.py playroom-video-150 --dry-run
```

This exercises real COLMAP input, frame selection, image encoding, geometry,
aggregation, thumbnails, validation and output saving with deterministic fake
answers. It does not make HTTP requests or run a model. A photo-byte hash selects
deterministic values and cells without interpreting the photo; the resulting
suggested items are **not observations**.
Output uses `model.name = "DRY-RUN deterministic fake answers (no model invoked)"`
and `timing.dryRun = 1`. The required `model.backend = "mlx"` identifies the
intended real backend; it does not mean MLX ran. Dry runs refuse to replace an
existing real or unknown result. A later real run can replace the dry-run result.

## Input and placement

For `private-captures/scans/<scan-name>/`, the runner reads:

- `scene.json` for `splatCount`.
- `work/dataset/images/` for undistorted registered images.
- `work/dataset/sparse/` through pycolmap, using registered image names, PINHOLE
  intrinsics, world-to-camera poses and each image's observed sparse 3D points.
- `work/alignment.json` for `rotationWorldToAligned` and `sparseCenterOriginal`.

Registered filenames are sorted naturally and sampled evenly including endpoints
(a one-frame request selects the middle frame). Each selected photo produces one
`POST /v1/systemone` with eight `noul` review questions and eight `noul` scope
questions, one JPEG data URI, and one `<image>` marker. Request photos are resized
to at most 1024 pixels per side, keeping aspect ratio. Every review probability
at or above the location threshold produces a separate `choice` request over
the nine equal grid cells, with `allow_none` and `none_check` enabled. This follows
the local StartLux `docs/api.md` and `examples/image_request.py`; the API itself
returns the `noul` value directly, without another `answer` wrapper.

For an accepted cell, a ray passes through its center. Observed world points are
transformed into camera coordinates and projected with PINHOLE intrinsics. The
median **camera-z depth** of points in the cell sets the depth on that ray. If
the cell has none, the median depth of up to five visible observed points with
directions nearest the ray is used. With no finite positive observed depth,
position is null. The world point is transformed as
`aligned = rotationWorldToAligned @ (worldPoint - sparseCenterOriginal)` and
rounded to three decimals.

Positions are coarse depth proxies, not object centers, verified hazard
locations, dimensions or surface measurements. A cell can include multiple
surfaces, and fallback points can be far from the item. Units remain arbitrary;
decimal rounding is not an accuracy claim. The runner requires matching camera
and image dimensions to avoid silently placing a location in the wrong frame.

## Output schema v1

The UTF-8 JSON file has exactly these root keys:

| Key | Contract |
| --- | --- |
| `format`, `version` | `"fixlist-scan-suggestions"`, integer `1` |
| `createdAt` | UTC ISO timestamp with milliseconds |
| `model` | Exactly `name`, `backend: "mlx"`, `engine: "startlux-decision"`, `license: "CC BY-NC 4.0 weights"` |
| `scan` | Exactly positive integer `splatCount`, integer `framesAnalyzed`, unique ordered `keyframes` |
| `thresholds` | Exactly probabilities `suggestion`, `location`, `relevance: 0.5`, `noneProbability: 0.2` |
| `notice` | `Model suggestions are areas to review, not findings. They never answer or confirm a checklist item.` |
| `items` | All eight catalog items, in catalog order, with the fields below |
| `timing` | Exactly numeric `totalSeconds`, `requestSeconds`, `requests`, `attempts`, `retries`, `dryRun` (0 or 1) |

Each item has exactly `checklistItemId`, `concernId`, `question`,
`maxProbability`, `meanProbability`, `framesAboveThreshold`, `suggested`,
`bestFrame`, `position`, `thumbnail`, and `perFrame`.

- Probabilities are raw checklist-question `P(yes)`, not multiplied by relevance.
  `framesAboveThreshold` counts frames with `P(yes) >= thresholds.suggestion`.
- `bestFrame` is the highest-probability frame, breaking ties in keyframe order.
  `suggested` is true only when that frame meets both the suggestion and relevance
  thresholds. It never creates a checklist answer or confirmation.
- `position` is that best frame's aligned position, or null. A different frame's
  position is not substituted when the best frame cannot be localized. A
  non-suggested item may have a position when it met the lower location threshold.
- A suggested item has a JPEG data URI `thumbnail`, at most 320 pixels per side;
  other items have null. Re-encoding strips image metadata. Maximum thumbnail
  length is 128 KiB; maximum output length is 4 MiB.
- `perFrame` contains exactly one `{ "frame": name, "probability": number }`
  per selected frame, in keyframe order. The scope answers are used internally;
  their trace is not exported in this v1 interchange schema. A consumer cannot
  independently recompute the relevance decision from the output alone.
- `timing.requests` counts logical photo/localization calls (simulated calls for
  a dry run); `attempts` counts actual HTTP attempts; `retries` counts extra
  attempts. `requestSeconds` includes parsing and retry/backoff time; dry runs
  record fake-response time. `totalSeconds` ends after aggregation and thumbnails,
  before final validation and atomic serialization. The final progress line
  reports elapsed runner time through saving.

`suggestion_schema.py` checks exact shapes, catalog links/text, UTC dates, finite
numbers, probabilities in [0,1], bounded counts/lengths, consistent aggregates,
valid JPEG thumbnails and finite positions. It rejects booleans as numeric
fields. The runner validates before saving, uses a private temporary file and
atomic replacement, and refuses output symlinks. A failed run does not leave a
partial result. Input media and the resulting base64 thumbnails are private.

## Privacy and license

All files stay in gitignored `private-captures/`. Nothing is copied into `public/`
or Git. The runner sends resized frames only to an HTTP loopback address
(`127.0.0.1`, `localhost`, or `::1`), ignores proxy environment variables, and
rejects credentials, redirects and remote URLs. It makes no external upload.
Keep the server bound locally as well. Never add private source frames, output
JSON or scan media to a recording without the owner's separate authorization.

StartLux-Decision code is Apache-2.0; the requested model weights are
**CC BY-NC 4.0 (non-commercial)**. Using a local engine does not remove that
restriction. This step does not establish permission for commercial model use.

## Executed checks and remaining gates

```sh
scan/venv-python -m unittest discover -s scan/tests -v
```

Observed in this worker on October 17, 2026: **64 tests ran in 23.164 seconds;
62 passed and 2 were skipped**. The skips are the real fake-HTTP-server tests:
the sandbox rejected `bind(('127.0.0.1', 0))` with `PermissionError: [Errno 1]
Operation not permitted`. They remain in `test_suggest.py` and execute normally
on a host permitting loopback binding. Their full socket-based execution is an
unmet acceptance gate for the parent. Mocked HTTP-byte pipeline tests did pass,
including real synthetic COLMAP input, request serialization, parsing,
localization/none gating, thresholds, aggregation and output. Request timeout,
retry/final-error, atomic preservation and fake-versus-real output tests also
passed. No torch import was present in the suggestion test process.

The real `playroom-video-150` dry run used **32 of 146 registered frames**,
192,508 splats, and **96 simulated requests / zero HTTP attempts**. It wrote
**58,645 bytes** in **8.188 seconds through saving** (`timing.totalSeconds`
8.184366). Its two fake suggestions exercise plumbing only. This was one
observed run while other validation was running, not an inference benchmark.
The artifact is private and explicitly marked as a dry run.

An actual CLI attempt using `--keyframes 1 --url http://127.0.0.1:1 --timeout 0.1
--retries 0` produced the clean unreachable-server error and exact serve command.
It left the prior dry-run output intact. The sandbox could not run the MLX
backend. Real MLX inference, empirical photo calibration, location accuracy and
family review remain unvalidated. This worker made no app changes or commits;
the parent owns integration and final acceptance.

Implementation checklist:

- [x] Define eight photo questions with scope questions and explicit proxy limits.
- [x] Implement documented transport, keyframes, grid/depth placement,
  aggregation, thumbnails, strict output validation and atomic saving.
- [x] Execute deterministic tests and mocked HTTP-byte pipeline checks.
- [ ] Parent: execute the two socket-based fake HTTP server tests outside this sandbox.
- [x] Measure the real-scan deterministic dry run and document its limits.
