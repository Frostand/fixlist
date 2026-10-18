#!/usr/bin/env python3
"""Offline video/photos -> CPU SfM -> Metal Brush -> FixList .splat + metadata."""
from __future__ import annotations

import argparse
from contextlib import contextmanager, redirect_stdout, redirect_stderr
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageOps
from artifact_identity import file_sha256, tree_identity

from scan_core import (ScanError, PIPELINE, bake_transform, build_metadata, check_registration,
                       decode_splat, encode_splat, estimate_scene_alignment, laplacian_variance,
                       read_gaussian_ply, select_sharpest, frame_budget, load_transforms,
                       should_try_exhaustive, should_fallback_to_learned)

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT/'private-captures'
IMAGE_SUFFIXES = {'.jpg','.jpeg','.png','.tif','.tiff','.webp','.bmp'}


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')


def save_json(path, obj):
    temp = path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(obj,indent=2,allow_nan=False)+'\n')
    temp.replace(path)


def binary(env_name, preferred, fallback):
    found = os.environ.get(env_name) or (str(preferred) if preferred.is_file() else shutil.which(fallback))
    if not found or not Path(found).is_file() or not os.access(found,os.X_OK):
        raise ScanError(f'Missing {fallback}. Follow scan/README.md setup or set {env_name}.')
    return str(Path(found).resolve())


def natural_key(path):
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r'(\d+)',path.name)]


def source_identity(config):
    """Content pins, not path/mtime/model-name promises. Missing inputs are explicit."""
    source = Path(config['input']) if 'input' in config else None
    inputs = {}
    if source is not None:
        if source.is_dir():
            for path in sorted(source.rglob('*')):
                if path.suffix.lower() in IMAGE_SUFFIXES or path.name == 'transforms.json':
                    if path.is_symlink():
                        raise ScanError('Input identity refuses symlinked sources.')
                    if path.is_file():
                        inputs[str(path.relative_to(source))] = file_sha256(path)
        else:
            inputs['input'] = tree_identity(source)
    tools = {key: tree_identity(Path(config[key])) for key in ['ffmpeg', 'ffprobe', 'brush'] if key in config}
    code = {name: file_sha256(Path(__file__).with_name(name)) for name in
            ['reconstruct.py', 'scan_core.py', 'learned_match.py', 'artifact_identity.py', 'requirements.txt']}
    weights = {}
    if config.get('features') in ('auto', 'aliked'):
        cache = Path(os.environ.get('TORCH_HOME', str(Path.home()/'.cache/torch')))/'hub/checkpoints'
        for name in ['aliked-n16.pth', 'aliked_lightglue_v0-1_arxiv.pth']:
            weights[name] = tree_identity(cache/name)
    return {'version': 1, 'inputs': inputs, 'tools': tools, 'code': code, 'weights': weights}


