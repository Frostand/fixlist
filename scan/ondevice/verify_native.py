#!/usr/bin/env python3
"""Compile the actual Swift helpers on macOS; check resize and scoring parity.

This is host-side evidence only, not a Simulator or physical iPhone test.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent
CACHE=ROOT/'.cache'
WORKSPACE=ROOT.parents[1]
HARNESS=r'''
let args = CommandLine.arguments
if args[1] == "prepare" {
    let w = Int(args[2])!, h = Int(args[3])!, edge = Int(args[4])!
    let image = HazardRGB(width: w, height: h, bytes: Array(try Data(contentsOf: URL(fileURLWithPath: args[6]))))
    let cw = max(1, Int(Double(w) * 0.6)), ch = max(1, Int(Double(h) * 0.6))
    var output = Data()
    for view in 0..<10 {
        let crop: (Int, Int, Int, Int)?
        if view == 0 { crop = nil }
        else { let cell = view - 1; crop = (Int(Double(cell % 3 * (w - cw)) / 2), Int(Double(cell / 3 * (h - ch)) / 2), cw, ch) }
        output.append(contentsOf: image.prepared(edge: edge, interpolation: args[5], crop: crop).bytes)
    }
    try output.write(to: URL(fileURLWithPath: args[7]))
} else {
    let engine = try HazardEngine(bundle: Bundle(path: args[2])!)
    let entries = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[3]))) as! [[String: String]]
    var rows: [[String: Any]] = []
    for entry in entries {
        let start = Date()
        let items = try engine.analyze(jpeg: Data(contentsOf: URL(fileURLWithPath: entry["path"]!)))
        rows.append(["id": entry["id"]!, "items": items, "seconds": Date().timeIntervalSince(start)])
    }
    try JSONSerialization.data(withJSONObject: rows, options: [.sortedKeys]).write(to: URL(fileURLWithPath: args[4]))
}
'''

def main():
    p=argparse.ArgumentParser();p.add_argument('--dataset',type=Path);args=p.parse_args()
    CACHE.mkdir(exist_ok=True)
    source=CACHE/'native-parity.swift';binary=CACHE/'native-parity'
    source.write_text((WORKSPACE/'ios/App/App/FixListHazardsPlugin.swift').read_text()+HARNESS)
    env={**os.environ,'CLANG_MODULE_CACHE_PATH':str(CACHE/'clang'),'TMPDIR':str(CACHE)}
    subprocess.run(['xcrun','swiftc','-O','-module-cache-path',str(CACHE/'swift'),str(source),'-o',str(binary)],check=True,env=env)
    differences=[]
    for w,h in [(481,321),(397,613)]:
        raw=((np.arange(w*h*3,dtype=np.uint32)*17+np.arange(w*h*3,dtype=np.uint32)//31)%256).astype('uint8').reshape(h,w,3)
        image=Image.fromarray(raw);input_path=CACHE/'resize-input.rgb';input_path.write_bytes(raw.tobytes())
        for interp in ['bilinear','bicubic']:
            out=CACHE/'resize-output.rgb'
            subprocess.run([str(binary),'prepare',str(w),str(h),'224',interp,str(input_path),str(out)],check=True,env=env)
            actual=np.frombuffer(out.read_bytes(),dtype=np.uint8).reshape(10,224,224,3)
            cw,ch=int(w*.6),int(h*.6);views=[image]
            for y in range(3):
                for x in range(3):
                    left,top=int(x*(w-cw)/2),int(y*(h-ch)/2)
                    views.append(image.crop((left,top,left+cw,top+ch)))
            expected=[]
            for view in views:
                vw,vh=view.size
                rw,rh=(224,int(224*vh/vw)) if vw<=vh else (int(224*vw/vh),224)
                resized=view.resize((rw,rh),Image.Resampling.BILINEAR if interp=='bilinear' else Image.Resampling.BICUBIC)
                left,top=round((rw-224)/2),round((rh-224)/2)
                expected.append(np.asarray(resized.crop((left,top,left+224,top+224))))
            diff=np.abs(actual.astype(int)-np.array(expected).astype(int))
            differences.append({'width':w,'height':h,'interpolation':interp,'maxByteDifference':int(diff.max()),'differentBytes':int((diff>0).sum()),'totalBytes':int(diff.size)})
    report={'preprocessing':differences,'allResizeBytesExact':all(r['differentBytes']==0 for r in differences)}
    print(json.dumps(report,indent=2),flush=True)
    assert report['allResizeBytesExact'],'Swift/Pillow preprocessing mismatch'
    if args.dataset:
        bundle=CACHE/'native-hazards.bundle';bundle.mkdir(exist_ok=True)
        (bundle/'Info.plist').write_text('<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.fixlist.native-parity</string></dict></plist>')
        shutil.copyfile(WORKSPACE/'ios/App/App/HazardModel/hazard-prompts.json',bundle/'hazard-prompts.json')
        subprocess.run(['xcrun','coremlc','compile',str(WORKSPACE/'ios/App/App/HazardModel/HazardImageEncoder.mlpackage'),str(bundle)],check=True,env=env,stdout=subprocess.DEVNULL)
        entries=[json.loads(s) for s in (args.dataset/'manifest.jsonl').read_text().splitlines()]
        selected=np.linspace(0,len(entries)-1,20,dtype=int)
        inputs=CACHE/'native-inputs.json';outputs=CACHE/'native-scores.json'
        inputs.write_text(json.dumps([{'id':entries[i]['id'],'path':str(args.dataset/'images'/entries[i]['file'])} for i in selected]))
        subprocess.run([str(binary),'score',str(bundle),str(inputs),str(outputs)],check=True,env=env)
        rows=json.loads(outputs.read_text());scores=np.load(CACHE/'ViT-B-32-scores.npz')['scores'][selected].max(axis=2)
        prompts=json.loads((bundle/'hazard-prompts.json').read_text());keys=[r['checklistItemId'] for r in prompts['items']]
        native=np.array([[r['items'][k]['relevance'] for k in keys] for r in rows]);thresholds=np.array([r['threshold'] for r in prompts['items']])
        report['scoring']={'photos':len(rows),'maxRawScoreDifference':float(abs(scores-native).max()),
            'meanRawScoreDifference':float(abs(scores-native).mean()),'thresholdDecisionDisagreements':int(((scores>=thresholds)!=(native>=thresholds)).sum()),
            'imageItemDecisions':int(scores.size),'secondsPerPhotoMedian':float(np.median([r['seconds'] for r in rows])),
            'secondsPerPhotoP95':float(np.percentile([r['seconds'] for r in rows],95))}
        print(json.dumps(report['scoring'],indent=2),flush=True)
    (CACHE/'native-parity.json').write_text(json.dumps(report,indent=2)+'\n')

if __name__=='__main__':main()
