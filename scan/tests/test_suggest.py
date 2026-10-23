"""Local suggestion tests. No model, torch, internet, or private media fixtures."""
import base64
import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import suggest as s
import evaluate_model as e


def make_scan(root):
    """A real on-disk COLMAP text model, read by pycolmap in the runner."""
    (root / 'work/dataset/images').mkdir(parents=True)
    sparse = root / 'work/dataset/sparse'
    sparse.mkdir()
    (root / 'scene.splat').write_bytes(bytes(32 * 10))
    (root / 'scene.json').write_text(json.dumps({'splatCount': 10}))
    (root / 'work/alignment.json').write_text(json.dumps({
        'rotationWorldToAligned': np.eye(3).tolist(),
        'sparseCenterOriginal': [1, 2, 3],
    }))
    (sparse / 'cameras.txt').write_text('1 PINHOLE 90 90 90 90 45 45\n')
    (sparse / 'images.txt').write_text(
        '1 1 0 0 0 0 0 0 1 000001.jpg\n45 45 1 45.15 45 2 45 45.15 3\n'
        '2 1 0 0 0 0 0 0 1 000002.jpg\n45 45 1 45.15 45 2 45 45.15 3\n')
    (sparse / 'points3D.txt').write_text('1 0 0 6 255 255 255 0 1 0 2 0\n2 .01 0 6 255 255 255 0 1 1 2 1\n3 0 .01 6 255 255 255 0 1 2 2 2\n')
    for name in ['000001.jpg', '000002.jpg']:
        Image.new('RGB', (90, 90), (60, 80, 100)).save(root / 'work/dataset/images' / name)


def fixture_response(request, probability=.8, relevance=.9, none=.1):
    answers = {}
    for key, question in request['questions'].items():
        if question['type'] == 'noul':
            answers[key] = {'type': 'noul', 'noul': relevance if key.startswith('relevance.') else probability}
        else:
            answers[key] = {'type': 'choice', 'choice': 'middle-center', 'confidence': .8,
                            'probabilities': {k: .84 if k == 'middle-center' else .02
                                              for k in question['criteria']}, 'none_probability': none}
    return {'answers': answers, 'model': 'fake-http-model', 'usage': {'input_tokens': 1, 'output_tokens': 0}}


