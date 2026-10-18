# `suggestions.json` version 2 contract (2026-10-18)

Single source of truth for the producer (`scan/suggest.py`, `scan/suggestion_schema.py`) and the importer (`src/lib/scan-suggestions.ts`). Both validators must recompute every derived field from `perFrame` and `thresholds` and reject a file whose stored summaries disagree. The photo-question catalog is `scan/hazard-questions.json`; the app imports that same JSON file rather than keeping a copy.

## Root (exact keys)

`format` = `"fixlist-scan-suggestions"`, `version` = `2`, `createdAt` (UTC ISO with milliseconds and `Z`), `model` {`name`, `backend` = `"mlx"`, `engine` = `"startlux-decision"`, `license`}, `scan` {`splatCount`, `framesAnalyzed`, `keyframes`}, `thresholds`, `calibration`, `notice`, `items`, `timing` (same keys as v1).

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

`checklistItemId`, `concernId`, `question`, `relevanceQuestion`, `limitation` (all equal to the trusted catalog), `status`, `score`, `meanProbability`, `relevantFrames`, `framesAboveThreshold`, `bestFrame`, `position`, `viewpoint`, `thumbnail`, `perFrame`.

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
- Importers still accept v1 files (with or without `viewpoint`) after the full v1 consistency checks (best frame, max, mean, count above threshold, thumbnail only when suggested, suggested only when max ≥ threshold). v1 items have no relevance trace, so the UI labels a non-suggested v1 item "Not suggested (older file; reason not recorded)" and never calls it lower-probability.
- Python `validate_suggestions` accepts both versions; a v1 item without `viewpoint` is treated as `viewpoint: null`.

## Display rules (app)

- Show the photo `question` and its `limitation`; show the checklist prompt only as "Related checklist question". Never present a score as an answer to the checklist question.
- `calibration == null`: "Experimental model score 0.77 (uncalibrated; not a probability)". Calibrated: "Model score 0.71 (adjusted on N example photos labeled by AI; still experimental, not validated in real homes)". Never write "% likely".
- Group items as Suggested for review / Below threshold / Not visible in analyzed frames (v1: Not suggested). The empty state must not claim that nothing exceeded the threshold when items were relevance-gated.
