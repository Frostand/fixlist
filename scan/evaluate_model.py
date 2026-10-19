#!/usr/bin/env python3
"""Score labeled local photos and evaluate optional Platt calibration, without fine-tuning.

Only stdlib, NumPy and Pillow are needed. Photos go through suggest.py's exact
review request/resize/client and only to a loopback server; never to a hosted API.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import tempfile
import time
from types import SimpleNamespace

from PIL import Image
from artifact_identity import file_sha256, inference_identity

import suggest as s
from evaluation_stats import (
    PROTOCOL, adoption_rule, comparison_report, fit_method, group_holdout,
    mapped, metric_values, select_method,
)


def read_jsonl(path, *, complete_lines=False):
    try:
        content = path.read_text(encoding='utf-8')
        s.require(not complete_lines or not content or content.endswith('\n'),
                  f'Incomplete trailing score line in {path.name}; explicit recovery is required.')
        rows = []
        for line_number, line in enumerate(content.splitlines(), 1):
            s.require(bool(line.strip()), f'Blank JSONL row at {path.name}:{line_number}.')
            row = json.loads(line, parse_constant=s.reject_constant)
            s.require(type(row) is dict, f'Expected object at {path.name}:{line_number}.')
            rows.append(row)
        return rows
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise s.SuggestionError(f'Cannot read JSONL file {path.name}.') from error


def manifest(dataset, *, require_images=True):
    rows = read_jsonl(dataset / 'manifest.jsonl')
    seen = set()
    for row in rows:
        for key in ('id', 'file', 'group'):
            s.bounded_text(row.get(key), 'manifest.' + key, 500)
        s.require(row['id'] not in seen, 'Duplicate manifest id.')
        seen.add(row['id'])
        s.require('scoring' not in row, 'Manifest field scoring is reserved for raw responses.')
        relative = PurePosixPath(row['file'])
        s.require(not relative.is_absolute() and '..' not in relative.parts and '\\' not in row['file']
                  and str(relative) == row['file'], 'Image file must be relative to images/.')
        root = (dataset / 'images').resolve()
        path = (root / row['file']).resolve()
        s.require(path.is_relative_to(root), 'Image path escapes images/.')
        if require_images:
            s.require(path.is_file(), f"Missing dataset image: {row['file']}.")
    s.require(bool(rows), 'Dataset manifest is empty.')
    return rows


def request_signature(catalog, think_mode):
    return s.request_signature(catalog, think_mode)


def prepared_image(path, name):
    try:
        with Image.open(path) as image:
            frame = SimpleNamespace(path=path, width=image.width, height=image.height, name=name)
        uri = s.image_data(frame, s.REVIEW_IMAGE_MAX_EDGE)
        return uri, hashlib.sha256(uri.encode('ascii')).hexdigest()
    except (OSError, Image.DecompressionBombError) as error:
        raise s.SuggestionError(f'Cannot read dataset image {name}.') from error


@contextmanager
def score_lock(path):
    s.require(not path.is_symlink(), 'Refusing a symlink score lock.')
    with path.open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def append_score(path, row):
    """One locked O_APPEND write per complete JSONL row; fsync before success.

    The caller holds the dataset lock. Recoverable write errors roll back just
    this append. A crash/truncated tail is rejected on resume, never silently
    discarded or mistaken for a completed id.
    """
    encoded = (json.dumps(row, allow_nan=False, ensure_ascii=True, separators=(',', ':')) + '\n').encode()
    s.require(not path.is_symlink(), 'Refusing a symlink scores.jsonl.')
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    original_size = os.fstat(descriptor).st_size
    try:
        try:
            s.require(os.write(descriptor, encoded) == len(encoded), 'Incomplete score append.')
            os.fsync(descriptor)
        except BaseException:
            os.ftruncate(descriptor, original_size)
            os.fsync(descriptor)
            raise
    finally:
        os.close(descriptor)


def validate_scores(rows, entries, catalog, signature=None, *, dataset=None, model_identity=None):
    by_id, seen, model = {row['id']: row for row in entries}, {}, None
    signatures = set()
    for row in rows:
        key = row.get('id')
        s.require(type(key) is str and key in by_id and key not in seen, 'Unknown or duplicate scored id.')
        s.require({k: v for k, v in row.items() if k != 'scoring'} == by_id[key],
                  'Scored metadata differs from manifest; provenance cannot be changed on resume.')
        scoring = row.get('scoring')
        s.exact(scoring, ['model', 'requestSeconds', 'requestSignature', 'response', 'imageSHA256', 'requestImageSHA256', 'modelIdentity'], 'scoring')
        s.validate_model_identity(scoring['modelIdentity'])
        s.require(all(type(scoring[key]) is str and len(scoring[key]) == 64
                      and all(c in '0123456789abcdef' for c in scoring[key])
                      for key in ['imageSHA256', 'requestImageSHA256']), 'Missing image/request content hash; rescore legacy rows.')
        if dataset is not None:
            s.require(scoring['imageSHA256'] == file_sha256(Path(dataset)/'images'/by_id[key]['file']),
                      'Image bytes changed; stale scores cannot resume or fit. Use a separate dataset.')
            _, encoded_hash = prepared_image(Path(dataset)/'images'/by_id[key]['file'], by_id[key]['file'])
            s.require(scoring['requestImageSHA256'] == encoded_hash,
                      'Preprocessed request image bytes changed; stale scores cannot resume or fit.')
        if model_identity is not None:
            s.require(scoring['modelIdentity'] == model_identity, 'Model weight/runtime bytes changed; use a separate dataset.')
        elif seen:
            s.require(scoring['modelIdentity'] == next(iter(seen.values()))['scoring']['modelIdentity'], 'Mixed model content identities.')
        s.number(scoring['requestSeconds'], 'requestSeconds')
        s.bounded_text(scoring['requestSignature'], 'requestSignature', 64)
        signatures.add(scoring['requestSignature'])
        if signature is not None:
            s.require(scoring['requestSignature'] == signature, 'Review request changed; use a separate dataset for changed prompts/think mode.')
        request = s.build_review_request(catalog, 'unused', 'never')
        name, _ = s.parse_response(scoring['response'], request['questions'])
        s.require(scoring['model'] == name and (model is None or model == name), 'Scored model changed; do not mix models in one dataset.')
        model = name
        seen[key] = row
    s.require(len(signatures) <= 1, 'Mixed review requests in scores.')
    # Prevent fitting stale answers after the trusted photo catalog changes.
    allowed = {request_signature(catalog, mode) for mode in ('auto', 'never')}
    s.require(signatures <= allowed, 'Score prompts differ from the current photo catalog; rescore in a new dataset.')
    return seen, model


def score_dataset(dataset, *, url=s.DEFAULT_URL, think_mode='never', limit=None, client=None, progress=print,
                  model_dir=None, runtime_dir=None):
    dataset = Path(dataset).resolve()
    s.require(think_mode in ('never', 'auto'), 'Unsupported think mode.')
    if limit is not None:
        s.integer(limit, 'limit', 1)
    entries, catalog = manifest(dataset), s.load_questions()
    signature = request_signature(catalog, think_mode)
    client = s.DecisionClient(url) if client is None else client
    model_dir = model_dir if model_dir is not None else getattr(client, 'model_dir', None)
    runtime_dir = runtime_dir if runtime_dir is not None else getattr(client, 'runtime_dir', None)
    identity = inference_identity(model_dir, runtime_dir)
    s.require(identity is not None, 'Scoring requires --model-dir and --runtime-dir for actual local content identity.')
    path, completed = dataset / 'scores.jsonl', 0
    with score_lock(dataset / '.scores.lock'):
        s.require(not path.is_symlink(), 'Refusing a symlink scores.jsonl.')
        rows = read_jsonl(path, complete_lines=True) if path.exists() else []
        seen, model = validate_scores(rows, entries, catalog, signature, dataset=dataset, model_identity=identity)
        for row in entries:
            if row['id'] in seen:
                continue
            if limit is not None and completed >= limit:
                break
            image_path = dataset / 'images' / row['file']
            image_hash = file_sha256(image_path)
            uri, encoded_hash = prepared_image(image_path, row['file'])
            request = s.build_review_request(catalog, uri, think_mode)
            started = time.perf_counter()
            payload = client.decide(request)
            name, _ = s.parse_response(payload, request['questions'])
            s.require(file_sha256(image_path) == image_hash, 'Image changed during inference; no row appended.')
            seconds = time.perf_counter() - started
            s.require(model is None or model == name, 'Server model changed; no row appended for this image.')
            model = name
            append_score(path, {**row, 'scoring': {'model': name, 'requestSeconds': seconds,
                                                'requestSignature': signature, 'response': payload,
                                                'imageSHA256': image_hash, 'requestImageSHA256': encoded_hash, 'modelIdentity': identity}})
            completed += 1
            progress(f"Scored {row['id']}: {seconds:.3f}s ({name})")
    progress(f'{completed} new images scored; prior ids skipped.')
    return completed


def labeled_rows(dataset, labels_path):
    dataset = Path(dataset)
    entries, catalog = manifest(dataset), s.load_questions()
    scores, model = validate_scores(read_jsonl(dataset / 'scores.jsonl'), entries, catalog, dataset=dataset)
    labels, rows = {}, []
    ids = [item['checklistItemId'] for item in catalog]
    known = {entry['id'] for entry in entries}
    for label in read_jsonl(Path(labels_path)):
        key = label.get('id')
        s.require(type(key) is str and key in known and key not in labels, 'Unknown or duplicate labeled id.')
        s.exact(label, ['id', *ids], 'label row')
        for item in ids:
            answer = label[item]
            s.exact(answer, ['relevant', 'condition'], 'item label')
            s.require(all(value is None or type(value) is bool for value in answer.values()), 'Labels must be boolean or null.')
        labels[key] = label
    for entry in entries:
        key = entry['id']
        if key not in labels or key not in scores:
            continue
        answers = scores[key]['scoring']['response']['answers']
        for item in ids:
            label = labels[key][item]
            if label['relevant'] is False:
                truth = 0
            elif label['relevant'] is None or label['condition'] is None:
                continue
            else:
                truth = int(label['condition'])
            rows.append({'id': key, 'group': entry['group'], 'item': item,
                         'raw': answers[item]['noul'], 'label': truth})
    s.require(bool(rows), 'No usable scored labels.')
    # Split all manifest groups, including those without usable labels. This
    # fixes membership independently of label availability and class outcomes.
    signature = next(iter(scores.values()))['scoring']['requestSignature']
    conditions = next(s.scoring_conditions(catalog, mode) for mode in ('auto', 'never')
                      if request_signature(catalog, mode) == signature)
    return rows, sorted({entry['group'] for entry in entries}), ids, model, conditions


def atomic_json(path, document):
    path = Path(path)
    s.require(not path.is_symlink(), 'Refusing a symlink calibration output.')
    encoded = json.dumps(document, indent=2, allow_nan=False) + '\n'
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, prefix='.calibration-', suffix='.tmp', delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def fit_dataset(dataset, labels_path, output, *, seed=7, label_source=None):
    rows, groups, ids, model, conditions = labeled_rows(dataset, labels_path)
    dev_groups, test_groups = group_holdout(groups, seed)
    dev = [r for r in rows if r['group'] in dev_groups]
    test = [r for r in rows if r['group'] in test_groups]
    s.require(bool(dev) and bool(test), 'Dev and held-out splits must each have usable labels.')
    method, cv_scores, folds = select_method(dev, dev_groups, ids, seed)
    parameters = fit_method(dev, method, ids)
    # The stored block always uses the contract's Platt mapping, even for the
    # identity/raw choice (endpoints clamp to 1e-6). Raw selection is never adopted.
    calibrated = [float(mapped(r['raw'], parameters[r['item']])) for r in test]
    pooled = comparison_report(test, calibrated, groups=test_groups, seed=seed)
    items = {}
    for key in ids:
        indexes = [i for i, r in enumerate(test) if r['item'] == key]
        items[key] = comparison_report([test[i] for i in indexes], [calibrated[i] for i in indexes], groups=test_groups, seed=seed)
    raw_metrics = {key: value['value'] for key, value in pooled['raw'].items()}
    cal_metrics = {key: value['value'] for key, value in pooled['calibrated'].items()}
    adopted = method != 'raw' and adoption_rule(raw_metrics, cal_metrics, pooled['pairedBrierDifference']['ci95'])
    block = {'method': 'platt', 'parameters': parameters,
             'fittedAt': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
             'labelSource': label_source or 'User-provided labels; annotator identity not supplied',
             'trainExamples': len({r['id'] for r in dev}), 'heldOutExamples': len({r['id'] for r in test}),
             'heldOutBrierRaw': raw_metrics['brier'], 'heldOutBrierCalibrated': cal_metrics['brier']}
    s.validate_calibration(block, s.load_questions())
    document = {'format': 'fixlist-photo-calibration', 'version': 1, 'adopted': bool(adopted),
                'model': model, 'scoringConditions': conditions, 'calibration': block, 'protocol': PROTOCOL,
                'modelIdentity': read_jsonl(Path(dataset)/'scores.jsonl')[0]['scoring']['modelIdentity'],
                'dataIdentity': {name: file_sha256(path) for name, path in {
                    'manifestSHA256': Path(dataset)/'manifest.jsonl', 'scoresSHA256': Path(dataset)/'scores.jsonl',
                    'labelsSHA256': Path(labels_path)}.items()},
                'split': {'seed': seed, 'devGroups': dev_groups, 'heldOutGroups': test_groups, 'cvValidationGroups': folds},
                'selection': {'method': method, 'cvBrier': cv_scores},
                'report': {'developmentImageItemLabels': len(dev), 'heldOutImageItemLabels': len(test),
                           'pooled': pooled, 'items': items}}
    s.validate_calibration_document(document, s.load_questions())
    atomic_json(output, document)
    return document


def print_table(rows, ids):
    print('item                            n   positive  Brier     ECE       AUROC     AUPRC')
    for item in ['pooled', *ids]:
        subset = rows if item == 'pooled' else [r for r in rows if r['item'] == item]
        metrics = metric_values([r['label'] for r in subset], [r['raw'] for r in subset])
        numbers = ['undefined' if metrics[k] is None else f'{metrics[k]:.5f}' for k in ('brier', 'ece', 'auroc', 'auprc')]
        print(f"{item:31} {metrics['n']:5d} {metrics['positives']:8d}  " + '  '.join(numbers)
              + ('  insufficient positives (<10)' if metrics['positives'] < 10 else ''))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    scoring = commands.add_parser('score', help='Append raw review answers, skipping ids already scored')
    scoring.add_argument('--dataset', type=Path, required=True)
    scoring.add_argument('--url', default=s.DEFAULT_URL)
    scoring.add_argument('--think-mode', choices=['never', 'auto'], default='never')
    scoring.add_argument('--limit', type=int)
    scoring.add_argument('--model-dir', type=Path, required=True)
    scoring.add_argument('--runtime-dir', type=Path, required=True)
    fitting = commands.add_parser('fit', help='Choose on dev groups and report on untouched held-out groups')
    fitting.add_argument('--dataset', type=Path, required=True)
    fitting.add_argument('--labels', type=Path, required=True)
    fitting.add_argument('--out', type=Path, default=Path(__file__).with_name('calibration.json'))
    fitting.add_argument('--seed', type=int, default=7)
    fitting.add_argument('--label-source', help='Annotator/protocol description, at most 200 characters')
    report = commands.add_parser('report', help='Print raw-score metrics without fitting')
    report.add_argument('--dataset', type=Path, required=True)
    report.add_argument('--labels', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'score':
            score_dataset(args.dataset, url=args.url, think_mode=args.think_mode, limit=args.limit,
                          model_dir=args.model_dir, runtime_dir=args.runtime_dir)
        elif args.command == 'fit':
            result = fit_dataset(args.dataset, args.labels, args.out, seed=args.seed, label_source=args.label_source)
            print(f"Selected {result['selection']['method']}; adopted={result['adopted']}. Wrote {args.out}.")
        else:
            rows, _, ids, _, _ = labeled_rows(args.dataset, args.labels)
            print_table(rows, ids)
    except (s.SuggestionError, OSError, ValueError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print('Interrupted; completed score rows are resumable.', file=sys.stderr)
        return 130
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
