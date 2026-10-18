# Local room scans

This command turns a local phone video or an ordered image directory into a Gaussian-splat scene for FixList. CPU pycolmap estimates new poses; Brush trains locally on Metal. The scan is an approximate visual record with arbitrary units. It does not measure distances, detect hazards, assess completeness, or certify a room as safe.

Run from the FixList repository root:

```sh
scan/venv-python scan/reconstruct.py /path/to/room.mp4 --name living-room
```

The default quick preset uses at most 150 selected frames, a 1600-pixel extraction limit, 1200-pixel training limit, 7000 steps, SH degree 0, and a 1,500,000-Gaussian cap. The 150-frame default keeps exhaustive recovery bounded on this CPU setup. You can request 200–250 frames for a longer well-overlapped video, but exhaustive recovery is then disabled. To set the frame budget or training length explicitly:

```sh
scan/venv-python scan/reconstruct.py /path/to/room.mp4 \
  --name living-room-quick --max-frames 150 --steps 7000
scan/venv-python scan/reconstruct.py /path/to/ordered-photos \
  --name living-room-photos --max-frames 150
```

Photo directories are read nonrecursively in natural filename order (`frame2` before `frame10`). Use one fixed camera/lens and consistent image dimensions. JPEG, PNG, TIFF, WebP and BMP are supported; convert HEIC to JPEG locally first. Video autorotation and image EXIF orientation are applied before pose estimation. Input URLs are not accepted.

## Prerequisites and exact setup

Parent-supplied hardware: Apple M5 Pro, 48 GB unified memory. macOS 26.5.2 was verified; this worker's CPU-identification `sysctl` query was denied. No CUDA and no COLMAP CLI. Pose estimation is CPU-only. Brush needs Metal access in the process running it. Internet is needed only to acquire tools/test data initially; reconstruction has no download step.

The parent prepared the following tools before this worker started. No installation was performed by this worker:

- `~/.local/share/fixlist-scan/venv/bin/python`: Python 3.13.13, pycolmap 4.2.1, NumPy 2.5.4, Pillow 13.0.0 (versions inspected).
- `~/.local/share/fixlist-scan/brush/brush-app-aarch64-apple-darwin/brush_app`: `brush-cli 0.3.0` (inspected with `--version`). Parent reports the release archive SHA-256 was verified and quarantine removed.
- `~/.homebrew/bin/ffmpeg` and `ffprobe`: ffmpeg 9.0.1. Existing Homebrew installation; no new brew install here.

The venv was originally created with `uv venv --python 3.13` and populated with `uv pip install pycolmap==4.2.1 numpy pillow`, targeting the path above. To recreate the observed dependency versions using an already available `uv`:

```sh
mkdir -p "$HOME/.local/share/fixlist-scan"
uv venv --python 3.13 "$HOME/.local/share/fixlist-scan/venv"
uv pip install --python "$HOME/.local/share/fixlist-scan/venv/bin/python" \
  -r scan/requirements.txt
```

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

Return to the repository root before the run commands. If your paths differ, set `FIXLIST_SCAN_PYTHON`, `FIXLIST_FFMPEG`, `FIXLIST_FFPROBE`, and/or `FIXLIST_BRUSH` to the existing executable paths. The launcher does not activate or modify shell environments and does not install anything. No additional Python dependencies are needed for tests or PLY conversion.

## Capture guidance for families

Capture 60–120 seconds in landscape. Walk slowly around the room's edge while aiming across the room; do a second overlapping loop at a different height. Keep nearby and far objects in view so the camera observes parallax. Spinning in place gives no depth. Keep the phone upright with a fixed lens/zoom; lock exposure where available. Use even lighting, move slowly to avoid blur, and keep consecutive views overlapping.

Avoid mirrors, bright windows, changing light, moving people/pets, blank walls and reflective surfaces. Keep private items, documents, screens, faces, addresses and identifying photos out of frame. Only scan with household permission. Review the source video and resulting scene before sharing either. Unseen/occluded areas remain unknown even if the reconstruction looks complete.

## Pipeline and failure handling

