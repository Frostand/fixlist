"""Synthetic workflow/integrity tests; no real model or image-quality evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

try:
    import numpy as np
except ModuleNotFoundError as exc:
    if exc.name != 'numpy':
        raise
    np = None

HAS_SKLEARN = importlib.util.find_spec('sklearn') is not None
requires_numpy = unittest.skipIf(np is None, 'Optional synthetic feature-cache tests require numpy')
missing_training = [name for name, available in [('numpy', np is not None), ('scikit-learn', HAS_SKLEARN)] if not available]
requires_training = unittest.skipIf(
    bool(missing_training),
    'Optional floor-object training/evaluation tests require ' + ', '.join(missing_training)
    + '; run with ~/.local/share/fixlist-scan/clip/venv/bin/python',
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ondevice'))
import floor_objects as f


class Fixture:
    def __init__(self, root, groups=12, per_group=8):
        self.dataset, self.run = root / 'data', root / 'run'
        (self.dataset / 'images').mkdir(parents=True)
        self.weights = root / 'synthetic-weights.bin'
        self.weights.write_bytes(b'synthetic weights; never a real encoder')
        self.rows = []
        for group in range(groups):
            for item in range(per_group):
                identity = f'{group:02}-{item:02}'
                path = self.dataset / 'images' / (identity + '.bin')
                path.write_bytes(('unique synthetic image ' + identity).encode())
                self.rows.append({'id': identity, 'file': path.name, 'source_group': f'source-{group}',
                                  'creator': f'Creator {group}', 'license': 'synthetic test fixture',
                                  'sha256': f.sha(path), 'query': 'untrusted positive search phrase', 'label': True})
        self.write_manifest()
        (self.dataset / 'protocol.json').write_text(json.dumps({'target': f.TARGET, 'objective': 'synthetic only'}))

    def write_manifest(self):
        (self.dataset / 'manifest.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in self.rows))

    def prepare(self):
        self.prepared = f.prepare(self.dataset, self.run)
        return self.prepared

    def labels(self, transform=None, path=None):
        records = []
        for row in self.prepared['rows']:
            value = int(row['id'].split('-')[1]) % 2 == 0
            record = {'id': row['id'], 'target': f.TARGET, 'label': value,
                      'manifestSHA256': self.prepared['inputs']['manifestSHA256'],
                      'reviewer': 'synthetic fixture, not a human or AI annotation', 'uncertainty': False}
            records.append(transform(row, record) if transform else record)
        path = path or self.dataset / 'labels-ai.jsonl'
        path.write_text(''.join(json.dumps(r) + '\n' for r in records))
        return path

    def features(self, baseline_perfect=False):
        rows = [r for r in self.prepared['rows'] if not r['excluded']]
        rng = np.random.default_rng(7)
        x = rng.normal(0, .01, (len(rows), 10, 512)).astype(np.float32)
        for i, row in enumerate(rows):
            y = int(row['id'].split('-')[1]) % 2 == 0
            x[i, :, 1] = 1 if y else -1
            x[i, :, 0] = (1 if y else -1) if baseline_perfect else .001 * (i + 1)
        x /= np.linalg.norm(x, axis=2, keepdims=True)
        contrast = np.zeros(512, dtype=np.float32)
        contrast[0] = 1
        identity = f.cache_identity(self.prepared, f.sha(self.weights),
                                    {'synthetic': True, 'mean': (.5, .5, .5), 'versions': f.extraction_versions()})
        return f.write_features(self.run, self.prepared, x, contrast, 16, identity,
                                {'scope': 'synthetic fixture; no encoder executed'})


class FloorObjectTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.data = Fixture(self.root)
        self.weights_patch = patch.object(f, 'cached_weights', return_value=self.data.weights)
        self.weights_patch.start()
        self.addCleanup(self.weights_patch.stop)
        # These embeddings are generated arrays, not encoder output. Fixture
        # metadata must not require installed torch/OpenCLIP/Core ML packages.
        versions_patch = patch.object(f, 'extraction_versions', return_value={'syntheticFixture': 'no encoder executed'})
        versions_patch.start()
        self.addCleanup(versions_patch.stop)

    def ready(self, baseline_perfect=False, transform=None):
        self.data.prepare()
        labels = self.data.labels(transform)
        self.data.features(baseline_perfect)
        return labels

    def test_prepare_is_label_blind_deterministic_and_rejects_exact_duplicates(self):
        (self.data.dataset / 'labels-ai.jsonl').write_text('THIS MUST NOT BE READ')
        first = self.data.prepare()
        self.assertEqual(first, f.prepare(self.data.dataset, self.data.run))
        (self.data.dataset / 'labels-ai.jsonl').unlink()
        second_run = self.root / 'another-run'
        self.assertEqual(first, f.prepare(self.data.dataset, second_run))
        a, b = self.data.rows[:2]
        target = self.data.dataset / 'images' / b['file']
        target.write_bytes((self.data.dataset / 'images' / a['file']).read_bytes())
        b['sha256'] = a['sha256']
        self.data.write_manifest()
        with self.assertRaisesRegex(f.ExperimentError, 'exact hash duplicate'):
            f.prepare(self.data.dataset, self.root / 'duplicate-run')

    def test_creator_source_room_and_near_hash_components_cannot_cross_partitions(self):
        rows = self.data.rows
        # Distinct declared source groups must still merge through creator,
        # a room/source link, and then a near-hash connection, transitively.
        rows[8]['creator'] = rows[0]['creator']
        rows[8]['room_group'] = rows[16]['room_group'] = 'same physical room'
        rows[16]['sourceURLs'] = rows[24]['sourceURLs'] = ['https://example.org/room/42?utm_source=test']
        rows[24]['phash64'], rows[32]['phash64'] = '1111111111111111', '1111111111111113'
        self.data.write_manifest()
        prepared = self.data.prepare()
        connected = [r for r in prepared['rows'] if int(r['id'].split('-')[0]) <= 4]
        self.assertEqual(len({r['partition'] for r in connected}), 1)
        self.assertEqual(len({r['group'] for r in connected}), 1)
        for key in ('creator', 'source_group'):
            assigned = {}
            original = {r['id']: r for r in self.data.rows}
            for row in prepared['rows']:
                assigned.setdefault(original[row['id']][key], set()).add(row['partition'])
            self.assertTrue(all(len(parts) == 1 for parts in assigned.values()))
        # Even a re-signed but edited split must fail deterministic reconstruction.
        payload = copy.deepcopy(prepared)
        payload['rows'][0]['partition'] = 'test' if payload['rows'][0]['partition'] == 'dev' else 'dev'
        (self.data.run / 'prepare.json').unlink()
        f.write_lock(self.data.run / 'prepare.json', payload)
        with self.assertRaisesRegex(f.ExperimentError, 'split changed'):
            f.verified_prepare(self.data.run)

    def test_provenance_exclusions_and_dev_only_supplement_preserve_base_test(self):
        self.data.rows[0]['license_issues'] = ['license needs review']
        (self.data.dataset / 'summary.json').write_text(json.dumps({'retained_license_review_flags': [{'id': '00-01'}]}))
        self.data.write_manifest()
        original = self.data.prepare()
        self.assertEqual({r['id'] for r in original['rows'] if r['excluded']}, {'00-00', '00-01'})
        base_roles = {r['id']: r['partition'] for r in original['rows']}
        for i in range(3):
            path = self.data.dataset / 'images' / f'supplement-{i}.bin'
            path.write_bytes(f'new disjoint dev-only bytes {i}'.encode())
            self.data.rows.append({'id': f'extra-{i}', 'file': path.name, 'sha256': f.sha(path),
                                   'license': 'synthetic', 'source_group': f'new-creator-{i}', 'development_only': True})
        self.data.write_manifest()
        combined = f.prepare(self.data.dataset, self.root / 'combined-run')
        for row in combined['rows']:
            self.assertEqual(row['partition'], base_roles.get(row['id'], 'dev'))
        self.data.rows[-1]['source_group'] = self.data.rows[8]['source_group']
        self.data.write_manifest()
        with self.assertRaisesRegex(f.ExperimentError, 'supplement overlaps'):
            f.prepare(self.data.dataset, self.root / 'overlap-run')

    @requires_training
    def test_selection_never_decodes_test_outcomes_and_thresholds_ignore_fold_held_labels(self):
        labels = self.ready()
        original_loads = json.loads
        test_ids = {r['id'] for r in self.data.prepared['rows'] if r['partition'] == 'test'}
        def guarded_loads(value, *args, **kwargs):
            if isinstance(value, str) and value.startswith('{') and '"label"' in value and '"manifestSHA256"' in value:
                parsed = original_loads(value)
                if parsed.get('id') in test_ids:
                    raise AssertionError('Selection decoded a test annotation')
            return original_loads(value, *args, **kwargs)
        with patch.object(f.json, 'loads', side_effect=guarded_loads):
            first = f.select(self.data.run, labels)
        # Perturb only one dev validation fold. Its thresholds and linear fold
        # models must remain independent of its labels, for every C and view.
        original_run = self.data.run
        second_run = self.root / 'changed-held-labels'
        self.data.run = second_run
        self.data.prepare()
        held_fold = 0
        def flip(row, record):
            if row['partition'] == 'dev' and row['fold'] == held_fold:
                record['label'] = not record['label']
            return record
        changed = self.data.labels(flip, self.data.dataset / 'changed-labels.jsonl')
        self.data.features()
        second = f.select(second_run, changed)
        for name, variant in first['variants'].items():
            audit = variant['folds'][held_fold]
            self.assertEqual(audit, second['variants'][name]['folds'][held_fold])
            row_map = {r['id']: r for r in self.data.prepared['rows']}
            train_groups = {row_map[i]['group'] for i in audit['trainIDs']}
            held_groups = {row_map[i]['group'] for i in audit['heldIDs']}
            self.assertTrue(train_groups.isdisjoint(held_groups))
            self.assertTrue(set(audit['trainIDs']).isdisjoint(test_ids))
        self.assertTrue((original_run / 'selection.json').exists())

    @requires_numpy
    def test_cache_rejects_changed_image_weights_protocol_or_preprocessing(self):
        for change in ('image', 'weights', 'protocol', 'preprocess'):
            with self.subTest(change=change):
                fixture = Fixture(self.root / change)
                with patch.object(f, 'cached_weights', return_value=fixture.weights):
                    prepared = fixture.prepare()
                    fixture.features()
                    if change == 'image':
                        (fixture.dataset / 'images' / fixture.rows[0]['file']).write_bytes(b'changed image')
                    elif change == 'weights':
                        fixture.weights.write_bytes(b'changed weights at same path')
                    elif change == 'protocol':
                        (fixture.dataset / 'protocol.json').write_text(json.dumps({'target': f.TARGET, 'objective': 'changed'}))
                    else:
                        with patch.object(f, 'extraction_versions', return_value={'different': 'preprocessor'}):
                            with self.assertRaisesRegex(f.ExperimentError, 'preprocessing/package'):
                                f.load_features(fixture.run, prepared)
                        continue
                    with self.assertRaises(f.ExperimentError):
                        current = f.verified_prepare(fixture.run)
                        f.load_features(fixture.run, current)

    @requires_numpy
    def test_cached_feature_metadata_reuse_preserves_bytes_and_json_types(self):
        self.data.prepare()
        first = self.data.features()
        archive = self.data.run / first['file']
        before = (archive.stat().st_mtime_ns, archive.read_bytes())
        self.assertEqual(first, f.features(self.data.run))
        self.assertEqual(before, (archive.stat().st_mtime_ns, archive.read_bytes()))

    @requires_training
    def test_insufficient_positive_and_single_class_holds_never_fake_a_fit(self):
        for case in ('few', 'single-class', 'ambiguous'):
            with self.subTest(case=case):
                fixture = Fixture(self.root / case)
                with patch.object(f, 'cached_weights', return_value=fixture.weights):
                    fixture.prepare()
                    def transform(row, record):
                        record['label'] = None if case == 'ambiguous' else True if case == 'single-class' else row['id'].endswith('-00')
                        return record
                    labels = fixture.labels(transform)
                    fixture.features()
                    with patch.object(f, 'fit_linear', side_effect=AssertionError('HOLD must not fit')):
                        selected = f.select(fixture.run, labels)
                    self.assertEqual(selected['status'], 'HOLD')
                    self.assertFalse(selected['linearModels'])
                    self.assertEqual(set(selected['variants']), {'zero_full', 'zero_max10'})
                    reason = {'few': 'FEWER_THAN_20_DEV_POSITIVE_IMAGES', 'single-class': 'CV_TRAINING_FOLD_SINGLE_CLASS',
                              'ambiguous': 'FEWER_THAN_20_DEV_POSITIVE_IMAGES'}[case]
                    self.assertIn(reason, selected['holdReasons'])
                    report = f.evaluate(fixture.run, labels)
                    self.assertFalse(report['productionPromotion'])
                    self.assertEqual(report['status'], 'HOLD')
                    self.assertEqual(report['testSupport']['coverage'], 0 if case == 'ambiguous' else 1)

    @requires_training
    def test_actual_sklearn_training_smoke_on_synthetic_features_only(self):
        labels = self.ready()
        selected = f.select(self.data.run, labels)
        self.assertEqual(selected['status'], 'EXPERIMENTAL_LINEAR_FIT')
        self.assertEqual(len(selected['variants']), 8)
        model = next(iter(selected['linearModels'].values()))
        self.assertGreater(model['coef'][1], .1)
        self.assertGreater(model['iterations'], 0)
        self.assertTrue(selected['selected'].startswith('linear_'))
        report = f.evaluate(self.data.run, labels)
        score = report['testMetrics'][selected['selected']]
        self.assertEqual(score['auroc'], 1)
        self.assertLess(score['brier'], .1)
        self.assertEqual(score['confusion']['fp'], 0)
        self.assertFalse(report['productionPromotion'])
        self.assertIn('synthetic', report['hostLatency']['extraction']['scope'])

    @requires_training
    def test_worse_trained_head_cannot_displace_better_fixed_baseline(self):
        labels = self.ready(baseline_perfect=True)
        selected = f.select(self.data.run, labels)
        self.assertTrue(selected['linearModels'], 'This regression must actually fit sklearn heads')
        self.assertEqual(selected['selected'], 'zero_full')
        best = selected['variants'][selected['bestLinear']]['devOOF']['brier']
        self.assertGreater(best, selected['variants']['zero_full']['devOOF']['brier'])
        report = f.evaluate(self.data.run, labels)
        self.assertIn(selected['bestLinear'], report['testMetrics'])
        self.assertEqual(report['selected'], 'zero_full')

    @requires_training
    def test_cache_score_and_selection_tamper_and_post_test_reselection_rejected(self):
        labels = self.ready()
        f.select(self.data.run, labels)
        report = f.evaluate(self.data.run, labels)
        bytes_before = (self.data.run / 'report.json').read_bytes()
        self.assertEqual(report, f.evaluate(self.data.run, labels))
        self.assertEqual(bytes_before, (self.data.run / 'report.json').read_bytes())
        self.assertEqual(f.select(self.data.run, labels)['selected'], report['selected'])
        changed = self.data.dataset / 'changed-labels.jsonl'
        changed.write_bytes(labels.read_bytes() + b'\n')
        with self.assertRaisesRegex(f.ExperimentError, 'Selection locked'):
            f.select(self.data.run, changed)
        with self.assertRaisesRegex(f.ExperimentError, 'Selection lock'):
            f.evaluate(self.data.run, changed)
        selection_path = self.data.run / 'selection.json'
        original_selection = selection_path.read_bytes()
        selection = json.loads(original_selection)
        selection['payload']['thresholds']['zero_full'] = .99
        selection_path.write_text(json.dumps(selection))
        with self.assertRaisesRegex(f.ExperimentError, 'tamper'):
            f.evaluate(self.data.run, labels)
        selection_path.write_bytes(original_selection)
        metadata = f.read_lock(self.data.run / 'features.json')
        archive = self.data.run / metadata['file']
        original_features = archive.read_bytes()
        archive.write_bytes(original_features + b'altered old scores')
        with self.assertRaisesRegex(f.ExperimentError, 'cache bytes changed'):
            f.select(self.data.run, labels)
        archive.write_bytes(original_features)
        selection_path.unlink()
        with self.assertRaisesRegex(f.ExperimentError, 'no new selection'):
            f.select(self.data.run, labels)

    def test_annotation_target_manifest_binding_and_null_semantics(self):
        self.data.prepare()
        for field, value in [('target', 'some other task'), ('manifestSHA256', 'wrong'), ('label', 1)]:
            with self.subTest(field=field):
                labels = self.data.labels(lambda row, record: {**record, field: value})
                with self.assertRaises(f.ExperimentError):
                    f.read_labels(labels, self.data.prepared, 'dev')
        labels = self.data.labels(lambda row, record: {**record, 'label': None})
        read = f.read_labels(labels, self.data.prepared, 'dev')
        self.assertTrue(all(r['label'] is None for r in read.values()))

    def test_cli_prepare_and_help_do_not_import_ml_or_load_labels(self):
        result = subprocess.run([sys.executable, str(Path(f.__file__)), 'prepare', '--dataset', str(self.data.dataset),
                                 '--run', str(self.data.run)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sum(json.loads(result.stdout)['partitionCounts'].values()), len(self.data.rows))
        code = "import sys; sys.path.insert(0, sys.argv[1]); import floor_objects; assert not any(x in sys.modules for x in ('torch','open_clip','sklearn','numpy'))"
        result = subprocess.run([sys.executable, '-c', code, str(Path(f.__file__).parent)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
