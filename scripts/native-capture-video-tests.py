#!/usr/bin/env python3
"""Compile and exercise the actual production AVAssetWriter using synthetic pixels only."""
from pathlib import Path
import argparse
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--export-synthetic', type=Path, help='Keep two public generated MP4s for web-validator integration')
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='fixlist-video-tests-') as scratch:
    scratch = Path(scratch)
    sdk = subprocess.check_output(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path'], text=True).strip()
    support = scratch / 'support.swift'
    support.write_text('''import Foundation
    enum CaptureFiles {
        static let queue = DispatchQueue(label: "fixlist.video.production-tests")
        static var didRemove: ((URL) -> Void)?
        static func remove(_ url: URL) throws {
            do { try FileManager.default.removeItem(at: url) }
            catch let e as NSError where e.domain == NSCocoaErrorDomain && e.code == NSFileNoSuchFileError {}
            didRemove?(url)
        }
    }
    ''')
    production = ROOT / 'ios/App/App/CaptureVideoWriter.swift'
    subprocess.run(['xcrun', 'swiftc', '-typecheck', '-sdk', sdk, '-target',
                    'arm64-apple-ios15.0-simulator', str(support), str(production)], check=True)
    print('PASS: production writer iOS 15 SDK typecheck', flush=True)
    binary = scratch / 'video-tests'
    subprocess.run(['xcrun', 'swiftc', '-D', 'CAPTURE_VIDEO_TESTING', str(support), str(production),
                    str(ROOT / 'scripts/native-capture-video-tests.swift'), '-o', str(binary)], check=True)
    command = [str(binary)]
    if args.export_synthetic:
        args.export_synthetic.mkdir(parents=True, exist_ok=True)
        command.append(str(args.export_synthetic.resolve()))
    subprocess.run(command, check=True, timeout=120)
