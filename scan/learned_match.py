#!/usr/bin/env python3
"""Torch-only feature worker. Never import pycolmap here (OpenMP collision)."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image

from scan_core import ScanError, matching_pairs


def import_lightglue():
    # LightGlue imports its optional SIFT adapter at package initialization.
    # Disabling that optional dependency prevents its pycolmap/OpenMP import.
    if sys.modules.get('pycolmap') is not None:
        raise ScanError('Learned matching must run in a fresh process without pycolmap.')
    sys.modules['pycolmap'] = None
    from lightglue import ALIKED, LightGlue
    return ALIKED, LightGlue


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('images', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--threads', type=int, default=4)
    p.add_argument('--max-keypoints', type=int, default=2048)
    p.add_argument('--long-side', type=int, default=1024)
    args = p.parse_args(argv)
    start = time.perf_counter()
    try:
        # Check cache before model construction: reconstruction must stay offline.
        import torch
        torch.set_num_threads(max(1, min(args.threads, 4)))
        torch.set_num_interop_threads(1)
        torch.manual_seed(42)
        cache = Path(torch.hub.get_dir())/'checkpoints'
        for name in ['aliked-n16.pth', 'aliked_lightglue_v0-1_arxiv.pth']:
            if not (cache/name).is_file():
                raise ScanError(f'Missing cached learned weight {name}. Prepare LightGlue weights before running offline (scan/README.md).')
        # LightGlue's package initializer imports its optional SIFT adapter,
        # which otherwise imports pycolmap even though we only request ALIKED.
        # Mark that optional dependency unavailable in this child process.
        # Do not use KMP_DUPLICATE_LIB_OK: it masks the unsafe runtime collision.
        ALIKED, LightGlue = import_lightglue()
        if not 1 <= args.max_keypoints <= 2048 or not 32 <= args.long_side <= 1024:
            raise ScanError('Learned worker budget: 1–2048 keypoints and 32–1024 pixel long side.')
        device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
        print(f'ALIKED + LightGlue device={device}; threads={torch.get_num_threads()}', flush=True)
        # ALIKED deform_conv2d currently has no native MPS implementation. PyTorch's
        # CPU fallback is enabled by the caller only in this isolated process.
        extractor = ALIKED(max_num_keypoints=args.max_keypoints).eval().to(device)
        matcher = LightGlue(features='aliked', depth_confidence=.9, width_confidence=.95).eval().to(device)
        args.output.mkdir(parents=True)
        names = sorted(p.name for p in args.images.glob('*.jpg'))
        if not names:
            raise ScanError('Learned worker has no prepared JPEG frames.')
        pairs = matching_pairs(len(names))
        features = []
        dimensions = []
        extraction_start = time.perf_counter()
        with torch.inference_mode():
            for i, name in enumerate(names):
                with Image.open(args.images/name) as im:
                    original = im.size
                    im = im.convert('RGB')
                    im.thumbnail((args.long_side, args.long_side), Image.Resampling.LANCZOS)
                    size = im.size
                    pixels = np.array(im, dtype=np.float32)/255
                image = torch.from_numpy(pixels.transpose(2, 0, 1)).to(device)
                feats = extractor.extract(image, resize=None)
                features.append({k:v.detach().cpu() for k,v in feats.items()})
                # Feature coordinates are zero-based pixel centers; COLMAP uses
                # centers at .5. Rescale to the original training-image grid.
                keypoints = (feats['keypoints'][0].cpu().numpy()+.5)*np.array(original)/np.array(size)
                np.savez(args.output/f'features-{i:06d}.npz', keypoints=keypoints.astype(np.float32))
                dimensions.append(list(original))
                if i % 20 == 0 or i+1 == len(names):
                    print(f'extracted {i+1}/{len(names)} ({time.perf_counter()-extraction_start:.1f}s)', flush=True)
            extract_seconds = time.perf_counter()-extraction_start
            match_start = time.perf_counter()
            nonempty = matches_total = 0
            for index, (i, j) in enumerate(pairs):
                if features[i]['keypoints'].shape[1] and features[j]['keypoints'].shape[1]:
                    pair = {f'image{k}':{key:value.to(device) for key,value in features[n].items()}
                            for k,n in enumerate([i,j])}
                    matches = matcher(pair)['matches'][0].detach().cpu().numpy().astype(np.uint32)
                else:
                    matches = np.empty((0, 2), dtype=np.uint32)
                np.savez(args.output/f'matches-{i:06d}-{j:06d}.npz', matches=matches)
                nonempty += bool(len(matches))
                matches_total += len(matches)
                if index % 100 == 0 or index+1 == len(pairs):
                    print(f'matched {index+1}/{len(pairs)} ({time.perf_counter()-match_start:.1f}s)', flush=True)
        stats = {'device':str(device), 'maxKeypoints':args.max_keypoints, 'longSide':args.long_side,
                 'threads':torch.get_num_threads(), 'featureSeconds':round(extract_seconds,3),
                 'matchingSeconds':round(time.perf_counter()-match_start,3),
                 'totalSeconds':round(time.perf_counter()-start,3), 'nonemptyPairs':nonempty,
                 'matches':matches_total, 'pairCount':len(pairs)}
        manifest = {'version':1, 'names':names, 'dimensions':dimensions, 'pairs':pairs, 'metrics':stats}
        (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2,allow_nan=False)+'\n')
        print(json.dumps(stats), flush=True)
        return 0
    except (ImportError, OSError, ValueError, RuntimeError) as e:
        print(f'Learned matching failed: {e}', file=sys.stderr, flush=True)
        return 2


if __name__ == '__main__':
    sys.exit(main())
