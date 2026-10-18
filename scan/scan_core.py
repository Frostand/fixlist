"""Deterministic local scan processing. Quaternion convention throughout: w,x,y,z."""
from __future__ import annotations

from datetime import datetime
import math
from pathlib import Path

import numpy as np
from PIL import Image

PIPELINE = 'ffmpeg + pycolmap 4.2.1 + brush 0.3.0'
SH_C0 = 0.28209479177387814
SPLAT_DTYPE = np.dtype([('position','<f4',(3,)), ('scale','<f4',(3,)),
                       ('rgba','u1',(4,)), ('rotation','u1',(4,))])


class ScanError(RuntimeError):
    """An actionable failure that should be shown without an internal traceback."""


def laplacian_variance(image: Image.Image) -> float:
    """Comparable sharpness scores after a fixed downsample; no OpenCV required."""
    gray = image.convert('L')
    gray.thumbnail((640, 640), Image.Resampling.LANCZOS)
    a = np.asarray(gray, dtype=np.float32)
    if min(a.shape) < 3:
        return 0.0
    lap = a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:] - 4*a[1:-1, 1:-1]
    return float(lap.var())


def select_sharpest(scores, max_frames: int, min_score: float = 0.0) -> list[int]:
    """Pick the sharpest candidate per disjoint temporal window; stable ties."""
    if max_frames < 1:
        raise ValueError('max_frames must be positive')
    scores = np.asarray(scores, dtype=float)
    if scores.ndim != 1 or not np.isfinite(scores).all():
        raise ValueError('sharpness scores must be finite and one-dimensional')
    if not len(scores):
        return []
    windows = np.array_split(np.arange(len(scores)), min(max_frames, len(scores)))
    selected = [int(w[np.argmax(scores[w])]) for w in windows]
    return [i for i in selected if scores[i] >= min_score]


def check_registration(registered: int, total: int) -> None:
    if total < 1 or registered > total or registered < 30 or registered/total < .60:
        raise ScanError(f'Only {registered}/{total} frames registered — need at least 30 and 60%. '
                        'Walk around the room instead of spinning in place, improve lighting, '
                        'add visible texture, keep more overlap, and avoid mirrors or moving people.')


def _unit(v):
    v = np.asarray(v, dtype=np.float64)
    norm = np.linalg.norm(v, axis=-1, keepdims=True)
    if not np.isfinite(v).all() or np.any(norm < 1e-12):
        raise ScanError('Invalid zero or nonfinite vector/quaternion in reconstruction.')
    return v/norm


def quaternion_multiply(a, b):
    a, b = np.broadcast_arrays(np.asarray(a), np.asarray(b))
    aw, ax, ay, az = np.moveaxis(a, -1, 0)
    bw, bx, by, bz = np.moveaxis(b, -1, 0)
    return np.stack([aw*bw-ax*bx-ay*by-az*bz, aw*bx+ax*bw+ay*bz-az*by,
                     aw*by-ax*bz+ay*bw+az*bx, aw*bz+ax*by-ay*bx+az*bw], axis=-1)


def quaternion_matrix(q):
    w,x,y,z = _unit(q)
    return np.array([[1-2*(y*y+z*z),2*(x*y-w*z),2*(x*z+w*y)],
                     [2*(x*y+w*z),1-2*(x*x+z*z),2*(y*z-w*x)],
                     [2*(x*z-w*y),2*(y*z+w*x),1-2*(x*x+y*y)]])


def matrix_to_quaternion(R):
    """Convert a proper rotation, with a stable branch for 180-degree rotations."""
    R = np.asarray(R, dtype=float)
    if R.shape != (3,3) or not np.allclose(R.T@R, np.eye(3), atol=1e-6) or not np.isclose(np.linalg.det(R), 1):
        raise ScanError('Alignment must be a proper right-handed rigid rotation.')
    trace = float(np.trace(R))
    if trace > 0:
        s = math.sqrt(trace+1)*2
        q = [s/4, (R[2,1]-R[1,2])/s, (R[0,2]-R[2,0])/s, (R[1,0]-R[0,1])/s]
    else:
        i = int(np.argmax(np.diag(R)))
        j,k = (i+1)%3, (i+2)%3
        s = math.sqrt(max(0,1+R[i,i]-R[j,j]-R[k,k]))*2
        q = np.zeros(4)
        q[0] = (R[k,j]-R[j,k])/s
        q[i+1] = s/4
        q[j+1] = (R[j,i]+R[i,j])/s
        q[k+1] = (R[k,i]+R[i,k])/s
    return _unit(q)


