#!/usr/bin/env python3
"""Prospective dev selection and separately locked held-out evaluation.

Private embeddings and score rows stay under .cache/followup/. This script does
not train or convert the image encoder. It preserves the original prompt vectors
and changes only independently accepted items. No network or hosted inference.
"""
from pilot import ROOT, ITEMS, views, load, weights, sha, operating
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
import torch
import open_clip
from evaluation_stats import metric_values

CACHE=ROOT/'.cache/followup'
PROTOCOL_PATH=ROOT/'refine-prompts-protocol-2026-10-23.json'
APP=ROOT.parents[1]/'ios/App/App'
RESOURCE=APP/'HazardModel/hazard-prompts.json'
TARGETS=['rug-check','night-lighting-check']

def write(path,data): path.write_text(json.dumps(data,indent=2,allow_nan=False)+'\n')
def sigmoid(x): return np.clip(1/(1+np.exp(-np.clip(x,-80,80))),1e-12,1-1e-12)
def labels_for(dataset, ids):
    # The id is read without parsing any other field from non-requested rows.
    result={}
    for line in (dataset/'labels-gpt.jsonl').open():
        match=re.match(r'\s*\{\s*"id"\s*:\s*"([^"]+)"',line)
        if not match: raise ValueError('Expected manifest-label row beginning with id')
        if match[1] in ids: result[match[1]]=json.loads(line)
    assert set(result)==set(ids)
    return result

def snapshot():
    CACHE.mkdir(parents=True,exist_ok=True)
    baseline=CACHE/'baseline'
    if baseline.exists(): return
    baseline.mkdir()
    for source,name in [(RESOURCE,'hazard-prompts.json'),(APP/'FixListHazardsPlugin.swift','FixListHazardsPlugin.swift'),
        (ROOT.parents[1]/'src/lib/ondevice-model.ts','ondevice-model.ts'),(ROOT/'prompts-source.json','prompts-source.json')]:
        shutil.copyfile(source,baseline/name)
    write(baseline/'receipt.json',{'protocolSHA256':sha(PROTOCOL_PATH),'resourceSHA256':sha(RESOURCE),
        'encoderTreeSHA256':json.loads(RESOURCE.read_text())['packageSHA256'],
        'swiftSHA256':sha(APP/'FixListHazardsPlugin.swift')})

def image_embeddings(model,preprocess,dataset,entries):
    path=CACHE/'image-embeddings.npz'
    identity=hashlib.sha256((sha(weights('ViT-B-32'))+sha(dataset/'manifest.jsonl')
        +''.join(sha(dataset/'images'/e['file']) for e in entries)+'fixed-original-ten-views-v1').encode()).hexdigest()
    if path.exists():
        z=np.load(path)
        assert str(z['signature'])==identity,'Embedding cache does not match current inputs'
        return z['embeddings']
    output=[]
    with torch.inference_mode():
        for i,e in enumerate(entries):
            with Image.open(dataset/'images'/e['file']) as im:image=ImageOps.exif_transpose(im).convert('RGB')
            batch=torch.stack([preprocess(v) for v in views(image)])
            output.append(model.encode_image(batch,normalize=True).numpy())
            if (i+1)%25==0:print(f'Encoded {i+1}/{len(entries)}',flush=True)
    embeddings=np.array(output)
    np.savez(path,embeddings=embeddings,signature=identity)
    return embeddings

def threshold(y,p):
    unique=np.unique(p);cuts=(np.r_[0.,unique[:-1]]+unique)/2
    candidates=[operating(y,p,t) for t in cuts]
    for precision in [.8,.6]:
        valid=[r for r in candidates if r['tp']>=2 and r['precision']>=precision and r['recall']>=.7]
        if valid:
            best=max(valid,key=lambda r:(r['recall'],r['precision'],r['threshold']))
            return {**best,'precisionTarget':precision}
    return {**operating(y,p,1.),'precisionTarget':None}

def f2(o):
    return 5*o['tp']/(5*o['tp']+4*o['fn']+o['fp']) if o['tp'] else 0.

