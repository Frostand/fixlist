#!/usr/bin/env python3
"""Execute actual production prompt lookup/player/lifecycle methods with host audio/bridge boundaries."""
import argparse, pathlib, subprocess, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
PLUGIN=ROOT/'ios/App/App/FixListAssistantPlugin.swift'
source=PLUGIN.read_text()
def declaration(marker):
    start=source.index(marker);opening=source.index('{',start);depth=1;end=opening+1
    while depth:
        if source[end]=='{':depth+=1
        elif source[end]=='}':depth-=1
        end+=1
    return source[start:end]
methods=[
 'private func sessionID(', 'private func language(', 'private func input(',
 '@objc private func suspendAudio(', 'private func finishRecognition(', 'private func releaseRecognition(',
 '@objc func speak(', 'private func playSpeech(', 'private func cancelCurrentSpeech(', '@objc func stopSpeaking(',
 'private func finishSpeech(', 'private func speechProgress(',
 'public func audioPlayerDidFinishPlaying(', 'public func audioPlayerDecodeErrorDidOccur(',
 'public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart',
 'public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString',
 'public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish',
 'public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel',
]
# Verify the microphone entry uses the same production cancellation path exercised below.
assert 'self.cancelCurrentSpeech(reason: "cancelled")' in declaration('@objc func startListening(')
assert 'AVAudioPlayerDelegate' in source[source.index('public class FixListAssistantPlugin:'):source.index('public let identifier')]
assert 'UIApplication.didEnterBackgroundNotification' in declaration('override public func load(')
fixture=(ROOT/'scripts/native-voice-pack-tests.swift').read_text()
helpers='\n'.join([next(line for line in source.splitlines() if line.startswith('private let assistantLocales =')), declaration('private func assistantLocale('), declaration('private enum AssistantSpeech'), declaration('private enum AssistantPromptPack')])
state=source.split('// BEGIN SPEECH OUTPUT STATE',1)[1].split('// END SPEECH OUTPUT STATE',1)[0].split('\n',1)[1].replace('private var','var')
methods='\n'.join(declaration(marker).replace('@objc ', '').replace('private func','func') for marker in methods)
fixture=fixture.replace('/* PRODUCTION_HELPERS */',helpers).replace('/* PRODUCTION_STATE */',state).replace('/* PRODUCTION_METHODS */',methods)
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--frameworks',type=pathlib.Path);args=parser.parse_args()
if args.frameworks:
    sdk=subprocess.check_output(['xcrun','--sdk','iphonesimulator','--show-sdk-path'],text=True).strip()
    subprocess.run(['xcrun','swiftc','-typecheck','-sdk',sdk,'-target','arm64-apple-ios15.0-simulator','-F',str(args.frameworks),str(PLUGIN)],check=True)
    print('PASS: entire actual plugin typechecks against iOS 15 deployment target',flush=True)
with tempfile.TemporaryDirectory(prefix='fixlist-native-voice-') as directory:
    path=pathlib.Path(directory)/'main.swift';binary=pathlib.Path(directory)/'voice-tests';path.write_text(fixture)
    subprocess.run(['xcrun','swiftc',str(path),'-o',str(binary)],check=True)
    subprocess.run([str(binary),str(ROOT)],check=True)