class RequestTests(unittest.TestCase):
    def setUp(self):
        self.catalog = s.load_questions()

    def test_catalog_has_exact_app_links_and_photo_limits(self):
        self.assertEqual(len(self.catalog), 8)
        self.assertEqual({q['checklistItemId']: q['concernId'] for q in self.catalog}, s.ITEM_LINKS)
        for q in self.catalog:
            self.assertTrue(q['question'].endswith('?'))
            self.assertTrue(q['relevanceQuestion'])
            self.assertTrue(q['limitation'])

    def test_original_prompts_match_the_app_catalog(self):
        source = (Path(s.__file__).parents[1] / 'src/data/demo-scenario.ts').read_text()
        prompts = dict(re.findall(r"checklistId: '([^']+)'.*?prompt: '([^']+)'", source, re.S))
        self.assertEqual(len(prompts), len(self.catalog))
        for item in self.catalog:
            self.assertEqual(item['originalQuestion'], prompts[item['checklistItemId']])

    def test_serve_hint_expands_environment_at_runtime_and_quotes_paths(self):
        import shlex
        with patch.dict(s.os.environ, {'FIXLIST_DECIDE_BIN': '~/custom tools/decide', 'FIXLIST_MODEL_DIR': '~/models/test model'}):
            command = s.serve_command()
            self.assertEqual(shlex.split(command)[:4], [str(Path('~/custom tools/decide').expanduser()),
                             'serve', '--model', str(Path('~/models/test model').expanduser())])
            client = s.DecisionClient(retries=0)
            with patch.object(client.opener, 'open', side_effect=URLError('refused')):
                with self.assertRaises(s.SuggestionError) as error:
                    client.decide(s.build_review_request(self.catalog, 'x', 'never'))
            self.assertIn(command, str(error.exception))

    def test_documented_request_uses_one_marker_and_all_noul_questions(self):
        req = s.build_review_request(self.catalog, 'data:image/jpeg;base64,eA==', 'never')
        self.assertEqual(req['state'].count('<image>'), len(req['images']))
        self.assertEqual(len(req['questions']), 16)
        self.assertEqual(req['think_mode'], 'never')
        self.assertTrue(all(q['type'] == 'noul' and q['instructions'] for q in req['questions'].values()))
        self.assertEqual(req['questions']['rug-check']['instructions'], self.catalog[0]['question'])
        model, answers = s.parse_response(fixture_response(req), req['questions'])
        self.assertEqual(model, 'fake-http-model')
        self.assertEqual(answers['rug-check']['noul'], .8)

    def test_grid_choice_and_none_signal_are_separate(self):
        req = s.build_location_request(self.catalog[0], 'data:image/jpeg;base64,eA==', 'auto')
        self.assertEqual(set(req['questions']['location']['criteria']), set(s.GRID))
        self.assertTrue(req['allow_none'])
        self.assertTrue(req['none_check'])
        self.assertEqual(req['state'].count('<image>'), 1)
        response = fixture_response(req)
        _, answers = s.parse_response(response, req['questions'])
        self.assertEqual(s.parse_grid_choice(answers['location']), 'middle-center')
        for none in [.2, .9]:
            response = fixture_response(req, none=none)
            _, answers = s.parse_response(response, req['questions'])
            self.assertIsNone(s.parse_grid_choice(answers['location']))
        response = fixture_response(req)
        response['answers']['location']['choice'] = None
        _, answers = s.parse_response(response, req['questions'])
        self.assertIsNone(s.parse_grid_choice(answers['location']))

    def test_malformed_answers_fail_instead_of_becoming_low_probabilities(self):
        req = s.build_review_request(self.catalog, 'x', 'auto')
        for bad in [float('nan'), float('inf'), 10**400, -1, 1.1, True, '0.6', None]:
            response = fixture_response(req)
            response['answers']['rug-check']['noul'] = bad
            with self.subTest(bad=bad), self.assertRaises(s.SuggestionError):
                s.parse_response(response, req['questions'])
        response = fixture_response(req)
        del response['answers']['rug-check']
        with self.assertRaises(s.SuggestionError):
            s.parse_response(response, req['questions'])
        loc = s.build_location_request(self.catalog[0], 'x', 'auto')
        for field, value in [('choice', 'off-grid'), ('none_probability', None), ('confidence', 2),
                             ('probabilities', {'middle-center': 1})]:
            response = fixture_response(loc)
            response['answers']['location'][field] = value
            with self.subTest(field=field), self.assertRaises(s.SuggestionError):
                s.parse_response(response, loc['questions'])

    def test_only_loopback_http_and_no_credentials_or_redirects(self):
        for url in ['https://example.com', 'http://example.com', 'http://127.0.0.1.evil.test',
                    'http://user:secret@localhost', 'http://localhost/path', 'http://localhost?token=x']:
            with self.subTest(url=url), self.assertRaises(s.SuggestionError):
                s.DecisionClient(url)

    def test_localhost_is_pinned_to_numeric_loopback_before_transport(self):
        # A host-name allowlist alone still delegates the image destination to
        # name resolution. Keep localhost's usual IPv4 endpoint and custom port
        # while avoiding that dependency entirely.
        for url, expected in [('http://localhost:8091/', 'http://127.0.0.1:8091/v1/systemone'),
                              ('http://localhost', 'http://127.0.0.1/v1/systemone'),
                              ('http://[::1]:8092', 'http://[::1]:8092/v1/systemone')]:
            with self.subTest(url=url):
                self.assertEqual(s.DecisionClient(url).url, expected)

    def test_ambiguous_or_deeply_nested_json_response_is_refused(self):
        # These bytes are invalid/ambiguous model outputs, not low scores. In
        # particular the second noul must never override the first into a flag.
        payloads = [b'{"model":"one","model":"two","answers":{}}',
                    b'{"model":"one","answers":{"rug-check":{"type":"noul","noul":0,"noul":1}}}',
                    b'[' * 20000 + b'0' + b']' * 20000]
        client = s.DecisionClient(retries=0)
        request = s.build_review_request(self.catalog, 'unused synthetic photo', 'never')
        for raw in payloads:
            with self.subTest(raw=raw[:100]), patch.object(client.opener, 'open', return_value=BytesIO(raw)):
                with self.assertRaises(s.SuggestionError):
                    client.decide(request)


