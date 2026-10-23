# Local room capture review on a Mac

`scan/suggest_capture.py` reviews the photos in one exported room capture using a separately running local StartLux-Decision MLX server. It produces `<captureId>.fixlist-flags.json`, which FixList accepts only for the same capture ID, room and complete ordered photo/hash list. The [capture v1 contract](capture-v1-contract.md) is the format authority.

These are unverified model areas to review. They do not answer or confirm a checklist question, enter the plan, detect hazards, assess safety or establish that a home is safe. Raw scores are experimental model scores, not probabilities. Even an adjusted score is not validated in real homes. StartLux weights carry the **CC BY-NC 4.0** non-commercial restriction. Room sketches and flag placement are approximate drawing aids; they are never measurements or validated location accuracy.

## One-room round trip

1. In FixList, use the resident profile or a family helper with checklist delegation. Capture a room. A supported physical iPhone can record ARKit poses and a tapped outline; the Simulator/browser fallback is a guided photo tour without AR geometry.
2. Explicitly export that capture to your own Mac with AirDrop or Files. The bundle contains the room photos. Keep it in a private local directory outside Git, `public/` and iOS bundled assets. Export is a manual transfer; this command never uploads photos.
3. Use the existing external Python environment described in [scan/README.md](../scan/README.md). The command adds no dependencies and does not import Torch or load a model in the capture process. Start the existing model server separately, using the exact paths for your installation:

   ```sh
   "$FIXLIST_DECIDE_BIN" serve --model "$FIXLIST_MODEL_DIR" --backend mlx --port 8090
   ```

   `FIXLIST_DECIDE_BIN` is the installed `startlux-decide` executable; `FIXLIST_MODEL_DIR` is the local StartLux MLX weights directory. Starting a server or reviewing your photos requires your own deliberate local action; no server is started by the capture command.
4. Run an explicitly uncalibrated review from the project root:

   ```sh
   scan/venv-python scan/suggest_capture.py \
     "$HOME/Downloads/cap-example-0001.fixlist-capture.json" \
     --no-calibration --url http://127.0.0.1:8090 --think-mode never
   ```

   The output is named with the bundle's actual `captureId` and is written beside the input. `--output /private/local/path/flags.json` chooses another existing local directory. Only HTTP loopback hosts are accepted; environment proxies and HTTP redirects are disabled. The command never starts a server and has no synthetic/fake/dry-run CLI mode.
5. Send the flags file to your own phone, open the same capture in FixList, and choose **Add AI review results**. The importer rejects a different capture, room, missing/reordered photos or mismatched photo hashes. A hash detects mixing, not authorship or tampering by someone who can rewrite both files.
6. Review each displayed flag and supporting photo. Record your own checklist answer separately and explicitly confirm any concern before it can enter the plan. `handrail-check` and `stair-lighting-check` remain excluded from display because their calibration evaluation had zero positives; the producer still includes every catalog item as required by the file contract.

## Calibration and placement

The producer uses the same trusted photo questions, relevance questions, request options, max-1024-edge JPEG preprocessing and Platt mapping as `scan/suggest.py`. SHA-256 binding covers the **exact original JPEG bytes**; the model receives the existing metadata-free review-size re-encoding of those photos, in capture order. All eight questions and their relevance questions are asked for every photo, including extras. No photo is inferred from its guided prompt label.

The best photo is selected only among photos with relevance score at least `0.5`; ties choose the first photo. One relevant photo above the suggestion threshold is sufficient (`minFrames = 1`). The default suggestion threshold is `0.6`; `--threshold` changes it. Only a suggested item also meeting `--location-threshold` (default `0.5`) is sent for coarse grid choice. A pixel point is emitted only for a chosen 3 × 3 cell centre with confidence ≥ 0.7, winning mass ≥ 0.6, margin ≥ 0.25 and none probability < 0.2. Otherwise the flag stays photo-only. These are conservative engineering gates, not validated localization confidence. The v1 file does not carry that grid evidence, so an importer can verify the cell centre and score gates but cannot authenticate the model's grid answer.

If `--no-calibration` is omitted, the existing default `scan/calibration.json` is considered under the existing v2 adoption policy. An unadopted default fit is ignored. An explicitly supplied fit must be adopted unless `--force-calibration` is used. A real calibrated review always requires the matching response model name, scoring conditions, and exact weight/runtime content identities:

```sh
scan/venv-python scan/suggest_capture.py /private/local/capture.fixlist-capture.json \
  --calibration /private/local/calibration.pinned.json --think-mode never \
  --model-dir "$FIXLIST_MODEL_DIR" --runtime-dir "$FIXLIST_RUNTIME_DIR"
```

`FIXLIST_RUNTIME_DIR` must identify the actual local serving environment used by the model server. `--force-calibration` overrides adoption only; it never bypasses identity or request checks. Historical fits without matching weight/runtime identity cannot be applied to real inference. See [suggestions v2](suggestions-v2-contract.md) and [scan/SUGGESTIONS.md](../scan/SUGGESTIONS.md) for fitting and evidence limits. Neither a filename nor a response model name proves which running process loaded particular weights; the operator must supply the actual serving directories.

## Failures and verification

Bundles are capped at 48 MiB; flags at 4 MiB. Input validation requires exact keys, finite values, proper camera rotation, valid JPEG decoding, exact JPEG dimensions and SHA-256. Photos-only captures cannot contain AR geometry. The command refuses incomplete/malformed model answers, model changes, calibration mismatch, source-file changes during review, or configured model/runtime changes. It writes through a private temporary file and one atomic replacement only after every required request and final validation succeed. Any earlier failure leaves an existing flags file unchanged. Output paths cannot alias the input or point into public app assets. The command refuses symlink outputs.

Exit code `0` means a complete validated flags file was written; `2` means an input/request/output error; `130` means interruption. A successful file is software contract evidence, not proof of model accuracy, native tracking quality, physical-device operation, or real-home benefit.

Deterministic validation uses synthetic JPEG fixtures and an explicitly injected test model, with no server or real inference:

```sh
scan/venv-python -m unittest discover -s scan/tests -p 'test_capture*.py' -v
```

The shared `scan/tests/capture-parity/cases.json` cases run against both Python and TypeScript validators. The injected-model tests exercise the CLI parser and full photo → request → flags path, conservative grid gates, ordered binding and preservation of existing output on partial, malformed, hash and atomic-write failures. Live local model execution and physical iPhone tracking/capture must be evaluated separately before claiming them.