class Run:
    def __init__(self, output, config, resume):
        self.output = output
        self.path = output/'run.json'
        content = source_identity(config)
        if resume:
            if not self.path.is_file():
                raise ScanError('--resume needs an existing run.json; otherwise choose a new --name.')
            self.report = json.loads(self.path.read_text())
            comparison=dict(config)
            old=self.report['config']
            # Completed pre-mode runs used --features as a SIFT keypoint cap.
            # Permit their original default CLI to resume training unchanged;
            # retain the original config as the provenance record.
            if isinstance(old.get('features'),int) and comparison.get('features') in {'auto','sift'}:
                cap=comparison.pop('sift_max_features',8192)
                if cap in {8192,old['features']}:
                    comparison['features']=old['features']
                if comparison.get('max_frames') is None and old.get('max_frames') == 150:
                    comparison['max_frames']=150
            if old != comparison:
                raise ScanError('Resume settings/input differ from the saved run. Use the same options or a new --name.')
            if comparison != config:
                content = source_identity(comparison)
            if self.report.get('sourceIdentity') != content:
                raise ScanError('Resume input/tool/code/model bytes changed or old run lacks content identity. Preserve it and use a new --name.')
            self.verify_artifacts()
        else:
            self.report = {'pipeline':PIPELINE,'createdAt':now(),'status':'running','config':config,
                           'stages':{},'metrics':{},'attempts':[], 'sourceIdentity': content}
        self.report['status']='running'
        self.report['attempts'].append({'startedAt':now()})
        self.flush()

    def artifact_snapshot(self):
        result = {}
        for directory in ['work']:
            base = self.output/directory
            if not base.exists():
                continue
            for path in sorted(base.rglob('*')):
                relative = path.relative_to(self.output)
                if any(part == 'cache' or part.startswith('training-attempt-') for part in relative.parts):
                    continue
                # Failed training output is never reusable; retry_training archives it.
                if relative.parts[:2] == ('work', 'training') and self.report['stages'].get('training', {}).get('status') in {'failed', 'running'}:
                    continue
                if path.is_symlink():
                    raise ScanError('Resume artifacts contain a symlink; use a new --name.')
                if path.is_file():
                    result[str(relative)] = file_sha256(path)
        for name in ['scene.splat', 'scene.json']:
            path = self.output/name
            if path.exists():
                result[name] = tree_identity(path)
        return result

    def verify_artifacts(self):
        saved = self.report.get('artifactIdentity')
        if saved is None:
            if any(entry.get('status') == 'complete' for entry in self.report['stages'].values()):
                raise ScanError('Completed stages lack content identity. Preserve this run and use a new --name.')
            return
        if saved != self.artifact_snapshot():
            raise ScanError('Completed artifact bytes changed/missing; stale stages cannot resume. Preserve this run and use a new --name.')

    def flush(self):
        save_json(self.path,self.report)

    def note(self,message):
        line=f'{now()} {message}'
        print(line,flush=True)
        with (self.output/'run.log').open('a') as f:
            f.write(line+'\n')

    def retry_training(self):
        """Explicit recovery after an environment failure, retaining prior artifacts."""
        entry = self.report['stages'].get('training')
        if not entry or entry.get('status') not in {'failed','running'}:
            raise ScanError('--retry-training requires a failed/interrupted training stage.')
        if 'postprocess' in self.report['stages'] or (self.output/'scene.splat').exists():
            raise ScanError('Final output already exists; choose a new --name instead of retrying training.')
        attempts = self.report.setdefault('previousTrainingAttempts',[])
        exports = self.output/'work'/'training'
        archive = exports.with_name(f'training-attempt-{len(attempts)+1}')
        if archive.exists():
            raise ScanError('Training attempt archive already exists; preserve this run and choose a new --name.')
        if exports.exists():
            exports.rename(archive)
        attempts.append(dict(entry, archivedAt=now(), artifactDirectory=str(archive.relative_to(self.output))))
        del self.report['stages']['training']
        self.report.pop('error',None)
        self.flush()
        self.note('Preserved failed training attempt; retrying only training and postprocessing.')

    def stage(self,name,fn):
        entry=self.report['stages'].get(name)
        if entry and entry.get('status')=='complete':
            self.note(f'Reusing completed {name} (--resume)')
            return
        if entry:
            raise ScanError(f'Stage {name} was interrupted/failed. Preserve this run; choose a new --name to restart. '
                            'Completed earlier stages remain available for inspection.')
        self.note(f'Starting {name}')
        entry={'status':'running','startedAt':now()}
        self.report['stages'][name]=entry
        self.flush()
        start=time.perf_counter()
        try:
            fn()
            entry['status']='complete'
            self.report['artifactIdentity'] = self.artifact_snapshot()
        except BaseException as e:
            entry['status']='failed'
            entry['error']=str(e)
            raise
        finally:
            entry['seconds']=round(time.perf_counter()-start,3)
            entry['finishedAt']=now()
            self.flush()
        self.note(f'Finished {name} in {entry["seconds"]:.1f}s')

    def command(self,args,log_name):
        # Argument arrays, never a shell. Output and command paths are local-only.
        self.note('Running '+Path(args[0]).name+'; details: '+log_name)
        env=os.environ.copy()
        # Brush uses a disk shader/autotuning cache. Keep it under ignored output.
        if log_name == 'brush.log':
            env['XDG_CACHE_HOME']=str(self.output/'work'/'cache')
        if log_name == 'learned.log':
            env['PYTORCH_ENABLE_MPS_FALLBACK']='1'
        with (self.output/log_name).open('ab') as log:
            log.write(('\nCOMMAND '+json.dumps([str(a) for a in args])+'\n').encode())
            log.flush()
            proc=subprocess.run([str(a) for a in args],stdout=log,stderr=subprocess.STDOUT,
                                cwd=self.output,env=env)
        if proc.returncode:
            if log_name == 'brush.log':
                with (self.output/log_name).open('rb') as failed_log:
                    failed_log.seek(0, os.SEEK_END)
                    failed_log.seek(max(0, failed_log.tell()-65536))
                    details = failed_log.read().decode('utf-8', errors='replace')
                if 'no_adapter_backends: Backends(METAL)' in details:
                    raise ScanError('Brush cannot see a Metal GPU adapter in this process. '
                                    'The runtime must provide Metal access; this script cannot grant it. '
                                    f'Prepared data and diagnostics are preserved at {self.output}. '
                                    'See brush.log and scan/README.md for the parent handoff.')
            advice = ('For Brush: run on a Mac with Metal available; close memory-heavy apps.'
                      if log_name == 'brush.log' else
                      'For ALIKED/LightGlue: check the same venv and cached weights (scan/README.md).'
                      if log_name == 'learned.log' else
                      'For video decoding: use a playable MP4/MOV and check free disk space.')
            raise ScanError(f'{Path(args[0]).name} exited {proc.returncode}. Inspect {self.output/log_name}. '
                            f'{advice} No output is uploaded.')


