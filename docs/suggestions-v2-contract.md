# `suggestions.json` version 2 contract (2026-10-18)

Single source of truth for the producer (`scan/suggest.py`, `scan/suggestion_schema.py`) and the importer (`src/lib/scan-suggestions.ts`). Both validators must recompute every derived field from `perFrame` and `thresholds` and reject a file whose stored summaries disagree. The photo-question catalog is `scan/hazard-questions.json`; the app imports that same JSON file rather than keeping a copy.

## Root (exact keys)

`format` = `"fixlist-scan-suggestions"`, `version` = `2`, `createdAt` (UTC ISO with milliseconds and `Z`), `model` {`name`, `backend` = `"mlx"`, `engine` = `"startlux-decision"`, `license`, optional `identity`}, `scan` {`splatCount`, `framesAnalyzed`, `keyframes`, `identity` for new/attachable files}, `thresholds`, `calibration`, `notice`, `items`, `timing` (same keys as v1).

`thresholds` (exact keys): `suggestion`, `location`, `relevance`, `noneProbability` (probabilities) and `minFrames` (integer, 1 ≤ minFrames ≤ framesAnalyzed).

`calibration` is `null` (raw model output) or exactly:

| Key | Meaning |
| --- | --- |
| `method` | `"platt"` |
| `parameters` | object keyed by every catalog `checklistItemId`: `{ "a": number, "b": number }`, finite, `a > 0` |
| `fittedAt` | UTC ISO timestamp |
| `labelSource` | text ≤ 200 chars describing who produced the labels |
| `trainExamples`, `heldOutExamples` | integers ≥ 0 |
| `heldOutBrierRaw`, `heldOutBrierCalibrated` | numbers in [0, 1] |

Platt mapping: `probability = sigmoid(a * logit(clamp(raw, 1e-6, 1 - 1e-6)) + b)`.

## Items

Exactly one item per catalog entry, in catalog order, exact keys:

`checklistItemId`, `concernId`, `question`, `relevanceQuestion`, `limitation` (all equal to the trusted catalog), `status`, `score`, `meanProbability`, `relevantFrames`, `framesAboveThreshold`, `bestFrame`, `position`, `viewpoint`, `thumbnail`, `perFrame`, optional `localization` (new producers include it).

`perFrame`: one row per keyframe in keyframe order, exact keys `frame`, `rawProbability`, `probability`, `relevanceProbability` (all probabilities).

Derivations (validators recompute; means compared with 1e-9 absolute tolerance, everything else exactly, calibrated probabilities with 1e-9):

