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

from scan_core import (ScanError, PIPELINE, bake_transform, build_metadata, check_registration,
                       decode_splat, encode_splat, estimate_scene_alignment, laplacian_variance,
                       read_gaussian_ply, select_sharpest)

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


class Run:
    def __init__(self, output, config, resume):
        self.output = output
        self.path = output/'run.json'
        if resume:
            if not self.path.is_file():
                raise ScanError('--resume needs an existing run.json; otherwise choose a new --name.')
            self.report = json.loads(self.path.read_text())
            if self.report['config'] != config:
                raise ScanError('Resume settings/input differ from the saved run. Use the same options or a new --name.')
        else:
            self.report = {'pipeline':PIPELINE,'createdAt':now(),'status':'running','config':config,
                           'stages':{},'metrics':{},'attempts':[]}
        self.report['status']='running'
        self.report['attempts'].append({'startedAt':now()})
        self.flush()

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
        env['XDG_CACHE_HOME']=str(self.output/'work'/'cache')
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
        sources=sorted((p for p in args.input.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES),key=natural_key)
        if not sources:
            raise ScanError('No supported images in the directory. Supply ordered JPEG/PNG photos (no recursive search).')
        # At most three candidates per desired temporal window, preserving full sequence coverage.
        indices=np.unique(np.linspace(0,len(sources)-1,min(len(sources),args.max_frames*3),dtype=int))
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
        fps=min(args.max_frames*3/duration,native_fps or 30)
        # ffmpeg autorotation is explicitly enabled. Only local path input is accepted.
        scale=f"scale=w='min({args.long_side},iw)':h='min({args.long_side},ih)':force_original_aspect_ratio=decrease"
        run.command([ffmpeg,'-hide_banner','-loglevel','warning','-nostdin','-n','-autorotate',
                     '-i',args.input,'-vf',f'fps={fps:.9f},{scale}','-frames:v',str(args.max_frames*3),
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
    selected=select_sharpest(scores,args.max_frames,cutoff)
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
    stats={'inputFrames':len(selected),'candidates':len(candidates),'rejectedWindows':min(args.max_frames,len(candidates))-len(selected),
           'sharpnessCutoff':cutoff,'sharpnessP10P50P90':np.quantile(scores,[.1,.5,.9]).tolist(),
           'frameSize':list(output_size),**source_info}
    run.report['metrics']['frames']=stats
    save_json(work/'frame-selection.json',{'metrics':stats,'selectedCandidateIndices':selected,'candidateScores':scores})
    run.note(f'Selected {len(selected)}/{len(candidates)} frames; dimensions {output_size}; blur cutoff {cutoff:.2f}')


def estimate_poses(args,run):
    import pycolmap as pc
    work=run.output/'work'
    db=work/'colmap.db'
    images=work/'images'
    models_dir=work/'models'
    models_dir.mkdir(exist_ok=True)
    def extract():
        reader=pc.ImageReaderOptions()
        reader.camera_model='SIMPLE_RADIAL'
        extraction=pc.FeatureExtractionOptions()
        extraction.use_gpu=False
        extraction.num_threads=args.threads
        extraction.max_image_size=args.long_side
        extraction.sift.max_num_features=args.features
        with native_log(run.output/'colmap.log'):
            pc.extract_features(db,images,camera_mode=pc.CameraMode.SINGLE,reader_options=reader,
                                extraction_options=extraction,device=pc.Device.cpu)
    run.stage('features',extract)
    matching=pc.FeatureMatchingOptions()
    matching.use_gpu=False
    matching.num_threads=args.threads
    def match():
        pairing=pc.SequentialPairingOptions()
        pairing.overlap=10
        pairing.quadratic_overlap=True
        # Vocabulary trees require an extra download: explicitly disable loop detection.
        pairing.loop_detection=False
        pairing.num_threads=args.threads
        with native_log(run.output/'colmap.log'):
            pc.match_sequential(db,matching_options=matching,pairing_options=pairing,device=pc.Device.cpu)
    run.stage('matching',match)
    total=run.report['metrics']['frames']['inputFrames']
    chosen=work/'sparse'
    def map_images():
        options=pc.IncrementalPipelineOptions()
        options.num_threads=args.threads
        options.random_seed=42
        options.ba_use_gpu=False
        options.max_num_models=5
        options.min_model_size=10
        options.ba_global_max_num_iterations=50
        with native_log(run.output/'colmap.log'):
            models=pc.incremental_mapping(db,images,models_dir,options=options)
        best=max(models.values(),key=lambda r:r.num_reg_images(),default=None)
        registered=best.num_reg_images() if best else 0
        mode='sequential (overlap=10, quadratic overlap, no downloaded vocabulary)'
        # Bounded fallback: no unbounded quadratic work on long captures.
        if (registered<30 or registered/total<.6) and total<=150:
            run.note(f'Sequential model registered {registered}/{total}; trying exhaustive matching (<=150 frames).')
            start=time.perf_counter()
            fallback=work/'exhaustive-models'
            fallback.mkdir()
            with native_log(run.output/'colmap.log'):
                pc.match_exhaustive(db,matching_options=matching,device=pc.Device.cpu)
                other=pc.incremental_mapping(db,images,fallback,options=options)
            candidates=list(models.values())+list(other.values())
            best=max(candidates,key=lambda r:r.num_reg_images(),default=None)
            registered=best.num_reg_images() if best else 0
            mode+=' + exhaustive fallback'
            run.report['metrics']['exhaustiveFallbackSeconds']=round(time.perf_counter()-start,3)
        metric={'registeredFrames':registered,'inputFrames':total,'registeredFraction':registered/total,
                'meanReprojectionErrorPixels':float(best.compute_mean_reprojection_error()) if best else None,
                'sparsePoints':best.num_points3D() if best else 0,'matching':mode}
        run.report['metrics']['poses']=metric
        run.flush()
        run.note(f'Registered {registered}/{total} ({registered/total:.1%}); mean reprojection error {metric["meanReprojectionErrorPixels"]} px')
        check_registration(registered,total)
        chosen.mkdir()
        best.write(chosen)
    run.stage('mapping',map_images)
    check_registration(run.report['metrics']['poses']['registeredFrames'],total)
    return pc.Reconstruction(chosen)


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
        [p.xyz for p in recon.points3D.values()])
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
    p.add_argument('input',type=Path,help='Local video file or ordered image directory')
    p.add_argument('--name',required=True,help='New local output name (letters, digits, hyphen, underscore)')
    p.add_argument('--steps',type=int,default=7000)
    p.add_argument('--max-frames',type=int,default=150,help='Selected frame cap; <=150 enables bounded exhaustive recovery')
    p.add_argument('--long-side',type=int,default=1600)
    p.add_argument('--train-resolution',type=int,default=1200,help='Brush maximum image side (default 1200)')
    p.add_argument('--max-splats',type=int,default=1_500_000)
    p.add_argument('--min-opacity',type=float,default=.02)
    p.add_argument('--threads',type=int,default=min(os.cpu_count() or 4,8))
    p.add_argument('--features',type=int,default=4096)
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
        for k in ['steps','max_frames','long_side','train_resolution','max_splats','threads','features']:
            if getattr(args,k)<1:
                raise ScanError(f'--{k.replace("_","-")} must be positive.')
        if args.max_frames<30 or not 0<=args.min_opacity<1:
            raise ScanError('--max-frames must be >=30 and --min-opacity must be [0,1).')
        if args.retry_training and (not args.resume or args.stop_after):
            raise ScanError('--retry-training requires --resume and a full run (no --stop-after).')
        args.input=args.input.expanduser().resolve()
        if not args.input.exists():
            raise ScanError('Input does not exist. Use a local video or image directory; URLs are not accepted.')
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
        config.update({'ffmpeg':ffmpeg,'brush':brush,'pycolmap':pycolmap.__version__})
        run=Run(output,config,args.resume)
        if args.retry_training:
            run.retry_training()
        run.stage('frames',lambda:prepare_frames(args,run,ffmpeg,ffprobe))
        if args.stop_after!='frames':
            recon=estimate_poses(args,run)
            run.stage('alignment',lambda:prepare_alignment(run,recon))
            if args.stop_after!='poses':
                run.stage('undistort',lambda:prepare_dataset(args,run))
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