@contextmanager
def native_log(path):
    """Capture C++ COLMAP stdout/stderr as well as Python, restoring descriptors."""
    sys.stdout.flush(); sys.stderr.flush()
    saved=[os.dup(1),os.dup(2)]
    try:
        with path.open('a') as log:
            os.dup2(log.fileno(),1); os.dup2(log.fileno(),2)
            with redirect_stdout(log),redirect_stderr(log):
                yield
    finally:
        os.dup2(saved[0],1);os.dup2(saved[1],2)
        for fd in saved:
            os.close(fd)


def prepare_frames(args,run,ffmpeg,ffprobe):
    work=run.output/'work'
    candidate_dir=work/'candidates'
    image_dir=work/'images'
    candidate_dir.mkdir(parents=True)
    image_dir.mkdir()
    if args.input.is_dir():
        budget=frame_budget(explicit=args.max_frames)
        sources=sorted((p for p in args.input.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES),key=natural_key)
        if not sources:
            raise ScanError('No supported images in the directory. Supply ordered JPEG/PNG photos (no recursive search).')
        # At most three candidates per desired temporal window, preserving full sequence coverage.
        indices=np.unique(np.linspace(0,len(sources)-1,min(len(sources),budget*3),dtype=int))
        candidates=[sources[i] for i in indices]
        source_info={'kind':'images','availableImages':len(sources)}
    else:
        proc=subprocess.run([ffprobe,'-v','error','-select_streams','v:0','-show_entries',
                             'stream=width,height,avg_frame_rate,duration:format=duration','-of','json',str(args.input)],
                            capture_output=True,text=True)
        if proc.returncode:
            raise ScanError('Cannot read video. Supply a local playable MP4/MOV or an ordered image directory.')
        probe=json.loads(proc.stdout)
        if not probe.get('streams'):
            raise ScanError('Input contains no video stream.')
        stream=probe['streams'][0]
        duration=float(stream.get('duration') or probe.get('format',{}).get('duration') or 0)
        if duration<=0:
            raise ScanError('Video duration is unknown/zero. Re-export it as a regular MP4 first.')
        rate=stream.get('avg_frame_rate','0/1').split('/')
        native_fps=float(rate[0])/max(float(rate[-1]),1)
        budget=frame_budget(duration,args.max_frames)
        fps=min(budget*3/duration,native_fps or 30)
        # ffmpeg autorotation is explicitly enabled. Only local path input is accepted.
        scale=f"scale=w='min({args.long_side},iw)':h='min({args.long_side},ih)':force_original_aspect_ratio=decrease"
        run.command([ffmpeg,'-hide_banner','-loglevel','warning','-nostdin','-n','-autorotate',
                     '-i',args.input,'-vf',f'fps={fps:.9f},{scale}','-frames:v',str(budget*3),
                     '-q:v','2',candidate_dir/'%06d.jpg'],'ffmpeg.log')
        candidates=sorted(candidate_dir.glob('*.jpg'))
        source_info={'kind':'video','durationSeconds':duration,'sourceFps':native_fps,'sampleFps':fps}
    scores=[]
    dimensions=[]
    for p in candidates:
        try:
            with Image.open(p) as image:
                image=ImageOps.exif_transpose(image)
                scores.append(laplacian_variance(image))
                dimensions.append(image.size)
        except (OSError,ValueError) as e:
            raise ScanError(f'Cannot decode candidate image {p.name}: {e}') from e
    if not scores:
        raise ScanError('No frames decoded. Re-export the video as MP4.')
    # Absolute floor catches blank/very blurred frames, relative floor is scene-adaptive.
    cutoff=max(2.,float(np.median(scores))*.20)
    selected=select_sharpest(scores,budget,cutoff)
    if len(selected)<30:
        raise ScanError(f'Only {len(selected)} sharp frames remain from {len(candidates)} candidates. '
                        'Need at least 30. Use a longer capture, improve lighting and move more slowly.')
    output_size=None
    for i,index in enumerate(selected):
        with Image.open(candidates[index]) as image:
            image=ImageOps.exif_transpose(image).convert('RGB')
            image.thumbnail((args.long_side,args.long_side),Image.Resampling.LANCZOS)
            if output_size is None:
                output_size=image.size
            elif output_size!=image.size:
                raise ScanError('Images have mixed dimensions/orientations. Use one camera/lens with fixed landscape framing.')
            image.save(image_dir/f'{i:06d}.jpg',quality=95)
    stats={'inputFrames':len(selected),'frameBudget':budget,'candidates':len(candidates),'rejectedWindows':min(budget,len(candidates))-len(selected),
           'sharpnessCutoff':cutoff,'sharpnessP10P50P90':np.quantile(scores,[.1,.5,.9]).tolist(),
           'frameSize':list(output_size),**source_info}
    run.report['metrics']['frames']=stats
    save_json(work/'frame-selection.json',{'metrics':stats,'selectedCandidateIndices':selected,'candidateScores':scores})
    run.note(f'Selected {len(selected)}/{len(candidates)} frames; dimensions {output_size}; blur cutoff {cutoff:.2f}')