class GeometryTests(unittest.TestCase):
    def frame(self, points, rotation=None, translation=None):
        return s.Frame('frame.jpg', Path('/unused'), 90, 90, np.array([90., 90., 45., 45.]),
                       np.eye(3) if rotation is None else rotation,
                       np.zeros(3) if translation is None else translation, np.asarray(points, dtype=float).reshape(-1, 3))

    def test_even_keyframes_sorted_naturally_and_include_endpoints(self):
        names = ['10.jpg', '1.jpg', '3.jpg', '2.jpg', '4.jpg']
        self.assertEqual(s.select_keyframes(names, 3), ['1.jpg', '3.jpg', '10.jpg'])
        self.assertEqual(s.select_keyframes(names, 9), ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '10.jpg'])
        self.assertEqual(s.select_keyframes(['a'], 1), ['a'])
        for args in [([], 3), (names, 0), (names, True), (names, 201)]:
            with self.subTest(args=args), self.assertRaises(s.SuggestionError):
                s.select_keyframes(*args)

    def test_cell_center_ray_uses_median_camera_z_not_euclidean_distance(self):
        f = self.frame([[0, 0, 8], [.01, 0, 8.1], [0, .01, 7.9], [20, 20, 3], [0, 0, -1]])
        np.testing.assert_allclose(s.locate_in_frame(f, 'middle-center', np.eye(3), np.zeros(3)), [0, 0, 8])
        f = self.frame([[1.5, 1.5, 4.5], [1.51, 1.5, 4.51], [1.5, 1.51, 4.49]])
        np.testing.assert_allclose(s.locate_in_frame(f, 'bottom-right', np.eye(3), np.zeros(3)), [1.5, 1.5, 4.5])

    def test_world_pose_and_alignment_order(self):
        rotation = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0.]])
        # world [2,3,10] projects to the camera center at z=6.
        translation = np.array([-10., -3., 8.])
        f = self.frame([[2, 3, 10], [2.01, 3, 10], [2, 3.01, 10]], rotation, translation)
        align = np.array([[0, -1, 0], [1, 0, 0], [0, 0, 1.]])
        np.testing.assert_allclose(s.locate_in_frame(f, 'middle-center', align, np.array([1, 1, 1.])), [-2, 1, 9])

    def test_nearest_ray_fallback_and_missing_depth(self):
        f = self.frame([[0, 0, 9]])
        self.assertIsNone(s.locate_in_frame(f, 'top-left', np.eye(3), np.zeros(3)))
        for points in [[], [[0, 0, -3]], [[float('nan'), 0, 2]]]:
            self.assertIsNone(s.locate_in_frame(self.frame(points), 'middle-center', np.eye(3), np.zeros(3)))

    def test_alignment_rejects_reflections_and_nonfinite_values(self):
        for rotation, center in [(np.diag([1, 1, -1]), [0, 0, 0]), (np.eye(3) * 2, [0, 0, 0]),
                                 (np.eye(3), [0, float('nan'), 0])]:
            with self.assertRaises(s.SuggestionError):
                s.validate_alignment(rotation, center)


class AggregationTests(unittest.TestCase):
    def test_best_frame_is_selected_only_among_relevant_frames(self):
        catalog = s.load_questions()
        observations = {q['checklistItemId']: [
            {'frame': 'a.jpg', 'rawProbability': .95, 'probability': .95, 'relevanceProbability': .1, 'position': None},
            {'frame': 'b.jpg', 'rawProbability': .80, 'probability': .80, 'relevanceProbability': .9, 'position': [0, 0, 1]},
        ] for q in catalog}
        item = s.aggregate_items(catalog, observations, .6, lambda name: 'thumbnail:' + name)[0]
        self.assertEqual(item['score'], .8)
        self.assertAlmostEqual(item['meanProbability'], .875)
        self.assertEqual(item['relevantFrames'], 1)
        self.assertEqual(item['framesAboveThreshold'], 1)
        self.assertEqual(item['status'], 'suggested')
        self.assertEqual(item['bestFrame'], 'b.jpg')
        self.assertEqual(item['thumbnail'], 'thumbnail:b.jpg')
        item = s.aggregate_items(catalog, observations, .6, lambda name: 'thumbnail:' + name, 2)[0]
        self.assertEqual(item['status'], 'below-threshold')
        self.assertIsNone(item['thumbnail'])
        for rows in observations.values():
            rows[1]['relevanceProbability'] = .1
        item = s.aggregate_items(catalog, observations, .6, lambda _: None)[0]
        self.assertEqual(item['status'], 'not-visible')
        self.assertIsNone(item['score'])
        self.assertIsNone(item['bestFrame'])



