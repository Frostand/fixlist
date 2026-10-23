"""Injected-model local capture/CLI smoke tests. No services or real inference."""
import base64
import copy
from contextlib import redirect_stderr, redirect_stdout
from io import BytesIO, StringIO
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import capture_schema as c
import suggest as s
import suggest_capture as sc


PARITY = Path(__file__).with_name('capture-parity')


class InjectedModel:
    """Deliberately synthetic test answers; never used by the command itself."""
    def __init__(self, *, fail_at=None, malformed_at=None, changing_model=False, location_override=None):
        self.requests = []
        self.fail_at, self.malformed_at = fail_at, malformed_at
        self.changing_model, self.location_override = changing_model, location_override

    def decide(self, request):
        self.requests.append(copy.deepcopy(request))
        count = len(self.requests)
        if count == self.fail_at:
            raise s.SuggestionError('Injected interrupted request; no model was invoked.')
        answers = {}
        for key, question in request['questions'].items():
            if question['type'] == 'noul':
                # Highest raw evidence is irrelevant in p01; p02 is relevant and
                # lower. The second item is relevant but below threshold, and
                # stair clutter is never visible. Remaining catalog entries
                # intentionally include both display-excluded items.
                item_id = key.removeprefix('relevance.')
                if key.startswith('relevance.'):
                    value = 0 if item_id == 'stair-clutter-check' else .49 if item_id == 'rug-check' and count == 1 else .9
                else:
                    value = .2 if item_id == 'cord-check' else .99 if count == 1 else .8
                answers[key] = {'type': 'noul', 'noul': value}
            else:
                answer = {'type': 'choice', 'choice': 'bottom-left', 'confidence': .8,
                          'none_probability': .05,
                          'probabilities': {k: .84 if k == 'bottom-left' else .02 for k in s.GRID}}
                answer.update(self.location_override or {})
                answers[key] = answer
        if count == self.malformed_at:
            answers.pop(next(iter(answers)))
        return {'model': 'SYNTHETIC TEST MODEL - no inference' + (' changed' if self.changing_model and count > 1 else ''),
                'answers': answers}


class CapturePipelineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.path = self.root / 'export.fixlist-capture.json'
        self.bundle = json.loads((PARITY / 'valid-bundle.json').read_text())
        self.path.write_text(json.dumps(self.bundle))
        self.output = self.root / f'{self.bundle["captureId"]}.fixlist-flags.json'

    def run_pipeline(self, client=None, **kwargs):
        return sc.run_capture(self.path, no_calibration=True, client=client or InjectedModel(),
                              progress=lambda _: None, **kwargs)

    def calibration_fixture(self, *, adopted=True):
        weights, runtime = self.root / 'weights', self.root / 'runtime'
        weights.mkdir(exist_ok=True)
        runtime.mkdir(exist_ok=True)
        (weights / 'synthetic-weights.txt').write_text('No model weights; identity test only.')
        (runtime / 'synthetic-runtime.txt').write_text('No runtime; identity test only.')
        catalog = s.load_questions()
        fit = {'format': 'fixlist-photo-calibration', 'version': 1, 'adopted': adopted,
               'model': 'SYNTHETIC TEST MODEL - no inference',
               'modelIdentity': sc.inference_identity(weights, runtime),
               'scoringConditions': s.scoring_conditions(catalog, 'never'),
               'calibration': {'method': 'platt', 'parameters': {q['checklistItemId']: {'a': 1.1, 'b': -.1} for q in catalog},
                               'fittedAt': '2026-10-18T18:00:00Z', 'labelSource': 'Synthetic test labels; no model evidence',
                               'trainExamples': 10, 'heldOutExamples': 5, 'heldOutBrierRaw': .2, 'heldOutBrierCalibrated': .1}}
        path = self.root / 'synthetic-calibration.json'
        path.write_text(json.dumps(fit))
        return path, weights, runtime, fit

    def test_injected_model_complete_round_trip_and_exact_request_photo_preprocessing(self):
        client = InjectedModel()
        flags = self.run_pipeline(client)
        manifest = c.validate_capture_bundle(self.bundle).manifest
        c.validate_capture_suggestions(json.loads(self.output.read_text()), manifest, s.load_questions())
        self.assertEqual(flags['capture'], c.capture_binding(manifest))
        self.assertEqual(len(client.requests), 2 + 6)  # every photo + only suggested/relevant item localization
        self.assertEqual(list(client.requests[0]['questions']), list(s.build_review_request(s.load_questions(), '', 'never')['questions']))
        for request, source in zip(client.requests[:2], self.bundle['photos']):
            with Image.open(BytesIO(base64.b64decode(source['jpeg']))) as image:
                image = image.convert('RGB')
                image.thumbnail((s.REVIEW_IMAGE_MAX_EDGE,) * 2, Image.Resampling.LANCZOS)
                encoded = BytesIO()
                image.save(encoded, format='JPEG', quality=80)
            self.assertEqual(request['images'], ['data:image/jpeg;base64,' + base64.b64encode(encoded.getvalue()).decode()])
        rug, cord, stairs = flags['items'][:3]
        self.assertEqual((rug['score'], rug['bestPhotoId']), (.8, 'p02'))
        self.assertEqual(rug['point'], {'u': 16 / 6, 'v': 40 / 3})
        self.assertEqual(cord['status'], 'below-threshold')
        self.assertIsNone(cord['point'])
        self.assertEqual(stairs['status'], 'not-visible')
        self.assertIsNone(stairs['score'])
        self.assertEqual([item['checklistItemId'] for item in flags['items']], list(s.ITEM_LINKS))
        self.assertTrue({'handrail-check', 'stair-lighting-check'} <= {i['checklistItemId'] for i in flags['items']})
        self.assertEqual(list(self.root.glob('.fixlist-flags-*')), [])

    def test_cli_parser_and_pipeline_smoke_with_explicit_injected_client(self):
        client = InjectedModel()
        with patch.object(sc, 'DecisionClient', return_value=client), redirect_stdout(StringIO()):
            self.assertEqual(sc.main([str(self.path), '--no-calibration', '--retries', '0']), 0)
        self.assertTrue(self.output.is_file())
        self.assertEqual(len(client.requests), 8)
        c.validate_capture_suggestions(json.loads(self.output.read_text()), c.validate_capture_bundle(self.bundle).manifest,
                                       s.load_questions())

    def test_conservative_grid_gates_keep_photo_only(self):
        tests = [dict(none_probability=.2), dict(confidence=.69), dict(choice=None),
                 dict(probabilities={k: 1 / 9 for k in s.GRID}),
                 dict(probabilities={k: .59 if k == 'bottom-left' else .41 / 8 for k in s.GRID}),
                 dict(probabilities={k: .6 if k == 'bottom-left' else .4 if k == 'top-left' else 0 for k in s.GRID})]
        for override in tests:
            with self.subTest(override=override):
                flags = self.run_pipeline(InjectedModel(location_override=override))
                self.assertEqual(flags['items'][0]['status'], 'suggested')
                self.assertIsNone(flags['items'][0]['point'])

    def test_failed_malformed_or_model_changed_requests_preserve_prior_output(self):
        prior = b'PREVIOUS OUTPUT - must remain byte exact'
        for client in [InjectedModel(fail_at=2), InjectedModel(fail_at=3), InjectedModel(malformed_at=1),
                       InjectedModel(malformed_at=3), InjectedModel(changing_model=True)]:
            with self.subTest(client=client):
                self.output.write_bytes(prior)
                with self.assertRaises(s.SuggestionError):
                    self.run_pipeline(client)
                self.assertEqual(self.output.read_bytes(), prior)
                self.assertEqual(list(self.root.glob('.fixlist-flags-*')), [])

    def test_ambiguous_http_score_cannot_overwrite_prior_flags(self):
        client = s.DecisionClient(retries=0)
        request = s.build_review_request(s.load_questions(), '', 'never')
        payload = json.dumps(InjectedModel().decide(request)).encode()
        # A conflict where the last score would otherwise win and enter the
        # high-score path. Exercise the actual HTTP decoder, not a dict seam.
        payload = payload.replace(b'"noul": 0.99', b'"noul": 0.01, "noul": 0.99', 1)
        self.output.write_bytes(b'PRIOR FLAGS')
        with patch.object(client.opener, 'open', return_value=BytesIO(payload)):
            with self.assertRaisesRegex(s.SuggestionError, 'duplicate JSON'):
                self.run_pipeline(client)
        self.assertEqual(client.attempts, 1)
        self.assertEqual(self.output.read_bytes(), b'PRIOR FLAGS')
        self.assertEqual(list(self.root.glob('.fixlist-flags-*')), [])

    def test_bad_hash_malformed_partial_or_oversize_bundle_does_not_request_or_write(self):
        prior = b'PRIOR'
        invalid = copy.deepcopy(self.bundle)
        invalid['photos'][0]['sha256'] = '0' * 64
        for raw in [json.dumps(invalid).encode(), b'{', b'{"format":"fixlist-room-capture"}',
                    b' ' * (c.MAX_CAPTURE_BUNDLE_BYTES + 1)]:
            with self.subTest(size=len(raw)):
                self.path.write_bytes(raw)
                self.output.write_bytes(prior)
                client = InjectedModel()
                with self.assertRaises(s.SuggestionError):
                    self.run_pipeline(client)
                self.assertEqual(client.requests, [])
                self.assertEqual(self.output.read_bytes(), prior)

    def test_source_mutation_during_inference_preserves_output(self):
        self.output.write_bytes(b'PRIOR')
        client = InjectedModel()
        decide = client.decide
        def mutate(request):
            value = decide(request)
            if len(client.requests) == 1:
                self.path.write_text(json.dumps(self.bundle, indent=2))
            return value
        client.decide = mutate
        with self.assertRaisesRegex(s.SuggestionError, 'bytes changed'):
            self.run_pipeline(client)
        self.assertEqual(self.output.read_bytes(), b'PRIOR')

    def test_remote_urls_and_output_aliases_are_refused_before_model_requests(self):
        for url in ['https://127.0.0.1', 'http://example.com', 'http://localhost/path',
                    'http://127.0.0.1?x=1', 'http://me@localhost']:
            client = InjectedModel()
            with self.subTest(url=url), self.assertRaises(s.SuggestionError):
                self.run_pipeline(client, url=url)
            self.assertEqual(client.requests, [])
        for output in [self.path, self.root / 'symlink.json', self.root / 'hardlink.json']:
            if output.name == 'symlink.json':
                output.symlink_to(self.path)
            if output.name == 'hardlink.json':
                output.hardlink_to(self.path)
            client = InjectedModel()
            with self.subTest(output=output), self.assertRaises(s.SuggestionError):
                self.run_pipeline(client, output=output)
            self.assertEqual(client.requests, [])

    def test_location_threshold_never_localizes_below_suggestion_threshold(self):
        client = InjectedModel()
        flags = self.run_pipeline(client, threshold=1, location_threshold=0)
        self.assertEqual(len(client.requests), 2)
        self.assertTrue(all(item['point'] is None for item in flags['items']))

    def test_calibrated_injected_round_trip_requires_matching_content_identity_and_mapping(self):
        path, weights, runtime, fit = self.calibration_fixture()
        flags = sc.run_capture(self.path, calibration=path, model_dir=weights, runtime_dir=runtime,
                               client=InjectedModel(), progress=lambda _: None)
        self.assertEqual(flags['calibration'], fit['calibration'])
        self.assertEqual(flags['model']['identity'], fit['modelIdentity'])
        rug = flags['items'][0]
        self.assertEqual(rug['score'], s.platt_probability(.8, a=1.1, b=-.1))
        c.validate_capture_suggestions(flags, c.validate_capture_bundle(self.bundle).manifest, s.load_questions())

    def test_calibration_adoption_scoring_model_and_identity_mismatches_preserve_prior_output(self):
        path, weights, runtime, fit = self.calibration_fixture()
        cases = [lambda f: f.update(adopted=False), lambda f: f.update(model='wrong model'),
                 lambda f: f.pop('modelIdentity'),
                 lambda f: f['modelIdentity'].update(weightsSHA256='0' * 64),
                 lambda f: f['scoringConditions'].update(thinkMode='auto')]
        for mutate in cases:
            with self.subTest(mutate=mutate):
                value = copy.deepcopy(fit)
                mutate(value)
                path.write_text(json.dumps(value))
                self.output.write_bytes(b'PRIOR')
                with self.assertRaises(s.SuggestionError):
                    sc.run_capture(self.path, calibration=path, model_dir=weights, runtime_dir=runtime,
                                   client=InjectedModel(), progress=lambda _: None)
                self.assertEqual(self.output.read_bytes(), b'PRIOR')
        value = copy.deepcopy(fit)
        value['adopted'] = False
        path.write_text(json.dumps(value))
        flags = sc.run_capture(self.path, calibration=path, force_calibration=True,
                               model_dir=weights, runtime_dir=runtime, client=InjectedModel(), progress=lambda _: None)
        self.assertIsNotNone(flags['calibration'])
        self.output.write_bytes(b'PRIOR')
        with self.assertRaises(s.SuggestionError):
            sc.run_capture(self.path, calibration=path, force_calibration=True,
                           client=InjectedModel(), progress=lambda _: None)
        self.assertEqual(self.output.read_bytes(), b'PRIOR')

    def test_default_unadopted_fit_is_ignored_under_existing_policy(self):
        path, _, _, _ = self.calibration_fixture(adopted=False)
        with patch.object(s, 'DEFAULT_CALIBRATION', path):
            flags = sc.run_capture(self.path, client=InjectedModel(), progress=lambda _: None)
        self.assertIsNone(flags['calibration'])

    def test_model_runtime_mutation_during_requests_preserves_prior_output(self):
        _, weights, runtime, _ = self.calibration_fixture()
        self.output.write_bytes(b'PRIOR')
        client = InjectedModel()
        decide = client.decide
        def mutate(request):
            value = decide(request)
            if len(client.requests) == 1:
                (runtime / 'synthetic-runtime.txt').write_text('Changed test runtime bytes.')
            return value
        client.decide = mutate
        with self.assertRaisesRegex(s.SuggestionError, 'Model/runtime bytes changed'):
            self.run_pipeline(client, model_dir=weights, runtime_dir=runtime)
        self.assertEqual(self.output.read_bytes(), b'PRIOR')

    def test_partial_identity_configuration_is_refused(self):
        with self.assertRaisesRegex(s.SuggestionError, 'Provide both'):
            self.run_pipeline(model_dir=self.root)

    def test_cli_failures_keep_existing_file(self):
        self.output.write_bytes(b'PRIOR')
        with redirect_stderr(StringIO()):
            self.assertEqual(sc.main([str(self.path), '--no-calibration', '--url', 'http://example.com']), 2)
        self.assertEqual(self.output.read_bytes(), b'PRIOR')

    def test_atomic_failure_cleans_temporary_file_and_preserves_prior_output(self):
        self.output.write_bytes(b'PRIOR')
        with patch.object(sc.os, 'replace', side_effect=OSError('Injected disk failure')):
            with self.assertRaises(OSError):
                self.run_pipeline()
        self.assertEqual(self.output.read_bytes(), b'PRIOR')
        self.assertEqual(list(self.root.glob('.fixlist-flags-*')), [])


if __name__ == '__main__':
    unittest.main()
