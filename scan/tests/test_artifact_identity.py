"""Synthetic byte-change, disclosure parity, and localization regressions."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from artifact_identity import file_sha256, inference_identity, scene_identity
from reconstruct import Run, ScanError
import suggest as s
import evaluate_model as e
from test_suggest import make_scan, fixture_response
import test_evaluate_model as evaluation_fixture


class ArtifactTests(unittest.TestCase):
    def test_reconstruction_refuses_changed_input_bytes_at_same_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = root/'source.mp4'; source.write_bytes(b'first')
            output = root/'output'; output.mkdir()
            Run(output, {'input': str(source)}, False)
            source.write_bytes(b'other')  # same length/path
            with self.assertRaisesRegex(ScanError, 'bytes changed'):
                Run(output, {'input': str(source)}, True)

    def test_reconstruction_refuses_changed_or_missing_completed_output_bytes(self):
        for replacement in [b'changed', None]:
            with self.subTest(replacement=replacement), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); (root/'work').mkdir()
                target = root/'work/output.bin'
                run = Run(root, {}, False)
                run.stage('frames', lambda: target.write_bytes(b'original'))
                if replacement is None: target.unlink()
                else: target.write_bytes(replacement)
                with self.assertRaisesRegex(ScanError, 'artifact bytes'):
                    Run(root, {}, True)

    def test_reconstruction_refuses_same_named_changed_tool_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); tool = root/'brush'; tool.write_bytes(b'first')
            output = root/'output'; output.mkdir()
            Run(output, {'brush': str(tool)}, False)
            tool.write_bytes(b'other')
            with self.assertRaisesRegex(ScanError, 'bytes changed'):
                Run(output, {'brush': str(tool)}, True)

    def test_reconstruction_refuses_same_named_changed_learned_weights(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); cache = root/'torch/hub/checkpoints'; cache.mkdir(parents=True)
            for name in ['aliked-n16.pth', 'aliked_lightglue_v0-1_arxiv.pth']:
                (cache/name).write_bytes(b'synthetic model bytes')
            output = root/'output'; output.mkdir()
            with patch.dict('os.environ', {'TORCH_HOME': str(root/'torch')}):
                Run(output, {'features': 'aliked'}, False)
                (cache/'aliked-n16.pth').write_bytes(b'different model bytes')
                with self.assertRaisesRegex(ScanError, 'model bytes changed'):
                    Run(output, {'features': 'aliked'}, True)

    def test_unpinned_completed_runs_are_not_reused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); run = Run(root, {}, False)
            run.report['stages']['frames'] = {'status': 'complete'}; run.flush()
            with self.assertRaisesRegex(ScanError, 'lack content identity'):
                Run(root, {}, True)

    def test_failed_training_can_resume_by_archiving_only_unusable_training(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root/'work').mkdir()
            run = Run(root, {}, False)
            run.stage('frames', lambda: (root/'work/images.bin').write_bytes(b'original'))
            def failing():
                (root/'work/training').mkdir(); (root/'work/training/partial.ply').write_bytes(b'partial')
                raise ScanError('training failure')
            with self.assertRaises(ScanError): run.stage('training', failing)
            resumed = Run(root, {}, True); resumed.retry_training()
            self.assertEqual((root/'work/training-attempt-1/partial.ply').read_bytes(), b'partial')

    def test_scene_identity_hashes_actual_scene_frames_and_processing_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); make_scan(root)
            _, frames, _, _ = s.load_scan(root, 2)
            identity = scene_identity(root, frames, Path(s.__file__))
            self.assertEqual(identity['sceneSHA256'], file_sha256(root/'scene.splat'))
            self.assertEqual(identity['frames'][0]['sha256'], file_sha256(frames[0].path))
            (root/'scene.splat').write_bytes(bytes([1])*320)
            self.assertNotEqual(identity['sceneSHA256'], scene_identity(root, frames, Path(s.__file__))['sceneSHA256'])

    def test_documented_default_reaches_loopback_endpoint_with_calibrated_think_mode(self):
        # Real CLI entry point, real generated COLMAP input, real HTTP opener.
        # Socket access may be denied here; connection failure is the expected result.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); make_scan(root/'synthetic')
            from io import StringIO
            with patch.object(s, 'SCAN_ROOT', root), patch('sys.stderr', new_callable=StringIO) as stderr:
                result = s.main(['synthetic', '--url', 'http://127.0.0.1:1', '--timeout', '0.01', '--retries', '0'])
            self.assertEqual(result, 2)
            self.assertIn('Cannot reach the local StartLux server', stderr.getvalue())
            self.assertFalse((root/'synthetic/suggestions.json').exists())

    def test_python_disclosure_parity_cases(self):
        cases = json.loads((Path(__file__).with_name('disclosure-parity.json')).read_text())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); make_scan(root)
            data = s.run_scan(root, dry_run=True, progress=lambda _: None)
            for case in cases:
                with self.subTest(case=case['name']):
                    value = copy.deepcopy(data)
                    value['notice'], value['model']['license'] = case['notice'], case['license']
                    if case['valid']: s.validate_output(value)
                    else:
                        with self.assertRaises(s.SuggestionError): s.validate_output(value)

    def test_ambiguous_choice_rejected_despite_reported_confidence(self):
        request = s.build_location_request(s.load_questions()[0], 'unused', 'never')
        answer = fixture_response(request)['answers']['location']
        answer.update(confidence=.99, probabilities={cell: 1/9 for cell in s.GRID})
        self.assertIsNone(s.parse_grid_choice(answer))

    def test_localization_rejects_distant_directions_layers_and_sparse_support(self):
        def frame(points):
            return s.Frame('synthetic.jpg', Path('/unused'), 90, 90, np.array([90.,90.,45.,45.]), np.eye(3), np.zeros(3), np.array(points).reshape(-1,3))
        for points, cell in [([[0,0,8]]*3, 'top-left'), ([[0,0,4],[0,0,8],[0,0,100]], 'middle-center'), ([[0,0,8]], 'middle-center'), ([], 'middle-center')]:
            with self.subTest(points=points):
                position, evidence = s.localize_in_frame(frame(points), cell, np.eye(3), np.zeros(3))
                self.assertIsNone(position); self.assertEqual(evidence['status'], 'photo-only')
        position, evidence = s.localize_in_frame(frame([[0,0,8],[.01,0,8.1],[0,.01,7.9]]), 'middle-center', np.eye(3), np.zeros(3))
        self.assertIsNotNone(position); self.assertEqual(evidence['status'], 'approximate')
        self.assertGreaterEqual(evidence['support'], 3); self.assertLessEqual(evidence['maxAngleDegrees'], 5)


class ResumeEvaluationTests(unittest.TestCase):
    setUp = evaluation_fixture.DatasetTests.setUp
    write_manifest = evaluation_fixture.DatasetTests.write_manifest
    fake_client = evaluation_fixture.DatasetTests.fake_client
    def test_scored_same_path_changed_image_bytes_fail_before_model_call(self):
        e.score_dataset(self.root, client=self.fake_client(), limit=1, progress=lambda _: None)
        Image.new('RGB', (1400,700), 'red').save(self.root/'images/0.jpg')
        client = self.fake_client()
        with self.assertRaisesRegex(s.SuggestionError, 'Image bytes changed'):
            e.score_dataset(self.root, client=client, progress=lambda _: None)
        self.assertEqual(client.calls, [])

    def test_changed_preprocessed_bytes_fail_even_with_same_source_and_signature(self):
        e.score_dataset(self.root, client=self.fake_client(), limit=1, progress=lambda _: None)
        client = self.fake_client()
        original = s.image_data
        with patch.object(s, 'image_data', side_effect=lambda frame, size: original(frame, size) + 'changed-encoder'):
            with self.assertRaisesRegex(s.SuggestionError, 'Preprocessed request image bytes changed'):
                e.score_dataset(self.root, client=client, progress=lambda _: None)
        self.assertEqual(client.calls, [])

    def test_same_named_model_or_runtime_changed_bytes_fail_before_model_call(self):
        e.score_dataset(self.root, client=self.fake_client(), limit=1, progress=lambda _: None)
        for name in ['model', 'runtime']:
            path = self.root/name/'synthetic.bin'; original = path.read_bytes(); path.write_bytes(b'other bytes')
            client = self.fake_client()
            with self.assertRaisesRegex(s.SuggestionError, 'weight/runtime bytes changed'):
                e.score_dataset(self.root, client=client, progress=lambda _: None)
            self.assertEqual(client.calls, []); path.write_bytes(original)


class AnchoredPackagingTests(unittest.TestCase):
    def test_symlinked_parent_or_leaf_is_rejected_by_anchored_reader(self):
        from read_local_artifact import read_beneath
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); source = root/'source'; source.mkdir()
            outside = root/'outside'; outside.mkdir(); (outside/'scene.splat').write_bytes(b'synthetic outside boundary')
            (source/'room').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(OSError): read_beneath(source, 'room/scene.splat', 64)
            (source/'room').unlink(); (source/'room').mkdir()
            (source/'room/scene.splat').symlink_to(outside/'scene.splat')
            with self.assertRaises(OSError): read_beneath(source, 'room/scene.splat', 64)

    def test_anchored_reader_reads_only_bounded_ordinary_files(self):
        from read_local_artifact import read_beneath
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); (root/'room').mkdir(); (root/'room/scene.splat').write_bytes(b'synthetic')
            self.assertEqual(read_beneath(root, 'room/scene.splat', 32), b'synthetic')
            with self.assertRaises(ValueError): read_beneath(root, 'room/scene.splat', 2)
            with self.assertRaises(ValueError): read_beneath(root, '../outside', 32)
