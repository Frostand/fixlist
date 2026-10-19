import copy
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scan_core import (
    ScanError, bake_transform, build_metadata, check_registration, decode_splat, estimate_scene_alignment,
    encode_splat, laplacian_variance, matrix_to_quaternion, quaternion_matrix,
    read_gaussian_ply, rotation_between, select_sharpest, validate_metadata,
    frame_budget, matching_pairs, should_fallback_to_learned, should_try_exhaustive,
)


class FrameTests(unittest.TestCase):
    def test_adaptive_budget_preserves_room_preset_and_caps_walkthroughs(self):
        self.assertEqual(frame_budget(),150)
        self.assertEqual(frame_budget(45),150)
        self.assertEqual(frame_budget(100),250)
        self.assertEqual(frame_budget(1000),300)
        self.assertEqual(frame_budget(100,90),90)
        for value in [0,-1,float('nan'),float('inf')]:
            with self.assertRaises(ScanError): frame_budget(value)
        with self.assertRaises(ScanError): frame_budget(explicit=29)

    def test_temporal_pairs_and_sparse_loop_closure_are_unique_and_bounded(self):
        self.assertEqual(matching_pairs(0),[])
        self.assertEqual(matching_pairs(1),[])
        pairs=matching_pairs(300)
        self.assertEqual(pairs,sorted(set(pairs)))
        self.assertTrue(all(0<=i<j<300 for i,j in pairs))
        self.assertIn((0,12),pairs)
        self.assertIn((0,299),pairs)
        self.assertNotIn((1,298),pairs)
        self.assertLess(len(pairs),300*15)
        # Fixed local window and capped keyframes avoid quadratic pair growth.
        self.assertLess(len(matching_pairs(3000)),3000*13)

    def test_best_per_window_is_chronological_and_bounded(self):
        self.assertEqual(select_sharpest([1, 9, 2, 8, 7, 3], 3), [1, 3, 4])
        self.assertEqual(select_sharpest([5, 5, 5], 9), [0, 1, 2])
        self.assertEqual(select_sharpest([5, 5, 4, 4], 2), [0, 2])

    def test_blur_rejection_keeps_time_coverage_and_handles_zero(self):
        self.assertEqual(select_sharpest([0, 1, 10, 20, 8, 12], 3, min_score=5), [3, 5])
        self.assertEqual(select_sharpest([], 3), [])
        with self.assertRaises(ValueError):
            select_sharpest([1], 0)

    def test_laplacian_score_separates_blurred_texture(self):
        grid = (np.indices((64, 64)).sum(0) % 2 * 255).astype('uint8')
        im = Image.fromarray(grid)
        self.assertGreater(laplacian_variance(im), 20 * laplacian_variance(im.filter(ImageFilter.GaussianBlur(2))))