class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        make_scan(self.root)
        for name in ['model', 'runtime']:
            (self.root/name).mkdir()
            (self.root/name/'synthetic.bin').write_bytes(('synthetic '+name).encode())
        # Fake server results have no evidence from the tracked real-model fit.
        calibration_default = patch.object(s, 'DEFAULT_CALIBRATION', self.root / 'absent-default-fit.json')
        calibration_default.start()
        self.addCleanup(calibration_default.stop)

    def run_dry(self):
        return s.run_scan(self.root, keyframes=2, dry_run=True, progress=lambda line: None)

    def mock_client(self, response_function):
        """Exercise encoded requests/response parsing without opening sockets."""
        client = s.DecisionClient(timeout=2, retries=0)
        seen = []
        def open_response(request, timeout):
            self.assertEqual(timeout, 2)
            self.assertEqual(request.full_url, 'http://127.0.0.1:8090/v1/systemone')
            self.assertEqual(request.get_header('Content-type'), 'application/json')
            body = json.loads(request.data)
            seen.append(body)
            return BytesIO(json.dumps(response_function(body)).encode())
        client.opener.open = open_response
        return client, seen

    def test_dry_run_uses_real_colmap_and_has_explicit_fake_provenance(self):
        with patch.object(s.DecisionClient, 'decide', side_effect=AssertionError('HTTP forbidden in dry run')):
            result = self.run_dry()
        self.assertEqual(result['format'], 'fixlist-scan-suggestions')
        self.assertEqual(result['version'], 2)
        self.assertIsNone(result['calibration'])
        s.validate_output(result)
        self.assertTrue(result['timing']['dryRun'])
        self.assertIn('DRY-RUN', result['model']['name'])
        self.assertEqual(result['scan']['framesAnalyzed'], 2)
        self.assertEqual(result['scan']['splatCount'], 10)
        self.assertEqual(len(result['items']), 8)
        self.assertEqual(json.loads((self.root / 'suggestions.json').read_text()), result)
        self.assertEqual(result['timing']['attempts'], 0)
        suggested = [item for item in result['items'] if (item['status'] == 'suggested')]
        self.assertTrue(suggested)
        for item in suggested:
            with Image.open(BytesIO(base64.b64decode(item['thumbnail'].split(',')[1]))) as image:
                self.assertEqual(image.format, 'JPEG')
                self.assertLessEqual(max(image.size), 320)
        self.assertNotIn('torch', sys.modules)

    def test_schema_rejects_invalid_types_bounds_links_and_inconsistent_aggregates(self):
        result = self.run_dry()
        mutations = [
            lambda r: r.update(extra=True),
            lambda r: r.update(version=True),
            lambda r: r.update(createdAt='yesterday'),
            lambda r: r['scan'].update(framesAnalyzed=3),
            lambda r: r['scan'].update(splatCount=True),
            lambda r: r['items'][0].update(score=float('nan')),
            lambda r: r['items'][0].update(meanProbability=.999),
            lambda r: r['items'][0].update(status='invented'),
            lambda r: r['items'][0].update(concernId='unknown'),
            lambda r: r['items'][0].update(position=[0, float('inf'), 2]),
            lambda r: r['items'][0].update(position=[1, 2]),
            lambda r: r['items'][0].update(thumbnail='data:image/jpeg;base64,eA=='),
            lambda r: r['items'][0]['perFrame'][0].update(probability=2),
            lambda r: r['items'][0]['perFrame'][0].update(probability=True),
            lambda r: r['items'][0]['perFrame'][0].update(frame='../secret.jpg'),
            lambda r: r['timing'].update(dryRun=True),
        ]
        for mutation in mutations:
            bad = copy.deepcopy(result)
            mutation(bad)
            with self.subTest(mutation=mutation), self.assertRaises(s.SuggestionError):
                s.validate_output(bad)

    def test_unreachable_server_error_includes_exact_serve_command_and_does_not_write(self):
        client = s.DecisionClient(timeout=.1, retries=0)
        with patch.object(client.opener, 'open', side_effect=URLError('connection refused')):
            with self.assertRaises(s.SuggestionError) as error:
                client.decide(s.build_review_request(s.load_questions(), 'x', 'never'))
        self.assertIn(s.SERVE_COMMAND, str(error.exception))
        self.assertFalse((self.root / 'suggestions.json').exists())

    def serve(self, response_function):
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                seen.append((self.path, body))
                status, response = response_function(body, len(seen))
                encoded = json.dumps(response).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, *args):
                pass

        try:
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        except PermissionError as error:
            self.skipTest(f'Environment denies loopback socket binding: {error}. Run on the local host.')
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def shutdown():
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.addCleanup(shutdown)
        return f'http://127.0.0.1:{server.server_port}', seen

    def test_fake_http_end_to_end_and_real_geometry(self):
        url, seen = self.serve(lambda body, count: (200, fixture_response(body)))
        result = s.run_scan(self.root, url=url, keyframes=2, think_mode='never', timeout=2,
                            retries=0, progress=lambda line: None)
        self.assertEqual(len(seen), 10)  # two review calls and eight best-frame localizations
        self.assertTrue(all(path == '/v1/systemone' for path, _ in seen))
        self.assertTrue(all(len(body['images']) == 1 for _, body in seen))
        self.assertEqual(result['model']['name'], 'fake-http-model')
        self.assertFalse(result['timing']['dryRun'])
        self.assertEqual(result['timing']['requests'], 10)
        for item in result['items']:
            self.assertTrue((item['status'] == 'suggested'))
            self.assertEqual(item['position'], [-1, -2, 3])
            self.assertEqual(item['framesAboveThreshold'], 2)
        s.validate_output(result)

    def test_mocked_http_bytes_end_to_end_and_real_geometry(self):
        client, seen = self.mock_client(fixture_response)
        with patch.object(s, 'DecisionClient', return_value=client):
            result = s.run_scan(self.root, keyframes=2, progress=lambda line: None)
        self.assertEqual(len(seen), 10)
        self.assertEqual(result['timing']['attempts'], 10)
        self.assertTrue(all(item['position'] == [-1, -2, 3] and (item['status'] == 'suggested') for item in result['items']))
        s.validate_output(result)

    def test_none_probability_prevents_placement_in_end_to_end_run(self):
        url, _ = self.serve(lambda body, count: (200, fixture_response(body, none=.2)))
        result = s.run_scan(self.root, url=url, keyframes=1, timeout=2, retries=0, progress=lambda line: None)
        self.assertTrue(all(item['position'] is None for item in result['items']))

    def test_mocked_none_probability_prevents_placement(self):
        client, _ = self.mock_client(lambda request: fixture_response(request, none=.2))
        with patch.object(s, 'DecisionClient', return_value=client):
            result = s.run_scan(self.root, keyframes=1, progress=lambda line: None)
        self.assertTrue(all(item['position'] is None and (item['status'] == 'suggested') for item in result['items']))

    def test_location_and_suggestion_thresholds_are_independent(self):
        client, seen = self.mock_client(lambda request: fixture_response(request, probability=.55))
        with patch.object(s, 'DecisionClient', return_value=client):
            result = s.run_scan(self.root, keyframes=1, threshold=.6, location_threshold=.5, progress=lambda line: None)
        self.assertEqual(len(seen), 9)
        self.assertTrue(all(not (item['status'] == 'suggested') and item['position'] is not None for item in result['items']))
        client, seen = self.mock_client(lambda request: fixture_response(request, probability=.65))
        with patch.object(s, 'DecisionClient', return_value=client):
            result = s.run_scan(self.root, keyframes=1, threshold=.6, location_threshold=.7, progress=lambda line: None)
        self.assertEqual(len(seen), 1)
        self.assertTrue(all((item['status'] == 'suggested') and item['position'] is None for item in result['items']))

    def test_irrelevant_frames_do_not_make_suggestions(self):
        client, _ = self.mock_client(lambda request: fixture_response(request, relevance=.1))
        with patch.object(s, 'DecisionClient', return_value=client):
            result = s.run_scan(self.root, keyframes=1, progress=lambda line: None)
        self.assertTrue(all(not (item['status'] == 'suggested') and item['thumbnail'] is None for item in result['items']))

    def calibration_document(self, adopted=True, model=s.DRY_MODEL, think_mode='never'):
        return {'format': 'fixlist-photo-calibration', 'version': 1, 'model': model,
                'scoringConditions': {'thinkMode': think_mode, 'imageMaxEdge': 1024,
                                      'requestSignature': e.request_signature(s.load_questions(), think_mode)},
                'modelIdentity': s.inference_identity(self.root/'model', self.root/'runtime'),
                'adopted': adopted, 'calibration': {
            'method': 'platt', 'parameters': {key: {'a': .8, 'b': -.2} for key in s.ITEM_LINKS},
            'fittedAt': '2026-10-18T00:00:00.000Z', 'labelSource': 'Synthetic unit-test labels only',
            'trainExamples': 80, 'heldOutExamples': 40,
            'heldOutBrierRaw': .2, 'heldOutBrierCalibrated': .18}}

    def test_calibration_model_mismatch_on_first_response_aborts_without_output(self):
        path = self.root / 'test-calibration.json'
        path.write_text(json.dumps(self.calibration_document(model='model-A')))
        client, seen = self.mock_client(fixture_response)  # returns fake-http-model
        with patch.object(s, 'DecisionClient', return_value=client):
            with self.assertRaisesRegex(s.SuggestionError, 'Calibration model.*no output written'):
                s.run_scan(self.root, keyframes=2, calibration=path, progress=lambda _: None,
                           model_dir=self.root / 'model', runtime_dir=self.root / 'runtime')
        self.assertEqual(len(seen), 1)
        self.assertFalse((self.root / 'suggestions.json').exists())

    def test_calibration_mismatch_preserves_existing_output(self):
        output = self.root / 'suggestions.json'
        output.write_bytes(b'Previous result must remain unchanged.')
        path = self.root / 'test-calibration.json'
        path.write_text(json.dumps(self.calibration_document(model='model-A')))
        client, _ = self.mock_client(fixture_response)
        with patch.object(s, 'DecisionClient', return_value=client):
            with self.assertRaisesRegex(s.SuggestionError, 'Calibration model'):
                s.run_scan(self.root, keyframes=1, calibration=path, progress=lambda _: None,
                           model_dir=self.root / 'model', runtime_dir=self.root / 'runtime')
        self.assertEqual(output.read_bytes(), b'Previous result must remain unchanged.')

    def test_calibration_think_mode_mismatch_aborts_before_model_and_no_calibration_works(self):
        path = self.root / 'test-calibration.json'
        path.write_text(json.dumps(self.calibration_document(model='fake-http-model', think_mode='never')))
        client, seen = self.mock_client(fixture_response)
        with patch.object(s, 'DecisionClient', return_value=client):
            with self.assertRaisesRegex(s.SuggestionError, 'Calibration request conditions'):
                s.run_scan(self.root, keyframes=1, calibration=path, think_mode='auto', progress=lambda _: None)
            self.assertEqual(len(seen), 0)
            self.assertFalse((self.root / 'suggestions.json').exists())
            with patch.object(s, 'DEFAULT_CALIBRATION', path):
                result = s.run_scan(self.root, keyframes=1, no_calibration=True, progress=lambda _: None)
        self.assertIsNone(result['calibration'])

    def test_matching_calibration_model_and_conditions_apply(self):
        path = self.root / 'test-calibration.json'
        document = self.calibration_document(model='fake-http-model', think_mode='never')
        path.write_text(json.dumps(document))
        client, _ = self.mock_client(fixture_response)
        with patch.object(s, 'DecisionClient', return_value=client):
            result = s.run_scan(self.root, keyframes=1, calibration=path, think_mode='never', progress=lambda _: None,
                                model_dir=self.root/'model', runtime_dir=self.root/'runtime')
        self.assertEqual(result['calibration'], document['calibration'])
        for item in result['items']:
            self.assertAlmostEqual(item['perFrame'][0]['probability'], s.platt_probability(.8, .8, -.2))
        s.validate_output(result)

    def test_same_model_name_does_not_transfer_calibration_to_changed_weight_bytes(self):
        path = self.root / 'test-calibration.json'
        document = self.calibration_document(model='fake-http-model')
        path.write_text(json.dumps(document))
        (self.root/'model/synthetic.bin').write_bytes(b'changed weights, same model name')
        client, _ = self.mock_client(fixture_response)
        with patch.object(s, 'DecisionClient', return_value=client):
            with self.assertRaisesRegex(s.SuggestionError, 'weight/runtime content identity'):
                s.run_scan(self.root, keyframes=1, calibration=path, model_dir=self.root/'model',
                           runtime_dir=self.root/'runtime', progress=lambda _: None)
        self.assertFalse((self.root/'suggestions.json').exists())

    def test_legacy_calibration_without_model_bytes_is_not_applied_by_name(self):
        path = self.root / 'test-calibration.json'
        document = self.calibration_document(model='fake-http-model'); del document['modelIdentity']
        path.write_text(json.dumps(document))
        client, _ = self.mock_client(fixture_response)
        with patch.object(s, 'DecisionClient', return_value=client):
            with self.assertRaisesRegex(s.SuggestionError, 'weight/runtime content identity'):
                s.run_scan(self.root, keyframes=1, calibration=path, model_dir=self.root/'model',
                           runtime_dir=self.root/'runtime', progress=lambda _: None)
        self.assertFalse((self.root/'suggestions.json').exists())

    def test_unusable_calibration_identity_fails_before_reading_or_requesting_photos(self):
        path = self.root / 'test-calibration.json'
        output = self.root / 'suggestions.json'
        output.write_bytes(b'PRIOR')
        for kind in ('missing-directories', 'legacy-default', 'mismatched-content'):
            document = self.calibration_document(model='fake-http-model')
            options = {'calibration': path, 'model_dir': self.root / 'model', 'runtime_dir': self.root / 'runtime'}
            if kind == 'missing-directories':
                options.pop('model_dir')
                options.pop('runtime_dir')
            elif kind == 'legacy-default':
                document.pop('modelIdentity')
                options.pop('calibration')
            else:
                document['modelIdentity']['weightsSHA256'] = '0' * 64
            path.write_text(json.dumps(document))
            client, seen = self.mock_client(fixture_response)
            with self.subTest(kind=kind), patch.object(s, 'DEFAULT_CALIBRATION', path), \
                    patch.object(s, 'DecisionClient', return_value=client), \
                    patch.object(s, 'load_scan', wraps=s.load_scan) as loaded:
                with self.assertRaisesRegex(s.SuggestionError, 'weight/runtime content identity'):
                    s.run_scan(self.root, keyframes=1, progress=lambda _: None, **options)
                self.assertEqual(len(seen), 0)
                loaded.assert_not_called()
                self.assertEqual(output.read_bytes(), b'PRIOR')

    def test_partial_model_identity_configuration_is_refused(self):
        client, seen = self.mock_client(fixture_response)
        with patch.object(s, 'DecisionClient', return_value=client):
            with self.assertRaisesRegex(s.SuggestionError, 'Provide both'):
                s.run_scan(self.root, keyframes=1, no_calibration=True,
                           model_dir=self.root / 'model', progress=lambda _: None)
        self.assertEqual(len(seen), 0)

    def test_calibration_conditions_and_missing_provenance_fail_closed_even_with_force(self):
        for mutate in [lambda d: d.pop('model'), lambda d: d.pop('scoringConditions'),
                       lambda d: d['scoringConditions'].update(imageMaxEdge=512),
                       lambda d: d['scoringConditions'].update(requestSignature='0' * 64)]:
            with self.subTest(mutation=mutate):
                document = self.calibration_document(False)
                mutate(document)
                path = self.root / 'test-calibration.json'
                path.write_text(json.dumps(document))
                with self.assertRaises(s.SuggestionError):
                    s.run_scan(self.root, keyframes=1, dry_run=True, calibration=path,
                               force_calibration=True, progress=lambda _: None)
                self.assertFalse((self.root / 'suggestions.json').exists())

    def test_v2_with_calibration_passes_and_parameters_are_recomputed(self):
        path = self.root / 'test-calibration.json'
        path.write_text(json.dumps(self.calibration_document()))
        result = s.run_scan(self.root, keyframes=2, dry_run=True, calibration=path, progress=lambda _: None)
        self.assertEqual(result['calibration'], self.calibration_document()['calibration'])
        s.validate_output(result)
        for item in result['items']:
            for row in item['perFrame']:
                self.assertAlmostEqual(row['probability'], s.platt_probability(row['rawProbability'], .8, -.2))
        result['calibration']['parameters']['rug-check']['b'] += 1
        with self.assertRaisesRegex(s.SuggestionError, 'calibration is inconsistent'):
            s.validate_output(result)

    def test_calibration_adoption_default_disable_and_force(self):
        path = self.root / 'test-calibration.json'
        doc = self.calibration_document(False)
        path.write_text(json.dumps(doc))
        with patch.object(s, 'DEFAULT_CALIBRATION', path):
            self.assertIsNone(s.load_calibration())
            with self.assertRaisesRegex(s.SuggestionError, 'did not pass adoption'):
                s.load_calibration(path)
            self.assertEqual(s.load_calibration(path, force=True), doc)
            doc['adopted'] = True
            path.write_text(json.dumps(doc))
            self.assertEqual(s.load_calibration(), doc)
            self.assertIsNone(s.load_calibration(disabled=True))
        with self.assertRaises(s.SuggestionError):
            s.load_calibration(force=True)
        with self.assertRaises(s.SuggestionError):
            s.load_calibration(path, disabled=True)

    def test_legacy_v1_without_viewpoint_and_full_consistency_checks(self):
        result = self.run_dry()
        result['version'] = 1
        del result['calibration']
        del result['thresholds']['minFrames']
        for item in result['items']:
            item['maxProbability'] = item.pop('score')
            item['suggested'] = item.pop('status') == 'suggested'
            for key in ['relevantFrames', 'relevanceQuestion', 'limitation', 'viewpoint', 'localization']:
                del item[key]
            for row in item['perFrame']:
                del row['rawProbability'], row['relevanceProbability']
        before = copy.deepcopy(result)
        s.validate_output(result)
        self.assertEqual(result, before)  # optional legacy normalization is read-only
        mutations = [
            lambda r: r['items'][0].update(maxProbability=.99),
            lambda r: r['items'][0].update(meanProbability=.01),
            lambda r: r['items'][0].update(framesAboveThreshold=0),
            lambda r: r['items'][0].update(bestFrame='000002.jpg'),
            lambda r: r['items'][0].update(suggested=False),  # retains a forbidden thumbnail
            lambda r: r['items'][0].update(viewpoint=[0, 0, 0], position=None),
            lambda r: r['items'][0]['perFrame'][0].update(probability=.01),
        ]
        for mutate in mutations:
            bad = copy.deepcopy(result)
            mutate(bad)
            with self.subTest(mutate=mutate), self.assertRaises(s.SuggestionError):
                s.validate_output(bad)
        # A legacy relevance-gated false item can exceed the review threshold.
        result['items'][0]['suggested'] = False
        result['items'][0]['thumbnail'] = None
        s.validate_output(result)

    def test_v2_rejects_contradictory_status_counts_and_null_scores(self):
        result = self.run_dry()
        mutations = [
            lambda r: r['items'][0].update(score=.99),
            lambda r: r['items'][0].update(relevantFrames=0),
            lambda r: r['items'][0].update(framesAboveThreshold=0),
            lambda r: r['items'][0].update(status='below-threshold'),
            lambda r: r['items'][0].update(score=None),
            lambda r: r['thresholds'].update(minFrames=0),
            lambda r: r['thresholds'].update(minFrames=3),
            lambda r: r['thresholds'].update(minFrames=True),
            lambda r: r['items'][0]['perFrame'][0].update(rawProbability=.01),
            lambda r: r['items'][0]['perFrame'][0].update(relevanceProbability=0),
            lambda r: r['items'][0]['perFrame'][0].update(probability=.01, rawProbability=.01),
        ]
        for mutate in mutations:
            bad = copy.deepcopy(result)
            mutate(bad)
            with self.subTest(mutate=mutate), self.assertRaises(s.SuggestionError):
                s.validate_output(bad)

    def test_pipeline_localizes_only_the_best_relevant_frame(self):
        Image.new('RGB', (90, 90), (150, 180, 100)).save(self.root / 'work/dataset/images/000002.jpg')
        reviews = 0
        def response(request):
            nonlocal reviews
            if next(iter(request['questions'].values()))['type'] == 'noul':
                reviews += 1
                return fixture_response(request, probability=.95 if reviews == 1 else .8,
                                        relevance=.1 if reviews == 1 else .9)
            return fixture_response(request)
        client, seen = self.mock_client(response)
        with patch.object(s, 'DecisionClient', return_value=client):
            result = s.run_scan(self.root, keyframes=2, progress=lambda _: None)
        self.assertEqual(len(seen), 10)
        self.assertTrue(all(item['bestFrame'] == '000002.jpg' and item['score'] == .8
                            and item['relevantFrames'] == 1 and item['status'] == 'suggested' for item in result['items']))
        self.assertTrue(all(req['images'] == seen[1]['images'] for req in seen[2:]))
        s.validate_output(result)

    def test_dimension_mismatch_fails_without_writing(self):
        Image.new('RGB', (100, 90)).save(self.root / 'work/dataset/images/000002.jpg')
        with self.assertRaisesRegex(s.SuggestionError, 'dimension mismatch'):
            self.run_dry()
        self.assertFalse((self.root / 'suggestions.json').exists())

    def test_output_symlink_is_refused(self):
        target = self.root / 'owner-file'
        target.write_text('keep')
        (self.root / 'suggestions.json').symlink_to(target)
        with self.assertRaisesRegex(s.SuggestionError, 'symlink'):
            self.run_dry()
        self.assertEqual(target.read_text(), 'keep')

    def test_atomic_write_failure_preserves_existing_output(self):
        self.run_dry()
        original = (self.root / 'suggestions.json').read_bytes()
        with patch.object(s.os, 'replace', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):
                self.run_dry()
        self.assertEqual((self.root / 'suggestions.json').read_bytes(), original)
        self.assertEqual(list(self.root.glob('.suggestions-*.tmp')), [])

    def test_model_change_aborts_without_writing(self):
        client, seen = self.mock_client(fixture_response)
        original_open = client.opener.open
        def changed_open(request, timeout):
            response = json.loads(original_open(request, timeout).read())
            if len(seen) > 1:
                response['model'] = 'different-model'
            return BytesIO(json.dumps(response).encode())
        client.opener.open = changed_open
        with patch.object(s, 'DecisionClient', return_value=client):
            with self.assertRaisesRegex(s.SuggestionError, 'model changed'):
                s.run_scan(self.root, keyframes=1, progress=lambda line: None)
        self.assertFalse((self.root / 'suggestions.json').exists())

    def test_retry_transient_error_but_not_422(self):
        req = s.build_review_request(s.load_questions(), 'x', 'never')
        for code, attempts in [(429, 2), (502, 2), (422, 1), (401, 1)]:
            client = s.DecisionClient(timeout=2, retries=1)
            failure = HTTPError(client.url, code, 'test error', {}, None)
            with patch.object(client.opener, 'open', side_effect=[failure, BytesIO(json.dumps(fixture_response(req)).encode())]) as opened:
                with patch.object(s.time, 'sleep'):
                    if attempts == 1:
                        with self.assertRaises(s.SuggestionError):
                            client.decide(req)
                    else:
                        client.decide(req)
            self.assertEqual(opened.call_count, attempts)
            self.assertEqual(client.attempts, attempts)

    def test_per_attempt_timeout_and_network_retry(self):
        client = s.DecisionClient(timeout=.125, retries=2)
        with patch.object(client.opener, 'open', side_effect=TimeoutError('timeout')) as opened:
            with patch.object(s.time, 'sleep'):
                with self.assertRaises(s.SuggestionError):
                    client.decide(s.build_review_request(s.load_questions(), 'x', 'never'))
        self.assertEqual(opened.call_count, 3)
        self.assertTrue(all(call.kwargs['timeout'] == .125 for call in opened.call_args_list))

    def test_redirect_is_rejected_without_following_it(self):
        with self.assertRaises(s.SuggestionError):
            s.NoRedirects().redirect_request(None, None, 307, 'redirect', {}, 'http://example.com')

    def test_failed_response_preserves_existing_output(self):
        self.run_dry()
        original = (self.root / 'suggestions.json').read_bytes()
        client, _ = self.mock_client(lambda request: {'answers': {}, 'model': 'broken'})
        with patch.object(s, 'DecisionClient', return_value=client):
            with self.assertRaises(s.SuggestionError):
                s.run_scan(self.root, keyframes=1, progress=lambda line: None)
        self.assertEqual((self.root / 'suggestions.json').read_bytes(), original)

    def test_dry_run_cannot_replace_real_model_result(self):
        client, _ = self.mock_client(fixture_response)
        with patch.object(s, 'DecisionClient', return_value=client):
            s.run_scan(self.root, keyframes=1, progress=lambda line: None)
        original = (self.root / 'suggestions.json').read_bytes()
        with self.assertRaises(s.SuggestionError):
            self.run_dry()
        self.assertEqual((self.root / 'suggestions.json').read_bytes(), original)

    def test_cli_rejects_traversal_and_invalid_options_without_reading_a_scan(self):
        for args in [['../outside', '--dry-run'], ['scan', '--keyframes', '0'],
                     ['scan', '--threshold', 'nan'], ['scan', '--timeout', '0']]:
            result = subprocess.run([sys.executable, str(Path(s.__file__)), *args], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertNotIn('Traceback', result.stderr)


class CameraViewpointTests(unittest.TestCase):
    def test_viewpoint_is_aligned_camera_centre(self):
        import numpy as np
        from types import SimpleNamespace
        import suggest as module
        frame = SimpleNamespace(rotation=np.eye(3), translation=np.array([0., 0., -2.]))
        rotation = np.array([[1., 0, 0], [0, 0, -1.], [0, 1., 0]])
        self.assertEqual(module.camera_viewpoint(frame, rotation, np.array([0., 0., 1.])), [0.0, -1.0, 0.0])
        frame.translation = np.array([np.nan, 0., 0.])
        self.assertIsNone(module.camera_viewpoint(frame, rotation, np.zeros(3)))


if __name__ == '__main__':
    unittest.main()