def mapping_options(pc,args):
    options=pc.IncrementalPipelineOptions()
    options.num_threads=args.threads
    options.random_seed=42
    options.ba_use_gpu=False
    options.max_num_models=5
    options.min_model_size=10
    options.ba_global_max_num_iterations=50
    return options


def pose_metrics(best,total,mode,matching):
    registered=best.num_reg_images() if best else 0
    return {'registeredFrames':registered,'inputFrames':total,'registeredFraction':registered/total,
            'meanReprojectionErrorPixels':float(best.compute_mean_reprojection_error()) if best and best.num_points3D() else None,
            'sparsePoints':best.num_points3D() if best else 0,'matching':matching,'featureMode':mode}


def import_learned_matches(pc, database, exchange, pairs_path):
    """Read only numeric NPZ arrays; never import torch into this process."""
    manifest=json.loads((exchange/'manifest.json').read_text())
    if manifest.get('version') != 1 or len(manifest['names']) != len(manifest['dimensions']):
        raise ScanError('Invalid learned feature manifest.')
    names=manifest['names']
    if len(set(names)) != len(names) or any(not re.fullmatch(r'[0-9]+\.jpg',n) for n in names):
        raise ScanError('Invalid prepared image names in learned manifest.')
    image_ids=[]
    counts=[]
    cameras={}
    with pc.Database.open(database) as db:
        for i,(name,size) in enumerate(zip(names,manifest['dimensions'])):
            w,h=map(int,size)
            if min(w,h)<2:
                raise ScanError('Invalid learned image dimensions.')
            if (w,h) not in cameras:
                camera=pc.Camera(model='SIMPLE_RADIAL',width=w,height=h,params=[1.2*max(w,h),w/2,h/2,0.])
                cameras[w,h]=db.write_camera(camera)
            image_id=db.write_image(pc.Image(name=name,camera_id=cameras[w,h]))
            with np.load(exchange/f'features-{i:06d}.npz',allow_pickle=False) as data:
                keypoints=np.asarray(data['keypoints'],dtype=np.float32)
            if keypoints.ndim != 2 or keypoints.shape[1] != 2 or not np.isfinite(keypoints).all():
                raise ScanError('Invalid learned keypoints.')
            if np.any(keypoints<0) or np.any(keypoints>np.array([w,h])):
                raise ScanError('Learned keypoints are outside the image grid.')
            db.write_keypoints(image_id,keypoints)
            image_ids.append(image_id)
            counts.append(len(keypoints))
        pairs=[]
        seen=set()
        for i,j in manifest['pairs']:
            if not 0<=i<j<len(names) or (i,j) in seen:
                raise ScanError('Invalid/duplicate learned image pair.')
            seen.add((i,j))
            with np.load(exchange/f'matches-{i:06d}-{j:06d}.npz',allow_pickle=False) as data:
                raw=data['matches']
            if (raw.ndim != 2 or raw.shape[1] != 2 or raw.dtype.kind not in 'ui'
                    or np.any(raw<0) or np.any(raw>=np.array([counts[i],counts[j]]))):
                raise ScanError('Learned match indices are outside their feature arrays.')
            matches=raw.astype(np.uint32)
            db.write_matches(image_ids[i],image_ids[j],matches)
            pairs.append(f'{names[i]} {names[j]}\n')
    pairs_path.write_text(''.join(pairs))
    return manifest['metrics']


