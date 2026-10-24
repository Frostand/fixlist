#!/usr/bin/env python3
"""Run production Swift geometry, options and plugin lifecycle methods on the Mac.

Permission/presentation are stubbed; parser, lifecycle decisions and file I/O run.
This does not check ARKit camera/tracking or actual UIKit dismissal behavior.
It never opens a capture, private photo, Simulator, or physical device.
"""
from pathlib import Path
import re
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "ios/App/App/FixListCapturePlugin.swift").read_text()
CONTROLLER = (ROOT / "ios/App/App/FixListCaptureViewController.swift").read_text()


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
    "struct CapturePrompt", "struct CaptureOptions", "enum CaptureFloorMath", "enum CapturePortraitMath", "extension SIMD4 where Scalar == Float",
))
# Execute the real production restart/confirmation method bodies. Only the
# UIKit/session boundary is stubbed; clearing, invalidation and guards are real.
restart_methods = "\n".join(declaration(marker, CONTROLLER).replace("@objc private func", "func").replace("private func", "func")
                            for marker in ("@objc private func resetTapped()", "private func resetWorld()"))
late_photo = declaration("if generation != self.worldGeneration", CONTROLLER)
stubs = (ROOT / "scripts/native-capture-stubs.swift").read_text() + "\n" + (ROOT / "scripts/native-capture-tests-stubs.swift").read_text()
lifecycle_methods = "\n".join(declaration(marker).replace("@objc func", "func").replace("private func", "func")
                              for marker in ("@objc func start(", "private func resolveStart(", "private func presentCapture(", "private func discard(_ call: CAPPluginCall, id:"))
stubs = stubs.replace("/* PRODUCTION_PLUGIN_METHODS */", lifecycle_methods)
stubs = stubs.replace("/* PRODUCTION_VALID_ID */", declaration("static func validId("))
stubs = stubs.replace("/* PRODUCTION_RESTART_METHODS */", restart_methods)
stubs = stubs.replace("/* PRODUCTION_LATE_PHOTO_GUARD */", late_photo)
tests = (ROOT / "scripts/native-capture-tests.swift").read_text()
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
    source = Path(directory) / "main.swift"
    binary = Path(directory) / "native-capture-tests"
    source.write_text("import Foundation\nimport simd\n" + helpers + "\n" + stubs + "\n" + tests)
    subprocess.run(["xcrun", "swiftc", str(source), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
