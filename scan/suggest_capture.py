#!/usr/bin/env python3
"""Review an exported room capture with the user's local StartLux MLX server.

This command does not start a model, upload photos, reconstruct a room, answer a
checklist, or certify safety. It writes a hash-bound file of areas to review.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace

from artifact_identity import inference_identity
from capture_schema import (
    CATALOG_KEYS, MAX_CAPTURE_FLAGS_BYTES, capture_binding, read_capture_bundle,
    validate_capture_suggestions,
)
from suggestion_schema import NOTICE, SuggestionError, platt_probability, probability, require
from suggest import (
    DEFAULT_URL, GRID, REVIEW_IMAGE_MAX_EDGE, RELEVANCE_THRESHOLD, DecisionClient,
    best_relevant, build_location_request, build_review_request, image_data,
    load_calibration, load_questions, parse_grid_choice, parse_response,
)


def default_output_path(bundle_path, manifest):
    return Path(bundle_path).parent / f'{manifest["captureId"]}.fixlist-flags.json'


def check_output_path(path, bundle_path):
    require(not path.is_symlink(), 'Refusing a symlink flags output.')
    require(path.parent.is_dir(), 'Flags output directory does not exist.')
    require(path.resolve() != Path(bundle_path).resolve(), 'Flags output cannot replace the capture bundle.')
    if path.exists():
        require(path.is_file(), 'Flags output is not a regular file.')
        require(not os.path.samefile(path, bundle_path), 'Flags output cannot replace the capture bundle.')
    project = Path(__file__).resolve().parents[1]
    require(not any(path.resolve().is_relative_to(directory) for directory in
                    (project / 'public', project / 'ios/App/App/public')),
            'Private capture flags must not be written into publicly served app assets.')


def save_flags(path, data, manifest, catalog, bundle_path):
    validate_capture_suggestions(data, manifest, catalog)
    encoded = (json.dumps(data, allow_nan=False, ensure_ascii=True, indent=2) + '\n').encode('utf-8')
    require(len(encoded) <= MAX_CAPTURE_FLAGS_BYTES, 'Flags output exceeds 4 MiB.')
    check_output_path(path, bundle_path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.fixlist-flags-', suffix='.tmp', delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        # Recheck after the write, before the single atomic replacement.
        check_output_path(path, bundle_path)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def run_capture(bundle_path, *, output=None, url=DEFAULT_URL, threshold=.6,
                location_threshold=.5, think_mode='never', timeout=120, retries=2,
                calibration=None, no_calibration=False, force_calibration=False,
                model_dir=None, runtime_dir=None, progress=print, client=None):
    """Run all required requests before writing. client is an in-process test seam.

    The normal CLI never selects synthetic answers and exposes no fake/dry mode.
    An injected client must implement decide(request), with the same strict
    response validation used for the local HTTP client.
    """
    probability(threshold, 'suggestion threshold')
    probability(location_threshold, 'location threshold')
    require(think_mode in ('auto', 'never'), 'think-mode must be auto or never.')
    require((model_dir is None) == (runtime_dir is None),
            'Provide both --model-dir and --runtime-dir for a content identity, or neither.')
    # Validate transport even with an injected client; no caller can turn the
    # public URL parameter into an arbitrary remote image destination.
    local_client = DecisionClient(url, timeout, retries)
    if client is None:
        client = local_client
    bundle_path = Path(bundle_path)
    original_bytes, bundle = read_capture_bundle(bundle_path)
    source_hash = hashlib.sha256(original_bytes).digest()
    manifest = bundle.manifest
    output = Path(output) if output is not None else default_output_path(bundle_path, manifest)
    check_output_path(output, bundle_path)
    catalog = load_questions()
    fit = load_calibration(calibration, disabled=no_calibration, force=force_calibration,
                           catalog=catalog, think_mode=think_mode)
    calibration_block = None if fit is None else fit['calibration']
    identity = inference_identity(model_dir, runtime_dir)
    if fit is not None:
        require(identity is not None and fit.get('modelIdentity') == identity,
                'Calibration lacks matching weight/runtime content identity. Refit with pinned local directories '
                'or use --no-calibration; no calibration transfers by model name. No output written.')
    progress(f'Reviewing {len(manifest["photos"])} local capture photos; scores remain unverified model output.')
    observations = {item['checklistItemId']: [] for item in catalog}
    model_name = None

    def ask(request):
        nonlocal model_name
        name, answers = parse_response(client.decide(request), request['questions'])
        require(not name.startswith('DRY-RUN '), 'Synthetic dry-run model output is not accepted for capture review.')
        require(model_name is None or model_name == name, 'The server model changed during capture review; no output written.')
        if fit is not None:
            require(fit['model'] == name, 'Calibration model differs from response model; no output written.')
        model_name = name
        return answers

    # The exact validated JPEG bytes are temporary inputs to the established
    # max-1024-edge, metadata-free JPEG preprocessing. Nothing is reconstructed.
    image_uris = {}
    with tempfile.TemporaryDirectory(prefix='fixlist-capture-') as directory:
        for index, photo in enumerate(manifest['photos']):
            photo_id = photo['photoId']
            path = Path(directory) / f'{photo_id}.jpg'
            path.write_bytes(bundle.photos[photo_id])
            uri = image_data(SimpleNamespace(path=path, name=photo_id, width=photo['width'], height=photo['height']),
                             REVIEW_IMAGE_MAX_EDGE)
            image_uris[photo_id] = uri
            # Delete each source copy immediately after preprocessing.
            path.unlink()
            progress(f'[{index + 1}/{len(manifest["photos"])}] {photo_id}: photo questions')
            answers = ask(build_review_request(catalog, uri, think_mode))
            for item in catalog:
                key = item['checklistItemId']
                raw = answers[key]['noul']
                value = raw if calibration_block is None else platt_probability(raw, **calibration_block['parameters'][key])
                observations[key].append({'photoId': photo_id, 'rawProbability': raw, 'probability': value,
                                          'relevanceProbability': answers['relevance.' + key]['noul']})
    photos_by_id = {photo['photoId']: photo for photo in manifest['photos']}
    items = []
    for trusted in catalog:
        rows = observations[trusted['checklistItemId']]
        best = best_relevant(rows)
        score = None if best is None else best['probability']
        status = 'not-visible' if score is None else 'suggested' if score >= threshold else 'below-threshold'
        point = None
        if status == 'suggested' and score >= location_threshold:
            photo = photos_by_id[best['photoId']]
            progress(f'  {trusted["checklistItemId"]}: locating best relevant photo')
            answer = ask(build_location_request(trusted, image_uris[best['photoId']], think_mode))['location']
            cell = parse_grid_choice(answer)
            if cell is not None:
                row, col = GRID[cell]
                point = {'u': (col + .5) * photo['width'] / 3, 'v': (row + .5) * photo['height'] / 3}
        items.append({**{key: trusted[key] for key in CATALOG_KEYS}, 'status': status, 'score': score,
                      'bestPhotoId': best['photoId'] if best else None, 'perPhoto': rows, 'point': point})
    # Detect source/model mutation during a long run before replacing any file.
    current_bytes, _ = read_capture_bundle(bundle_path)
    require(hashlib.sha256(current_bytes).digest() == source_hash,
            'Capture bundle bytes changed during inference; no output written.')
    require(identity == inference_identity(model_dir, runtime_dir),
            'Model/runtime bytes changed during inference; no output written.')
    data = {'format': 'fixlist-capture-suggestions', 'version': 1,
            'createdAt': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            'capture': capture_binding(manifest),
            'model': {'name': model_name, 'backend': 'mlx', 'engine': 'startlux-decision',
                      'license': 'CC BY-NC 4.0 weights', 'identity': identity},
            'thresholds': {'suggestion': threshold, 'relevance': RELEVANCE_THRESHOLD, 'location': location_threshold},
            'calibration': calibration_block, 'notice': NOTICE, 'items': items}
    save_flags(output, data, manifest, catalog, bundle_path)
    progress(f'Wrote {output.name}; {sum(item["status"] == "suggested" for item in items)} model areas to review. '
             'Import on the same capture; family answers and confirmation are still required.')
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path, help='Exported <captureId>.fixlist-capture.json on this Mac')
    parser.add_argument('--output', type=Path, help='Default: <captureId>.fixlist-flags.json beside the bundle')
    parser.add_argument('--url', default=DEFAULT_URL, help='HTTP loopback server only (default http://127.0.0.1:8090)')
    parser.add_argument('--threshold', type=float, default=.6)
    parser.add_argument('--location-threshold', type=float, default=.5)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--calibration', type=Path)
    group.add_argument('--no-calibration', action='store_true')
    parser.add_argument('--force-calibration', action='store_true', help='Override adoption only; identity checks still apply')
    parser.add_argument('--think-mode', choices=['auto', 'never'], default='never')
    parser.add_argument('--model-dir', type=Path, help='Exact weights directory used by the server (content hashed)')
    parser.add_argument('--runtime-dir', type=Path, help='Exact local serving environment directory (content hashed)')
    parser.add_argument('--timeout', type=float, default=120)
    parser.add_argument('--retries', type=int, default=2)
    args = parser.parse_args(argv)
    try:
        run_capture(args.bundle, output=args.output, url=args.url, threshold=args.threshold,
                    location_threshold=args.location_threshold, think_mode=args.think_mode,
                    timeout=args.timeout, retries=args.retries, calibration=args.calibration,
                    no_calibration=args.no_calibration, force_calibration=args.force_calibration,
                    model_dir=args.model_dir, runtime_dir=args.runtime_dir)
    except (SuggestionError, OSError, ValueError, OverflowError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print('Interrupted; no partial flags file was written.', file=sys.stderr)
        return 130
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
