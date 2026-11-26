#!/usr/bin/env python3
"""Export a fixed-vocabulary detector outside git; never touch the old CLIP env.

Run from an external work directory using the NEW detector-venv. Review the
result before explicitly copying it into the app. Source weights are AGPL-3.0.
"""
import argparse
import hashlib
import json
from pathlib import Path

VOCABULARY = [
    "rug", "floor mat", "runner rug", "electrical cord", "extension cord",
    "power strip", "shoe", "bag", "cardboard box", "clothes", "toy", "book",
    "stairs", "bathtub", "toilet", "shower", "grab bar",
    "sofa", "chair", "table", "bed", "cabinet", "person", "towel",
    "sink", "kitchen island", "kitchen counter", "radiator", "desk", "window",
    "stair handrail", "doorway", "blanket", "cushion", "upholstered bench",
    "wall-to-wall carpet",
]
SOURCE_SHA256 = "9b2c17ab6124a913e9b3a5c170617920d91b0f01111a8479da69f00e2cf27792"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", type=Path, default=Path("yolov8s-worldv2.pt"))
    args = parser.parse_args()
    import torch
    import coremltools as ct
    import ultralytics
    from ultralytics import YOLOWorld
    torch.set_num_threads(4)
    model = YOLOWorld(str(args.weights))
    if sha(args.weights) != SOURCE_SHA256:
        raise ValueError("Source checkpoint differs from the reviewed YOLO-World v2 small weights.")
    model.set_classes(VOCABULARY)
    output = model.export(format="coreml", imgsz=640, half=True, nms=True,
                          batch=1, device="cpu", conf=0.05, iou=0.45)
    metadata = {"source": str(args.weights), "sourceSHA256": sha(args.weights),
                "vocabulary": VOCABULARY, "imageSize": 640,
                "ultralytics": ultralytics.__version__, "torch": torch.__version__,
                "coremltools": ct.__version__, "license": "AGPL-3.0",
                "package": str(output)}
    Path("export.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2), flush=True)


if __name__ == "__main__":
    main()
