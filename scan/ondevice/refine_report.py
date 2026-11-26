#!/usr/bin/env python3
"""Publish aggregate follow-up evidence; no private images/embeddings/score rows."""
from pathlib import Path
import hashlib
import json

ROOT=Path(__file__).resolve().parent
CACHE=ROOT/'.cache/followup'
def n(value):return 'undefined' if value is None else f'{value:.6f}'
def main():
    lock=json.loads((CACHE/'selection-lock.json').read_text())
    results=json.loads((CACHE/'heldout-evaluation.json').read_text())
    diagnostic=json.loads((CACHE/'demo-photo-diagnostic.json').read_text())
    candidates=json.loads((CACHE/'dev-candidates.json').read_text())
    assert not any(row['passesHeldOutRule'] for row in results.values()),'This report expects the recorded no-ship outcome'
    receipt={**lock,'selectionLockSHA256':hashlib.sha256((CACHE/'selection-lock.json').read_bytes()).hexdigest(),
        'heldOutEvaluation':results,'decision':'no-ship; baseline artifacts retained'}
    (ROOT/'REFINEMENT-SELECTION-2026-10-23.json').write_text(json.dumps(receipt,indent=2)+'\n')
    lines=['# Rug and bedroom-path relevance follow-up — 2026-10-23','',
        '**Decision: no ship.** Keep the existing image encoder, prompt resource, Swift plugin, TypeScript metadata, thresholds and identity unchanged. Neither independently selected candidate passes the required held-out gate.', '',
        '## Before and after on the fixed held-out groups','',
        '| Item | Version | Usable photos / positives | AUROC | AUPRC | Precision | Recall | Threshold | TP / FP / FN |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    for key,row in results.items():
        for version,data in [('shipped before',row['before']),('selected, unshipped after',row['selectedAfter'])]:
            if data is None:continue
            m,o=data['metrics'],data['operating']
            lines.append(f"| {key} | {version} | {m['n']} / {m['positives']} | {n(m['auroc'])} | {n(m['auprc'])} | {n(o['precision'])} | {n(o['recall'])} | {o['threshold']:.12f} | {o['tp']} / {o['fp']} / {o['fn']} |")
    lines+=['',
        'The rug contrast ranks held-out photos much better and cuts false positives from six to three, but still finds only three of four positive photos. Its recall gain is zero. The bedroom-path candidate removes its one false positive but still finds two of three positives, with lower AUROC. These fail the predeclared gate; no threshold or alternate candidate was chosen after seeing these results.', '',
        '## Development-only selection','',
        'The frozen `refine-prompts-protocol-2026-10-23.json` defines 24 rug and 8 bedroom-path variants before scoring: original/expanded positive descriptions, generic or item-specific negatives, and full-image versus maximum-of-ten-view aggregation. The exact seed-7 group split and five development-fold lists from `scan/calibration.json` were reused: 102 development photos across 33 groups, 23 held-out photos across 15 groups. The encoder and original preprocessing were not trained or changed.', '',
        'Selection read only development item labels. The label reader checks the leading image ID and does not parse item labels for other IDs. Each CV fold fits its threshold only on the other development groups. The same image/text scores are reused across folds because the encoder and prompts are fixed, with only threshold selection fitted.', '',
        'A threshold needs at least two training true positives, recall >= 0.7 and precision >= 0.8. If that pair is infeasible, precision may fall to 0.6 at recall >= 0.7. Recall is maximized, then precision and threshold break ties. Midpoints between adjacent training scores avoid cutting exactly on a training example. Candidate selection first requires grouped out-of-fold recall >= 0.7 and precision >= 0.8, or falls back to precision >= 0.6. Among eligible candidates, maximize out-of-fold F2, then AUROC, precision and declared order. Refit only the selected threshold on all development groups. Both selected candidates qualified at the 0.8 precision tier, so fallback was not needed.', '',
        '| Item | Selected positives | Selected negatives | Views | Dev OOF precision | Dev OOF recall | All-dev precision | All-dev recall |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |']
    for key,row in results.items():
        s=row['selectedCandidate'];o=s['devOOF'];d=s['allDevThreshold']
        lines.append(f"| {key} | {s['positiveSet']} | {s['negativeSet']} | {s['aggregation']} | {n(o['precision'])} | {n(o['recall'])} | {n(d['precision'])} | {n(d['recall'])} |")
    lines+=['',
        'The selected rug positives are the original three descriptions. The negatives are “bare hardwood floor”, “bare tile floor”, and “wall-to-wall carpet” photo descriptions, replacing the generic neutral contrast. Expanded rug-type/edge descriptions were tested but did not win the development selection. Bedroom-path selection uses the four new bed/floor/doorway descriptions against five other-room descriptions. Both winners use max over the full image and nine overlapping crops, so changing aggregation was not selected.', '',
        'After the final development choice was locked, `refine_prompts.py evaluate` parsed the held-out item labels once. The prospective ship gate required nondecreasing held-out AUROC (tolerance 1e-12) and at least 0.20 absolute recall gain per item, followed by zero native threshold-decision mismatches if an item qualified. No item qualified for shipping, so runtime resources were never changed and no native parity run was needed.', '',
        'This is a follow-up on a previously used held-out split, not a new independent test set. Known baseline results and the reported demo miss motivated the task; the new variant/threshold selection itself used development groups only. Labels are GPT-6 Luna judgments, not expert ground truth. The small held-out positive counts make recall coarse (0.25 increments for rugs, 0.333333 for bedroom paths); these numbers do not establish real-home usefulness, hazard identification, or safety.', '',
        '## Reported demo photo','']
    b,a=diagnostic['before'],diagnostic['unshippedCandidate']
    lines+=[f"`vr-0004` is in the development `viennese-render` group. Recomputed from the fixed PyTorch embeddings and serialized shipped vectors, the rug score is **{b['score']:.9f}**, below the shipped **{b['threshold']:.9f}** threshold, reproducing the reported miss. The selected, unshipped floor-negative contrast scores **{a['score']:.9f}**, also below its **{a['threshold']:.9f}** threshold. This diagnostic was computed after selection/evaluation and was not used to choose or retune a candidate. The miss remains unresolved under this task’s ship rule.", '',
        '## Validation and file scope','',
        '`npx vitest run --configLoader runner --cache=false src/lib/ondevice-flags.test.ts src/lib/capture-suggestions.test.ts`: **35 passed**. Runner config loading and disabled test caching avoid writing through the shared `node_modules` symlink. No dependency install, dependency projection, app change or commit occurred.', '',
        'The encoder package tree hash and all three runtime files (Swift plugin, prompt JSON, TypeScript model metadata) match their pre-experiment snapshot. Existing app, capture validators, tests and all files outside `scan/ondevice/` are unchanged by this follow-up. Native/Simulator execution was not repeated for unchanged artifacts; the parent’s reported Simulator success is parent evidence.', '',
        'Only new experiment/protocol/report files under `scan/ondevice/` were added. Private image embeddings, per-image scores, baseline copies and detailed receipts remain in gitignored `.cache/followup/`. `REFINEMENT-SELECTION-2026-10-23.json` contains aggregate selection and evaluation evidence. Markdown files are ignored by this checkout and must be included deliberately in a later authorized review/commit.', '',
        'Reproduce offline using the existing clip Python environment: run `refine_prompts.py select --dataset <hazard-eval>`, then `refine_prompts.py evaluate --dataset <hazard-eval>`, then `refine_report.py`. The evaluate step verifies the protocol, script and score-file hashes from the selection lock before parsing held-out labels.', '',
        'Protocol SHA-256: `'+lock['protocolSHA256']+'`.', '',
        'Selection lock SHA-256: `'+receipt['selectionLockSHA256']+'`.', '',
        '## All development candidates','',
        '| Item | Positives | Negatives | Views | Dev AUROC | OOF precision | OOF recall | OOF F2 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |']
    for s in candidates:
        lines.append(f"| {s['item']} | {s['positiveSet']} | {s['negativeSet']} | {s['aggregation']} | {n(s['devMetrics']['auroc'])} | {n(s['devOOF']['precision'])} | {n(s['devOOF']['recall'])} | {n(s['devOOFF2'])} |")
    (ROOT/'REFINEMENT-RESULTS-2026-10-23.md').write_text('\n'.join(lines)+'\n')
    print('No-ship report written; runtime artifacts retained.')

if __name__=='__main__':main()
