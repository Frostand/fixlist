#!/usr/bin/env python3
"""Offline relevance pilot. Private image-derived outputs stay in .cache/."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.environ.update(HF_HUB_OFFLINE='1', HF_HOME=str(ROOT / '.cache/hf'),
                  TORCH_HOME=str(ROOT / '.cache/torch'), MPLCONFIGDIR=str(ROOT / '.cache/mpl'))
import argparse
import hashlib
import json
import sys
import time
import numpy as np
from PIL import Image, ImageOps
import torch
import open_clip

sys.path.insert(0, str(ROOT.parent))
from evaluation_stats import metric_values, select_method, fit_method, predict, comparison_report, adoption_rule

CANDIDATES = {
    'MobileCLIP-S1': ('datacompdr', 'apple/MobileCLIP-S1-OpenCLIP'),
    'MobileCLIP-S2': ('datacompdr', 'apple/MobileCLIP-S2-OpenCLIP'),
    'ViT-B-32': ('laion2b_s34b_b79k', 'laion/CLIP-ViT-B-32-laion2B-s34B-b79K'),
}
PROMPTS = json.loads((ROOT / 'prompts-source.json').read_text())
ITEMS = list(PROMPTS['items'])

def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()

def weights(name):
    repo = CANDIDATES[name][1].replace('/', '--')
    found = sorted((Path.home()/'.cache/huggingface/hub'/('models--'+repo)).glob('snapshots/*/open_clip_model.safetensors'))
    if len(found) != 1: raise ValueError(f'Expected one cached weights file for {name}')
    return found[0]

def load(name, device='cpu'):
    pretrained = CANDIDATES[name][0]
    cfg = open_clip.get_pretrained_cfg(name, pretrained)
    model, _, preprocess = open_clip.create_model_and_transforms(
        name, pretrained=str(weights(name)), device=device,
        image_mean=cfg['mean'], image_std=cfg['std'], image_interpolation=cfg['interpolation'],
        image_resize_mode=cfg['resize_mode'], cache_dir=str(ROOT / '.cache'))
    model.eval()
    return model, preprocess, cfg

def views(image):
    """Full image, then 3x3 row-major crops, each 60% of the original edges.

    Origins 0, 20%, 40%; deterministic floor rounding; preprocessing then does
    resize-shorter-side/centre-crop. Points refer to grid cells, not crop centres.
    """
    w, h = image.size
    cw, ch = max(1, int(w*.6)), max(1, int(h*.6))
    result = [image]
    for y in range(3):
        for x in range(3):
            left, top = int(x*(w-cw)/2), int(y*(h-ch)/2)
            result.append(image.crop((left, top, left+cw, top+ch)))
    return result

def score(name, dataset, entries, device):
    cache = ROOT / '.cache' / f'{name}-scores.npz'
    signature = hashlib.sha256(json.dumps(PROMPTS, sort_keys=True).encode() + b'full-and-3x3-60pct-v1'
                               + (dataset/'manifest.jsonl').read_bytes() + sha(weights(name)).encode()
                               + ''.join(sha(dataset/'images'/e['file']) for e in entries).encode()).hexdigest()
    if cache.exists():
        z = np.load(cache)
        if str(z['signature']) == signature:
            return z['scores'], json.loads(str(z['metadata']))
    model, preprocess, cfg = load(name, device)
    prompts = PROMPTS['neutral'] + [p for key in ITEMS for p in PROMPTS['items'][key]]
    with torch.inference_mode():
        text = model.encode_text(open_clip.get_tokenizer(name)(prompts).to(device), normalize=True)
        scale = float(model.logit_scale.exp().cpu())
        all_scores, elapsed = [], []
        for i, entry in enumerate(entries):
            with Image.open(dataset/'images'/entry['file']) as im:
                image = ImageOps.exif_transpose(im).convert('RGB')
            batch = torch.stack([preprocess(im) for im in views(image)]).to(device)
            start = time.perf_counter()
            emb = model.encode_image(batch, normalize=True)
            sims = (emb @ text.T).cpu().numpy().astype(float)
            elapsed.append(time.perf_counter()-start)
            neutral = sims[:, :len(PROMPTS['neutral'])].mean(axis=1)
            offset, item_scores = len(PROMPTS['neutral']), []
            for key in ITEMS:
                count = len(PROMPTS['items'][key])
                logits = scale * (sims[:,offset:offset+count].mean(axis=1) - neutral)
                item_scores.append(1/(1+np.exp(-np.clip(logits, -80, 80))))
                offset += count
            all_scores.append(np.array(item_scores))
            if (i+1)%10 == 0 or i+1 == len(entries): print(f'{name}: {i+1}/{len(entries)}', flush=True)
    metadata = {'model': name, 'pretrained': CANDIDATES[name][0], 'weightsSHA256': sha(weights(name)),
                'weightsBytes': weights(name).stat().st_size, 'logitScale': scale, 'device': device,
                'secondsPerPhotoTenViewsMedian': float(np.median(elapsed)),
                'secondsPerPhotoTenViewsP95': float(np.percentile(elapsed,95)),
                'preprocess': str(preprocess), 'signature': signature}
    scores = np.array(all_scores)
    np.savez(cache, scores=scores, metadata=json.dumps(metadata), signature=signature)
    return scores, metadata

def operating(y, p, threshold):
    y, selected = np.array(y, bool), np.array(p) >= threshold
    tp, fp, fn = int((y & selected).sum()), int((~y & selected).sum()), int((y & ~selected).sum())
    return {'threshold': float(threshold), 'tp': tp, 'fp': fp, 'fn': fn,
            'precision': tp/(tp+fp) if tp+fp else None, 'recall': tp/(tp+fn) if tp+fn else None}

def choose_threshold(y,p):
    candidates = [operating(y,p,t) for t in sorted(set(p))]
    valid = [r for r in candidates if r['precision'] is not None and r['precision'] >= .8 and r['tp'] >= 2]
    # 1.0 is explicit abstention for finite sigmoid outputs when dev evidence is insufficient.
    return max(valid, key=lambda r:(r['recall'],r['precision'],r['threshold']))['threshold'] if valid else 1.0

def evaluate(name, scores, metadata, entries, labels, split):
    results = {'metadata': metadata, 'variants': {}}
    for variant, raw in [('full',scores[:,:,0]),('full-and-crops',scores.max(axis=2))]:
        rows = [{'id':e['id'], 'group':e['group'], 'item':k, 'raw':float(raw[i,j]), 'label':int(labels[e['id']][k]['relevant'])}
                for i,e in enumerate(entries) for j,k in enumerate(ITEMS) if labels[e['id']][k]['relevant'] is not None]
        dev = [r for r in rows if r['group'] in split['devGroups']]
        held = [r for r in rows if r['group'] in split['heldOutGroups']]
        method, cv, folds = select_method(dev, split['devGroups'], ITEMS, seed=7)
        params = fit_method(dev,method,ITEMS)
        comparison = comparison_report(held,predict(held,method,params),groups=split['heldOutGroups'])
        adopted = method != 'raw' and adoption_rule({k:v['value'] for k,v in comparison['raw'].items()},
            {k:v['value'] for k,v in comparison['calibrated'].items()},comparison['pairedBrierDifference']['ci95'])
        # Deployment remains raw, avoiding data-dependent transfer of condition calibration.
        # Calibration is evaluated for relevance, but not shipped in this bounded pilot.
        items, pooled_y, pooled_p = {}, [], []
        for k in ITEMS:
            train, test = [r for r in dev if r['item']==k], [r for r in held if r['item']==k]
            y,p = [r['label'] for r in test],[r['raw'] for r in test]
            threshold = choose_threshold([r['label'] for r in train],[r['raw'] for r in train])
            items[k] = {'heldOut':metric_values(y,p), 'devOperating':operating([r['label'] for r in train],[r['raw'] for r in train],threshold),
                        'heldOutOperating':operating(y,p,threshold)}
            pooled_y.extend(y); pooled_p.extend(p)
        results['variants'][variant] = {'pooled':metric_values(pooled_y,pooled_p), 'items':items,
            'calibration':{'selected':method,'cvBrier':cv,'parameters':params,'passesAdoptionRule':adopted,
                           'shipped':False,'comparison':comparison},
            'pooledOperating': {'tp':sum(v['heldOutOperating']['tp'] for v in items.values()), 'fp':sum(v['heldOutOperating']['fp'] for v in items.values()), 'fn':sum(v['heldOutOperating']['fn'] for v in items.values())}}
    return results

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--dataset',type=Path,required=True)
    parser.add_argument('--device',default='cpu'); parser.add_argument('--models',nargs='+',default=list(CANDIDATES)); args=parser.parse_args()
    (ROOT/'.cache').mkdir(parents=True,exist_ok=True)
    torch.set_num_threads(4); torch.manual_seed(7)
    entries=[json.loads(s) for s in (args.dataset/'manifest.jsonl').read_text().splitlines()]
    labels={r['id']:r for s in (args.dataset/'labels-gpt.jsonl').read_text().splitlines() if (r:=json.loads(s))}
    split=json.loads((ROOT.parent/'calibration.json').read_text())['split']
    assert not set(split['devGroups']) & set(split['heldOutGroups'])
    assert set(e['group'] for e in entries) == set(split['devGroups']+split['heldOutGroups'])
    output={'protocol':{'promptsSHA256':sha(ROOT/'prompts-source.json'),'split':split,'labelSource':'GPT-6 Luna AI labels, not expert ground truth',
                        'manifestSHA256':sha(args.dataset/'manifest.jsonl'),'labelsSHA256':sha(args.dataset/'labels-gpt.jsonl'),
                        'devPhotos':sum(e['group'] in split['devGroups'] for e in entries),'heldOutPhotos':sum(e['group'] in split['heldOutGroups'] for e in entries)},'models':{}}
    for name in args.models:
        scores,metadata=score(name,args.dataset,entries,args.device)
        output['models'][name]=evaluate(name,scores,metadata,entries,labels,split)
        (ROOT/'.cache/pilot-results.json').write_text(json.dumps(output,indent=2,allow_nan=False)+'\n')
        print(name,output['models'][name]['variants']['full-and-crops']['pooled'],flush=True)

if __name__=='__main__': main()
