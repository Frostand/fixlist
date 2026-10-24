#!/usr/bin/env python3
"""Run production Swift geometry, options and plugin lifecycle methods on the Mac.

Permission/presentation are stubbed; parser, lifecycle decisions and file I/O run.
This does not check ARKit camera/tracking or actual UIKit dismissal behavior.
It never opens a capture, private photo, Simulator, or physical device.
"""
from pathlib import Path
import re
import os
import subprocess
import tempfile
import argparse


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "ios/App/App/FixListCapturePlugin.swift").read_text()
CONTROLLER = Path(os.environ.get("FIXLIST_NATIVE_CONTROLLER", ROOT / "ios/App/App/FixListCaptureViewController.swift")).read_text()
VIDEO = (ROOT / "ios/App/App/CaptureVideoWriter.swift").read_text()


def declaration(marker: str, source: str = SOURCE) -> str:
    start = source.index(marker)
    opening = source.index("{", start)
    depth = 1
    end = opening + 1
    while depth:
        if source[end] == "{":
            depth += 1
        elif source[end] == "}":
            depth -= 1
        end += 1
    return source[start:end]


helpers = "\n\n".join(declaration(marker) for marker in (
    "struct CapturePrompt", "struct CaptureOptions", "enum CaptureFloorMath", "enum CaptureViewportMath", "enum CapturePortraitMath", "extension SIMD4 where Scalar == Float",
))
# Run the existing DEBUG self-test body on the host, without pretending to have
# an ARCamera. The real SDK projection check is compiled by --frameworks below.
helpers += "\nextension CapturePortraitMath {\n" + declaration("static func selfTest()") + "\n}"
# Execute the real production restart/confirmation method bodies. Only the
# UIKit/session boundary is stubbed; clearing, invalidation and guards are real.
restart_methods = "\n".join(declaration(marker, CONTROLLER).replace("@objc private func", "func").replace("private func", "func")
                            for marker in ("@objc private func resetTapped()", "private func resetWorld()"))
late_photo = declaration("if generation != self.worldGeneration", CONTROLLER)
stubs = (ROOT / "scripts/native-capture-stubs.swift").read_text() + "\n" + (ROOT / "scripts/native-capture-tests-stubs.swift").read_text()
lifecycle_methods = "\n".join(declaration(marker).replace("@objc func", "func").replace("private func", "func")
                              for marker in ("@objc func start(", "private func resolveStart(", "private func presentCapture(", "private func discard(_ call: CAPPluginCall, id:"))
baseline = subprocess.check_output(["git", "show", "d830860:ios/App/App/FixListCaptureViewController.swift"], cwd=ROOT, text=True) if os.environ.get("FIXLIST_NATIVE_BASELINE") else None
video_methods = "\n".join(declaration(marker, baseline if baseline and marker not in ("private func discardActiveVideo(", "private func pauseCaptureForBackground()", "@objc private func useVideoTapped()") else CONTROLLER).replace("@objc private func", "func").replace("private func", "func")
                          for marker in ("@objc private func skipTapped()", "private func completeCapture()", "func abort()",
                                         "private func finish(", "private func discardActiveVideo(", "private func pauseCaptureForBackground()", "@objc private func useVideoTapped()",
                                         "func sessionWasInterrupted(", "func session(_ session: ARSession, didFailWithError"))
stubs = stubs.replace("/* PRODUCTION_VIDEO_LIFECYCLE_METHODS */", video_methods)
helpers += "\n" + declaration("struct CaptureVideo", VIDEO)
stubs = stubs.replace("/* PRODUCTION_PLUGIN_METHODS */", lifecycle_methods)
stubs = stubs.replace("/* PRODUCTION_VALID_ID */", declaration("static func validId("))
stubs = stubs.replace("/* PRODUCTION_RESTART_METHODS */", restart_methods)
stubs = stubs.replace("/* PRODUCTION_LATE_PHOTO_GUARD */", late_photo)
outline_markers = ["@objc private func tapped(", "@objc private func placeAtCenter()", "private func place(at point:",
                   "private func updateAim()", "@objc private func undoTapped()",
                   "@objc private func doorTapped()", "@objc private func closeTapped()",
                   "private func updateViewport("]
# Include the old snap policy while running the new regressions against the
# pre-fix controller; no behavior is reimplemented in the test harness.
if "private func shouldSnapToFirst(" in CONTROLLER:
    outline_markers.append("private func shouldSnapToFirst(")
outline_methods = "\n".join(declaration(marker, CONTROLLER).replace("@objc private func", "func").replace("private func", "func")
                            for marker in outline_markers)
stubs = stubs.replace("/* PRODUCTION_OUTLINE_METHODS */", outline_methods)
tests = (ROOT / "scripts/native-capture-tests.swift").read_text()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--frameworks", type=Path, help="Built Simulator Capacitor/Cordova frameworks for full SDK typecheck")
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix="fixlist-native-tests-") as directory:
    # Compile the actual production SDK boundary for the app's iOS 15 minimum.
    # Host Bool fixtures cannot catch refined ARKit enum/availability mistakes.
    candidate_call = re.search(r"planeHeights\[plane\.identifier\] = (CaptureFloorMath\.candidate\([\s\S]*?\))\n", CONTROLLER)
    if candidate_call is None:
        raise RuntimeError("Could not locate the production floor classification boundary")
    sdk = subprocess.check_output(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-path"], text=True).strip()
    sdk_source = Path(directory) / "sdk-floor-mapping.swift"
    sdk_source.write_text("import Foundation\nimport simd\nimport ARKit\n" + declaration("enum CaptureFloorMath")
                          + "\nfunc checkFloorMapping(plane: ARPlaneAnchor, cameraY: Float, y: Float) -> Float? {\nreturn "
                          + candidate_call.group(1) + "\n}\n")
    subprocess.run(["xcrun", "swiftc", "-typecheck", "-warnings-as-errors", "-sdk", sdk,
                    "-target", "arm64-apple-ios15.0-simulator", str(sdk_source)], check=True)
    if args.frameworks:
        subprocess.run(["xcrun", "swiftc", "-typecheck", "-D", "DEBUG", "-sdk", sdk,
                        "-target", "arm64-apple-ios15.0-simulator", "-F", str(args.frameworks),
                        str(ROOT / "ios/App/App/FixListCapturePlugin.swift"),
                        str(ROOT / "ios/App/App/FixListCaptureViewController.swift"),
                        str(ROOT / "ios/App/App/CaptureVideoWriter.swift")], check=True)
        print("PASS: complete production capture controller/plugin iOS SDK typecheck (including DEBUG projection check)", flush=True)
    source = Path(directory) / "main.swift"
    binary = Path(directory) / "native-capture-tests"
    source.write_text('import Foundation\nimport CoreGraphics\nimport simd\nimport os.log\nlet captureLog = OSLog(subsystem: "fixlist.test", category: "capture")\n' + helpers + "\n" + stubs + "\n" + tests)
    subprocess.run(["xcrun", "swiftc", str(source), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
