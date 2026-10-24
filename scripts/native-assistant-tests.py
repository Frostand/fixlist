#!/usr/bin/env python3
"""Execute production capabilities and speech teardown/events with host boundary stubs.

Optional --frameworks points to built iOS Simulator Capacitor/Cordova frameworks
and also typechecks the entire real plugin against the iOS SDK. No device/audio
operation, dependencies, models, or private assets are used.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / 'ios/App/App/FixListAssistantPlugin.swift'
SOURCE = PLUGIN.read_text()


def declaration(marker):
    start = SOURCE.index(marker)
    opening = SOURCE.index('{', start)
    depth, end = 1, opening + 1
    while depth:
        if SOURCE[end] == '{':
            depth += 1
        elif SOURCE[end] == '}':
            depth -= 1
        end += 1
    return SOURCE[start:end]


markers = (
    'private func sessionID(', 'private func language(', '@objc func availability(', '@objc private func suspendAudio(',
    'private func rejectStart(', '@objc func stopListening(',
    '@objc func cancelListening(', 'private func finishRecognition(',
    'private func releaseRecognition(', '@objc func stopSpeaking(',
    'private func finishSpeech(', 'private func speechProgress(',
    'public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart',
    'public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString',
    'public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish',
    'public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel',
)
methods = '\n'.join(declaration(marker).replace('@objc ', '').replace('private func', 'func') for marker in markers)
# Execute the actual recognition callback, including its partial payload and
# final/error decision, rather than a separately implemented mock protocol.
recognition = declaration('self.recognitionTask = recognizer.recognitionTask(with: request)')
stubs = (ROOT / 'scripts/native-assistant-tests.swift').read_text()
locales = next(line for line in SOURCE.splitlines() if line.startswith('private let assistantLocales ='))
locale_helper = declaration('private func assistantLocale(')
stubs = stubs.replace('/* PRODUCTION_LOCALES */', locales + '\n' + locale_helper)
stubs = stubs.replace('/* PRODUCTION_METHODS */', methods).replace('/* PRODUCTION_RECOGNITION_CALLBACK */', recognition)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--frameworks', type=Path)
args = parser.parse_args()
if args.frameworks:
    sdk = subprocess.check_output(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path'], text=True).strip()
    subprocess.run(['xcrun', 'swiftc', '-typecheck', '-sdk', sdk,
                    '-target', 'arm64-apple-ios15.0-simulator', '-F', str(args.frameworks), str(PLUGIN)], check=True)
    print('PASS: entire production assistant plugin iOS SDK typecheck', flush=True)
else:
    print('SKIP: iOS SDK typecheck (pass --frameworks with built Capacitor/Cordova frameworks)', flush=True)
with tempfile.TemporaryDirectory(prefix='fixlist-native-assistant-') as directory:
    source, binary = Path(directory) / 'main.swift', Path(directory) / 'assistant-tests'
    source.write_text(stubs)
    subprocess.run(['xcrun', 'swiftc', str(source), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
