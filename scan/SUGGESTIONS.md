# Local photo suggestions

`suggest.py` asks a **local** StartLux-Decision server photo questions about a
completed room scan. It produces proposed **areas to review** in that scan's
private `suggestions.json`. The family still answers each checklist item and
separately confirms a concern. This script does not change app state, answer or
confirm anything, create plan items, or certify a home as safe. It is not a
complete assessment or a validated hazard detector.

With `calibration: null`, the exported numbers are **experimental model scores**,
not calibrated probabilities, safety probabilities, or measured risks. A non-null
calibration block identifies a fitted mapping and its labeled-photo evidence; it
still does not establish performance in real homes. Nearby frames are correlated;
taking a maximum across many frames can increase false suggestions. Low scores
and absent suggestions
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
needed fixture or scene is outside the photo. Only frames meeting the relevance threshold can contribute to the suggestion
count or become the best frame. A high score on an irrelevant frame is excluded.

## Setup and commands

Use the existing scan environment from `scan/README.md` (pycolmap, NumPy, Pillow).
This step adds no dependency. Run from the repository root using
`scan/venv-python`. It reads pycolmap in a fresh process and **never imports
torch**. The MLX model runs in a separate server process using the existing
decision environment and already downloaded model folder:

```sh
"${FIXLIST_DECIDE_BIN:-$HOME/.local/share/fixlist-scan/decide-venv/bin/startlux-decide}" serve \
  --model "${FIXLIST_MODEL_DIR:-$HOME/.local/share/fixlist-scan/models/StartLux-Decision-v1.1-9B-AutoThink-MLX-4bit}" \
  --backend mlx --port 8090
```

In a second terminal (the tracked historical calibration must be refit with
weight/runtime pins before producing new calibrated output; see the repair
section below):

```sh
scan/venv-python scan/suggest.py playroom-video-150
```

Example with explicit controls:

```sh
scan/venv-python scan/suggest.py playroom-video-150 --url http://127.0.0.1:8090 --keyframes 32 --threshold 0.6 --location-threshold 0.5 --think-mode never --timeout 120 --retries 2
```

`FIXLIST_DECIDE_BIN` and `FIXLIST_MODEL_DIR` override those defaults. The Python
runner expands `~` at runtime and shell-quotes the actual values in its unreachable
server hint. These variables do not start a server automatically.

Defaults: 32 keyframes (1–200 allowed; capped at registered frame count),
suggestion threshold 0.6, location threshold 0.5, `--min-frames 1`, think mode `never` (matching the adopted review conditions), 120 seconds
per HTTP attempt, two retries. Relevance must be at least 0.5. A grid choice with
`none_probability >= 0.2`, or a null choice, is not localizable. `auto` may take
much longer than `never`; the historical measured run is recorded below. A request
that times out can still be running on the server when a retry starts.

HTTP 429/500/502/503/504 and connection/timeout failures receive bounded retries
with a short backoff. Other HTTP failures (including 401 and 422) fail immediately;
there is no authentication bypass or credential handling. An unreachable-server
error prints the runtime-expanded serve command with environment overrides. Malformed responses, missing answers,
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
and `timing.dryRun = 1`. Dry runs ignore the default real-model calibration; an explicit synthetic fit still receives all condition checks. The required `model.backend = "mlx"` identifies the
intended real backend; it does not mean MLX ran. Dry runs refuse to replace an
existing real or unknown result. A later real run can replace the dry-run result.

## Input and placement

For `private-captures/scans/<scan-name>/`, the runner reads:

- `scene.json` for `splatCount` and `scene.splat` for the exact scene identity.
- Available `run.json` for reconstruction provenance (otherwise explicitly null).
- `work/dataset/images/` for undistorted registered images.
- `work/dataset/sparse/` through pycolmap, using registered image names, PINHOLE
  intrinsics, world-to-camera poses and each image's observed sparse 3D points.
- `work/alignment.json` for `rotationWorldToAligned` and `sparseCenterOriginal`.

