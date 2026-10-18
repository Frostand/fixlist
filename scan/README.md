# Local room scans

This command turns a local phone video or an ordered image directory into a Gaussian-splat scene for FixList. CPU pycolmap estimates new poses, or a validated ARKit/nerfstudio export supplies them; Brush trains locally on Metal. The scan is an approximate visual record with arbitrary units. It does not measure distances, detect hazards, assess completeness, or certify a room as safe.

Run from the FixList repository root:

```sh
scan/venv-python scan/reconstruct.py /path/to/room.mp4 --name living-room
```

The default preset uses `--features auto`: tuned CPU SIFT first, then ALIKED keypoints + LightGlue matches if SIFT misses the 30-frame/60% gate. Video budgets adapt to duration: `min(300, max(150, ceil(seconds × 2.5)))`, so a 100-second walkthrough gets 250 windows; photos and pose imports default to 150. Blur filtering may select fewer frames. Exhaustive SIFT recovery remains bounded to **at most 150 selected frames**. Other defaults are a 1600-pixel image limit, 1200-pixel training limit, 7000 steps, SH degree 0, and a 1,500,000-Gaussian cap. To override the frame budget, mode or training length:

```sh
scan/venv-python scan/reconstruct.py /path/to/room.mp4 \
  --name living-room-quick --max-frames 150 --steps 7000
scan/venv-python scan/reconstruct.py /path/to/ordered-photos \
  --name living-room-photos --max-frames 150
```

`--features sift` forces SIFT; `--features aliked` bypasses SIFT. `--sift-max-features` (default 8192) controls the SIFT keypoint budget; the old numeric `--features 4096` syntax is replaced by these two flags. Existing pre-mode runs can still resume training with their original default options and retain their original configuration record.

Photo directories are read nonrecursively in natural filename order (`frame2` before `frame10`). Use one fixed camera/lens and consistent image dimensions. JPEG, PNG, TIFF, WebP and BMP are supported; convert HEIC to JPEG locally first. Video autorotation and image EXIF orientation are applied before pose estimation. Input URLs are not accepted.

## Local photo review and evaluation

[`SUGGESTIONS.md`](SUGGESTIONS.md) documents the local photo-review step, current
`suggestions.json` v2 contract, optional adopted calibration, and the grouped
held-out evaluation protocol. `scan/evaluate_model.py` provides `score`, `report`
and `fit` commands using the same local review requests; it does not fine-tune
a model or start a server. Raw model scores remain uncalibrated unless the
output has a non-null calibration block. Existing real scans are preserved by
the synthetic test suite.

## Prerequisites and exact setup

Parent-supplied hardware: Apple M5 Pro, 48 GB unified memory. macOS 26.5.2 was verified; this worker's CPU-identification `sysctl` query was denied. No CUDA and no COLMAP CLI. COLMAP pose estimation is CPU-only. The learned worker selects MPS when available, otherwise CPU (observed here). Brush needs Metal access in the process running it. Internet is needed only to acquire tools/test data initially; reconstruction has no download step.

The parent prepared the following tools before this worker started. No installation was performed by this worker:

- `~/.local/share/fixlist-scan/venv/bin/python`: Python 3.13.13, pycolmap 4.2.1, NumPy 2.5.4, Pillow 13.0.0; learned packages torch 2.14.1, torchvision 0.29.1, kornia 0.8.3, LightGlue package metadata 0.0 (versions inspected).
- `~/.local/share/fixlist-scan/brush/brush-app-aarch64-apple-darwin/brush_app`: `brush-cli 0.3.0` (inspected with `--version`). Parent reports the release archive SHA-256 was verified and quarantine removed.
- `~/.homebrew/bin/ffmpeg` and `ffprobe`: ffmpeg 9.0.1. Existing Homebrew installation; no new brew install here.

The venv was originally created with `uv venv --python 3.13` and populated with `uv pip install pycolmap==4.2.1 numpy pillow`, targeting the path above. To recreate the observed dependency versions using an already available `uv`:

```sh
mkdir -p "$HOME/.local/share/fixlist-scan"
uv venv --python 3.13 "$HOME/.local/share/fixlist-scan/venv"
uv pip install --python "$HOME/.local/share/fixlist-scan/venv/bin/python" \
  -r scan/requirements.txt
```

