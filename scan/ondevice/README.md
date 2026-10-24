# On-device photo model

The iPhone uses a bundled Core ML image encoder to suggest photos for human review. Its eight categories identify visible subjects, such as rugs and bathroom fixtures; they do not confirm hazards.

- `pilot.py`: compared candidate image encoders on our labelled photo set, using a fixed train/held-out split. We picked OpenCLIP ViT-B-32 (laion2b, MIT-licensed weights).
- `export_model.py`: converts the image encoder to Core ML (`ios/App/App/HazardModel/`) and writes the text-prompt vectors and thresholds. It also checks that Core ML and PyTorch give the same embeddings.
- `verify_native.py`: compiles the Swift helpers on the Mac and checks that the phone's resizing and scoring match Python.
- `report.py`: writes summary numbers. Private photos and embeddings stay in the ignored `.cache/`.

Historical pilot metrics used AI labels and a different item set; they do not establish accuracy for the current eight categories or real homes. The app keeps human review: flags are "possible, you decide", never findings.

`floor_objects.py` is a separate **offline research/dev experiment**, not a deployed category. Its target is visible portable loose objects on indoor floors. Furniture, flat rugs alone, and table/shelf clutter alone are negative; ambiguous images have null labels and are excluded from fitting/metrics. Search queries and collection intents are never labels. No floor-object accuracy or learning gain has been established by its synthetic tests.

From the repository root, using the existing cached model/environment:

```sh
PY="$HOME/.local/share/fixlist-scan/clip/venv/bin/python"
DATA="$HOME/.local/share/fixlist-scan/room-review-combined-20261024"
RUN="$HOME/.local/share/fixlist-scan/floor-objects-combined-20261024"
"$PY" scan/ondevice/floor_objects.py prepare --dataset "$DATA" --run "$RUN"
# After reviewing and formatting the annotations:
"$PY" scan/ondevice/floor_objects.py features --run "$RUN"
"$PY" scan/ondevice/floor_objects.py select --run "$RUN" --labels "$DATA/labels-ai.jsonl"
"$PY" scan/ondevice/floor_objects.py evaluate --run "$RUN" --labels "$DATA/labels-ai.jsonl"
"$PY" -m unittest discover -s scan/tests -p test_floor_objects.py -v
```

Default `scan/venv-python -m unittest discover -s scan/tests` still runs grouping, provenance, annotation and integrity checks. Optional training/evaluation tests skip with an explicit reason when scikit-learn is missing; synthetic cache tests need only NumPy and fixture metadata, not installed encoder packages. Use the clip environment above for the complete floor-object tests; no ML packages are added to the default scan requirements.

Prepare freezes seed 7, the input protocol, fixed prompts, 25% grouped test split and three dev folds without reading labels or decoding pixels. Creator/source/room/duplicate links and supplied 64-bit perceptual hashes (distance <=8) form connected groups; exact hash duplicates are rejected. Manifest license issues and summary license/provenance review flags are excluded, including pilot IDs 006/007. The frozen 34-image pilot has **24 dev images / 23 groups, 8 test images / 8 groups, 2 exclusions**. Metadata/perceptual checks cannot guarantee that all scene or creator aliases were found; old protected images are never opened.

Annotations are flat JSONL rows, for example `{"id":"001","target":"floor-objects-visible","label":true,"manifestSHA256":"<exact manifest bytes SHA256>","reviewer":"AI reviewer identity","uncertainty":false}`. Use JSON booleans or null. All dev/test images need rows, including nulls. Selection decodes dev outcomes only; test rows are scanned for IDs and hashed as opaque bytes until evaluation. AI labels are not expert ground truth.

Features use cached original ViT-B-32 weights on host CPU, ten fixed `pilot.views` and normalized **N x 10 x 512** embeddings. Cache identity includes weights, preprocessing/package versions, code, protocol, manifest and image hashes; old caches are never overwritten. Compare fixed paired-prompt full-image and max-ten-view contrasts against sklearn L2 logistic heads on full or normalized mean-ten features, C in {0.01, 0.1, 1}. Choose by dev grouped OOF Brier across all candidates; ties favor the simpler baseline, then lower C and full features. Retain the best linear comparison even if it loses. Fold thresholds use training groups only (precision >=0.8, >=2 true positives, then maximum recall); the final threshold uses all dev groups. Unsupported thresholds explicitly abstain.