- `probability` = `rawProbability` when `calibration` is null, else the Platt mapping for that item.
- A row is *relevant* when `relevanceProbability >= thresholds.relevance`.
- `relevantFrames` = number of relevant rows.
- `framesAboveThreshold` = number of relevant rows with `probability >= thresholds.suggestion`.
- `bestFrame` = the relevant row with the highest `probability` (first in keyframe order on ties); `null` when no row is relevant. (This replaces v1's "pick the global maximum, then gate it" policy.)
- `score` = `probability` of `bestFrame`, or `null`.
- `status` = `"suggested"` if `framesAboveThreshold >= thresholds.minFrames`; else `"not-visible"` if `relevantFrames == 0`; else `"below-threshold"`.
- `meanProbability` = mean `probability` over all rows.
- `position` may be non-null only when `bestFrame` is non-null and `score >= thresholds.location`; `viewpoint` may be non-null only with a position.
- `thumbnail` is a JPEG data URI (≤ 128 KiB, ≤ 320 px per side) if and only if `status == "suggested"`; otherwise `null`.

## Compatibility

- Producers write only v2.
- Identified v1 files (with or without `viewpoint`) remain attachable after the full v1 consistency checks; unbound legacy files are rejected under the scene-identity policy below. Those checks cover (best frame, max, mean, count above threshold, thumbnail only when suggested, suggested only when max ≥ threshold). v1 items have no relevance trace, so the UI labels a non-suggested v1 item "Not suggested (older file; reason not recorded)" and never calls it lower-probability.
- Python `validate_suggestions` accepts both versions; a v1 item without `viewpoint` is treated as `viewpoint: null`.

## Display rules (app)

- Show the photo `question` and its `limitation`; show the checklist prompt only as "Related checklist question". Never present a score as an answer to the checklist question.
- `calibration == null`: "Experimental model score 0.77 (uncalibrated; not a probability)". Calibrated: "Model score 0.71 (adjusted on N example photos labeled by AI; still experimental, not validated in real homes)". Never write "% likely".
- Group items as Suggested for review / Below threshold / Not visible in analyzed frames (v1: Not suggested). The empty state must not claim that nothing exceeded the threshold when items were relevance-gated.

## Scene identity extension and attachment policy (2026-10-18 repair)

New v2 producers include `scan.identity`. It has exactly:

- `version: 1`, `sceneSHA256`: lowercase SHA-256 of the exact `scene.splat` bytes.
- `coordinateSystem: "y-up-right-handed"`, `units: "arbitrary"`.
- `frames`: ordered `{frame, sha256}` entries, matching every keyframe. Hashes
  cover original source-image bytes before JPEG preprocessing. An empty list
  explicitly means source frames were unavailable to an identity producer.
  `suggest.py` has the frames and always hashes all of them.
- `processing`: exactly `producer` (bounded label), `producerSHA256`,
  `alignmentSHA256`, `reconstructionSHA256`. Hashes identify the producing script,
  exact alignment JSON and reconstruction run JSON. Unknown/unavailable evidence
  is `null`, never a made-up hash. `suggest.py` hashes its script and alignment;
  reconstruction is null only when no run JSON exists.

The scene hash is checked against actual Blob bytes, independently of splat
count, before suggestions can be attached, displayed or turned into pins. The
importer hashes bytes after complexity preflight. Synchronous validation needs
that immutable Blob's verified hash in the session cache; it never trusts a hash
serialized alongside a Blob. `validateScanDocumentAsync` is the hydration entry
point; storage owners must await it before publishing restored documents.
`SCENE_IDENTITY_UNVERIFIED` means that preparation has not happened,
`SCENE_IDENTITY_MISMATCH` means different scene bytes, and
`SCENE_IDENTITY_MISSING` means an older unbound suggestions file. All fail closed.

Older v1/v2 files without identity remain readable by the Python archival schema
validator, but **cannot attach to a scene in the app or native package**. Import
only the scene/metadata, or regenerate suggestions locally. No legacy file is
silently verified or rebound using equal counts. This supersedes the earlier
blanket v1 import-compatibility statement. Existing private outputs and the
tracked historical calibration were not rewritten by this repair. The synthetic
TypeScript fixture computes its scene hash at runtime from its actual 32 bytes;
its absent processing/frame evidence is explicitly null/empty.

Hash identity detects accidental artifact mixing and stale results. It is not a
signature, proof of authentic provenance, geometry correctness, or home safety.

## Trusted notice and supported license (producer/consumer parity)

Both validators require the exact notice:

`Model suggestions are areas to review, not findings. They never answer or confirm a checklist item.`

The only supported model tuple is `backend: "mlx"`,
`engine: "startlux-decision"`, `license: "CC BY-NC 4.0 weights"`. Different model
names and the clearly marked dry-run model may use this tuple; arbitrary license
variants are rejected. Another engine/license needs an explicit contract and
trusted disclosure update, not an imported string. The UI must use
`TRUSTED_SUGGESTION_NOTICE` and `TRUSTED_MODEL_LICENSE` (or reviewed translations)
for disclosures. Reconstructed imported data uses those constants too.
`scan/tests/disclosure-parity.json` is shared by Python and TypeScript tests.

New outputs optionally carry `model.identity`: null when unpinned, or exactly
`{version: 1, weightsSHA256, runtimeSHA256}` with content hashes of the configured
local model and serving-environment directories. These are local content pins,
not remote server attestation. The operator must point at the exact directories
used to start the loopback server. Calibration is never transferred by name:
a real calibrated run requires matching fit-file weight/runtime identity as well
as the exact review conditions and every response's model name. Historical
calibration files without weight identity remain inspectable but cannot apply
on real inference; refit from new byte-pinned scores. `--force-calibration`
overrides adoption only. Dry-run synthetic fits do not establish model evidence.

## Localization uncertainty extension

New v2 items include `localization`, null if no placement was attempted, or exactly:
`{method: "grid-sparse-depth", status, reason, support, maxAngleDegrees,
relativeDepthSpread}`. Status is `photo-only` or `approximate`; reasons are
`ambiguous-choice`, `insufficient-support`, `ambiguous-depth`, `invalid-geometry`,
or `coarse-grid-depth-proxy`. Null numerical diagnostics mean unavailable.

A grid choice needs model confidence >= 0.7, winning cell mass >= 0.6, margin
>= 0.25 over the next cell, and none probability < 0.2. These are conservative
heuristics, not validated location confidence. Geometry requires at least three
visible observed points in the chosen cell within five degrees of its center
ray; depth `(p90 - p10) / median` must be <= 0.25. No neighboring-cell fallback
is permitted. Approximate placements expose those diagnostics and remain coarse
proxies. Unsupported or ambiguous localization keeps the supporting photo,
sets position/viewpoint null and reports a photo-only reason. ARKit imports with
no triangulated observations remain photo-only. Older identified files lacking
this diagnostic field do not gain new uncertainty evidence by migration.
