"""Strict capture parsing and actual COLMAP interchange, without torch/Metal."""
import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from reconstruct import (Run, import_learned_matches, import_pose_capture, native_log,
                         prepare_alignment, prepare_dataset)
from scan_core import ScanError, load_transforms, opengl_to_colmap


class PoseCaptureTests(unittest.TestCase):
    def capture(self, root):
        (root/'images').mkdir()
        frames=[]
        for i in range(30):
            Image.new('RGB',(64,48),(i,80,90)).save(root/'images'/f'{i}.png')
            c2w=np.eye(4)
            c2w[:3,3]=[i*.1,1+(i%2)*.01,(i%5)*.02]
            frames.append({'file_path':f'images/{i}.png','transform_matrix':c2w.tolist()})
        data={'camera_model':'PINHOLE','w':64,'h':48,'fl_x':50,'fl_y':51,'cx':32,'cy':24,'frames':frames}
        self.write(root,data)
        return data

    def write(self, root, data):
        (root/'transforms.json').write_text(json.dumps(data))

    def test_opengl_pose_conversion_preserves_camera_center_forward_and_handedness(self):
        c2w=np.eye(4)
        c2w[:3,3]=[2,3,4]
        w2c=opengl_to_colmap(c2w)
        np.testing.assert_allclose(w2c[:,:3],np.diag([1,-1,-1]))
        np.testing.assert_allclose(-w2c[:,:3].T@w2c[:,3],c2w[:3,3])
        np.testing.assert_allclose(w2c[:,:3]@np.array([0,0,-1]),[0,0,1])
        self.assertAlmostEqual(np.linalg.det(w2c[:,:3]),1)

    def test_nonrigid_nonfinite_reflected_or_bad_homogeneous_poses_fail(self):
        bad=[]
        for key,value in [((0,0),2),((0,0),-1),((0,1),.2),((0,3),float('nan')),((3,0),1)]:
            pose=np.eye(4);pose[key]=value;bad.append(pose)
        bad.extend([None,[[1,2,3]],'not a matrix'])
        for pose in bad:
            with self.subTest(pose=pose),self.assertRaises(ScanError):
                opengl_to_colmap(pose)

    def test_transforms_validated_and_per_frame_intrinsics_supported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);data=self.capture(root)
            for i,frame in enumerate(data['frames']): frame['fl_x']=50+i
            self.write(root,data)
            loaded=load_transforms(root)
            self.assertEqual(len(loaded),30)
            self.assertEqual(loaded[-1]['intrinsics']['fl_x'],79)
            np.testing.assert_allclose(loaded[0]['camFromWorld'][:,:3],np.diag([1,-1,-1]))

    def test_malformed_paths_calibration_and_frames_fail_before_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);valid=self.capture(root)
            changes=[lambda d:d.update(frames=[]),lambda d:d.update(camera_model='OPENCV_FISHEYE'),
                     lambda d:d.update(w=65),lambda d:d.update(fl_x=-1),lambda d:d.update(fl_y=True),
                     lambda d:d.update(cx=float('nan')),lambda d:d.update(k1=.1),
                     lambda d:d['frames'][0].update(fl_x=90),
                     lambda d:d['frames'][0].update(file_path='../outside.png'),
                     lambda d:d['frames'][0].update(file_path='/etc/hosts'),
                     lambda d:d['frames'][0].update(file_path='https://example.com/x.jpg'),
                     lambda d:d['frames'][0].update(file_path='images/no.png'),
                     lambda d:d['frames'][0].update(file_path='images/0.png\n'),
                     lambda d:d['frames'][1].update(file_path='images/0.png'),
                     lambda d:d['frames'][0].update(transform_matrix=[[1,2]]),
                     lambda d:d['frames'][0].update(mask_path='mask.png')]
            for change in changes:
                invalid=copy.deepcopy(valid);change(invalid);self.write(root,invalid)
                with self.subTest(change=change),self.assertRaises(ScanError): load_transforms(root)
            self.write(root,valid)
            (root/'images'/'0.png').unlink()
            (root/'images'/'0.png').symlink_to('/etc/hosts')
            with self.assertRaises(ScanError): load_transforms(root)

    def test_duplicate_json_keys_and_unsupported_distortion_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);data=self.capture(root)
            data.update(camera_model='OPENCV',k1=.1,k2=.01,p1=0,p2=0)
            self.write(root,data)
            self.assertEqual(load_transforms(root)[0]['intrinsics']['k1'],.1)
            data['k3']=.01;self.write(root,data)
            with self.assertRaises(ScanError): load_transforms(root)
            (root/'transforms.json').write_text('{"frames":[],"frames":[]}')
            with self.assertRaisesRegex(ScanError,'Duplicate'): load_transforms(root)

    def test_actual_import_undistortion_and_identity_alignment_contract(self):
        import pycolmap as pc
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';source.mkdir();self.capture(source)
            output=root/'run';(output/'work').mkdir(parents=True)
            run=Run(output,{},False)
            args=SimpleNamespace(max_frames=None,long_side=32,threads=1)
            import_pose_capture(args,run,load_transforms(source))
            recon=pc.Reconstruction(output/'work'/'sparse')
            self.assertEqual(recon.num_reg_images(),30)
            self.assertEqual(recon.num_points3D(),0)
            camera=recon.camera(1)
            self.assertEqual((camera.width,camera.height),(32,24))
            np.testing.assert_allclose(camera.params,[25,25.5,16,12])
            prepare_alignment(run,recon)
            diagnostics=json.loads((output/'work'/'alignment.json').read_text())
            np.testing.assert_array_equal(diagnostics['rotationWorldToAligned'],np.eye(3))
            np.testing.assert_allclose(diagnostics['sparseCenterOriginal'],[1.45,1.005,.04])
            prepare_dataset(args,run)
            dataset=pc.Reconstruction(output/'work'/'dataset'/'sparse')
            self.assertEqual(dataset.num_reg_images(),30)
            self.assertEqual({c.model_name for c in dataset.cameras.values()},{'PINHOLE'})
            for im in dataset.images.values():
                camera=dataset.camera(im.camera_id)
                with Image.open(output/'work'/'dataset'/'images'/im.name) as image:
                    self.assertEqual(image.size,(camera.width,camera.height))
            self.assertIsNone(run.report['metrics']['poses']['meanReprojectionErrorPixels'])