def estimate_poses(args,run):
    import pycolmap as pc
    work=run.output/'work'
    images=work/'images'
    total=run.report['metrics']['frames']['inputFrames']
    chosen=work/'sparse'
    if chosen.is_dir() and 'poses' in run.report['metrics']:
        run.verify_artifacts()
        check_registration(run.report['metrics']['poses']['registeredFrames'],total)
        return pc.Reconstruction(chosen)
    options=mapping_options(pc,args)
    candidates=[]
    attempts=run.report['metrics'].setdefault('featureAttempts',{})
    if args.features in {'auto','sift'}:
        db=work/'colmap.db'
        def extract():
            reader=pc.ImageReaderOptions()
            reader.camera_model='SIMPLE_RADIAL'
            extraction=pc.FeatureExtractionOptions()
            extraction.use_gpu=False
            extraction.num_threads=args.threads
            extraction.max_image_size=args.long_side
            extraction.sift.max_num_features=args.sift_max_features
            extraction.sift.peak_threshold=.003
            extraction.sift.estimate_affine_shape=True
            extraction.sift.domain_size_pooling=True
            # Three scale samples bound the CPU cost of DSP on walkthroughs.
            extraction.sift.dsp_num_scales=3
            run.report['metrics']['siftSettings']={k:v for k,v in extraction.sift.todict().items() if k!='normalization'}
            with native_log(run.output/'colmap.log'):
                pc.extract_features(db,images,camera_mode=pc.CameraMode.SINGLE,reader_options=reader,
                                    extraction_options=extraction,device=pc.Device.cpu)
        run.stage('features',extract)
        matching=pc.FeatureMatchingOptions()
        matching.use_gpu=False
        matching.num_threads=args.threads
        def match():
            pairing=pc.SequentialPairingOptions()
            pairing.overlap=12
            pairing.quadratic_overlap=True
            pairing.loop_detection=False
            pairing.num_threads=args.threads
            with native_log(run.output/'colmap.log'):
                pc.match_sequential(db,matching_options=matching,pairing_options=pairing,device=pc.Device.cpu)
        run.stage('matching',match)
        sift_chosen=work/'sift-sparse'
        def map_sift():
            models_dir=work/'models'
            models_dir.mkdir()
            with native_log(run.output/'colmap.log'):
                models=pc.incremental_mapping(db,images,models_dir,options=options)
            best=max(models.values(),key=lambda r:r.num_reg_images(),default=None)
            registered=best.num_reg_images() if best else 0
            mode='sequential (overlap=12, quadratic overlap, no downloaded vocabulary)'
            run.report['metrics']['siftSequential']=pose_metrics(best,total,'sift',mode)
            if should_try_exhaustive(registered,total):
                run.note(f'SIFT sequential model registered {registered}/{total}; trying exhaustive matching (<=150 frames, 95% coverage target).')
                start=time.perf_counter()
                fallback=work/'exhaustive-models'
                fallback.mkdir()
                with native_log(run.output/'colmap.log'):
                    pc.match_exhaustive(db,matching_options=matching,device=pc.Device.cpu)
                    other=pc.incremental_mapping(db,images,fallback,options=options)
                best=max(list(models.values())+list(other.values()),key=lambda r:r.num_reg_images(),default=None)
                mode+=' + exhaustive fallback'
                run.report['metrics']['exhaustiveFallbackSeconds']=round(time.perf_counter()-start,3)
            metric=pose_metrics(best,total,'sift',mode)
            attempts['sift']=metric
            if best:
                sift_chosen.mkdir()
                best.write(sift_chosen)
            run.note(f'SIFT registered {metric["registeredFrames"]}/{total}; {metric["sparsePoints"]} points; reprojection {metric["meanReprojectionErrorPixels"]} px')
        run.stage('mapping',map_sift)
        candidates.append((attempts['sift'],sift_chosen))
    if args.features=='aliked' or should_fallback_to_learned(args.features,attempts['sift']['registeredFrames'],total):
        if args.features=='auto':
            run.note('SIFT missed the 30-frame/60% gate; falling back to ALIKED + LightGlue in an isolated process.')
        exchange=work/'learned'
        run.stage('learned-features-matching',lambda:run.command(
            [sys.executable,Path(__file__).with_name('learned_match.py'),images,exchange,
             '--threads',args.threads],'learned.log'))
        db=work/'learned.db'
        pairs=work/'learned-pairs.txt'
        def import_matches():
            run.report['metrics']['learned']=import_learned_matches(pc,db,exchange,pairs)
        run.stage('learned-import',import_matches)
        def verify():
            with native_log(run.output/'colmap.log'):
                pc.verify_matches(db,pairs)
        run.stage('learned-verification',verify)
        learned_chosen=work/'learned-sparse'
        def map_learned():
            models_dir=work/'learned-models'
            models_dir.mkdir()
            with native_log(run.output/'colmap.log'):
                models=pc.incremental_mapping(db,images,models_dir,options=options)
            best=max(models.values(),key=lambda r:r.num_reg_images(),default=None)
            attempts['aliked']=pose_metrics(best,total,'aliked','temporal window=12 + sparse loop keyframes; LightGlue + geometric verification')
            if best:
                learned_chosen.mkdir()
                best.write(learned_chosen)
            m=attempts['aliked']
            run.note(f'ALIKED registered {m["registeredFrames"]}/{total}; {m["sparsePoints"]} points; reprojection {m["meanReprojectionErrorPixels"]} px')
        run.stage('learned-mapping',map_learned)
        candidates.append((attempts['aliked'],learned_chosen))
    metric,model=max(candidates,key=lambda c:c[0]['registeredFrames'])
    run.report['metrics']['poses']=metric
    run.flush()
    check_registration(metric['registeredFrames'],total)
    shutil.copytree(model,chosen)
    run.note(f'Selected {metric["featureMode"]}: {metric["registeredFrames"]}/{total} ({metric["registeredFraction"]:.1%})')
    return pc.Reconstruction(chosen)


