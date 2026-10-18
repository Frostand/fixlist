"""Deterministic calibration/evaluation tests; no private inputs or live model."""
import copy
from io import StringIO
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import evaluate_model as e
import evaluation_stats as stats
import suggest as s


def response(request, value=.8):
    return {'model': 'fake-evaluation-model', 'answers': {
        key: {'type': 'noul', 'noul': .9 if key.startswith('relevance.') else value}
        for key in request['questions']}}


class MetricTests(unittest.TestCase):
    def test_request_signature_binds_think_mode_image_limit_and_photo_questions(self):
        catalog = s.load_questions()
        signature = e.request_signature(catalog, 'never')
        self.assertNotEqual(signature, e.request_signature(catalog, 'auto'))
        with patch.object(s, 'REVIEW_IMAGE_MAX_EDGE', 512):
            self.assertNotEqual(signature, e.request_signature(catalog, 'never'))
        changed = copy.deepcopy(catalog)
        changed[0]['question'] += ' Changed visible proxy.'
        self.assertNotEqual(signature, e.request_signature(changed, 'never'))

    def test_hand_computed_brier_ece_auroc_auprc(self):
        m = stats.metric_values([0, 0, 1, 1], [.1, .2, .8, .9])
        self.assertEqual(m['n'], 4)
        self.assertEqual(m['positives'], 2)
        self.assertAlmostEqual(m['brier'], .025)
        self.assertAlmostEqual(m['ece'], .15)
        self.assertEqual(m['auroc'], 1)
        self.assertEqual(m['auprc'], 1)
        m = stats.metric_values([0, 1, 1, 0], [.1, .4, .35, .8])
        self.assertEqual(m['auroc'], .5)
        self.assertAlmostEqual(m['auprc'], 7 / 12)

    def test_ties_endpoints_bins_and_undefined_metrics(self):
        m = stats.metric_values([0, 1], [.5, .5])
        self.assertEqual(m['auroc'], .5)
        self.assertEqual(m['auprc'], .5)
        self.assertEqual(m['ece'], 0)
        self.assertEqual(stats.metric_values([0, 1], [0, 1])['ece'], 0)
        self.assertIsNone(stats.metric_values([1, 1], [.1, .2])['auroc'])
        self.assertEqual(stats.metric_values([1, 1], [.1, .2])['auprc'], 1)
        self.assertIsNone(stats.metric_values([0, 0], [.1, .2])['auprc'])
        self.assertIsNone(stats.metric_values([], [])['brier'])
        for y, p in [([1], [float('nan')]), ([.5], [.3]), ([0, 1], [.3]), ([0], [-.1])]:
            with self.assertRaises(s.SuggestionError):
                stats.metric_values(y, p)

    def test_grouped_bootstrap_is_paired_and_counts_undefined_draws(self):
        rows = [{'group': 'one', 'label': 0, 'raw': .2}, {'group': 'two', 'label': 1, 'raw': .8}]
        report = stats.comparison_report(rows, [.1, .9], seed=7)
        self.assertAlmostEqual(report['raw']['brier']['value'], .04)
        self.assertAlmostEqual(report['calibrated']['brier']['value'], .01)
        np.testing.assert_allclose(report['pairedBrierDifference']['ci95'], [-.03, -.03])
        self.assertLess(report['raw']['auroc']['definedResamples'], 1000)
        self.assertEqual(report['raw']['brier']['definedResamples'], 1000)
        self.assertTrue(report['insufficientPositives'])
        self.assertEqual(report, stats.comparison_report(rows, [.1, .9], seed=7))

    def test_adoption_requires_all_three_pre_registered_conditions(self):
        raw = {'brier': .2, 'auroc': .8}
        cal = {'brier': .18, 'auroc': .79}
        self.assertTrue(stats.adoption_rule(raw, cal, [-.04, -.01]))
        self.assertFalse(stats.adoption_rule(raw, cal, [-.04, .001]))
        self.assertFalse(stats.adoption_rule(raw, cal, [-.04, 0]))
        self.assertFalse(stats.adoption_rule(raw, {'brier': .18, 'auroc': .77}, [-.04, -.01]))
        self.assertFalse(stats.adoption_rule(raw, {'brier': .21, 'auroc': .9}, [-.04, -.01]))
        self.assertFalse(stats.adoption_rule(raw, {'brier': .18, 'auroc': None}, [-.04, -.01]))


