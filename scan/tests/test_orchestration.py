"""Local boundary tests; real ffmpeg/COLMAP/Brush execution is recorded separately."""
import importlib.util
import json
from pathlib import Path
import sys
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from reconstruct import Run, ScanError, main, natural_key, postprocess, save_json
from scan_core import decode_splat, quaternion_matrix, rotation_between, validate_metadata


class LocalBoundaryTests(unittest.TestCase):
    def test_feature_modes_are_explicit_and_old_training_resume_keeps_provenance(self):
        from reconstruct import parser
        self.assertEqual(parser().parse_args(['x','--name','x']).features,'auto')
        self.assertEqual(parser().parse_args(['x','--name','x','--features','aliked']).features,'aliked')
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)
            old={'features':4096,'max_frames':150,'steps':7000}
            Run(output,old,False)
            current={'features':'auto','sift_max_features':8192,'max_frames':None,'steps':7000}
            resumed=Run(output,current,True)
            self.assertEqual(resumed.report['config'],old)
            with self.assertRaises(ScanError):
                Run(output,dict(current,features='aliked'),True)

    @unittest.skipUnless(importlib.util.find_spec('lightglue'), 'optional LightGlue/torch learned-matching packages are not installed')
    def test_lightglue_optional_sift_cannot_load_pycolmap_in_torch_child(self):
        # A real subprocess catches LightGlue's eager optional SIFT import.
        # torch and pycolmap must never meet in this test runner, either.
        scan=Path(__file__).resolve().parents[1]
        script='import sys; sys.path.insert(0,sys.argv[1]); from learned_match import import_lightglue; import_lightglue(); assert sys.modules["pycolmap"] is None; print("isolated")'
        result=subprocess.run([sys.executable,'-c',script,str(scan)],capture_output=True,text=True,timeout=90)
        self.assertEqual(result.returncode,0,result.stderr[-2000:])
        self.assertIn('isolated',result.stdout)

    def test_bad_input_or_path_name_fails_before_creating_outputs(self):
        self.assertEqual(main(['/nonexistent/video.mp4','--name','../escape']),2)
        self.assertEqual(main(['/nonexistent/video.mp4','--name','test']),2)
        self.assertEqual(main(['/nonexistent/video.mp4','--name','test','--max-frames','29']),2)

    def test_photo_order_is_natural_not_lexical(self):
        ordered=sorted(map(Path,['photo10.jpg','photo2.jpg','photo1.jpg']),key=natural_key)
        self.assertEqual([p.name for p in ordered],['photo1.jpg','photo2.jpg','photo10.jpg'])

    def test_resume_preserves_completed_work_and_rejects_changed_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)
            run=Run(output,{'steps':10},False)
            marker=output/'marker'
            run.stage('frames',lambda:marker.write_text('original'))
            resumed=Run(output,{'steps':10},True)
            resumed.stage('frames',lambda:marker.write_text('overwritten'))
            self.assertEqual(marker.read_text(),'original')
            self.assertGreaterEqual(json.loads((output/'run.json').read_text())['stages']['frames']['seconds'],0)
            with self.assertRaises(ScanError):
                Run(output,{'steps':11},True)

    def test_failed_stage_is_logged_and_not_silently_reused(self):
        with tempfile.TemporaryDirectory() as tmp:
            run=Run(Path(tmp),{},False)
            def fail():
                raise ScanError('test failure')
            with self.assertRaises(ScanError):
                run.stage('frames',fail)
            stage=json.loads((Path(tmp)/'run.json').read_text())['stages']['frames']
            self.assertEqual(stage['status'],'failed')
            self.assertEqual(stage['error'],'test failure')
            with self.assertRaises(ScanError):
                run.stage('frames',lambda:None)

    def test_explicit_training_retry_archives_and_preserves_previous_attempt(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)
            exports=output/'work'/'training'
            exports.mkdir(parents=True)
            (exports/'partial.ply').write_bytes(b'partial training artifact')
            run=Run(output,{},False)
            run.report['stages']={'frames':{'status':'complete','seconds':1},
                                  'training':{'status':'failed','seconds':.1,'error':'Metal not available'}}
            run.flush()
            run.retry_training()
            self.assertNotIn('training',run.report['stages'])
            self.assertEqual(run.report['stages']['frames']['status'],'complete')
            self.assertEqual((output/'work'/'training-attempt-1'/'partial.ply').read_bytes(),b'partial training artifact')
            self.assertEqual(run.report['previousTrainingAttempts'][0]['error'],'Metal not available')
            self.assertFalse(exports.exists())
            with self.assertRaises(ScanError):
                run.retry_training()

    def test_metal_failure_is_actionable_without_changing_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            run=Run(Path(tmp),{},False)
            with self.assertRaises(ScanError) as caught:
                run.command([sys.executable,'-c',
                             'import sys; print("no_adapter_backends: Backends(METAL)"); sys.exit(101)'],
                            'brush.log')
            self.assertIn('cannot see a Metal GPU adapter',str(caught.exception))
            self.assertIn('cannot grant it',str(caught.exception))
            self.assertTrue((Path(tmp)/'brush.log').exists())

    def test_postprocess_writes_consistent_scene_pair_from_explicit_synthetic_ply(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)
            work=output/'work'
            (work/'training').mkdir(parents=True)
            R=rotation_between([0,0,1],[0,1,0])
            props=['x','y','z','scale_0','scale_1','scale_2','f_dc_0','f_dc_1','f_dc_2','opacity','rot_0','rot_1','rot_2','rot_3']
            header='ply\nformat ascii 1.0\nelement vertex 1\n'+''.join(f'property float {n}\n' for n in props)+'end_header\n'
            (work/'training'/'final.ply').write_text(header+'1 2 3 0 0 0 0 0 0 3 1 0 0 0\n')
            save_json(work/'alignment.json',{
                'rotationWorldToAligned':R.tolist(),'sparseCenterOriginal':[1,0,1],
                'initialCamera':{'position':[0,1,3],'target':[0,0,0]},
                'cameraYBandToHorizontalSpanRatio':.01})
            run=Run(output,{},False)
            run.report['metrics']['poses']={'inputFrames':50,'registeredFrames':30}
            postprocess(SimpleNamespace(min_opacity=.02,max_splats=100,steps=10),run)
            m=json.loads((output/'scene.json').read_text())
            validate_metadata(m)
            data=(output/'scene.splat').read_bytes()
            self.assertEqual(len(data),32*m['splatCount'])
            decoded=decode_splat(data)
            np.testing.assert_allclose(decoded['positions'],[[0,2,-2]],atol=1e-6)
            np.testing.assert_allclose(quaternion_matrix(decoded['quaternions'][0]),R,atol=.02)
            self.assertEqual(m['initialCamera']['position'],[0,1,3])


if __name__=='__main__':
    unittest.main()