Registered filenames are sorted naturally and sampled evenly including endpoints
(a one-frame request selects the middle frame). Each selected photo produces one
`POST /v1/systemone` with eight `noul` review questions and eight `noul` scope
questions, one JPEG data URI, and one `<image>` marker. Request photos are resized
to at most 1024 pixels per side, keeping aspect ratio. After all review requests complete, each item
selects its highest-scoring **relevant** frame (ties use keyframe order). Only
that frame, if at or above the location threshold, produces a separate `choice`
request over the nine equal grid cells, with `allow_none` and `none_check` enabled. This follows
the local StartLux `docs/api.md` and `examples/image_request.py`; the API itself
returns the `noul` value directly, without another `answer` wrapper.

For an accepted cell, a ray passes through its center. Placement requires at
least three observed points inside the cell and within five degrees of that
ray, with `(p90 - p10) / median` camera-z depth spread <= 0.25. No depth is
borrowed from neighboring cells. Model confidence must be >= 0.7, chosen-cell
mass >= 0.6, and its margin over the next cell >= 0.25, in addition to the none
probability gate. Ambiguous choices, too few points and conflicting depth layers
produce photo-only suggestions. These are conservative heuristic gates, not
validated location confidence or object-region localization.

The approximate world point uses median camera-z depth and
`aligned = rotationWorldToAligned @ (worldPoint - sparseCenterOriginal)`.
Output includes explicit `localization` status/reason/support/angular and depth
spread diagnostics. The UI must show the approximate/photo-only state; decimal
rounding does not establish accuracy. Empty tracks from pose imports provide no
depth evidence, so those items stay photo-only. See the binding contract for
all fields and limits.

## Current output schema v2 (2026-10-18)

The binding contract is [`docs/suggestions-v2-contract.md`](../docs/suggestions-v2-contract.md).
Producers write v2 with versioned scene identity. The app requires a matching
scene hash; older unbound files must be regenerated before attachment. The Python
archival schema still checks v1, including absent `viewpoint` (treated as null).
V1 lacks relevance traces, so a false legacy suggestion cannot establish why it
was excluded. Validation never invents that evidence.

The UTF-8 JSON file has exactly these root keys:

| Key | Contract |
| --- | --- |
| `format`, `version` | `"fixlist-scan-suggestions"`, integer `2` |
| `createdAt` | UTC ISO timestamp with milliseconds and `Z` |
| `model` | Exactly `name`, `backend: "mlx"`, `engine: "startlux-decision"`, `license: "CC BY-NC 4.0 weights"` |
| `scan` | Positive integer `splatCount`, `framesAnalyzed` (1–200), unique ordered `keyframes`, versioned `identity` (see extension) |
| `thresholds` | Scores `suggestion`, `location`, `relevance: 0.5`, `noneProbability: 0.2`; integer `minFrames` from 1 to frames analyzed |
| `calibration` | Null for raw output, or the Platt block described below |
| `notice` | `Model suggestions are areas to review, not findings. They never answer or confirm a checklist item.` |
| `items` | All eight catalog items, in catalog order |
| `timing` | `totalSeconds`, `requestSeconds`, `requests`, `attempts`, `retries`, `dryRun` (integer 0 or 1) |

Each item has exactly these fields:

| Field | Meaning |
| --- | --- |
| `checklistItemId`, `concernId`, `question`, `relevanceQuestion`, `limitation` | Equal the shared trusted catalog |
| `perFrame` | Ordered rows with exactly `frame`, `rawProbability`, `probability`, `relevanceProbability` |
| `relevantFrames` | Count of rows whose relevance score is at least `thresholds.relevance` |
| `framesAboveThreshold` | Count of relevant rows whose output score meets `thresholds.suggestion` |
| `bestFrame`, `score` | Highest-scoring relevant frame and its output score; both null when none is relevant; first keyframe wins ties |
| `meanProbability` | Mean output score over **all** rows, including irrelevant rows |
| `status` | `suggested` if count meets `minFrames`; otherwise `not-visible` if no relevant rows; otherwise `below-threshold` |
| `position` | Best relevant frame's approximate aligned position, or null; allowed only if its score meets `thresholds.location` |
| `viewpoint` | Aligned camera center for that best frame, or null; requires non-null position |
| `localization` | Null or explicit approximate/photo-only geometry diagnostics (see contract extension) |
| `thumbnail` | JPEG data URI if and only if status is `suggested`; ≤320 px per side, ≤128 KiB; re-encoding strips metadata |

