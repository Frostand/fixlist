#!/usr/bin/env python3
"""Bounded offline floor-object experiment. Never exports a production model.

JSON locks detect stale/accidentally edited artifacts, not a malicious operator
who rewrites the experiment and every hash. Do not reuse an evaluated test set
for another selection, including in another output directory.
"""
import argparse
import hashlib
import html
import io
import json
import math
import os
from pathlib import Path
import random
import re
import sys
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
TARGET = 'floor-objects-visible'
AI_CAVEAT = 'AI visual labels, not expert ground truth; public-image feasibility only.'
# Fixed before any scoring; deliberately independent of the app's eight items.
SPEC = {
    'version': 1, 'target': TARGET, 'seed': 7, 'testFraction': .25, 'folds': 3,
    'positivePrompts': [
        'An indoor room with loose toys, shoes, bags, or clothing resting on the floor.',
        'A photo of portable objects such as books, boxes, or cables lying on an indoor floor.',
        'An indoor floor with scattered loose household objects on it.',
    ],
    'negativePrompts': [
        'An indoor room with a clear floor, ordinary furniture, and a flat rug.',
        'A tidy indoor floor with no loose portable objects on it.',
        'An indoor room with clutter on tables and shelves but no loose objects on the floor.',
    ],
    'views': 'pilot.views: full then row-major 3x3 crops at 60 percent; EXIF RGB',
    'encoder': 'ViT-B-32', 'pretrained': 'laion2b_s34b_b79k',
    'featureShape': [10, 512], 'linearViews': ['full', 'mean10'],
    'C': [.01, .1, 1.0], 'selection': 'dev grouped OOF Brier; ties within 1e-12: smaller C then full',
    'threshold': 'maximum train recall at precision >= .8 and TP >= 2; ties precision then threshold; otherwise abstain',
    'minimumPositiveImages': 20, 'minimumPositiveGroups': 4,
    'phashHamming': 8, 'productionPromotion': False,
}