class FittingTests(unittest.TestCase):
    def test_groups_do_not_cross_holdout_or_cv_folds(self):
        groups = [f'g{i:02d}' for i in range(20)] * 3
        dev, held = stats.group_holdout(groups, seed=7)
        self.assertEqual(len(held), 6)
        self.assertFalse(set(dev) & set(held))
        self.assertEqual(set(dev) | set(held), set(groups))
        self.assertEqual((dev, held), stats.group_holdout(list(reversed(groups)), seed=7))
        folds = stats.grouped_folds(dev)
        self.assertEqual(len(folds), 5)
        self.assertEqual(sorted(g for fold in folds for g in fold), dev)
        for fold in folds:
            self.assertFalse(set(fold) & set(held))
        with self.assertRaises(s.SuggestionError):
            stats.grouped_folds(['one', 'two'])

    def test_platt_recovers_known_parameters_on_synthetic_data(self):
        rng = np.random.default_rng(49)
        raw = stats.sigmoid(rng.normal(0, 1.5, 40_000))
        truth = stats.mapped(raw, {'a': 1.6, 'b': -.4})
        labels = rng.binomial(1, truth)
        fit = stats.fit_platt(raw, labels)
        self.assertAlmostEqual(fit['a'], 1.6, delta=.06)
        self.assertAlmostEqual(fit['b'], -.4, delta=.06)
        exact = stats.fit_platt(raw, truth)
        self.assertAlmostEqual(exact['a'], 1.6, places=6)
        self.assertAlmostEqual(exact['b'], -.4, places=6)

    def test_sparse_items_shrink_to_global_and_single_classes_remain_finite(self):
        prior = {'a': 1.4, 'b': -.3}
        self.assertEqual(stats.fit_platt([], [], prior=prior, l2=1), prior)
        fit = stats.fit_platt([.9], [0], prior=prior, l2=1)
        self.assertGreater(fit['a'], 0)
        self.assertGreater(fit['b'], -2)
        for labels in [[0] * 4, [1] * 4, [1, 1, 0, 0]]:
            params = stats.fit_platt([0, .2, .8, 1], labels)
            self.assertTrue(np.isfinite(list(params.values())).all())
            self.assertGreater(params['a'], 0)

    def test_positive_slope_constraint_still_optimizes_the_intercept(self):
        raw, labels = [.01, .5, .7], [1, 0, 0]
        fit = stats.fit_platt(raw, labels)
        self.assertAlmostEqual(fit['a'], 1e-6, places=9)
        self.assertAlmostEqual(fit['b'], np.log(.5), places=5)
        self.assertAlmostEqual(float(np.sum(stats.mapped(raw, fit) - labels)), 0, places=8)

    def test_selection_fits_only_development_groups(self):
        groups = [f'g{i}' for i in range(10)]
        dev, held = stats.group_holdout(groups)
        rows = [{'group': group, 'item': 'a', 'raw': score, 'label': label}
                for group in dev for score, label in [(.1, 0), (.9, 1)]]
        original = stats.fit_method
        fitted_groups = []
        def fit(train, method, ids):
            fitted_groups.append({row['group'] for row in train})
            return original(train, method, ids)
        with patch.object(stats, 'fit_method', side_effect=fit):
            method, scores, _ = stats.select_method(rows, dev, ['a'])
        self.assertIn(method, stats.METHODS)
        self.assertEqual(set(scores), set(stats.METHODS))
        self.assertTrue(all(not groups & set(held) for groups in fitted_groups))


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'images').mkdir()
        for name in ['model', 'runtime']:
            (self.root/name).mkdir()
            (self.root/name/'synthetic.bin').write_bytes(('synthetic '+name).encode())
        self.entries = [{'id': f'id{i}', 'file': f'{i}.jpg', 'group': f'scene{i // 2}',
                         'provenance': {'source': 'synthetic test', 'license': 'test only', 'nested': [i, None]}}
                        for i in range(3)]
        self.write_manifest()
        for row in self.entries:
            Image.new('RGB', (1400, 700), (10, 30, 50)).save(self.root / 'images' / row['file'])

    def write_manifest(self):
        (self.root / 'manifest.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in self.entries))

    def fake_client(self, fail_at=None):
        class Client:
            calls = []
            def decide(client, request):
                client.calls.append(request)
                if len(client.calls) == fail_at:
                    raise s.SuggestionError('simulated outage')
                return response(request)
        result = Client()
        result.model_dir, result.runtime_dir = self.root/'model', self.root/'runtime'
        return result

    def test_resumable_scoring_uses_same_request_and_passes_provenance(self):
        client = self.fake_client()
        self.assertEqual(e.score_dataset(self.root, client=client, limit=1, progress=lambda _: None), 1)
        first_bytes = (self.root / 'scores.jsonl').read_bytes()
        self.assertEqual(e.score_dataset(self.root, client=client, progress=lambda _: None), 2)
        self.assertTrue((self.root / 'scores.jsonl').read_bytes().startswith(first_bytes))
        self.assertEqual(e.score_dataset(self.root, client=client, progress=lambda _: None), 0)
        self.assertEqual(len(client.calls), 3)
        scores = e.read_jsonl(self.root / 'scores.jsonl')
        for original, scored in zip(self.entries, scores):
            self.assertEqual({k: v for k, v in scored.items() if k != 'scoring'}, original)
            self.assertEqual(scored['scoring']['model'], 'fake-evaluation-model')
            self.assertGreaterEqual(scored['scoring']['requestSeconds'], 0)
        request = client.calls[0]
        self.assertEqual(request, s.build_review_request(s.load_questions(), request['images'][0], 'never'))
        from io import BytesIO
        import base64
        with Image.open(BytesIO(base64.b64decode(request['images'][0].split(',')[1]))) as image:
            self.assertEqual(image.size, (1024, 512))

    def test_outage_preserves_completed_rows_and_resume_does_not_repeat_them(self):
        client = self.fake_client(fail_at=2)
        with self.assertRaisesRegex(s.SuggestionError, 'outage'):
            e.score_dataset(self.root, client=client, progress=lambda _: None)
        self.assertEqual(len(e.read_jsonl(self.root / 'scores.jsonl')), 1)
        client = self.fake_client()
        self.assertEqual(e.score_dataset(self.root, client=client, progress=lambda _: None), 2)
        self.assertEqual(len(client.calls), 2)

    def test_short_append_rolls_back_only_the_failed_line(self):
        path = self.root / 'scores.jsonl'
        e.append_score(path, {'id': 'one'})
        original = path.read_bytes()
        write = e.os.write
        with patch.object(e.os, 'write', side_effect=lambda descriptor, data: write(descriptor, data[:4])):
            with self.assertRaisesRegex(s.SuggestionError, 'Incomplete'):
                e.append_score(path, {'id': 'two'})
        self.assertEqual(path.read_bytes(), original)

    def test_resume_refuses_changed_metadata_model_request_and_truncated_rows(self):
        e.score_dataset(self.root, client=self.fake_client(), limit=1, progress=lambda _: None)
        path = self.root / 'scores.jsonl'
        original = path.read_bytes()
        scored = e.read_jsonl(path)[0]
        for mutation in [lambda r: r.update(group='wrong'),
                         lambda r: r['scoring'].update(model='wrong'),
                         lambda r: r['scoring'].update(requestSignature='wrong')]:
            changed = copy.deepcopy(scored)
            mutation(changed)
            path.write_text(json.dumps(changed) + '\n')
            with self.assertRaises(s.SuggestionError):
                e.score_dataset(self.root, client=self.fake_client(), progress=lambda _: None)
        for broken in [original + b'{"id":', original.rstrip(b'\n')]:
            path.write_bytes(broken)
            with self.assertRaises(s.SuggestionError):
                e.score_dataset(self.root, client=self.fake_client(), progress=lambda _: None)

    def test_labels_null_exclusion_and_not_relevant_is_negative(self):
        e.score_dataset(self.root, client=self.fake_client(), progress=lambda _: None)
        key = list(s.ITEM_LINKS)[0]
        labels = []
        for i, entry in enumerate(self.entries):
            row = {'id': entry['id'], **{item: {'relevant': None, 'condition': None} for item in s.ITEM_LINKS}}
            row[key] = [{'relevant': False, 'condition': None}, {'relevant': True, 'condition': True},
                        {'relevant': None, 'condition': True}][i]
            labels.append(row)
        path = self.root / 'labels.jsonl'
        path.write_text(''.join(json.dumps(r) + '\n' for r in labels))
        rows, _, _, _, _ = e.labeled_rows(self.root, path)
        self.assertEqual([r['label'] for r in rows], [0, 1])
        with patch('sys.stdout', new_callable=StringIO) as output:
            self.assertEqual(e.main(['report', '--dataset', str(self.root), '--labels', str(path)]), 0)
        self.assertIn('pooled', output.getvalue())
        self.assertIn('insufficient positives', output.getvalue())

    def test_manifest_rejects_duplicate_ids_remote_paths_and_symlink_escape(self):
        original = copy.deepcopy(self.entries)
        for file in ['../photo.jpg', '/photo.jpg', 'http://example.com/a.jpg']:
            self.entries[0]['file'] = file
            self.write_manifest()
            with self.assertRaises(s.SuggestionError):
                e.manifest(self.root)
        self.entries = copy.deepcopy(original)
        self.entries[1]['id'] = self.entries[0]['id']
        self.write_manifest()
        with self.assertRaises(s.SuggestionError):
            e.manifest(self.root)
        self.entries = original
        (self.root / 'images/escape.jpg').symlink_to(self.root / 'manifest.jsonl')
        self.entries[0]['file'] = 'escape.jpg'
        self.write_manifest()
        with self.assertRaises(s.SuggestionError):
            e.manifest(self.root)

    def test_real_fit_cli_on_synthetic_scores_and_round_trip_calibration(self):
        ids = list(s.ITEM_LINKS)
        self.entries = [{'id': f'id{i}', 'file': 'unused.jpg', 'group': f'group{i // 8:02d}',
                         'source': 'synthetic fixture'} for i in range(80)]
        self.write_manifest()
        Image.new('RGB', (4, 4)).save(self.root/'images/unused.jpg')
        scores, labels = [], []
        for i, entry in enumerate(self.entries):
            raw = [.05, .15, .3, .4, .6, .7, .85, .95][i % 8]
            req = s.build_review_request(s.load_questions(), 'unused', 'never')
            scores.append({**entry, 'scoring': {'model': 'fake-evaluation-model', 'requestSeconds': .1,
                          'requestSignature': e.request_signature(s.load_questions(), 'never'), 'response': response(req, raw),
                          'imageSHA256': e.file_sha256(self.root/'images/unused.jpg'),
                          'requestImageSHA256': e.prepared_image(self.root/'images/unused.jpg', 'unused.jpg')[1],
                          'modelIdentity': e.inference_identity(self.root/'model', self.root/'runtime')}})
            # Identical group-level distributions keep the fixture reproducible.
            truth = i % 8 in (1, 3, 5, 6, 7)
            labels.append({'id': entry['id'], **{key: {'relevant': True, 'condition': truth} for key in ids}})
        (self.root / 'scores.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in scores))
        label_path = self.root / 'labels.jsonl'
        label_path.write_text(''.join(json.dumps(row) + '\n' for row in labels))
        output = self.root / 'calibration.json'
        command = [sys.executable, str(Path(e.__file__)), 'fit', '--dataset', str(self.root),
                   '--labels', str(label_path), '--out', str(output), '--seed', '7', '--label-source', 'Synthetic test annotator']
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        doc = json.loads(output.read_text())
        self.assertEqual(doc['model'], 'fake-evaluation-model')
        self.assertEqual(doc['scoringConditions'], {
            'thinkMode': 'never', 'imageMaxEdge': 1024,
            'requestSignature': e.request_signature(s.load_questions(), 'never')})
        self.assertEqual(set(doc['selection']['cvBrier']), set(stats.METHODS))
        self.assertFalse(set(doc['split']['devGroups']) & set(doc['split']['heldOutGroups']))
        self.assertEqual(doc['calibration']['trainExamples'], 56)
        self.assertEqual(doc['calibration']['heldOutExamples'], 24)
        self.assertEqual(doc['calibration']['labelSource'], 'Synthetic test annotator')
        for item in ids:
            self.assertIn('insufficientPositives', doc['report']['items'][item])
            for metric in stats.METRICS:
                self.assertEqual(doc['report']['items'][item]['raw'][metric]['definedResamples'], 1000)
        s.validate_calibration(doc['calibration'], s.load_questions())
        self.assertEqual(s.load_calibration(output, force=True, think_mode='never'), doc)
        self.assertEqual(doc['calibration']['heldOutBrierRaw'], doc['report']['pooled']['raw']['brier']['value'])
        self.assertEqual(doc['calibration']['heldOutBrierCalibrated'], doc['report']['pooled']['calibrated']['brier']['value'])


if __name__ == '__main__':
    unittest.main()