The field names `rawProbability`, `probability` and `relevanceProbability` are
interchange names, not empirical probability claims. With no calibration,
`probability` equals `rawProbability` exactly. With calibration it equals
`sigmoid(a * logit(clamp(rawProbability, 1e-6, 1-1e-6)) + b)` for that item.
Relevance scores remain raw and are not multiplied into output scores.

A non-null `calibration` has exactly `method: "platt"`, `parameters` (all eight
item IDs, each `{a, b}` with finite coefficients and `a > 0`), `fittedAt` (UTC),
`labelSource` (≤200 characters), integer `trainExamples` and `heldOutExamples`,
and `heldOutBrierRaw` and `heldOutBrierCalibrated` in [0,1]. Counts refer to distinct scored **photos with usable labels** in each split.
Pooled metric n instead counts image-item labels; both denominators are recorded
in the fit report. See the protocol below.

Both validators recompute all available derivations: raw/calibrated score,
relevance and above-threshold counts, best frame, score, status and mean. Means
and mapped scores use absolute tolerance 1e-9; remaining summaries are exact.
Positions/viewpoints must be finite and obey the location gate. Validation
rejects extra/missing fields, booleans as numbers, malformed timestamps and
invalid JPEGs. Output is limited to 4 MiB. Saving validates first, fsyncs a
private temporary file, atomically replaces the destination, and refuses output
symlinks. Failures preserve prior results.

`timing.requests` counts logical review/localization calls (simulated in dry
runs); `attempts` counts actual HTTP attempts; `retries` counts extra attempts.
V2 uses at most one localization per item. `requestSeconds` includes parsing and
retry/backoff time. `totalSeconds` ends before validation/atomic serialization;
the progress line includes saving. Neither is a user-latency guarantee.

## Evaluation and calibration tooling

No fine-tuning or model training is implemented. `evaluate_model.py` uses only
stdlib, NumPy and Pillow and reuses `suggest.py`'s exact 16-question review
request, 1024-pixel JPEG encoding, response parser and loopback-only client.
It does not load pycolmap or torch for evaluation.

Use a **private, local** dataset directory outside tracked files, for example
`private-captures/evaluation/my-dataset/`:

- `images/` contains the images; subdirectories are allowed.
- `manifest.jsonl` has one object per image: `id`, `file` (relative to images/),
  `group` (scene/source ID), and provenance fields. Provenance is passed through
  unchanged; `scoring` is the only reserved field. Group correlated frames from
  the same scene/source together **before** looking at results.
- `scores.jsonl` is appended by scoring. Each row preserves the manifest object
  and adds `scoring: {model, requestSeconds, requestSignature, response, imageSHA256, requestImageSHA256, modelIdentity}`; the
  response contains the raw answers. No encoded request photo is saved there.
- The labels JSONL has `id` plus each of the eight checklist item IDs at the top
  level, each with exactly `relevant` and `condition` (`true`, `false`, or `null`).
  For example an item value is `{"relevant": true, "condition": false}`. Every
  item must be present; mark uncertainty with null rather than omitting it.

```sh
scan/venv-python scan/evaluate_model.py score --dataset private-captures/evaluation/my-dataset --url http://127.0.0.1:8090 --think-mode never --limit 3 --model-dir "$FIXLIST_MODEL_DIR" --runtime-dir "$FIXLIST_RUNTIME_DIR"
scan/venv-python scan/evaluate_model.py report --dataset private-captures/evaluation/my-dataset --labels private-captures/evaluation/my-dataset/labels.jsonl
scan/venv-python scan/evaluate_model.py fit --dataset private-captures/evaluation/my-dataset --labels private-captures/evaluation/my-dataset/labels.jsonl --out scan/calibration.json --seed 7 --label-source 'Describe actual annotator and labeling protocol'
scan/venv-python scan/suggest.py my-scan --calibration scan/calibration.json --think-mode never --model-dir "$FIXLIST_MODEL_DIR" --runtime-dir "$FIXLIST_RUNTIME_DIR"
scan/venv-python scan/suggest.py my-scan --no-calibration
```

`score` defaults to `think-mode never`; it skips already-scored IDs, and `limit`
limits **new** images. A dataset lock prevents concurrent append races. Each
complete row uses one O_APPEND write followed by fsync; recoverable short writes
roll back that row. A malformed/truncated file after abrupt interruption is
rejected for explicit recovery, never silently discarded. Changed image bytes, provenance, weight/runtime directory bytes,
mixed model names or changed prompts/think mode are rejected on resume; use a
separate dataset for a new scoring configuration. Failed inference preserves
previous complete rows. This script never starts the model server.