def select(dataset):
    snapshot();protocol=json.loads(PROTOCOL_PATH.read_text())
    split=json.loads((ROOT.parent/'calibration.json').read_text())['split']
    entries=[json.loads(s) for s in (dataset/'manifest.jsonl').read_text().splitlines()]
    dev_ids={e['id'] for e in entries if e['group'] in split['devGroups']}
    labels=labels_for(dataset,dev_ids)
    model,preprocess,_=load('ViT-B-32');torch.set_num_threads(4);torch.manual_seed(7)
    embeddings=image_embeddings(model,preprocess,dataset,entries)
    baseline=json.loads((CACHE/'baseline/hazard-prompts.json').read_text())
    candidates=[];texts=[]
    for key in TARGETS:
        for pname,positive in protocol['positiveSets'][key].items():
            for nname in protocol['itemNegativeSets'][key]:
                for aggregation in protocol['aggregations']:
                    candidates.append({'item':key,'positiveSet':pname,'negativeSet':nname,'aggregation':aggregation,
                        'positive':positive,'negative':protocol['negativeSets'][nname]})
                    texts.extend(positive+protocol['negativeSets'][nname])
    texts=list(dict.fromkeys(texts));index={t:i for i,t in enumerate(texts)}
    with torch.inference_mode():text=model.encode_text(open_clip.get_tokenizer('ViT-B-32')(texts),normalize=True).numpy()
    similarities=(embeddings @ text.T).astype(float)
    scale=baseline['logitScale'];all_scores=[];selection={};diagnostics=[]
    for ci,candidate in enumerate(candidates):
        per_view=sigmoid(scale*(similarities[:,:,[index[t] for t in candidate['positive']]].mean(axis=2)
                               -similarities[:,:,[index[t] for t in candidate['negative']]].mean(axis=2)))
        scores=per_view.max(axis=1) if candidate['aggregation']=='max' else per_view[:,0]
        all_scores.append(scores)
        usable=[i for i,e in enumerate(entries) if e['id'] in dev_ids and labels[e['id']][candidate['item']]['relevant'] is not None]
        y=np.array([labels[entries[i]['id']][candidate['item']]['relevant'] for i in usable],int)
        p=scores[usable];groups=np.array([entries[i]['group'] for i in usable]);predicted=np.zeros(len(y),bool);folds=[]
        for held in split['cvValidationGroups']:
            valid=np.isin(groups,held);train=~valid;chosen=threshold(y[train],p[train])
            predicted[valid]=p[valid]>=chosen['threshold'];folds.append(chosen)
        tp,fp,fn=int((predicted & (y==1)).sum()),int((predicted & (y==0)).sum()),int((~predicted & (y==1)).sum())
        o={'tp':tp,'fp':fp,'fn':fn,'precision':tp/(tp+fp) if tp+fp else 0.,'recall':tp/(tp+fn)}
        diagnostics.append({'candidateIndex':ci,**candidate,'devMetrics':metric_values(y,p),'devOOF':o,'devOOFF2':f2(o),'foldThresholds':folds,'allDevThreshold':threshold(y,p)})
    for key in TARGETS:
        eligible=[]
        for precision in [.8,.6]:
            eligible=[d for d in diagnostics if d['item']==key and d['devOOF']['precision']>=precision and d['devOOF']['recall']>=.7 and d['allDevThreshold']['precisionTarget'] is not None]
            if eligible:break
        selection[key]=max(eligible,key=lambda d:(d['devOOFF2'],d['devMetrics']['auroc'],d['devOOF']['precision'],-d['candidateIndex'])) if eligible else None
    np.savez(CACHE/'candidate-scores.npz',scores=np.array(all_scores),textEmbeddings=text,texts=np.array(texts))
    lock={'protocolSHA256':sha(PROTOCOL_PATH),'selectionScriptSHA256':sha(Path(__file__)),'manifestSHA256':sha(dataset/'manifest.jsonl'),
        'candidateScoresSHA256':sha(CACHE/'candidate-scores.npz'),'baselineResourceSHA256':sha(CACHE/'baseline/hazard-prompts.json'),
        'split':split,'selection':selection,'heldOutLabelsParsed':False}
    write(CACHE/'dev-candidates.json',diagnostics);write(CACHE/'selection-lock.json',lock)
    print(json.dumps({'selected':selection,'heldOutLabelsParsed':False},indent=2),flush=True)

def evaluate(dataset):
    lock=json.loads((CACHE/'selection-lock.json').read_text())
    assert lock['selectionScriptSHA256']==sha(Path(__file__))
    assert lock['protocolSHA256']==sha(PROTOCOL_PATH) and lock['candidateScoresSHA256']==sha(CACHE/'candidate-scores.npz')
    assert lock['manifestSHA256']==sha(dataset/'manifest.jsonl')
    entries=[json.loads(s) for s in (dataset/'manifest.jsonl').read_text().splitlines()]
    held_ids={e['id'] for e in entries if e['group'] in lock['split']['heldOutGroups']}
    labels=labels_for(dataset,held_ids)
    baseline=json.loads((CACHE/'baseline/hazard-prompts.json').read_text())
    embeddings=np.load(CACHE/'image-embeddings.npz')['embeddings']
    # Reference scores use the precise serialized vectors shipped to native,
    # not a new encoding of baseline prompts.
    sims=embeddings.astype(float) @ np.array(baseline['textEmbeddings']).T
    neutral=sims[:,:,baseline['neutralIndices']].mean(axis=2)
    scores=np.load(CACHE/'candidate-scores.npz')['scores'];out={}
    for key in TARGETS:
        original=next(item for item in baseline['items'] if item['checklistItemId']==key)
        before=sigmoid(baseline['logitScale']*(sims[:,:,original['positiveIndices']].mean(axis=2)-neutral)).max(axis=1)
        usable=[i for i,e in enumerate(entries) if e['id'] in held_ids and labels[e['id']][key]['relevant'] is not None]
        y=np.array([labels[entries[i]['id']][key]['relevant'] for i in usable],int)
        old={'metrics':metric_values(y,before[usable]),'operating':operating(y,before[usable],original['threshold'])}
        selected=lock['selection'][key]
        if selected:
            p=scores[selected['candidateIndex']];t=selected['allDevThreshold']['threshold']
            new={'metrics':metric_values(y,p[usable]),'operating':operating(y,p[usable],t)}
            ship=new['metrics']['auroc']+1e-12>=old['metrics']['auroc'] and new['operating']['recall']>=old['operating']['recall']+.2-1e-12
        else:new=None;ship=False
        out[key]={'before':old,'selectedAfter':new,'passesHeldOutRule':bool(ship),'selectedCandidate':selected}
    write(CACHE/'heldout-evaluation.json',out)
    print(json.dumps(out,indent=2),flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('stage',choices=['select','evaluate']);p.add_argument('--dataset',type=Path,required=True);a=p.parse_args()
    {'select':select,'evaluate':evaluate}[a.stage](a.dataset)

if __name__=='__main__':main()