1. ffmpeg samples at most three candidates per desired frame (limited by the video's native frame rate), autorotates, and scales the long side to at most 1600. Images are sampled over the entire ordered sequence. Pillow/NumPy compute a Laplacian-variance score at a consistent thumbnail size. Each temporal window contributes its sharpest candidate, with stable ties; windows below `max(2, 20% of median sharpness)` are dropped. Scores/selection remain in `work/frame-selection.json`.
2. pycolmap 4.2.1 extracts CPU SIFT with a shared `SIMPLE_RADIAL` camera (requested feature budget 4096), then performs sequential matching with overlap 10 and quadratic overlap. Loop detection is explicitly disabled because it requires a downloaded vocabulary tree. Incremental mapping uses a fixed seed; the largest reconstruction wins. If it misses the registration gate and at most 150 images were selected, exhaustive matching and mapping are tried once. Larger runs stop; no unbounded quadratic fallback occurs.
3. The run requires **at least 30 registered frames and at least 60% registration**, and logs mean sparse-point reprojection error in pixels. A failure says, for example, `Only 23/180 frames registered — need at least 30 and 60%` and explains overlap, lighting, translation and texture. Recapture with more overlap/parallax; for a long sequence, try a new run with `--max-frames 150` to enable bounded exhaustive recovery. Registration passing is not proof of accurate or complete geometry.
4. pycolmap undistorts to a clean COLMAP `images/` + `sparse/` dataset with `PINHOLE`/`SIMPLE_PINHOLE` cameras. Brush accepts COLMAP and nerfstudio, but does not undistort this pipeline's radial observations itself. The training input contains only this run's newly estimated model and undistorted images, not the dataset's supplied poses or old training exports. Brush runs headlessly without `--with-viewer`; `--export-every <steps> --export-path <private path> --export-name final.ply` selects the final PLY. SH degree 0 avoids training higher-order color coefficients that the `.splat` output discards; visual equivalence to degree 3 has not been established.
5. Postprocessing estimates up from the registered cameras' negative world-space camera Y axes, rejects strongly disagreeing directions, aligns up to +Y with a proper rotation, recenters on the coordinatewise median sparse point, and applies that same transform to positions and Gaussian rotations. No scale normalization is applied. Near-transparent splats (sigmoid opacity below 0.02 by default) are removed; the remaining splats are sorted by scale-volume × opacity and capped at 1.5M. `--min-opacity` and `--max-splats` are configurable.
6. Exact output bytes are decoded for numerical checks. `work/alignment.json` records camera centers/up axes, rotation determinant, robust/full bounds, positive scales, quaternion norms and SHA-256. A 5th–95th-percentile camera-height band / horizontal-span ratio below 0.5 is a useful single-level capture sanity check; other captures warn for human inspection. This heuristic does not establish a measured floor plane.

Other errors:

- Fewer than 30 sharp frames: use a longer, slower, brighter capture. Do not fill the sequence with duplicate frames.
- Mixed photo dimensions/orientations: use a fixed camera/lens and consistent landscape framing.
- Inconsistent camera up directions: keep the phone upright throughout; don't rotate between portrait and landscape.
- Brush error/no `final.ply`: inspect `brush.log` for Metal/device, memory or export failures. A sandbox without Metal device access cannot train this scene; run the same local command in an authorized session with Metal access. The script does not change access or retry through another runtime.
- Nonfinite positions/scales or malformed PLY: the run fails; inspect training before lowering pruning thresholds.
- Existing output name: choose a new name. Runs never delete or silently overwrite previous media/work.

For a diagnostic run through poses:

```sh
scan/venv-python scan/reconstruct.py /path/to/room.mp4 \
  --name pose-check --max-frames 150 --stop-after poses
# Continue only if the preceding stages completed; keep the same settings:
scan/venv-python scan/reconstruct.py /path/to/room.mp4 \
  --name pose-check --max-frames 150 --resume
```

`--stop-after frames` is also available. Resume reuses completed stages with identical input/options. It refuses interrupted/failed stages and preserves their artifacts: choose a new output name for a restart. The explicit exception is `--resume --retry-training`: this archives a failed training directory as `work/training-attempt-N`, retains its stage record in `previousTrainingAttempts` and tool log, and retries training/postprocessing while reusing completed poses and undistortion. It never overwrites an existing final scene. Use this only after addressing the reported environment problem in an authorized runtime; it does not grant access. Do not edit source media between a partial run and resume.

## Output contract

All output is below `private-captures/scans/<name>/`:

- `scene.splat`: browser interchange, exactly 32 bytes per Gaussian.
- `scene.json`: versioned metadata; no source photographs or original media paths in this file.
- `run.json`, `run.log`: stage wall times, settings, registration, reprojection error, counts, byte sizes and diagnostics. Source paths occur here; these are private too.
- `ffmpeg.log`, `colmap.log`, `brush.log`: tool output.
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

These measurements describe this Apple M5 Pro/48 GB run, not a latency guarantee. The independent photo run began late in the video's recovery phase, so some CPU work overlapped. The initial attempt at a 200-frame budget selected 195, registered only 111/195 (56.92%) and correctly failed at the 60% gate (0.404241 px mean reprojection error in its largest model). This motivated the bounded 150-frame default; the registration requirement was unchanged. The earliest failed attempt also exposed and fixed an ffmpeg boolean-flag syntax error before the reported runs.

Because training was blocked, the real-pose alignment check was executed separately afterward and marked `alignmentCheckAfterTrainingBlock` in the run log. Future full runs check alignment before training. It preserved scale, used a median sparse center and produced rotation determinant **1.000000**, camera-up positive fraction **91.10%**, and mean aligned camera-up Y **0.538967**. The 5th–95th-percentile camera-height band is **[0.575928, 5.054310]** arbitrary units, versus horizontal spans **[8.912474, 11.097420]**, giving ratio **0.314643**. This passes the documented <0.5 heuristic, but the camera axes vary substantially; floor orientation and visual uprightness still need human review. After training, the baked scene was inspected in the FixList viewer and rendered upright.

The independent image-directory path is run with:

```sh
scan/venv-python scan/reconstruct.py private-captures/test-datasets/db/playroom/images \
  --name playroom-images-150 --steps 7000 --max-frames 150 --stop-after poses
```

The photo path selected **148/225** candidates, independently registered **146/148 (98.65%)**, and reconstructed **28,157 sparse points**, with mean reprojection error **0.572589 px**. It initially registered 78/148 and also exercised exhaustive recovery. Its measured stage times were frame preparation **15.180 s**, CPU SIFT **62.136 s**, sequential matching **65.640 s**, mapping/recovery **431.541 s**, and alignment **0.215 s**: **574.712 s** total through poses/alignment. These timings include concurrent CPU work and are not directly comparable to an isolated run. The initial process stopped after poses; a subsequent `--resume --stop-after poses` reused all completed CPU stages and ran the newly added pre-training alignment check. It reported determinant 1.0 and camera-height ratio **0.316**. This path completed its requested pose-only validation and did not attempt training. Its `run.json` remains `partial` because no scene was requested. It uses an independent database and mapping, not the video's poses.

The final deterministic suite passed **21 tests**. A synthetic-PLY integration test also exercised the complete converter to an exact 32-byte scene plus matching metadata in an automatically cleaned temporary test directory. It does not count as a trained benchmark scene. The shell launcher passed `sh -n scan/venv-python`.

### Resuming after a training failure

If training fails (for example, a process without Metal access), rerun the same command with `--resume --retry-training`. Completed extraction, poses, alignment and undistortion are reused and the failed attempt is archived:

```sh
scan/venv-python scan/reconstruct.py private-captures/test-datasets/playroom.mp4 \
  --name playroom-video-150 --steps 7000 --max-frames 150 --resume --retry-training
```

## Privacy and assistance

Reconstruction and training are local. Nothing in this pipeline uploads media, calls a hosted reconstruction service, creates an account, or sends a message. `private-captures/` is gitignored and no scan is copied into `public/` or another tracked path. Gitignore is an accidental-commit guard, not encryption or access control. Anyone with filesystem access can read local videos/scans/logs; opening or sharing them elsewhere has that tool's separate privacy boundary. Do not force-add these outputs to Git. Import `scene.splat` and `scene.json` together in the app's 3D room scan panel.

This pipeline and tests were AI-assisted implementation by a delegated worker. Public benchmark validation is not a family capture study, student-authorship finding, geometric measurement, hazard-validation study, or visual acceptance of the integrated viewer. The parent owns final integration and acceptance. No commits, publications, external sends, app/package edits or new tool installations were performed by this worker.