class TransformTests(unittest.TestCase):
    def test_position_and_anisotropic_covariance_are_rotated_together(self):
        R = rotation_between([0, 0, 1], [0, 1, 0])
        old_q = matrix_to_quaternion(rotation_between([1, 0, 0], [0, 1, 0]))
        p, q = bake_transform(np.array([[1., 2., 3.]]), old_q[None], R, np.array([1., 0., 1.]))
        np.testing.assert_allclose(p, [[0, 2, -2]], atol=1e-7)
        np.testing.assert_allclose(quaternion_matrix(q[0]), R @ quaternion_matrix(old_q), atol=1e-7)
        S = np.diag([1., 4., 9.])
        C = quaternion_matrix(old_q) @ S @ quaternion_matrix(old_q).T
        Q = quaternion_matrix(q[0])
        np.testing.assert_allclose(Q @ S @ Q.T, R @ C @ R.T, atol=1e-7)
        self.assertAlmostEqual(np.linalg.norm(q[0]), 1)
        self.assertAlmostEqual(np.linalg.det(R), 1)

    def test_antiparallel_rotation_is_proper(self):
        R = rotation_between([0, -1, 0], [0, 1, 0])
        np.testing.assert_allclose(R @ [0, -1, 0], [0, 1, 0], atol=1e-7)
        self.assertAlmostEqual(np.linalg.det(R), 1)
        q = matrix_to_quaternion(R)
        np.testing.assert_allclose(quaternion_matrix(q), R, atol=1e-7)

    def test_invalid_quaternion_is_rejected(self):
        with self.assertRaises(ScanError):
            bake_transform(np.zeros((1, 3)), np.zeros((1, 4)), np.eye(3), np.zeros(3))

    def test_tilted_camera_plane_aligns_and_center_is_robust(self):
        tilt=rotation_between([0,1,0],[0,0,1])
        centers=np.array([[-2.,1,0],[0,1,2],[2,1,0]])@tilt.T
        c2w=tilt@np.diag([1,-1,-1])
        rotations=np.repeat(c2w.T[None],3,axis=0)
        sparse=np.array([[-1.,0,0],[0,0,0],[1,0,0],[0,0,1],[1000,1000,1000]])@tilt.T
        d=estimate_scene_alignment(centers,rotations,sparse)
        self.assertAlmostEqual(d['cameraUpMeanY'],1)
        self.assertAlmostEqual(d['rotationDeterminant'],1)
        self.assertLess(d['cameraYBandToHorizontalSpanRatio'],1e-8)
        np.testing.assert_allclose(d['sparseCenterOriginal'],np.median(sparse,axis=0))
        self.assertLess(np.linalg.norm(d['sparseCenterOriginal']),2)


class SplatTests(unittest.TestCase):
    def sample(self):
        return dict(positions=np.array([[1., 2., 3.], [4, 5, 6], [7, 8, 9]]),
                    log_scales=np.log([[1., 2., 3.], [2, 2, 2], [1, 1, 1]]),
                    sh_dc=np.array([[0., 1., -1.], [0, 0, 0], [0, 0, 0]]),
                    opacity_logits=np.array([0., -20., 3.]),
                    quaternions=np.array([[1., 0, 0, 0], [1, 0, 0, 0], [0.5, 0.5, 0.5, 0.5]]))

    def test_exact_layout_round_trip_and_importance_sort(self):
        data, stats = encode_splat(**self.sample(), min_opacity=.01, max_splats=3)
        self.assertEqual(len(data), 64)
        self.assertEqual(stats['before'], 3)
        self.assertEqual(stats['after'], 2)
        # First splat volume*opacity = 3 > .95; byte offsets and little endian independent of decoder.
        self.assertEqual(struct.unpack_from('<3f', data, 0), (1., 2., 3.))
        np.testing.assert_allclose(struct.unpack_from('<3f', data, 12), [1., 2., 3.], atol=1e-6)
        self.assertEqual(data[24:28], bytes([128, 199, 56, 128]))
        self.assertEqual(data[28:32], bytes([255, 128, 128, 128]))
        decoded = decode_splat(data)
        np.testing.assert_allclose(decoded['positions'], [[1, 2, 3], [7, 8, 9]])
        np.testing.assert_allclose(np.linalg.norm(decoded['quaternions'], axis=1), 1, atol=1e-7)
        self.assertLess(stats['quantizedQuaternionMaxNormError'], .016)

    def test_cap_and_invalid_values(self):
        data, stats = encode_splat(**self.sample(), max_splats=1)
        self.assertEqual(len(data), 32)
        self.assertEqual(stats['after'], 1)
        sample = self.sample()
        sample['positions'][0, 0] = np.nan
        with self.assertRaises(ScanError):
            encode_splat(**sample)
        with self.assertRaises(ScanError):
            decode_splat(b'a')

    def test_extreme_logits_are_stable_and_floats_cannot_overflow(self):
        sample = self.sample()
        sample['opacity_logits'] = np.array([1000., -1000., 1000.])
        data, stats = encode_splat(**sample)
        self.assertEqual(stats['after'], 2)
        self.assertTrue(np.all(decode_splat(data)['rgba'][:, 3] == 255))
        sample['log_scales'][0] = [1000., 1000., 1000.]
        with self.assertRaises(ScanError):
            encode_splat(**sample)

    def test_zero_quaternions_and_all_transparent_data_fail(self):
        sample = self.sample()
        sample['quaternions'][0] = 0
        with self.assertRaises(ScanError):
            encode_splat(**sample)
        sample = self.sample()
        sample['opacity_logits'][:] = -1000
        with self.assertRaises(ScanError):
            encode_splat(**sample)

    def test_binary_and_ascii_ply_preserve_field_conventions(self):
        props = ['x','y','z','scale_0','scale_1','scale_2','f_dc_0','f_dc_1','f_dc_2','opacity','rot_0','rot_1','rot_2','rot_3']
        row = [1,2,3,0,0,0,.1,.2,.3,0,1,0,0,0]
        with tempfile.TemporaryDirectory() as td:
            for fmt in ['ascii', 'binary_little_endian']:
                p = Path(td)/f'{fmt}.ply'
                header = f'ply\nformat {fmt} 1.0\nelement vertex 1\n' + ''.join(f'property float {n}\n' for n in props) + 'end_header\n'
                payload = (' '.join(map(str,row))+'\n').encode() if fmt == 'ascii' else struct.pack('<14f',*row)
                p.write_bytes(header.encode()+payload)
                g = read_gaussian_ply(p)
                np.testing.assert_allclose(g['positions'], [[1,2,3]])
                np.testing.assert_allclose(g['quaternions'], [[1,0,0,0]])
                np.testing.assert_allclose(g['sh_dc'], [[.1,.2,.3]], rtol=1e-6)
            p.write_bytes(header.encode()+b'broken')
            with self.assertRaises(ScanError):
                read_gaussian_ply(p)