class ExperimentError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def immutable(path, data):
    """Publish complete bytes without replacing an existing file, even on races."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f'.{os.getpid()}.partial')
    try:
        with temporary.open('xb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != data:
                raise ExperimentError(f'Immutable artifact already exists: {path}')
    finally:
        temporary.unlink(missing_ok=True)


def write_lock(path, payload):
    immutable(path, canonical({'payload': payload, 'sha256': digest(payload)}) + b'\n')
    return digest(payload)


def read_lock(path):
    try:
        envelope = json.loads(Path(path).read_text())
        if digest(envelope['payload']) != envelope['sha256']:
            raise ExperimentError(f'Lock tamper detected: {path}')
        return envelope['payload']
    except (KeyError, json.JSONDecodeError) as exc:
        raise ExperimentError(f'Invalid lock: {path}') from exc


def output_path(run):
    run = Path(run).expanduser().resolve()
    if run == REPO or REPO in run.parents:
        raise ExperimentError('Candidate artifacts must be outside the Git checkout')
    return run


def token(value):
    return re.sub(r'[^a-z0-9]+', '-', html.unescape(re.sub('<[^>]*>', '', str(value))).lower()).strip('-')


def source_url(value):
    parts = urlsplit(html.unescape(value))
    query = [(k, v) for k, v in parse_qsl(parts.query) if not k.lower().startswith('utm_')]
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip('/'), urlencode(sorted(query)), ''))


def links(row):
    result = {'source:' + token(row['source_group'])}
    for key in ('creator', 'author'):
        if row.get(key):
            result.add('creator:' + token(row[key]))
    for key in ('room_group', 'video_group', 'duplicate_cluster', 'near_duplicate_group', 'file_group'):
        if row.get(key):
            result.add(key + ':' + token(row[key]))
    urls = [row[k] for k in ('source_page', 'original_url', 'download_url', 'source_url') if row.get(k)]
    for key in ('sourceURLs', 'source_urls'):
        values = row.get(key, [])
        urls.extend([values] if isinstance(values, str) else values)
    urls.extend(re.findall(r'href=[\"\']([^\"\']+)', row.get('source_credit_html', '')))
    result.update('url:' + source_url(u) for u in urls if isinstance(u, str) and u.startswith(('https://', 'http://')))
    return sorted(result)


def input_rows(dataset):
    dataset = Path(dataset).expanduser().resolve()
    manifest, protocol, summary = (dataset / x for x in ('manifest.jsonl', 'protocol.json', 'summary.json'))
    objective = json.loads(protocol.read_text())
    if objective.get('target') != TARGET:
        raise ExperimentError('Protocol target must be ' + TARGET)
    review = json.loads(summary.read_text()) if summary.exists() else {}
    flagged = {str(x['id']) for k in ('retained_license_review_flags', 'excluded_license_or_provenance_flags')
               for x in review.get(k, [])}
    rows, ids, hashes = [], set(), set()
    for line in manifest.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        identity = str(row['id'])
        relative = Path(row.get('path') or 'images/' + row['file'])
        path = (dataset / relative).resolve()
        if not path.is_relative_to(dataset / 'images'):
            raise ExperimentError('Image must reside within dataset/images')
        actual = sha(path)
        if actual != row['sha256']:
            raise ExperimentError('Image hash mismatch: ' + identity)
        if identity in ids or actual in hashes:
            raise ExperimentError('Duplicate ID or exact hash duplicate: ' + identity)
        if not row.get('source_group'):
            raise ExperimentError('Missing creator/source_group: ' + identity)
        ids.add(identity)
        hashes.add(actual)
        reasons = []
        if not row.get('license') or row.get('license_issues') or identity in flagged:
            reasons.append('LICENSE_OR_PROVENANCE_REVIEW')
        if row.get('provenance_status') in ('uncertain', 'unverified', 'rejected'):
            reasons.append('UNCERTAIN_PROVENANCE')
        if type(row.get('development_only', False)) is not bool:
            raise ExperimentError('development_only must be boolean')
        rows.append({'id': identity, 'path': str(relative), 'sha256': actual,
                     'source_group': row['source_group'], 'links': links(row),
                     'phash64': row.get('phash64'), 'development_only': row.get('development_only', False),
                     'excluded': reasons})
    return rows, {'dataset': str(dataset), 'manifestSHA256': sha(manifest), 'protocolSHA256': sha(protocol),
                  'summarySHA256': sha(summary) if summary.exists() else None, 'objective': objective}


def partition(rows):
    """Connected components prevent creator, source, room and near-hash leakage."""
    parent = list(range(len(rows)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        parent[root(i)] = root(j)

    seen = {}
    for i, row in enumerate(rows):
        for link in row['links']:
            if link in seen:
                union(i, seen[link])
            seen[link] = i
        for j, other in enumerate(rows[:i]):
            if row['phash64'] and other['phash64']:
                if (int(row['phash64'], 16) ^ int(other['phash64'], 16)).bit_count() <= SPEC['phashHamming']:
                    union(i, j)
    components = {}
    for i, row in enumerate(rows):
        components.setdefault(root(i), []).append(row)
    for members in components.values():
        if len({r['development_only'] for r in members}) > 1:
            raise ExperimentError('Development-only supplement overlaps a base creator/source/duplicate group')
        group = 'group-' + digest(sorted(r['id'] for r in members))[:16]
        for row in members:
            row['group'] = group
    # Excluded images never affect the random eligible-group split.
    base = sorted({r['group'] for r in rows if not r['excluded'] and not r['development_only']})
    if len(base) < 2:
        raise ExperimentError('Need at least two eligible independent base groups')
    random.Random(7).shuffle(base)
    held = set(base[:max(1, math.ceil(len(base) * SPEC['testFraction']))])
    dev = sorted({r['group'] for r in rows if not r['excluded']} - held)
    random.Random(7).shuffle(dev)
    folds = {group: i % SPEC['folds'] for i, group in enumerate(dev)}
    for row in rows:
        row['partition'] = 'excluded' if row['excluded'] else 'test' if row['group'] in held else 'dev'
        row['fold'] = folds.get(row['group']) if row['partition'] == 'dev' else None
    return sorted(rows, key=lambda r: r['id'])


def prepare(dataset, run):
    run = output_path(run)
    rows, inputs = input_rows(dataset)  # No labels or image decoding here.
    payload = {'spec': SPEC, 'inputs': inputs, 'rows': partition(rows), 'labelCaveat': AI_CAVEAT}
    write_lock(run / 'prepare.json', payload)
    return payload


def verified_prepare(run):
    prepared = read_lock(run / 'prepare.json')
    rows, inputs = input_rows(prepared['inputs']['dataset'])
    if prepared['spec'] != SPEC or inputs != prepared['inputs'] or partition(rows) != prepared['rows']:
        raise ExperimentError('Prepared manifest/images/protocol/split changed; refuse stale run')
    return prepared


def implementation_identity():
    # Bind extraction/selection semantics as well as the frozen experimental spec.
    return {'floorObjectsSHA256': sha(__file__), 'pilotSHA256': sha(ROOT / 'pilot.py')}


def cached_weights():
    folder = Path.home() / '.cache/huggingface/hub/models--laion--CLIP-ViT-B-32-laion2B-s34B-b79K'
    found = sorted(folder.glob('snapshots/*/open_clip_model.safetensors'))
    if len(found) != 1:
        raise ExperimentError('Expected exactly one cached original ViT-B-32 weights file; no downloads allowed')
    return found[0]


def cache_identity(prepared, weight_hash, preprocess):
    return {'prepareSHA256': digest(prepared), 'manifestSHA256': prepared['inputs']['manifestSHA256'],
            'protocolSHA256': prepared['inputs']['protocolSHA256'], 'weightsSHA256': weight_hash,
            'preprocess': preprocess, 'implementation': implementation_identity(),
            'images': [[r['id'], r['sha256']] for r in prepared['rows'] if not r['excluded']]}


def extraction_versions():
    import importlib.metadata
    return {p: importlib.metadata.version(p) for p in ('torch', 'open_clip_torch', 'Pillow', 'numpy')}


def write_features(run, prepared, embeddings, contrast, scale, identity, latency):
    """Also used by synthetic tests; not a CLI for accepting unverified embeddings."""
    import numpy as np
    data = io.BytesIO()
    np.savez_compressed(data, embeddings=embeddings, contrast=contrast, logit_scale=np.array(scale))
    name = 'features-' + digest(identity) + '.npz'
    immutable(run / name, data.getvalue())
    payload = {'identity': identity, 'file': name, 'fileSHA256': sha(run / name),
               'ids': [r['id'] for r in prepared['rows'] if not r['excluded']], 'hostLatency': latency}
    write_lock(run / 'features.json', payload)
    return read_lock(run / 'features.json')  # Same JSON types on first use and reuse.


def features(run):
    run = output_path(run)
    prepared = verified_prepare(run)
    if (run / 'features.json').exists():
        return load_features(run, prepared)[2]
    if (run / 'selection.json').exists() or (run / 'evaluation-attempt.json').exists():
        raise ExperimentError('Selection/evaluation already locked; cannot extract new features')
    # pilot.load uses only cached original weights. Redirect its runtime caches
    # outside Git; no Core ML export, prompts-source edit, or production write.
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    import torch
    import open_clip
    import pilot
    import numpy as np
    from PIL import Image, ImageOps
    runtime = run / 'runtime-cache'
    runtime.mkdir(parents=True, exist_ok=True)
    pilot.ROOT = runtime
    os.environ.update(HF_HOME=str(runtime / 'hf'), TORCH_HOME=str(runtime / 'torch'),
                      MPLCONFIGDIR=str(runtime / 'mpl'))
    torch.set_num_threads(4)
    torch.manual_seed(7)
    torch.use_deterministic_algorithms(True)
    weight_path = cached_weights()
    weight_hash = sha(weight_path)
    start = time.perf_counter()
    model, preprocess, cfg = pilot.load('ViT-B-32', 'cpu')
    load_seconds = time.perf_counter() - start
    preproc = {'transform': str(preprocess), 'config': cfg, 'views': SPEC['views'],
               'versions': extraction_versions()}
    identity = cache_identity(prepared, weight_hash, preproc)
    embeddings, preprocess_times, encoder_times = [], [], []
    with torch.inference_mode():
        prompts = SPEC['positivePrompts'] + SPEC['negativePrompts']
        text = model.encode_text(open_clip.get_tokenizer('ViT-B-32')(prompts), normalize=True)
        count = len(SPEC['positivePrompts'])
        contrast = (text[:count].mean(0) - text[count:].mean(0)).cpu().numpy().astype(np.float32)
        scale = float(model.logit_scale.exp().cpu())
        for row in prepared['rows']:
            if row['excluded']:
                continue
            start = time.perf_counter()
            with Image.open(Path(prepared['inputs']['dataset']) / row['path']) as im:
                image = ImageOps.exif_transpose(im).convert('RGB')
            batch = torch.stack([preprocess(v) for v in pilot.views(image)])
            preprocess_times.append(time.perf_counter() - start)
            start = time.perf_counter()
            embeddings.append(model.encode_image(batch, normalize=True).cpu().numpy().astype(np.float32))
            encoder_times.append(time.perf_counter() - start)
    # Detect mutable input/weight changes during extraction, before publishing.
    if verified_prepare(run) != prepared or sha(weight_path) != weight_hash:
        raise ExperimentError('Inputs changed during feature extraction')
    latency = {'scope': 'host CPU only; not physical-phone performance', 'device': 'cpu',
               'encoderLoadSeconds': load_seconds, 'images': len(embeddings), 'viewsPerImage': 10,
               'preprocessSecondsPerImageMedian': float(np.median(preprocess_times)),
               'encoderSecondsPerImageMedian': float(np.median(encoder_times)),
               'encoderSecondsPerImageP95': float(np.percentile(encoder_times, 95))}
    return write_features(run, prepared, np.array(embeddings), contrast, scale, identity, latency)


def load_features(run, prepared, timing=None):
    import numpy as np
    metadata = read_lock(run / 'features.json')
    identity = metadata['identity']
    if identity['preprocess'].get('versions') != extraction_versions():
        raise ExperimentError('Feature cache preprocessing/package versions changed')
    expected = cache_identity(prepared, sha(cached_weights()), identity['preprocess'])
    path = run / metadata['file']
    if identity != expected or path.name != 'features-' + digest(identity) + '.npz' or path.parent != run:
        raise ExperimentError('Stale feature cache identity (weights/images/protocol/implementation)')
    if sha(path) != metadata['fileSHA256']:
        raise ExperimentError('Feature cache bytes changed')
    expected_ids = [r['id'] for r in prepared['rows'] if not r['excluded']]
    with np.load(path, allow_pickle=False) as archive:
        embeddings, contrast, scale = archive['embeddings'], archive['contrast'], float(archive['logit_scale'])
    if metadata['ids'] != expected_ids or embeddings.shape != (len(expected_ids), 10, 512) or contrast.shape != (512,):
        raise ExperimentError('Invalid feature cache dimensions/order')
    if not np.isfinite(embeddings).all() or not np.isfinite(contrast).all() or not math.isfinite(scale) or scale <= 0:
        raise ExperimentError('Nonfinite feature cache')
    norms = np.linalg.norm(embeddings, axis=2)
    if not np.allclose(norms, 1, atol=1e-4):
        raise ExperimentError('Expected normalized frozen image embeddings')
    start = time.perf_counter()
    scores = sigmoid(scale * (embeddings @ contrast))
    zeros = {'zero_full': scores[:, 0], 'zero_max10': scores.max(axis=1)}
    if timing is not None:
        timing['zeroShotContrastSeconds'] = time.perf_counter() - start
    return embeddings, zeros, metadata


def sigmoid(values):
    import numpy as np
    return 1 / (1 + np.exp(-np.clip(values, -80, 80)))


def read_labels(path, prepared, partition_name):
    """Decode requested partition only; other label values are never parsed.

    The ID is a top-level flat-row field. File hashing freezes annotation bytes
    without using test outcomes. Full test validation is deferred to evaluate.
    """
    allowed = {r['id'] for r in prepared['rows'] if r['partition'] == partition_name}
    known = {r['id'] for r in prepared['rows']}
    labels, seen = {}, set()
    for line in Path(path).read_text().splitlines():
        if not line.strip():
            continue
        match = re.search(r'"id"\s*:\s*("[^"\\]*"|[0-9]+)', line)
        if not match:
            raise ExperimentError('Each annotation needs a simple top-level id')
        identity = str(json.loads(match[1]))
        if identity not in known or identity in seen:
            raise ExperimentError('Unknown/duplicate annotation ID: ' + identity)
        seen.add(identity)
        if identity not in allowed:
            continue
        row = json.loads(line)
        if str(row.get('id')) != identity or row.get('target') != TARGET:
            raise ExperimentError('Annotation target/ID mismatch: ' + identity)
        if row.get('manifestSHA256') != prepared['inputs']['manifestSHA256']:
            raise ExperimentError('Annotation manifest hash mismatch: ' + identity)
        value = row.get('label', 'missing')
        if value is not None and type(value) is not bool:
            raise ExperimentError('Annotation label must be true/false/null: ' + identity)
        if not row.get('reviewer') or 'uncertainty' not in row:
            raise ExperimentError('Annotation needs reviewer and uncertainty: ' + identity)
        labels[identity] = row
    if set(labels) != allowed:
        raise ExperimentError('Missing annotations for ' + partition_name)
    return labels


def support(rows, labels):
    usable = [r for r in rows if labels[r['id']]['label'] is not None]
    positive = [r for r in usable if labels[r['id']]['label']]
    negative = [r for r in usable if not labels[r['id']]['label']]
    return {'images': len(rows), 'groups': len({r['group'] for r in rows}), 'n': len(usable),
            'positives': len(positive), 'negatives': len(negative),
            'positiveGroups': len({r['group'] for r in positive}),
            'ambiguous': len(rows) - len(usable), 'coverage': len(usable) / len(rows) if rows else None}


def threshold(y, p):
    """Fit only on caller-supplied fold-training groups; None means abstain."""
    import numpy as np
    y, p = np.asarray(y, dtype=bool), np.asarray(p)
    valid = []
    for t in sorted(set(map(float, p))):
        selected = p >= t
        tp, fp = int((y & selected).sum()), int((~y & selected).sum())
        if tp >= 2 and tp / (tp + fp) >= .8:
            valid.append((tp / int(y.sum()), tp / (tp + fp), t))
    return max(valid)[2] if valid else None


def metrics(y, p, thresholds, groups):
    import numpy as np
    from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
    y, p = np.asarray(y, dtype=int), np.asarray(p, dtype=float)
    predicted = np.array([t is not None and value >= t for value, t in zip(p, thresholds)], dtype=bool)
    tp, fp = int(((y == 1) & predicted).sum()), int(((y == 0) & predicted).sum())
    tn, fn = int(((y == 0) & ~predicted).sum()), int(((y == 1) & ~predicted).sum())
    return {'n': len(y), 'groups': len(set(groups)), 'positives': int(y.sum()), 'negatives': int((y == 0).sum()),
            'confusion': {'tp': tp, 'fp': fp, 'tn': tn, 'fn': fn},
            'precision': tp / (tp + fp) if tp + fp else None, 'recall': tp / (tp + fn) if tp + fn else None,
            'brier': float(brier_score_loss(y, p)) if len(y) else None,
            'auroc': float(roc_auc_score(y, p)) if len(set(y)) == 2 else None,
            'auprc': float(average_precision_score(y, p)) if y.sum() else None,
            'predictionCoverage': sum(t is not None for t in thresholds) / len(y) if len(y) else None,
            'flagRate': float(predicted.mean()) if len(y) else None}


def linear_features(embeddings, variant):
    import numpy as np
    x = embeddings[:, 0] if variant == 'full' else embeddings.mean(axis=1)
    return x / np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-12)


def fit_linear(x, y, c):
    from sklearn.linear_model import LogisticRegression
    from sklearn.exceptions import ConvergenceWarning
    import warnings
    # Failure to converge is an error, never an apparently fitted candidate.
    with warnings.catch_warnings():
        warnings.simplefilter('error', ConvergenceWarning)
        model = LogisticRegression(C=c, solver='lbfgs', max_iter=2000, random_state=7)
        model.fit(x, y)
    return {'coef': model.coef_[0].tolist(), 'intercept': float(model.intercept_[0]),
            'iterations': int(model.n_iter_[0]), 'C': c}


def linear_predict(x, model):
    import numpy as np
    return sigmoid(x @ np.array(model['coef']) + model['intercept'])


def select(run, labels_path):
    import numpy as np
    import importlib.metadata
    run = output_path(run)
    prepared = verified_prepare(run)
    embeddings, zeros, feature_lock = load_features(run, prepared)
    label_hash = sha(labels_path)  # No test outcome decoding.
    bindings = {'prepareSHA256': digest(prepared), 'featuresSHA256': digest(feature_lock),
                'labelsSHA256': label_hash, 'implementation': implementation_identity(),
                'sklearnVersion': importlib.metadata.version('scikit-learn')}
    if (run / 'selection.json').exists():
        locked = read_lock(run / 'selection.json')
        if locked['bindings'] != bindings:
            raise ExperimentError('Selection locked; changed scores/labels/implementation forbidden')
        return locked
    if (run / 'evaluation-attempt.json').exists() or (run / 'report.json').exists():
        raise ExperimentError('Test already evaluated/attempted; no new selection')
    # Exclusive reservation prevents concurrent selections with different inputs.
    write_lock(run / 'selection-attempt.json', bindings)
    labels = read_labels(labels_path, prepared, 'dev')
    dev = [r for r in prepared['rows'] if r['partition'] == 'dev']
    usable = [r for r in dev if labels[r['id']]['label'] is not None]
    info = support(dev, labels)
    indices = {identity: i for i, identity in enumerate(feature_lock['ids'])}
    idx = np.array([indices[r['id']] for r in usable], dtype=int)
    y = np.array([labels[r['id']]['label'] for r in usable], dtype=int)
    reasons = []
    if info['positives'] < 20:
        reasons.append('FEWER_THAN_20_DEV_POSITIVE_IMAGES')
    if info['positiveGroups'] < 4:
        reasons.append('FEWER_THAN_4_DEV_POSITIVE_GROUPS')
    folds = sorted({r['fold'] for r in dev})
    splits = []
    for fold in folds:
        train = np.array([i for i, r in enumerate(usable) if r['fold'] != fold], dtype=int)
        held = np.array([i for i, r in enumerate(usable) if r['fold'] == fold], dtype=int)
        splits.append((train, held))
        if len(set(y[train])) < 2:
            reasons.append('CV_TRAINING_FOLD_SINGLE_CLASS')
    if len(folds) < 2:
        reasons.append('INSUFFICIENT_DEV_CV_GROUPS')
    variants = {}
    candidates = [('zero_full', None, None), ('zero_max10', None, None)]
    if not reasons:
        candidates += [(f'linear_{view}_C{c:g}', view, c) for c in SPEC['C'] for view in SPEC['linearViews']]
    for name, view, c in candidates:
        x = linear_features(embeddings, view)[idx] if view else None
        raw = zeros[name][idx] if view is None else None
        oof = np.zeros(len(y))
        thresholds = [None] * len(y)
        audit = []
        for train, held in splits:
            if view:
                fitted = fit_linear(x[train], y[train], c)
                train_p, held_p = linear_predict(x[train], fitted), linear_predict(x[held], fitted)
            else:
                train_p, held_p = raw[train], raw[held]
            t = threshold(y[train], train_p)
            oof[held] = held_p
            for i in held:
                thresholds[i] = t
            audit.append({'trainIDs': [usable[i]['id'] for i in train], 'heldIDs': [usable[i]['id'] for i in held],
                          'threshold': t})
        variants[name] = {'kind': 'linear' if view else 'zero-shot', 'view': view, 'C': c,
                          'devOOF': metrics(y, oof, thresholds, [r['group'] for r in usable]), 'folds': audit}
    eligible = [name for name in variants if variants[name]['kind'] == 'linear']
    best_linear = None
    if eligible:
        best = min(variants[n]['devOOF']['brier'] for n in eligible)
        best_linear = min((n for n in eligible if variants[n]['devOOF']['brier'] <= best + 1e-12),
                          key=lambda n: (variants[n]['C'], SPEC['linearViews'].index(variants[n]['view'])))
    if len(y):
        best = min(v['devOOF']['brier'] for v in variants.values())
        def complexity(name):
            v = variants[name]
            return (1, v['C'], SPEC['linearViews'].index(v['view'])) if v['kind'] == 'linear' else (0, name != 'zero_full', 0)
        chosen = min((n for n in variants if variants[n]['devOOF']['brier'] <= best + 1e-12), key=complexity)
    else:
        chosen = 'zero_full'
    # Retain the best linear comparison even when a fixed baseline wins.
    final_models = {}
    final_probabilities = dict(zeros)
    if best_linear:
        variant = variants[best_linear]
        x = linear_features(embeddings, variant['view'])
        fitted = fit_linear(x[idx], y, variant['C'])
        final_models[best_linear] = fitted
        final_probabilities[best_linear] = linear_predict(x, fitted)
    final_thresholds = {name: threshold(y, p[idx]) for name, p in final_probabilities.items()}
    payload = {'bindings': bindings, 'status': 'HOLD' if reasons else 'EXPERIMENTAL_LINEAR_FIT',
               'holdReasons': sorted(set(reasons)), 'support': info, 'selected': chosen,
               'bestLinear': best_linear,
               'selectionPolicy': 'all candidates: minimum dev OOF Brier; ties 1e-12: zero_full, zero_max10, lower C, full',
               'variants': variants, 'linearModels': final_models, 'thresholds': final_thresholds,
               'devLabelsSHA256': digest(labels), 'labelCaveat': AI_CAVEAT, 'productionPromotion': False}
    if sha(labels_path) != label_hash:
        raise ExperimentError('Annotations changed during selection')
    write_lock(run / 'selection.json', payload)
    return payload


def evaluate(run, labels_path):
    import numpy as np
    import importlib.metadata
    run = output_path(run)
    prepared = verified_prepare(run)
    timing = {}
    embeddings, probabilities, feature_lock = load_features(run, prepared, timing)
    selected = read_lock(run / 'selection.json')
    bindings = {'prepareSHA256': digest(prepared), 'featuresSHA256': digest(feature_lock),
                'labelsSHA256': sha(labels_path), 'implementation': implementation_identity(),
                'sklearnVersion': importlib.metadata.version('scikit-learn')}
    if selected['bindings'] != bindings:
        raise ExperimentError('Selection lock does not match current inputs/scores/labels')
    attempt = {'bindings': bindings, 'selectionSHA256': digest(selected)}
    if (run / 'report.json').exists():
        report = read_lock(run / 'report.json')
        if report['attempt'] != attempt or read_lock(run / 'evaluation-attempt.json') != attempt:
            raise ExperimentError('Evaluated report inputs changed')
        return report
    # Reserve the test before parsing outcomes; a failed attempt cannot be used
    # to select again or evaluate with changed annotation bytes.
    write_lock(run / 'evaluation-attempt.json', attempt)
    if digest(read_labels(labels_path, prepared, 'dev')) != selected['devLabelsSHA256']:
        raise ExperimentError('Development labels changed')
    labels = read_labels(labels_path, prepared, 'test')
    rows = [r for r in prepared['rows'] if r['partition'] == 'test']
    usable = [r for r in rows if labels[r['id']]['label'] is not None]
    indices = {identity: i for i, identity in enumerate(feature_lock['ids'])}
    idx = np.array([indices[r['id']] for r in usable], dtype=int)
    y = [labels[r['id']]['label'] for r in usable]
    start = time.perf_counter()
    for name, model in selected['linearModels'].items():
        view = selected['variants'][name]['view']
        probabilities[name] = linear_predict(linear_features(embeddings, view), model)
    head_seconds = time.perf_counter() - start
    results = {name: metrics(y, p[idx], [selected['thresholds'][name]] * len(y), [r['group'] for r in usable])
               for name, p in probabilities.items()}
    info = support(rows, labels)
    holds = list(selected['holdReasons'])
    if info['positives'] < 20 or info['positiveGroups'] < 4:
        holds.append('INSUFFICIENT_TEST_POSITIVE_SUPPORT')
    if not info['negatives']:
        holds.append('NO_TEST_NEGATIVES')
    report = {'attempt': attempt, 'labelCaveat': AI_CAVEAT, 'productionPromotion': False,
              'status': 'HOLD' if holds else 'OFFLINE_FEASIBILITY_ONLY', 'holdReasons': sorted(set(holds)),
              'devSupport': selected['support'], 'testSupport': info, 'selected': selected['selected'],
              'testMetrics': results, 'exclusions': [{'id': r['id'], 'reasons': r['excluded']}
                                                     for r in prepared['rows'] if r['excluded']],
              'hostLatency': {'extraction': feature_lock['hostLatency'],
                              'zeroShotContrastSeconds': timing['zeroShotContrastSeconds'],
                              'linearHeadPredictionSeconds': head_seconds if selected['linearModels'] else None,
                              'linearHeadPredictionImages': len(feature_lock['ids']) if selected['linearModels'] else 0,
                              'scope': 'host only; metrics and file IO excluded; not physical-phone latency'},
              'interpretation': 'Small source-group test with AI labels; no learning or deployment claim follows automatically.'}
    report['scoreInterpretation'] = 'Experimental sigmoid contrast/logistic scores; calibration has not been independently validated.'
    if sha(labels_path) != bindings['labelsSHA256']:
        raise ExperimentError('Annotations changed during test evaluation')
    write_lock(run / 'report.json', report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('prepare', 'features', 'select', 'evaluate'):
        p = sub.add_parser(command)
        p.add_argument('--run', type=Path, required=True, help='New experiment directory outside Git')
        if command == 'prepare':
            p.add_argument('--dataset', type=Path, required=True)
        if command in ('select', 'evaluate'):
            p.add_argument('--labels', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'prepare':
            result = prepare(args.dataset, args.run)
            result = {'prepareSHA256': digest(result), 'manifestSHA256': result['inputs']['manifestSHA256'],
                      'partitionCounts': {part: sum(r['partition'] == part for r in result['rows'])
                                          for part in ('dev', 'test', 'excluded')}}
        elif args.command == 'features':
            result = features(args.run)
        else:
            result = globals()[args.command](args.run, args.labels)
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0
    except (ValueError, OSError, KeyError, RuntimeError) as exc:
        print(json.dumps({'error': str(exc), 'productionPromotion': False}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
