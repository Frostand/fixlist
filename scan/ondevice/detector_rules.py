"""Qualitative review mirror of the Swift rules; parity is checked, not assumed."""
import json
from pathlib import Path

RULES = json.loads(Path(__file__).with_name("detector-rules.json").read_text())


def apply_rules(detections, width, height):
    geometry = RULES["geometry"]
    scores = {i["checklistItemId"]: {"relevance": 0.0, "point": None} for i in RULES["items"]}

    def fires(d):
        return d["confidence"] >= RULES["classThresholds"].get(d["class"], 1)

    def record(item, detection):
        score = min(1 - 1e-12, detection["confidence"])
        if score > scores[item]["relevance"]:
            x, y, _, _ = detection["box"]
            scores[item] = {"relevance": score, "point": {"u": x * width, "v": y * height}}

    ds = [d for d in detections if d["box"][2] * d["box"][3] >= geometry["minimumArea"]]
    furniture = [d for d in ds if d["class"] in ["table", "desk", "sofa", "chair", "bed", "cabinet", "kitchen counter", "kitchen island"]
                 and d["confidence"] >= geometry["furnitureMinConfidence"]]

    def on_furniture(d):
        x, y, w, h = d["box"]
        for support in furniture:
            sx, sy, sw, sh = support["box"]
            if y + h/2 >= sy + sh/2:
                continue
            iw = max(0, min(x+w/2, sx+sw/2) - max(x-w/2, sx-sw/2))
            ih = max(0, min(y+h/2, sy+sh/2) - max(y-h/2, sy-sh/2))
            if iw * ih / (w * h) >= geometry["furnitureObjectOverlap"]:
                return True
        return False
    for d in ds:
        x, y, w, h = d["box"]
        if not fires(d):
            continue
        if d["class"] in ["rug", "floor mat", "runner rug"] and y >= geometry["rugMinCenterY"] and y + h/2 >= geometry["rugMinBottomY"]:
            record("rug-check", d)
        if d["class"] in ["electrical cord", "extension cord", "power strip"] and y >= geometry["cordMinCenterY"] and y + h/2 >= geometry["cordMinBottomY"] and w >= geometry["cordMinWidth"] and w * width / (h * height) >= geometry["cordMinAspect"]:
            record("cord-check", d)
        if d["class"] in ["shoe", "bag", "cardboard box", "clothes", "toy", "book"]:
            if d["confidence"] >= RULES["floorClutterThresholds"][d["class"]] and y + h/2 >= geometry["floorClutterMinBottomY"] and not on_furniture(d):
                record("floor-clutter-check", d)
            for stair in ds:
                if stair["class"] != "stairs" or not fires(stair):
                    continue
                sx, sy, sw, sh = stair["box"]
                iw = max(0, min(x+w/2, sx+sw/2) - max(x-w/2, sx-sw/2))
                ih = max(0, min(y+h/2, sy+sh/2) - max(y-h/2, sy-sh/2))
                if iw * ih / (w * h) >= geometry["stairObjectOverlap"]:
                    record("stair-clutter-check", d)
    # Any detected bar suppresses the missing-support prompt; this is conservative
    # and is not evidence that a bar is absent when the rule does fire.
    if not any(d["class"] == "grab bar" and fires(d) for d in detections):
        for d in ds:
            if not fires(d):
                continue
            fixture = d["class"] in ["toilet", "shower"]
            if d["class"] == "bathtub":
                fixture = any(c["class"] in ["toilet", "shower"] and c["confidence"] >= geometry["bathCompanionConfidence"] for c in ds)
            if fixture:
                record("bathroom-support-check", d)
    return scores