def import_pose_capture(args,run,frames):
    """Preserve supplied poses; no feature extraction, matching, or SfM."""
    import pycolmap as pc
    work=run.output/'work'
    images=work/'images'
    images.mkdir()
    budget=frame_budget(explicit=args.max_frames)
    indices=np.unique(np.linspace(0,len(frames)-1,min(len(frames),budget),dtype=int))
    recon=pc.Reconstruction()
    cameras={}
    for n,index in enumerate(indices):
        frame=frames[index]
        values=frame['intrinsics']
        with Image.open(frame['source']) as image:
            image=image.convert('RGB')
            image.thumbnail((args.long_side,args.long_side),Image.Resampling.LANCZOS)
            w,h=image.size
            image.save(images/f'{n:06d}.jpg',quality=95)
        sx,sy=w/values['w'],h/values['h']
        params=[values['fl_x']*sx,values['fl_y']*sy,values['cx']*sx,values['cy']*sy]
        distortion=[values[k] for k in ['k1','k2','p1','p2']]
        model='OPENCV' if any(distortion) else 'PINHOLE'
        if model=='OPENCV':
            params+=distortion
        key=(model,w,h,*params)
        if key not in cameras:
            camera_id=len(cameras)+1
            recon.add_camera_with_trivial_rig(pc.Camera(camera_id=camera_id,model=model,width=w,height=h,params=params))
            cameras[key]=camera_id
        im=pc.Image(name=f'{n:06d}.jpg',image_id=n+1,camera_id=cameras[key])
        recon.add_image_with_trivial_frame(im,pc.Rigid3d(frame['camFromWorld']))
    chosen=work/'sparse'
    chosen.mkdir()
    recon.write(chosen)
    run.report['metrics']['frames']={'kind':'transforms','availableImages':len(frames),'inputFrames':len(indices),
                                      'frameBudget':budget,'worldUp':'+Y (supplied ARKit gravity)'}
    run.report['metrics']['poses']=pose_metrics(recon,len(indices),'imported','supplied OpenGL camera-to-world transforms; no SfM')
    run.report['metrics']['poses']['reprojectionErrorStatus']='not measured; imported poses have no feature tracks'
    run.note(f'Imported {len(indices)} supplied poses; no measured sparse points. Brush will use random initialization.')


def prepare_dataset(args,run):
    import pycolmap as pc
    work=run.output/'work'
    dataset=work/'dataset'
    with native_log(run.output/'colmap.log'):
        opts=pc.UndistortCameraOptions()
        opts.max_image_size=args.long_side
        pc.undistort_images(dataset,work/'sparse',work/'images',output_type='COLMAP',
                            undistort_options=opts,num_threads=args.threads,jpeg_quality=95)
    recon=pc.Reconstruction(dataset/'sparse')
    models={camera.model_name for camera in recon.cameras.values()}
    if models-{'PINHOLE','SIMPLE_PINHOLE'}:
        raise ScanError(f'Undistortion did not produce PINHOLE cameras: {models}')
    run.report['metrics']['dataset']={'cameraModels':sorted(models),'registeredFrames':recon.num_reg_images()}


def train(args,run,brush):
    work=run.output/'work'
    exports=work/'training'
    exports.mkdir()
    run.command([brush,work/'dataset','--total-steps',args.steps,'--max-resolution',args.train_resolution,
                 '--max-splats',args.max_splats,'--sh-degree','0','--growth-stop-iter',min(15000,int(args.steps*.8)),
                 '--export-every',args.steps,'--export-path',exports,'--export-name','final.ply'], 'brush.log')
    if not (exports/'final.ply').is_file():
        raise ScanError('Brush finished without final.ply. Inspect brush.log for an export error or Metal failure.')