def rotation_between(source, target):
    a,b = _unit(source),_unit(target)
    dot = float(np.clip(a@b, -1, 1))
    if dot > 1-1e-12:
        return np.eye(3)
    if dot < -1+1e-12:
        axis = _unit(np.cross(a,np.eye(3)[np.argmin(np.abs(a))]))
        return 2*np.outer(axis,axis)-np.eye(3)
    cross = np.cross(a,b)
    K = np.array([[0,-cross[2],cross[1]],[cross[2],0,-cross[0]],[-cross[1],cross[0],0]])
    return np.eye(3)+K+K@K/(1+dot)


def bake_transform(positions, quaternions, R, center):
    """p'=R(p-center), q'=q_R*q. Keep scales unchanged (no reflection/scaling)."""
    positions = np.asarray(positions,dtype=float)
    center = np.asarray(center,dtype=float)
    if not np.isfinite(positions).all() or not np.isfinite(center).all():
        raise ScanError('Nonfinite positions or scene center.')
    q = _unit(quaternions)
    return (positions-center)@np.asarray(R).T, _unit(quaternion_multiply(matrix_to_quaternion(R),q))


def estimate_scene_alignment(camera_centers, world_to_camera_rotations, sparse_points):
    """Estimate rigid y-up alignment and an inward real-camera starting view."""
    centers = np.asarray(camera_centers,dtype=float)
    rotations = np.asarray(world_to_camera_rotations,dtype=float)
    sparse = np.asarray(sparse_points,dtype=float)
    if centers.ndim != 2 or centers.shape[1:] != (3,) or not len(centers) or rotations.shape != (len(centers),3,3):
        raise ScanError('Missing or malformed registered cameras for scene alignment.')
    if sparse.ndim != 2 or sparse.shape[1:] != (3,) or not len(sparse) or not np.isfinite(sparse).all():
        raise ScanError('No finite sparse points to center the scene.')
    if not np.isfinite(centers).all():
        raise ScanError('Nonfinite camera centers.')
    ups = _unit(-rotations[:,1,:])
    rough = _unit(np.median(ups,axis=0))
    keep = ups@rough > .5
    if keep.mean() < .6:
        raise ScanError('Camera up directions disagree. Keep the phone landscape/upright; avoid changing orientation during capture.')
    up = _unit(ups[keep].mean(axis=0))
    R = rotation_between(up,[0,1,0])
    center = np.median(sparse,axis=0)
    aligned_centers = (centers-center)@R.T
    forwards = rotations[:,2,:]@R.T
    to_center = -aligned_centers
    to_center /= np.maximum(np.linalg.norm(to_center,axis=1,keepdims=True),1e-12)
    # A dimensionless height penalty preserves the arbitrary reconstruction scale.
    extent = max(float(np.median(np.linalg.norm(sparse-center,axis=1))),.1)
    score = (forwards*to_center).sum(axis=1)-.05*np.abs(aligned_centers[:,1]-np.median(aligned_centers[:,1]))/extent
    chosen = int(np.argmax(score))
    target = aligned_centers[chosen]+forwards[chosen]*extent
    band = np.quantile(aligned_centers[:,1],[.05,.95])
    horizontal = np.ptp(aligned_centers[:,[0,2]],axis=0)
    ratio = float(np.ptp(band)/max(float(np.linalg.norm(horizontal)),1e-12))
    aligned_ups = ups@R.T
    return {'rotationWorldToAligned':R.tolist(),'sparseCenterOriginal':center.tolist(),
            'estimatedUpOriginal':up.tolist(),'rotationDeterminant':float(np.linalg.det(R)),
            'cameraUpMeanY':float(aligned_ups[:,1].mean()),
            'cameraUpPositiveFraction':float((aligned_ups[:,1]>0).mean()),
            'cameraUpInlierFraction':float(keep.mean()),'cameraYBandP05P95':band.tolist(),
            'cameraHorizontalSpanXZ':horizontal.tolist(),'cameraYBandToHorizontalSpanRatio':ratio,
            'cameraHorizontalBandSanity':ratio<.5,'cameraCentersAligned':aligned_centers.tolist(),
            'cameraUpsAligned':aligned_ups.tolist(),'initialCameraIndex':chosen,
            'initialCamera':{'position':aligned_centers[chosen].tolist(),'target':target.tolist()},'units':'arbitrary'}


