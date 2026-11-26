#!/usr/bin/env python3
"""Compile the actual Swift engine on macOS, test rules and compare Vision boxes.

Artifacts and compiled Swift harness are written outside git. This is host
evidence only; it does not measure iPhone latency or qualify physical capture.
"""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]

HARNESS = r'''
do {
    let args = CommandLine.arguments
    let configData = try Data(contentsOf: URL(fileURLWithPath: args[2]))
    let config = try JSONDecoder().decode(HazardConfig.self, from: configData)
    let rules = HazardRules(config: config)
    var ruleCases: [[String: Any]] = []
    var ruleChecks = 0
    func detection(_ label: String, _ score: Double, _ x: Double, _ y: Double, _ w: Double, _ h: Double) -> HazardDetection {
        HazardDetection(label: label, confidence: score, box: CGRect(x: x, y: y, width: w, height: h))!
    }
    func score(_ ds: [HazardDetection], _ id: String) -> Double {
        let items = rules.analyze(ds, width: 1000, height: 800)
        ruleCases.append(["detections": ds.map(\.dictionary), "items": items])
        return (items[id] as! [String: Any])["relevance"] as! Double
    }
    func check(_ ok: Bool, _ label: String) throws {
        if !ok { throw NSError(domain: "DetectorRules", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
        ruleChecks += 1
    }
    let rug = detection("rug", 0.6, 0.2, 0.65, 0.5, 0.3)
    let cord = detection("extension cord", 0.4, 0.2, 0.75, 0.5, 0.05)
    let toilet = detection("toilet", 0.8, 0.2, 0.4, 0.3, 0.3)
    let stairs = detection("stairs", 0.4, 0.2, 0.2, 0.6, 0.7)
    let shoe = detection("shoe", 0.5, 0.3, 0.5, 0.1, 0.1)
    try check(score([], "rug-check") == 0, "blank floor must not flag")
    try check(score([rug], "rug-check") == 0.6, "floor rug")
    try check(score([detection("rug", 0.9, 0.1, 0.1, 0.5, 0.2)], "rug-check") == 0, "high rug box abstains")
    try check(score([cord], "cord-check") == 0.4, "lower horizontal cord")
    try check(score([detection("extension cord", 0.9, 0.2, 0.1, 0.5, 0.05)], "cord-check") == 0, "high cord abstains")
    try check(score([detection("extension cord", 0.9, 0.2, 0.4, 0.05, 0.5)], "cord-check") == 0, "vertical cord abstains")
    try check(score([detection("extension cord", 0.9, 0.2, 0.8, 0.06, 0.04)], "cord-check") == 0, "small object confused with cord abstains")
    try check(score([stairs, shoe], "stair-clutter-check") == 0.5, "object overlaps stairs")
    try check(score([shoe], "stair-clutter-check") == 0, "floor clutter alone has no stair flag")
    let floorShoe = detection("shoe", 0.5, 0.3, 0.75, 0.1, 0.1)
    let table = detection("table", 0.7, 0.2, 0.5, 0.6, 0.4)
    try check(score([floorShoe], "floor-clutter-check") == 0.5, "shoe on floor")
    try check(score([table, floorShoe], "floor-clutter-check") == 0, "shoe on table suppressed")
    let underTable = detection("shoe", 0.6, 0.3, 0.85, 0.1, 0.1)
    try check(score([table, underTable], "floor-clutter-check") == 0.6, "shoe below table bottom kept")
    let atTableBottom = detection("shoe", 0.6, 0.3, 0.8, 0.1, 0.1)
    try check(score([table, atTableBottom], "floor-clutter-check") == 0.6, "shoe at table bottom kept")
    try check(score([shoe], "floor-clutter-check") == 0, "upper object not on floor")
    try check(score([detection("shoe", 0.9, 0.3, 0.85, 0.01, 0.01)], "floor-clutter-check") == 0, "tiny clutter abstains")
    // Exactly half the object's area lies inside this furniture box.
    let halfShoe = detection("shoe", 0.6, 0.125, 0.75, 0.25, 0.125)
    let halfTable = detection("table", 0.7, 0.25, 0.5, 0.5, 0.5)
    try check(score([halfTable, halfShoe], "floor-clutter-check") == 0, "50 percent furniture overlap suppresses")
    try check(score([halfTable, detection("shoe", 0.6, 0.12, 0.75, 0.25, 0.125)], "floor-clutter-check") == 0.6, "less than half overlap kept")
    try check(score([detection("table", 0.249, 0.2, 0.5, 0.6, 0.4), floorShoe], "floor-clutter-check") == 0.5, "weak furniture does not suppress")
    for label in ["table", "desk", "sofa", "chair", "bed", "cabinet", "kitchen counter", "kitchen island"] {
        try check(score([detection(label, 0.7, 0.2, 0.5, 0.6, 0.4), floorShoe], "floor-clutter-check") == 0, "furniture suppresses: \(label)")
    }
    for (label, threshold) in config.floorClutterThresholds {
        try check(score([detection(label, threshold, 0.3, 0.75, 0.1, 0.1)], "floor-clutter-check") == threshold, "class threshold included: \(label)")
        try check(score([detection(label, threshold - 0.000001, 0.3, 0.75, 0.1, 0.1)], "floor-clutter-check") == 0, "below class threshold: \(label)")
    }
    let book = detection("book", 0.8, 0.6, 0.85, 0.1, 0.1)
    let highest = rules.analyze([floorShoe, book], width: 1000, height: 800)["floor-clutter-check"] as! [String: Any]
    let point = highest["point"] as! [String: Double]
    try check(highest["relevance"] as! Double == 0.8 && abs(point["u"]! - 650) < 0.000001 && abs(point["v"]! - 720) < 0.000001, "highest qualifying object supplies centre")
    try check(score([table, detection("book", 0.9, 0.3, 0.75, 0.1, 0.1), detection("shoe", 0.5, 0.05, 0.85, 0.1, 0.1)], "floor-clutter-check") == 0.5, "suppressed stronger object cannot hide floor object")
    try check(score([toilet], "bathroom-support-check") == 0.8, "fixture without detected bar")
    try check(score([toilet, detection("grab bar", 0.13, 0.1, 0.2, 0.2, 0.1)], "bathroom-support-check") == 0, "bar suppresses support prompt")
    try check(score([detection("bathtub", 0.9, 0.1, 0.4, 0.6, 0.4)], "bathroom-support-check") == 0, "tub alone needs bathroom context")
    for id in ["handrail-check", "stair-lighting-check", "night-lighting-check", "shower-surface-check"] {
        try check(score([rug, cord, stairs, shoe, toilet], id) == 0, "unsupported item must abstain")
    }
    let engine = try HazardEngine(modelURL: URL(fileURLWithPath: args[1]), configData: configData)
    var rows: [[String: Any]] = []
    for path in args.dropFirst(3) {
        let start = Date()
        let (width, height, detections) = try engine.detect(jpeg: Data(contentsOf: URL(fileURLWithPath: path)))
        rows.append(["image": path, "width": width, "height": height,
                     "seconds": Date().timeIntervalSince(start),
                     "detections": detections.map(\.dictionary),
                     "items": rules.analyze(detections, width: width, height: height)])
    }
    let output = try JSONSerialization.data(withJSONObject: ["ruleChecks": ruleChecks, "ruleCases": ruleCases, "rows": rows], options: [.prettyPrinted, .sortedKeys])
    print(String(decoding: output, as: UTF8.self))
} catch {
    fputs("Native detector verification failed: \(error)\n", stderr)
    exit(1)
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiled", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--images", nargs="+", default=["ov-0003.jpg", "wc-0023.jpg", "ov-0008.jpg"])
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    selected = [r for r in json.loads(args.predictions.read_text()) if Path(r["image"]).name in args.images]
    assert len(selected) == len(args.images)
    source = args.out / "detector-native.swift"
    source.write_text((ROOT / "ios/App/App/FixListHazardsPlugin.swift").read_text() + "\n" + HARNESS)
    binary = args.out / "detector-native"
    subprocess.run(["xcrun", "swiftc", str(source), "-o", str(binary), "-framework", "Vision", "-framework", "CoreML", "-framework", "ImageIO", "-framework", "CoreGraphics"], check=True)
    result = subprocess.run([str(binary), str(args.compiled), str(ROOT / "ios/App/App/HazardModel/hazard-prompts.json"), *[r["image"] for r in selected]], check=True, capture_output=True, text=True)
    (args.out / "native.json").write_text(result.stdout)
    actual = json.loads(result.stdout)
    from detector_rules import apply_rules
    for case in actual["ruleCases"]:
        mirrored = apply_rules(case["detections"], 1000, 800)
        for item, native in case["items"].items():
            expected = mirrored[item]
            assert abs(native["relevance"] - expected["relevance"]) < 1e-9, (item, case)
            assert (native["point"] is None) == (expected["point"] is None), (item, case)
            if native["point"] is not None:
                assert max(abs(native["point"][k] - expected["point"][k]) for k in ["u", "v"]) < 1e-9, (item, case)
    comparisons = []
    for expected, got in zip(selected, actual["rows"]):
        assert [expected["width"], expected["height"]] == [got["width"], got["height"]]
        for id, row in expected["items"].items():
            native = got["items"][id]
            assert (row["point"] is None) == (native["point"] is None), (expected["image"], id, row, native)
            if row["point"] is not None:
                error = max(abs(row["point"][k] - native["point"][k]) for k in ["u", "v"])
                confidence_error = abs(row["relevance"] - native["relevance"])
                comparisons.append({"image": Path(expected["image"]).name, "item": id,
                                    "pointMaxErrorPixels": error, "confidenceDifference": confidence_error})
                assert error < 12 and confidence_error < .10, comparisons[-1]
    report = {"ruleChecks": actual["ruleChecks"], "pythonRuleParityCases": len(actual["ruleCases"]), "images": len(selected), "comparisons": comparisons,
              "note": "Same Core ML package; Pillow vs Vision resampling can differ. macOS only."}
    (args.out / "parity.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