class LearnedDatabaseTests(unittest.TestCase):
    def exchange(self, path, invalid=False):
        # Two perspective views of a nonplanar synthetic scene; no learned runtime
        # or pickle is involved in this test of the real database/geometry APIs.
        rng=np.random.default_rng(10)
        xyz=rng.uniform([-1,-.8,3],[1,.8,6],size=(100,3))
        names=['000000.jpg','000001.jpg']
        for i in range(2):
            cam=xyz-[i*.4,0,0]
            points=768*cam[:,:2]/cam[:,2:]+[320,240]
            np.savez(path/f'features-{i:06d}.npz',keypoints=points.astype(np.float32))
        matches=np.repeat(np.arange(100,dtype=np.uint32)[:,None],2,axis=1)
        if invalid: matches[0,0]=1000
        np.savez(path/'matches-000000-000001.npz',matches=matches)
        (path/'manifest.json').write_text(json.dumps({'version':1,'names':names,
            'dimensions':[[640,480],[640,480]],'pairs':[[0,1]],'metrics':{'pairCount':1}}))

    def test_real_database_import_and_geometric_verification(self):
        import pycolmap as pc
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.exchange(root)
            db=root/'test.db';pairs=root/'pairs.txt'
            self.assertEqual(import_learned_matches(pc,db,root,pairs),{'pairCount':1})
            with pc.Database.open(db) as database:
                self.assertEqual(database.num_images(),2)
                np.testing.assert_equal(database.read_keypoints(1).shape,(100,2))
                np.testing.assert_equal(database.read_matches(1,2),np.repeat(np.arange(100)[:,None],2,axis=1))
            with native_log(root/'colmap.log'): pc.verify_matches(db,pairs)
            with pc.Database.open(db) as database:
                self.assertGreaterEqual(len(database.read_two_view_geometry(1,2).inlier_matches),90)

    def test_out_of_range_match_never_imported(self):
        import pycolmap as pc
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.exchange(root,invalid=True)
            with self.assertRaisesRegex(ScanError,'indices'):
                import_learned_matches(pc,root/'bad.db',root,root/'pairs.txt')