def read_gaussian_ply(path: Path) -> dict:
    """Read Brush's standard uncompressed scalar Gaussian PLY, without plyfile."""
    types = {'float':'f4','float32':'f4','double':'f8','float64':'f8','uchar':'u1',
             'uint8':'u1','char':'i1','int8':'i1','int':'i4','int32':'i4','uint':'u4',
             'uint32':'u4','short':'i2','int16':'i2','ushort':'u2','uint16':'u2'}
    try:
        with Path(path).open('rb') as f:
            if f.readline().strip() != b'ply':
                raise ScanError('Brush export is not a PLY file.')
            props, count, fmt, active = [], None, None, None
            for _ in range(4096):
                line = f.readline()
                if not line:
                    raise ScanError('Truncated PLY header.')
                words = line.decode('ascii').strip().split()
                if not words:
                    continue
                if words[0] == 'end_header':
                    break
                if words[0] == 'format':
                    fmt = words[1]
                elif words[0] == 'element':
                    active = words[1]
                    if count is None and active != 'vertex':
                        raise ScanError('PLY must have vertex data first.')
                    if active == 'vertex':
                        count = int(words[2])
                elif words[0] == 'property' and active == 'vertex':
                    if len(words) != 3 or words[1] not in types:
                        raise ScanError('Unsupported list/packed PLY. Export standard Gaussian PLY from Brush 0.3.0.')
                    props.append((words[2],'<'+types[words[1]]))
            else:
                raise ScanError('PLY header is too large.')
            if count is None or count < 1:
                raise ScanError('Brush PLY has no Gaussians.')
            dtype = np.dtype(props)
            if fmt == 'binary_little_endian':
                rows = np.fromfile(f,dtype=dtype,count=count)
                if len(rows) != count:
                    raise ScanError('Truncated Brush PLY data.')
            elif fmt == 'ascii':
                a = np.loadtxt(f,max_rows=count,ndmin=2)
                if a.shape != (count,len(props)):
                    raise ScanError('Truncated ASCII PLY data.')
                rows = np.empty(count,dtype=dtype)
                for i,(key,_) in enumerate(props):
                    rows[key] = a[:,i]
            else:
                raise ScanError(f'Unsupported PLY encoding {fmt}; need standard little-endian or ASCII.')
        groups = {'positions':['x','y','z'], 'log_scales':[f'scale_{i}' for i in range(3)],
                  'sh_dc':[f'f_dc_{i}' for i in range(3)], 'quaternions':[f'rot_{i}' for i in range(4)]}
        result = {group:np.column_stack([rows[k] for k in keys]).astype(float) for group,keys in groups.items()}
        result['opacity_logits'] = rows['opacity'].astype(float)
        return result
    except ScanError:
        raise
    except (OSError, ValueError, KeyError, UnicodeError, IndexError) as e:
        raise ScanError(f'Cannot read Gaussian PLY: {e}') from e


def encode_splat(positions, log_scales, sh_dc, opacity_logits, quaternions,
                 min_opacity=.02, max_splats=1_500_000):
    arrays = [np.asarray(v,dtype=float) for v in (positions,log_scales,sh_dc,opacity_logits,quaternions)]
    positions,logs,dc,logits,q = arrays
    n = len(positions)
    if not n or any(v.shape != s for v,s in zip(arrays,[(n,3),(n,3),(n,3),(n,),(n,4)])):
        raise ScanError('Invalid or empty Gaussian arrays.')
    if not all(np.isfinite(v).all() for v in arrays):
        raise ScanError('Brush produced nonfinite Gaussian values; inspect training log before retrying.')
    if not 0 <= min_opacity < 1 or max_splats < 1:
        raise ScanError('Opacity cutoff must be [0,1) and splat cap must be positive.')
    q = _unit(q)
    # Stable sigmoid and log-volume ranking avoid overflow on irrelevant outliers.
    alpha = np.exp(-np.logaddexp(0,-logits))
    keep = np.flatnonzero(alpha >= min_opacity)
    after_opacity = len(keep)
    if not after_opacity:
        raise ScanError('No Gaussians remain after opacity pruning; train longer or lower --min-opacity.')
    importance = logs[keep].sum(axis=1)+np.log(alpha[keep])
    order = keep[np.argsort(-importance,kind='stable')[:max_splats]]
    with np.errstate(over='ignore',under='ignore',invalid='ignore'):
        scales = np.exp(logs[order]).astype('<f4')
        pos = positions[order].astype('<f4')
    if not np.isfinite(scales).all() or not np.isfinite(pos).all() or np.any(scales <= 0):
        raise ScanError('Gaussian positions/scales exceed the finite positive float32 .splat range.')
    rows = np.empty(len(order),dtype=SPLAT_DTYPE)
    rows['position'], rows['scale'] = pos,scales
    rows['rgba'][:,:3] = np.clip(np.rint((.5+SH_C0*dc[order])*255),0,255).astype('u1')
    rows['rgba'][:,3] = np.clip(np.rint(alpha[order]*255),0,255).astype('u1')
    # Match antimatter15: decode is (byte-128)/128, NOT (byte/255)*2-1.
    rows['rotation'] = np.clip(np.rint(q[order]*128+128),0,255).astype('u1')
    decoded_q = (rows['rotation'].astype(float)-128)/128
    stats = {'before':n, 'afterOpacityPrune':after_opacity, 'after':len(order),
             'prunedOpacity':n-after_opacity, 'prunedCap':after_opacity-len(order),
             'bytes':len(order)*32, 'quantizedQuaternionMaxNormError':float(np.max(np.abs(np.linalg.norm(decoded_q,axis=1)-1))),
             'bounds':{'min':pos.min(axis=0).tolist(),'max':pos.max(axis=0).tolist()},
             'robustBoundsP01P99':np.quantile(pos,[.01,.99],axis=0).tolist(),
             'scaleP01P50P99':np.quantile(scales,[.01,.5,.99]).tolist()}
    return rows.tobytes(), stats


