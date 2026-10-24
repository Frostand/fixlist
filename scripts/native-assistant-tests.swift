// Host boundary stubs; the runner injects real production plugin method bodies.
// This checks bridge/state behavior, not microphone capture or audible playback.
import Foundation

final class FixtureQueue {
    var callbacks: [() -> Void] = []
    var timers: [DispatchWorkItem] = []
    func async(execute: @escaping () -> Void) { callbacks.append(execute) }
    func asyncAfter(deadline: DispatchTime, execute: DispatchWorkItem) { timers.append(execute) }
    func drain() { while !callbacks.isEmpty { callbacks.removeFirst()() } }
}
enum DispatchQueue { static let main = FixtureQueue() }
final class CAPPluginCall {
    let id: String
    var results: [[String: Any]] = []
    var rejections: [String] = []
    init(_ id: String) { self.id = id }
    func getString(_ key: String) -> String? { key == "sessionId" ? id : nil }
    func resolve(_ data: [String: Any] = [:]) { results.append(data) }
    func reject(_ message: String, _ code: String) { rejections.append(code) }
}
final class FakeInput { var removes = 0; func removeTap(onBus: Int) { removes += 1 } }
final class FakeEngine { let inputNode = FakeInput(); var stops = 0; func stop() { stops += 1 } }
final class FakeRequest { var ends = 0; func endAudio() { ends += 1 } }
final class FakeTask { var cancels = 0; func cancel() { cancels += 1 } }
struct FakeResult { let bestTranscription: Transcription; let isFinal: Bool }
struct Transcription { let formattedString: String }
final class FakeRecognizer {
    var callback: ((FakeResult?, Error?) -> Void)?
    func recognitionTask(with: FakeRequest, resultHandler: @escaping (FakeResult?, Error?) -> Void) -> FakeTask {
        callback = resultHandler; return FakeTask()
    }
}
final class AVSpeechUtterance {}
final class AVSpeechSynthesizer {
    enum Boundary { case immediate }
    var stops = 0
    func stopSpeaking(at: Boundary) { stops += 1 }
}
enum UIApplication { static let didEnterBackgroundNotification = Notification.Name("background") }
let AVAudioSessionInterruptionTypeKey = "type"
enum AVAudioSession {
    static let interruptionNotification = Notification.Name("interruption")
    enum InterruptionType: UInt { case began = 1, ended = 0 }
}
final class Harness {
    let synthesizer = AVSpeechSynthesizer()
    var speechID: String?, spokenUtterance: AVSpeechUtterance?
    var audioEngine: FakeEngine?, recognitionRequest: FakeRequest?, recognitionTask: FakeTask?, recognizer: FakeRecognizer?
    var transcript = "", listenID: String?, pendingStart: CAPPluginCall?, pendingStops: [CAPPluginCall] = []
    var stopTimer: DispatchWorkItem?, tapInstalled = false
    var restores = 0, events: [(String, [String: Any])] = []
    func restoreAudio() { restores += 1 }
    func notifyListeners(_ name: String, data: [String: Any]) { events.append((name, data)) }
    func begin(_ id: String) -> FakeRecognizer {
        listenID = id; transcript = ""; audioEngine = FakeEngine(); tapInstalled = true
        let recognizer = FakeRecognizer(), request = FakeRequest()
        self.recognizer = recognizer; recognitionRequest = request
        /* PRODUCTION_RECOGNITION_CALLBACK */
        return recognizer
    }
    /* PRODUCTION_METHODS */
}
var checks = 0
func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    checks += 1
    if !condition() { print("FAIL: \(message)"); exit(1) }
}
func event(_ harness: Harness, _ name: String) -> [String: Any] { harness.events.last { $0.0 == name }?.1 ?? [:] }
func drain() { DispatchQueue.main.drain() }
let h = Harness()
let first = h.begin("first")
first.callback?(FakeResult(bestTranscription: Transcription(formattedString: "Move this chair"), isFinal: false), nil); drain()
expect(event(h, "partial")["sessionId"] as? String == "first", "Real partial callback includes the client session ID")
first.callback?(FakeResult(bestTranscription: Transcription(formattedString: "Move this chair please"), isFinal: true), nil); drain()
expect(event(h, "listeningEnded")["reason"] as? String == "final", "Natural final emits the terminal event")
expect(event(h, "listeningEnded")["text"] as? String == "Move this chair please", "Natural final carries final text")
expect(h.listenID == nil && h.audioEngine == nil, "Natural final releases microphone state")
let restores = h.restores, events = h.events.count
first.callback?(nil, NSError(domain: "late", code: 1)); drain()
expect(h.restores == restores && h.events.count == events, "Late recognition callbacks do not emit twice or restore audio again")
for (name, expected) in [(UIApplication.didEnterBackgroundNotification, "background"), (AVAudioSession.interruptionNotification, "interrupted")] {
    _ = h.begin(expected); h.transcript = "Recover these partial words"
    h.suspendAudio(Notification(name: name)); drain()
    let end = event(h, "listeningEnded")
    expect(end["sessionId"] as? String == expected && end["reason"] as? String == expected, "Notification wires the actual terminal reason and session")
    expect(end["text"] as? String == "Recover these partial words", "Notification preserves the transcript before releasing audio")
}
let failed = h.begin("failed")
failed.callback?(FakeResult(bestTranscription: Transcription(formattedString: "Partial before error"), isFinal: false), NSError(domain: "speech", code: 2)); drain()
expect(event(h, "listeningEnded")["reason"] as? String == "error" && event(h, "listeningEnded")["text"] as? String == "Partial before error", "Actual error callback terminates with recoverable text")
let stopping = h.begin("stopping")
h.transcript = "Stop words"
let stop1 = CAPPluginCall("stopping"), stop2 = CAPPluginCall("stopping")
h.stopListening(stop1); h.stopListening(stop2); drain()
expect(h.pendingStops.count == 2 && h.stopTimer != nil, "Repeated stops wait on the same native session")
let oldTimeout = h.stopTimer!
stopping.callback?(FakeResult(bestTranscription: Transcription(formattedString: "Final stop words"), isFinal: true), nil); drain()
expect(stop1.results.count == 1 && stop2.results.count == 1, "Each repeated stop resolves exactly once")
expect(stop1.results[0]["text"] as? String == "Final stop words" && stop1.results[0]["reason"] as? String == "stopped", "Stop response carries the same ID, reason and text as terminal")
_ = h.begin("new-input")
let restoreBeforeOld = h.restores, countBeforeOld = h.events.count
h.cancelListening(CAPPluginCall("stopping")); h.stopListening(CAPPluginCall("stopping")); oldTimeout.perform(); drain()
expect(h.listenID == "new-input" && h.restores == restoreBeforeOld && h.events.count == countBeforeOld, "Old cancel/stop/timeout cannot release or restore newer input")
h.suspendAudio(Notification(name: AVAudioSession.interruptionNotification, userInfo: [AVAudioSessionInterruptionTypeKey: UInt(0)])); drain()
expect(h.listenID == "new-input", "Interruption-ended notification does not cancel a new session")
h.pendingStart = CAPPluginCall("new-input")
let pending = h.pendingStart!
h.cancelListening(CAPPluginCall("new-input")); h.cancelListening(CAPPluginCall("new-input")); drain()
expect(pending.rejections == ["CANCELLED"] && h.listenID == nil, "Cancel during permission startup settles startup once")
let oldUtterance = AVSpeechUtterance(); h.speechID = "output-old"; h.spokenUtterance = oldUtterance
h.speechSynthesizer(h.synthesizer, didStart: oldUtterance); drain()
expect(event(h, "speechProgress")["stage"] as? String == "started" && event(h, "speechProgress")["sessionId"] as? String == "output-old", "Real didStart delegate wires progress and ID")
h.speechSynthesizer(h.synthesizer, willSpeakRangeOfSpeechString: NSRange(location: 0, length: 4), utterance: oldUtterance); drain()
expect(event(h, "speechProgress")["stage"] as? String == "word", "Real word delegate drives the inactivity watchdog")
h.stopSpeaking(CAPPluginCall("output-old")); drain()
let newUtterance = AVSpeechUtterance(); h.speechID = "output-new"; h.spokenUtterance = newUtterance
let restoresBeforeSpeech = h.restores, speechEvents = h.events.count
h.stopSpeaking(CAPPluginCall("output-old"))
h.speechSynthesizer(h.synthesizer, didFinish: oldUtterance)
h.speechSynthesizer(h.synthesizer, didCancel: oldUtterance)
h.speechSynthesizer(h.synthesizer, didStart: oldUtterance); drain()
expect(h.speechID == "output-new" && h.spokenUtterance === newUtterance && h.restores == restoresBeforeSpeech && h.events.count == speechEvents, "Old output stop/delegates cannot stop, restore or complete newer output")
h.speechSynthesizer(h.synthesizer, didFinish: newUtterance); drain()
expect(event(h, "speechEnded")["sessionId"] as? String == "output-new" && event(h, "speechEnded")["reason"] as? String == "completed", "Real finish delegate emits terminal fields")
print("PASS: \(checks) production native assistant bridge/state checks (host boundaries; no microphone/playback claim)")