class GateAndMetadataTests(unittest.TestCase):
    def test_exhaustive_recovery_is_bounded_and_preserves_short_room_coverage(self):
        self.assertTrue(should_try_exhaustive(106,148))
        self.assertTrue(should_try_exhaustive(29,30))
        self.assertFalse(should_try_exhaustive(146,148))
        self.assertFalse(should_try_exhaustive(0,151))
        self.assertFalse(should_try_exhaustive(0,0))

    def test_auto_fallback_uses_both_registration_thresholds(self):
        self.assertFalse(should_fallback_to_learned('auto',30,50))
        self.assertTrue(should_fallback_to_learned('auto',29,30))
        self.assertTrue(should_fallback_to_learned('auto',59,100))
        self.assertFalse(should_fallback_to_learned('sift',0,100))
        self.assertFalse(should_fallback_to_learned('aliked',0,100))

    def metadata(self):
        return build_metadata(12, [[-1,-2,-3],[1,2,3]], [0,1,2], [0,0,0], 50, 30, 7000, '2026-10-17T12:00:00Z')

    def test_registration_boundaries(self):
        check_registration(30,50)
        check_registration(60,100)
        for registered,total in [(29,30),(59,100),(0,100),(30,0),(51,50)]:
            with self.subTest(registered=registered,total=total):
                with self.assertRaises(ScanError) as e:
                    check_registration(registered,total)
                self.assertIn('registered',str(e.exception))

    def test_metadata_exact_contract_and_json_round_trip(self):
        m = self.metadata()
        validate_metadata(json.loads(json.dumps(m,allow_nan=False)))
        self.assertEqual(m['coordinateSystem'],'y-up-right-handed')
        self.assertEqual(m['source']['pipeline'],'ffmpeg + pycolmap 4.2.1 + brush 0.3.0')
        for change in [lambda d:d.update(version=2), lambda d:d.update(splatFile='../x'),
                       lambda d:d['bounds'].update(min=[10,0,0]),lambda d:d.update(splatCount=True),
                       lambda d:d['initialCamera'].update(position=[float('nan'),0,0]),
                       lambda d:d['source'].update(createdAt='not a date'),
                       lambda d:d['source'].update(registeredFrames=51),
                       lambda d:d.update(extra='x')]:
            invalid = copy.deepcopy(m)
            change(invalid)
            with self.assertRaises(ScanError):
                validate_metadata(invalid)


if __name__ == '__main__':
    unittest.main()