def decode_splat(data: bytes):
    if not data or len(data)%32:
        raise ScanError('.splat length must be a positive multiple of 32 bytes.')
    rows = np.frombuffer(data,dtype=SPLAT_DTYPE)
    return {'positions':rows['position'].copy(), 'scales':rows['scale'].copy(),
            'rgba':rows['rgba'].copy(), 'quaternions':_unit((rows['rotation'].astype(float)-128)/128)}


def build_metadata(count, bounds, camera_position, camera_target, total, registered, steps, created_at):
    metadata = {'format':'fixlist-scan-metadata','version':1,'splatFile':'scene.splat','splatCount':int(count),
                'coordinateSystem':'y-up-right-handed','units':'arbitrary',
                'bounds':{'min':list(bounds[0]),'max':list(bounds[1])},
                'initialCamera':{'position':list(camera_position),'target':list(camera_target)},
                'source':{'inputFrames':int(total),'registeredFrames':int(registered),'createdAt':created_at,
                          'pipeline':PIPELINE,'trainingSteps':int(steps)}}
    validate_metadata(metadata)
    return metadata


def validate_metadata(m):
    def require(ok,message):
        if not ok:
            raise ScanError('Invalid scene metadata: '+message)
    def exact(obj, keys):
        require(isinstance(obj,dict) and set(obj)==set(keys),'unexpected/missing fields')
    def positive_int(v):
        return type(v) is int and v > 0
    def vec(v):
        return isinstance(v,list) and len(v)==3 and all(type(x) in (int,float) and math.isfinite(x) for x in v)
    exact(m,['format','version','splatFile','splatCount','coordinateSystem','units','bounds','initialCamera','source'])
    require(m['format']=='fixlist-scan-metadata' and type(m['version']) is int and m['version']==1,'format/version')
    require(m['splatFile']=='scene.splat' and positive_int(m['splatCount']),'splat filename/count')
    require(m['coordinateSystem']=='y-up-right-handed' and m['units']=='arbitrary','coordinate system/units')
    exact(m['bounds'],['min','max'])
    require(all(vec(m['bounds'][k]) for k in ['min','max']),'finite bounds')
    require(all(a<=b for a,b in zip(m['bounds']['min'],m['bounds']['max'])),'inverted bounds')
    exact(m['initialCamera'],['position','target'])
    require(all(vec(v) for v in m['initialCamera'].values()),'finite camera')
    require(m['initialCamera']['position']!=m['initialCamera']['target'],'zero camera direction')
    s=m['source']
    exact(s,['inputFrames','registeredFrames','createdAt','pipeline','trainingSteps'])
    require(all(positive_int(s[k]) for k in ['inputFrames','registeredFrames','trainingSteps']),'source counts')
    require(30<=s['registeredFrames']<=s['inputFrames'] and s['registeredFrames']/s['inputFrames']>=.6,'registration threshold')
    require(s['pipeline']==PIPELINE,'pipeline version')
    try:
        dt=datetime.fromisoformat(s['createdAt'].replace('Z','+00:00'))
        require(dt.tzinfo is not None,'timestamp must include timezone')
    except (ValueError,TypeError,AttributeError) as e:
        raise ScanError('Invalid scene metadata: ISO-8601 timestamp') from e