The request signature now hashes the 1024-pixel image limit together with the
review request, including think mode and all photo/relevance questions. Scores
using the earlier request-only signature require rescoring in a separate dataset;
the tool rejects them rather than assuming preprocessing provenance.

### Pre-registered protocol (version 1)

1. Sort unique **manifest** groups, shuffle using NumPy's seeded generator
   (`--seed 7` by default), and hold out `ceil(0.30 * groups)` groups. Split
   membership is independent of which labels are usable. Test groups never
   enter fitting or selection. At least five development groups are required
   for grouped 5-fold CV (at least eight total groups); fail clearly otherwise.
2. Ground truth is the photo **condition**, never the model relevance answer.
   Human `relevant: false` counts as `condition: false`, including when its
   condition is null. Human `relevant: null` is excluded; for a relevant photo,
   `condition: null` is excluded. Missing unscored/unlabeled images do not become
   negatives. Metrics use the remaining image-item labels. Calibration example counts use
   distinct photos contributing at least one usable label, consistent with the
   importer's labeled-photo display; report counts also include total usable labels.
3. Partition shuffled development groups into five folds. Select the lowest
   pooled out-of-fold Brier among **raw**, **global Platt** (shared a,b), and
   **per-item Platt with fixed L2=1 shrinkage toward the global fit**. Use summed
   logistic loss, positive slope, and no extra hyperparameter search. Empty
   item training sets inherit global coefficients. Ties within 1e-12 favor the
   simpler method in that order. Every fold needs usable train/validation labels.
4. Refit the selected method on all development data. Report held-out pooled
   and per-item n, positives, Brier, ECE (10 equal-width bins), tie-aware AUROC
   and AUPRC (average precision). Exact score ties use a common precision/recall
   threshold; ECE's last bin includes score 1.
5. Use **1000 paired bootstrap resamples of held-out groups**, with replacement,
   preserving all within-group rows. Report percentile 95% CIs for all metrics
   and the paired Brier difference (calibrated minus raw). Single-class AUROC,
   zero-positive AUPRC and empty metrics are undefined, not zero. Exclude those
   draws from that metric's CI and report `definedResamples`. Sparse-group CIs
   may be unstable; do not interpret them as real-home validation.
