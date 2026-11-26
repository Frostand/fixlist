#!/usr/bin/env python3
"""Mac Core ML predictions and visual review; outputs stay outside git.

This is qualitative development review, never a held-out accuracy estimate.
Coordinates are normalized top-left xywh centres from the Core ML NMS stage.
Use exactly the same scaleFill resize in Vision; no letterbox/crop.
"""
import argparse
import base64
from collections import Counter
import html
import io
import json
from pathlib import Path
import time

import coremltools as ct
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from export_detector import VOCABULARY
from detector_rules import RULES, apply_rules


def write_flag_sheet(records, out):
    """Show the winning proposal box and point, rather than all raw detections."""
    cards, thumbnails = [], []
    thresholds = {i["checklistItemId"]: i["threshold"] for i in RULES["items"]}
    for record in records:
        for item, result in record["items"].items():
            if result["point"] is None or result["relevance"] < thresholds[item]:
                continue
            preview = ImageOps.exif_transpose(Image.open(record["image"])).convert("RGB")
            preview.thumbnail((480, 320))
            draw = ImageDraw.Draw(preview)
            point = result["point"]
            winner = min(record["detections"], key=lambda d: abs(d["confidence"] - result["relevance"])
                         + abs(d["box"][0] - point["u"] / record["width"])
                         + abs(d["box"][1] - point["v"] / record["height"]))
            x, y, w, h = winner["box"]
            draw.rectangle(((x-w/2)*preview.width, (y-h/2)*preview.height,
                            (x+w/2)*preview.width, (y+h/2)*preview.height), outline="#d62020", width=3)
            px, py = point["u"] / record["width"] * preview.width, point["v"] / record["height"] * preview.height
            draw.ellipse((px-4, py-4, px+4, py+4), fill="#d62020")
            label = f"{record.get('reviewGroup', '')}/{Path(record['image']).name}: {item} — {winner['class']} {result['relevance']:.3f}"
            binary = io.BytesIO()
            preview.save(binary, format="JPEG", quality=85)
            cards.append(f'<figure><img alt="{html.escape(label, quote=True)}" src="data:image/jpeg;base64,{base64.b64encode(binary.getvalue()).decode()}"><figcaption>{html.escape(label)}</figcaption></figure>')
            thumbnails.append((preview, label))
    out.mkdir(parents=True, exist_ok=True)
    (out / "flags.html").write_text('<!doctype html><html lang="en"><meta charset="utf-8"><title>FixList Round 2 proposals</title><style>body{font:14px system-ui;background:#eee}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:8px}figure{margin:0;background:white;padding:8px}img{max-width:100%}figcaption{overflow-wrap:anywhere}</style><h1>Unverified object proposals — Round 2</h1><p>Development review only. Boxes and dots show the winning object per rule. Confidence is not hazard probability. No accuracy or phone-performance claim.</p><main>' + ''.join(cards) + '</main></html>')
    for page in range((len(thumbnails) + 11) // 12):
        sheet = Image.new("RGB", (1440, 1440), "white")
        draw = ImageDraw.Draw(sheet)
        for index, (preview, label) in enumerate(thumbnails[page*12:page*12+12]):
            x, y = (index % 3) * 480, (index // 3) * 360
            sheet.paste(preview, (x, y))
            # Split the rule and class onto another line for readable thumbnails.
            name, detail = label.split(": ", 1)
            draw.text((x+4, y+322), name, fill="black")
            draw.text((x+4, y+337), detail, fill="black")
        sheet.save(out / f"flags-{page}.jpg", quality=90)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--take", type=int, default=0)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    model = ct.models.MLModel(str(args.package), compute_units=ct.ComputeUnit.ALL)
    spec = model.get_spec()
    print(spec.description, flush=True)
    paths = sorted(args.images.glob("*.jpg"))
    if args.take and len(paths) > args.take:
        paths = [paths[i] for i in np.linspace(0, len(paths) - 1, args.take, dtype=int)]
    records, seconds, tiles = [], [], []
    counts = Counter()
    for index, path in enumerate(paths):
        image = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        started = time.perf_counter()
        output = model.predict({"image": image.resize((640, 640), Image.Resampling.BILINEAR)})
        elapsed = time.perf_counter() - started
        seconds.append(elapsed)
        confidences = np.asarray(output["confidence"])
        coordinates = np.asarray(output["coordinates"])
        detections = []
        preview = image.copy()
        preview.thumbnail((480, 320))
        draw = ImageDraw.Draw(preview)
        for confidence, box in zip(confidences, coordinates):
            cls = int(np.argmax(confidence))
            score = float(confidence[cls])
            if not np.isfinite(box).all() or not np.isfinite(score) or score < .05:
                continue
            x, y, w, h = [float(v) for v in box]
            left, top = max(0., x - w/2), max(0., y - h/2)
            right, bottom = min(1., x + w/2), min(1., y + h/2)
            if right <= left or bottom <= top:
                continue
            x, y, w, h = (left + right)/2, (top + bottom)/2, right - left, bottom - top
            row = {"class": VOCABULARY[cls], "confidence": score, "box": [x, y, w, h],
                   "point": {"u": x * image.width, "v": y * image.height}}
            detections.append(row)
            counts[VOCABULARY[cls]] += 1
            if score >= .15:
                color = "#d62020" if cls < 17 else "#3273bf"
                x1 = max(0, (x - w / 2) * preview.width)
                y1 = max(0, (y - h / 2) * preview.height)
                x2 = min(preview.width - 1, (x + w / 2) * preview.width)
                y2 = min(preview.height - 1, (y + h / 2) * preview.height)
                if x2 > x1 and y2 > y1:
                    draw.rectangle((x1, y1, x2, y2), outline=color, width=2)
                    draw.text((x1, y1), f"{VOCABULARY[cls]} {score:.2f}", fill=color,
                              stroke_width=1, stroke_fill="white")
        record = {"image": str(path.resolve()), "width": image.width, "height": image.height,
                  "seconds": elapsed, "detections": detections,
                  "items": apply_rules(detections, image.width, image.height)}
        records.append(record)
        binary = io.BytesIO()
        preview.save(binary, format="JPEG", quality=80)
        labels = "; ".join(f"{d['class']} {d['confidence']:.2f}" for d in detections if d["confidence"] >= .15)
        tiles.append(f'<figure><img src="data:image/jpeg;base64,{base64.b64encode(binary.getvalue()).decode()}"><figcaption>{html.escape(path.name)}<br>{html.escape(labels)}</figcaption></figure>')
        print(index + 1, path.name, elapsed, labels, flush=True)
    (args.out / "predictions.json").write_text(json.dumps(records, indent=2) + "\n")
    summary = {"images": len(records), "medianSeconds": float(np.median(seconds)),
               "p95Seconds": float(np.percentile(seconds, 95)), "detectionsAt005": dict(counts),
               "proposalCounts": dict(Counter(item for row in records for item, value in row["items"].items() if value["point"] is not None)),
               "note": "Qualitative development review. No accuracy or phone latency claim."}
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (args.out / "index.html").write_text('<!doctype html><meta charset="utf-8"><title>FixList detector development review</title><style>body{font:14px system-ui;background:#eee}main{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}figure{margin:0;background:white;padding:8px}img{max-width:100%}figcaption{padding:8px;overflow-wrap:anywhere}</style><h1>Development review: unverified object proposals</h1><p>Red: candidate classes; blue: context classes. Boxes shown at confidence ≥0.15, before geometric rules. All scores saved at ≥0.05. Confidence is not hazard probability.</p><main>' + ''.join(tiles) + '</main>')
    write_flag_sheet(records, args.out)
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