class AutomaticFallbackTests(unittest.TestCase):
    def reconstruction(self, registered):
        import pycolmap as pc
        recon=pc.Reconstruction()
        recon.add_camera_with_trivial_rig(pc.Camera(camera_id=1,model='PINHOLE',width=64,height=48,params=[50,50,32,24]))
        for i in range(registered):
            pose=np.column_stack([np.eye(3),[-i*.01,0,0]])
            recon.add_image_with_trivial_frame(pc.Image(name=f'{i:06d}.jpg',image_id=i+1,camera_id=1),pc.Rigid3d(pose))
        return recon

    def staged_sift_run(self, output, registered):
        from reconstruct import pose_metrics
        (output/'work'/'images').mkdir(parents=True)
        run=Run(output,{},False)
        run.report['stages']={stage:{'status':'complete','seconds':0} for stage in ['features','matching','mapping']}
        run.report['metrics']={'frames':{'inputFrames':30},'featureAttempts':{
            'sift':pose_metrics(self.reconstruction(registered),30,'sift','synthetic failed SIFT fixture')}}
        sparse=output/'work'/'sift-sparse';sparse.mkdir();self.reconstruction(registered).write(sparse)
        return run

    def test_auto_sift_success_skips_the_learned_process(self):
        from unittest.mock import patch
        from reconstruct import estimate_poses
        with tempfile.TemporaryDirectory() as tmp:
            run=self.staged_sift_run(Path(tmp),30)
            args=SimpleNamespace(features='auto',threads=1,sift_max_features=8192,long_side=1600)
            with patch.object(run,'command') as worker:
                result=estimate_poses(args,run)
            worker.assert_not_called()
            self.assertEqual(result.num_reg_images(),30)
            self.assertEqual(run.report['metrics']['poses']['featureMode'],'sift')

    def test_auto_sift_failure_runs_isolated_worker_and_keeps_both_results(self):
        import pycolmap as pc
        from unittest.mock import patch
        from reconstruct import estimate_poses
        with tempfile.TemporaryDirectory() as tmp:
            run=self.staged_sift_run(Path(tmp),29)
            args=SimpleNamespace(features='auto',threads=1,sift_max_features=8192,long_side=1600)
            with patch.object(run,'command') as worker, \
                 patch('reconstruct.import_learned_matches',return_value={'pairCount':1}), \
                 patch.object(pc,'verify_matches'), \
                 patch.object(pc,'incremental_mapping',return_value={0:self.reconstruction(30)}):
                result=estimate_poses(args,run)
            command=worker.call_args.args[0]
            self.assertEqual(command[0],sys.executable)
            self.assertEqual(Path(command[1]).name,'learned_match.py')
            self.assertEqual(result.num_reg_images(),30)
            self.assertEqual(run.report['metrics']['poses']['featureMode'],'aliked')
            self.assertEqual(run.report['metrics']['featureAttempts']['sift']['registeredFrames'],29)
            self.assertEqual(run.report['metrics']['featureAttempts']['aliked']['registeredFrames'],30)
            self.assertTrue((Path(tmp)/'work'/'sparse'/'images.bin').is_file())

    def test_both_modes_below_gate_preserve_results_and_white_wall_advice(self):
        import pycolmap as pc
        from unittest.mock import patch
        from reconstruct import estimate_poses
        with tempfile.TemporaryDirectory() as tmp:
            run=self.staged_sift_run(Path(tmp),29)
            args=SimpleNamespace(features='auto',threads=1,sift_max_features=8192,long_side=1600)
            with patch.object(run,'command'), \
                 patch('reconstruct.import_learned_matches',return_value={'pairCount':1}), \
                 patch.object(pc,'verify_matches'), \
                 patch.object(pc,'incremental_mapping',return_value={0:self.reconstruction(28)}):
                with self.assertRaisesRegex(ScanError,'door frames and floor edges'):
                    estimate_poses(args,run)
            self.assertEqual(set(run.report['metrics']['featureAttempts']),{'sift','aliked'})
            self.assertFalse((Path(tmp)/'work'/'sparse').exists())


if __name__=='__main__': unittest.main()