6. Set `adopted: true` only when held-out pooled Brier improves, the paired Brier
   difference's CI upper endpoint is strictly below zero, and pooled AUROC drops
   by no more than 0.02. Undefined adoption metrics fail this gate. Raw selection
   is never adopted; its saved Platt block is identity coefficients (with the
   contract's endpoint clamp). Flag each item with **fewer than 10 held-out
   positives** as `insufficientPositives: true`; this is a reporting flag and
   does not silently change the specified pooled adoption rule.

The fitted file stores the protocol, model, `scoringConditions` (exact keys
`thinkMode`, `imageMaxEdge`, `requestSignature`), split group IDs, CV scores, selected
method, per-item coefficients, and held-out raw/calibrated metrics/CIs. No real
labeled-photo fit is supplied by this implementation. `labelSource` defaults to
an explicit statement that annotator identity was not provided. Supply the actual
source with `--label-source`; the tool cannot establish annotation quality.

If `scan/calibration.json` exists and is adopted, `suggest.py` selects it by default.
The default think mode is now `never`, matching its review conditions. Real
application also requires matching weight/runtime content identity; the tracked
historical fit lacks it and must be refit from new pinned scores before real use.
Missing identity is checked on the first response and never silently accepted.
`--no-calibration` disables it. An explicit unadopted file is refused unless
`--force-calibration` is also supplied. Forcing changes neither the adoption
report nor its evidence limits. Invalid calibration files fail validation;
non-adopted default files are ignored. Do not check in sensitive group IDs,
label provenance or reports without reviewing their contents.

Before applying a fit, `suggest.py` checks its request conditions against this
run. It checks the fitted model name against every actual response, including
the first response when the model name becomes known. A mismatch or missing
provenance fails without writing output; an existing output remains unchanged.
`--force-calibration` only overrides adoption, never provenance checks.
`--no-calibration` bypasses the fitted file and uses raw scores. Fit-file
provenance does not change the `suggestions.json` v2 calibration block.

## Current implementation evidence (2026-10-18)

V2 production and full v1/v2 validation are exercised using generated COLMAP
scans in temporary directories, including calibrated output. Regression tests
cover relevance-only best-frame selection, minimum-frame counts, contradictory
summaries, optional legacy viewpoint, prompt drift, and runtime serve hints.
Numerical/dataset tests cover exact tiny-array metrics, grouped splits,
known-parameter Platt recovery, bootstrap/adoption rules, append rollback,
resumable scoring/provenance, and an actual fit CLI on synthetic data.
Final checks on 2026-10-18: `scan/venv-python -m unittest discover -s scan/tests`
ran **92 tests, all passed, zero skips**. Both `scan/venv-python -m unittest
scan/tests/test_suggest.py` and `scan/venv-python scan/tests/test_suggest.py -v`
ran **38 tests, all passed**, including `CameraViewpointTests`. The evaluation
module contributes **16 tests**, including the positive-slope boundary regression.
The older counts below are preserved as historical evidence.

The implementation worker could not reach the model server at `127.0.0.1:8090`
from its sandbox. Real-model scoring, the calibration study and the regenerated
`viennese-v2` suggestions were then run by the parent session (see the next
section).

## Calibration study and decision (2026-10-18)

Andrew asked for better model estimates ("fine tuning or something"). With the
data available before the October 26 deadline, fine-tuning the 9B model was not
justified: the labeled set has only 24 positive photo/question pairs, so a LoRA
fit could not be checked fairly and would likely overfit. The step taken instead
is the pre-registered Platt calibration above, plus the v2 relevance-gated
best-frame fix.

**Data.** 125 photos in 48 source groups, kept privately in
`private-captures/test-datasets/hazard-eval/` (never committed): 30 frames from
the `viennese-v2` render walkthrough (one group), 30 frames from the playroom
research scan (one group), 39 Wikimedia Commons and 26 Openverse/Flickr photos
(CC0, public domain, CC BY, CC BY-SA; per-image provenance in the manifest).
**Labels** were made by GPT-6 Luna viewing each photo against the literal photo
and relevance questions, blind to model scores. They are AI labels, not expert
ground truth, and no second annotator measured agreement. Positives per item:
stair clutter 9, bathroom support 7, cord 3, rug 2, night lighting 2, shower 1,
handrail 0, stair lighting 0 (998 usable photo/question pairs).

**Scoring.** StartLux-Decision-v1.1-9B-AutoThink-MLX-4bit, think mode `never`,
1024 px image limit, the same request as `suggest.py` (signature recorded in
`scan/calibration.json`).

**Raw model, all 125 photos.** Pooled Brier 0.0294, ECE 0.073, AUROC 0.975,
AUPRC 0.732. The model ranks photos well but is overconfident on negatives,
for example rug scores of 0.64–0.74 on frames with no raised or curled edge.

**Pre-registered fit (seed 7).** 33 development groups (102 photos) and 15
held-out groups (23 photos, 182 pairs, 8 positives). Grouped 5-fold CV selected
per-item Platt (CV Brier: raw 0.0304, global Platt 0.0104, per-item 0.0100).
Held-out results, raw → calibrated:

| Metric | Raw | Calibrated |
| --- | ---: | ---: |
| Brier | 0.0249 | 0.0129 |
| ECE | 0.065 | 0.015 |
| AUROC | 0.995 | 0.993 |
| AUPRC | 0.887 | 0.841 |

The paired Brier difference is −0.0119, with a grouped-bootstrap 95% CI of
[−0.0246, −0.0006]. The AUROC drop is 0.002, within the 0.02 limit. **The adoption
rule passed, so the calibration was adopted** (`scan/calibration.json`). The
evidence is thin. Every item has fewer than 10 held-out positives. Night
lighting, shower surface and bathroom support had slightly worse held-out Brier
on 1–2 positives each. Most of the gain comes from correcting overconfidence on
photos without the condition. An earlier fit on 99 photos (one held-out
positive) also "passed" and was not used.

**Effect on the demo scan.** `viennese-v2` was regenerated on 2026-10-18 with
the adopted calibration (60 keyframes, think mode `never`, 748 s). It shows one
area to review:

| Item | Best relevant raw | Calibrated | Status |
| --- | ---: | ---: | --- |
| Bathroom support | 0.924 | 0.986 | suggested (2 frames) |
| Rug | 0.767 | 0.259 | below threshold |
| Night lighting | 0.608 | 0.089 | below threshold |
| Cord | 0.444 | 0.036 | below threshold |
| Shower surface | 0.054 | 0.001 | below threshold |
| Stair items (3) | — | — | not visible |

This matches the manual look recorded below: the rug flag was weak and the
bathroom flag plausible. The high calibrated bathroom score rests on 2 held-out
positives, so it remains an experimental score, not a finding. The app shows it
as "adjusted on 102 example photos labeled by AI; still experimental, not
validated in real homes". Earlier raw outputs are kept privately as
`suggestions.v1-60frames-auto.json.bak` and `suggestions.v2-raw-60frames.json.bak`.

**What would make this credible.** More labeled real-home photos with positives
(e.g. Andrew photographing staged conditions at home), a second human
annotator, and per-item held-out positives of at least 10.

## Privacy and license

Scan media and suggestions stay in gitignored `private-captures/`. Keep evaluation
images, manifests, labels and raw scores there too. Calibration report destinations
are explicit; review their group IDs/provenance before tracking or sharing them.
Nothing is automatically copied into `public/` or Git. The runner sends resized frames only to an HTTP loopback address
(`127.0.0.1`, `localhost`, or `::1`), ignores proxy environment variables, and
rejects credentials, redirects and remote URLs. It makes no external upload.
Keep the server bound locally as well. Never add private source frames, output
JSON or scan media to a recording without the owner's separate authorization.

StartLux-Decision code is Apache-2.0; the requested model weights are
**CC BY-NC 4.0 (non-commercial)**. Using a local engine does not remove that
restriction. This step does not establish permission for commercial model use.

## Historical worker reports and measured runs (2026-10-17–18)

The following reports describe the earlier v1 implementation and its separate
execution environments. They do not describe current v2 coverage or schema.

### Historical worker checks (2026-10-17)

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

Parent follow-up on the host, October 18, 2026: **69 tests ran, all passed, none
skipped**, including both socket-based fake HTTP server tests.

### Real MLX run: `viennese-v2`

Historical v1 run, documented 2026-10-18; preserved without rerunning it.

One real inference run used StartLux-Decision-v1.1-9B-AutoThink-MLX-4bit served
locally on the Mac. It covered **60 of 225 registered frames** of the 131,386-splat
`viennese-v2` scan (a photoreal render, not a real home) with thresholds 0.6
suggestion / 0.5 location / 0.5 relevance / 0.2 none. It made **69 requests,
zero retries, in 1,108 seconds**. Three of eight items crossed the suggestion
threshold:

| Item | Max experimental score | Frames ≥ 0.6 | Manual look at the best frame |
| --- | ---: | ---: | --- |
| Bathroom support | 0.92 | 3 | Tub visible through an open door; no grab bar in view. Plausible. |
| Rug | 0.77 | 2 | Small dark mat at a doorway; no raised or curled edge visible. Weak. |
| Night lighting | 0.61 | 1 | Dim corner by bedroom doors. Plausible but subjective. |

The cord item peaked at 0.44 and was not suggested, although an earlier, smaller
run on this scan (output since overwritten) had suggested it. A 32-frame run on
the older 65,102-splat `viennese-baseline` scan suggested only bathroom support
(0.93; rug 0.54, night lighting 0.52). Item sets shifting with frame sampling is
the max-over-correlated-frames sensitivity described above. One run on rendered
imagery, judged by one person, is not a calibration or accuracy result.

Historical implementation checklist (v1):

- [x] Define eight photo questions with scope questions and explicit proxy limits.
- [x] Implement documented transport, keyframes, grid/depth placement,
  aggregation, thumbnails, strict output validation and atomic saving.
- [x] Execute deterministic tests and mocked HTTP-byte pipeline checks.
- [x] Parent: execute the two socket-based fake HTTP server tests outside this sandbox.
- [x] Measure the real-scan deterministic dry run and document its limits.

## Content identity and resume repair (2026-10-18)

Scene attachment, disclosure parity and localization uncertainty now follow the
extension sections of [the binding contract](../docs/suggestions-v2-contract.md).
Every new scene output hashes the exact scene, analyzed source frames, producer
script and available alignment/reconstruction provenance. Bytes are checked
again before writing, so a changed scene/frame does not receive stale output.
The source code does not retrofit guessed identities into earlier private files.

Evaluation now requires `--model-dir` and `--runtime-dir`: set them to the exact
local weights and serving-code environment used by the loopback server. Both
must be ordinary, symlink-free directories; all relative names and file bytes
are content hashed. For an environment whose venv launcher is a symlink, point
`--runtime-dir` at the ordinary installed serving-packages directory being
pinned, and record the interpreter/OS separately for a full reproducibility
claim. These are operator-configured local pins; the client does not attest
which bytes an arbitrary running server loaded. Do not equate local identity
with independent runtime qualification.

Every score row records the original photo SHA-256, the exact preprocessed
request-image SHA-256 (including encoder output), and the model/runtime
identity. Resume and fitting verify the photo bytes; resume also compares the
current weight/runtime bytes before skipping any ID. Changed bytes fail closed
and retain all prior rows. Legacy rows without hashes need a separate rescore,
not a fabricated identity migration. Reports/fits now need the original image
bytes available to validate those pins. New fit files carry model identity plus
manifest, score-file and label-file hashes. Prompt/preprocessing signatures,
think mode, thresholds and aggregation semantics remain separately recorded.

The tracked historical calibration has no weight/runtime identity and was not
rewritten or refit here. Default think mode `never` removes the original
pre-inference condition conflict and reaches the local endpoint. If that server
responds, an unpinned historical fit is then refused before calibrated output.
To produce a new calibrated result, score and refit with the exact local content
pins, then pass those same `--model-dir`/`--runtime-dir` arguments to `suggest.py`.
Raw experiments can explicitly use `--no-calibration`; this never makes raw
scores calibrated. A different model/runtime does not inherit a fit by name.

## Post-hoc scene identity for surviving legacy results

`scan/venv-python scan/bind_scene_identity.py <run-dir>` performs a read-only
inspection by default. It verifies run completion and the full existing v1/v2
suggestions schema, refuses an already-bound file, decodes and validates actual
scene bytes/count/metadata, and checks every named frame in the producer's
`work/dataset/images/` directory. Descriptor-anchored reads reject symlinked
frames and ancestors. The scene and all referenced frames must predate or equal
the original inference `createdAt`; changed/newer or missing files refuse binding.
The JSON report prints each check and the exact identity that would be attached.

`--write` is a separate explicit operator choice: it rechecks all inspected bytes,
creates an exclusive `suggestions.unbound-<UTC timestamp>.json.bak` of the exact
original, then atomically replaces suggestions.json. It never overwrites a backup
and never silently rebinds an identified file. No model or network call occurs.

The identity has the producer's same versioned shape and real SHA-256 of the
current scene, ordered source frames, this binding script, available alignment
and completed run JSON. `processing.producer` is distinctly
`bind_scene_identity.py post-hoc (identity computed after inference from the run directory)`.
`model.identity` is null even if the old file claimed weight identity: this tool
attests no weights. The original model score/calibration trace and inference
createdAt are preserved; binding is not a new scored or calibrated run.

This is deliberately weaker evidence than inference-time hashing. File mtimes
are mutable and cannot prove the bytes were identical when inference ran, nor
prove a claim made by run.json. The tool establishes a conservative association
with a surviving local run, clearly labeled after-the-fact. It cannot establish
model accuracy, geometric correctness, household safety, authentic provenance,
or the historical model/runtime. The app still checks the bound hash against
actual loaded scene bytes, so an equal-count different scene is rejected.

For exact score → fit → inference recovery commands for the unpinned historical
calibration, use [README's rescore/refit sequence](README.md#rescorerefit-a-byte-pinned-calibration).
It uses a fresh dataset, the actual model/serving-code directories, original
images, grouped manifest and actual labels; it writes a separate private pinned
fit. Identity/adoption/request conditions remain mandatory. Explicit
`--no-calibration` yields `calibration: null` and clearly experimental raw scores.
No model, fit or real private write was performed during this follow-up.