Linear fitting **HOLDs** below 20 dev positive images in at least four groups, or if a CV training fold has a single class. Zero-shot feasibility still runs. Immutable `selection.json` locks the model, thresholds and hashes before test outcomes are decoded. `report.json` reports group/image/positive counts, ambiguity coverage, confusion, precision/recall, Brier/AUROC/AUPRC, support holds and separate host extraction/head timing. Contrast sigmoid outputs are experimental scores, not validated calibrated probabilities; host timing is not phone performance. Test evaluation is one-shot; identical retries reuse the report. Never select again using this test set, including via another directory. Hash locks guard accidental edits, not deliberate rewriting/deletion of the workflow.

For a **new, unevaluated** combined dataset, additional disjoint rows may set `development_only: true`. Keep all base rows, IDs, metadata, exclusion evidence and protocol unchanged; copy images under its `images/`. Base holdout roles stay deterministic; supplemental groups remain dev and any creator/source/near-duplicate connection to a base group is rejected. Prepare in a new run before annotation/scoring; use the combined manifest hash for all annotations. Do not modify the existing run or add data after its test is evaluated.

All candidate artifacts must stay outside Git. `productionPromotion` is always false; independent empirical acceptance is required. This workflow never exports Core ML, changes the eight app categories/resources/thresholds/catalog, or removes native human review.

Latest local pilot (2026-10-24): 53 public images, including a development-only supplement. After excluding unresolved provenance and ambiguous labels, training used 31 images (21 positive, 10 negative); the untouched test had seven usable images (four positive, three negative). The fixed max-ten-view contrast beat the best trained linear head on development Brier loss (0.096 vs 0.168) and test Brier loss (0.158 vs 0.196; lower is better). Both produced four true positives and one false positive on the small test. These AI-labeled results do not establish a reliable deployed classifier, so the shipped app model remains unchanged.

`annotation_packet.py` provides **private DEVELOPMENT annotation tooling only**. It exports all eligible dev images from a verified prepared run, with no test-export option. Only explicit `CC0`/`CC0-1.0` or `PDM`/`PDM-1.0` declarations (also their canonical Creative Commons URLs) are supported; conflicting license URLs or declared attribution/redistribution conditions are refused. Resolve rights and provenance privately before preparation; the tool does not verify rights. Other licenses require a separately reviewed workflow that preserves required attribution. Existing exclusions and exact grouping/splits remain bound in the private map. No freshness, independence, holdout recovery, expert verification, or production acceptance follows from annotation; existing/exposed test images never become fresh through relabeling.

```sh
# BUNDLE must be a new directory outside every Git checkout and outside DATA/RUN.
# RUN must have eligible CC0/PDM development images; other licenses are refused.
BUNDLE="$HOME/.local/share/fixlist-annotations/private-dev-packet"
"$PY" scan/ondevice/annotation_packet.py export --run "$RUN" --output "$BUNDLE"
# Open BUNDLE/reviewer/index.html locally. Distribute ONLY reviewer/, never PRIVATE.json.
# Edit a copy of reviewer/responses.blank.json offline and save it OUTSIDE reviewer/.
"$PY" scan/ondevice/annotation_packet.py import --private-map "$BUNDLE/PRIVATE.json" \
  --responses "$HOME/.local/share/fixlist-annotations/completed.json" \
  --output "$HOME/.local/share/fixlist-annotations/private-dev-labels.jsonl"
scan/venv-python -m unittest discover -s scan/tests -p test_annotation_packet.py -v
# Optional synthetic-only demo, including synthetic answers/import; use a new outside-Git path.
scan/venv-python scan/tests/test_annotation_packet.py --demo /tmp/fixlist-annotation-demo
```

The reviewer packet is a static local HTML index, full-resolution oriented metadata-free PNGs, and a blank JSON template, with random opaque IDs and order. It has no server or annotation UI. Each response must explicitly set `answered: true`, `label: true/false/null`, a 1–64 character reviewer alias (letters, digits, `_`, `-`), and boolean `uncertainty`; null requires true uncertainty. Aliases make no identity/expertise claim. Leave the blank template unchanged. Import rejects incomplete/extra/duplicate responses and altered packet/source/map bindings; it writes dev-only flat JSONL compatible with `floor_objects.read_labels`, plus annotation provenance. Both commands print image counts only and refuse overwrite, publishing complete results atomically (macOS/Linux). Keep the bundle private; hash locks detect edits, not coordinated malicious rewriting of every artifact. Neither command trains, selects, evaluates, or changes the production model.