ALIKED/LightGlue were already installed by the parent into the **same venv**. For a fresh authorized setup, use the upstream [LightGlue package](https://github.com/cvg/LightGlue):

```sh
uv pip install --python "$HOME/.local/share/fixlist-scan/venv/bin/python" \
  torch torchvision kornia "git+https://github.com/cvg/LightGlue.git"
# One-time weight acquisition, in a torch-only process with network access:
scan/venv-python -c 'import sys; sys.modules["pycolmap"]=None; from lightglue import ALIKED, LightGlue; ALIKED(max_num_keypoints=2048); LightGlue(features="aliked")'
```

Weights must already be cached under `~/.cache/torch/hub/checkpoints` (`aliked-n16.pth`, `aliked_lightglue_v0-1_arxiv.pth`), or the corresponding `TORCH_HOME` cache. Reconstruction explicitly checks for them and fails rather than downloading. No install or weight acquisition was performed by this worker. These setup lines are acquisition instructions, not a fully pinned recreation of torch/LightGlue.

**OpenMP constraint:** importing pycolmap and torch together crashes this environment with duplicate `libomp.dylib` runtimes. `learned_match.py` is a separate Python process that never loads pycolmap. LightGlue eagerly imports an optional SIFT adapter, so that child also marks the optional `pycolmap` module unavailable before importing LightGlue. The main process imports only numeric NPZ arrays into the COLMAP database, then performs geometric verification and mapping. Do not use `KMP_DUPLICATE_LIB_OK` to hide this failure. MPS uses PyTorch's CPU fallback for unsupported ALIKED operations; MPS behavior was not exercised in this sandbox.

Brush is the prebuilt Apple Silicon release, not a source build. These are the repeatable acquisition commands for a fresh setup with network access; the worker did not re-run them:

```sh
mkdir -p "$HOME/.local/share/fixlist-scan/brush"
cd "$HOME/.local/share/fixlist-scan/brush"
curl -fL -O https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-aarch64-apple-darwin.tar.xz
curl -fL -O https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-aarch64-apple-darwin.tar.xz.sha256
shasum -a 256 -c brush-app-aarch64-apple-darwin.tar.xz.sha256
tar -xJf brush-app-aarch64-apple-darwin.tar.xz
xattr -dr com.apple.quarantine brush-app-aarch64-apple-darwin
./brush-app-aarch64-apple-darwin/brush_app --version
```

Return to the repository root before the run commands. If your paths differ, set `FIXLIST_SCAN_PYTHON`, `FIXLIST_FFMPEG`, `FIXLIST_FFPROBE`, and/or `FIXLIST_BRUSH` to the existing executable paths. The launcher does not activate or modify shell environments and does not install anything. Learned runtime validation also needs the parent-prepared torch/LightGlue packages below; PLY conversion needs only NumPy/Pillow.

## Capture guidance for families

Capture 60–120 seconds in landscape. Walk slowly around the room's edge while aiming across the room; do a second overlapping loop at a different height. Keep nearby and far objects in view so the camera observes parallax. Spinning in place gives no depth. Keep the phone upright with a fixed lens/zoom; lock exposure where available. Use even lighting, move slowly to avoid blur, and keep consecutive views overlapping.

For white walls, keep furniture, door frames and floor edges in view; do not film blank walls straight on. Aim obliquely across textured objects and maintain overlap through doorways. Learned matching cannot invent texture, parallax or unseen surfaces. An ARKit pose export can avoid visual pose-estimation failure, but does not prove scene quality. Avoid mirrors, bright windows, changing light, moving people/pets and reflective surfaces. Keep private items, documents, screens, faces, addresses and identifying photos out of frame. Only scan with household permission. Review the source video and resulting scene before sharing either. Unseen/occluded areas remain unknown even if the reconstruction looks complete.

## Pipeline and failure handling

1. ffmpeg samples at most three candidates per desired frame (limited by the video's native frame rate), autorotates, and scales the long side to at most 1600. Images are sampled over the entire ordered sequence. Pillow/NumPy compute a Laplacian-variance score at a consistent thumbnail size. Each temporal window contributes its sharpest candidate, with stable ties; windows below `max(2, 20% of median sharpness)` are dropped. Scores/selection remain in `work/frame-selection.json`.
2. pycolmap 4.2.1 extracts CPU SIFT with a shared `SIMPLE_RADIAL` camera, up to 8192 features, peak threshold 0.003, affine-shape estimation, and domain-size pooling with three scales to bound CPU cost. Sequential matching uses overlap 12 plus quadratic overlap, without a downloaded vocabulary. For at most 150 selected images, exhaustive matching/remapping runs once if sequential registration is below a 95% coverage target (or below 30 images). The required acceptance gate remains 30 images and 60%; this extra bounded attempt preserves short-room coverage when SIFT passes the gate with an incomplete component. `auto` then falls back to an isolated ALIKED + LightGlue process if SIFT still fails. The learned budget is at most 1024 pixels on the long side and 2048 keypoints; four CPU threads maximum. Pairs combine 12 sequential neighbours with sparse loop keyframes (stride at least 12, at most about 32 keyframes), avoiding exhaustive learned matching. All matches undergo COLMAP geometric verification before mapping. Both attempts and their registered frames/errors/point counts are retained in `metrics.featureAttempts`; the largest model wins, with SIFT retaining a tie. ALIKED exchange arrays and a `learned.log` remain local.
3. The run requires **at least 30 registered frames and at least 60% registration**, and logs mean sparse-point reprojection error in pixels. A failure says, for example, `Only 23/180 frames registered — need at least 30 and 60%` and explains overlap, lighting, translation and texture. Recapture with more overlap/parallax; for a long sequence, try a new run with `--max-frames 150` to enable bounded exhaustive recovery. Registration passing is not proof of accurate or complete geometry.
4. pycolmap undistorts to a clean COLMAP `images/` + `sparse/` dataset with `PINHOLE`/`SIMPLE_PINHOLE` cameras. Brush accepts COLMAP and nerfstudio, but does not undistort this pipeline's radial observations itself. The training input contains only this run's chosen model and matching undistorted images. The explicit pose-import path instead preserves supplied poses; it never silently reuses old training exports. Brush runs headlessly without `--with-viewer`; `--export-every <steps> --export-path <private path> --export-name final.ply` selects the final PLY. SH degree 0 avoids training higher-order color coefficients that the `.splat` output discards; visual equivalence to degree 3 has not been established.
5. Alignment (before training) estimates up from the registered cameras' negative world-space camera Y axes, rejects strongly disagreeing directions, aligns up to +Y with a proper rotation, recenters on the coordinatewise median sparse point, and applies that same transform to positions and Gaussian rotations. For pose imports, the supplied +Y world is preserved with identity rotation and recentering on the median camera trajectory; no floor or sparse structure is inferred. No scale normalization is applied. Near-transparent splats (sigmoid opacity below 0.02 by default) are removed; the remaining splats are sorted by scale-volume × opacity and capped at 1.5M. `--min-opacity` and `--max-splats` are configurable.
6. Exact output bytes are decoded for numerical checks. `work/alignment.json` records camera centers/up axes, rotation determinant, robust/full bounds, positive scales, quaternion norms and SHA-256. A 5th–95th-percentile camera-height band / horizontal-span ratio below 0.5 is a useful single-level capture sanity check; other captures warn for human inspection. This heuristic does not establish a measured floor plane.

Other errors:

- Fewer than 30 sharp frames: use a longer, slower, brighter capture. Do not fill the sequence with duplicate frames.
- Mixed photo dimensions/orientations: use a fixed camera/lens and consistent landscape framing.
- Inconsistent camera up directions: keep the phone upright throughout; don't rotate between portrait and landscape.
- Brush error/no `final.ply`: inspect `brush.log` for Metal/device, memory or export failures. A sandbox without Metal device access cannot train this scene; run the same local command in an authorized session with Metal access. The script does not change access or retry through another runtime.
- Nonfinite positions/scales or malformed PLY: the run fails; inspect training before lowering pruning thresholds.
- Existing output name: choose a new name. Runs never delete or silently overwrite previous media/work.

For a diagnostic run through poses **and the undistorted training dataset**, without attempting training:

```sh
scan/venv-python scan/reconstruct.py /path/to/room.mp4 \
  --name pose-check --max-frames 150 --stop-after poses
# Continue only if the preceding stages completed; keep the same settings:
scan/venv-python scan/reconstruct.py /path/to/room.mp4 \
  --name pose-check --max-frames 150 --resume
```

`--stop-after frames` is also available. Resume reuses completed stages with identical input/options. It refuses interrupted/failed stages and preserves their artifacts: choose a new output name for a restart. The explicit exception is `--resume --retry-training`: this archives a failed training directory as `work/training-attempt-N`, retains its stage record in `previousTrainingAttempts` and tool log, and retries training/postprocessing while reusing completed poses and undistortion. It never overwrites an existing final scene. Use this only after addressing the reported environment problem in an authorized runtime; it does not grant access. Do not edit source media between a partial run and resume.

## ARKit / nerfstudio pose import

```sh
scan/venv-python scan/reconstruct.py /path/to/arkit-export \
  --name arkit-room --stop-after poses
# Same options, then train in an authorized Metal-capable session:
scan/venv-python scan/reconstruct.py /path/to/arkit-export \
  --name arkit-room --resume
```

The directory must contain `transforms.json` plus at least 30 images, with [nerfstudio-format](https://docs.nerf.studio/quickstart/data_conventions.html) `frames[].file_path` and rigid 4×4 OpenGL camera-to-world `transform_matrix` values. Camera axes are +X right, +Y up, −Z forward. **World must already be +Y up from ARKit gravity**. Nerfstudio's usual world convention is +Z up; a generic z-up export needs explicit conversion before this command. The importer never guesses gravity or applies a world-axis rotation.

Provide finite `w`, `h`, `fl_x`, `fl_y`, `cx`, `cy` globally or for every frame of an overridden field. The default camera model is `OPENCV`; `PINHOLE` is accepted. OPENCV supports `k1/k2/p1/p2` and is undistorted by pycolmap; fisheye and nonzero `k3/k4` require rectified export. Image dimensions and orientation must match calibration, with EXIF orientation 1. Masks, depth and per-frame camera-model switches are rejected rather than silently dropped. Duplicate JSON keys, missing/repeated images, nonfinite/nonrigid/reflected matrices, invalid intrinsics, absolute paths, whitespace paths, traversal and escaping symlinks fail validation. Files must be inside the export directory; validation does not upload anything. The 150-frame default/`--max-frames` override subsamples the posed sequence evenly, with intrinsics scaled to the prepared image size.

This path skips feature extraction, matching and COLMAP pose estimation. It writes a minimal **real COLMAP-format** model at `work/sparse`, including camera intrinsics and registered poses but **zero triangulated points/tracks**. The same undistortion step writes `work/dataset`; `alignment.json`, Brush invocation, postprocessing and `scene.*` schema are shared. Reprojection error is `null` and explicitly unmeasured. `scene.json` retains the shared schema and pipeline identifier; `run.json` records the actual `featureMode: imported` path and the absence of SfM/tracks. `sparseCenterOriginal` is the median camera center when no sparse points exist. Brush 0.3.0's [COLMAP loader](https://github.com/ArthurBrussee/brush/blob/v0.3.0/crates/brush-dataset/src/formats/colmap.rs) accepts an empty point cloud and its [training code](https://github.com/ArthurBrussee/brush/blob/v0.3.0/crates/brush-process/src/train_stream.rs) uses random initialization around camera bounds; that training behavior remains unvalidated on real ARKit capture here. Downstream tools requiring triangulated sparse evidence must handle the empty point cloud as unknown, not fabricated geometry.

The import was exercised with **146 synthetic transforms generated from the existing playroom PINHOLE model**, after applying that model's existing y-up alignment and converting camera axes. No real ARKit capture was available. Artifacts: `private-captures/test-datasets/arkit-synthetic-playroom/transforms.json` and `private-captures/scans/playroom-import-v2/`. All 146 poses survived conversion; alignment rotation is exactly identity; import took 8.799 s, alignment 0.005 s and PINHOLE dataset preparation 4.198 s in the concurrent CPU session. No training or final scene from this import is claimed. Unit tests also execute import/undistortion against generated calibrated images and compare camera centers, scaled intrinsics and identity alignment.

## Output contract

All output is below `private-captures/scans/<name>/`:

- `scene.splat`: browser interchange, exactly 32 bytes per Gaussian.
- `scene.json`: versioned metadata; no source photographs or original media paths in this file.
- `run.json`, `run.log`: stage wall times, settings, registration, reprojection error, counts, byte sizes and diagnostics. Source paths occur here; these are private too.
- `ffmpeg.log`, `colmap.log`, `learned.log`, `brush.log`: tool output when the respective path runs.
- `work/sparse`: the chosen original COLMAP-format model (including imported poses).
- `work/dataset/{images,sparse}`: undistorted PINHOLE training images and the corresponding model.
- `work/alignment.json`: `rotationWorldToAligned` (3×3) and `sparseCenterOriginal`; aligned points satisfy `R · (x − center)`. Pose import uses identity R. Scene outputs use exactly this transform.
- `work/`: candidates, selected images, COLMAP databases/models, undistorted training dataset, original `training/final.ply`, cache, frame scores and alignment diagnostics. After a successful run, `work/` can be removed manually if you no longer need reproducibility or a retraining source; the pipeline never removes it automatically.

The `.splat` layout follows the [antimatter15 implementation](https://github.com/antimatter15/splat/blob/main/main.js):

| Byte offset | Encoding | Value |
| --- | --- | --- |
| 0 | 3 × little-endian float32 | aligned position x,y,z |
| 12 | 3 × little-endian float32 | positive **linear** scales; exponentiate PLY log scales |
| 24 | 4 × uint8 | RGB = clamp(0.5 + 0.28209479177387814 × SH DC), opacity = sigmoid(logit), all rounded to 0–255 |
| 28 | 4 × uint8 | normalized quaternion **w,x,y,z**; clamp(round(128 + 128q), 0, 255) |

Quaternion decoding is `(byte - 128)/128` followed by renormalization, not `2*byte/255 - 1`. Quantization slightly changes the norm; both raw quantization error and normalized decoded norms are reported. Scene alignment uses `p' = R(p - center)` and `q' = q_R ⊗ q`; rotating centers alone would misorient anisotropic Gaussians. The proper rotation retains a right-handed frame; the viewer should use identity model orientation and world up +Y.

`scene.json` has exactly this shape (numbers below are illustrative):

```json
{
  "format": "fixlist-scan-metadata",
  "version": 1,
  "splatFile": "scene.splat",
  "splatCount": 100000,
  "coordinateSystem": "y-up-right-handed",
  "units": "arbitrary",
  "bounds": {"min": [-3, -2, -4], "max": [3, 2, 4]},
  "initialCamera": {"position": [0, 1, 3], "target": [0, 0, 0]},
  "source": {
    "inputFrames": 150,
    "registeredFrames": 140,
    "createdAt": "2026-10-18T00:00:00Z",
    "pipeline": "ffmpeg + pycolmap 4.2.1 + brush 0.3.0",
    "trainingSteps": 7000
  }
}
```

Bounds enclose the retained Gaussian **centers**, not every Gaussian's infinite support. Units are arbitrary; they are not meters. `inputFrames` is the selected sharp frame count, not all decoded video frames. The initial viewpoint is a registered camera looking along its transformed optical axis, chosen for an inward-facing view. Metadata validation rejects extra/missing fields, wrong versions/filenames, nonfinite/inverted bounds, invalid timestamps, and registration below the gate.

Brush format handling was checked against its [v0.3.0 COLMAP loader](https://github.com/ArthurBrussee/brush/blob/v0.3.0/crates/brush-dataset/src/formats/colmap.rs), [PLY export](https://github.com/ArthurBrussee/brush/blob/v0.3.0/crates/brush-serde/src/export.rs), installed help and actual execution. Higher-order PLY color is intentionally discarded by the DC-only interchange.

## Validation

Deterministic tests (stdlib `unittest`, using the existing NumPy/Pillow dependencies):

```sh
scan/venv-python -m unittest discover -s scan/tests -v
```

Tests cover temporal coverage/sharpness/blur rejection, independent byte-offset checks and round-trip decode, opacity pruning/count cap/importance order, little-endian and ASCII PLY properties, quaternion composition and anisotropic covariance, antiparallel up alignment, schema validation, registration boundaries, local input failures and preservation on resume/failure. Actual reconstruction evidence follows below; unit tests do not stand in for training or viewer inspection.

The expanded suite also covers adaptive budgets, bounded temporal/loop pairing, the 95% short-room recovery target, both auto-fallback branches and failure advice, actual pycolmap database import/geometric verification of a synthetic nonplanar pair, an isolated LightGlue import regression, strict transforms validation, and actual calibrated pose import/PINHOLE undistortion. Full discovery after integration ran **68 tests: 66 passed, two skipped** because this sandbox denies loopback socket binding; those two belong to the separate suggestion HTTP integration and need execution on the authorized local host. Log: `private-captures/scan-tests-v3.log`. This worker's scan reconstruction/import tests all executed and passed.

### Measured public-data run (October 17, 2026 EDT)

**End to end, the video path produced a browser-ready scene.** The implementation worker's sandbox had no Metal adapter (`no_adapter_backends: Backends(METAL)`), so training was completed afterwards from a normal terminal session on the same Mac with `--resume --retry-training`, reusing the worker's CPU stages. Brush trained 7000 steps (max side 1200, SH degree 0) in **589.4 s**; post-processing pruned **200,425 → 192,508** Gaussians in 0.5 s and wrote a **6,160,256-byte** `scene.splat` plus `scene.json`. Imported into the FixList viewer, the scene rendered upright from the metadata camera, and click-placed pins landed on the clicked surface. Total for this 45-second clip: about **17 minutes** (≈430 s CPU stages + 589 s training).

The parent-downloaded [3DGS evaluation archive](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/) was complete at exactly 682,628,995 bytes. Only `db/playroom/images/*` was extracted; the supplied COLMAP models were never extracted or reused. The 225 ordered JPEGs are 1264 × 832. A local validation video was created from all images at 5 fps (45 seconds):

```sh
unzip -q private-captures/test-datasets/tandt_db.zip 'db/playroom/images/*' \
  -d private-captures/test-datasets
"$HOME/.homebrew/bin/ffmpeg" -hide_banner -loglevel error -nostdin -n \
  -framerate 5 -pattern_type glob \
  -i 'private-captures/test-datasets/db/playroom/images/*.jpg' \
  -c:v libx264 -crf 18 -pix_fmt yuv420p private-captures/test-datasets/playroom.mp4
scan/venv-python scan/reconstruct.py private-captures/test-datasets/playroom.mp4 \
  --name playroom-video-150 --steps 7000 --max-frames 150
```

The video attempt selected **148/225** candidates, dropped two blurry windows, registered **146/148 (98.65%)**, and reconstructed **26,128 sparse points**, with mean reprojection error **0.597626 px**. Sequential matching initially registered 80/148, so the <=150 exhaustive fallback was exercised. Undistortion produced one shared **PINHOLE** camera. Run files: `private-captures/scans/playroom-video-150/run.json`, `run.log`, `colmap.log`, `brush.log` and `work/alignment.json`.

| Stage | Measured wall time |
| --- | ---: |
| Video decode, sharpness selection and selected JPEGs | 2.867 s |
| CPU SIFT extraction (8 threads) | 20.364 s |
| Initial sequential matching | 28.974 s |
| Mapping including exhaustive recovery matching/remapping | 375.802 s |
| PINHOLE undistortion | 1.475 s |
| Camera alignment check | 0.336 s |
| Brush training, 7000 steps on Metal (separate retry session) | 589.4 s |
| Post-processing (prune, align, encode .splat) | 0.5 s |
| Total | ≈1,020 s |

These measurements describe this Apple M5 Pro/48 GB run, not a latency guarantee. The independent photo run began late in the video's recovery phase, so some CPU work overlapped. The initial attempt at a 200-frame budget selected 195, registered only 111/195 (56.92%) and correctly failed at the 60% gate (0.404241 px mean reprojection error in its largest model). This motivated the earlier 150-frame preset; the new adaptive preset and learned recovery are evaluated separately below. The registration requirement is unchanged. The earliest failed attempt also exposed and fixed an ffmpeg boolean-flag syntax error before the reported runs.

Because training was blocked, the real-pose alignment check was executed separately afterward and marked `alignmentCheckAfterTrainingBlock` in the run log. Future full runs check alignment before training. It preserved scale, used a median sparse center and produced rotation determinant **1.000000**, camera-up positive fraction **91.10%**, and mean aligned camera-up Y **0.538967**. The 5th–95th-percentile camera-height band is **[0.575928, 5.054310]** arbitrary units, versus horizontal spans **[8.912474, 11.097420]**, giving ratio **0.314643**. This passes the documented <0.5 heuristic, but the camera axes vary substantially; floor orientation and visual uprightness still need human review. After training, the baked scene was inspected in the FixList viewer and rendered upright.

The independent image-directory path is run with:

```sh
scan/venv-python scan/reconstruct.py private-captures/test-datasets/db/playroom/images \
  --name playroom-images-150 --steps 7000 --max-frames 150 --stop-after poses
```

The photo path selected **148/225** candidates, independently registered **146/148 (98.65%)**, and reconstructed **28,157 sparse points**, with mean reprojection error **0.572589 px**. It initially registered 78/148 and also exercised exhaustive recovery. Its measured stage times were frame preparation **15.180 s**, CPU SIFT **62.136 s**, sequential matching **65.640 s**, mapping/recovery **431.541 s**, and alignment **0.215 s**: **574.712 s** total through poses/alignment. These timings include concurrent CPU work and are not directly comparable to an isolated run. The initial process stopped after poses; a subsequent `--resume --stop-after poses` reused all completed CPU stages and ran the newly added pre-training alignment check. It reported determinant 1.0 and camera-height ratio **0.316**. This path completed its requested pose-only validation and did not attempt training. Its `run.json` remains `partial` because no scene was requested. It uses an independent database and mapping, not the video's poses.

The original deterministic suite passed **21 tests** before this extension; updated tests and pose comparisons are recorded below. A synthetic-PLY integration test also exercised the complete converter to an exact 32-byte scene plus matching metadata in an automatically cleaned temporary test directory. It does not count as a trained benchmark scene. The shell launcher passed `sh -n scan/venv-python`.

### White-wall walkthrough and feature-mode validation (October 17, 2026 EDT)

The parent supplied `private-captures/test-datasets/viennese-walk.mp4`: a 100-second continuous 1080p photoreal apartment walkthrough with many white walls. Parent-supplied provenance: UE4Arch “Viennese apartment,” Wikimedia Commons, CC BY-SA 4.0, segment 58–158 seconds. This is rendered public test imagery, not a real family capture or an ARKit recording.

```sh
scan/venv-python scan/reconstruct.py private-captures/test-datasets/viennese-walk.mp4 \
  --name viennese-v2 --stop-after poses
scan/venv-python scan/reconstruct.py private-captures/test-datasets/playroom.mp4 \
  --name playroom-sift-v3 --stop-after poses
scan/venv-python scan/reconstruct.py private-captures/test-datasets/playroom.mp4 \
  --name playroom-aliked-v2 --features aliked --max-frames 90 --stop-after poses
```

The parent ran the original `viennese-baseline` before these edits. The improved walkthrough selected 247/750 candidates under the adaptive 250-frame budget, versus baseline 148/450 under its fixed 150-frame budget. The improved mode was **SIFT**; no exhaustive or learned fallback was needed on that >150-frame sequence.

| Walkthrough run | Registered / selected | Registration | Sparse points | Mean reprojection error | Winning mode |
| --- | ---: | ---: | ---: | ---: | --- |
| `viennese-baseline` | 134 / 148 | 90.54% | 9,737 | 0.632225 px | original SIFT + exhaustive recovery |
| `viennese-v2` | 225 / 247 | 91.09% | 27,532 | 0.743161 px | tuned SIFT, sequential |

| Stage | Baseline | Improved |
| --- | ---: | ---: |
| Frame preparation | 28.509 s | 33.006 s |
| SIFT extraction | 54.974 s | 211.047 s |
| Sequential matching | 5.011 s | 54.422 s |
| Mapping (includes recovery where used) | 66.209 s | 101.253 s |
| Alignment | 0.028 s | 0.118 s |
| PINHOLE dataset preparation | excluded from original pose-only run | 3.722 s |
| Through poses/alignment | 154.731 s | 399.846 s |
| Through prepared training dataset | — | 403.568 s |

The improved run supplies 91 more registered views and more sparse points, at higher CPU cost and a higher mean residual. Sampling and features both changed, so this is a pipeline comparison, not an isolated feature ablation. More points/views and a passing registration gate do not establish physical accuracy, complete wall surfaces or reliable dimensions. Several CPU runs and parent work overlapped; these are observed stage times, not isolated benchmarks or latency claims. The chosen reconstruction and undistorted PINHOLE dataset are ready for the parent's separate Metal training/visual review; this worker did not train them.

A first tuned playroom trial (`playroom-sift-v2`) exposed a coverage regression: 106/148 (71.62%) registered, 14,522 points, 0.473591 px. It passed the 60% gate, so the original recovery condition stopped early, whereas the old 146/148 run had needed exhaustive recovery. This motivated the bounded 95% coverage target for <=150-frame exhaustive recovery, without changing the acceptance gate or enabling exhaustive work on walkthroughs. That trial is preserved; it is not presented as the no-regression result.

The revised playroom run `playroom-sift-v3` recovered **145/148 frames (97.97%)**, **41,747 points**, and **0.711821 px** mean reprojection error. Its sequential component had 104/148; the bounded exhaustive attempt took 571.319 s within mapping. Compared with the original 146/148, 26,128 points and 0.597626 px, this is one fewer registered frame, more points and a higher residual. **The strict no-regression acceptance criterion is not met.** The parent must judge this coverage/residual/cost tradeoff before accepting the change; no equivalence margin was defined beforehand, so this report does not invent one after seeing the result.

| Playroom stage | Original `playroom-video-150` | Revised `playroom-sift-v3` |
| --- | ---: | ---: |
| Frame preparation | 2.867 s | 8.842 s |
| SIFT extraction | 20.364 s | 152.719 s |
| Sequential matching | 28.974 s | 72.654 s |
| Mapping including exhaustive recovery | 375.802 s | 593.851 s |
| Alignment | 0.336 s | 0.127 s |
| PINHOLE dataset preparation | 1.475 s | 2.712 s |
| Total through prepared dataset | 429.818 s | 830.905 s |

Final artifact verification read `work/sparse` and `work/dataset/sparse` for the walkthrough, revised playroom, learned playroom and synthetic pose import. All chosen registered images survived dataset preparation, camera centers matched exactly, every training image's dimensions matched its camera, all dataset cameras were PINHOLE, and every alignment was a proper rotation. Machine-readable stage/pose/contract evidence, test summary and unmet acceptance criterion: `private-captures/scan-v2-validation.json`. The separate suggestion loader handles the pose import's empty observed point arrays as unplaced/unknown; no sparse evidence was fabricated.

The explicit learned run `playroom-aliked-v2` completed on CPU: **64/90 registered (71.11%)**, **8,923 sparse points**, mean reprojection error **0.871651 px**. The worker used a 1024-pixel long side, at most 2048 keypoints, and four CPU threads. It processed **1,030 pairs** (versus 4,005 exhaustive pairs), produced 69,910 raw matches across 1,029 nonempty pairs, then imported them through `Database.write_keypoints` / `write_matches`, ran `verify_matches`, and successfully mapped the resulting database. The chosen model, y-up alignment and PINHOLE training dataset were written; training was not attempted.

| Learned stage | Measured wall time |
| --- | ---: |
| Frame preparation | 16.862 s |
| Isolated extraction + matching subprocess | 1,284.243 s |
| ALIKED extraction within that subprocess | 337.001 s |
| LightGlue matching within that subprocess | 935.221 s |
| Numeric array import into COLMAP database | 3.019 s |
| Geometric verification | 21.697 s |
| Incremental mapping | 28.576 s |
| Alignment | 0.043 s |
| PINHOLE dataset preparation | 0.615 s |
| Total through prepared dataset | 1,355.055 s |

The subprocess's extraction/matching rows are components of the subprocess time, not additional stages to add again. This learned test uses a different 90-frame sample and was concurrent with SIFT work; it demonstrates the isolated feature-to-database-to-model path, not superior coverage, accuracy or speed. The observed CPU cost is substantial (~22.6 minutes here), which is why `auto` keeps passing SIFT results. No MPS timing or real white-wall family study is claimed. Auto fallback selection and both-fail behavior were exercised in deterministic orchestration tests; the walkthrough itself selected SIFT and therefore did not trigger learned fallback.

The first isolated learned attempt (`playroom-aliked-90`) failed at import because LightGlue eagerly imported its optional SIFT adapter and therefore pycolmap. Its `learned.log` preserves the OpenMP abort. The corrected child suppresses only that optional dependency, and a real subprocess regression test verifies pycolmap remains unloaded. No unsafe OpenMP override was used.

### Resuming after a training failure

If training fails (for example, a process without Metal access), rerun the same command with `--resume --retry-training`. Completed extraction, poses, alignment and undistortion are reused and the failed attempt is archived:

```sh
scan/venv-python scan/reconstruct.py private-captures/test-datasets/playroom.mp4 \
  --name playroom-video-150 --steps 7000 --max-frames 150 --resume --retry-training
```

## Privacy and assistance

Reconstruction and training are local. Nothing in this pipeline uploads media, calls a hosted reconstruction service, creates an account, or sends a message. `private-captures/` is gitignored and no scan is copied into `public/` or another tracked path. Gitignore is an accidental-commit guard, not encryption or access control. Anyone with filesystem access can read local videos/scans/logs; opening or sharing them elsewhere has that tool's separate privacy boundary. Do not force-add these outputs to Git. Import `scene.splat` and `scene.json` together in the app's 3D room scan panel.

This pipeline and tests were AI-assisted implementation by a delegated worker. Public benchmark validation is not a family capture study, student-authorship finding, geometric measurement, hazard-validation study, or visual acceptance of the integrated viewer. The parent owns final integration and acceptance. No commits, publications, external sends, app/package edits or new tool installations were performed by this worker.

## Content validation and native packaging repair (2026-10-18)

Current resume requires versioned content identities in `run.json`. The runner
hashes input photos/transforms or video bytes, pipeline scripts/requirements,
configured ffmpeg/ffprobe/Brush executables and learned weight files when relevant.
It hashes completed work and final scene outputs (excluding logs/cache and
explicitly archived failed-training attempts). Changed or missing bytes, added
work artifacts, changed model/tool/code, or completed legacy stages without
hashes block reuse with a new-name recovery message. Paths and mtimes alone are
insufficient. Nothing stale is silently rerun over the old artifacts. Explicit
failed-training recovery still archives only the unusable training directory;
changed completed inputs/outputs require a new run. Historical resume timings
above describe the earlier implementation and do not override this gate.

`node scripts/ios-demo-scan.mjs <name> [...]` now validates all names, source
ancestors/files, byte bounds, raw splat positions/scales/quaternions, metadata,
suggestions, duplicate names and the complete index using the app's validators.
All inputs must pass containment before any is read. Actual reads use directory
file descriptors and `O_NOFOLLOW` for every component (`read_local_artifact.py`),
so replacing a checked parent with a symlink cannot redirect a read outside the
source root. No bytes go into Vite's public/ or dist/ trees.

Packaging writes a complete temporary bundle beside the destination. Existing
bundles are replaced using native **atomic directory exchange**
(`atomic_directory.py`: macOS `renamex_np` with `RENAME_SWAP`, or Linux
`renameat2` with `RENAME_EXCHANGE`). Unsupported platforms/filesystems fail
without a destructive fallback. The previous bundle survives validation, staging
and replacement errors; after a successful exchange it becomes the temporary
old directory and is cleaned up. A process interrupted after exchange leaves a
complete old or new destination and may leave ignored staging residue. This
uses the already provisioned `scan/venv-python`; no new dependency is installed.
The Vite instance used by packaging transforms TS/JSON in middleware mode only;
it opens no network listener.

New suggestions bind to the exact scene and source frame hashes, coordinate
convention and processing provenance. Older unbound private suggestions are
**not** modified or packaged automatically: regenerate them with the local
producer, or package/import the scene without the old suggestions file. See
[the contract](../docs/suggestions-v2-contract.md). No existing private scan or
model result was regenerated by this repair.

App imports preflight 32-byte raw record counts and bounded scalar-vertex PLY
headers before Spark decoding. Limits are now **64 MiB input and 1,500,000
splats**; compressed SPZ/KSPLAT and PLY variants without a supported bound are
rejected before decompression. These are conservative engineering limits,
**not a measured phone memory budget**. Restored scans must also go through
`validateScanDocumentAsync` before display; the storage owner must wire that
entry point. Phone peak-memory, interruption and native Simulator verification
remain separate work. Reset wording must distinguish deleting imported device
stores from immutable scans still embedded in an installed demo app.

## Post-hoc binding of an existing local run

A legacy suggestions file can be associated with its own completed run without
rerunning the model, if the surviving local evidence passes all checks:

```sh
scan/venv-python scan/bind_scene_identity.py private-captures/scans/RUN_NAME
# Only after reviewing the checks, an operator may choose to write:
scan/venv-python scan/bind_scene_identity.py private-captures/scans/RUN_NAME --write
```

The default is a read-only JSON report of every check, the exact proposed scene
and ordered frame hashes, and whether binding would succeed. The tool requires
completed run status, valid unbound legacy v1/v2 suggestions, a decoded valid
scene and matching count/coordinate metadata. Every keyframe, best-frame and
per-frame reference must exist in `work/dataset/images/`; all ancestors and
files are opened using anchored descriptors without following symlinks. The
scene and every referenced source frame must have mtime <= inference `createdAt`.
A failure refuses binding; missing suggestions are not reconstructed or invented.

`--write` rechecks inspected source bytes/metadata, exclusively creates
`suggestions.unbound-<UTC timestamp>.json.bak` containing the original exact
bytes, fsyncs a temporary result and atomically replaces `suggestions.json`.
An existing backup is never overwritten. Failed replacement retains the original
and backup. The processing label explicitly says **post-hoc**, and model identity
is null: current scene/frame/alignment/run/script hashes do not attest historical
model weights or inference-time bytes. Mtime can be preserved or edited, so this
is weaker local association evidence, not authenticated history, new inference,
geometry validation or a safety finding. Original scores/calibration remain
historical. The detailed contract in SUGGESTIONS.md distinguishes these limits.

## Stage before Capacitor sync

The workflow now validates and durably stages the bundle before build/native sync:

```json
"ios:sync": "npm run build && cap sync ios",
"ios:demo:stage": "node scripts/ios-demo-scan.mjs --stage ios/DerivedData/fixlist-demo-scan-stage viennese-v2",
"ios:demo:install": "node scripts/ios-demo-scan.mjs --install-staged ios/DerivedData/fixlist-demo-scan-stage",
"ios:demo": "npm run ios:demo:stage && npm run ios:sync && npm run ios:demo:install"
```

Stages live only beneath the existing ignored `ios/DerivedData/` cache, outside
`ios/App/App/public/`, public/ and dist/. Invalid input preserves any previous
known stage and native scan bundle, and short-circuits before build/cap sync.
Staging does not require an existing native web-assets directory. A stage
contains the complete app-readable bundle plus a manifest of every file's bytes
and SHA-256; installation rechecks hashes, structure, metadata, suggestions,
index and exact file membership, then atomically installs the verified snapshot.
Original captures are not reread after sync. Unrelated directories occupying a
stage path are never replaced. A valid stage is retained for explicit retry;
there is no automatic destructive cache cleanup.

**Capacitor sync remains non-atomic.** It removes/replaces the entire native web
asset directory itself. A build/sync failure can leave an incomplete native web
tree; an interruption after sync but before staged installation can leave the
app without its scan bundle. The validated private stage survives and can be
installed after a successful sync with `npm run ios:demo:install`. The scan install
is atomic, but the complete build/sync/install operation is not a transaction.
This worker did not run cap sync or modify the owner's native app assets.

## Rescore/refit a byte-pinned calibration

Keep the historical unpinned `scan/calibration.json` unchanged. Prepare a **fresh
private dataset directory** containing the intended original `images/`, grouped
`manifest.jsonl` and actual `labels.jsonl`; do not transplant old `scores.jsonl`
into it. Set these operator inputs to real local values before running:

```sh
FIXLIST_PINNED_DATASET=private-captures/evaluation/pinned-rescore
: "${FIXLIST_MODEL_DIR:?Set to the exact local model directory used by the server}"
: "${FIXLIST_RUNTIME_DIR:?Set to the ordinary installed serving-code directory used by the server}"
: "${FIXLIST_LABEL_SOURCE:?Describe the actual annotator and labeling protocol}"
scan/venv-python scan/evaluate_model.py score --dataset "$FIXLIST_PINNED_DATASET" --url http://127.0.0.1:8090 --think-mode never --model-dir "$FIXLIST_MODEL_DIR" --runtime-dir "$FIXLIST_RUNTIME_DIR"
scan/venv-python scan/evaluate_model.py fit --dataset "$FIXLIST_PINNED_DATASET" --labels "$FIXLIST_PINNED_DATASET/labels.jsonl" --out "$FIXLIST_PINNED_DATASET/calibration.pinned.json" --seed 7 --label-source "$FIXLIST_LABEL_SOURCE"
scan/venv-python scan/suggest.py RUN_NAME --calibration "$FIXLIST_PINNED_DATASET/calibration.pinned.json" --think-mode never --model-dir "$FIXLIST_MODEL_DIR" --runtime-dir "$FIXLIST_RUNTIME_DIR"
```

The existing loopback model server must already be running with those exact
configured directories. The fit must pass adoption; identity or request
mismatches still fail closed. These commands record configured local bytes,
not independent server attestation or real-home validation. No command above
was executed against a model by this worker. Explicit raw experiments can use:

```sh
scan/venv-python scan/suggest.py RUN_NAME --no-calibration
```

That writes `calibration: null`; the app labels it an experimental uncalibrated
model score, never a calibrated probability. Post-hoc scene binding does not
create or authorize a new calibrated inference run.
