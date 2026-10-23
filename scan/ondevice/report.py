#!/usr/bin/env python3
"""Create the reviewable aggregate report without publishing private image data."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
def n(value): return 'undefined' if value is None else f'{value:.6f}'
def main():
    r=json.loads((ROOT/'.cache/pilot-results.json').read_text());models=r['models']
    mobile=max((k for k in models if k.startswith('MobileCLIP-')),key=lambda k:models[k]['variants']['full-and-crops']['pooled']['auroc'])
    delta=models[mobile]['variants']['full-and-crops']['pooled']['auroc']-models['ViT-B-32']['variants']['full-and-crops']['pooled']['auroc']
    chosen='ViT-B-32' if delta<=.03 else mobile
    lines=['# On-device relevance pilot — 2026-10-23','',
        f'Chosen model: **{chosen}**. Best MobileCLIP minus MIT ViT-B-32 pooled held-out AUROC = {delta:.6f}; the predeclared permissive-license preference applies within 0.03.', '',
        '## Protocol and limits','',
        '125 photos with GPT-6 Luna boolean labels, not expert ground truth. Relevance only: these numbers do not measure hazard identification, home safety, or physical-device performance. Condition positives are insufficient; no condition classifier is fitted or shipped.', '',
        f"Fixed seed-7 split from `scan/calibration.json`: {r['protocol']['devPhotos']} development photos, {r['protocol']['heldOutPhotos']} held-out photos, {len(r['protocol']['split']['devGroups'])} development groups and {len(r['protocol']['split']['heldOutGroups'])} held-out groups. Group membership is preserved exactly, including sources with multiple images. No image or group crosses the split.", '',
        'Prompts in `prompts-source.json` were frozen before scoring. Positive prompt cosine is averaged; shared neutral prompt cosine is averaged; raw relevance = sigmoid(model logit scale × (positive mean − neutral mean)). Full image plus nine row-major crops, each 60% of image width and height with origins at 0%, 20%, 40%. Each view uses the model’s resize-shorter-side, centre-crop and normalization. Deployment uses the maximum over all ten views; full-only is reported as a fixed ablation, not selected using held-out outcomes.', '',
        'Per-item thresholds maximize development recall at precision ≥ 0.8 with at least two development true positives; ties prefer higher precision then higher threshold. A threshold of 1.0 means abstain. Held-out precision was measured once at those thresholds and never used to retune. Sparse per-item held-out counts do not establish stable precision. Pooled metrics treat each image-item pair as an observation; source correlation limits generalization. AUPRC is average precision, with undefined values reported rather than replaced by zero.', '',
        'Calibration candidates reuse grouped five-fold development selection and the existing paired 1,000-group-bootstrap adoption rule (held-out Brier improves, upper paired-difference CI < 0, AUROC drop ≤ 0.02). Calibration is **not shipped** in this bounded pilot even when the rule passes; raw relevance scores and development thresholds are retained. Existing Mac condition calibration is never transferred.', '',
        'The model comparison uses the held-out results by explicit task requirement, so these data are consumed for model selection. A future independent test set is required for an unbiased estimate of the chosen model’s generalization.', '',
        '## Fixed held-out results','',
        '| Model / views | Item | n / positives | AUROC | AUPRC | Dev threshold | Held-out precision | Held-out recall | TP / FP / FN |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    diagnostics=[]
    for name,model in models.items():
        for variant,v in model['variants'].items():
            m=v['pooled'];o=v['pooledOperating'];tp,fp,fn=o['tp'],o['fp'],o['fn']
            lines.append(f"| {name} / {variant} | pooled | {m['n']} / {m['positives']} | {n(m['auroc'])} | {n(m['auprc'])} | per item | {n(tp/(tp+fp) if tp+fp else None)} | {n(tp/(tp+fn) if tp+fn else None)} | {tp} / {fp} / {fn} |")
            for key,item in v['items'].items():
                m,o=item['heldOut'],item['heldOutOperating']
                lines.append(f"| {name} / {variant} | {key} | {m['n']} / {m['positives']} | {n(m['auroc'])} | {n(m['auprc'])} | {n(o['threshold'])} | {n(o['precision'])} | {n(o['recall'])} | {o['tp']} / {o['fp']} / {o['fn']} |")
    deployed=models[chosen]['variants']['full-and-crops']['items']
    displayed=[v['heldOutOperating'] for k,v in deployed.items() if k not in ['handrail-check','stair-lighting-check']]
    dtp,dfp,dfn=(sum(v[key] for v in displayed) for key in ['tp','fp','fn'])
    lines+=['','Handrail and stair-lighting remain suppressed by `CAPTURE_FLAG_EXCLUDED` regardless of relevance score. Their relevance labels do not overturn the existing condition-evidence exclusion. Deployment sets their thresholds to 1.0 (abstain), even where their relevance-only pilot threshold above is lower.', '',
        f'For the chosen model’s six display-eligible items at frozen thresholds, held-out operating counts are TP {dtp}, FP {dfp}, FN {dfn}: pooled precision {n(dtp/(dtp+dfp))}, recall {n(dtp/(dtp+dfn))}. Rug and bedroom-path precision fall below 0.8; this pilot does not establish a reliable high-precision review system. No held-out-driven suppression or threshold retuning was applied.', '', '## Calibration diagnostic and Mac CPU cost','',
        '| Model | CV method | Raw CV Brier | Global CV Brier | Per-item CV Brier | Passes adoption | Ten-view CPU median / p95 seconds | Cached full weights MiB |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |']
    for name,model in models.items():
        c=model['variants']['full-and-crops']['calibration'];m=model['metadata']
        lines.append(f"| {name} | {c['selected']} | {n(c['cvBrier']['raw'])} | {n(c['cvBrier']['global-platt'])} | {n(c['cvBrier']['per-item-platt'])} | {c['passesAdoptionRule']} | {n(m['secondsPerPhotoTenViewsMedian'])} / {n(m['secondsPerPhotoTenViewsP95'])} | {m['weightsBytes']/1024**2:.2f} |")
        comp=c['comparison'];diagnostics.append(f"{name}: held-out raw/calibrated Brier {n(comp['raw']['brier']['value'])}/{n(comp['calibrated']['brier']['value'])}; paired difference CI {comp['pairedBrierDifference']['ci95']}; raw pooled AUROC CI {comp['raw']['auroc']['ci95']}.")
    for diagnostic in diagnostics: lines.extend(['',diagnostic])
    parity=ROOT/'.cache/parity.json'
    if parity.exists():
        p=json.loads(parity.read_text());lines+=['','## Core ML parity','',f"20 deterministic, evenly spaced manifest photos (not selected by score): minimum cosine **{p['minCosine']:.9f}**, mean **{p['meanCosine']:.9f}**; all ≥ 0.99: **{p['passes']}**. Mixed-precision image encoder: large linear weights/operations FP16; patch convolution and other math FP32, model-owned normalization, exact Pillow-preprocessed RGB image input. Core ML configured with compute units `.all`. macOS single-image prediction median {p['secondsPerImageMedian']:.6f}s; p95 {p['secondsPerImageP95']:.6f}s. These exclude JPEG decoding/cropping and do not predict iPhone latency. Package {p['packageBytes']/1024**2:.2f} MiB. torch {p['torch']}, coremltools {p['coremltools']}.", '',f"Package SHA-256 tree: `{p['packageSHA256']}`. Weights SHA-256: `{p['model']['identity']['weightsSHA256']}`.", '', 'A fully FP16 conversion failed the fixed gate (minimum cosine 0.981683249). Keeping normalization/attention in FP32 alone did not resolve it. Layer tracing found error before the first transformer block; keeping the patch convolution FP32 resolved it. The passed artifact keeps the large linear weights FP16. A full FP32 diagnostic matched the failing image at cosine 1.0 on CPU but failed to create an `.all` execution plan; it is not shipped. Failed diagnostic artifacts remain private in `.cache/`. Core ML predictions completed despite nonfatal teardown cache-write warnings denied by the sandbox.']
    native=ROOT/'.cache/native-parity.json'
    if native.exists():
        p=json.loads(native.read_text());lines+=['','## Native host pipeline check','',f"The actual Swift preprocessing helper matched Pillow byte-for-byte on 40 view/resampling cases (two synthetic RGB images, full image plus nine crops, bilinear and bicubic). All byte comparisons exact: **{p['allResizeBytesExact']}**. This checks resize/crop math separately from JPEG decoding."]
        if 'scoring' in p:
            s=p['scoring'];lines+=['',f"The actual Swift JPEG-to-ten-view-score path on {s['photos']} fixed eval photos: max raw score difference {s['maxRawScoreDifference']:.9f}, mean {s['meanRawScoreDifference']:.9f}; {s['thresholdDecisionDisagreements']} of {s['imageItemDecisions']} threshold decisions differ from PyTorch. Native macOS median {s['secondsPerPhotoMedian']:.6f}s and p95 {s['secondsPerPhotoP95']:.6f}s per photo, including preprocessing and inference. These are host measurements, not iPhone latency or physical-device validation."]
    lines+=['','## License, reproduction and provenance','',
        'The [LAION model card](https://huggingface.co/laion/CLIP-ViT-B-32-laion2B-s34B-b79K) marks ViT-B-32 weights MIT. MobileCLIP model weights use the [Apple ML Research Model license](https://github.com/apple-aiml-research/ml-mobileclip/blob/main/LICENSE_MODELS), limited to non-commercial research/academic use. The selection above follows the brief’s license preference; no claim of suitability for a safety-critical use is made.', '',
        'Run with the existing `~/.local/share/fixlist-scan/clip/venv/bin/python`, `HF_HUB_OFFLINE=1`, and `PYTHONDONTWRITEBYTECODE=1`: `scan/ondevice/pilot.py --dataset <read-only hazard-eval>`, then `scan/ondevice/export_model.py --model '+chosen+' --dataset <read-only hazard-eval>`, then `scan/ondevice/report.py`. No weights or data downloads. Local caches under `.cache/` are gitignored; they contain per-image scores and parity records and must stay private. App resources contain only the encoder and prompt vectors.', '',
        'Prompts SHA-256: `'+r['protocol']['promptsSHA256']+'`. Manifest SHA-256: `'+r['protocol']['manifestSHA256']+'`. Label SHA-256: `'+r['protocol']['labelsSHA256']+'`.', '',
        'Exact frozen group split:', '', '```json', json.dumps(r['protocol']['split'],indent=2), '```', '']
    (ROOT/'RESULTS-2026-10-23.md').write_text('\n'.join(lines))
    print('chosen',chosen,'delta',delta)

if __name__=='__main__':main()
