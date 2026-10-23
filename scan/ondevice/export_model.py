#!/usr/bin/env python3
"""Export an offline image encoder and native prompt resource, then measure parity.

No images or per-image embeddings are exported to app resources. All private
parity records remain in .cache/. Native and web metadata are generated together.
"""
from pilot import ROOT, PROMPTS, ITEMS, load, weights, sha, CANDIDATES
import argparse
import hashlib
import json
import shutil
import time
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
import torch
import coremltools as ct

def tree_sha(path):
    digest=hashlib.sha256()
    for f in sorted(path.rglob('*')):
        if f.is_file(): digest.update(f.relative_to(path).as_posix().encode()+b'\0'+bytes.fromhex(sha(f)))
    return digest.hexdigest()

def main():
    p=argparse.ArgumentParser();p.add_argument('--model',required=True,choices=CANDIDATES)
    p.add_argument('--precision',choices=['fp16','mixed','fp32'],default='mixed')
    p.add_argument('--dataset',required=True,type=Path);args=p.parse_args()
    torch.set_num_threads(4);torch.manual_seed(7)
    # PyTorch 2.14 toggles MHA's fused fast path during trace checking; use
    # the same unfused graph on both passes rather than disabling trace checks.
    torch.backends.mha.set_fastpath_enabled(False)
    app=ROOT.parents[1]/'ios/App/App'; dest=app/'HazardModel';dest.mkdir(parents=True,exist_ok=True)
    model,preprocess,cfg=load(args.model)
    edge=int(model.visual.image_size[0] if isinstance(model.visual.image_size,tuple) else model.visual.image_size)
    path=dest/'HazardImageEncoder.mlpackage'
    if not path.exists():
        if args.model.startswith('MobileCLIP-'):
            suffix=args.model[-2:].lower()
            source=next((Path.home()/'.cache/huggingface/hub/models--apple--coreml-mobileclip').glob(f'snapshots/*/mobileclip_{suffix}_image.mlpackage'))
            shutil.copytree(source,path,symlinks=False)
        else:
            class Encoder(torch.nn.Module):
                def __init__(self):
                    super().__init__();self.visual=model.visual
                    self.register_buffer('mean',torch.tensor(cfg['mean']).reshape(1,3,1,1))
                    self.register_buffer('std',torch.tensor(cfg['std']).reshape(1,3,1,1))
                def forward(self,image):
                    # Fixed ViT-B/32 shape avoids aten::Int in Torch 2.14's
                    # dynamic MultiheadAttention graph (unsupported by ct 9).
                    # All parameters are the original checkpoint's parameters.
                    v=self.visual
                    x=v.conv1((image-self.mean)/self.std).reshape(1,768,49).permute(0,2,1)
                    x=torch.cat([v.class_embedding.reshape(1,1,768),x],dim=1)+v.positional_embedding
                    x=v.ln_pre(x)
                    for block in v.transformer.resblocks:
                        z=block.ln_1(x)
                        qkv=torch.nn.functional.linear(z,block.attn.in_proj_weight,block.attn.in_proj_bias)
                        q=qkv[:,:,:768].reshape(1,50,12,64).permute(0,2,1,3)
                        k=qkv[:,:,768:1536].reshape(1,50,12,64).permute(0,2,1,3)
                        value=qkv[:,:,1536:].reshape(1,50,12,64).permute(0,2,1,3)
                        attention=torch.softmax((q @ k.transpose(-2,-1))*(64**-.5),dim=-1)
                        attended=(attention @ value).permute(0,2,1,3).reshape(1,50,768)
                        x=x+block.ls_1(block.attn.out_proj(attended))
                        x=x+block.ls_2(block.mlp(block.ln_2(x)))
                    return v.ln_post(x[:,0]) @ v.proj
            encoder=Encoder().eval()
            with torch.inference_mode():
                example=torch.rand(1,3,edge,edge)
                torch.testing.assert_close(encoder(example),model.visual((example-encoder.mean)/encoder.std),rtol=1e-4,atol=1e-5)
            traced=torch.jit.trace(encoder,torch.rand(1,3,edge,edge))
            ml=ct.convert(traced,convert_to='mlprogram',minimum_deployment_target=ct.target.iOS15,
                compute_precision=(ct.precision.FLOAT32 if args.precision=='fp32' else
                    ct.transform.FP16ComputePrecision(op_selector=lambda op: op.op_type == 'linear')
                    if args.precision=='mixed' else ct.precision.FLOAT16),
                inputs=[ct.ImageType(name='image',shape=(1,3,edge,edge),scale=1/255)],
                outputs=[ct.TensorType(name='embedding')])
            ml.short_description='FixList relevance image encoder; unverified review aids, never a safety assessment.'
            ml.license='MIT';ml.user_defined_metadata['source_weights_sha256']=sha(weights(args.model))
            ml.save(str(path))
    print('Exported',path,flush=True)
    texts=PROMPTS['neutral']+[s for k in ITEMS for s in PROMPTS['items'][k]]
    import open_clip
    with torch.inference_mode(): embeddings=model.encode_text(open_clip.get_tokenizer(args.model)(texts),normalize=True).numpy().astype(float).tolist()
    result=json.loads((ROOT/'.cache/pilot-results.json').read_text())['models'][args.model]
    item_thresholds={k:result['variants']['full-and-crops']['items'][k]['devOperating']['threshold'] for k in ITEMS}
    for excluded in ['handrail-check', 'stair-lighting-check']: item_thresholds[excluded]=1.0
    license='MIT weights' if args.model=='ViT-B-32' else 'Apple ML Research Model license (non-commercial research/academic)'
    name=f"{args.model}/{CANDIDATES[args.model][0]}"
    runtime_sources=app/'FixListHazardsPlugin.swift'
    runtime_hash=hashlib.sha256(bytes.fromhex(tree_sha(path))+bytes.fromhex(sha(ROOT/'prompts-source.json'))
        +(runtime_sources.read_bytes() if runtime_sources.exists() else b'')).hexdigest()
    identity={'version':1,'weightsSHA256':sha(weights(args.model)),'runtimeSHA256':runtime_hash}
    model_info={'name':name,'backend':'coreml','engine':'clip-zero-shot','license':license,'identity':identity}
    spec=ct.models.MLModel(str(path),skip_model_load=True).get_spec()
    if args.model=='ViT-B-32':
        ops=next(iter(spec.mlProgram.functions['main'].block_specializations.values())).operations
        conv_type=next(op for op in ops if op.type=='conv').outputs[0].type.tensorType.dataType
        linear_types={op.outputs[0].type.tensorType.dataType for op in ops if op.type=='linear'}
        actual_precision='mixed' if conv_type==11 and linear_types=={10} else 'fp16' if conv_type==10 else 'fp32'
        if args.precision!=actual_precision:
            raise ValueError('Existing package precision differs; preserve it under .cache/ before requesting a new conversion.')
    else: actual_precision='apple-prebuilt'
    data={'version':1,'model':model_info,'packageSHA256':tree_sha(path),'precisionPolicy':actual_precision,'inputName':spec.description.input[0].name,
          'outputName':spec.description.output[0].name,'imageSize':edge,'interpolation':cfg['interpolation'],
          'cropFraction':.6,'logitScale':float(model.logit_scale.exp().detach()),'calibration':None,
          'neutralIndices':list(range(len(PROMPTS['neutral']))),'textEmbeddings':embeddings,'promptTexts':texts,'items':[]}
    offset=len(PROMPTS['neutral'])
    for key in ITEMS:
        count=len(PROMPTS['items'][key]);data['items'].append({'checklistItemId':key,'positiveIndices':list(range(offset,offset+count)),'threshold':item_thresholds[key]});offset+=count
    (dest/'hazard-prompts.json').write_text(json.dumps(data,separators=(',',':'),allow_nan=False)+'\n')
    ts=ROOT.parents[1]/'src/lib/ondevice-model.ts'
    ts.write_text('/** Generated by scan/ondevice/export_model.py. Pinned native relevance-only runtime. */\n'
        +'export const ONDEVICE_MODEL = '+json.dumps(model_info,indent=2)+' as const;\n'
        +'export const ONDEVICE_THRESHOLDS: Readonly<Record<string, number>> = '+json.dumps(item_thresholds,indent=2)+';\n'
        +'export const ONDEVICE_LIMITATION = "This model scored whether the subject is visible, not whether there is a hazard. Unverified AI output; review the photo yourself.";\n')
    config=ct.models.MLModel(str(path),compute_units=ct.ComputeUnit.ALL)
    entries=[json.loads(s) for s in (args.dataset/'manifest.jsonl').read_text().splitlines()]
    # Deterministic spread over manifest (includes multiple sources), not cherry-picked.
    selected=np.linspace(0,len(entries)-1,20,dtype=int)
    cosines=[];seconds=[];records=[]
    for index in selected:
        e=entries[index]
        with Image.open(args.dataset/'images'/e['file']) as im: image=ImageOps.exif_transpose(im).convert('RGB')
        # Use exact torchvision/Pillow resize+centre-crop, before its ToTensor/Normalize.
        prepared=preprocess.transforms[1](preprocess.transforms[0](image))
        with torch.inference_mode(): expected=model.encode_image(preprocess(image).unsqueeze(0),normalize=True)[0].numpy().astype(float)
        start=time.perf_counter();actual=np.array(config.predict({data['inputName']:prepared})[data['outputName']]).reshape(-1).astype(float);seconds.append(time.perf_counter()-start)
        actual/=np.linalg.norm(actual);cos=float(actual@expected);cosines.append(cos)
        records.append({'id':e['id'],'cosine':cos})
        print('parity',e['id'],cos,flush=True)
    report={'images':len(cosines),'minCosine':min(cosines),'meanCosine':float(np.mean(cosines)),
            'passes':bool(min(cosines)>=.99),'secondsPerImageMedian':float(np.median(seconds)),
            'secondsPerImageP95':float(np.percentile(seconds,95)),'packageBytes':sum(f.stat().st_size for f in path.rglob('*') if f.is_file()),
            'packageSHA256':tree_sha(path),'precisionPolicy':actual_precision,'computeUnits':'all','model':model_info,'records':records,'torch':torch.__version__,'coremltools':ct.__version__}
    (ROOT/'.cache/parity.json').write_text(json.dumps(report,indent=2)+'\n')
    assert report['passes'],report
    print(json.dumps({k:v for k,v in report.items() if k!='records'},indent=2),flush=True)

if __name__=='__main__':main()