def prepare_alignment(run,recon):
    ordered=sorted((im for im in recon.images.values() if im.has_pose),key=lambda im:im.name)
    diagnostics=estimate_scene_alignment(
        [im.projection_center() for im in ordered],
        [im.cam_from_world().rotation.matrix() for im in ordered],
        [p.xyz for p in recon.points3D.values()],
        preserve_world_up=run.report['metrics']['poses'].get('featureMode')=='imported')
    if run.report['metrics']['poses'].get('featureMode')=='imported':
        diagnostics['alignmentSource']='supplied y-up world; recenter only, camera trajectory median'
    chosen=diagnostics.pop('initialCameraIndex')
    diagnostics['initialCameraSourceImage']=ordered[chosen].name
    save_json(run.output/'work'/'alignment.json',diagnostics)
    run.report['metrics']['alignment']={k:v for k,v in diagnostics.items() if k not in ['cameraCentersAligned','cameraUpsAligned']}
    ratio=diagnostics['cameraYBandToHorizontalSpanRatio']
    run.note(f'Camera up aligned to +Y; determinant {diagnostics["rotationDeterminant"]:.6f}; height-band ratio {ratio:.3f}')
    if not diagnostics['cameraHorizontalBandSanity']:
        run.note('WARNING: camera centers do not form a narrow horizontal band. Review alignment; multilevel captures can legitimately do this.')


def postprocess(args,run):
    work=run.output/'work'
    diagnostics=json.loads((work/'alignment.json').read_text())
    R=np.asarray(diagnostics['rotationWorldToAligned'])
    center=np.asarray(diagnostics['sparseCenterOriginal'])
    camera=diagnostics['initialCamera']
    g=read_gaussian_ply(work/'training'/'final.ply')
    input_q_norms=np.linalg.norm(g['quaternions'],axis=1)
    g['positions'],g['quaternions']=bake_transform(g['positions'],g['quaternions'],R,center)
    data,stats=encode_splat(**g,min_opacity=args.min_opacity,max_splats=args.max_splats)
    # Decode and inspect the exact public interchange bytes, not just pre-encoding arrays.
    decoded=decode_splat(data)
    if not np.isfinite(decoded['positions']).all() or not np.isfinite(decoded['scales']).all():
        raise ScanError('Nonfinite values in final .splat.')
    poses=run.report['metrics']['poses']
    metadata=build_metadata(stats['after'],[stats['bounds']['min'],stats['bounds']['max']],
                            camera['position'],camera['target'],poses['inputFrames'],poses['registeredFrames'],args.steps,now())
    (run.output/'scene.splat').write_bytes(data)
    save_json(run.output/'scene.json',metadata)
    ratio=diagnostics['cameraYBandToHorizontalSpanRatio']
    diagnostics.update({
        'inputQuaternionNormMinMax':[float(input_q_norms.min()),float(input_q_norms.max())],
        'decodedQuaternionNormMinMax':list(map(float,[np.linalg.norm(decoded['quaternions'],axis=1).min(),np.linalg.norm(decoded['quaternions'],axis=1).max()])),
        'finitePositionsAndScales':True,'positiveScales':bool((decoded['scales']>0).all()),
        'splatSHA256':hashlib.sha256(data).hexdigest()})
    save_json(work/'alignment.json',diagnostics)
    run.report['metrics']['gaussians']=stats
    run.report['metrics']['sanity']={k:v for k,v in diagnostics.items() if k not in ['cameraCentersAligned','cameraUpsAligned']}
    run.note(f'Gaussians {stats["before"]:,} -> {stats["after"]:,}; scene.splat {len(data):,} bytes; camera Y-band ratio {ratio:.3f}')
    if not ratio<.5:
        run.note('WARNING: camera centers do not form a narrow horizontal band. Review alignment; multilevel captures can legitimately do this.')


def parser():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('input',type=Path,help='Local video, ordered photos, or y-up ARKit/nerfstudio transforms.json directory')
    p.add_argument('--name',required=True,help='New local output name (letters, digits, hyphen, underscore)')
    p.add_argument('--steps',type=int,default=7000)
    p.add_argument('--max-frames',type=int,default=None,help='Override adaptive video budget (~2.5 fps, 150–300); photos/imports default 150')
    p.add_argument('--long-side',type=int,default=1600)
    p.add_argument('--train-resolution',type=int,default=1200,help='Brush maximum image side (default 1200)')
    p.add_argument('--max-splats',type=int,default=1_500_000)
    p.add_argument('--min-opacity',type=float,default=.02)
    p.add_argument('--threads',type=int,default=min(os.cpu_count() or 4,8))
    p.add_argument('--features',choices=['auto','sift','aliked'],default='auto',
                   help='auto: tuned SIFT first, ALIKED+LightGlue if the 30-frame/60%% registration gate fails')
    p.add_argument('--sift-max-features',type=int,default=8192)
    p.add_argument('--stop-after',choices=['frames','poses'],help='Diagnostic partial run; resume with identical options and --resume')
    p.add_argument('--resume',action='store_true',help='Reuse completed stages only; never overwrite a failed stage')
    p.add_argument('--retry-training',action='store_true',help='With --resume, archive a failed training attempt and retry it')
    return p


def main(argv=None):
    args=parser().parse_args(argv)
    run=None
    start=time.perf_counter()
    try:
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}',args.name):
            raise ScanError('--name must be 1–64 letters/digits/hyphens/underscores, starting with a letter/digit.')
        for k in ['steps','long_side','train_resolution','max_splats','threads','sift_max_features']:
            if getattr(args,k)<1:
                raise ScanError(f'--{k.replace("_","-")} must be positive.')
        if (args.max_frames is not None and args.max_frames<30) or not 0<=args.min_opacity<1:
            raise ScanError('--max-frames must be >=30 and --min-opacity must be [0,1).')
        if args.retry_training and (not args.resume or args.stop_after):
            raise ScanError('--retry-training requires --resume and a full run (no --stop-after).')
        args.input=args.input.expanduser().resolve()
        if not args.input.exists():
            raise ScanError('Input does not exist. Use a local video or image directory; URLs are not accepted.')
        pose_frames=load_transforms(args.input) if args.input.is_dir() and (args.input/'transforms.json').exists() else None
        import pycolmap
        if pycolmap.__version__!='4.2.1':
            raise ScanError('This pipeline requires pycolmap 4.2.1. Follow scan/README.md setup.')
        ffmpeg=binary('FIXLIST_FFMPEG',Path.home()/'.homebrew/bin/ffmpeg','ffmpeg')
        ffprobe=binary('FIXLIST_FFPROBE',Path(ffmpeg).with_name('ffprobe'),'ffprobe')
        brush=binary('FIXLIST_BRUSH',Path.home()/'.local/share/fixlist-scan/brush/brush-app-aarch64-apple-darwin/brush_app','brush_app')
        version=subprocess.run([brush,'--version'],capture_output=True,text=True)
        if version.returncode or not re.search(r'\b0\.3\.0\b',version.stdout+version.stderr):
            raise ScanError('This pipeline requires Brush 0.3.0; check FIXLIST_BRUSH.')
        output=PRIVATE/'scans'/args.name
        # Refuse symlink redirection out of the private output tree.
        if PRIVATE.resolve()!=PRIVATE or (PRIVATE/'scans').resolve()!=PRIVATE/'scans' or output.resolve()!=output:
            raise ScanError('Output directory contains a symlink. Use ordinary private-captures/scans directories.')
        if output.exists() and not args.resume:
            raise ScanError(f'{output} exists. Use a new --name; --resume reuses completed stages without deleting anything.')
        output.mkdir(parents=True,exist_ok=args.resume)
        (output/'work').mkdir(exist_ok=True)
        config={k:str(v) if isinstance(v,Path) else v for k,v in vars(args).items() if k not in ['resume','stop_after','retry_training','name']}
        config.update({'ffmpeg':ffmpeg,'ffprobe':ffprobe,'brush':brush,'pycolmap':pycolmap.__version__})
        run=Run(output,config,args.resume)
        if args.retry_training:
            run.retry_training()
        run.stage('frames',lambda:import_pose_capture(args,run,pose_frames) if pose_frames is not None
                  else prepare_frames(args,run,ffmpeg,ffprobe))
        if args.stop_after!='frames':
            recon=pycolmap.Reconstruction(output/'work'/'sparse') if pose_frames is not None else estimate_poses(args,run)
            run.stage('alignment',lambda:prepare_alignment(run,recon))
            run.stage('undistort',lambda:prepare_dataset(args,run))
            if args.stop_after!='poses':
                run.stage('training',lambda:train(args,run,brush))
                run.stage('postprocess',lambda:postprocess(args,run))
        run.report['status']='partial' if args.stop_after else 'complete'
        run.report['attempts'][-1].update(finishedAt=now(),seconds=round(time.perf_counter()-start,3))
        run.report['totalStageSeconds']=round(sum(s['seconds'] for s in run.report['stages'].values()),3)
        run.flush()
        run.note(f'{run.report["status"].upper()}: {output}')
        return 0
    except (ScanError,OSError,ValueError,RuntimeError) as e:
        if run:
            run.report['status']='failed'; run.report['error']=str(e)
            run.report['attempts'][-1].update(finishedAt=now(),seconds=round(time.perf_counter()-start,3))
            run.report['totalStageSeconds']=round(sum(s['seconds'] for s in run.report['stages'].values()),3)
            run.flush(); run.note('FAILED: '+str(e))
        else:
            print('Scan failed: '+str(e),file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        if run:
            run.report['status']='interrupted';run.flush()
        print('Interrupted; existing local outputs were preserved.',file=sys.stderr)
        return 130


if __name__=='__main__':
    sys.exit(main())
